import * as common from './common.mjs';


function updateConnStatus(s) {
    console.warn(s);
    document.documentElement.classList.toggle('connected', s.connected);
    const statusEl = document.querySelector('.status');
    statusEl.textContent = s.state;
}


export async function main() {
    common.initInteractionListeners();
    common.subscribe('status', updateConnStatus, {source: 'gameConnection'});
    document.addEventListener('click', ev => {
        const btn = ev.target.closest('.button');
        if (!btn) {
            return;
        }
        const args = btn.dataset.args ? JSON.parse(btn.dataset.args) : [];
        common.rpc[btn.dataset.call](...args);
    });
    document.addEventListener('sauce-ws-status', async ({detail}) => {
        if (detail === 'connected') {
            updateConnStatus(await common.rpc.getGameConnectionStatus());
        } else {
            updateConnStatus({connected: false, state: 'not running'});
            updateConnStatus(await common.rpc.getGameConnectionStatus());
        }
    });
    updateConnStatus(await common.rpc.getGameConnectionStatus());
}
