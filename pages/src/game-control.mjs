import * as common from './common.mjs';


export async function main() {
    common.initInteractionListeners();
    //const enabled = await common.rpc.getAppSetting('gameConnectionEnabled');
    document.addEventListener('click', ev => {
        const btn = ev.target.closest('.button');
        if (!btn) {
            return;
        }
        common.rpc[btn.dataset.call](...JSON.parse(btn.dataset.args));
    });
}


export async function settingsMain() {
    common.initInteractionListeners();
    //await common.initSettingsForm('form#options', {});
}
