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

document.addEventListener('click', ev => {
    const link = ev.target.closest('a[external][href]');
    if (link) {
        ev.preventDefault();
        ipcRenderer.invoke('rpc', 'openExternalLink', link.href).catch(e =>
            console.error('Error opening external page:', e));
    }
});

if (meta.internal) {
    const onReadyStateChange = ev => {
        if (document.readyState === 'interactive') {
            // Do some important DOM work before first paint to avoid flashing
            document.removeEventListener('readystatechange', onReadyStateChange);
            const doc = document.documentElement;
            doc.classList.add('electron-mode');
            doc.classList.toggle('frame', !!meta.context.frame);
            doc.dataset.platform = meta.context.platform;
            const theme = localStorage.getItem('/theme');
            if (theme) {
                doc.dataset.theme = JSON.parse(theme);
            }
            const bgTexture = localStorage.getItem('/bgTexture');
            if (bgTexture) {
                doc.dataset.bgTexture = JSON.parse(bgTexture);
            }
        }
    };
    // Fires for interactive before defer scripts.
    document.addEventListener('readystatechange', onReadyStateChange);

    if (meta.modContentScripts && meta.modContentScripts.length) {
        for (const x of meta.modContentScripts) {
            webFrame.executeJavaScript(x).catch(e => console.error("Mod content script error:", e));
        }
    }

    if (meta.modContentStylesheets && meta.modContentStylesheets.length) {
        for (const x of meta.modContentStylesheets) {
            try {
                webFrame.insertCSS(x);
            } catch(e) {
                console.error("Mod content stylesheet error:", e);
            }
        }
    }
}
