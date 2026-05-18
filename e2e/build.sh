#!/bin/bash
set -euo pipefail

IMAGE="vibe99-builder:latest"
DOCKERFILE="$(dirname "$0")/Dockerfile.e2e"

echo "Building $IMAGE with BuildKit cache mounts..."
docker buildx build -t "$IMAGE" -f "$DOCKERFILE" .

echo ""
echo "Done. Run e2e tests with:"
echo "  docker run --rm --privileged $IMAGE bash -c \"git fetch origin && git checkout <branch> && npm run test:e2e\""
