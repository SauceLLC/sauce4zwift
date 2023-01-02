import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';

const doc = document.documentElement;
const L = sauce.locale;
const H = L.human;
let imperial = !!common.storage.get('/imperialUnits');
L.setImperial(imperial);
let eventMetric;
let sport = 'cycling';

common.settingsStore.setDefault({
    leftFields: 2,
    rightFields: 2,
    lockedFields: false,
    autoHideWindows: false,
    centerGapSize: 0,
});


function isRealNumber(v) {
    return !(v == null || v === Infinity || v === -Infinity || isNaN(v));
}


function fmtPace(x) {
    return H.pace(x, {sport, precision: 1});
}


function speedUnit() {
    return sport === 'running' ? imperial ? '/mi' : '/km' : imperial ? 'mph' : 'kph';
}


function speedLabel() {
    return sport === 'running' ? 'Pace' : 'Speed';
}


function shortDuration(x) {
    return H.duration(x, {short: true});
}

const unit = x => `<abbr class="unit">${x}</abbr>`;


function fmtDist(v) {
    if (!isRealNumber(v)) {
        return '-';
    } else if (Math.abs(v) < 1000) {
        const suffix = unit(imperial ? 'ft' : 'm');
        return H.number(imperial ? v / L.metersPerFoot : v) + suffix;
    } else {
        return H.distance(v, {precision: 1, suffix: true, html: true});
    }
}


function fmtElevation(v) {
    if (!isRealNumber(v)) {
        return '-';
    }
    const suffix = unit(imperial ? 'ft' : 'm');
    return H.number(imperial ? v / L.metersPerFoot : v) + suffix;
}


function fmtDur(v) {
    if (!isRealNumber(v)) {
        return '-';
    }
    return H.timer(v, {long: true});
}


function fmtWkg(p, athlete) {
    if (!isRealNumber(p) || !athlete || !athlete.ftp) {
        return '-';
    }
    return H.number(p / athlete.weight, {precision: 1, fixed: true});
}


function fmtPct(p) {
    if (!isRealNumber(p)) {
        return '-';
    }
    return H.number(p * 100) + unit('%');
}

function fmtLap(v) {
    if (!isRealNumber(v)) {
        return '-';
    }
    return H.number(v + 1);
}

const _events = new Map();
function getEventSubgroup(id) {
    if (!_events.has(id)) {
        _events.set(id, null);
        common.rpc.getEventSubgroup(id).then(x => {
            if (x) {
                _events.set(id, x);
            } else {
                // leave it null but allow retry later
                setTimeout(() => _events.delete(id), 30000);
            }
        });
    }
    return _events.get(id);
}


export async function main() {
    common.initInteractionListeners();
    let lastData;
    let autoHideTimeout;
    doc.style.setProperty('--center-gap-size', common.settingsStore.get('centerGapSize') + 'px');
    let renderer = buildLayout();
    common.settingsStore.addEventListener('changed', ev => {
        for (const [k, v] of ev.data.changed.entries()) {
            if (k === '/imperialUnits') {
                imperial = v;
                L.setImperial(imperial);
                renderer.render();
                return;
            } else if (k === 'autoHideWindows') {
                location.reload();  // Avoid state machine complications.
                return;
            } else if (k === 'centerGapSize') {
                console.log("set gap", v);
                doc.style.setProperty('--center-gap-size', `${v}px`);
                renderer.render({force: true});
                return;
            }
        }
        if (renderer) {
            renderer.stop();
            renderer = null;
        }
        renderer = buildLayout();
        renderer.setData(lastData || {});
        renderer.render();
    });
    document.querySelector('.button.show').addEventListener('click', () => {
        doc.classList.remove('hidden');
        if (window.isElectron) {
            doc.classList.remove('auto-hidden');
            autoHidden = false;
            common.rpc.showAllWindows();
        }
    });
    document.querySelector('.button.hide').addEventListener('click', () => {
        doc.classList.add('hidden');
        if (window.isElectron) {
            doc.classList.remove('auto-hidden');
            autoHidden = false;
            common.rpc.hideAllWindows();
        }
    });
    if (window.isElectron) {
        document.querySelector('.button.quit').addEventListener('click', () => common.rpc.quit());
    }

    let autoHidden;
    function autoHide() {
        autoHidden = true;
        doc.classList.add('auto-hidden', 'hidden');
        console.debug("Auto hidding windows");
        common.rpc.hideAllWindows({autoHide: true});
    }

    function autoShow() {
        autoHidden = false;
        doc.classList.remove('auto-hidden', 'hidden');
        console.debug("Auto showing windows");
        common.rpc.showAllWindows({autoHide: true});
    }

    const autoHideWait = 4000;
    if (window.isElectron && common.settingsStore.get('autoHideWindows')) {
        autoHideTimeout = setTimeout(autoHide, autoHideWait);
    }
    let lastUpdate = 0;
    common.subscribe('athlete/watching', watching => {
        if (window.isElectron && common.settingsStore.get('autoHideWindows') &&
            (watching.state.speed || watching.state.cadence || watching.state.power)) {
            clearTimeout(autoHideTimeout);
            if (autoHidden) {
                autoShow();
            }
            autoHideTimeout = setTimeout(autoHide, autoHideWait);
        }
        lastData = watching;
        if (watching.state.eventSubgroupId) {
            watching.eventSubgroup = getEventSubgroup(watching.state.eventSubgroupId);
        }
        sport = watching.state.sport || 'cycling';
        eventMetric = watching.remainingMetric;
        renderer.setData(watching);
        const ts = Date.now();
        if (ts - lastUpdate > 500) {
            lastUpdate = ts;
            renderer.render();
        }
    }, {persistent: true});  // Prevent autohide when offscreen
    renderer.setData({});
    renderer.render();
}


