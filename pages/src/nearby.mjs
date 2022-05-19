import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';

const L = sauce.locale;
const H = L.human;
const num = H.number;
const settingsKey = 'nearby-settings-v3';
const fieldsKey = 'nearby-fields-v2';
let imperial = common.storage.get('/imperialUnits');
L.setImperial(imperial);
let settings;
let fieldStates;
let athleteData = new Map();
let nearbyData;
let hiRow;
let enFields;
let sortBy;
let sortByDir;
let tbody;
let mainRow;


function spd(v) {
    const unit = imperial ? 'mph' : 'kph';
    return v ? `${H.pace(v, {precision: 0})}<small>${unit}</small>` : v !== 0 ? '-' : 0;
}


function weight(v) {
    const unit = imperial ? 'lbs' : 'kg';
    return v ? `${H.weight(v, {precision: 0})}<small>${unit}</small>` : v !== 0 ? '-' : 0;
}


function pwr(v) {
    return v ? `${num(v)}<small>w</small>`: v !== 0 ? '-' : 0;
}


function wkg(v) {
    v = v === Infinity ? null : v;
    return v ? `${num(v, {precision: 1, fixed: true})}<small>w/kg</small>`: v !== 0 ? '-' : 0;
}


function hr(v) {
    return v ? `${num(v)}<small>bpm</small>` : '-';
}


function clearSelection() {
    window.getSelection().empty();
}


function getAthleteValue(x, key) {
    const a = athleteData.get(x.athleteId);
    return a && a[key];
}


