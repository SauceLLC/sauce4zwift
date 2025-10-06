
exports.default = async function notarizing(context) {
    const {notarize} = await import('@electron/notarize');
    const {electronPlatformName, appOutDir} = context;
    const skip = process.env.SKIP_NOTARIZE;
    if (electronPlatformName !== 'darwin' || skip) {
        return;
    }
    const appName = context.packager.appInfo.productFilename;
    const appleId = process.env.APPLE_ID;
    const appleIdPassword = process.env.APPLE_ID_PASSWORD;
    const teamId = process.env.APPLE_TEAM_ID;
    if (!appleId || !appleIdPassword) {
        throw new Error("APPLE_ID env not set");
    }
    return await notarize({
        appBundleId: 'io.saucellc.sauce4zwift',
        appPath: `${appOutDir}/${appName}.app`,
        appleId,
        appleIdPassword,
        teamId,
    });
};
