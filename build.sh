#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
IMAGE_NAME="${IMAGE_NAME:-superlexicon-client-web:latest}"

echo "=== [1/2] Initializing & Syncing Git Submodule (packages/sdk) ==="
git submodule update --init --recursive packages/sdk

echo "=== [2/2] Building Docker Image: $IMAGE_NAME ==="
docker build -t "$IMAGE_NAME" .
