# Hercules Distributed System - Multi-Server Dockerfile
# Supports building images for: master_server, chunk_server, gateway_server
# Build with: docker build --build-arg SERVER_TYPE=<type> -t hercules-<type> .
FROM golang:tip-alpine3.22 AS builder

WORKDIR /build

RUN apk add --no-cache file

COPY go.mod go.sum ./
RUN go mod download && go mod verify

COPY . .

# Build static binary; adjust if main in subdir (e.g., cd hercules && go build -o app . && mv app ..)
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o app . && \
    chmod +x app && \
    file app

# Stage 2: Runtime
FROM alpine:3.20

ARG SERVER_TYPE=chunk_server
ENV SERVER_TYPE=${SERVER_TYPE}
ENV LOG_LEVEL="info"

RUN apk add --no-cache ca-certificates procps iputils netcat-openbsd net-tools && \
    addgroup -g 1001 -S hercules && \
    adduser -S -D -H -u 1001 -h /tmp -s /sbin/nologin -G hercules -g hercules hercules

RUN mkdir -p /data/master/metadata \
    /data/chunks  /data/gateway && \
    chown -R hercules:hercules /data

WORKDIR /

COPY --from=builder /build/app /app
COPY entrypoint.sh /entrypoint.sh

RUN chown hercules:hercules /app /entrypoint.sh && \
    chmod 755 /app /entrypoint.sh && \
    ls -la /app /entrypoint.sh  

USER hercules

EXPOSE 8081-8090 9090 8089

ENV HEALTH_PORT=8081
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=5 \
    CMD nc -z 127.0.0.1 ${HEALTH_PORT} || exit 1

VOLUME ["/data"]

ENTRYPOINT ["/entrypoint.sh"]