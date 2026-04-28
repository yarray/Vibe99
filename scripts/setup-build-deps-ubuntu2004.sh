#!/usr/bin/env bash
# Setup build dependencies for Vibe99 on Ubuntu 20.04
#
# Tauri v2 requires webkit2gtk-4.1, libsoup-3.0, and glib >= 2.70,
# which are not available in Ubuntu 20.04's default repos.
# This script installs them from source (glib) and Ubuntu 22.04 packages (webkit/soup).
#
# Usage: sudo bash scripts/setup-build-deps-ubuntu2004.sh

set -euo pipefail

if [ "$(lsb_release -rs 2>/dev/null || echo "unknown")" != "20.04" ]; then
    echo "This script is intended for Ubuntu 20.04 only."
    echo "For Ubuntu 22.04+, install system deps directly:"
    echo "  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev"
    exit 0
fi

echo "=== Vibe99 Build Dependency Setup for Ubuntu 20.04 ==="

# Step 1: Install build tools and base dependencies
echo "[1/5] Installing build tools..."
apt-get update -qq
apt-get install -y --no-install-recommends \
    build-essential curl wget file pkg-config \
    meson ninja-build libffi-dev zlib1g-dev libmount-dev libpcre3-dev \
    libgtk-3-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
    libxdo-dev libnghttp2-dev

# Step 2: Build and install GLib 2.72 from source
echo "[2/5] Building GLib 2.72.4 from source..."
if ! pkg-config --atleast-version=2.70 glib-2.0 2>/dev/null; then
    GLIB_VERSION="2.72.4"
    GLIB_PREFIX="/opt/glib-2.72"
    
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
        
        echo "${GLIB_PREFIX}/lib/x86_64-linux-gnu" > /etc/ld.so.conf.d/glib-2.72.conf
        ldconfig
    fi
    echo "GLib ${GLIB_VERSION} installed at ${GLIB_PREFIX}"
else
    echo "GLib >= 2.70 already installed, skipping."
fi

# Step 3: Install webkit2gtk-4.1, javascriptcoregtk-4.1, libsoup-3.0 from Ubuntu 22.04 packages
echo "[3/5] Installing WebKitGTK 4.1 + libsoup3 from Ubuntu 22.04 packages..."
WEBKIT_JAMMY_PREFIX="/opt/webkit-jammy"

if [ ! -f "${WEBKIT_JAMMY_PREFIX}/usr/lib/x86_64-linux-gnu/pkgconfig/webkit2gtk-4.1.pc" ]; then
    # Add jammy repo temporarily
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
    
    # Fix the extracted paths: they go to usr/, move to prefix
    if [ -d "${WEBKIT_JAMMY_PREFIX}/usr" ]; then
        # Already at the right place
        true
    fi
    
    # Configure ldconfig
    echo "${WEBKIT_JAMMY_PREFIX}/usr/lib/x86_64-linux-gnu" > /etc/ld.so.conf.d/webkit-jammy.conf
    ldconfig
    
    # Clean up
    rm -f /etc/apt/sources.list.d/ubuntu-jammy-temp.list
    rm -f /etc/apt/preferences.d/jammy-temp-pin
    apt-get update -qq 2>/dev/null || true
else
    echo "WebKitGTK 4.1 already installed at ${WEBKIT_JAMMY_PREFIX}, skipping."
fi

# Step 4: Set up environment
echo "[4/5] Setting up environment..."
ENV_FILE="/etc/profile.d/vibe99-build-env.sh"
cat > "${ENV_FILE}" <<'ENV'
# Vibe99 build environment for Ubuntu 20.04
export PKG_CONFIG_PATH="/opt/glib-2.72/lib/x86_64-linux-gnu/pkgconfig:/opt/glib-2.72/lib/pkgconfig:/opt/webkit-jammy/usr/lib/x86_64-linux-gnu/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
export LD_LIBRARY_PATH="/opt/glib-2.72/lib/x86_64-linux-gnu:/opt/glib-2.72/lib:/opt/webkit-jammy/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export LIBRARY_PATH="/opt/glib-2.72/lib/x86_64-linux-gnu:/opt/webkit-jammy/usr/lib/x86_64-linux-gnu${LIBRARY_PATH:+:$LIBRARY_PATH}"
export RUSTFLAGS="-L /opt/webkit-jammy/usr/lib/x86_64-linux-gnu -L /opt/glib-2.72/lib/x86_64-linux-gnu${RUSTFLAGS:+ $RUSTFLAGS}"
ENV
chmod +x "${ENV_FILE}"

echo "Environment variables written to ${ENV_FILE}"
echo "Run 'source ${ENV_FILE}' or start a new shell to apply."

# Step 5: Verify
echo "[5/5] Verifying..."
source "${ENV_FILE}"

echo "  glib-2.0:              $(pkg-config --modversion glib-2.0)"
echo "  javascriptcoregtk-4.1: $(pkg-config --modversion javascriptcoregtk-4.1)"
echo "  libsoup-3.0:           $(pkg-config --modversion libsoup-3.0)"
echo "  webkit2gtk-4.1:        $(pkg-config --modversion webkit2gtk-4.1)"
echo ""
echo "=== Setup complete! ==="
echo "To build Vibe99, run:"
echo "  source ${ENV_FILE}"
echo "  npm install"
echo "  npm run tauri:build"
