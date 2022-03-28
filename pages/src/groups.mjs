import sauce from '../../shared/sauce/index.mjs';
import common from './common.mjs';

const L = sauce.locale;
const H = L.human;


let settings;
let zoomedPosition;
let curGroups;
const positions = new Map();


function getOrCreatePosition(relPos) {
    if (!positions.has(relPos)) {
        const el = document.createElement('div');
        el.classList.add('position');
        el.style.setProperty('--rel-pos', relPos);
        el.innerHTML = `
            <div class="bubble"></div>
            <div class="desc">
                <div class="lines"></div>
            </div>
        `;
        const gap = document.createElement('div');
        gap.classList.add('gap');
        gap.style.setProperty('--rel-pos', relPos);
        gap.innerHTML = `
            <div class="desc">
                <div class="lines">
                    <div class="line time"></div>
                    <div class="line minor est" title="Estimated gap">(est)</div>
                </div>
            </div>
        `;
        const content = document.querySelector('#content');
        content.appendChild(el);
        content.appendChild(gap);
        positions.set(relPos, el);
        el.addEventListener('click', ev => {
            if (zoomedPosition == null) {
                zoomedPosition = Number(ev.currentTarget.style.getPropertyValue('--rel-pos'));
                renderZoomed(curGroups);
            } else {
                zoomedPosition = null;
                renderGroups(curGroups);
            }
        });
    }
    return positions.get(relPos);
}


function renderZoomed(groups) {
    let centerIdx = groups.findIndex(x => x.watching);
    groups = groups.slice(
        Math.max(0, centerIdx - (settings.maxAhead || 3)),
        centerIdx + (settings.maxBehind || 3) + 1);
    centerIdx = groups.findIndex(x => x.watching);
    const center = groups[centerIdx];
    if (!center) {
        return;
    }
    const group = groups[centerIdx + zoomedPosition];
    const athletes = group.athletes;
    const totAthletes = athletes.length;
    const totGap = Math.round(athletes[athletes.length - 1].gap - athletes[0].gap);
    const content = document.querySelector('#content');
    content.style.setProperty('--total-athletes', totAthletes);
    content.style.setProperty('--total-gap', totGap);
    const active = new Set();
    for (const [i, athlete] of athletes.entries()) {
        // NOTE: gap measurement is always to the next athlete or null.
        const next = athletes[i + 1];
        const relPos = i - centerIdx;
        active.add(relPos);
        const posEl = getOrCreatePosition(relPos);
        posEl.classList.toggle('watching', !!athlete.watching);
        posEl.style.setProperty('--athletes', 1);
        let label;
        let avatar;
        if (athlete.athlete) {
            const a = athlete.athlete;
            if (a.avatar) {
                avatar = `<img src="${a.avatar}"/>`;
            } else if (a.name) {
                label = a.name.map(x => x[0].toUpperCase()).join('').substr(0, 2);
            }
        } else {
            avatar = `<img src="images/blankavatar.png"/>`;
        }
        const attacker = athlete.power > 400 && (athlete.power / group.power) > 2;
        if (attacker) {
            posEl.classList.add('attn', 'attack');
        } else {
            posEl.classList.remove('attn', 'attack');
        }
        const bubble = posEl.querySelector('.bubble');
        if (avatar) {
            bubble.innerHTML = avatar;
        } else {
            bubble.textContent = label;
        }

        const lines = [`<div class="line ${attacker ? 'attn' : ''}">${Math.round(athlete.power).toLocaleString()}w</div>`];
        if (athlete.heartrate) {
            lines.push(`<div class="line minor">${Math.round(athlete.heartrate).toLocaleString()}bpm</div>`);
        }
        posEl.querySelector('.desc .lines').innerHTML = lines.join('');
        const gapEl = posEl.nextSibling;
        const gap = next ? Number((next.gap - athlete.gap).toFixed(1)) : 0;
        gapEl.style.setProperty('--inner-gap', gap);
        gapEl.style.setProperty('--outer-gap', Math.abs(gap));
        gapEl.style.setProperty('--gap-sign', gap > 0 ? 1 : -1);
        gapEl.classList.toggle('real', !!next && !next.isGapEst);
        gapEl.classList.toggle('alone', !gap);
        const dur = gap && gap.toFixed(1) + 's';
        gapEl.querySelector('.desc .line.time').textContent = dur ? (gap > 0 ? '+' : '-') + dur : '';
    }
    for (const [pos, x] of positions.entries()) {
        x.classList.toggle('hidden', !active.has(pos));
    }
}


