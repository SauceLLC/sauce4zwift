import sauce from '../../shared/sauce/index.mjs';
import common from './common.mjs';

const L = sauce.locale;
const H = L.human;
const settingsKey = 'overview-settings-v3';
let settings;
let imperial = !!common.storage.get('/imperialUnits');
L.setImperial(imperial);


function shortDuration(x) {
    return H.duration(x, {short: true});
}


export async function main() {
    common.initInteractionListeners({settingsKey});
    let lastData;
    let autoHideTimeout;
    settings = common.storage.get(settingsKey, {
        leftFields: 2,
        rightFields: 2,
        lockedFields: false,
        autoHideWindows: common.isElectron ? true : false,
        centerGapSize: 0,
    });
    document.documentElement.style.setProperty('--center-gap-size', settings.centerGapSize + 'px');
    let renderer = buildLayout(settings);
    document.addEventListener('global-settings-updated', ev => {
        if (ev.data.key === '/imperialUnits') {
            imperial = ev.data.data;
            L.setImperial(imperial);
            renderer.render();
        }
    });
    document.addEventListener('settings-updated', ev => {
        if (settings.autoHideWindows !== ev.data.autoHideWindows) {
            location.reload();  // Avoid state machine complications.
            return;
        }
        const oldCenterGap = settings.centerGapSize;
        settings = ev.data;
        if (settings.centerGapSize !== oldCenterGap) {
            document.documentElement.style.setProperty('--center-gap-size', settings.centerGapSize + 'px');
            renderer.render({force: true});
            return;
        }
        if (renderer) {
            renderer.stop();
            renderer = null;
        }
        renderer = buildLayout();
        if (lastData) {
            renderer.setData(lastData);
        }
        renderer.render();
    });
    document.querySelector('.button.show').addEventListener('click', () => {
        document.documentElement.classList.remove('hidden');
        if (common.isElectron) {
            document.documentElement.classList.remove('auto-hidden');
            autoHidden = false;
            common.rpc('showAllWindows');
        }
    });
    document.querySelector('.button.hide').addEventListener('click', () => {
        document.documentElement.classList.add('hidden');
        if (common.isElectron) {
            document.documentElement.classList.remove('auto-hidden');
            autoHidden = false;
            common.rpc('hideAllWindows');
        }
    });
    if (common.isElectron) {
        document.querySelector('.button.quit').addEventListener('click', () => common.rpc('quit'));
    }

    let autoHidden;
    function autoHide() {
        autoHidden = true;
        document.documentElement.classList.add('auto-hidden', 'hidden');
        console.debug("Auto hidding windows");
        common.rpc('hideAllWindows', {autoHide: true});
    }

    function autoShow() {
        autoHidden = false;
        document.documentElement.classList.remove('auto-hidden', 'hidden');
        console.debug("Auto showing windows");
        common.rpc('showAllWindows', {autoHide: true});
    }

    const autoHideWait = 2500;
    if (common.isElectron && settings.autoHideWindows) {
        autoHideTimeout = setTimeout(autoHide, autoHideWait);
    }
    let lastUpdate = 0;
    common.subscribe('watching', watching => {
        if (common.isElectron && settings.autoHideWindows &&
            (watching.speed || watching.cadence || watching.power)) {
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
    renderer.render();
}


function buildLayout() {
    const content = document.querySelector('#content');
    const renderer = new common.Renderer(content, {locked: settings.lockedFields});
    let count = 1;
    for (const side of ['left', 'right']) {
        const fields = document.querySelector(`.fields.${side}`);
        const mapping = [];
        fields.innerHTML = '';
        for (let i = 0; i < settings[`${side}Fields`]; i++) {
            const id = `${side}-${i}`;
            fields.insertAdjacentHTML('beforeend', `
                <div class="field" data-field="${id}">
                    <div class="key"></div><div class="value"></div><abbr class="unit"></abbr>
                </div>
            `);
            mapping.push({id, default: count++});
        }
        renderer.addRotatingFields({
            mapping,
            fields: [{
                value: x => H.timer(x && x.laps && x.laps.at(-1).elapsed),
                key: () => 'Lap Time',
            }, {
                value: x => H.timer(x && x.stats && x.stats.elapsed),
                key: () => 'Time',
            }, {
                value: x => H.number(x && x.rideons),
                key: () => 'Ride Ons',
            }, {
                value: x => H.number(x && x.kj),
                key: () => 'Energy',
                unit: () => 'kJ',
            }, {
                value: x => H.number(x && x.stats && x.stats.power.tss),
                key: () => 'TSS',
            }, {
                value: x => H.weight(x && x.athlete && x.athlete.weight),
                key: () => 'Weight',
                unit: () => imperial ? 'lbs' : 'kg',
            }, {
                value: x => H.number(x && x.athlete && x.athlete.ftp),
                key: () => 'FTP',
                unit: () => 'w'
            }, {
                value: x => H.pace(x && x.speed),
                key: () => 'Speed',
                unit: () => imperial ? 'mph' : 'kph',
            }, {
                value: x => H.pace(x && x.stats && x.stats.speed.avg),
                key: () => 'Speed <small>(avg)</small>',
                unit: () => imperial ? 'mph' : 'kph',
            }, {
                value: x => H.pace(x && x.stats && x.stats.speed.smooth[60]),
                key: () => `Speed <small>(${shortDuration(60)})</small>`,
                unit: () => imperial ? 'mph' : 'kph',
            }, {
                value: x => H.number(x && x.heartrate),
                key: () => 'HR',
                unit: () => 'bpm',
            }, {
                value: x => H.number(x && x.stats && x.stats.hr.avg),
                key: () => 'HR <small>(avg)</small>',
                unit: () => 'bpm',
            }, {
                value: x => H.number(x && x.stats && x.stats.hr.smooth[60]),
                key: () => `HR <small>(${shortDuration(60)})</small>`,
                unit: () => 'bpm',
            }, {
                value: x => H.number(x && x.power),
                key: () => `Power`,
                unit: () => 'w',
            }, {
                value: x => H.number(x && x.stats && x.stats.power.smooth[5]),
                key: () => `Power <small>(${shortDuration(5)})</small>`,
                unit: () => 'w',
            }, {
                value: x => H.number(x && x.stats && x.stats.power.smooth[15]),
                key: () => `Power <small>(${shortDuration(15)})</small>`,
                unit: () => 'w',
            }, {
                value: x => H.number(x && x.stats && x.stats.power.smooth[60]),
                key: () => `Power <small>(${shortDuration(60)})</small>`,
                unit: () => 'w',
            }, {
                value: x => H.number(x && x.stats && x.stats.power.smooth[300]),
                key: () => `Power <small>(${shortDuration(300)})</small>`,
                unit: () => 'w',
            }, {
                value: x => H.number(x && x.stats && x.stats.power.smooth[1200]),
                key: () => `Power <small>(${shortDuration(1200)})</small>`,
                unit: () => 'w',
            }, {
                value: x => H.number(x && x.stats && x.stats.power.peaks[5].avg),
                key: () => `Peak Power <small>(${shortDuration(5)})</small>`,
                unit: () => 'w',
            }, {
                value: x => H.number(x && x.stats && x.stats.power.peaks[15].avg),
                key: () => `Peak Power <small>(${shortDuration(15)})</small>`,
                unit: () => 'w',
            }, {
                value: x => H.number(x && x.stats && x.stats.power.peaks[60].avg),
                key: () => `Peak Power <small>(${shortDuration(60)})</small>`,
                unit: () => 'w',
            }, {
                value: x => H.number(x && x.stats && x.stats.power.peaks[300].avg),
                key: () => `Peak Power <small>(${shortDuration(300)})</small>`,
                unit: () => 'w',
            }, {
                value: x => H.number(x && x.stats && x.stats.power.peaks[1200].avg),
                key: () => `Peak Power <small>(${shortDuration(1200)})</small>`,
                unit: () => 'w',
            }, {
                value: x => H.number(x && x.stats && x.stats.power.avg),
                key: () => 'Power <small>(avg)</small>',
                unit: () => 'w',
            }, {
                value: x => H.number(x && x.stats && x.stats.power.np),
                key: () => 'NP',
            }, {
                value: x => H.number(x && x.stats && x.stats.power.max),
                key: () => 'Power <small>(max)</small>',
                unit: () => 'w',
            }],
        });
    }
    renderer.render();
    return renderer;
}


export async function settingsMain() {
    common.initInteractionListeners();
    const version = await common.rpc('getVersion');
    await common.initAppSettingsForm('form.app-settings');
    await common.initSettingsForm('form.settings', {settingsKey, extraData: {version}});
}