const fields = [
    {id: 'avatar', defaultEn: true, label: '<img class="fa" src="images/fa/user-circle-solid.svg"/>',
     get: x => getAthleteValue(x, 'avatar'),
     fmt: x => x ? `<a href="${x}" class="avatar" target="_blank"><img src="${x}"/></a>` : ''},
    {id: 'name', defaultEn: true, label: 'Name', get: x => getAthleteValue(x, 'sanitizedFullname'),
     sanitize: true, fmt: x => x || '-'},
    {id: 'team', defaultEn: false, label: 'Team', get: x => getAthleteValue(x, 'team'),
     sanitize: true, fmt: x => x || '-'},
    {id: 'initials', defaultEn: false, label: 'Initials', get: x => getAthleteValue(x, 'initials'),
     sanitize: true, fmt: x => x || '-'},
    {id: 'id', defaultEn: true, label: 'ID', get: x => x.athleteId,
     fmt: x => `<a title="Open in ZwiftPower" external="" target="_blank" href="https://zwiftpower.com/profile.php?z=${x}">${x}</a>`},
    {id: 'weight', defaultEn: false, label: 'Weight', get: x => getAthleteValue(x, 'weight'), fmt: weight},
    {id: 'ftp', defaultEn: false, label: 'FTP', get: x => getAthleteValue(x, 'ftp'), fmt: pwr},
    {id: 'tss', defaultEn: false, label: 'TSS', get: x => x.stats.power.tss, fmt: num},

    {id: 'gap', defaultEn: true, label: 'Gap', get: x => x.gap, fmt: x => `${num(x)}s`},

    {id: 'pwr-cur', defaultEn: true, label: 'Pwr', get: x => x.state.power, fmt: pwr},
    {id: 'wkg-cur', defaultEn: true, label: 'W/kg', get: x => x.state.power / (x.athlete && x.athlete.weight), fmt: wkg},

    {id: 'pwr-5s', defaultEn: false, label: '5s Pwr', get: x => x.stats.power.smooth[5], fmt: pwr},
    {id: 'wkg-5s', defaultEn: false, label: '5s W/kg', get: x => x.stats.power.smooth[5] / (x.athlete && x.athlete.weight), fmt: wkg},
    {id: 'pwr-15s', defaultEn: false, label: '15s Pwr', get: x => x.stats.power.smooth[15], fmt: pwr},
    {id: 'wkg-15s', defaultEn: false, label: '15s W/kg', get: x => x.stats.power.smooth[15] / (x.athlete && x.athlete.weight), fmt: wkg},
    {id: 'pwr-60s', defaultEn: false, label: '1m Pwr', get: x => x.stats.power.smooth[60], fmt: pwr},
    {id: 'wkg-60s', defaultEn: false, label: '1m W/kg', get: x => x.stats.power.smooth[60] / (x.athlete && x.athlete.weight), fmt: wkg},
    {id: 'pwr-300s', defaultEn: false, label: '5m Pwr', get: x => x.stats.power.smooth[300], fmt: pwr},
    {id: 'wkg-300s', defaultEn: false, label: '5m W/kg', get: x => x.stats.power.smooth[300] / (x.athlete && x.athlete.weight), fmt: wkg},
    {id: 'pwr-1200s', defaultEn: false, label: '20m Pwr', get: x => x.stats.power.smooth[1200], fmt: pwr},
    {id: 'wkg-1200s', defaultEn: false, label: '20m W/kg', get: x => x.stats.power.smooth[1200] / (x.athlete && x.athlete.weight), fmt: wkg},

    {id: 'pwr-avg', defaultEn: true, label: 'Avg Pwr', get: x => x.stats.power.avg, fmt: pwr},
    {id: 'wkg-avg', defaultEn: false, label: 'Avg W/kg', get: x => x.stats.power.avg / (x.athlete && x.athlete.weight), fmt: wkg},

    {id: 'pwr-np', defaultEn: true, label: 'NP', get: x => x.stats.power.np, fmt: pwr},
    {id: 'wkg-np', defaultEn: false, label: 'NP W/kg', get: x => x.stats.power.np / (x.athlete && x.athlete.weight), fmt: wkg},

    {id: 'pwr-max', defaultEn: true, label: 'Max Pwr', get: x => x.stats.power.max || null, fmt: pwr},
    {id: 'wkg-max', defaultEn: false, label: 'Max W/kg', get: x => (x.stats.power.max || null) / (x.athlete && x.athlete.weight), fmt: wkg},

    {id: 'pwr-p5s', defaultEn: false, label: '5s Peak Pwr', get: x => x.stats.power.peaks[5].avg, fmt: pwr},
    {id: 'wkg-p5s', defaultEn: false, label: '5s Peak W/kg', get: x => x.stats.power.peaks[5].avg / (x.athlete && x.athlete.weight), fmt: wkg},
    {id: 'pwr-p15s', defaultEn: false, label: '15s Peak Pwr', get: x => x.stats.power.peaks[15].avg, fmt: pwr},
    {id: 'wkg-p15s', defaultEn: false, label: '15s Peak W/kg', get: x => x.stats.power.peaks[15].avg / (x.athlete && x.athlete.weight), fmt: wkg},
    {id: 'pwr-p60s', defaultEn: false, label: '1m Peak Pwr', get: x => x.stats.power.peaks[60].avg, fmt: pwr},
    {id: 'wkg-p60s', defaultEn: false, label: '1m Peak W/kg', get: x => x.stats.power.peaks[60].avg / (x.athlete && x.athlete.weight), fmt: wkg},
    {id: 'pwr-p300s', defaultEn: true, label: '5m Peak Pwr', get: x => x.stats.power.peaks[300].avg, fmt: pwr},
    {id: 'wkg-p300s', defaultEn: false, label: '5m Peak W/kg', get: x => x.stats.power.peaks[300].avg / (x.athlete && x.athlete.weight), fmt: wkg},
    {id: 'pwr-p1200s', defaultEn: false, label: '20m Peak Pwr', get: x => x.stats.power.peaks[1200].avg, fmt: pwr},
    {id: 'wkg-p1200s', defaultEn: false, label: '20m Peak W/kg', get: x => x.stats.power.peaks[1200].avg / (x.athlete && x.athlete.weight), fmt: wkg},

    {id: 'spd-cur', defaultEn: true, label: 'Spd', get: x => x.state.speed, fmt: spd},
    {id: 'spd-60s', defaultEn: false, label: '1m Spd', get: x => x.stats.speed.smooth[60], fmt: spd},
    {id: 'spd-avg', defaultEn: true, label: 'Avg Spd', get: x => x.stats.speed.avg, fmt: spd},
    {id: 'spd-p60s', defaultEn: false, label: '1m Peak Spd', get: x => x.stats.speed.peaks[60].avg, fmt: spd},

    {id: 'hr-cur', defaultEn: true, label: 'HR', get: x => x.state.heartrate || null, fmt: hr},
    {id: 'hr-60s', defaultEn: false, label: '1m HR', get: x => x.stats.hr.smooth[60], fmt: hr},
    {id: 'hr-avg', defaultEn: true, label: 'Avg HR', get: x => x.stats.hr.avg, fmt: hr},
    {id: 'hr-p60s', defaultEn: false, label: '1m Peak HR', get: x => x.stats.hr.peaks[60].avg, fmt: hr},

    {id: 'rideons', defaultEn: false, label: 'Ride Ons', get: x => x.state.rideons, fmt: num},
    {id: 'kj', defaultEn: false, label: 'Energy', get: x => x.state.kj, fmt: x => num(x) + 'kJ'},
    {id: 'draft', defaultEn: false, label: 'Draft', get: x => x.state.draft, fmt: x => num(x) + '%'},
];


