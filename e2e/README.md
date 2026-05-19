# Vibe99 E2E Testing with Docker

This directory contains end-to-end tests for Vibe99, powered by [WebdriverIO](https://webdriver.io/) and [`tauri-driver`](https://github.com/tauri-apps/tauri/tree/dev/tooling/webdriver).

The `Dockerfile.e2e` builds an image that pre-compiles Vibe99. The pre-compiled artifacts populate the Cargo target directory — this is not for testing directly, but to serve as a **warm baseline** so subsequent incremental builds are fast.

## Quick Start

### 1. Build the Docker image

From the **project root**:

```bash
docker buildx build -f e2e/Dockerfile.e2e -t vibe99-builder .
```

The image (~2–3 GB) contains Ubuntu 22.04, Node.js 22, Rust stable, `tauri-driver`, pre-compiled Cargo artifacts, and all e2e dependencies.

### 2. Run e2e tests

The entrypoint auto-syncs local source from `/mnt/source` (preserving the pre-compiled `target/` cache):

```bash
docker run --rm --privileged -v $PWD:/mnt/source:ro vibe99-builder npm run test:e2e
```

> **Note:** `--privileged` is required because WebKitWebDriver needs access to file descriptor operations that Docker's default seccomp profile blocks.

The WDIO config (`wdio.conf.js`) automatically builds the binary if needed, starts Xvfb (virtual display), and launches `tauri-driver` before running specs.

#### Run a specific test

```bash
docker run --rm --privileged -v $PWD:/mnt/source:ro vibe99-builder npm run test:e2e -- layout
```

See `npm run test:e2e -- --help` for all options (`--spec`, `--grep`, `-v`).

## Key principle

The pre-compiled Cargo artifacts in the image are **only** for warming the incremental-build cache.

1. Image is built once with a full compile — this warms the Cargo cache
2. Each test run mounts local source to `/mnt/source`, the entrypoint rsyncs it in (preserving `target/`), then runs the given command
3. Only changed files are recompiled — incremental builds are fast

### How it works

The entrypoint (`docker-entrypoint.sh`) checks for `/mnt/source` — if present, it rsyncs contents into `/app/Vibe99` while excluding `src-tauri/target/` and `node_modules/`. Then it executes the provided command. This keeps the image's pre-compiled cache intact across runs.

> **Important:** Do **not** mount local source directly to `/app/Vibe99` — that overwrites the pre-compiled `target/` and forces a full rebuild every time.

## How it works

| Component | Role |
|-----------|------|
| `Dockerfile.e2e` | Builder image: deps + pre-compiled Cargo artifacts for incremental builds |
| `wdio.conf.js` | WebdriverIO config; auto-builds binary, starts Xvfb and tauri-driver |
| `scripts/run-e2e.mjs` | CLI wrapper with spec/grep/verbosity shortcuts |
| `tests/*.spec.js` | Test specs |

On Linux, `wdio.conf.js` spins up an Xvfb display (`:98`) and launches `tauri-driver` (the WebDriver bridge) before any tests execute. Both are cleaned up on exit.

## Running locally (without Docker)

If you already have the build environment on your machine:

```bash
npm run test:e2e
```

The WDIO config handles building the binary automatically (Linux needs `xvfb`).

Prerequisites for local runs on Linux: `libwebkit2gtk-4.1-dev`, `webkit2gtk-driver`, `xvfb`, `tauri-driver` (`cargo install tauri-driver`).

## Windows

Windows e2e tests use `msedgedriver.exe` (bundled in `e2e/bin/`) instead of Xvfb. No Docker needed — just run `npm run test:e2e` natively.
