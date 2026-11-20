# Build FreshnessGuard Bifrost plugin (.so) inside Docker for Linux target
Write-Host "==> Building FreshnessGuard Go plugin for Linux target..." -ForegroundColor Cyan

docker run --rm `
  -v "${PWD}/plugins/freshnessguard:/build" `
  -w /build `
  -e CGO_ENABLED=1 `
  -e GOOS=linux `
  -e GOARCH=amd64 `
  golang:1.27.3-alpine3.24 `
  sh -c "apk add --no-cache gcc musl-dev libc-dev && go mod download && go build -buildmode=plugin -trimpath -ldflags='-s -w' -o /build/freshnessguard.so ."

if ($LASTEXITCODE -eq 0) {
  if (-not (Test-Path "plugins")) { New-Item -ItemType Directory -Path "plugins" | Out-Null }
  Copy-Item -Path "plugins\freshnessguard\freshnessguard.so" -Destination "plugins\freshnessguard.so" -Force
  Write-Host "==> Successfully built plugins/freshnessguard.so" -ForegroundColor Green
} else {
  Write-Host "==> Plugin compilation failed. Ensure Docker Engine is running." -ForegroundColor Red
}

