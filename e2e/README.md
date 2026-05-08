# Vibe99 E2E Testing with Docker

This directory contains end-to-end tests for Vibe99, powered by [WebdriverIO](https://webdriver.io/) and [`tauri-driver`](https://github.com/tauri-apps/tauri/tree/dev/tooling/webdriver).

The `Dockerfile.e2e` builds a self-contained image that clones and pre-compiles Vibe99. The pre-compiled binary and Cargo build cache serve as a warm baseline — subsequent `git fetch` + incremental compile is much faster than building from scratch.

## Quick Start

### 1. Build the Docker image

From the **project root**:

```bash
docker build -f e2e/Dockerfile.e2e -t vibe99-builder .
```

The image (~2–3 GB) contains Ubuntu 22.04, Node.js 22, Rust stable, `tauri-driver`, a pre-built Vibe99 binary, and all e2e dependencies.

### 2. Run e2e tests against latest code

The image has a pre-compiled binary as a baseline. To test against the **latest** code on a branch, `git fetch` inside the container, rebuild incrementally, and run tests:

```bash
docker run --rm --privileged vibe99-builder \
  bash -c "git fetch origin && git checkout <branch> && npm ci && npm run tauri:build && npm run test:e2e"
```

This leverages the pre-compiled Cargo target cache — only changed files are recompiled, making the process fast.

> **Note:** `--privileged` is required because WebKitWebDriver needs access to file descriptor operations that Docker's default seccomp profile blocks.

The WDIO config (`wdio.conf.js`) automatically starts Xvfb (virtual display) and `tauri-driver` before running specs.

#### Run against the pre-built binary (quick smoke test)

If you just want to verify the image itself works without pulling new code:

```bash
docker run --rm --privileged vibe99-builder \
  bash -c "npm run test:e2e"
```

#### Run a specific test

```bash
docker run --rm --privileged vibe99-builder \
  bash -c "git fetch origin && git checkout <branch> && npm ci && npm run tauri:build && npm run test:e2e -- layout"
```

See `npm run test:e2e -- --help` for all options (`--spec`, `--grep`, `-v`).

### 3. Persist Cargo cache across runs

For faster repeated runs, keep the Cargo target directory in a named volume:

```bash
docker run --rm --privileged \
  -v vibe99-cargo-target:/app/Vibe99/src-tauri/target \
  vibe99-builder \
  bash -c "git fetch origin && git checkout <branch> && npm ci && npm run tauri:build && npm run test:e2e"
```

## Key principle

The image provides a **pre-compiled baseline** for fast incremental builds. The correct workflow is:

1. Image is built once with a full compile — this warms the Cargo cache
2. Each test run does `git fetch` to get the latest code, then **incremental compiles** (only changed Rust/JS files)
3. Tests always run against the latest code

Do **not** mount local source via `-v` — that would bypass the pre-compiled Cargo cache and force a full rebuild every time.

## How it works

| Component | Role |
|-----------|------|
| `Dockerfile.e2e` | Self-contained builder image: deps + pre-built binary + Cargo cache + e2e deps |
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
