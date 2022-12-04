const {ipcRenderer} = require('electron');

ipcRenderer.on('export', ev =>
    ev.sender.send('response', JSON.parse(JSON.stringify({localStorage}))));

ipcRenderer.on('import', (ev, storage) => {
    let success = true;
    try {
        localStorage.clear();
        for (const [key, value] of Object.entries(storage.localStorage)) {
            localStorage.setItem(key, value);
        }
    } catch(e) {
        console.error('Import error:', e);
        success = false;
    }
    ev.sender.send('response', success);
});