export function main() {
    common.initInteractionListeners();
    let refresh;
    const setRefresh = () => refresh = (settings.refreshInterval || 1) * 1000 - 100; // within 100ms is fine.
    common.storage.addEventListener('update', async ev => {
        if (ev.data.key === fieldsKey) {
            fieldStates = ev.data.value;
        } else if (ev.data.key === settingsKey) {
            const oldSettings = settings;
            settings = ev.data.value;
            if (oldSettings.transparency !== settings.transparency) {
                common.rpc.setWindowOpacity(window.electron.context.id, 1 - (settings.transparency / 100));
            }
            if (window.isElectron && typeof settings.overlayMode === 'boolean') {
                await common.rpc.updateWindow(window.electron.context.id, {overlay: settings.overlayMode});
                if (settings.overlayMode !== oldSettings.overlayMode) {
                    await common.rpc.reopenWindow(window.electron.context.id);
                }
            }
        } else {
            return;
        }
        setRefresh();
        render();
        if (nearbyData) {
            renderData(nearbyData);
        }
    });
    common.storage.addEventListener('globalupdate', ev => {
        if (ev.data.key === '/imperialUnits') {
            L.setImperial(imperial = ev.data.value);
        }
    });
    settings = common.storage.get(settingsKey, {
        autoscroll: true,
        refreshInterval: 2,
        overlayMode: false,
        fontScale: 1,
        transparency: 0,
    });
    document.documentElement.classList.toggle('overlay-mode', settings.overlayMode);
    fieldStates = common.storage.get(fieldsKey, Object.fromEntries(fields.map(x => [x.id, x.defaultEn])));
    if (window.isElectron) {
        common.rpc.getWindow(window.electron.context.id).then(({overlay}) => {
            if (settings.overlayMode !== overlay) {
                settings.overlayMode = overlay;
                common.storage.set(settingsKey, settings);
                document.documentElement.classList.toggle('overlay-mode', overlay);
            }
        });
    }
    render();
    refresh = setRefresh();
    let lastRefresh = 0;
    common.subscribe('nearby', data => {
        nearbyData = data;
        athleteData = new Map(data.filter(x => x.athlete).map(x => [x.athleteId, x.athlete]));
        const elapsed = Date.now() - lastRefresh;
        if (elapsed >= refresh) {
            lastRefresh = Date.now();
            renderData(data);
        }
    });
}


