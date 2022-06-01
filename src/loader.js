Error.stackTraceLimit = 50;

const {app, dialog} = require('electron');

//app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
//app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds');

(async () => {
    try {
        await import('./main.mjs');
    } catch(e) {
        console.error(e);
        await dialog.showErrorBox('Early Startup Error', e.stack);
        app.exit(1);
    }
})();
