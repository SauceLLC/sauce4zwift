import * as Common from './common.mjs';

Common.enableSentry();

// See: https://duckduckgo.com/duckduckgo-help-pages/settings/params
const ddgOptions = new URLSearchParams({
    k7: 'fff', // force light theme (hack)
    k1: -1,  // disable ads
    kat: -1, // disable location
    kak: -1, // disable install prompt 1/2
    kax: -1, // disable install prompt 2/2
    kaq: -1, // disable newsletter
    kap: -1, // disable reminders
    kao: -1, // disable tips
    kau: -1, // disable occasional experience prompt
    kpsb: -1, // disable visual-only protected reminder
});

Common.settingsStore.setDefault({
    url: 'https://noai.duckduckgo.com/?' + ddgOptions.toString(),
    solidBackground: false,
    backgroundColor: '#00ff00',
    transparency: 0,
});

const doc = document.documentElement;
const settings = Common.settingsStore.get();


function setOpacity() {
    const {transparency} = settings;
    const opacity = transparency == null ? 1 : 1 - (transparency / 100);
    doc.style.setProperty('--opacity', opacity);
}


export function main() {
    Common.initInteractionListeners();
    Common.setBackground(settings);
    setOpacity();
    const content = document.querySelector('#content');
    const webview = document.querySelector('webview');
    const inputUrl = document.querySelector('input[name="url"]');
    const pinBtn = document.querySelector('#titlebar .button.pin');
    const backBtn = document.querySelector('#titlebar .button.back');
    const fwdBtn = document.querySelector('#titlebar .button.forward');
    function load(url) {
        if (!url.match(/^[a-z]+:\/\//i)) {
            url = `https://${url}`;
        }
        console.debug("Loading:", url);
        inputUrl.value = url;
        webview.src = url;
    }
    inputUrl.addEventListener('change', () => load(inputUrl.value));
    function onDidNav(url) {
        inputUrl.value = url;
        pinBtn.classList.toggle('pinned', url === settings.url);
        backBtn.classList.toggle('disabled', !webview.canGoToOffset(-2)); // can go back is broken
        fwdBtn.classList.toggle('disabled',!webview.canGoForward());
    }
    webview.addEventListener('load-commit', ev => {
        if (ev.isMainFrame) {
            content.classList.remove('load-failed');
            onDidNav(ev.url);
        }
    });
    webview.addEventListener('did-fail-load', ev => {
        if (ev.isMainFrame) {
            document.querySelector('.load-fail-reason').innerHTML =
                `<p>Load failed: <code>${ev.errorDescription}</code></p>`;
            content.classList.add('load-failed');
            onDidNav(ev.validatedURL);
        }
    });
    webview.addEventListener('page-title-updated', ({title}) => {
        document.querySelector('#titlebar .title').textContent = title;
    });
    webview.addEventListener('ipc-message', ev => {
        if (ev.channel === 'interaction') {
            const [type, detail] = ev.args;
            if (type === 'contextmenu') {
                // Treat it like our right click so the header appears.
                window.dispatchEvent(new Event('contextmenu'));
            } else if (type === 'navigate') {
                if (detail.direction === 'back') {
                    webview.goBack();
                } else {
                    webview.goForward();
                }
            }
        }
    });
    const btns = {
        back: () => webview.goBack(),
        forward: () => webview.goForward(),
        reload: () => webview.reloadIgnoringCache(),
        home: () => webview.src = settings.url,
        debug: () => webview.openDevTools(),
        pin: () => {
            Common.settingsStore.set('url', webview.src);
            pinBtn.classList.add('pinned');
        },
    };
    for (const [btn, cb] of Object.entries(btns)) {
        document.querySelector(`.button.${btn}`).addEventListener('click', cb);
    }
    let reloadTimeout;
    Common.settingsStore.addEventListener('set', ev => {
        if (!ev.data.remote) {
            return;
        }
        if (ev.data.key === 'url') {
            clearTimeout(reloadTimeout);
            reloadTimeout = setTimeout(() => load(settings.url), 2000);
            inputUrl.value = settings.url;
        }
        Common.setBackground(settings);
        setOpacity();
    });
    if (settings.url) {
        load(settings.url);
    }
}


export async function settingsMain() {
    Common.initInteractionListeners();
    await Common.initSettingsForm('form')();
}


const importParams = new URL(import.meta.url).searchParams;
if (importParams.has('main')) {
    main();
} else if (importParams.has('settings')) {
    settingsMain();
}
