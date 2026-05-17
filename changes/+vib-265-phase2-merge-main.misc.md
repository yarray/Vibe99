Merge `main` branch into `autoproj/phase2-domain-refactor` branch to resolve merge conflicts:

- **E2E test fixes from main:**
  - VIB-273: Fix handling of non-numeric debounce input
  - VIB-274: Improve Dockerfile.e2e with COPY instead of git clone
  - VIB-264: Fix settings_save await in resetSettings

- **Resolved merge conflicts:**
  - `CHANGELOG.md`: Took main's version with consolidated entries
  - `e2e/helpers/settings-helpers.js`: Merged async error handling from main
  - `e2e/tests/settings.spec.js`: Merged breathing intensity test updates

The phase2 branch is now up-to-date with main and ready for E2E testing.