function buildLayout() {
    const content = document.querySelector('#content');
    const renderer = new common.Renderer(content, {
        locked: common.settingsStore.get('lockedFields'),
        id: 'normal',
    });
    const defaults = {
        'left-0': 'rideons',
        'left-1': 'energy',
        'right-0': 'pwr-np',
        'right-1': 'wbal',
    };
    for (const side of ['left', 'right']) {
        const fields = document.querySelector(`.fields.${side}`);
        const mapping = [];
        fields.innerHTML = '';
        for (let i = 0; i < common.settingsStore.get(`${side}Fields`); i++) {
            const id = `${side}-${i}`;
            fields.insertAdjacentHTML('beforeend', `
                <div class="field" data-field="${id}">
                    <div class="key"></div><div class="value"></div><abbr class="unit"></abbr>
                </div>
            `);
            mapping.push({id, default: defaults[id] || 'time-elapsed'});
        }
        renderer.addRotatingFields({
            mapping,
            fields: [{
                id: 'time-elapsed',
                value: x => fmtDur(x.stats && x.stats.elapsedTime || 0),
                key: 'Elapsed',
            }, {
                id: 'time-session',
                value: x => fmtDur(x.state && x.state.time || 0),
                key: 'Time',
            }, {
                id: 'time-lap',
                value: x => fmtDur((x.lap || x.stats) && (x.lap || x.stats).elapsedTime || 0),
                key: 'Time <small>(lap)</small>',
            }, {
                id: 'clock',
                value: x => new Date().toLocaleTimeString(),
                key: '',
            }, {
                id: 'team',
                value: x => x.athlete && common.teamBadge(x.athlete.team) || '-',
                key: x => (x && x.athlete && x.athlete.team) ? '' : 'Team',
            }, {
                id: 'level',
                value: x => H.number(x.athlete && x.athlete.level),
                key: 'Level',
            }, {
                id: 'rideons',
                value: x => H.number(x.state && x.state.rideons),
                key: 'Ride Ons',
            }, {
                id: 'energy',
                value: x => H.number(x.state && x.state.kj),
                key: 'Energy',
                unit: 'kJ',
            }, {
                id: 'wbal',
                value: x => (x.stats && x.stats.power.wBal != null && x.athlete && x.athlete.wPrime) ?
                    common.fmtBattery(x.stats.power.wBal / x.athlete.wPrime) +
                        H.number(x.stats.power.wBal / 1000, {precision: 1}) : '-',
                key: 'W\'bal',
                unit: 'kJ',
            }, {
                id: 'tss',
                value: x => H.number(x.stats && x.stats.power.tss),
                key: 'TSS',
            }, {
                id: 'weight',
                value: x => H.weightClass(x.athlete && x.athlete.weight),
                key: 'Weight',
                unit: () => imperial ? 'lbs' : 'kg',
            }, {
                id: 'ftp',
                value: x => H.number(x.athlete && x.athlete.ftp),
                key: 'FTP',
                unit: 'w'
            }, {
                id: 'spd-cur',
                value: x => fmtPace(x.state && x.state.speed),
                key: speedLabel,
                unit: speedUnit,
            }, {
                id: 'spd-smooth-60',
                value: x => fmtPace(x.stats && x.stats.speed.smooth[60]),
                key: () => `${speedLabel()} <small>(${shortDuration(60)})</small>`,
                unit: speedUnit,
            }, {
                id: 'spd-avg',
                value: x => fmtPace(x.stats && x.stats.speed.avg),
                key: () => `${speedLabel()} <small>(avg)</small>`,
                unit: speedUnit,
            }, {
                id: 'spd-lap',
                value: x => fmtPace(x.lap && x.lap.speed.avg),
                key: () => `${speedLabel()} <small>(lap)</small>`,
                unit: speedUnit,
            }, {
                id: 'hr-cur',
                value: x => H.number(x.state && x.state.heartrate),
                key: 'HR',
                unit: 'bpm',
            }, {
                id: 'hr-smooth-60',
                value: x => H.number(x.stats && x.stats.hr.smooth[60]),
                key: `HR <small>(${shortDuration(60)})</small>`,
                unit: 'bpm',
            }, {
                id: 'hr-avg',
                value: x => H.number(x.stats && x.stats.hr.avg),
                key: 'HR <small>(avg)</small>',
                unit: 'bpm',
            }, {
                id: 'hr-lap',
                value: x => H.number(x.lap && x.lap.hr.avg),
                key: 'HR <small>(lap)</small>',
                unit: 'bpm',
            }, {
                id: 'pwr-cur',
                value: x => H.number(x.state && x.state.power),
                key: `Power`,
                unit: 'w',
            }, {
                id: 'pwr-cur-wkg',
                value: x => fmtWkg(x.state && x.state.power, x.athlete),
                key: `W/kg`,
            }, {
                id: 'pwr-smooth-5',
                value: x => H.number(x.stats && x.stats.power.smooth[5]),
                key: `Power <small>(${shortDuration(5)})</small>`,
                unit: 'w',
            }, {
                id: 'pwr-smooth-5-wkg',
                value: x => fmtWkg(x.stats && x.stats.power.smooth[5], x.athlete),
                key: `W/kg <small>(${shortDuration(5)})</small>`,
            }, {
                id: 'pwr-smooth-15',
                value: x => H.number(x.stats && x.stats.power.smooth[15]),
                key: `Power <small>(${shortDuration(15)})</small>`,
                unit: 'w',
            }, {
                id: 'pwr-smooth-15-wkg',
                value: x => fmtWkg(x.stats && x.stats.power.smooth[15], x.athlete),
                key: `W/kg <small>(${shortDuration(15)})</small>`,
            }, {
                id: 'pwr-smooth-60',
                value: x => H.number(x.stats && x.stats.power.smooth[60]),
                key: `Power <small>(${shortDuration(60)})</small>`,
                unit: 'w',
            }, {
                id: 'pwr-smooth-60-wkg',
                value: x => fmtWkg(x.stats && x.stats.power.smooth[60], x.athlete),
                key: `W/kg <small>(${shortDuration(60)})</small>`,
            }, {
                id: 'pwr-smooth-300',
                value: x => H.number(x.stats && x.stats.power.smooth[300]),
                key: `Power <small>(${shortDuration(300)})</small>`,
                unit: 'w',
            }, {
                id: 'pwr-smooth-300-wkg',
                value: x => fmtWkg(x.stats && x.stats.power.smooth[300], x.athlete),
                key: `W/kg <small>(${shortDuration(300)})</small>`,
            }, {
                id: 'pwr-smooth-1200',
                value: x => H.number(x.stats && x.stats.power.smooth[1200]),
                key: `Power <small>(${shortDuration(1200)})</small>`,
                unit: 'w',
            }, {
                id: 'pwr-smooth-1200-wkg',
                value: x => fmtWkg(x.stats && x.stats.power.smooth[1200], x.athlete),
                key: `W/kg <small>(${shortDuration(1200)})</small>`,
            }, {
                id: 'pwr-peak-5',
                value: x => H.number(x.stats && x.stats.power.peaks[5].avg),
                key: `Peak Power <small>(${shortDuration(5)})</small>`,
                unit: 'w',
            }, {
                id: 'pwr-peak-5-wkg',
                value: x => fmtWkg(x.stats && x.stats.power.peaks[5].avg, x.athlete),
                key: `Peak W/kg <small>(${shortDuration(5)})</small>`,
            }, {
                id: 'pwr-peak-15',
                value: x => H.number(x.stats && x.stats.power.peaks[15].avg),
                key: `Peak Power <small>(${shortDuration(15)})</small>`,
                unit: 'w',
            }, {
                id: 'pwr-peak-15-wkg',
                value: x => fmtWkg(x.stats && x.stats.power.peaks[15].avg, x.athlete),
                key: `Peak W/kg <small>(${shortDuration(15)})</small>`,
            }, {
                id: 'pwr-peak-60',
                value: x => H.number(x.stats && x.stats.power.peaks[60].avg),
                key: `Peak Power <small>(${shortDuration(60)})</small>`,
                unit: 'w',
            }, {
                id: 'pwr-peak-60-wkg',
                value: x => fmtWkg(x.stats && x.stats.power.peaks[60].avg, x.athlete),
                key: `Peak W/kg <small>(${shortDuration(60)})</small>`,
            }, {
                id: 'pwr-peak-300',
                value: x => H.number(x.stats && x.stats.power.peaks[300].avg),
                key: `Peak Power <small>(${shortDuration(300)})</small>`,
                unit: 'w',
            }, {
                id: 'pwr-peak-300-wkg',
                value: x => fmtWkg(x.stats && x.stats.power.peaks[300].avg, x.athlete),
                key: `Peak W/kg <small>(${shortDuration(300)})</small>`,
            }, {
                id: 'pwr-peak-1200',
                value: x => H.number(x.stats && x.stats.power.peaks[1200].avg),
                key: `Peak Power <small>(${shortDuration(1200)})</small>`,
                unit: 'w',
            }, {
                id: 'pwr-peak-1200-wkg',
                value: x => fmtWkg(x.stats && x.stats.power.peaks[1200].avg, x.athlete),
                key: `Peak W/kg <small>(${shortDuration(1200)})</small>`,
            }, {
                id: 'pwr-avg',
                value: x => H.number(x.stats && x.stats.power.avg),
                key: 'Power <small>(avg)</small>',
                unit: 'w',
            }, {
                id: 'pwr-avg-wkg',
                value: x => fmtWkg(x.stats && x.stats.power.avg, x.athlete),
                key: 'W/kg <small>(avg)</small>',
            }, {
                id: 'pwr-lap',
                value: x => H.number(x.lap && x.lap.power.avg),
                key: 'Power <small>(lap)</small>',
                unit: 'w',
            }, {
                id: 'pwr-lap-wkg',
                value: x => fmtWkg(x.lap && x.lap.power.avg, x.athlete),
                key: 'W/kg <small>(lap)</small>',
            }, {
                id: 'pwr-np',
                value: x => H.number(x.stats && x.stats.power.np),
                key: 'NP',
            }, {
                id: 'pwr-if',
                value: x => fmtPct((x.stats && x.stats.power.np || 0) / (x.athlete && x.athlete.ftp)),
                key: 'IF',
            }, {
                id: 'pwr-vi',
                value: x => H.number(x.stats && x.stats.power.np / x.stats.power.avg, {precision: 2, fixed: true}),
                key: 'VI',
            }, {
                id: 'pwr-max',
                value: x => H.number(x.stats && x.stats.power.max),
                key: 'Power <small>(max)</small>',
                unit: 'w',
            }, {
                id: 'draft-cur',
                value: x => fmtPct(x.state && x.state.draft / 100),
                key: 'Draft',
            }, {
                id: 'draft-avg',
                value: x => fmtPct(x.stats && x.stats.draft.avg / 100),
                key: 'Draft <small>(avg)</small>',
            }, {
                id: 'draft-lap',
                value: x => fmtPct(x.lap && x.lap.draft.avg / 100),
                key: 'Draft <small>(lap)</small>',
            }, {
                id: 'cad-cur',
                value: x => H.number(x.state && x.state.cadence),
                key: 'Cadence',
                unit: () => sport === 'running' ? 'spm' : 'rpm',
            }, {
                id: 'cad-avg',
                value: x => H.number(x.stats && x.stats.cadence.avg),
                key: 'Cadence <small>(avg)</small>',
                unit: () => sport === 'running' ? 'spm' : 'rpm',
            }, {
                id: 'cad-lap',
                value: x => H.number(x.lap && x.lap.cadence.avg),
                key: 'Cadence <small>(lap)</small>',
                unit: () => sport === 'running' ? 'spm' : 'rpm',
            }, {
                id: 'ev-place',
                value: x => x.eventPosition ? `${H.place(x.eventPosition, {html: true})}/<small>${x.eventParticipants}</small>`: '-',
                key: 'Place',
            }, {
                id: 'ev-fin',
                value: x => eventMetric ? eventMetric === 'distance' ? fmtDist(x.remaining) : fmtDur(x.remaining) : '-',
                key: 'Finish',
            }, {
                id: 'ev-dst',
                tooltip: () => 'far spray',
                value: x => x.state ? (eventMetric === 'distance' ?
                    `${fmtDist(x.state.eventDistance)}/${fmtDist(x.state.eventDistance + x.remaining)}` :
                    fmtDist(x.state.eventDistance)) : '-',
                key: () => eventMetric ? 'Dist <small>(event)</small>' : 'Dist <small>(session)</small>',
            }, {
                id: 'dst',
                value: x => fmtDist(x.state && x.state.distance),
                key: 'Dist',
            }, {
                id: 'game-laps',
                value: x => fmtLap(x.state && x.state.laps || null),
                tooltip: 'Zwift route lap number',
                key: 'Lap <small>(zwift)</small>',
            }, {
                id: 'sauce-laps',
                value: x => fmtLap(x.lapCount - 1),
                tooltip: 'Sauce stats lap number',
                key: 'Lap <small>(sauce)</small>',
            }, {
                id: 'progress',
                value: x => fmtPct(x.state && x.state.progress || 0),
                key: 'Route',
            },{
                id: 'ev-name',
                value: x => x.eventSubgroup ? x.eventSubgroup.name : '-',
                key: x => (x && x.eventSubgroup) ? '' : 'Event',
            }, {
                id: 'rt-name',
                value: x => x.eventSubgroup ?
                    ((x.eventSubgroup.laps && x.eventSubgroup.laps > 1) ? `${x.eventSubgroup.laps} x ` : '') +
                    x.eventSubgroup.route.name : '-',
                key: x => (x && x.eventSubgroup) ? '' : 'Route',
            }, {
                id: 'el-gain',
                value: x => fmtElevation(x.state && x.state.climbing),
                key: 'Climbed',
            }],
        });
    }
    return renderer;
}


