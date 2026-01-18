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

    const theme = JSON.parse(localStorage.getItem('/theme') || null);
    const bgTexture = JSON.parse(localStorage.getItem('/bgTexture') || null);

    const earlyDOMHandler = () => {
        if (document.readyState === 'loading') {
            return;
        }
        document.removeEventListener('readystatechange', earlyDOMHandler);
        // Do some important DOM work before first paint to avoid flashing
        const doc = document.documentElement;
        doc.dataset.platform = meta.context.platform;
        if (theme) {
            doc.dataset.theme = theme;
        }
        if (bgTexture) {
            doc.dataset.bgTexture = bgTexture;
        }
        doc.classList.add('electron-mode');
        doc.classList.toggle('frame', !!meta.context.frame);
    };

    if (document.readyState !== 'loading') {
        earlyDOMHandler();
    } else {
        // `readystatechange` fires [for interactive] before defer scripts.
        document.addEventListener('readystatechange', earlyDOMHandler);
    }
    if (meta.flags?.visualIntro) {
        const doVisualIntro = () => {
            const onDone = ev => void (ev.animationName === 'visual-intro' &&
                document.documentElement.classList.remove('visual-intro'));
            document.body.addEventListener('animationend', onDone);
            document.body.addEventListener('animationcancel', onDone);
            document.documentElement.classList.add('visual-intro');
        };
        if (document.readyState === 'complete') {
            doVisualIntro();
        } else {
            document.addEventListener('DOMContentLoaded', doVisualIntro);
        }
    }
}
