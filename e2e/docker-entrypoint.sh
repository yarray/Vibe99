#!/bin/bash
set -euo pipefail

# If local source is mounted, rsync it into the workspace
# without overwriting the pre-compiled target/ and node_modules/
if [ -d /mnt/source ] && [ "$(ls -A /mnt/source 2>/dev/null)" ]; then
    rsync -a --exclude src-tauri/target --exclude node_modules /mnt/source/ /app/Vibe99/
fi

exec "$@"