async function renderProfiles() {
    const profiles = await common.rpc.getProfiles();
    const el = document.querySelector('#windows');
    el.querySelector('table.profiles tbody').innerHTML = profiles.map(x => {
        return `
            <tr data-id="${x.id}" class="profile ${x.active ? 'active' : 'closed'}">
                <td class="name">${common.stripHTML(x.name)}<a class="link profile-edit-name"
                    title="Edit name"><ms>edit</ms></a></td>
                <td class="windows">${H.number(Object.keys(x.windows).length)}</td>
                <td class="btn">${x.active ? 'Current' : '<a class="link profile-select">Activate</a>'}</td>
                <td class="btn" title="Export this profile to a file"
                    ><a class="link profile-export"><ms>download</ms></a></td>
                <td class="btn" title="Duplicate this profile"
                    ><a class="link profile-clone"><ms>file_copy</ms></a></td>
                <td class="btn" title="Delete this profile"
                    ><a class="link danger profile-delete"><ms>delete_forever</ms></a></td>
            </tr>
        `;
    }).join('\n');
}


async function renderAvailableMods() {
    const mods = await common.rpc.getAvailableMods();
    const el = document.querySelector('#mods-container');
    if (!mods || !mods.length) {
        el.innerHTML = '<i>No mods detected</i>';
        return;
    }
    const html = [];
    const ids = {};
    for (const {manifest, id, enabled} of mods) {
        if (!manifest) {
            continue;
        }
        const safeId = common.sanitizeAttr(id);
        ids[safeId] = id;
        html.push(`
            <div class="mod" data-id="${safeId}">
                <div class="title">
                    <div>
                        <span class="name">${common.stripHTML(manifest.name)}</span>
                        <span class="version">(v${manifest.version})</span>
                    </div>
                    <label class="enabled">
                        Enabled
                        <input type="checkbox" ${enabled ? 'checked' : ''}/>
                        <span class="restart-required">Restart Required</span>
                    </label>
                </div>
                <div class="info">${common.stripHTML(manifest.description)}</div>
        `);
        if (manifest.author || manifest.website_url) {
            html.push('<div class="pb">');
            if (manifest.author) {
                html.push(`<div class="author">Author: ${common.stripHTML(manifest.author)}</div>`);
            }
            if (manifest.website_url) {
                const url = common.sanitizeAttr(common.stripHTML(manifest.website_url));
                html.push(`<div class="website"><a href="${url}"
                    target="_blank" external>Website <ms>open_in_new</ms></a></div>`);
            }
            html.push('</div>');
        }
        html.push(`</div>`);
    }
    el.innerHTML = html.join('');
    el.addEventListener('click', async ev => {
        const label = ev.target.closest('label.enabled');
        if (!label) {
            return;
        }
        const enabled = label.querySelector('input').checked;
        const id = ids[ev.target.closest('.mod[data-id]').dataset.id];
        await common.rpc.setModEnabled(id, enabled);
        label.querySelector('.restart-required').style.display = 'initial';
    });
}


