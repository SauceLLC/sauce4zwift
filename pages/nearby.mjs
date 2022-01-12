import sauce from '../shared/sauce/index.mjs';
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

    {id: 'gap', defaultEn: true, label: 'Gap', get: x => x.gap, fmt: x => `${num(x)}s`},

    {id: 'pwr-cur', defaultEn: true, label: 'Pwr', get: x => x.power, fmt: pwr},
    {id: 'pwr-5s', defaultEn: true, label: '5s Pwr', get: x => x.stats.power.smooth['5'], fmt: pwr},
    {id: 'pwr-60s', defaultEn: true, label: '1m Pwr', get: x => x.stats.power.smooth['60'], fmt: pwr},
    {id: 'pwr-300s', defaultEn: true, label: '5m Pwr', get: x => x.stats.power.smooth['300'], fmt: pwr},
    {id: 'pwr-avg', defaultEn: true, label: 'Avg Pwr', get: x => x.stats.power.avg, fmt: pwr},
    {id: 'pwr-np', defaultEn: true, label: 'NP Pwr', get: x => x.stats.power.np, fmt: pwr},
    {id: 'pwr-max', defaultEn: true, label: 'Max Pwr', get: x => x.stats.power.max, fmt: pwr},
    {id: 'pwr-p5s', defaultEn: true, label: '5s Peak Pwr', get: x => x.stats.power.peaks[5].avg, fmt: pwr},
    {id: 'pwr-p60s', defaultEn: true, label: '1m Peak Pwr', get: x => x.stats.power.peaks[60].avg, fmt: pwr},
    {id: 'pwr-p300s', defaultEn: true, label: '5m Peak Pwr', get: x => x.stats.power.peaks[300].avg, fmt: pwr},

    {id: 'spd-cur', defaultEn: true, label: 'Spd', get: x => x.speed, fmt: spd},
    {id: 'spd-60s', defaultEn: true, label: '1m Spd', get: x => x.stats.speed.smooth[60], fmt: spd},
    {id: 'spd-avg', defaultEn: true, label: 'Avg Spd', get: x => x.stats.speed.avg, fmt: spd},
    {id: 'spd-p60s', defaultEn: true, label: '1m Peak Spd', get: x => x.stats.speed.peaks[60].avg, fmt: spd},

    {id: 'hr-cur', defaultEn: true, label: 'HR', get: x => x.heartrate, fmt: hr},
    {id: 'hr-60s', defaultEn: true, label: '1m HR', get: x => x.stats.hr.smooth[60], fmt: hr},
    {id: 'hr-avg', defaultEn: true, label: 'Avg HR', get: x => x.stats.hr.avg, fmt: hr},
    {id: 'hr-p60s', defaultEn: true, label: '1m Peak HR', get: x => x.stats.hr.peaks[60].avg, fmt: hr},
];


export function main() {
    common.initInteractionListeners();

    const enFields = fields.filter(x => common.storage.get(`nearby-fields-${x.id}`, x.defaultEn));
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
            row.scrollIntoView({block: 'center'});  // forces smooth
            setTimeout(() => row.classList.add('hi'), 200); // smooth scroll hack.
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
        const sortFn = enFields.find(x => x.id === sortBy).get;
        nearby.sort((a, b) => (sortFn(a) - sortFn(b)) * sortByDir);
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
            console.log("drop frame");
        }
        nextAnimFrame = requestAnimationFrame(() => {
            nextAnimFrame = null;
            tbody.innerHTML = html;
            if (!frames++) {
                queueMicrotask(() => {
                    const w = document.querySelector('tr.watching');
                    if (w) {
                        w.scrollIntoView({block: 'center'});
                    }
                });
            }
        });
    }
    common.subscribe('nearby', _nearby => {
        nearby = _nearby;
        render();
    });
}


export function options() {
    common.initInteractionListeners();
    const form = document.querySelector('form');
    form.addEventListener('input', ev => {
        const id = ev.target.name;
        common.storage.set(`nearby-fields-${id}`, ev.target.checked);
    });
    const fieldsHtml = fields.map(x => {
        let en = common.storage.get(`nearby-fields-${x.id}`);
        if (en == null) {
            en = x.defaultEn;
        }
        return `<label>${x.label}<input type="checkbox" name="${x.id}" ${en ? 'checked' : ''}/></label>`;
    }).join('');
    form.innerHTML = fieldsHtml;
}
