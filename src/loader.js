Error.stackTraceLimit = 50;

const {app, dialog} = require('electron');

//app.commandLine.appendSwitch('disable-gpu');

//app.commandLine.appendSwitch('disable-gpu-compositing');

//app.commandLine.appendSwitch('disable-accelerated-video-decode');
//app.commandLine.appendSwitch('disable-software-rasterizer');
//app.commandLine.appendSwitch('enable-oop-rasterization');
//app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
//app.commandLine.appendSwitch('force_high_performacne_gpu');
app.commandLine.appendSwitch('force_low_power_gpu');
app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds');

(async () => {
    try {
        await import('./main.mjs');
    } catch(e) {
        console.error(e);
        await dialog.showErrorBox('Early Startup Error', e.stack);
        app.exit(1);
    }
})();
