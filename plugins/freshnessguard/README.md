# FreshnessGuard Bifrost Gateway Plugin (Go)

A high-performance `PostLLMHook` plugin for the [Bifrost LLM Gateway](https://github.com/maximhq/bifrost) that intercepts LLM completions, extracts time-sensitive factual claims, verifies them against live web data via Tavily, and injects freshness scores and optional corrections into the response.

---

## ⚡ Key Features

- **Four Operating Modes** (selected per-request via the FreshnessGuard Node service):
  - `inline` — Block until all claims are verified via Tavily; highest accuracy.
  - `async` — Return 202 immediately; push results via SSE when verification completes.
  - `basic` — Local regex heuristics only; zero external dependencies.
  - `bypass` — Pass-through; FreshnessGuard skips all processing.
- **Fail-Open Architecture**: If the verification service is unreachable, times out, or returns 5xx, the plugin immediately returns the original response unmodified. The gateway never breaks.
- **HTTP Header Injection** on every processed response:
  - `X-FreshnessGuard-Score` — Freshness score `0.00`–`1.00`.
  - `X-FreshnessGuard-Stale` — Boolean flag (`true` if stale claims detected).
  - `X-FreshnessGuard-Latency` — Verification turnaround in milliseconds.
- **Non-Destructive Corrections**: Appends a clear freshness advisory footnote to stale responses rather than modifying the original content.
- **Recursion Prevention**: `PreLLMHook` injects `x-bf-eh-freshnessguard-bypass: true` on internal LLM calls, preventing infinite re-entry.

---

## 🛠️ Plugin Configuration

Add this plugin block to your Bifrost configuration file (`bifrost-config/config.json`):

```json
{
  "$schema": "https://www.getbifrost.ai/schema",
  "version": 2,
  "source_of_truth": "config.json",
  "client": {
    "enable_logging": true
  },
  "providers": {
    "openai": {
      "keys": [
        {
          "name": "openai-primary",
          "value": "env.OPENAI_API_KEY",
          "models": ["*"],
          "weight": 1.0
        }
      ]
    }
  },
  "plugins": [
    {
      "name": "freshnessguard",
      "enabled": true,
      "path": "/app/plugins/freshnessguard.so",
      "config": {
        "service_url": "http://server:3001",
        "timeout_ms": 2000,
        "basic_mode": false,
        "inject_note": true
      }
    }
  ]
}
```

### Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `service_url` | `string` | `"http://localhost:3001"` | URL of the FreshnessGuard Node service |
| `timeout_ms` | `int` | `2000` | Strict deadline in milliseconds before failing open |
| `basic_mode` | `bool` | `false` | When `true`, uses local regex extraction without external service |
| `inject_note` | `bool` | `true` | Appends a correction footnote to stale responses (also accepts `append_note`) |
| `score_threshold` | `float64` | `0.75` | Claims with freshness score above this are suppressed from correction notes |
| `api_key` | `string` | `""` | Optional Bearer token added to service calls |

---

## 🔌 Exported Symbols & Interface Contract

FreshnessGuard adheres to the canonical exported symbol signatures expected by Bifrost's dynamic plugin loader (`framework/plugins/soloader.go`):

| Symbol | Signature | Lifecycle Stage |
|---|---|---|
| `Init` | `func Init(config any) error` | Called on gateway bootstrap with the plugin's `config` object |
| `GetName` | `func GetName() string` | Returns `"freshnessguard"` |
| `Cleanup` | `func Cleanup() error` | Called during graceful gateway shutdown |
| `PreRequestHook` | `func PreRequestHook(ctx *BifrostContext, req *BifrostRequest) error` | Called before request routing |
| `PreLLMHook` | `func PreLLMHook(ctx *BifrostContext, req *BifrostRequest) (*BifrostRequest, *LLMPluginShortCircuit, error)` | Injects recursion-prevention bypass header |
| `PostLLMHook` | `func PostLLMHook(ctx *BifrostContext, resp *BifrostResponse, e *BifrostError) (*BifrostResponse, *BifrostError, error)` | Main verification, scoring, and header injection stage |

---

## 🏗️ Building the Plugin (`.so`)

> ⚠️ **Linux Only**: Go plugin binaries compiled with `-buildmode=plugin` are supported **only on Linux**. Windows and macOS hosts must compile inside Docker or WSL2.

> ⚠️ **Go Version Compatibility**: The plugin must be compiled with the **same major.minor Go version** as the Bifrost host binary. Bifrost v2.5.1 uses **Go 1.27.3**. The plugin Dockerfile uses `golang:1.27-alpine`.

### Option 1: Docker Compose (Recommended — matches Bifrost's exact Go runtime)

```bash
# From the repository root:
docker compose --profile build-plugin up
```

This runs the `plugin-builder` service which compiles the `.so` and places it in `./plugins/freshnessguard.so` — exactly where the `bifrost` service expects it.

### Option 2: Standalone Docker Build

```bash
cd plugins/freshnessguard
docker run --rm \
  -v "$(pwd)":/workspace \
  -w /workspace \
  golang:1.27-alpine \
  sh -c "apk add --no-cache gcc musl-dev && \
         CGO_ENABLED=1 GOOS=linux GOARCH=amd64 \
         go build -buildmode=plugin -trimpath -ldflags='-s -w' \
         -o /workspace/freshnessguard.so ."
```

### Option 3: Build scripts (repository root)

```bash
# Linux/macOS/WSL2:
chmod +x build-plugin.sh && ./build-plugin.sh

# Windows PowerShell:
.\build-plugin.ps1
```

---

## 🧪 Running Unit Tests

The plugin has 22 unit tests that run on any platform (they do not load the `.so`):

```bash
cd plugins/freshnessguard
go test -v ./...
```

> **Note on Windows sandbox**: `go test` uses `httptest.NewServer` which binds ephemeral loopback sockets. The Windows sandbox blocks this. Run outside the sandbox or in WSL2.

Expected output:
```
--- PASS: TestInit (0.00s)
--- PASS: TestGetName (0.00s)
--- PASS: TestCleanup (0.00s)
--- PASS: TestNilResponse (0.00s)
...
PASS
ok  github.com/freshnessguard/plugin
```

---

## 🔄 Fail-Open Invariant

The plugin enforces fail-open behaviour at every failure point:

| Failure Scenario | Plugin Behaviour |
|---|---|
| Service unreachable (connection refused, DNS failure) | Returns original response, injects `Score: 1.0`, `Stale: false` |
| Service timeout (`timeout_ms` exceeded) | Context cancelled, original response returned immediately |
| Service returns HTTP 5xx | Logs error, returns original response untouched |
| `basic_mode: true` | Skips service entirely; uses local regex for header injection only |
| Streaming response or non-standard choice | Passes through untouched (no claim extraction on streams) |
| Nil response / empty choices | Passes through without modification |
