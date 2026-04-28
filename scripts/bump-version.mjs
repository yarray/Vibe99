#!/usr/bin/env node

/**
 * Bump the project version across all config files.
 *
 * Usage:
 *   node scripts/bump-version.mjs <version>
 *   node scripts/bump-version.mjs 0.9.0
 *
 * Updates:
 *   - package.json                → "version"
 *   - src-tauri/tauri.conf.json   → "version"
 *   - src-tauri/Cargo.toml        → version = "..."
 *   - package-lock.json           → via npm install --package-lock-only
 *   - src-tauri/Cargo.lock        → via cargo generate-lockfile
 *
 * Requires a clean git working tree. If dirty, prompts to commit first.
 * After bumping, auto-commits all changes.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function git(...args) {
  const cmd = args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(' ');
  return execSync(`git ${cmd}`, { cwd: root, encoding: 'utf8' }).trim();
}

function isClean() {
  const status = git('status', '--porcelain');
  return status === '';
}

async function askContinue(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => rl.question(question, res));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error('Usage: node scripts/bump-version.mjs <semver>');
  console.error('Example: node scripts/bump-version.mjs 0.9.0');
  process.exit(1);
}

// Check git status
if (!isClean()) {
  console.log('Working tree is not clean. Uncommitted changes:');
  console.log(git('status', '--short'));
  const ok = await askContinue('Commit these changes before bumping? [y/N] ');
  if (!ok) {
    console.error('Aborted. Please commit or stash your changes first.');
    process.exit(1);
  }
  git('add', '-A');
  git('commit', '-m', 'chore: pre-version commit');
  console.log('Committed pending changes.\n');
}

// Bump versions
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

// Update lock files
console.log('\nUpdating lock files...');
execSync('npm install --package-lock-only', { cwd: root, stdio: 'inherit' });
execSync('cargo generate-lockfile', { cwd: resolve(root, 'src-tauri'), stdio: 'inherit' });

// Commit
const commitPaths = [
  'package.json',
  'package-lock.json',
  'src-tauri/tauri.conf.json',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
];
git('add', ...commitPaths);
git('commit', '-m', `chore: bump version to ${version}`);

console.log(`\nDone. Version bumped and committed as ${version}.`);
