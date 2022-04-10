const {ipcRenderer} = require('electron');

document.addEventListener('DOMContentLoaded', () => {
    try {
        const jsTokens = document.documentElement.textContent.match(
            /window\.ZPageData\.sessionTokens=({.*?});/);
        let hasTokens = false;
        if (jsTokens && jsTokens[1]) {
            const parse = new Function(`return ${jsTokens[1]}`);
            const tokens = parse();
            if (tokens && tokens.accessToken && tokens.refreshToken) {
                hasTokens = true;
                ipcRenderer.send('zwift-tokens', tokens);
            }
        } 
        ipcRenderer.send('zwift-login-required', !hasTokens);
    } catch(e) {
        debugger;
    }
});
