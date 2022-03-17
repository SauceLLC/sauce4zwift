import sauce from '../../shared/sauce/index.mjs';
import common from './common.mjs';

const L = sauce.locale;
const H = L.human;
const num = H.number;

function spd(v) {
    return v ? `${num(v)}<small>kph</small>` : v == null ? '-' : v;
}

function pwr(v) {
    return v ? `${num(v)}<small>w</small>`: v == null ? '-' : v;
}

function hr(v) {
    return v ? `${num(v)}<small>bpm</small>` : '-';
}

function clearSelection() {
    window.getSelection().empty();
}


const fields = [
    {id: 'id', defaultEn: true, label: 'ID', get: x => x.athleteId, fmt: x => x},
    {id: 'name', defaultEn: true, label: 'Name', get: x => x.athlete && x.athlete.fullname || null, fmt: x => x || '-'},
    {id: 'weight', defaultEn: true, label: 'Weight', get: x => x.athlete && x.athlete.weight || null, fmt: x => x ? `${x.toFixed(1)}<small>kg</small>` : '-'},

    {id: 'gap', defaultEn: true, label: 'Gap', get: x => x.gap, fmt: x => `${num(x)}s`},

    {id: 'pwr-cur', defaultEn: true, label: 'Pwr', get: x => x.power, fmt: pwr},
    {id: 'pwr-5s', defaultEn: true, label: '5s Pwr', get: x => x.stats.power.smooth['5'], fmt: pwr},
    {id: 'pwr-60s', defaultEn: true, label: '1m Pwr', get: x => x.stats.power.smooth['60'], fmt: pwr},
    {id: 'pwr-300s', defaultEn: false, label: '5m Pwr', get: x => x.stats.power.smooth['300'], fmt: pwr},
    {id: 'pwr-avg', defaultEn: true, label: 'Avg Pwr', get: x => x.stats.power.avg, fmt: pwr},
    {id: 'pwr-np', defaultEn: true, label: 'NP Pwr', get: x => x.stats.power.np, fmt: pwr},
    {id: 'pwr-max', defaultEn: true, label: 'Max Pwr', get: x => x.stats.power.max || null, fmt: pwr},
    {id: 'pwr-p5s', defaultEn: true, label: '5s Peak Pwr', get: x => x.stats.power.peaks[5].avg, fmt: pwr},
    {id: 'pwr-p60s', defaultEn: true, label: '1m Peak Pwr', get: x => x.stats.power.peaks[60].avg, fmt: pwr},
    {id: 'pwr-p300s', defaultEn: false, label: '5m Peak Pwr', get: x => x.stats.power.peaks[300].avg, fmt: pwr},

    {id: 'spd-cur', defaultEn: true, label: 'Spd', get: x => x.speed, fmt: spd},
    {id: 'spd-60s', defaultEn: false, label: '1m Spd', get: x => x.stats.speed.smooth[60], fmt: spd},
    {id: 'spd-avg', defaultEn: true, label: 'Avg Spd', get: x => x.stats.speed.avg, fmt: spd},
    {id: 'spd-p60s', defaultEn: false, label: '1m Peak Spd', get: x => x.stats.speed.peaks[60].avg, fmt: spd},

    {id: 'hr-cur', defaultEn: true, label: 'HR', get: x => x.heartrate || null, fmt: hr},
    {id: 'hr-60s', defaultEn: false, label: '1m HR', get: x => x.stats.hr.smooth[60], fmt: hr},
    {id: 'hr-avg', defaultEn: true, label: 'Avg HR', get: x => x.stats.hr.avg, fmt: hr},
    {id: 'hr-p60s', defaultEn: false, label: '1m Peak HR', get: x => x.stats.hr.peaks[60].avg, fmt: hr},
];


function getOptions() {
    return common.storage.get('nearby-options', {
        fields: Object.fromEntries(fields.map(x => [x.id, x.defaultEn])),
        autoscroll: true,
        refreshInterval: 1,
    });
}


function setOptions(options) {
    return common.storage.set('nearby-options', options);
}


export function main() {
    common.initInteractionListeners();
    const options = getOptions();
    document.documentElement.classList.toggle('autoscroll', options.autoscroll);
    const enFields = fields.filter(x => options.fields[x.id]);
    let sortBy = common.storage.get('nearby-sort-by', 'gap');
    const isFieldAvail = !!enFields.find(x => x.id === sortBy);
    if (!isFieldAvail) {
        sortBy = enFields[0].id;
    }
    
    let sortByDir = common.storage.get('nearby-sort-dir', 1);
    let hiRow;

    const table = document.querySelector('#content table');
    const tbody = table.querySelector('tbody');
    const theadRow = table.querySelector('thead tr');
    theadRow.innerHTML = enFields.map(x =>
        `<td data-id="${x.id}" class="${sortBy === x.id ? 'hi' : ''}">${x.label}</td>`).join('');
 
    tbody.addEventListener('dblclick', ev => {
        const row = ev.target.closest('tr');
        if (row) {
            clearSelection();
            hiRow = Number(row.dataset.id);
            const oldHi = tbody.querySelector('tr.hi');
            if (oldHi) {
                oldHi.classList.remove('hi');
            }
            if (options.autoscroll) {
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
            render();
        }
    });

    let pause;
    document.addEventListener('selectionchange', ev => pause = !!getSelection().toString());

    let nextAnimFrame;
    let frames = 0;
    let nearby;
    function render() {
        if (!nearby.length || pause || document.hidden) {
            return;
        }
        const get = enFields.find(x => x.id === sortBy).get;
        nearby.sort((a, b) => {
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
        const html = nearby.map(x => {
            const classes = [];
            if (x.watching) {
                classes.push('watching');
            }
            if ((x.watching && !hiRow) || x.athleteId === hiRow) {
                classes.push('hi');
            }
            return `
                <tr data-id="${x.athleteId}" class="${classes.join(' ')}">
                    ${enFields.map(({id, get, fmt}) =>
                        `<td data-id="${id}" class="${sortBy === id ? 'hi' : ''}">${fmt(get(x))}</td>`
                    ).join('')}
                </tr>
            `;
        }).join('\n');
        if (nextAnimFrame) {
            cancelAnimationFrame(nextAnimFrame);
        }
        nextAnimFrame = requestAnimationFrame(() => {
            nextAnimFrame = null;
            tbody.innerHTML = html;
            if (!frames++ && options.autoscroll) {
                queueMicrotask(() => {
                    const w = document.querySelector('tr.watching');
                    if (w) {
                        w.scrollIntoView({block: 'center'});
                    }
                });
            }
        });
    }
    let lastRefresh = 0;
    const refresh = (options.refreshInterval || 1) * 1000 - 100; // within 100ms is fine.
    common.subscribe('nearby', _nearby => {
        nearby = _nearby;
        const elapsed = Date.now() - lastRefresh;
        if (elapsed >= refresh) {
            lastRefresh = Date.now();
            render();
        }
    });
}


export function options() {
    common.initInteractionListeners();
    const options = getOptions();
    const form = document.querySelector('form#fields');
    form.addEventListener('input', ev => {
        const id = ev.target.name;
        options.fields[id] = ev.target.checked;
        setOptions(options);
    });
    const fieldsHtml = fields.map(x => {
        return `<label>${x.label}<input type="checkbox" name="${x.id}" ${options.fields[x.id] ? 'checked' : ''}/></label>`;
    }).join('');
    form.innerHTML = fieldsHtml;
    common.initOptionsForm('form#options', 'nearby-options');
}