async function renderWindows() {
    const windows = Object.values(await common.rpc.getWindows()).filter(x => !x.private);
    const manifests = await common.rpc.getWindowManifests();
    const el = document.querySelector('#windows');
    const descs = Object.fromEntries(manifests.map(x => [x.type, x]));
    windows.sort((a, b) => !!a.closed - !!b.closed);
    el.querySelector('table.active-windows tbody').innerHTML = windows.map(x => {
        const desc = descs[x.type] || {
            prettyName: `Unknown window: ${x.type}`,
            prettyDesc: common.sanitizeAttr(JSON.stringify(x, null, 4)),
        };
        return `
            <tr data-id="${x.id}" class="window ${x.closed ? 'closed' : 'open'}"
                title="${common.sanitizeAttr(desc.prettyDesc)}\n\nDouble click/tap to ${x.closed ? 'reopen' : 'focus'}">
                <td class="name">${common.stripHTML(x.customName || desc.prettyName)}<a class="link win-edit-name"
                    title="Edit name"><ms>edit</ms></a></td>
                <td class="state">${x.closed ? 'Closed' : 'Open'}</td>
                <td class="btn"><a title="Reopen this window" class="link win-restore"
                    ><ms>add_box</ms></a></td>
                <td class="btn" title="Delete this window and its settings"
                    ><a class="link danger win-delete"><ms>delete_forever</ms></a></td>
            </tr>
        `;
    }).join('\n');
    const mGroups = new Map();
    for (const m of manifests.filter(x => !x.private)) {
        if (!mGroups.has(m.groupTitle)) {
            mGroups.set(m.groupTitle, []);
        }
        mGroups.get(m.groupTitle).push(m);
    }
    el.querySelector('.add-new select').innerHTML = Array.from(mGroups.entries()).map(([title, ms]) =>
        `<optgroup label="${common.sanitizeAttr(common.stripHTML(title || 'Main'))}">${ms.map(x =>
            `<option title="${common.sanitizeAttr(common.stripHTML(x.prettyDesc))}"
                     value="${x.type}">${common.stripHTML(x.prettyName)}</option>`)}</optgroup>`
    ).join('');
}


