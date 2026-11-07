/**
 * Shell profile cache sync.
 *
 * The renderer keeps a merged copy of the shell profiles (settings entries plus
 * auto-detected shells) for the "Change Profile" menu and the profile pickers.
 * Profile writes made through the UI go through the bridge and update that copy
 * from the response, but the `vibe99ctl profile create/update/delete` commands
 * write straight to settings.json from the Rust side. Without a signal, the
 * menu would keep showing the old list until the next restart.
 *
 * @module shell-profile-sync
 */

/** Emitted by the Rust CLI server after it writes a profile. */
export const SHELL_PROFILES_CHANGED_EVENT = 'vibe99:shell-profiles-changed';

export interface ShellProfileSyncDeps {
  listen: <T = unknown>(event: string, handler: (payload: T) => void) => () => void;
  reload: () => Promise<void> | void;
}

/**
 * Subscribe the renderer's profile cache to CLI-side profile writes.
 * Returns the unsubscribe function.
 */
export function initShellProfileSync({ listen, reload }: ShellProfileSyncDeps): () => void {
  return listen(SHELL_PROFILES_CHANGED_EVENT, () => {
    void reload();
  });
}
