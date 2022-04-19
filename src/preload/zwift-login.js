const {ipcRenderer} = require('electron');

function siteScript() {
    const start = Date.now();
    const check = () => {
        if (window.ZPageData) {
            document.dispatchEvent(new CustomEvent('sauce-access-token',
                {detail: window.ZPageData.sessionTokens.accessToken}));
        } else if (Date.now() - start > 5000) {
            document.dispatchEvent(new CustomEvent('sauce-access-token'));
        } else {
            setTimeout(check, 200);
        }
    };
    check();
}

document.addEventListener('sauce-access-token', ev => {
    ipcRenderer.send('zwift-login-required', !ev.detail);
    if (ev.detail) {
        ipcRenderer.send('zwift-token', ev.detail);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const script = document.createElement('script');
    script.innerHTML = siteScript.toString() + '\nsiteScript()';
    document.head.appendChild(script);
});
