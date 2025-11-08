const {ipcRenderer, contextBridge} = require('electron');

const authUrl = 'https://www.patreon.com/oauth2/authorize';
const authArgs = {
    response_type: 'code',
    client_id: '5pxCmg6NBYOjHDVBL8XWJ4tzbwb_LxFO_pUDONDlZkPD0EOnz2NfRDUblE6J2k-C',
    scope: 'identity campaigns.members',
};

const meta = ipcRenderer.sendSync('getWindowMetaSync');
contextBridge.exposeInMainWorld('isElectron', true);
contextBridge.exposeInMainWorld('electron', {
    context: {
        ...meta.context,
        id: 'patron-link',
        spec: {},
    },
    ipcInvoke: (...args) => ipcRenderer.invoke(...args),
    closeWindow: () => window.close(),
});

// Proxy the code from our public page to the renderer process for further processing.
// The renderer will bounce them to the proper internal page immediately.
document.addEventListener('patreon-auth-code', ev =>
    void ipcRenderer.send('patreon-auth-code', ev.detail));

document.addEventListener('patreon-reset-session', ev =>
    void ipcRenderer.send('patreon-reset-session'));

document.addEventListener('click', ev => {
    const link = ev.target.closest('a[external][href]');
    if (link) {
        ev.preventDefault();
        ipcRenderer.invoke('rpc', 'openExternalLink', link.href).catch(e =>
            console.error('Error opening external page:', e));
    }
});

document.addEventListener('DOMContentLoaded', () => {
    for (const x of  document.querySelectorAll('.button.patron-link')) {
        const q = new URLSearchParams({
            ...authArgs,
            redirect_uri: 'https://www.sauce.llc/sauce4zwift-patron-link-v2',
        });
        x.href = `${authUrl}?${q}`;
        x.addEventListener('click', () => {
            // Slight delay to avoid flashing new content while an external window is opening
            setTimeout(() => window.location.assign('patron-waiting.html'), 1000);
        });
    }
    for (const x of document.querySelectorAll('.button.patron-link-legacy')) {
        x.addEventListener('click', () => {
            const q = new URLSearchParams({
                ...authArgs,
                redirect_uri: 'https://saucellc.io/sauce4zwift-patron-link',
            });
            window.location.assign(`${authUrl}?${q}`);
        }, {capture: true});
    }
    const special = document.querySelector('#specialtoken');
    if (special) {
        special.addEventListener('submit', ev => {
            ev.preventDefault();
            const token = ev.currentTarget.querySelector('input[name="specialtoken"]').value;
            ipcRenderer.send('patreon-special-token', token);
        });
    }
});
