/**
 * Content model for the "Install CLI" info panel.
 *
 * `vibe99ctl` ships with every Vibe99 install, but how it reaches the PATH
 * depends on the platform and on how Vibe99 itself was installed. This
 * module holds the per-platform instructions as plain data so the panel can
 * render them as copyable command blocks.
 *
 * Keep the copy English — it matches the README and the docs.
 */

/** The shell a command is written for. */
export type InstallCliShell = 'powershell' | 'cmd' | 'bash';

/** A single command the user can copy and run. */
export interface InstallCliCommand {
  /** Short explanation shown above the command. */
  label: string;
  /** The command itself — copied to the clipboard verbatim. */
  command: string;
  /** The shell the command is written for (shown as a hint). */
  shell?: InstallCliShell;
}

/** One platform block of the panel. */
export interface InstallCliSection {
  /** Stable identifier, also used as the DOM hook. */
  id: string;
  /** Section heading. */
  title: string;
  /** Runtime platforms this section is the default for. */
  platforms: string[];
  /** Explanation paragraphs. */
  notes: string[];
  /** Copyable commands. */
  commands: InstallCliCommand[];
}

const WINDOWS_SECTION: InstallCliSection = {
  id: 'windows',
  title: 'Windows (cmd / PowerShell)',
  platforms: ['win32'],
  notes: [
    'Vibe99 0.23.0 and newer install vibe99ctl and add it to your user PATH. Open a new terminal and it is ready to use.',
    'Upgrading from an older release and "vibe99ctl" is still not found? Run one of these once — both copy the CLI into %USERPROFILE%\\.local\\bin and add that folder to your user PATH.',
  ],
  commands: [
    {
      label: 'Check that the CLI is on your PATH',
      command: 'vibe99ctl --help',
    },
    {
      label: 'Use the copy inside the Vibe99 install folder (PowerShell)',
      command: '& "$env:LOCALAPPDATA\\Vibe99\\vibe99ctl.exe" install-cli',
      shell: 'powershell',
    },
    {
      label: 'Same command in cmd.exe',
      command: '"%LOCALAPPDATA%\\Vibe99\\vibe99ctl.exe" install-cli',
      shell: 'cmd',
    },
    {
      label: 'Or download the standalone CLI from the latest release (PowerShell)',
      command:
        'Invoke-WebRequest https://github.com/yarray/Vibe99/releases/latest/download/vibe99ctl-x86_64-pc-windows-msvc.exe -OutFile .\\vibe99ctl.exe; .\\vibe99ctl.exe install-cli',
      shell: 'powershell',
    },
  ],
};

const LINUX_DEB_SECTION: InstallCliSection = {
  id: 'linux-deb',
  title: 'Linux (.deb package)',
  platforms: ['linux'],
  notes: [
    'The .deb package installs vibe99ctl into /usr/bin — there is nothing else to do.',
  ],
  commands: [
    {
      label: 'Check that the CLI is on your PATH',
      command: 'vibe99ctl --help',
    },
  ],
};

const LINUX_APPIMAGE_SECTION: InstallCliSection = {
  id: 'linux-appimage',
  title: 'Linux (AppImage)',
  platforms: ['linux'],
  notes: [
    'The AppImage carries the CLI inside it. Extract it once:',
    'Then install the CLI from the extracted copy — it copies itself into ~/.local/bin:',
    'Or install the standalone CLI from the latest release:',
  ],
  commands: [
    {
      label: 'Extract the image',
      command: './Vibe99-*.AppImage --appimage-extract',
      shell: 'bash',
    },
    {
      label: 'Install the CLI from the extracted copy',
      command: './squashfs-root/usr/bin/vibe99ctl install-cli',
      shell: 'bash',
    },
    {
      label: 'Or install the standalone CLI from the latest release',
      command:
        'curl -L https://github.com/yarray/Vibe99/releases/latest/download/vibe99ctl-x86_64-unknown-linux-gnu -o /tmp/vibe99ctl && chmod +x /tmp/vibe99ctl && /tmp/vibe99ctl install-cli',
      shell: 'bash',
    },
  ],
};

const WSL_SECTION: InstallCliSection = {
  id: 'wsl',
  title: 'WSL (Windows Subsystem for Linux)',
  platforms: [],
  notes: [
    'WSL has no native vibe99ctl yet. Calling the Windows copy through Windows interop is the recommended way to use it for now — native WSL support is planned.',
    'If vibe99ctl.exe already is on your Windows PATH:',
    'Otherwise call the copy that install-cli placed in your Windows profile:',
  ],
  commands: [
    {
      label: 'Call the Windows CLI through interop',
      command: 'cmd.exe /c vibe99ctl.exe describe',
      shell: 'bash',
    },
    {
      label: 'Call it by its full path',
      command: 'cmd.exe /c "%USERPROFILE%\\.local\\bin\\vibe99ctl.exe" describe',
      shell: 'bash',
    },
  ],
};

const DISCOVER_SECTION: InstallCliSection = {
  id: 'discover',
  title: 'Discover the commands',
  platforms: [],
  notes: [
    'vibe99ctl describe prints every callable method as JSON — it is the entry point for finding out what the CLI can do, and it works even when Vibe99 is not running. The full guide lives in docs/agents.md.',
  ],
  commands: [
    {
      label: 'List every command',
      command: 'vibe99ctl describe',
    },
  ],
};

/** Every section of the panel, in the order they are written down. */
export const INSTALL_CLI_SECTIONS: InstallCliSection[] = [
  WINDOWS_SECTION,
  LINUX_DEB_SECTION,
  LINUX_APPIMAGE_SECTION,
  WSL_SECTION,
  DISCOVER_SECTION,
];

/**
 * Order the sections for a given runtime platform: the sections that apply to
 * the running system come first, the rest keeps its written order.
 */
export function orderInstallCliSections(
  sections: InstallCliSection[],
  platform: string,
): InstallCliSection[] {
  const applies = (section: InstallCliSection): boolean =>
    section.platforms.includes(platform);

  return [
    ...sections.filter(applies),
    ...sections.filter((section) => !applies(section)),
  ];
}

/** Whether a section is the default for the running platform. */
export function isCurrentInstallCliSection(
  section: InstallCliSection,
  platform: string,
): boolean {
  return section.platforms.includes(platform);
}
