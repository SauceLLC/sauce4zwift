const {ipcRenderer} = require('electron');

// TODO: Register these events based on requests from the host renderer.

addEventListener('contextmenu', ev => {
    ipcRenderer.sendToHost('interaction', ev.type);
});

addEventListener('mouseup', ev => {
    if (ev.button === 3 || ev.button === 4) {
        ipcRenderer.sendToHost('interaction', 'navigate', {
            direction: ev.button === 3 ? 'back' : 'forward',
        });
    }
});
