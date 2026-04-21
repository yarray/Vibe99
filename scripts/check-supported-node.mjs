const supportedMajor = 22;
const currentVersion = process.versions.node;
const currentMajor = Number(currentVersion.split('.')[0]);

if (currentMajor !== supportedMajor) {
  console.error(
    [
      `Unsupported Node.js version: ${currentVersion}.`,
      `Vibe99 packaging is supported on Node ${supportedMajor}.x.`,
      'Switch to Node 22 before running start, package, or make.',
    ].join('\n')
  );
  process.exit(1);
}
