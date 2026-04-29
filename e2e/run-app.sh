#!/bin/bash
# Wrapper for running Vibe99 on Ubuntu 20.04 with linuxbrew glibc.
# The app binary links against webkit2gtk-4.1 from Ubuntu 22.04 (jammy),
# which requires glibc >= 2.35. On Ubuntu 20.04 (glibc 2.31) we route
# through the linuxbrew glibc dynamic linker with an augmented
# LD_LIBRARY_PATH so every jammy shared library is found at runtime.
set -euo pipefail

SELF="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SELF}/.." && pwd)"

# Resolve the actual binary (prefer release over debug).
BINARY="${PROJECT_ROOT}/src-tauri/target/release/vibe99"
if [ ! -f "$BINARY" ]; then
    BINARY="${PROJECT_ROOT}/src-tauri/target/debug/vibe99"
fi
if [ ! -f "$BINARY" ]; then
    echo "ERROR: vibe99 binary not found. Run 'npm run tauri:build' first." >&2
    exit 1
fi

LINUXBREW_LD="/home/linuxbrew/.linuxbrew/Cellar/glibc/2.39/lib/ld-linux-x86-64.so.2"

if [ -x "$LINUXBREW_LD" ]; then
    export LD_LIBRARY_PATH="/home/linuxbrew/.linuxbrew/Cellar/glibc/2.39/lib:/opt/webkit-jammy/usr/lib/x86_64-linux-gnu:/opt/glib-2.72/lib/x86_64-linux-gnu:/opt/glib-2.72/lib:/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    export LIBGL_ALWAYS_SOFTWARE=1
    exec "$LINUXBREW_LD" "$BINARY" "$@"
else
    exec "$BINARY" "$@"
fi
