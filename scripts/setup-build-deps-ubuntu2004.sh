#!/usr/bin/env bash
# Setup build dependencies for Vibe99 on Ubuntu 20.04
#
# Tauri v2 requires webkit2gtk-4.1, libsoup-3.0, and glib >= 2.70,
# which are not available in Ubuntu 20.04's default repos.
# This script installs them from source (glib) and Ubuntu 22.04 packages (webkit/soup).
#
# All custom libraries are installed to /opt (isolated from system).
# NO system-level changes are made (no ldconfig, no profile.d).
# A local env file is generated for sourcing before builds.
#
# Usage: sudo bash scripts/setup-build-deps-ubuntu2004.sh

set -euo pipefail

if [ "$(lsb_release -rs 2>/dev/null || echo "unknown")" != "20.04" ]; then
    echo "This script is intended for Ubuntu 20.04 only."
    echo "For Ubuntu 22.04+, install system deps directly:"
    echo "  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev"
    exit 0
fi

# Resolve the project root (where this script lives, two levels up)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.build-env.sh"

GLIB_PREFIX="/opt/glib-2.72"
WEBKIT_JAMMY_PREFIX="/opt/webkit-jammy"

echo "=== Vibe99 Build Dependency Setup for Ubuntu 20.04 ==="
echo "  Project root: ${PROJECT_ROOT}"
echo "  Env file:     ${ENV_FILE}"
echo ""

# Step 1: Install build tools and base dependencies from Ubuntu 20.04 repos
echo "[1/4] Installing build tools..."
apt-get update -qq
apt-get install -y --no-install-recommends \
    build-essential curl wget file pkg-config \
    meson ninja-build libffi-dev zlib1g-dev libmount-dev libpcre3-dev \
    libgtk-3-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
    libxdo-dev libnghttp2-dev

# Step 2: Build and install GLib 2.72 from source to /opt
echo "[2/4] Building GLib 2.72.4 from source..."
if ! PKG_CONFIG_PATH="${GLIB_PREFIX}/lib/x86_64-linux-gnu/pkgconfig:${GLIB_PREFIX}/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}" \
    pkg-config --atleast-version=2.70 glib-2.0 2>/dev/null; then
    GLIB_VERSION="2.72.4"

    if [ ! -d "${GLIB_PREFIX}" ]; then
        tmpdir=$(mktemp -d)
        trap "rm -rf ${tmpdir}" EXIT

        cd "${tmpdir}"
        curl -L "https://download.gnome.org/sources/glib/2.72/glib-${GLIB_VERSION}.tar.xz" -o glib.tar.xz
        tar xf glib.tar.xz
        cd "glib-${GLIB_VERSION}"

        meson setup _build --prefix="${GLIB_PREFIX}" \
            -Dselinux=disabled -Dxattr=false -Dlibelf=disabled
        ninja -C _build -j"$(nproc)"
        ninja -C _build install
    fi
    echo "GLib ${GLIB_VERSION} installed at ${GLIB_PREFIX}"
else
    echo "GLib >= 2.70 already available, skipping."
fi

# Step 3: Install webkit2gtk-4.1, javascriptcoregtk-4.1, libsoup-3.0 from Ubuntu 22.04 packages
echo "[3/4] Installing WebKitGTK 4.1 + libsoup3 from Ubuntu 22.04 packages..."

if [ ! -f "${WEBKIT_JAMMY_PREFIX}/usr/lib/x86_64-linux-gnu/pkgconfig/webkit2gtk-4.1.pc" ]; then
    # Add jammy repo temporarily (will be cleaned up after download)
    cat > /etc/apt/sources.list.d/ubuntu-jammy-temp.list <<'REPO'
deb http://mirrors.aliyun.com/ubuntu jammy main universe
deb http://mirrors.aliyun.com/ubuntu jammy-updates main universe
REPO

    # Pin to low priority to avoid full system upgrade
    cat > /etc/apt/preferences.d/jammy-temp-pin <<'PIN'
Package: *
Pin: release n=jammy
Pin-Priority: 100

Package: *
Pin: release n=jammy-updates
Pin-Priority: 100
PIN

    apt-get update -qq 2>/dev/null || true

    # Download and extract packages manually to avoid dependency conflicts
    tmpdir=$(mktemp -d)
    mkdir -p "${WEBKIT_JAMMY_PREFIX}"

    cd "${tmpdir}"
    apt-get download -t jammy-updates \
        libwebkit2gtk-4.1-dev libwebkit2gtk-4.1-0 \
        libjavascriptcoregtk-4.1-dev libjavascriptcoregtk-4.1-0 \
        libsoup-3.0-dev libsoup-3.0-0 \
        libsysprof-4-dev libsysprof-4

    for deb in *.deb; do
        dpkg-deb -x "${deb}" "${WEBKIT_JAMMY_PREFIX}/"
    done

    # Clean up temporary apt sources immediately
    rm -f /etc/apt/sources.list.d/ubuntu-jammy-temp.list
    rm -f /etc/apt/preferences.d/jammy-temp-pin
    apt-get update -qq 2>/dev/null || true
else
    echo "WebKitGTK 4.1 already installed at ${WEBKIT_JAMMY_PREFIX}, skipping."
fi

# Step 4: Generate local env file (project-scoped, NOT system-wide)
echo "[4/4] Generating local environment file..."
cat > "${ENV_FILE}" <<ENV
# Vibe99 build environment for Ubuntu 20.04
# Source this file before building: source .build-env.sh
#
# All paths are isolated under /opt — no system-level changes (no ldconfig, no profile.d).
# Libraries are resolved via LD_LIBRARY_PATH at build time only.

export PKG_CONFIG_PATH="${GLIB_PREFIX}/lib/x86_64-linux-gnu/pkgconfig:${GLIB_PREFIX}/lib/pkgconfig:${WEBKIT_JAMMY_PREFIX}/usr/lib/x86_64-linux-gnu/pkgconfig\${PKG_CONFIG_PATH:+:\$PKG_CONFIG_PATH}"
export LD_LIBRARY_PATH="${GLIB_PREFIX}/lib/x86_64-linux-gnu:${GLIB_PREFIX}/lib:${WEBKIT_JAMMY_PREFIX}/usr/lib/x86_64-linux-gnu\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"
export LIBRARY_PATH="${GLIB_PREFIX}/lib/x86_64-linux-gnu:${WEBKIT_JAMMY_PREFIX}/usr/lib/x86_64-linux-gnu\${LIBRARY_PATH:+:\$LIBRARY_PATH}"
export RUSTFLAGS="-L ${WEBKIT_JAMMY_PREFIX}/usr/lib/x86_64-linux-gnu -L ${GLIB_PREFIX}/lib/x86_64-linux-gnu\${RUSTFLAGS:+ \$RUSTFLAGS}"
ENV

echo ""
echo "=== Setup complete! ==="
echo ""
echo "To build Vibe99, run:"
echo "  source ${ENV_FILE}"
echo "  npm install"
echo "  npm run tauri:build"
echo ""
echo "Verification:"
# Source the env to verify
source "${ENV_FILE}"
echo "  glib-2.0:              $(pkg-config --modversion glib-2.0)"
echo "  javascriptcoregtk-4.1: $(pkg-config --modversion javascriptcoregtk-4.1)"
echo "  libsoup-3.0:           $(pkg-config --modversion libsoup-3.0)"
echo "  webkit2gtk-4.1:        $(pkg-config --modversion webkit2gtk-4.1)"
