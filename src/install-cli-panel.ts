/**
 * "Install CLI" info panel.
 *
 * Explains how to install and use `vibe99ctl` on every platform Vibe99
 * ships to. The section of the running system is pinned to the top and
 * marked, every command comes with a one-click copy button.
 *
 * The panel never runs anything: it only shows the commands, so the user
 * decides when and where they are executed.
 */

import { icon, setIcon } from './icons';
import {
  INSTALL_CLI_SECTIONS,
  isCurrentInstallCliSection,
  orderInstallCliSections,
  type InstallCliCommand,
  type InstallCliSection,
} from './install-cli-content';

import './install-cli-panel.css';

/** Dependencies injected into openInstallCliPanel. */
export interface InstallCliPanelDeps {
  /** Runtime platform of the app ('win32' | 'darwin' | 'linux'). */
  platform: string;
  /** Write text to the system clipboard. */
  copyText: (text: string) => Promise<void>;
  /** Register the modal with the modal stack (so Esc closes it). */
  registerModal: (close: () => void) => void;
  /** Remove the modal from the modal stack. */
  unregisterModal: (close: () => void) => void;
}

/** Overlay element of the currently open panel. */
interface InstallCliPanelState {
  overlay: HTMLDivElement;
}

const INTRO =
  'vibe99ctl is the CLI that drives a running Vibe99 — it ships with every ' +
  'install. This panel shows how to put it on your PATH for the platform you use.';

let panelState: InstallCliPanelState | null = null;

/**
 * Open the panel. No-op when it is already open.
 */
export function openInstallCliPanel(deps: InstallCliPanelDeps): void {
  if (panelState) return;

  const overlay = document.createElement('div');
  overlay.className = 'install-cli-overlay';

  const modal = document.createElement('div');
  modal.className = 'settings-modal install-cli-modal';

  const header = document.createElement('div');
  header.className = 'settings-modal-header';
  const headerTitle = document.createElement('span');
  headerTitle.textContent = 'Install vibe99ctl';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'settings-modal-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML = icon('x', 16);
  header.append(headerTitle, closeBtn);

  const body = document.createElement('div');
  body.className = 'settings-modal-body install-cli-body';

  const intro = document.createElement('p');
  intro.className = 'install-cli-intro';
  intro.textContent = INTRO;
  body.append(intro);

  const sections = orderInstallCliSections(INSTALL_CLI_SECTIONS, deps.platform);
  for (const section of sections) {
    body.append(renderSection(section, deps));
  }

  const footer = document.createElement('div');
  footer.className = 'settings-modal-footer';
  const footerBtn = document.createElement('button');
  footerBtn.type = 'button';
  footerBtn.className = 'settings-modal-btn primary close-btn';
  footerBtn.textContent = 'Close';
  footer.append(footerBtn);

  modal.append(header, body, footer);
  overlay.append(modal);

  const close = (): void => {
    if (!panelState) return;
    panelState.overlay.remove();
    panelState = null;
    deps.unregisterModal(close);
  };

  closeBtn.addEventListener('click', close);
  footerBtn.addEventListener('click', close);
  overlay.addEventListener('click', (event: MouseEvent) => {
    if (event.target === overlay) close();
  });

  document.body.append(overlay);
  panelState = { overlay };

  deps.registerModal(close);
}

/**
 * Render one platform block: heading, notes and copyable commands.
 */
function renderSection(
  section: InstallCliSection,
  deps: InstallCliPanelDeps,
): HTMLElement {
  const group = document.createElement('section');
  group.className = 'install-cli-group';
  group.dataset.groupId = section.id;

  const isCurrent = isCurrentInstallCliSection(section, deps.platform);
  if (isCurrent) group.classList.add('is-current');

  const groupHeader = document.createElement('div');
  groupHeader.className = 'install-cli-group-header';

  const title = document.createElement('span');
  title.className = 'install-cli-group-title';
  title.textContent = section.title;
  groupHeader.append(title);

  if (isCurrent) {
    const badge = document.createElement('span');
    badge.className = 'install-cli-group-badge';
    badge.textContent = 'Your system';
    groupHeader.append(badge);
  }

  group.append(groupHeader);

  for (const note of section.notes) {
    const paragraph = document.createElement('p');
    paragraph.className = 'install-cli-note';
    paragraph.textContent = note;
    group.append(paragraph);
  }

  for (const command of section.commands) {
    group.append(renderCommand(command, deps));
  }

  return group;
}

/**
 * Render one command: its label, the command itself and a copy button.
 */
function renderCommand(
  command: InstallCliCommand,
  deps: InstallCliPanelDeps,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'install-cli-command';

  const label = document.createElement('div');
  label.className = 'install-cli-command-label';
  label.textContent = command.label;

  const line = document.createElement('div');
  line.className = 'install-cli-command-line';

  const code = document.createElement('code');
  code.className = 'install-cli-code';
  code.textContent = command.command;
  line.append(code);

  if (command.shell) {
    const shell = document.createElement('span');
    shell.className = 'install-cli-shell';
    shell.textContent = command.shell;
    line.append(shell);
  }

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'install-cli-copy-btn';
  copyBtn.setAttribute('aria-label', `Copy command: ${command.label}`);
  copyBtn.title = 'Copy command';
  setIcon(copyBtn, 'copy', 14);
  copyBtn.addEventListener('click', () => {
    void copyCommand(copyBtn, code.textContent ?? '', deps);
  });

  line.append(copyBtn);
  row.append(label, line);
  return row;
}

/**
 * Copy a command to the clipboard and briefly confirm it on the button.
 */
async function copyCommand(
  button: HTMLButtonElement,
  text: string,
  deps: InstallCliPanelDeps,
): Promise<void> {
  try {
    await deps.copyText(text);
    button.classList.add('is-copied');
    button.title = 'Copied';
    setIcon(button, 'check', 14);
    window.setTimeout(() => {
      button.classList.remove('is-copied');
      button.title = 'Copy command';
      setIcon(button, 'copy', 14);
    }, 1600);
  } catch {
    button.title = 'Copy failed';
  }
}
