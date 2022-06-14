import * as common from './common.mjs';


export async function main() {
    common.initInteractionListeners();
    //const enabled = await common.rpc.getSetting('gameConnectionEnabled');
    document.addEventListener('click', ev => {
        const btn = ev.target.closest('.button');
        if (!btn) {
            return;
        }
        const args = btn.dataset.args ? JSON.parse(btn.dataset.args) : [];
        common.rpc[btn.dataset.call](...args);
    });
}


export async function settingsMain() {
    common.initInteractionListeners();
    //await common.initSettingsForm('form#options', {})();
}
