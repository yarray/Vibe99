修复 `resetSettings()` 中 `settings_save` 未 await 的竞态条件，并更新呼吸灯测试以适配 VIB-260 的分段按钮 UI。解决 `Expected: 30, Received: 3` 和 `Expected: true, Received: false` 两个断言失败。
