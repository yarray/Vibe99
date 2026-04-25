#!/usr/bin/env node

/**
 * Bump the project version across all config files.
 *
 * Usage:
 *   node scripts/bump-version.mjs <version>
 *   node scripts/bump-version.mjs 0.6.0
 *
 * Updates:
 *   - package.json        → "version"
 *   - src-tauri/tauri.conf.json → "version"
 *   - src-tauri/Cargo.toml      → version = "..."
 *
 * After running this script, also run:
 *   npm install --package-lock-only
 *   cd src-tauri && cargo generate-lockfile
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const files = [
  {
    path: resolve(root, 'package.json'),
    pattern: /"version"\s*:\s*"[^"]+"/,
    replacement: (v) => `"version": "${v}"`,
  },
  {
    path: resolve(root, 'src-tauri', 'tauri.conf.json'),
    pattern: /"version"\s*:\s*"[^"]+"/,
    replacement: (v) => `"version": "${v}"`,
  },
  {
    path: resolve(root, 'src-tauri', 'Cargo.toml'),
    pattern: /^version\s*=\s*"[^"]+"/m,
    replacement: (v) => `version = "${v}"`,
  },
];

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error('Usage: node scripts/bump-version.mjs <semver>');
  console.error('Example: node scripts/bump-version.mjs 0.6.0');
  process.exit(1);
}

for (const { path, pattern, replacement } of files) {
  const content = readFileSync(path, 'utf8');

  if (!pattern.test(content)) {
    console.error(`Could not find version in ${path}`);
    process.exit(1);
  }

  const updated = content.replace(pattern, replacement(version));
  writeFileSync(path, updated);
  console.log(`  Updated ${path}`);
}

console.log(`\nVersion bumped to ${version}.`);
console.log('Remember to run:');
console.log('  npm install --package-lock-only');
console.log('  cd src-tauri && cargo generate-lockfile');
