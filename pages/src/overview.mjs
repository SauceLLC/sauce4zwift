import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';

const doc = document.documentElement;
const L = sauce.locale;
const H = L.human;
let imperial = !!common.storage.get('/imperialUnits');
L.setImperial(imperial);

common.settingsStore.setDefault({
    leftFields: 2,
    rightFields: 2,
    lockedFields: false,
    autoHideWindows: false,
    centerGapSize: 0,
});


function shortDuration(x) {
    return H.duration(x, {short: true});
}

const unit = x => `<abbr class="unit">${x}</abbr>`;


function fmtDist(v) {
    if (v == null || v === Infinity || v === -Infinity || isNaN(v)) {
        return '-';
    } else if (Math.abs(v) < 1000) {
        const suffix = unit(imperial ? 'ft' : 'm');
        return H.number(imperial ? v / L.metersPerFoot : v) + suffix;
    } else {
        return H.distance(v, {precision: 1, suffix: true, html: true});
    }
}


function fmtDur(v) {
    if (v == null || v === Infinity || v === -Infinity || isNaN(v)) {
        return '-';
    }
    return H.timer(v);
}


function fmtWkg(p, athlete) {
    if (p == null || p === Infinity || p === -Infinity || isNaN(p) || !athlete || !athlete.ftp) {
        return '-';
    }
    return H.number(p / athlete.weight, {precision: 1, fixed: true});
}


