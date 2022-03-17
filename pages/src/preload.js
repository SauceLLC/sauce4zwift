const {ipcRenderer} = require('electron');

// Electron -> Browser Window
ipcRenderer.on('browser-message', (_, o) =>
    void document.dispatchEvent(new CustomEvent(o.domEvent, {detail: o.data})));

// Browser Window -> Electron
document.addEventListener('electron-message', ev =>
    void ipcRenderer.send(ev.detail.name, ev.detail.data));
