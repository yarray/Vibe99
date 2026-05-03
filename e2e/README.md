# Vibe99 E2E Testing with Docker

This directory contains end-to-end tests for Vibe99, powered by [WebdriverIO](https://webdriver.io/) and [`tauri-driver`](https://github.com/tauri-apps/tauri/tree/dev/tooling/webdriver).

The `Dockerfile.e2e` provides a self-contained Linux build environment with all system dependencies pre-installed, so you can compile and run e2e tests on any machine with Docker — no local Rust/Node.js/toolchain setup required.

## Quick Start

### 1. Build the Docker image

From the **project root**:

```bash
docker build -f e2e/Dockerfile.e2e -t vibe99-builder .
```

This creates an image (~2 GB) with Ubuntu 22.04, Node.js 22, Rust stable, `tauri-driver`, and all Tauri/webkit system libraries.

### 2. Compile Vibe99 inside the container

Mount the project source and run the Tauri build:

```bash
docker run --rm -v $(pwd):/app vibe99-builder \
  bash -c "npm ci && npm run tauri:build"
```

The compiled binary ends up at `src-tauri/target/release/vibe99` on the host (the mount is live).

### 3. Run e2e tests

Mount the source and invoke the test runner. The container needs a virtual display (Xvfb) since Tauri is a GUI app:

```bash
docker run --rm -v $(pwd):/app vibe99-builder \
  bash -c "cd /app/e2e && npm ci && cd /app && npm run test:e2e"
```

Under the hood, the WDIO config (`wdio.conf.js`) automatically starts Xvfb and `tauri-driver` before running specs.

#### Run a specific test

```bash
docker run --rm -v $(pwd):/app vibe99-builder \
  bash -c "cd /app/e2e && npm ci && cd /app && npm run test:e2e -- layout"
```

See `npm run test:e2e -- --help` for all options (`--spec`, `--grep`, `-v`).

## How it works

| Component | Role |
|-----------|------|
| `Dockerfile.e2e` | Builder image with all compile + test dependencies |
| `wdio.conf.js` | WebdriverIO config; auto-starts Xvfb and tauri-driver |
| `run-e2e.mjs` | CLI wrapper with spec/grep/verbosity shortcuts |
| `tests/*.spec.js` | Test specs |

On Linux, `wdio.conf.js` spins up an Xvfb display (`:98`) and launches `tauri-driver` (the WebDriver bridge) before any tests execute. Both are cleaned up on exit.

## Running locally (without Docker)

If you already have the build environment on your machine:

```bash
# Build
npm ci && npm run tauri:build

# Run e2e (Linux needs xvfb — the config handles it automatically)
npm run test:e2e
```

Prerequisites for local runs on Linux: `libwebkit2gtk-4.1-dev`, `xvfb`, `tauri-driver` (`cargo install tauri-driver`).

## Windows

Windows e2e tests use `msedgedriver.exe` (bundled in `e2e/bin/`) instead of Xvfb. No Docker needed — just run `npm run test:e2e` natively.
