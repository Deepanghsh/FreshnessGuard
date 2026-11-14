# Reproducible Linux build container for FreshnessGuard Bifrost plugin (.so)
FROM golang:1.27-alpine AS builder

# Install build dependencies for CGO
RUN apk add --no-cache gcc musl-dev libc-dev git

WORKDIR /build

COPY go.mod ./
COPY . .

ENV CGO_ENABLED=1
ENV GOOS=linux
ENV GOARCH=amd64

# Compile with -buildmode=plugin
RUN go build -buildmode=plugin -trimpath -ldflags="-s -w" -o /build/freshnessguard.so .

FROM alpine:3.19

WORKDIR /output
COPY --from=builder /build/freshnessguard.so /output/freshnessguard.so

CMD ["cp", "/output/freshnessguard.so", "/plugins/freshnessguard.so"]

