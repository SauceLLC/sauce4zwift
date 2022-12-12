const {ipcRenderer, contextBridge} = require('electron');

document.addEventListener('DOMContentLoaded', () => {
    // Step 1 page.
    const link = document.querySelector('.patron-link');
    if (link) {
        link.addEventListener('danced', () => {
            const q = new URLSearchParams({
                response_type: 'code',
                client_id: '5pxCmg6NBYOjHDVBL8XWJ4tzbwb_LxFO_pUDONDlZkPD0EOnz2NfRDUblE6J2k-C',
                redirect_uri: 'https://saucellc.io/sauce4zwift-patron-link', // MUST use legacy URL
                scope: 'identity campaigns.members',
            });
            location.assign(`https://www.patreon.com/oauth2/authorize?${q}`);
        });
    }
    const code = document.querySelector('.button.code');
    if (code) {
        code.addEventListener('click', ev => {
            location.assign('patron-code.html');
        });
    }

    const special = document.querySelector('#specialtoken');
    if (special) {
        special.addEventListener('submit', ev => {
            const token = ev.currentTarget.querySelector('input[name="specialtoken"]').value;
            ipcRenderer.send('patreon-special-token', token);
            ev.preventDefault();
        });
    }
});

// Proxy the code from our public page to the renderer process for further processing.
// The renderer will bounce them to the proper internal page immediately.
document.addEventListener('patreon-auth-code', ev =>
    void ipcRenderer.send('patreon-auth-code', ev.detail));

document.addEventListener('patreon-reset-session', ev =>
    void ipcRenderer.send('patreon-reset-session'));

contextBridge.exposeInMainWorld('isElectron', true);
contextBridge.exposeInMainWorld('electron', {
    context: {
        id: 'patron-link',
        type: null,
        spec: {},
        frame: true
    },
    ipcInvoke: (...args) => ipcRenderer.invoke(...args),
});
