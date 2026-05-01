import * as Common from './common.mjs';

Common.enableSentry();

const powerupEl = document.querySelector('[data-call="powerup"]');


function updateConnStatus(status) {
    document.documentElement.classList.toggle('connected', status.connected);
    document.querySelector('.status').textContent = status.state;
}


function activatePowerup(pu) {
    powerupEl.classList.remove('disabled');
    powerupEl.textContent = 'active: ' + pu;
}


function setPowerup(pu) {
    powerupEl.classList.remove('disabled');
    powerupEl.textContent = 'AVAIL: ' + pu;
}


function clearPowerup(pu) {
    powerupEl.textContent = 'NONE';
    powerupEl.classList.add('disabled');
}


function onGameState(state) {
    if (state.activePowerUp) {
        activatePowerup(state.activePowerUp);
    } else if (state.availablePowerUp) {
        setPowerup(state.availablePowerUp);
    } else {
        clearPowerup();
    }
}


export async function main() {
    Common.initInteractionListeners();
    Common.subscribe('status', updateConnStatus, {source: 'gameConnection', persistent: true});
    Common.subscribe('game-state', onGameState, {persistent: true});
    document.querySelector('#content').addEventListener('click', ev => {
        const btn = ev.target.closest('.button');
        if (!btn) {
            return;
        }
        const args = btn.dataset.args ? JSON.parse(btn.dataset.args) : [];
        Common.rpc[btn.dataset.call](...args);
    });
    document.addEventListener('sauce-ws-status', async ({detail}) => {
        if (detail === 'connected') {
            updateConnStatus(await Common.rpc.getGameConnectionStatus());
        } else {
            updateConnStatus({connected: false, state: 'not running'});
            updateConnStatus(await Common.rpc.getGameConnectionStatus());
        }
    });
    updateConnStatus(await Common.rpc.getGameConnectionStatus());
    const gameState = await Common.rpc.getGameState();
    if (gameState) {
        onGameState(gameState);
    }
}


export async function settingsMain() {
    Common.initInteractionListeners();
    await Common.initSettingsForm('form')();
}
