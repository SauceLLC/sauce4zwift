import sauce from '../../shared/sauce/index.mjs';
import common from './common.mjs';

const L = sauce.locale;
const H = L.human;
const settingsKey = 'overview-settings-v1';
let settings;
let renderer;


function shortDuration(x) {
    return H.duration(x, {short: true});
}


export async function main() {
    common.initInteractionListeners({settingsKey});
    let lastData;
    let autoHideTimeout;
    settings = common.storage.get(settingsKey, {
        numFields: 3,
        autoHideWindows: true,
    });
    document.addEventListener('settings-updated', ev => {
        if (settings.autoHideWindows !== ev.data.autoHideWindows) {
            location.reload();  // Avoid state machine complications.
            return;
        }
        settings = ev.data;
        if (renderer) {
            renderer.stop();
            renderer = null;
        }
        render();
        if (lastData) {
            renderer.setData(lastData);
            renderer.render();
        }
    });
    document.querySelector('.button.show').addEventListener('click', () => {
        autoHidden = false;
        common.electronTrigger('showAllWindows');
        document.documentElement.classList.remove('hidden', 'auto-hidden');
    });
    document.querySelector('.button.hide').addEventListener('click', () => {
        autoHidden = false;
        common.electronTrigger('hideAllWindows');
        document.documentElement.classList.remove('auto-hidden');
        document.documentElement.classList.add('hidden');
    });
    document.querySelector('.button.quit').addEventListener('click', () => {
        common.electronTrigger('quit');
    });

    let autoHidden;
    function autoHide() {
        autoHidden = true;
        document.documentElement.classList.add('auto-hidden', 'hidden');
        console.debug("Auto hidding windows");
        common.electronTrigger('hideAllWindows');
    }
    function autoShow() {
        autoHidden = false;
        document.documentElement.classList.remove('auto-hidden', 'hidden');
        console.debug("Auto showing windows");
        common.electronTrigger('showAllWindows');
    }
    const autoHideWait = 2000;
    let lastUpdate = 0;
    autoHideTimeout = settings.autoHideWindows && setTimeout(autoHide, autoHideWait);
    common.subscribe('watching', watching => {
        if (settings.autoHideWindows && (watching.speed || watching.cadence || watching.power)) {
            clearTimeout(autoHideTimeout);
            if (autoHidden) {
                autoShow();
            }
            autoHideTimeout = setTimeout(autoHide, autoHideWait);
        }
        lastData = watching;
        renderer.setData(watching);
        const ts = Date.now();
        if (ts - lastUpdate > 500) {
            lastUpdate = ts;
            renderer.render();
        }
    });
    render();
}


function render() {
    const fields = document.querySelector('.fields');
    const mapping = [];
    fields.innerHTML = '';
    for (let i = 0; i < settings.numFields; i++) {
        fields.insertAdjacentHTML('beforeend', `
            <div class="field" data-field="${i}">
                <div class="key"></div><div class="value"></div><abbr class="unit"></abbr>
            </div>
        `);
        mapping.push({id: i, default: i});
    }
    const content = document.querySelector('#content');
    renderer = new common.Renderer(content, {fps: 1});
    renderer.addRotatingFields({
        mapping,
        fields: [{
            value: x => H.number(x.rideons),
            key: () => 'Ride Ons',
        }, {
            value: x => H.number(x.kj),
            key: () => 'Energy',
            unit: () => 'kJ',
        }, {
            value: x => H.number(x.stats.speed.avg),
            key: () => 'Speed <small>(avg)</small>',
            unit: () => 'kph',
        }, {
            value: x => H.number(x.speed),
            key: () => 'Speed',
            unit: () => 'kph',
        }, {
            value: x => H.number(x.stats.speed.smooth[60]),
            key: () => `Speed <small>(${shortDuration(60)})</small>`,
            unit: () => 'kph',
        }, {
            value: x => H.number(x.stats.hr.avg),
            key: () => 'HR <small>(avg)</small>',
            unit: () => 'bpm',
        }, {
            value: x => H.number(x.heartrate),
            key: () => 'HR',
            unit: () => 'bpm',
        }, {
            value: x => H.number(x.stats.hr.smooth[60]),
            key: () => `HR <small>(${shortDuration(60)})</small>`,
            unit: () => 'bpm',
        }, {
            value: x => H.number(x.stats.power.max),
            key: () => 'Power <small>(max)</small>',
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.power.avg),
            key: () => 'Power <small>(avg)</small>',
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.power.np),
            key: () => 'NP',
        }, {
            value: x => H.number(x.stats.power.smooth[5]),
            key: () => `Power <small>(${shortDuration(5)})</small>`,
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.power.smooth[60]),
            key: () => `Power <small>(${shortDuration(60)})</small>`,
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.power.smooth[300]),
            key: () => `Power <small>(${shortDuration(300)})</small>`,
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.power.smooth[1200]),
            key: () => `Power <small>(${shortDuration(1200)})</small>`,
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.power.peaks[5].avg),
            key: () => `Peak Power <small>(${shortDuration(5)})</small>`,
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.power.peaks[60].avg),
            key: () => `Peak Power <small>(${shortDuration(60)})</small>`,
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.power.peaks[300].avg),
            key: () => `Peak Power <small>(${shortDuration(300)})</small>`,
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.power.peaks[1200].avg),
            key: () => `Peak Power <small>(${shortDuration(1200)})</small>`,
            unit: () => 'w',
        }],
    });
}


export function settingsMain() {
    common.initInteractionListeners();
    common.initSettingsForm('form', {settingsKey});
}
