# Vibe99 E2E Testing with Docker

This directory contains end-to-end tests for Vibe99, powered by [WebdriverIO](https://webdriver.io/) and [`tauri-driver`](https://github.com/tauri-apps/tauri/tree/dev/tooling/webdriver).

The `Dockerfile.e2e` builds an image that pre-compiles Vibe99. The pre-compiled artifacts populate the Cargo target directory — this is not for testing directly, but to serve as a **warm baseline** so subsequent incremental builds (after `git fetch`) are fast.

## Quick Start

### 1. Build the Docker image

From the **project root**:

```bash
docker buildx build -f e2e/Dockerfile.e2e -t vibe99-builder .
```

The image (~2–3 GB) contains Ubuntu 22.04, Node.js 22, Rust stable, `tauri-driver`, pre-compiled Cargo artifacts, and all e2e dependencies.

### 2. Run e2e tests

Fetch the latest code inside the container and run the test suite (`npm run test:e2e` handles building automatically):

```bash
docker run --rm --privileged vibe99-builder \
  bash -c "git fetch origin && git checkout <branch> && npm run test:e2e"
```

> **Note:** `--privileged` is required because WebKitWebDriver needs access to file descriptor operations that Docker's default seccomp profile blocks.

The WDIO config (`wdio.conf.js`) automatically builds the binary if needed, starts Xvfb (virtual display), and launches `tauri-driver` before running specs.

#### Quick smoke test

Fetch latest code and run only the smoke spec:

```bash
docker run --rm --privileged vibe99-builder \
  bash -c "git fetch origin && git checkout <branch> && npm run test:e2e -- smoke"
```

#### Run a specific test

```bash
docker run --rm --privileged vibe99-builder \
  bash -c "git fetch origin && git checkout <branch> && npm run test:e2e -- layout"
```

See `npm run test:e2e -- --help` for all options (`--spec`, `--grep`, `-v`).

## Key principle

The pre-compiled Cargo artifacts in the image are **only** for warming the incremental-build cache.

1. Image is built once with a full compile — this warms the Cargo cache
2. Each test run does `git fetch` to get the latest code, then runs `npm run test:e2e` (which handles building)
3. Only changed files are recompiled — incremental builds are fast

Do **not** mount local source via `-v` — that bypasses the warm Cargo cache and forces a full rebuild every time.

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
