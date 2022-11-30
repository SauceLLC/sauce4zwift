const {ipcRenderer} = require('electron');

ipcRenderer.on('export', ev => {
    ev.sender.send('export-response', JSON.parse(JSON.stringify(localStorage)));
});

ipcRenderer.on('import', (ev, localStorage) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(localStorage)) {
        localStorage.setItem(key, value);
    }
});
