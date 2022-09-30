const {ipcRenderer, contextBridge} = require('electron');

// Electron -> Browser Window
ipcRenderer.on('browser-message', (_, o) =>
    void document.dispatchEvent(new CustomEvent(o.domEvent, {detail: o.json})));

// Browser Window -> Electron
document.addEventListener('electron-message', ev =>
    void ipcRenderer.send(ev.detail.name, ev.detail.data));

// Browser Window -> Electron RPC
document.addEventListener('electron-rpc', async ev => {
    let resp;
    try {
        resp = await ipcRenderer.invoke('__rpc__', ev.detail.name, ...ev.detail.args);
    } catch(e) {
        resp = JSON.stringify({
            success: false,
            error: {
                name: e.name,
                message: e.message,
                stack: e.stack,
            }
        });
    }
    document.dispatchEvent(new CustomEvent(ev.detail.domEvent, {detail: resp}));
});

const context = ipcRenderer.sendSync('getWindowContextSync');
contextBridge.exposeInMainWorld('electron', {context});
contextBridge.exposeInMainWorld('isElectron', true);

function onReadyStateChange(ev) {
    if (document.readyState === 'interactive') {
        // Do some important DOM work before first paint to avoid flashing
        document.removeEventListener('readystatechange', onReadyStateChange);
        const doc = document.documentElement;
        doc.classList.add('electron-mode');
        doc.classList.toggle('frame', !!context.frame);
        const theme = localStorage.getItem('/theme');
        if (theme) {
            doc.dataset.theme = JSON.parse(theme);
        }
    }
}
// Fires for interactive before defer scripts.
document.addEventListener('readystatechange', onReadyStateChange);
