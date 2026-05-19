# Vibe99 E2E Testing with Docker

Powered by [WebdriverIO](https://webdriver.io/) and [`tauri-driver`](https://github.com/tauri-apps/tauri/tree/dev/tooling/webdriver).

## Quick Start

### 1. Build the Docker image

From the **project root**:

```bash
docker buildx build -f e2e/Dockerfile.e2e -t vibe99-builder .
```

### 2. Run e2e tests

```bash
docker run --rm --privileged -v $PWD:/mnt/source:ro vibe99-builder
```

> **Note:** `--privileged` is required because WebKitWebDriver needs access to file descriptor operations that Docker's default seccomp profile blocks.

#### Run a specific test

```bash
docker run --rm --privileged -v $PWD:/mnt/source:ro vibe99-builder layout
```

See `npm run test:e2e -- --help` for all options (`--spec`, `--grep`, `-v`).

### 3. Running locally (without Docker)

```bash
npm run test:e2e
```

Prerequisites: `libwebkit2gtk-4.1-dev`, `webkit2gtk-driver`, `xvfb`, `tauri-driver` (`cargo install tauri-driver`).

## Windows

Windows e2e tests use `msedgedriver.exe` (bundled in `e2e/bin/`) instead of Xvfb. No Docker needed — just run `npm run test:e2e` natively.

## How it works

The `Dockerfile.e2e` builds an image that pre-compiles Vibe99. The pre-compiled artifacts populate the Cargo target directory — this is not for testing directly, but to serve as a **warm baseline** so subsequent incremental builds are fast.

| Component | Role |
|-----------|------|
| `Dockerfile.e2e` | Builder image: deps + pre-compiled Cargo artifacts for incremental builds |
| `docker-entrypoint.sh` | Rsyncs `/mnt/source` into workspace (excluding `target/` and `node_modules/`), then runs `npm run test:e2e` |
| `wdio.conf.js` | WebdriverIO config; auto-builds binary, starts Xvfb and tauri-driver |
| `scripts/run-e2e.mjs` | CLI wrapper with spec/grep/verbosity shortcuts |
| `tests/*.spec.js` | Test specs |

On Linux, `wdio.conf.js` spins up an Xvfb display (`:98`) and launches `tauri-driver` (the WebDriver bridge) before any tests execute. Both are cleaned up on exit.

### Why mount to /mnt/source?

The image contains a pre-compiled `src-tauri/target/` for incremental builds. Mounting local source directly to `/app/Vibe99` would overwrite it, forcing a full rebuild. The entrypoint rsyncs from `/mnt/source` while excluding `src-tauri/target/` and `node_modules/`, so the pre-compiled cache stays intact and only changed files are recompiled.
