#!/bin/sh
set -e

# Set defaults based on SERVER_TYPE
case "$SERVER_TYPE" in
  master_server)
    : ${SERVER_ADDRESS:=0.0.0.0:9090}
    : ${ROOT_DIR:=/data/master}
    ;;
  chunk_server)
    : ${SERVER_ADDRESS:=0.0.0.0:8085}
    : ${MASTER_ADDR:=master:9090}
    : ${REDIS_ADDR:=redis:6379}
    : ${ROOT_DIR:=/data/chunks}
    ;;
  gateway_server)
    : ${GATEWAY_ADDR:=8089}
    : ${MASTER_ADDR:=master:9090}
    : ${ROOT_DIR:=/data/gateway}
    ;;
  *)
    echo "ERROR: Unknown SERVER_TYPE: $SERVER_TYPE"
    echo "Valid types: master_server, chunk_server, gateway_server"
    exit 1
    ;;
esac

# Build command arguments
ARGS="-ServerType=$SERVER_TYPE -logLevel=${LOG_LEVEL:-info} -rootDir=$ROOT_DIR"

if [ "$SERVER_TYPE" = "chunk_server" ]; then
  ARGS="$ARGS -serverAddr=$SERVER_ADDRESS -masterAddr=$MASTER_ADDR -redisAddr=$REDIS_ADDR"
elif [ "$SERVER_TYPE" = "master_server" ]; then
  ARGS="$ARGS -serverAddr=$SERVER_ADDRESS"
elif [ "$SERVER_TYPE" = "gateway_server" ]; then
  ARGS="$ARGS -gatewayAddr=$GATEWAY_ADDR -masterAddr=$MASTER_ADDR"
fi

echo "Starting Hercules $SERVER_TYPE with: $ARGS"

ls -la /app
test -x /app && echo "Binary executable OK" || { echo "Binary not executable!"; exit 1; }

# Execute the binary
exec /app $ARGS