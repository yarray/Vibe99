Consolidate GIF recording scripts:

- Move `e2e/record-gif.sh` to `e2e/bin/record-gif.sh` (alongside other e2e helper scripts)
- Remove unused `e2e/record-scripts/` directory (stale code from earlier approach)
- Update documentation references from `./tests/record-*.spec.js` to `./recordings/record-*.spec.js`
