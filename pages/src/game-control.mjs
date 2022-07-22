import * as common from './common.mjs';


export async function main() {
    common.initInteractionListeners();
    const statusEl = document.querySelector('.status');
    const gcs = await common.rpc.getGameConnectionStatus();
    console.log(gcs);
    document.documentElement.classList.toggle('connected', gcs.connected);
    statusEl.textContent = gcs.state;
    common.subscribe('status', x => {
        document.documentElement.classList.toggle('connected', x.connected);
        statusEl.textContent = x.state;
    });
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
