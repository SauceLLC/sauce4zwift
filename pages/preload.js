const {ipcRenderer} = require('electron');

ipcRenderer.on('proxy', (_, data) => {
    postMessage(data);
});
