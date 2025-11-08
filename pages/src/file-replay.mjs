import * as common from './common.mjs';
import * as locale from '../../shared/sauce/locale.mjs';

common.enableSentry();

let playing;
let timecodeOffset;
let timecode;


const _timeCodeEl = document.querySelector('.timecode-value');
function drawTimeCode() {
    requestAnimationFrame(drawTimeCode);
    const realTimeAdjust = playing ? (Date.now() - timecodeOffset) / 1000 : 0;
    const ts = timecode + realTimeAdjust || 0;
    common.softInnerHTML(_timeCodeEl, locale.human.timer(ts, {ms: true, long: true}));
}


async function updateStatus() {
    const status = await common.rpc.fileReplayStatus();
    if (status.state === 'playing') {
        playing = true;
    }
    if (status.state !== 'inactive') {
        timecodeOffset = Date.now();
        timecode = status.ts;
    }
    document.querySelectorAll('.button-group .button.disabled')
        .forEach(x => x.classList.toggle('disabled', status.state === 'inactive'));
}


export async function main() {
    common.initInteractionListeners();
    document.querySelector('input[name="activity"]').addEventListener('input', async ev => {
        const file = ev.currentTarget.files[0];
        if (!file) {
            return;
        }
        const ab = await file.arrayBuffer();
        const payload = btoa(Array.from(new Uint8Array(ab)).map(x => String.fromCharCode(x)).join(''));
        try {
            await common.rpc.fileReplayLoad({
                type: 'base64',
                payload,
            });
        } catch(e) {
            window.alert(e.message);
        }
        document.querySelectorAll('.button-group .button.disabled')
            .forEach(x => x.classList.remove('disabled'));
    });
    document.querySelector('#content').addEventListener('click', async ev => {
        const btn = ev.target.closest('.button');
        if (!btn) {
            return;
        }
        const args = btn.dataset.args ? JSON.parse(btn.dataset.args) : [];
        await common.rpc[btn.dataset.call](...args);
        await updateStatus();
    });
    common.subscribe('file-replay-timesync', ev => {
        timecodeOffset = Date.now();
        timecode = ev.ts;
        playing = ev.playing;
    });
    await updateStatus();
    drawTimeCode();
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form')();
}