function render() {
    document.documentElement.classList.toggle('autoscroll', settings.autoscroll);
    document.documentElement.style.setProperty('--font-scale', settings.fontScale || 1);
    enFields = fields.filter(x => fieldStates[x.id]);
    sortBy = common.storage.get('nearby-sort-by', 'gap');
    const isFieldAvail = !!enFields.find(x => x.id === sortBy);
    if (!isFieldAvail) {
        sortBy = enFields[0].id;
    }
    sortByDir = common.storage.get('nearby-sort-dir', 1);
    const table = document.querySelector('#content table');
    tbody = table.querySelector('tbody');
    const theadRow = table.querySelector('thead tr');
    theadRow.innerHTML = '<td></td>' + enFields.map(x =>
        `<td data-id="${x.id}" class="${sortBy === x.id ? 'hi' : ''}">${x.label}</td>`).join('');
    mainRow = makeTableRow();
    mainRow.classList.add('watching');
    tbody.innerHTML = '';
    tbody.appendChild(mainRow);
    tbody.addEventListener('dblclick', ev => {
        const row = ev.target.closest('tr');
        if (row) {
            clearSelection();
            hiRow = Number(row.dataset.id);
            const oldHi = tbody.querySelector('tr.hi');
            if (oldHi) {
                oldHi.classList.remove('hi');
            }
            if (settings.autoscroll) {
                row.scrollIntoView({block: 'center'});  // forces smooth
                setTimeout(() => row.classList.add('hi'), 200); // smooth scroll hack.
            } else {
                row.classList.add('hi');
            }
        }
    });
    theadRow.addEventListener('click', ev => {
        const col = ev.target.closest('td');
        if (col) {
            const id = col.dataset.id;
            if (id === sortBy) {
                sortByDir = -sortByDir;
                common.storage.set('nearby-sort-dir', sortByDir);
            }
            sortBy = id;
            common.storage.set(`nearby-sort-by`, id);
            for (const td of table.querySelectorAll('td.hi')) {
                td.classList.remove('hi');
            }
            for (const td of table.querySelectorAll(`td[data-id="${sortBy}"]`)) {
                td.classList.add('hi');
            }
            renderData(nearbyData);
        }
    });
    tbody.addEventListener('click', async ev => {
        const link = ev.target.closest('.link');
        if (link) {
            ev.stopPropagation();
            const athleteId = Number(ev.target.closest('tr').dataset.id);
            if (link.dataset.id === 'edit') {
                showAthleteDialog(athleteId);
            } else if (link.dataset.id === 'export') {
                const fitData = await common.rpc.exportFIT(athleteId);
                const f = new File([new Uint8Array(fitData)], `${athleteId}.fit`, {type: 'application/binary'});
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
            }
        }
    });
}


function showAthleteDialog(id) {
    // XXX Let's switch this to a new window that can be used by any page
    // Then we can add options for chat-mute, pinned, team, notes as well as add
    // a nice display of their avatar and perhaps other stats.
    const ath = athleteData.get(id) || {};
    const dialog = document.getElementById('edit-name-dialog');
    const nameInput = dialog.querySelector('input[name="name"]');
    nameInput.value = ath.fullname || '';
    const weightInput = dialog.querySelector('input[name="weight"]');
    weightInput.value = ath.weight || '';
    const ftpInput = dialog.querySelector('input[name="ftp"]');
    ftpInput.value = ath.ftp || '';
    const avatarInput = dialog.querySelector('input[name="avatar"]');
    avatarInput.value = ath.avatar || '';
    dialog.addEventListener('close', async ev => {
        if (dialog.returnValue === 'save') {
            const [first, ...lasts] = nameInput.value.split(' ').filter(x => x);
            const last = lasts.length ? lasts.join(' ') : null;
            const extra = {
                weight: Number(weightInput.value) || null,
                ftp: Number(ftpInput.value) || null,
                avatar: avatarInput.value || null,
            };
            const updated = await common.rpc.updateAthlete(id, first, last, extra);
            athleteData.set(id, updated);
            console.info(id, updated);
            renderData(nearbyData);
        }
    }, {once: true});
    dialog.showModal();
}


