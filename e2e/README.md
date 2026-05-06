# Vibe99 E2E Testing with Docker

This directory contains end-to-end tests for Vibe99, powered by [WebdriverIO](https://webdriver.io/) and [`tauri-driver`](https://github.com/tauri-apps/tauri/tree/dev/tooling/webdriver).

The `Dockerfile.e2e` builds a self-contained image that clones and pre-compiles Vibe99, so you can run e2e tests immediately without any local toolchain setup.

## Quick Start

### 1. Build the Docker image

From the **project root**:

```bash
docker build -f e2e/Dockerfile.e2e -t vibe99-builder .
```

The image (~2–3 GB) contains Ubuntu 22.04, Node.js 22, Rust stable, `tauri-driver`, a pre-built Vibe99 binary, and all e2e dependencies.

### 2. Run e2e tests

The image already has a compiled binary. Start a container and run the test suite:

```bash
docker run --rm --privileged vibe99-builder \
  bash -c "npm run test:e2e"
```

> **Note:** `--privileged` is required because WebKitWebDriver needs access to file descriptor operations that Docker's default seccomp profile blocks.

The WDIO config (`wdio.conf.js`) automatically starts Xvfb (virtual display) and `tauri-driver` before running specs.

#### Run a specific test

```bash
docker run --rm --privileged vibe99-builder \
  bash -c "npm run test:e2e -- layout"
```

See `npm run test:e2e -- --help` for all options (`--spec`, `--grep`, `-v`).

### 3. Incremental compilation with mounted source

To build from your local source (e.g. after making changes), mount it over the image's built-in repo and recompile:

```bash
docker run --rm --privileged -v $(pwd):/app/Vibe99 vibe99-builder \
  bash -c "npm ci && npm run tauri:build"
```

For faster incremental builds, persist the Cargo target directory with a named volume:

```bash
docker run --rm --privileged \
  -v $(pwd):/app/Vibe99 \
  -v vibe99-cargo-target:/app/Vibe99/src-tauri/target \
  vibe99-builder \
  bash -c "npm ci && npm run tauri:build"
```

Then run e2e against the freshly compiled binary:

```bash
docker run --rm --privileged -v $(pwd):/app/Vibe99 vibe99-builder \
  bash -c "cd e2e && npm ci && cd .. && npm run test:e2e"
```

## How it works

| Component | Role |
|-----------|------|
| `Dockerfile.e2e` | Self-contained builder image: deps + pre-built binary + e2e deps |
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

Prerequisites for local runs on Linux: `libwebkit2gtk-4.1-dev`, `webkit2gtk-driver`, `xvfb`, `tauri-driver` (`cargo install tauri-driver`).

## Windows

Windows e2e tests use `msedgedriver.exe` (bundled in `e2e/bin/`) instead of Xvfb. No Docker needed — just run `npm run test:e2e` natively.
