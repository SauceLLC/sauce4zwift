const {ipcRenderer, contextBridge, webFrame} = require('electron');


ipcRenderer.on('subscribe-port', (ev, subId) =>
    window.postMessage({channel: 'subscribe-port', subId}, '*', ev.ports));

ipcRenderer.on('sauce-highlight-window', () => {
    console.debug("Highlight window request");
    const doc = document.documentElement;
    if (!doc || !document.body) {
        return;
    }
    if (document.body.classList.contains('transparent-bg')) {
        document.body.classList.remove('transparent-bg');
        setTimeout(() => document.body.classList.add('transparent-bg'), 3000);
    }
    doc.classList.remove('highlight-window');
    doc.offsetWidth; // force layout
    doc.classList.add('highlight-window');
});


const meta = ipcRenderer.sendSync('getWindowMetaSync');
contextBridge.exposeInMainWorld('electron', {
    context: meta.context,
    ipcInvoke: ipcRenderer.invoke.bind(ipcRenderer),
});
contextBridge.exposeInMainWorld('isElectron', true);

function onReadyStateChange(ev) {
    if (document.readyState === 'interactive') {
        // Do some important DOM work before first paint to avoid flashing
        document.removeEventListener('readystatechange', onReadyStateChange);
        const doc = document.documentElement;
        doc.classList.add('electron-mode');
        doc.classList.toggle('frame', !!meta.context.frame);
        const theme = localStorage.getItem('/theme');
        if (theme) {
            doc.dataset.theme = JSON.parse(theme);
        }
    }
}
// Fires for interactive before defer scripts.
document.addEventListener('readystatechange', onReadyStateChange);

if (meta.modContentScripts && meta.modContentScripts.length) {
    for (const x of meta.modContentScripts) {
        webFrame.executeJavaScript(x);
    }
}

if (meta.modContentStylesheets && meta.modContentStylesheets.length) {
    for (const x of meta.modContentStylesheets) {
        webFrame.insertCSS(x);
    }
}