function makeTableRow() {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>
            <a class="link" data-id="edit" data-tooltip="Manually edit athlete"><img src="images/fa/edit-duotone.svg"/></a>
            <a class="link" data-id="export" data-tooltip="Export FIT File"><img src="images/fa/download-duotone.svg"/></a>
        </td>
        ${enFields.map(({id}) => `<td data-id="${id}"></td>`).join('')}
    `;
    return tr;
}


function gentleClassToggle(el, cls, force) {
    const has = el.classList.contains(cls);
    if (has && !force) {
        el.classList.remove(cls);
    } else if (!has && force) {
        el.classList.add(cls);
    }
}


function updateTableRow(row, info) {
    gentleClassToggle(row, 'hi', info.athleteId === hiRow);
    if (row.dataset.id !== '' + info.athleteId) {
        row.dataset.id = info.athleteId;
    }
    const tds = row.querySelectorAll('td');
    for (const [i, {id, get, fmt, sanitize}] of enFields.entries()) {
        let value = get(info);
        if (sanitize && value) {
            sanitizeEl.textContent = value;
            value = sanitizeEl.innerHTML;
        }
        const html = '' + fmt(value);
        const td = tds[i + 1];
        if (td._html !== html) {
            td.innerHTML = (td._html = html);
        }
        gentleClassToggle(td, 'hi', sortBy === id);
    }
    gentleClassToggle(row, 'hidden', false);
}


let nextAnimFrame;
let frames = 0;
const sanitizeEl = document.createElement('span');
function renderData(data) {
    if (!data || !data.length || document.hidden) {
        return;
    }
    const get = enFields.find(x => x.id === sortBy).get;
    data.sort((a, b) => {
        const av = get(a);
        const bv = get(b);
        if (av == bv) {
            return 0;
        } else if (av == null || bv == null) {
            return av == null ? 1 : -1;
        } else {
            return (av < bv ? 1 : -1) * sortByDir;
        }
    });
    if (nextAnimFrame) {
        cancelAnimationFrame(nextAnimFrame);
    }
    nextAnimFrame = requestAnimationFrame(() => {
        nextAnimFrame = null;
        const centerIdx = data.findIndex(x => x.watching);
        let row = mainRow;
        for (let i = centerIdx; i >= 0; i--) {
            updateTableRow(row, data[i]);
            if (i) {
                row = row.previousElementSibling || row.insertAdjacentElement('beforebegin', makeTableRow());
            }
        }
        while (row.previousElementSibling) {
            gentleClassToggle(row = row.previousElementSibling, 'hidden', true);
        }
        row = mainRow.nextElementSibling || mainRow.insertAdjacentElement('afterend', makeTableRow());
        for (let i = centerIdx + 1; i < data.length; i++) {
            updateTableRow(row, data[i]);
            if (i < data.length - 1) {
                row = row.nextElementSibling || row.insertAdjacentElement('afterend', makeTableRow());
            }
        }
        while (row.nextElementSibling) {
            gentleClassToggle(row = row.nextElementSibling, 'hidden', true);
        }
        if (!frames++ && settings.autoscroll) {
            queueMicrotask(() => mainRow.scrollIntoView({block: 'center'}));
        }
    });
}


export async function settingsMain() {
    common.initInteractionListeners();
    fieldStates = common.storage.get(fieldsKey);
    const form = document.querySelector('form#fields');
    form.addEventListener('input', ev => {
        const id = ev.target.name;
        fieldStates[id] = ev.target.checked;
        common.storage.set(fieldsKey, fieldStates);
    });
    const fieldsHtml = fields.map(x => `
        <label>
            <key>${x.label}</key>
            <input type="checkbox" name="${x.id}" ${fieldStates[x.id] ? 'checked' : ''}/>
        </label>
    `).join('');
    form.innerHTML = fieldsHtml;
    await common.initSettingsForm('form#options', {settingsKey});
}
