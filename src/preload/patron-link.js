const {ipcRenderer, contextBridge} = require('electron');

// Browser Window -> Electron RPC
document.addEventListener('electron-rpc', async ev => {
    let resp;
    try {
        resp = await ipcRenderer.invoke('__rpc__', ev.detail.name, ...ev.detail.args);
    } catch(e) {
        resp = {
            success: false,
            error: {
                name: e.name,
                message: e.message,
                stack: e.stack,
            }
        };
    }
    document.dispatchEvent(new CustomEvent(ev.detail.domEvent, {detail: resp}));
});

document.addEventListener('DOMContentLoaded', () => {
    // Step 1 page.
    const link = document.querySelector('.patron-link');
    if (link) {
        link.addEventListener('danced', () => {
            const q = new URLSearchParams({
                response_type: 'code',
                client_id: '5pxCmg6NBYOjHDVBL8XWJ4tzbwb_LxFO_pUDONDlZkPD0EOnz2NfRDUblE6J2k-C',
                redirect_uri: 'https://saucellc.io/sauce4zwift-patron-link',
                scope: 'identity campaigns.members',
            });
            location.assign(`https://www.patreon.com/oauth2/authorize?${q}`);
        });
    }
    const net = document.querySelector('a.net');
    if (net) {
        const __ =  '\x73\x68\x69\x66\x74';
        const ___ =  '\x4b\x65\x79';
        const ____ =  '\x63\x74\x72\x6c';
        let a51;
        const i9 = _ => void (a51 = _[__ + ___] && _[____ + ___]);
        document.addEventListener('\x6b' + ___.substr(1) + '\x64\x6f\x77\x6e', i9);
        document.addEventListener('\x6b' + ___.substr(1) + '\x75\x70', i9);
        net.addEventListener('pointerdown', ev => {
            if (!a51) {
                document.dispatchEvent(new Event('ahahah'));
                document.documentElement.classList.add('ahahah');
            } else {
                location.assign('patron-a51.html');
            }
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

// Proxy the code from our public page https://saucellc.io/sauce4zwift-patron-link to 
// the Renderer process for further processing.  The renderer will bounce them to the
// proper internal page immediately.
document.addEventListener('patreon-auth-code', ev =>
    void ipcRenderer.send('patreon-auth-code', ev.detail));

contextBridge.exposeInMainWorld('isElectron', true);
contextBridge.exposeInMainWorld('electron', {context: {id: 'patron-link', type: null, spec: {}}});
