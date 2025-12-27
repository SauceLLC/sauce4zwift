const {ipcRenderer, contextBridge} = require('electron');

const meta = ipcRenderer.sendSync('getWindowMetaSync');
const options = meta.context.spec.options;
const content = {
    title: {value: options.title},
    message: {value: options.message},
    detail: {value: options.detail},
    footer: {value: options.footer},
};

contextBridge.exposeInMainWorld('electron', {
    context: meta.context,
    getContent: key => content[key].value,
    ipcInvoke: ipcRenderer.invoke.bind(ipcRenderer),
});
contextBridge.exposeInMainWorld('isElectron', true);

ipcRenderer.on('set-content', (_, key, value) => {
    const o = content[key] || (content[key] = {});
    o.dirty = true;
    o.value = value;
    const ev = new CustomEvent('set-content', {
        detail: {key, value},
        bubbles: false,
    });
    document.dispatchEvent(ev);
});

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
}