function fmtPct(p) {
    if (p == null || p === Infinity || p === -Infinity || isNaN(p)) {
        return '-';
    }
    return H.number(p * 100) + unit('%');
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
        if (lastData) {
            renderer.setData(lastData);
        }
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
    const renderer = new common.Renderer(content, {locked: common.settingsStore.get('lockedFields')});
    let count = 1;
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
            mapping.push({id, default: count++});
        }
        renderer.addRotatingFields({
            mapping,
            fields: [{
                value: x => H.timer(x.laps && x.laps.at(-1).elapsed),
                key: () => 'Lap Time',
            }, {
                value: x => H.timer(x.stats && x.stats.elapsed),
                key: () => 'Time',
            }, {
                value: x => H.number(x.state && x.state.rideons),
                key: () => 'Ride Ons',
            }, {
                value: x => H.number(x.state && x.state.kj),
                key: () => 'Energy',
                unit: () => 'kJ',
            }, {
                value: x => (x.stats && x.stats.power.wBal != null && x.athlete && x.athlete.wPrime) ?
                    common.fmtBattery(x.stats.power.wBal / x.athlete.wPrime) +
                        H.number(x.stats.power.wBal / 1000, {precision: 1}) : '-',
                key: () => 'W\'bal',
                unit: () => 'kJ',
            }, {
                value: x => H.number(x.stats && x.stats.power.tss),
                key: () => 'TSS',
            }, {
                value: x => H.weightClass(x.athlete && x.athlete.weight),
                key: () => 'Weight',
                unit: () => imperial ? 'lbs' : 'kg',
            }, {
                value: x => H.number(x.athlete && x.athlete.ftp),
                key: () => 'FTP',
                unit: () => 'w'
            }, {
                value: x => H.pace(x.state && x.state.speed),
                key: () => 'Speed',
                unit: () => imperial ? 'mph' : 'kph',
            }, {
                value: x => H.pace(x.stats && x.stats.speed.avg),
                key: () => 'Speed <small>(avg)</small>',
                unit: () => imperial ? 'mph' : 'kph',
            }, {
                value: x => H.pace(x.stats && x.stats.speed.smooth[60]),
                key: () => `Speed <small>(${shortDuration(60)})</small>`,
                unit: () => imperial ? 'mph' : 'kph',
            }, {
                value: x => H.number(x.state && x.state.heartrate),
                key: () => 'HR',
                unit: () => 'bpm',
            }, {
                value: x => H.number(x.stats && x.stats.hr.avg),
                key: () => 'HR <small>(avg)</small>',
                unit: () => 'bpm',
            }, {
                value: x => H.number(x.stats && x.stats.hr.smooth[60]),
                key: () => `HR <small>(${shortDuration(60)})</small>`,
                unit: () => 'bpm',
            }, {
                value: x => H.number(x.state && x.state.power),
                key: () => `Power`,
                unit: () => 'w',
            }, {
                value: x => H.number(x.stats && x.stats.power.smooth[5]),
                key: () => `Power <small>(${shortDuration(5)})</small>`,
                unit: () => 'w',
            }, {
                value: x => H.number(x.stats && x.stats.power.smooth[15]),
                key: () => `Power <small>(${shortDuration(15)})</small>`,
                unit: () => 'w',
            }, {
                value: x => H.number(x.stats && x.stats.power.smooth[60]),
                key: () => `Power <small>(${shortDuration(60)})</small>`,
                unit: () => 'w',
            }, {
                value: x => H.number(x.stats && x.stats.power.smooth[300]),
                key: () => `Power <small>(${shortDuration(300)})</small>`,
                unit: () => 'w',
            }, {
                value: x => H.number(x.stats && x.stats.power.smooth[1200]),
                key: () => `Power <small>(${shortDuration(1200)})</small>`,
                unit: () => 'w',
            }, {
                value: x => H.number(x.stats && x.stats.power.peaks[5].avg),
                key: () => `Peak Power <small>(${shortDuration(5)})</small>`,
                unit: () => 'w',
            }, {
                value: x => H.number(x.stats && x.stats.power.peaks[15].avg),
                key: () => `Peak Power <small>(${shortDuration(15)})</small>`,
                unit: () => 'w',
            }, {
                value: x => H.number(x.stats && x.stats.power.peaks[60].avg),
                key: () => `Peak Power <small>(${shortDuration(60)})</small>`,
                unit: () => 'w',
            }, {
                value: x => H.number(x.stats && x.stats.power.peaks[300].avg),
                key: () => `Peak Power <small>(${shortDuration(300)})</small>`,
                unit: () => 'w',
            }, {
                value: x => H.number(x.stats && x.stats.power.peaks[1200].avg),
                key: () => `Peak Power <small>(${shortDuration(1200)})</small>`,
                unit: () => 'w',
            }, {
                value: x => H.number(x.stats && x.stats.power.avg),
                key: () => 'Power <small>(avg)</small>',
                unit: () => 'w',
            }, {
                value: x => fmtWkg(x.state && x.state.power, x.athlete),
                key: () => `W/kg`,
            }, {
                value: x => fmtWkg(x.stats && x.stats.power.smooth[5], x.athlete),
                key: () => `W/kg <small>(${shortDuration(5)})</small>`,
            }, {
                value: x => fmtWkg(x.stats && x.stats.power.smooth[15], x.athlete),
                key: () => `W/kg <small>(${shortDuration(15)})</small>`,
            }, {
                value: x => fmtWkg(x.stats && x.stats.power.smooth[60], x.athlete),
                key: () => `W/kg <small>(${shortDuration(60)})</small>`,
            }, {
                value: x => fmtWkg(x.stats && x.stats.power.smooth[300], x.athlete),
                key: () => `W/kg <small>(${shortDuration(300)})</small>`,
            }, {
                value: x => fmtWkg(x.stats && x.stats.power.smooth[1200], x.athlete),
                key: () => `W/kg <small>(${shortDuration(1200)})</small>`,
            }, {
                value: x => fmtWkg(x.stats && x.stats.power.peaks[5].avg, x.athlete),
                key: () => `Peak W/kg <small>(${shortDuration(5)})</small>`,
            }, {
                value: x => fmtWkg(x.stats && x.stats.power.peaks[15].avg, x.athlete),
                key: () => `Peak W/kg <small>(${shortDuration(15)})</small>`,
            }, {
                value: x => fmtWkg(x.stats && x.stats.power.peaks[60].avg, x.athlete),
                key: () => `Peak W/kg <small>(${shortDuration(60)})</small>`,
            }, {
                value: x => fmtWkg(x.stats && x.stats.power.peaks[300].avg, x.athlete),
                key: () => `Peak W/kg <small>(${shortDuration(300)})</small>`,
            }, {
                value: x => fmtWkg(x.stats && x.stats.power.peaks[1200].avg, x.athlete),
                key: () => `Peak W/kg <small>(${shortDuration(1200)})</small>`,
            }, {
                value: x => fmtWkg(x.stats && x.stats.power.avg, x.athlete),
                key: () => 'W/kg <small>(avg)</small>',
            }, {
                value: x => H.number(x.stats && x.stats.power.np),
                key: () => 'NP',
            }, {
                value: x => fmtPct((x.stats && x.stats.power.np || 0) / (x.athlete && x.athlete.ftp)),
                key: () => 'IF',
            }, {
                value: x => H.number(x.stats && x.stats.power.max),
                key: () => 'Power <small>(max)</small>',
                unit: () => 'w',
            }, {
                value: x => x.eventPosition ? `${H.place(x.eventPosition, {html: true})}/<small>${x.eventParticipants}</small>`: '-',
                key: () => 'Place',
            }, {
                value: x => x.remainingMetric === 'distance' ? fmtDist(x.remaining) : fmtDur(x.remaining),
                key: () => 'Finish',
            }, {
                value: x => x.state ? (x.remainingMetric === 'distance' ?
                    `${fmtDist(x.state.eventDistance)}/${fmtDist(x.state.eventDistance + x.remaining)}` :
                    fmtDist(x.state.eventDistance)) : '-',
                key: () => 'Event Dist',
            }, {
                value: x => fmtDist(x.state && x.state.distance),
                key: () => 'Dist',
            }, {
                value: x => x.eventSubgroup ? x.eventSubgroup.name : '-',
                key: () => 'Event',
            }, {
                value: x => x.eventSubgroup ?
                    ((x.eventSubgroup.laps && x.eventSubgroup.laps > 1) ? `${x.eventSubgroup.laps} x ` : '') +
                    x.eventSubgroup.route.name : '-',
                key: () => 'Route',

            }],
        });
    }
    return renderer;
}


