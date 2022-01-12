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

async function main() {
    common.initInteractionListeners();

    const fields = {
        'ID': {get: x => x.athleteId, fmt: x => x},

        'Gap': {get: x => x.gap, fmt: x => `${num(x)}s`},

        'Pwr': {get: x => x.power, fmt: pwr},
        '5s Pwr': {get: x => x.stats.power.smooth['5'], fmt: pwr},
        '1m Pwr': {get: x => x.stats.power.smooth['60'], fmt: pwr},
        '5m Pwr': {get: x => x.stats.power.smooth['300'], fmt: pwr},
        'Avg Pwr': {get: x => x.stats.power.avg, fmt: pwr},
        'NP Pwr': {get: x => x.stats.power.np, fmt: pwr},
        'Max Pwr': {get: x => x.stats.power.max, fmt: pwr},
        '5s Peak Pwr': {get: x => x.stats.power.peaks[5].avg, fmt: pwr},
        '1m Peak Pwr': {get: x => x.stats.power.peaks[60].avg, fmt: pwr},
        '5m Peak Pwr': {get: x => x.stats.power.peaks[300].avg, fmt: pwr},

        'Spd': {get: x => x.speed, fmt: spd},
        '1m Spd': {get: x => x.stats.speed.smooth[60], fmt: spd},
        'Avg Spd': {get: x => x.stats.speed.avg, fmt: spd},
        '1m Peak Spd': {get: x => x.stats.speed.peaks[60].avg, fmt: spd},

        'HR': {get: x => x.heartrate, fmt: hr},
        '1m HR': {get: x => x.stats.hr.smooth[60], fmt: hr},
        'Avg HR': {get: x => x.stats.hr.avg, fmt: hr},
        '1m Peak HR': {get: x => x.stats.hr.peaks[60].avg, fmt: hr},
    };

    let sortByCol = 1;
    let sortByDir = 1;
    let hiCol = sortByCol;
    let hiRow;

    const table = document.querySelector('#content table');
    const tbody = table.querySelector('tbody');
    const theadRow = table.querySelector('thead tr');
    theadRow.innerHTML = Object.keys(fields).map((x, i) =>
        `<td data-id="${i}" class="${hiCol === i ? 'hi' : ''}">${x}</td>`).join('');
 
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
            const id = Number(col.dataset.id);
            if (id === sortByCol) {
                sortByDir = -sortByDir;
            }
            hiCol = sortByCol = id;
            for (const td of table.querySelectorAll('td.hi')) {
                td.classList.remove('hi');
            }
            for (const td of table.querySelectorAll(`td[data-id="${hiCol}"]`)) {
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
        const sortFn = Object.values(fields)[sortByCol].get;
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
                    ${Object.values(fields).map(({get, fmt}, i) =>
                        `<td data-id="${i}" class="${hiCol === i ? 'hi' : ''}">${fmt(get(x))}</td>`
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

addEventListener('DOMContentLoaded', () => main());
