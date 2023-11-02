import * as common from './common.mjs';

common.enableSentry();
common.settingsStore.setDefault({
    url: 'https://www.google.com',
});

const settings = common.settingsStore.get();


export function main() {
    common.initInteractionListeners();
    document.querySelector('webview').src = settings.url;
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form')();
}