async function frank() {
    const bubble = document.createElement('div');
    const img = document.createElement('img');
    img.src = 'images/great_and_powerful.webp';
    img.classList.add('great-and-powerful');
    img.addEventListener('load', () => {
        img.classList.add('approves');
        bubble.classList.add('approves');
    });
    bubble.classList.add('great-and-powerful-bubble');
    const words = document.createElement('div');
    words.classList.add('words');
    bubble.append(words);
    words.textContent = 'The great and powerful Frank approves of your life choices!!!';
    const aud = document.createElement('audio');
    aud.innerHTML = `<source src="sounds/great_and_powerful.ogg" type="audio/ogg"/>`;
    aud.autoplay = true;
    document.body.append(img);
    document.body.append(bubble);
    document.body.append(aud);
    let active = true;
    setTimeout(() => {
        active = false;
        img.remove();
        bubble.remove();
        aud.remove();
    }, 110 * 1000);
    await sauce.sleep(12000);
    words.textContent = 'Let us celebrate this joyous occasion with my favorite song!';
    await sauce.sleep(19000);
    words.textContent = 'Now we Disco!';
    await sauce.sleep(2800);
    let discos = 1;
    while (active) {
        words.textContent = '';
        await sauce.sleep(60);
        if (discos++ > 10) {
            discos = 1;
        }
        for (let i = 0; i < discos; i++) {
            words.textContent += ' DISCO! ';
        }
        await sauce.sleep(400);
    }
}


