const {ipcRenderer} = require('electron');

ipcRenderer.on('export', ev => {
    ev.sender.send('response', JSON.stringify({localStorage}));
});

ipcRenderer.on('import', (ev, storageJson) => {
    try {
        if (typeof storageJson !== 'string') {
            console.error("Argument is not a string:", storageJson);
            throw new TypeError('Invalid Storage Import Type');
        }
        const storage = JSON.parse(storageJson);
        if (!storage || typeof storage !== 'object') {
            console.error("Invalid JSON:", storageJson);
            throw new TypeError('Invalid Storage Import Payload');
        }
        localStorage.clear();
        for (const [key, value] of Object.entries(storage.localStorage)) {
            localStorage.setItem(key, value);
        }
    } catch(e) {
        console.error('Import error:', e);
        ev.sender.send('response', {
            success: false,
            error: e.message,
        });
        throw e;
    }
    ev.sender.send('response', {success: true});
});
