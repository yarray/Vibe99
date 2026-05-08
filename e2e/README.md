# Vibe99 E2E Testing with Docker

This directory contains end-to-end tests for Vibe99, powered by [WebdriverIO](https://webdriver.io/) and [`tauri-driver`](https://github.com/tauri-apps/tauri/tree/dev/tooling/webdriver).

The `Dockerfile.e2e` builds a **build-environment-only** image (`vibe99-builder:slim`) that provides Rust, Node.js, webkit2gtk, Xvfb, and tauri-driver — but no Vibe99 source or pre-compiled binary. Every test run mounts the latest source code, compiles it, and runs e2e against the fresh build.

## Quick Start

### 1. Build the Docker image (one-time)

From the **project root**:

```bash
docker build -f e2e/Dockerfile.e2e -t vibe99-builder:slim .
```

The image contains Ubuntu 22.04, Node.js 22, Rust stable, `tauri-driver`, and all system dependencies — no Vibe99 code.

### 2. Run e2e tests (mount + compile + test)

Mount your local source, compile, and run tests in a single step:

```bash
docker run --rm --privileged \
  -v $(pwd):/app/Vibe99 \
  vibe99-builder:slim \
  bash -c "npm ci && npm run tauri:build && npm run test:e2e"
```

> **Note:** `--privileged` is required because WebKitWebDriver needs access to file descriptor operations that Docker's default seccomp profile blocks.

The WDIO config (`wdio.conf.js`) automatically starts Xvfb (virtual display) and `tauri-driver` before running specs.

#### Faster rebuilds with Cargo cache

Persist the Cargo target directory with a named volume to speed up incremental builds:

```bash
docker run --rm --privileged \
  -v $(pwd):/app/Vibe99 \
  -v vibe99-cargo-target:/app/Vibe99/src-tauri/target \
  vibe99-builder:slim \
  bash -c "npm ci && npm run tauri:build && npm run test:e2e"
```

#### Run a specific test

```bash
docker run --rm --privileged \
  -v $(pwd):/app/Vibe99 \
  -v vibe99-cargo-target:/app/Vibe99/src-tauri/target \
  vibe99-builder:slim \
  bash -c "npm ci && npm run tauri:build && npm run test:e2e -- layout"
```

See `npm run test:e2e -- --help` for all options (`--spec`, `--grep`, `-v`).

## Key principle

The image is **only a compilation environment** — it does not contain test code or Vibe99 binaries. Every run fetches the latest source (via mount), recompiles, and tests against the fresh build. This ensures tests always run against the current code, not stale pre-compiled artifacts.

## How it works

| Component | Role |
|-----------|------|
| `Dockerfile.e2e` | Build-environment-only image: system deps + Rust + Node + tauri-driver |
| `wdio.conf.js` | WebdriverIO config; auto-starts Xvfb and tauri-driver |
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
