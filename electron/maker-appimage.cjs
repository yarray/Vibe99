const path = require('node:path');
const { build } = require('electron-builder');
const { MakerBase } = require('@electron-forge/maker-base');

class MakerAppImage extends MakerBase {
  constructor(configOrFetcher, platformsToMakeOn) {
    super(configOrFetcher, platformsToMakeOn);
    this.name = 'appimage';
    this.defaultPlatforms = ['linux'];
  }

  isSupportedOnCurrentPlatform() {
    return this.isInstalled('electron-builder');
  }

  async make({ dir, makeDir, targetArch }) {
    const outputDir = path.resolve(makeDir, 'AppImage', targetArch);

    await this.ensureDirectory(outputDir);

    const artifacts = await build({
      prepackaged: dir,
      publish: 'never',
      config: {
        directories: {
          output: outputDir,
        },
        linux: {
          target: ['AppImage'],
        },
        ...this.config,
      },
    });

    return artifacts;
  }
}

module.exports = MakerAppImage;