async function initWindowsPanel() {
    await Promise.all([
        renderProfiles(),
        renderWindows(),
        renderAvailableMods(),
    ]);
    const winsEl = document.querySelector('#windows');
    winsEl.addEventListener('submit', ev => ev.preventDefault());
    winsEl.addEventListener('click', async ev => {
        const link = ev.target.closest('table a.link');
        if (!link) {
            return;
        }
        const id = ev.target.closest('[data-id]').dataset.id;
        if (link.classList.contains('win-restore')) {
            await common.rpc.openWindow(id);
        } else if (link.classList.contains('profile-select')) {
            await common.rpc.activateProfile(id);
            await renderProfiles();
            await renderWindows();
        } else if (link.classList.contains('win-delete')) {
            await common.rpc.removeWindow(id);
        } else if (link.classList.contains('profile-delete')) {
            await common.rpc.removeProfile(id).catch(e => alert(`Remove Error\n\n${e.message}`));
            await renderProfiles();
        } else if (link.classList.contains('profile-clone')) {
            await common.rpc.cloneProfile(id).catch(e => alert(`Clone Error\n\n${e.message}`));
            await renderProfiles();
        } else if (link.classList.contains('profile-export')) {
            const data = await common.rpc.exportProfile(id);
            const f = new File([JSON.stringify(data)], `${data.profile.name}.json`, {type: 'application/json'});
            const l = document.createElement('a');
            l.download = f.name;
            l.style.display = 'none';
            l.href = URL.createObjectURL(f);
            try {
                document.body.appendChild(l);
                l.click();
            } finally {
                URL.revokeObjectURL(l.href);
                l.remove();
            }
        } else if (link.classList.contains('win-edit-name')) {
            const td = ev.target.closest('td');
            const input = document.createElement('input');
            input.value = td.childNodes[0].textContent;
            input.title = 'Press Enter to save or Escape';
            td.innerHTML = '';
            td.appendChild(input);
            input.focus();
            let actionTaken;
            const save = async () => {
                if (actionTaken) {
                    return;
                }
                actionTaken = true;
                const customName = common.sanitize(input.value);
                await common.rpc.updateWindow(id, {customName});
                await renderWindows();
                if (customName.match(/frank/i)) {
                    frank();
                }
            };
            input.addEventListener('blur', save);
            input.addEventListener('keydown', ev => {
                if (ev.code === 'Enter') {
                    save();
                } if (ev.code === 'Escape') {
                    actionTaken = true;
                    renderWindows();
                }
            });
        } else if (link.classList.contains('profile-edit-name')) {
            const td = ev.target.closest('td');
            const input = document.createElement('input');
            input.value = td.childNodes[0].textContent;
            input.title = 'Press Enter to save or Escape';
            td.innerHTML = '';
            td.appendChild(input);
            input.focus();
            let actionTaken;
            const save = async () => {
                if (actionTaken) {
                    return;
                }
                actionTaken = true;
                const name = common.sanitize(input.value);
                await common.rpc.renameProfile(id, name);
                await renderProfiles();
            };
            input.addEventListener('blur', save);
            input.addEventListener('keydown', ev => {
                if (ev.code === 'Enter') {
                    save();
                } if (ev.code === 'Escape') {
                    actionTaken = true;
                    renderProfiles();
                }
            });
        }
    });
    winsEl.querySelector('table.active-windows tbody').addEventListener('dblclick', async ev => {
        const row = ev.target.closest('tr[data-id]');
        if (!row || ev.target.closest('a.link.delete') || ev.target.closest('input')) {
            return;
        }
        const id = row.dataset.id;
        if (row.classList.contains('closed')) {
            await common.rpc.openWindow(id);
        } else {
            await common.rpc.highlightWindow(id);
        }
    });
    winsEl.querySelector('.add-new input[type="button"]').addEventListener('click', async ev => {
        ev.preventDefault();
        const type = ev.currentTarget.closest('.add-new').querySelector('select').value;
        const id = await common.rpc.createWindow({type});
        await common.rpc.openWindow(id);
    });
    winsEl.addEventListener('click', async ev => {
        const btn = ev.target.closest('.button[data-action]');
        if (!btn) {
            return;
        }
        if (btn.dataset.action === 'profile-create') {
            await common.rpc.createProfile();
            await renderProfiles();
        } else if (btn.dataset.action === 'profile-import') {
            const fileEl = document.createElement('input');
            fileEl.type = 'file';
            fileEl.accept='.json';
            fileEl.addEventListener('change', async ev => {
                fileEl.remove();
                const f = fileEl.files[0];
                if (!f) {
                    return;
                }
                try {
                    const data = JSON.parse(await f.text());
                    await common.rpc.importProfile(data);
                    await renderProfiles();
                    alert(`Successfully Imported: \n\n${data.profile.name}`);
                } catch(e) {
                    alert(`Import Error\n\n${e.message}`);
                    throw e;
                }
            });
            document.body.append(fileEl);
            fileEl.click();
        }
    });
}


