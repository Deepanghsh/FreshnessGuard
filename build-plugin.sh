#!/usr/bin/env bash
# Build FreshnessGuard Bifrost plugin (.so) inside Docker for Linux target
set -euo pipefail

echo "==> Building FreshnessGuard Go plugin for Linux target..."
docker run --rm \
  -v "$(pwd)/plugins/freshnessguard:/build" \
  -w /build \
  -e CGO_ENABLED=1 \
  -e GOOS=linux \
  -e GOARCH=amd64 \
  golang:1.21-alpine \
  sh -c "apk add --no-cache gcc musl-dev libc-dev && go build -buildmode=plugin -trimpath -ldflags='-s -w' -o /build/freshnessguard.so ."

mkdir -p plugins
cp plugins/freshnessguard/freshnessguard.so plugins/freshnessguard.so
echo "==> Successfully built plugins/freshnessguard.so"

