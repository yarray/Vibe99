Added multi-strategy alert architecture supporting pluggable pane alert renderers.

- `PaneAlertStrategy` now carries `id`, `enabled`, and `destroy()`.
- New `PaneAlertRegistry` manages multiple strategies with error isolation.
- New `ScriptHookAlert` strategy executes `bridge.executeAlertScript()` on alert, with per-pane debounce.
- `PaneRenderer` tracks alerted state independently so `Ctrl+\`` cycling works regardless of which visual strategies are active.
- Settings gains `alertStrategies` array for per-strategy enable/disable persistence.
- Bridge gains optional `executeAlertScript` IPC hook.
