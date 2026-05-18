#!/bin/bash
set -euo pipefail

IMAGE="vibe99-builder:latest"
DOCKERFILE="$(dirname "$0")/Dockerfile.e2e"
CACHE_DIR="${HOME}/.cache/vibe99-docker"
BUILD_CONTEXT_CACHE="$(dirname "$0")/.cache"

mkdir -p "$CACHE_DIR" "$BUILD_CONTEXT_CACHE"

# Extract build cache from previous image
if docker image inspect "$IMAGE" &>/dev/null; then
    echo "📦 Extracting build cache from previous image..."
    CID=$(docker create "$IMAGE" --entrypoint true 2>/dev/null) || true
    if [ -n "${CID:-}" ]; then
        docker cp "$CID:/tmp/cargo-target.tar.gz" "$CACHE_DIR/cargo-target.tar.gz" 2>/dev/null || true
        docker cp "$CID:/tmp/cargo-registry.tar.gz" "$CACHE_DIR/cargo-registry.tar.gz" 2>/dev/null || true
        docker cp "$CID:/tmp/cargo-git.tar.gz" "$CACHE_DIR/cargo-git.tar.gz" 2>/dev/null || true
        docker rm "$CID" >/dev/null
    fi
fi

# Copy cache into build context
for f in cargo-target cargo-registry cargo-git; do
    if [ -f "$CACHE_DIR/${f}.tar.gz" ]; then
        cp "$CACHE_DIR/${f}.tar.gz" "$BUILD_CONTEXT_CACHE/"
    fi
done

echo "🔨 Building $IMAGE..."
docker build -f "$DOCKERFILE" -t "$IMAGE" .

echo "✅ Build complete."

# Clean up build context cache
rm -rf "$BUILD_CONTEXT_CACHE"

echo "💡 Run e2e tests with:"
echo "   docker run --rm --privileged $IMAGE bash -c \"git fetch origin && git checkout <branch> && npm run test:e2e\""
