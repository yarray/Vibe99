# Windows shortcut --layout parameter origin fix

When starting Vibe99 via a Windows shortcut with the `--layout` parameter (e.g. `vibe99.exe --layout my-layout`), the application window would open but the pane would fail to load with the error:
```
http://ipc.localhost/plugin%3Awebview%7Cinternal_toggle_devtools:1 Failed to load resource: the server responded with a status of 500 (Internal Server Error)
Uncaught (in promise) Origin header is not a valid URL
```

The root cause was in the Rust startup code where the layout ID was appended to the window URL using `url.query_pairs_mut().append_pair()`. This approach could cause URL encoding issues and invalidate the webview's origin header.

Fix: Use `url.set_query()` with proper percent-encoding of the layout ID parameter to ensure the URL is correctly formatted and the webview's origin remains valid.
