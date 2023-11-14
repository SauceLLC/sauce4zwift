const {ipcRenderer, contextBridge} = require('electron');

const authUrl = 'https://www.patreon.com/oauth2/authorize';
const authArgs = {
    response_type: 'code',
    client_id: '5pxCmg6NBYOjHDVBL8XWJ4tzbwb_LxFO_pUDONDlZkPD0EOnz2NfRDUblE6J2k-C',
    scope: 'identity campaigns.members',
};

contextBridge.exposeInMainWorld('isElectron', true);
contextBridge.exposeInMainWorld('electron', {
    context: {
        id: 'patron-link',
        type: null,
        spec: {},
        frame: true
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

document.addEventListener('DOMContentLoaded', () => {
    const patronLink = document.querySelector('.button.patron-link');
    if (patronLink) {
        const q = new URLSearchParams({
            ...authArgs,
            redirect_uri: 'https://www.sauce.llc/sauce4zwift-patron-link-v2',
        });
        patronLink.href = `${authUrl}?${q}`;
        patronLink.addEventListener('click', () => {
            // Slight delay to avoid flashing new content while an external window is opening
            setTimeout(() => location.assign('patron-waiting.html'), 1000);
        });
    }
    const patronLinkLegacy = document.querySelector('.button.patron-link-legacy');
    if (patronLinkLegacy) {
        patronLinkLegacy.addEventListener('click', () => {
            const q = new URLSearchParams({
                ...authArgs,
                redirect_uri: 'https://saucellc.io/sauce4zwift-patron-link',
            });
            location.assign(`${authUrl}?${q}`);
        });
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