async function renderWindowsPanel() {
    const windows = Object.values(await common.rpc.getWindows()).filter(x => !x.private);
    const manifests = await common.rpc.getWindowManifests();
    const el = document.querySelector('#windows');
    const descs = Object.fromEntries(manifests.map(x => [x.type, x]));
    windows.sort((a, b) => !!a.closed - !!b.closed);
    el.querySelector('table.active-windows tbody').innerHTML = windows.map(x => {
        const desc = descs[x.type] || {
            prettyName: `Unknown window: ${x.type}`,
            prettyDesc: common.sanitizeForAttr(JSON.stringify(x, null, 4)),
        };
        return `
            <tr data-id="${x.id}" class="window ${x.closed ? 'closed' : 'open'}"
                title="${desc.prettyDesc}\n\nDouble click/tap to ${x.closed ? 'reopen' : 'focus'}">
                <td class="name">${x.customName || desc.prettyName}<a class="link edit-name"
                    title="Edit name"><ms>edit</ms></a></td>
                <td class="state">${x.closed ? 'Closed' : 'Open'}</td>
                <td class="btn"><a title="Reopen this window" class="link restore"
                    ><ms>open_in_new</ms></a></td>
                <td class="btn" title="Delete this window and its settings"
                    ><a class="link delete"><ms>delete_forever</ms></a></td>
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
        `<optgroup label="${title || 'Main'}">${ms.map(x =>
            `<option title="${x.prettyDesc}" value="${x.type}">${x.prettyName}</option>`)}</optgroup>`
    ).join('');
}



export async function settingsMain() {
    common.initInteractionListeners();
    const extraData = {version: await common.rpc.getVersion()};
    await renderWindowsPanel();
    const winsEl = document.querySelector('#windows');
    winsEl.querySelector('table tbody').addEventListener('click', async ev => {
        const link = ev.target.closest('a.link');
        if (link) {
            const id = ev.target.closest('[data-id]').dataset.id;
            if (link.classList.contains('restore')) {
                await common.rpc.openWindow(id);
            } else if (link.classList.contains('delete')) {
                await common.rpc.removeWindow(id);
            } else if (link.classList.contains('edit-name')) {
                const td = ev.target.closest('td');
                const input = document.createElement('input');
                input.value = td.childNodes[0].textContent;
                input.title = 'Press Enter to save or Escape';
                td.innerHTML = '';
                td.appendChild(input);
                let actionTaken;
                const save = async () => {
                    if (actionTaken) {
                        return;
                    }
                    actionTaken = true;
                    const customName = common.sanitize(input.value);
                    await common.rpc.updateWindow(id, {customName});
                    await renderWindowsPanel();
                };
                input.addEventListener('blur', save);
                input.addEventListener('keydown', ev => {
                    if (ev.code === 'Enter') {
                        save();
                    } if (ev.code === 'Escape') {
                        actionTaken = true;
                        renderWindowsPanel();
                    }
                });
            }
        }
    });
    winsEl.querySelector('table tbody').addEventListener('dblclick', async ev => {
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
            debugger;
            const id = btn.dataset.id;
            await common.rpc.zwiftLogout(id);
            extraData[`${id}ZwiftLogin`] = '<LOGGED OUT>';
            btn.closest('label').classList.add('edited');
            btn.remove();
            await appSettingsUpdate(extraData);
        }
    });
    common.subscribe('set-windows', renderWindowsPanel, {source: 'windows'});
    extraData.webServerURL = await common.rpc.getWebServerURL();
    const appSettingsUpdate = common.initAppSettingsForm('form.app-settings');
    const gcs = await common.rpc.getGameConnectionStatus();
    if (gcs) {
        extraData.gameConnectionStatus = gcs.state;
        common.subscribe('status', async status => {
            extraData.gameConnectionStatus = status.state;
            await appSettingsUpdate(extraData);
        }, {source: 'gameConnection'});
    }
    const loginInfo = await common.rpc.getZwiftLoginInfo();
    extraData.mainZwiftLogin = loginInfo && loginInfo.main && loginInfo.main.username;
    extraData.monitorZwiftLogin = loginInfo && loginInfo.monitor && loginInfo.monitor.username;
    await appSettingsUpdate(extraData);
    await common.initSettingsForm('form.settings')();
}