function renderGroups(groups) {
    let centerIdx = groups.findIndex(x => x.watching);
    groups = groups.slice(
        Math.max(0, centerIdx - (settings.maxAhead || 3)),
        centerIdx + (settings.maxBehind || 3) + 1);
    centerIdx = groups.findIndex(x => x.watching);
    const center = groups[centerIdx];
    if (!center) {
        return;
    }
    const totAthletes = groups.reduce((agg, x) => agg + x.athletes.length, 0);
    const totGap = Math.round(groups[groups.length - 1].gap - groups[0].gap);
    const content = document.querySelector('#content');
    content.style.setProperty('--total-athletes', totAthletes);
    content.style.setProperty('--total-gap', totGap);
    const active = new Set();
    for (const [i, group] of groups.entries()) {
        // NOTE: gap measurement is always to the next group or null.
        const next = groups[i + 1];
        const relPos = i - centerIdx;
        active.add(relPos);
        const groupEl = getOrCreatePosition(relPos);
        groupEl.classList.toggle('watching', !!group.watching);
        groupEl.style.setProperty('--athletes', group.athletes.length);
        let label;
        const lines = [];
        if (group.athletes.length === 1 && group.athletes[0].athlete) {
            const n = group.athletes[0].athlete.name;
            label = n.map(x => x[0].toUpperCase()).join('').substr(0, 2);
            groupEl.classList.remove('attn', 'attack');
        } else {
            label = group.athletes.length.toLocaleString();
            let max = -Infinity;
            for (const x of group.athletes) {
                const p = x.stats.power.smooth[5];
                if (p > max) {
                    max = p;
                }
            }
            if (max > 400 && (max / group.power) > 2) {
                groupEl.classList.add('attn', 'attack');
                lines.push(`<div class="line attn">${Math.round(max).toLocaleString()}w <small>Attacker!</small></div>`);
            } else {
                groupEl.classList.remove('attn', 'attack');
            }
        }
        groupEl.querySelector('.bubble').textContent = label;
        lines.push(...[
            Math.round(group.power).toLocaleString() + 'w',
            Math.round(group.speed).toLocaleString() + 'kph',
        ].map((x, i) => `<div class="line ${i ? 'minor' : ''}">${x}</div>`));
        groupEl.querySelector('.desc .lines').innerHTML = lines.join('');
        const gapEl = groupEl.nextSibling;
        const innerGap = next ? Math.round(group.innerGap) : 0;
        const gap = relPos < 0 ? group.gap : next ? next.gap : 0;
        gapEl.style.setProperty('--inner-gap', innerGap);
        gapEl.style.setProperty('--outer-gap', Math.abs(gap));
        gapEl.style.setProperty('--gap-sign', gap > 0 ? 1 : -1);
        gapEl.classList.toggle('real', !!next && !next.isGapEst);
        gapEl.classList.toggle('alone', !innerGap);
        const dur = innerGap && H.duration(Math.abs(gap), {short: true, seperator: ' '});
        gapEl.querySelector('.desc .line.time').textContent = dur ? (gap > 0 ? '+' : '-') + dur : '';
    }
    for (const [pos, x] of positions.entries()) {
        x.classList.toggle('hidden', !active.has(pos));
    }
}


export async function main() {
    common.initInteractionListeners();
    settings = common.storage.get('groups-options', {
        detectAttacks: true,
        maxAhead: 3,
        maxBehind: 3,
    });
    common.subscribe('groups', groups => {
        if (!groups.length) {
            return;
        }
        curGroups = groups;
        if (zoomedPosition != null) {
            renderZoomed(groups);
        } else {
            renderGroups(groups);
        }
    });
}


export function options() {
    common.initInteractionListeners();
    common.initOptionsForm('form', 'groups-options');
}
