Error.stackTraceLimit = 50;

const os = require('os');
const {app, dialog, nativeTheme} = require('electron');

nativeTheme.themeSource = 'dark';

if (os.platform() === 'win32') {
    console.debug("Disable GPU Compositing for windows");
    app.commandLine.appendSwitch('disable-gpu-compositing');
}

import('./main.mjs').then(m => m.main()).catch(async e => {
    console.error(e);
    await dialog.showErrorBox('Startup Error', e.stack);
    app.exit(1);
});
