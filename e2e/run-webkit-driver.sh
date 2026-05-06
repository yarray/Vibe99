#!/bin/bash
LINUXBREW_LD="/home/linuxbrew/.linuxbrew/Cellar/glibc/2.39/lib/ld-linux-x86-64.so.2"
DRIVER="/opt/webkit-jammy/usr/bin/WebKitWebDriver"
BREW_LIB="/home/linuxbrew/.linuxbrew/Cellar/glibc/2.39/lib"
JAMMY_LIB="/opt/webkit-jammy/usr/lib/x86_64-linux-gnu"
GLIB_LIB="/opt/glib-2.72/lib/x86_64-linux-gnu:/opt/glib-2.72/lib"
SYS_LIB="/usr/lib/x86_64-linux-gnu"

if [ -x "$LINUXBREW_LD" ]; then
    export LD_LIBRARY_PATH="$BREW_LIB:$JAMMY_LIB:$GLIB_LIB:$SYS_LIB${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    exec "$LINUXBREW_LD" "$DRIVER" "$@"
else
    exec "$DRIVER" "$@"
fi
