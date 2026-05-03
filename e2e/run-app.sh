#!/bin/bash
# Wrapper for running Vibe99 on Ubuntu 20.04 with custom webkit/glib libraries.
# The app binary links against webkit2gtk-4.1 from Ubuntu 22.04 (jammy).
# On systems with linuxbrew glibc (>= 2.35), we route through its dynamic linker.
# Otherwise, we set LD_LIBRARY_PATH so the jammy/glib shared libraries are found.
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

JAMMY_LIB="/opt/webkit-jammy/usr/lib/x86_64-linux-gnu"
GLIB_LIB="/opt/glib-2.72/lib/x86_64-linux-gnu:/opt/glib-2.72/lib"
SYS_LIB="/usr/lib/x86_64-linux-gnu"
AUGMENTED_LD="$JAMMY_LIB:$GLIB_LIB:$SYS_LIB${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

if [ -x "$LINUXBREW_LD" ]; then
    export LD_LIBRARY_PATH="/home/linuxbrew/.linuxbrew/Cellar/glibc/2.39/lib:$AUGMENTED_LD"
    export LIBGL_ALWAYS_SOFTWARE=1
    exec "$LINUXBREW_LD" "$BINARY" "$@"
else
    export LD_LIBRARY_PATH="$AUGMENTED_LD"
    export LIBGL_ALWAYS_SOFTWARE=1
    exec "$BINARY" "$@"
fi
