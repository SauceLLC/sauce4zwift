const {ipcRenderer} = require('electron');

document.addEventListener('DOMContentLoaded', () => {
    // Step 1 page.
    const link = document.querySelector('a.patron-link');
    if (link) {
        const q = new URLSearchParams({
            response_type: 'code',
            client_id: '5pxCmg6NBYOjHDVBL8XWJ4tzbwb_LxFO_pUDONDlZkPD0EOnz2NfRDUblE6J2k-C',
            redirect_uri: 'https://saucellc.io/sauce4zwift-patron-link',
            scope: 'identity campaigns.members',
        });
        link.href = `https://www.patreon.com/oauth2/authorize?${q}`;
    }
});

// Proxy the code from our public page https://saucellc.io/sauce4zwift-patron-link to 
// the Renderer process for further processing.  The renderer will bounce them to the
// proper internal page immediately.
document.addEventListener('patreon-auth-code', ev =>
    void ipcRenderer.send('patreon-auth-code', ev.detail));