export async function settingsMain() {
    common.initInteractionListeners();
    const extraData = {version: await common.rpc.getVersion()};
    document.addEventListener('click', async ev => {
        const btn = ev.target.closest('.button[data-action]');
        if (!btn) {
            return;
        }
        if (btn.dataset.action === 'reset-state') {
            await common.rpc.resetStorageState();
        } else if (btn.dataset.action === 'reset-athletes-db') {
            await common.rpc.resetAthletesDB();
        } else if (btn.dataset.action === 'restart') {
            await common.rpc.restart();
        } else if (btn.dataset.action === 'logout-zwift') {
            const id = btn.dataset.id;
            await common.rpc.zwiftLogout(id);
            extraData[`${id}ZwiftLogin`] = '<LOGGED OUT>';
            btn.closest('label').classList.add('edited');
            btn.remove();
            await appSettingsUpdate(extraData);
        }
    });
    common.subscribe('set-windows', renderWindows, {source: 'windows'});
    extraData.webServerURL = await common.rpc.getWebServerURL();
    const athlete = await common.rpc.getAthlete('self', {refresh: true, noWait: true});
    extraData.profileDesc = athlete && athlete.sanitizedFullname;
    if (athlete) {
        document.querySelector('img.avatar').src = athlete.avatar || 'images/blankavatar.png';
    }
    const appSettingsUpdate = common.initAppSettingsForm('form.app-settings');
    document.addEventListener('app-setting-set', ev => {
        if (ev.data.key === 'autoLapMetric') {
            extraData.autoLapIntervalUnits = ev.data.value === 'time' ? 'mins' : 'km';
            appSettingsUpdate(extraData);
        }
    });
    extraData.autoLapIntervalUnits = await common.rpc.getSetting('autoLapMetric') === 'time' ?
        'mins' : 'km';
    const gcs = await common.rpc.getGameConnectionStatus();
    if (gcs) {
        extraData.gameConnectionStatus = gcs.state;
        common.subscribe('status', async status => {
            extraData.gameConnectionStatus = status.state;
            await appSettingsUpdate(extraData);
        }, {source: 'gameConnection'});
    }
    extraData.gpuEnabled = await common.rpc.getLoaderSetting('gpuEnabled');
    document.querySelector('form').addEventListener('input', async ev => {
        const el = ev.target.closest('[data-store="loader"]');
        if (!el) {
            return;
        }
        ev.stopPropagation();
        el.closest('label').classList.add('edited');
        if (el.type === 'checkbox') {
            await common.rpc.setLoaderSetting(el.name, el.checked);
        } else {
            throw new TypeError("Unsupported");
        }
    }, {capture: true});
    const loginInfo = await common.rpc.getZwiftLoginInfo();
    extraData.mainZwiftLogin = loginInfo && loginInfo.main && loginInfo.main.username;
    extraData.monitorZwiftLogin = loginInfo && loginInfo.monitor && loginInfo.monitor.username;
    await appSettingsUpdate(extraData);
    await common.initSettingsForm('form.settings')();
    await initWindowsPanel();
}
