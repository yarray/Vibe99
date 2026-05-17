Fix session-persistence E2E test by disabling auto-save during test saves. The previous flush() approach was causing additional saves that overwrote the test's explicit layout data.
