require('dotenv').config();
const { notarize } = require('electron-notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;  
  if (electronPlatformName !== 'darwin') {
    return;
  }
  const appName = context.packager.appInfo.productFilename;
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_ID_PASSWORD
  if (!appleId || !appleIdPassword) {
    throw new Error("APPLE_ID env not set");
  }
  return await notarize({
    appBundleId: 'io.saucellc.sauce4zwift',
    appPath: `${appOutDir}/${appName}.app`,
    appleId,
    appleIdPassword,
  });
};
