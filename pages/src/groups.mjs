import sauce from '../../shared/sauce/index.mjs';
import common from './common.mjs';

const L = sauce.locale;
const H = L.human;
const positions = new Map();
const settingsKey = 'groups-settings-v4';
let imperial = common.storage.get('/imperialUnits');
L.setImperial(imperial);
let settings;
let zoomedPosition;
let curGroups;
let contentEl;
let metaEl;
let containerEl;


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
        containerEl.appendChild(el);
        containerEl.appendChild(gap);
        positions.set(relPos, el);
        el.addEventListener('click', ev => {
            if (zoomedPosition == null) {
                zoomedPosition = Number(ev.currentTarget.style.getPropertyValue('--rel-pos'));
            } else {
                zoomedPosition = null;
            }
            render();
        });
    }
    return positions.get(relPos);
}


function render() {
    if (zoomedPosition != null) {
        renderZoomed(curGroups);
    } else {
        renderGroups(curGroups);
    }
}


function renderZoomed(groups) {
    if (!groups) {
        return;
    }
    let centerIdx = groups.findIndex(x => x.watching);
    const pos = zoomedPosition;
    const idx = Math.max(0, Math.min(centerIdx + pos, groups.length - 1));
    const group = groups[idx];
    if (!group) {
        console.warn("XXX Unexpected missing group");
        return;
    }
    const athletes = group.athletes;
    centerIdx = Math.max(0, athletes.findIndex(x => x.watching));
    const totAthletes = athletes.length;
    const gapField = settings.zoomedGapField || 'distance';
    const gapProp = gapField === 'distance' ? 'gapDistance' : 'gap';
    const totGap = athletes[athletes.length - 1][gapProp] - athletes[0][gapProp];
    // Keep total flex-grow < 1 for tight groups.  I.e. prevent 100% height usage when small
    const flexFactor = gapField === 'distance' ? 0.15 : 0.333;
    contentEl.style.setProperty('--total-athletes', totAthletes);
    contentEl.style.setProperty('--total-gap', totGap * flexFactor);
    const athletesLabel = totAthletes === 1 ? 'Athlete' : 'Athletes';
    const groupLabel = pos ? `${H.place(Math.abs(pos))} ${pos > 0 ? 'behind' : 'ahead'}` : 'Your Group';
    const powerLabel = H.power(group.power, {suffix: true, html: true});
    const speedLabel = H.pace(group.speed, {precision: 0, suffix: true, html: true});
    metaEl.innerHTML = [
        `${groupLabel}, ${totAthletes} ${athletesLabel}`,
        `${powerLabel}, ${speedLabel}`,
    ].map(x => `<div class="line">${x}</div>`).join('');
    const active = new Set();
    const bikeLength = 2;  // meters
    for (const [i, athlete] of athletes.entries()) {
        // NOTE: gap measurement is always to the next athlete or null.
        const next = athletes[i + 1];
        const relPos = i - centerIdx;
        active.add(relPos);
        const posEl = getOrCreatePosition(relPos);
        posEl.classList.toggle('watching', !!athlete.watching);
        posEl.style.setProperty('--athletes', 1);
        let label;
        let avatar = 'images/blankavatar.png';
        let fLast;
        if (athlete.athlete) {
            const a = athlete.athlete;
            if (a.name) {
                fLast = `${a.name[0].trim().substr(0, 1)}.${a.name[1].trim()}`;
                // Only use avatar if we have fLast to avoid a nameless bubble
                if (a.avatar) {
                    avatar = a.avatar;
                } else {
                    label = a.name.map(x => x[0].toUpperCase()).join('').substr(0, 2);
                }
            }
        }
        const attacker = athlete.power > 400 && (athlete.power / group.power) > 2;
        if (attacker) {
            posEl.classList.add('attn', 'attack');
        } else {
            posEl.classList.remove('attn', 'attack');
        }
        const bubble = posEl.querySelector('.bubble');
        if (label) {
            bubble.textContent = label;
        } else {
            bubble.innerHTML = `<img src="${avatar}"/>`;
        }
        const lines = [`<div class="line ${attacker ? 'attn' : ''}">${H.number(athlete.power)}w</div>`];
        const minorField = settings.zoomedSecondaryField || 'heartrate';
        if (minorField === 'heartrate') {
            if (athlete.heartrate) {
                lines.push(`<div class="line minor">${H.number(athlete.heartrate)}<small>bpm</small></div>`);
            }
        } else if (minorField === 'draft') {
            if (athlete.draft != null) {
                lines.push(`<div class="line minor">${H.number(athlete.draft)}<small>% (draft)</small></div>`);
                if (fLast) {
                    lines.push(`<div class="line minor">${fLast}</div>`);
                }
            }
        } else if (minorField === 'speed') {
            if (athlete.speed != null) {
                const unit = imperial ? 'mph' : 'kph';
                lines.push(`<div class="line minor">${H.pace(athlete.speed, {precision: 0})}<small>${unit}</small></div>`);
            }
        } else if (minorField === 'power-60s') {
            const p = athlete.stats.power.smooth[60];
            if (p != null) {
                lines.push(`<div class="line minor">${H.number(p)}w (1m)</div>`);
            }
        }
        posEl.querySelector('.desc .lines').innerHTML = lines.join('');
        const gapEl = posEl.nextSibling;
        const gap = next ? Math.abs(next[gapProp] - athlete[gapProp]) : 0;
        gapEl.style.setProperty('--inner-gap', Math.max(0, gap - bikeLength) * flexFactor);
        gapEl.style.setProperty('--outer-gap', gap * flexFactor);
        gapEl.style.setProperty('--gap-sign', -1);
        gapEl.classList.toggle('alone', !gap);
        let dur;
        if (gapField === 'time') {
            dur = gap && H.number(gap, {precision: 1}) + 's';
            gapEl.classList.toggle('real', !!next && !next.isGapEst);
        } else {
            dur = gap && (H.number(Math.max(0, gap - bikeLength) * (imperial ? 3.28084 : 1)) + (imperial ? 'ft' : 'm'));
            gapEl.classList.toggle('real', true);
        }
        gapEl.querySelector('.desc .line.time').textContent = dur ? dur : '';
    }
    for (const [pos, x] of positions.entries()) {
        x.classList.toggle('hidden', !active.has(pos));
    }
}


