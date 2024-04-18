import * as common from './common.mjs';
import * as locale from '../../shared/sauce/locale.mjs';

common.enableSentry();

let playing;
let timecodeOffset;
let timecode;


const _timeCodeEl = document.querySelector('.timecode');
function drawTimeCode() {
    requestAnimationFrame(drawTimeCode);
    const realTimeAdjust = playing ? (Date.now() - timecodeOffset) / 1000 : 0;
    const ts = timecode + realTimeAdjust;
    _timeCodeEl.innerHTML = locale.human.timer(ts, {ms: true, long: true});
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
            alert(e.message);
        }
        document.querySelectorAll('.button-group .button.disabled')
            .forEach(x => x.classList.remove('disabled'));
    });
    document.querySelector('#content').addEventListener('click', ev => {
        const btn = ev.target.closest('.button');
        if (!btn) {
            return;
        }
        const args = btn.dataset.args ? JSON.parse(btn.dataset.args) : [];
        common.rpc[btn.dataset.call](...args);
    });
    common.subscribe('file-replay-timesync', ev => {
        timecodeOffset = Date.now();
        timecode = ev.time;
        playing = ev.playing;
    });
    const status = await common.rpc.fileReplayStatus();
    if (status === 'playing') {
        playing = true;
    }
    if (status !== 'inactive') {
        document.querySelectorAll('.button-group .button.disabled')
            .forEach(x => x.classList.remove('disabled'));
    }
    drawTimeCode();
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form')();
}
