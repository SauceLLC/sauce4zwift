Error.stackTraceLimit = 50;

const os = require('os');
const {app, dialog} = require('electron');

if (os.platform() === 'win32') {
    console.debug("Disable GPU Compositing for windows");
    app.commandLine.appendSwitch('disable-gpu-compositing');
}

import('./main.mjs').catch(async e => {
    console.error(e);
    await dialog.showErrorBox('Early Startup Error', e.stack);
    app.exit(1);
});
