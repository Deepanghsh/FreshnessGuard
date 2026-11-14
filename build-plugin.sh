#!/usr/bin/env bash
# Build FreshnessGuard Bifrost plugin using Bifrost-compatible Go version.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Building FreshnessGuard plugin with Go 1.27.3..."

docker run --rm \
  -v "$ROOT_DIR/plugins/freshnessguard:/build" \
  -w /build \
  -e CGO_ENABLED=1 \
  -e GOOS=linux \
  -e GOARCH=amd64 \
  golang:1.27.3-alpine3.24 \
  sh -c "apk add --no-cache gcc musl-dev libc-dev && go mod download && go build -buildmode=plugin -trimpath -ldflags='-s -w' -o /build/freshnessguard.so ."

mkdir -p "$ROOT_DIR/plugins"
cp "$ROOT_DIR/plugins/freshnessguard/freshnessguard.so" "$ROOT_DIR/plugins/freshnessguard.so"

echo "==> Successfully built plugins/freshnessguard.so"
