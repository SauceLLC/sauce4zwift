const {ipcRenderer} = require('electron');

addEventListener('click', ev => {
    console.log(ipcRenderer.send('webview-message', {a:111}));
});
