# Build with the same Go version and Alpine family as Bifrost v2.5.1
FROM golang:1.27.3-alpine3.24 AS builder

RUN apk add --no-cache gcc musl-dev libc-dev

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download

COPY . .

ENV CGO_ENABLED=1
ENV GOOS=linux
ENV GOARCH=amd64

RUN go build -buildmode=plugin -trimpath -ldflags="-s -w" -o /build/freshnessguard.so .

FROM alpine:3.23

WORKDIR /output
COPY --from=builder /build/freshnessguard.so /output/freshnessguard.so

CMD ["cp", "/output/freshnessguard.so", "/plugins/freshnessguard.so"]
