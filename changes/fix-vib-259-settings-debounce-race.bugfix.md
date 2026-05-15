修复 `resetSettings()` E2E helper 中的竞态条件：未 await `settings_load()` 的 Promise，导致前一个测试的 debounce 值残留到下一个测试，引发 `Expected: 30, Received: 3` 断言失败。