function renderGroups(groups) {
    if (!groups) {
        return;
    }
    let centerIdx = groups.findIndex(x => x.watching);
    groups = groups.slice(
        Math.max(0, centerIdx - (settings.maxAhead || 3)),
        centerIdx + (settings.maxBehind || 3) + 1);
    centerIdx = groups.findIndex(x => x.watching);
    if (centerIdx === -1) {
        return;
    }
    const totAthletes = groups.reduce((agg, x) => agg + x.athletes.length, 0);
    const totGap = groups[groups.length - 1].gap - groups[0].gap;
    contentEl.style.setProperty('--total-athletes', totAthletes);
    contentEl.style.setProperty('--total-gap', totGap);
    const athletesLabel = totAthletes === 1 ? 'Athlete' : 'Athletes';
    metaEl.textContent = `${totAthletes} ${athletesLabel}`;
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
            label = n ? n.map(x => x[0].toUpperCase()).join('').substr(0, 2) : '1';
            groupEl.classList.remove('attn', 'attack');
        } else {
            label = H.number(group.athletes.length);
            let max = -Infinity;
            for (const x of group.athletes) {
                const p = x.stats.power.smooth[5];
                if (p > max) {
                    max = p;
                }
            }
            if (group.athletes.length > 1 && max > 400 && (max / group.power) > 2) {
                groupEl.classList.add('attn', 'attack');
                lines.push(`<div class="line attn">${H.number(max)}<small>w Attacker!</small></div>`);
            } else {
                groupEl.classList.remove('attn', 'attack');
            }
        }
        groupEl.querySelector('.bubble').textContent = label;
        lines.push(`<div class="line">${H.number(group.power)}<small>w</small></div>`);
        const minorField = settings.groupsSecondaryField || 'speed';
        if (minorField === 'heartrate') {
            if (group.heartrate) {
                lines.push(`<div class="line minor">${H.number(group.heartrate)}<small>bpm</small></div>`);
            }
        } else if (minorField === 'draft') {
            if (group.draft != null) {
                lines.push(`<div class="line minor">${H.number(group.draft)}<small>% (draft)</small></div>`);
            }
        } else if (minorField === 'speed') {
            if (group.speed != null) {
                const unit = imperial ? 'mph' : 'kph';
                lines.push(`<div class="line minor">${H.pace(group.speed, {precision: 0})}<small>${unit}</small></div>`);
            }
        } else if (minorField === 'power-highest') {
            const highest = sauce.data.max(group.athletes.map(x => x.power));
            if (highest != null) {
                lines.push(`<div class="line minor">${H.number(highest)}w (highest)</div>`);
            }
        } else if (minorField === 'power-median') {
            const med = sauce.data.median(group.athletes.map(x => x.power));
            if (med != null) {
                lines.push(`<div class="line minor">${H.number(med)}w (median)</div>`);
            }
        }

        groupEl.querySelector('.desc .lines').innerHTML = lines.join('');
        const gapEl = groupEl.nextSibling;
        const innerGap = next ? group.innerGap : 0;
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


function setBackground({solidBackground, backgroundColor}) {
    const doc = document.documentElement;
    doc.classList.toggle('solid-background', solidBackground);
    if (solidBackground) {
        doc.style.setProperty('--background-color', backgroundColor);
    } else {
        doc.style.removeProperty('--background-color');
    }
}


export async function main() {
    common.initInteractionListeners({settingsKey});
    contentEl = document.querySelector('#content');
    metaEl = document.querySelector('#meta');
    containerEl = document.querySelector('#container');
    settings = common.storage.get(settingsKey, {
        detectAttacks: true,
        maxAhead: 4,
        maxBehind: 2,
        groupsSecondaryField: 'speed',
        zoomedSecondaryField: 'draft',
        zoomedGapField: 'distance',
        solidBackground: false,
        backgroundColor: '#00ff00',
    });
    setBackground(settings);
    document.addEventListener('settings-updated', () => {
        settings = common.storage.get(settingsKey);
        setBackground(settings);
        render();
    });
    document.addEventListener('global-settings-updated', ev => {
        if (ev.data.key === '/imperialUnits') {
            L.setImperial(imperial = ev.data.data);
        }
    });
    common.subscribe('groups', groups => {
        if (!groups.length) {
            return;
        }
        curGroups = groups;
        render();
    });
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form', {settingsKey});
}
