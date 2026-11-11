# FreshnessGuard Bifrost Gateway Plugin (Go)

A high-performance `PostLLMHook` plugin for the [Bifrost LLM Gateway](https://github.com/maximhq/bifrost) that intercepts LLM completions, extracts time-sensitive claims, verifies them against live web data via Tavily, and injects freshness scores and optional corrections.

---

## ⚡ Key Features

- **Dual Operating Modes**:
  - `serviceMode`: High-accuracy verification backed by the FreshnessGuard Node.js service & Tavily search API.
  - `basicMode`: Autonomous regex-based heuristic mode with zero external service dependencies.
- **Fail-Open Architecture**: If the verification service is unreachable, returns 500, or exceeds its strict deadline (`timeout_ms`, default 2000ms), the plugin immediately returns the original response unmodified. The gateway never breaks.
- **HTTP Header Injection**:
  - `X-FreshnessGuard-Score`: Float score between `0.00` and `1.00`.
  - `X-FreshnessGuard-Stale`: Boolean flag (`true` if stale claims were detected).
  - `X-FreshnessGuard-Latency`: Verification turnaround latency in milliseconds.
- **Non-Destructive Correction Notes**: Appends a clear, non-destructive freshness advisory footnote to completions containing stale facts.

---

## 🛠️ Plugin Configuration

Add this plugin block to your Bifrost configuration file (`config.json`):

```json
{
  "plugins": [
    {
      "name": "freshnessguard",
      "path": "/app/plugins/freshnessguard.so",
      "enabled": true,
      "config": {
        "service_url": "http://server:3001",
        "timeout_ms": 2000,
        "basic_mode": false,
        "append_note": true
      }
    }
  ]
}
```

### Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `service_url` | `string` | `"http://localhost:3001"` | URL of the FreshnessGuard verification service |
| `timeout_ms` | `int` | `2000` | Strict timeout deadline in milliseconds before failing open |
| `basic_mode` | `bool` | `false` | When `true`, uses local regex extraction without calling external service |
| `append_note` | `bool` | `true` | When `true`, appends a correction footnote to stale responses |

---

## 🏗️ Building the Plugin (.so)

> ⚠️ **Note on OS Compatibility**: Go plugin binaries compiled with `-buildmode=plugin` are supported only on **Linux** systems. Windows and macOS hosts must compile inside Docker or WSL.

### Build using Docker (Recommended)

```bash
docker run --rm -v $(pwd):/workspace -w /workspace golang:1.21-alpine \
  go build -buildmode=plugin -o /workspace/freshnessguard.so .
```

### Run Unit Tests

```bash
docker run --rm -v $(pwd):/workspace -w /workspace golang:1.21-alpine \
  go test -v ./...
```

