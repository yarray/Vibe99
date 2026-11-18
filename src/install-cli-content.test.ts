/**
 * Install CLI panel content tests.
 *
 * The panel tells the user how to put `vibe99ctl` on the PATH. This suite
 * guards the two things that are easy to break while editing the copy: the
 * section of the running system has to come first, and every platform has to
 * keep a command the user can actually run.
 *
 * @module install-cli-content.test
 */

import { describe, expect, it } from 'vitest';
import {
  INSTALL_CLI_SECTIONS,
  isCurrentInstallCliSection,
  orderInstallCliSections,
} from './install-cli-content.js';

describe('install CLI content', () => {
  it('describes every platform Vibe99 ships to', () => {
    const ids = INSTALL_CLI_SECTIONS.map((section) => section.id);
    expect(ids).toContain('windows');
    expect(ids).toContain('linux-deb');
    expect(ids).toContain('linux-appimage');
    expect(ids).toContain('wsl');
  });

  it('gives every section at least one copyable command', () => {
    for (const section of INSTALL_CLI_SECTIONS) {
      expect(section.commands.length).toBeGreaterThan(0);
      for (const command of section.commands) {
        expect(command.command.trim().length).toBeGreaterThan(0);
        expect(command.label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('pins the section of the running system to the top', () => {
    const onWindows = orderInstallCliSections(INSTALL_CLI_SECTIONS, 'win32');
    expect(onWindows[0].id).toBe('windows');

    const onLinux = orderInstallCliSections(INSTALL_CLI_SECTIONS, 'linux');
    expect(onLinux[0].id).toBe('linux-deb');
    expect(onLinux[1].id).toBe('linux-appimage');

    // Sections that do not apply keep their written order.
    const rest = onLinux.filter((section) => !section.platforms.includes('linux'));
    expect(rest.map((section) => section.id)).toEqual(['windows', 'wsl', 'discover']);
  });

  it('keeps every section when the platform is unknown', () => {
    const onMac = orderInstallCliSections(INSTALL_CLI_SECTIONS, 'darwin');
    expect(onMac.map((section) => section.id)).toEqual(
      INSTALL_CLI_SECTIONS.map((section) => section.id),
    );
    expect(onMac.some((section) => isCurrentInstallCliSection(section, 'darwin'))).toBe(false);
  });

  it('offers a manual install path for Windows upgrades', () => {
    const windows = INSTALL_CLI_SECTIONS.find((section) => section.id === 'windows');
    expect(windows).toBeDefined();

    const commands = windows!.commands.map((command) => command.command);
    expect(commands.some((command) => command.includes('install-cli'))).toBe(true);
    expect(
      commands.some((command) => command.includes('releases/latest/download')),
    ).toBe(true);
  });

  it('explains the AppImage and the WSL route', () => {
    const appImage = INSTALL_CLI_SECTIONS.find((section) => section.id === 'linux-appimage');
    expect(appImage!.commands.some((c) => c.command.includes('--appimage-extract'))).toBe(true);
    expect(appImage!.commands.some((c) => c.command.includes('install-cli'))).toBe(true);

    const wsl = INSTALL_CLI_SECTIONS.find((section) => section.id === 'wsl');
    expect(wsl!.notes.join(' ')).toContain('interop');
    expect(wsl!.notes.join(' ')).toContain('planned');
    expect(wsl!.commands.every((c) => c.command.includes('vibe99ctl.exe'))).toBe(true);
  });

  it('points at vibe99ctl describe as the discovery entry point', () => {
    const discover = INSTALL_CLI_SECTIONS.find((section) => section.id === 'discover');
    expect(discover!.commands.some((c) => c.command === 'vibe99ctl describe')).toBe(true);
    expect(discover!.notes.join(' ')).toContain('docs/agents.md');
  });
});
