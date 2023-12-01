import * as common from './common.mjs';

common.enableSentry();
common.settingsStore.setDefault({
    url: 'https://www.google.com',
    solidBackground: false,
    backgroundColor: '#00ff00',
    transparency: 0,
});

const doc = document.documentElement;
const settings = common.settingsStore.get();


function setBackground() {
    const {solidBackground, backgroundColor} = settings;
    doc.classList.toggle('solid-background', solidBackground);
    if (solidBackground) {
        doc.style.setProperty('--background-color', backgroundColor);
    } else {
        doc.style.removeProperty('--background-color');
    }
}


function setOpacity() {
    const {transparency} = settings;
    const opacity = transparency == null ? 1 : 1 - (transparency / 100);
    doc.style.setProperty('--opacity', opacity);
}


export function main() {
    common.initInteractionListeners();
    const content = document.querySelector('#content');
    const webview = document.querySelector('webview');
    const inputUrl = document.querySelector('input[name="url"]');
    const pinBtn = document.querySelector('#titlebar .button.pin');
    const backBtn = document.querySelector('#titlebar .button.back');
    const fwdBtn = document.querySelector('#titlebar .button.forward');
    if (settings.url) {
        load(settings.url);
    }
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
        backBtn.classList.toggle('disabled', !webview.canGoBack());
        fwdBtn.classList.toggle('disabled', !webview.canGoForward());
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
    webview.addEventListener('dom-ready', () => {
        // Hijack right clicks so we don't lose interaction capability
        webview.executeJavaScript(
            `addEventListener('contextmenu', ev => ev.stopPropagation(), {capture: true})`);
    });
    webview.addEventListener('page-title-updated', ({title}) => {
        document.querySelector('#titlebar .title').textContent = title;
    });
    webview.addEventListener('context-menu', ev => dispatchEvent(new Event('contextmenu')));
    const btns = {
        back: () => webview.goBack(),
        forward: () => webview.goForward(),
        reload: () => webview.reloadIgnoringCache(),
        home: () => webview.src = settings.url,
        debug: () => webview.openDevTools(),
        pin: () => {
            common.settingsStore.set('url', webview.src);
            pinBtn.classList.add('pinned');
        },
    };
    for (const [btn, cb] of Object.entries(btns)) {
        document.querySelector(`.button.${btn}`).addEventListener('click', cb);
    }
    setBackground();
    setOpacity();
    let reloadTimeout;
    common.settingsStore.addEventListener('changed', ev => {
        if (ev.data.changed.has('url')) {
            clearTimeout(reloadTimeout);
            reloadTimeout = setTimeout(() => load(settings.url), 2000);
            inputUrl.value = settings.url;
        }
        setBackground();
        setOpacity();
    });
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form')();
}


const importParams = new URL(import.meta.url).searchParams;
if (importParams.has('main')) {
    main();
} else if (importParams.has('settings')) {
    settingsMain();
}
