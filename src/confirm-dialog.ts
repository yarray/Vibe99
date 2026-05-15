// ---------------------------------------------------------------------------
// confirm-dialog.ts — Reusable in-page confirm dialog
// ---------------------------------------------------------------------------

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export function showConfirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'settings-modal-overlay';
    overlay.innerHTML = `
      <div class="settings-modal">
        <div class="settings-modal-header">${opts.title}</div>
        <div class="settings-modal-body" style="font-size:13px;color:rgba(255,255,255,0.8)">
          ${opts.message}
        </div>
        <div class="settings-modal-footer">
          <button class="settings-modal-btn" data-action="cancel">${opts.cancelLabel ?? 'Cancel'}</button>
          <button class="settings-modal-btn primary" data-action="confirm">${opts.confirmLabel ?? 'OK'}</button>
        </div>
      </div>`;

    function close(result: boolean): void {
      overlay.remove();
      resolve(result);
    }

    overlay.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target === overlay) { close(false); return; }
      const action = (target.closest('[data-action]') as HTMLElement | null)?.dataset.action;
      if (action === 'confirm') { close(true); }
      else if (action === 'cancel') { close(false); }
    });

    document.body.appendChild(overlay);
    overlay.querySelector<HTMLElement>('[data-action="confirm"]')?.focus();
  });
}
