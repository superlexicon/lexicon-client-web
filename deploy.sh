#!/usr/bin/env bash
# ==============================================================================
# Deployment Script for SuperLexicon Client Web Container (lexicon-client-web)
# ==============================================================================

set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-superlexicon-client-web:latest}"
CONTAINER_NAME="${CONTAINER_NAME:-superlexicon-client-web}"
HOST_PORT="${HOST_PORT:-3200}" # Host port for Nginx container (local or private LAN).

PORT_ARGS=()
BOUND_ENDPOINTS=()

if [ -n "${BIND_ADDR:-}" ]; then
    PORT_ARGS+=( -p "${BIND_ADDR}:${HOST_PORT}:80" )
    BOUND_ENDPOINTS+=( "http://${BIND_ADDR}:${HOST_PORT}" )
else
    # Bind to loopback + all non-Docker private network IPs (10.x, 192.168.x, 172.16-31.x, 100.64-127.x)
    PORT_ARGS+=( -p "127.0.0.1:${HOST_PORT}:80" )
    BOUND_ENDPOINTS+=( "http://127.0.0.1:${HOST_PORT}" )
    while IFS= read -r priv_ip; do
        if [ -n "$priv_ip" ]; then
            PORT_ARGS+=( -p "${priv_ip}:${HOST_PORT}:80" )
            BOUND_ENDPOINTS+=( "http://${priv_ip}:${HOST_PORT}" )
        fi
    done < <(
        ip -4 -o addr show scope global 2>/dev/null \
            | awk '$2 !~ /^(docker|br-|veth|virbr|cni|flannel)/ { sub(/\/.*/, "", $4); print $4 }' \
            | grep -E '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.)' \
            | sort -u || true
    )
fi

if [[ "${PULL_IMAGE:-0}" == "1" || "$IMAGE_NAME" == *"/"* ]]; then
    echo "=== [1/4] Pulling Image: $IMAGE_NAME ==="
    docker pull "$IMAGE_NAME"
else
    echo "=== [1/4] Using Local Docker Image: $IMAGE_NAME ==="
fi

echo ""
echo "=== [2/4] Checking for Existing Container ($CONTAINER_NAME) ==="
if [ "$(docker ps -aq -f name=^/${CONTAINER_NAME}$)" ]; then
    echo "Stopping & removing existing container: $CONTAINER_NAME..."
    docker stop "$CONTAINER_NAME"
    docker rm "$CONTAINER_NAME"
fi

echo ""
echo "=== [3/4] Launching Container (${BOUND_ENDPOINTS[*]}) ==="
docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    --security-opt no-new-privileges:true \
    "${PORT_ARGS[@]}" \
    "$IMAGE_NAME"

echo ""
echo "=== [4/4] Verifying Deployment Status ==="
docker ps -f name=^/${CONTAINER_NAME}$

echo ""
echo "=== Deployment Completed! Listening on: ${BOUND_ENDPOINTS[*]} ==="
