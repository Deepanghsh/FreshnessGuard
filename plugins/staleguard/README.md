# StaleGuard — Bifrost Gateway Plugin

**StaleGuard** is a [Bifrost](https://github.com/maximhq/bifrost) LLM-gateway plugin that detects and annotates **stale claims** in AI-generated responses — version numbers, prices, dates, and temporal language that may have drifted from reality.

Built for the **Geek Room Global AI Hackathon**.

---

## How it works

```
LLM Response → PostLLMHook → (basic | service) mode → annotated response + X-StaleGuard-* headers
```

| Mode | Trigger | Mechanism |
|------|---------|-----------|
| **basic** | `basic_mode: true` or no `service_url` | Fast regex heuristics (no network) |
| **service** | `service_url` set + `basic_mode: false` | Calls the StaleGuard Node.js service |
| **bypass** | Service unreachable | Fail-open: response passes through unchanged |

### Response headers injected

| Header | Example | Meaning |
|--------|---------|---------|
| `X-StaleGuard-Score` | `0.42` | Freshness score (0 = very stale, 1 = fresh) |
| `X-StaleGuard-Stale` | `3` | Number of stale claims detected |
| `X-StaleGuard-Latency` | `12ms` | Plugin processing latency |
| `X-StaleGuard-Mode` | `basic` / `service` / `bypass` | Active mode |

When stale claims are found, a human-readable annotation is appended to the response content:

```
---
[StaleGuard] Score: 0.42 | 3 potentially stale of 5 claims (basic mode)
```

---

## Configuration

See [`config.example.json`](config.example.json) for a full example.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `service_url` | string | `""` | URL of the StaleGuard Node.js service |
| `timeout_ms` | int | `2000` | HTTP timeout for service calls |
| `basic_mode` | bool | `false` | Force regex-only mode (no service call) |
| `api_key` | string | `""` | Optional bearer key sent as `X-StaleGuard-Key` |

### Bifrost plugin config (bifrost.yaml excerpt)

```yaml
plugins:
  - name: staleguard
    path: ./plugins/staleguard/staleguard.so
    config:
      service_url: "http://localhost:3001"
      timeout_ms: 2000
      basic_mode: false
      api_key: ""
```

---

## Building

### Local (stdlib only, no external deps)

```bash
cd plugins/staleguard
go build .          # verify it compiles
go test ./...       # run unit tests
```

### As a Bifrost plugin (.so)

```bash
# Linux / Docker (plugin buildmode requires CGO + Linux)
go build -buildmode=plugin -o staleguard.so .
```

> **Note**: Go plugins require Linux and CGO. Use the provided Dockerfile for cross-platform builds.

### Docker

```bash
docker build -f Dockerfile.plugin -t staleguard-plugin .
docker run --rm -v $(pwd)/out:/out staleguard-plugin
# staleguard.so appears in ./out/
```

---

## Claim detection (basic mode)

| Pattern | Category | Score |
|---------|----------|-------|
| `v\d+\.\d+(\.\d+)?` | `version` | 0.85 |
| `\$\d[\d,]*(\.\d{2})?` | `pricing` | 0.90 |
| `20\d{2}` | `date` | 0.60 |
| latest / current / as of / updated / recent | `fact` | 0.55 |

Claims with score > 0.5 are counted as stale.

---

## Project structure

```
plugins/staleguard/
├── go.mod              # module: github.com/staleguard/plugin (zero external deps)
├── types.go            # local Bifrost interface stubs
├── main.go             # plugin logic + InitPlugin + PluginInstance
├── plugin_test.go      # unit + integration tests
├── config.example.json # example configuration
└── README.md           # this file
```

---

## Fail-safe design

StaleGuard **never breaks the request pipeline**:

- Service timeout or error → **bypass mode** (response passes through)
- Nil or malformed LLM response → returned as-is
- All errors logged to stderr; none propagated upward

---

## License

MIT — Geek Room Global AI Hackathon project.
