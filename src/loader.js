const path = require('node:path');
const fs = require('node:fs');
const {app} = require('electron');

const disableGPUFile = path.join(app.getPath('userData'), 'disabled-gpu');
if (fs.existsSync(disableGPUFile)) {
    console.warn("GPU disabled");
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-gpu-compositing');
    app.commandLine.appendSwitch('disable-accelerated-video-decode');
}

(async () => {
    await import('./main.mjs');
})();
