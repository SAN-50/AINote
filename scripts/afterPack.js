const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

exports.default = async function afterPack(context) {
  const ext = context.electronPlatformName === 'win32' ? '.exe' : '';
  const exeName = `${context.packager.executableName || context.packager.appInfo.productFilename}${ext}`;
  const electronBinaryPath = path.join(context.appOutDir, exeName);

  try {
    await flipFuses(electronBinaryPath, {
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    });
    console.log('[afterPack] Electron security fuses applied to:', electronBinaryPath);
  } catch (err) {
    console.warn('[afterPack] Warning applying fuses:', err.message);
  }
};
