import sauce from '../../shared/sauce/index.mjs';
import common from './common.mjs';

const L = sauce.locale;
const H = L.human;
const positions = new Map();
const settingsKey = 'groups-settings-v6';
let imperial = common.storage.get('/imperialUnits');
L.setImperial(imperial);
let settings;
let zoomedPosition;
let curGroups;
let contentEl;
let metaEl;
let containerEl;


function pwrFmt(p) {
    return H.power(p, {suffix: true, html: true});
}


function spdFmt(s) {
    return H.pace(s, {precision: 0, suffix: true, html: true});
}


function getOrCreatePosition(relPos) {
    if (!positions.has(relPos)) {
        const el = document.createElement('div');
        el.classList.add('position');
        el.style.setProperty('--rel-pos', relPos);
        el.innerHTML = `
            <div class="desc left empty">
                <div class="lines"></div>
            </div>
            <div class="bubble"></div>
            <div class="desc right empty">
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
        positions.set(relPos, {
            el,
            leftDesc: el.querySelector('.desc.left'),
            leftLines: el.querySelector('.desc.left .lines'),
            rightDesc: el.querySelector('.desc.right'),
            rightLines: el.querySelector('.desc.right .lines'),
            bubble: el.querySelector('.bubble'),
            gap: {
                el: gap,
                leftLine: gap.querySelector('.lines .line.time'),
            },
        });
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
    const athletes = group.athletes.slice(0, settings.maxZoomed);
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
    metaEl.innerHTML = [
        `${groupLabel}, ${totAthletes} ${athletesLabel}`,
        `${pwrFmt(group.power)}, ${spdFmt(group.speed)}`,
    ].map(x => `<div class="line">${x}</div>`).join('');
    const active = new Set();
    const bikeLength = 2;  // meters
    for (const [i, athlete] of athletes.entries()) {
        // NOTE: gap measurement is always to the next athlete or null.
        const next = athletes[i + 1];
        active.add(i);
        const pos = getOrCreatePosition(i);
        pos.el.dataset.tooltip = `Position: ${i}\nClick bubble to zoom out`;
        if (i >= athletes.length / 2) {
            pos.el.setAttribute('data-tooltip-above', '');
            pos.el.removeAttribute('data-tooltip-below');
        } else {
            pos.el.setAttribute('data-tooltip-below', '');
            pos.el.removeAttribute('data-tooltip-above');
        }
        pos.el.classList.toggle('watching', !!athlete.watching);
        pos.el.style.setProperty('--athletes', 1);
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
        if (label) {
            pos.bubble.textContent = label;
        } else {
            pos.bubble.innerHTML = `<img src="${avatar}"/>`;
        }
        const leftLines = [];
        if (fLast) {
            leftLines.push(`<div class="line minor">${fLast}</div>`);
        }
        const attacker = athlete.power > 400 && (athlete.power / group.power) > 2;
        if (attacker) {
            pos.el.classList.add('attn', 'attack');
            leftLines.push(`<div class="line minor attn">Attacking!</div>`);
        } else {
            pos.el.classList.remove('attn', 'attack');
        }
        const rightLines = [`<div class="line">${pwrFmt(athlete.power)}</div>`];
        const minorField = settings.zoomedSecondaryField || 'heartrate';
        if (minorField === 'heartrate') {
            if (athlete.heartrate) {
                rightLines.push(`<div class="line minor">${H.number(athlete.heartrate)}<abbr class="unit">bpm</abbr></div>`);
            }
        } else if (minorField === 'draft') {
            if (athlete.draft != null) {
                rightLines.push(`<div class="line minor">${H.number(athlete.draft)}<abbr class="unit">% (draft)</abbr></div>`);
            }
        } else if (minorField === 'speed') {
            if (athlete.speed != null) {
                const unit = imperial ? 'mph' : 'kph';
                rightLines.push(`<div class="line minor">${H.pace(athlete.speed, {precision: 0})}<abbr class="unit">${unit}</abbr></div>`);
            }
        } else if (minorField === 'power-60s') {
            const p = athlete.stats.power.smooth[60];
            if (p != null) {
                rightLines.push(`<div class="line minor">${pwrFmt(p)} ` +
                    `<abbr class="unit">(1m)</abbr></div>`);
            }
        }
        pos.leftLines.innerHTML = leftLines.join('');
        pos.leftDesc.classList.toggle('empty', !leftLines.length);
        pos.rightLines.innerHTML = rightLines.join('');
        pos.rightDesc.classList.toggle('empty', !rightLines.length);
        const gap = next ? Math.abs(next[gapProp] - athlete[gapProp]) : 0;
        pos.gap.el.style.setProperty('--inner-gap', Math.max(0, gap - bikeLength) * flexFactor);
        pos.gap.el.style.setProperty('--outer-gap', gap * flexFactor);
        pos.gap.el.style.setProperty('--gap-sign', -1);
        pos.gap.el.classList.toggle('alone', !gap);
        let dur;
        if (gapField === 'time') {
            dur = gap && H.number(gap, {precision: 1}) + 's';
            pos.gap.el.classList.toggle('real', !!next && !next.isGapEst);
        } else {
            dur = gap && (H.number(Math.max(0, gap - bikeLength) * (imperial ? 3.28084 : 1)) + (imperial ? 'ft' : 'm'));
            pos.gap.el.classList.toggle('real', true);
        }
        pos.gap.leftLine.textContent = dur ? dur : '';
    }
    for (const [i, {el}] of positions.entries()) {
        el.classList.toggle('hidden', !active.has(i));
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
    metaEl.innerHTML = `<div class="line">${totAthletes} ${athletesLabel}</div>`;
    const active = new Set();
    for (const [i, group] of groups.entries()) {
        // NOTE: gap measurement is always to the next group or null.
        const next = groups[i + 1];
        const relPos = i - centerIdx;
        active.add(relPos);
        const pos = getOrCreatePosition(relPos);
        pos.el.dataset.tooltip = `Group: ${relPos}\nClick bubble to zoom in`;
        if (i >= groups.length / 2) {
            pos.el.setAttribute('data-tooltip-above', '');
            pos.el.removeAttribute('data-tooltip-below');
        } else {
            pos.el.setAttribute('data-tooltip-below', '');
            pos.el.removeAttribute('data-tooltip-above');
        }
        pos.el.classList.toggle('watching', !!group.watching);
        pos.el.style.setProperty('--athletes', group.athletes.length);
        let label;
        const leftLines = [];
        const rightLines = [];
        if (group.athletes.length === 1 && group.athletes[0].athlete) {
            const n = group.athletes[0].athlete.name;
            label = n ? n.map(x => x[0].toUpperCase()).join('').substr(0, 2) : '1';
            pos.el.classList.remove('attn', 'attack');
        } else {
            label = H.number(group.athletes.length);
            let max = -Infinity;
            for (const x of group.athletes) {
                const p = x.stats.power.smooth[5];
                if (p > max) {
                    max = p;
                }
            }
            const attacker = group.athletes.length > 1 && max > 400 && (max / group.power) > 2;
            if (attacker) {
                pos.el.classList.add('attn', 'attack');
                leftLines.push(`<div class="line attn">Attacker!</div>`);
                leftLines.push(`<div class="line minor attn">${pwrFmt(max)}</div>`);
            } else {
                pos.el.classList.remove('attn', 'attack');
            }
        }
        pos.bubble.textContent = label;
        rightLines.push(`<div class="line">${pwrFmt(group.power)}</div>`);
        const minorField = settings.groupsSecondaryField || 'speed';
        if (minorField === 'heartrate') {
            if (group.heartrate) {
                rightLines.push(`<div class="line minor">${H.number(group.heartrate)}<abbr class="unit">bpm</abbr></div>`);
            }
        } else if (minorField === 'draft') {
            if (group.draft != null) {
                rightLines.push(`<div class="line minor">${H.number(group.draft)}<abbr class="unit">% (draft)</abbr></div>`);
            }
        } else if (minorField === 'speed') {
            if (group.speed != null) {
                const unit = imperial ? 'mph' : 'kph';
                rightLines.push(`<div class="line minor">${H.pace(group.speed, {precision: 0})}<abbr class="unit">${unit}</abbr></div>`);
            }
        } else if (minorField === 'power-highest') {
            const highest = sauce.data.max(group.athletes.map(x => x.power));
            if (highest != null) {
                rightLines.push(`<div class="line minor">${pwrFmt(highest)} ` +
                    `<abbr class="unit">(highest)</abbr></div>`);
            }
        } else if (minorField === 'power-median') {
            const med = sauce.data.median(group.athletes.map(x => x.power));
            if (med != null) {
                rightLines.push(`<div class="line minor">${pwrFmt(med)} ` +
                    `<abbr class="unit">(median)</abbr></div>`);
            }
        }
        pos.leftLines.innerHTML = leftLines.join('');
        pos.leftDesc.classList.toggle('empty', !leftLines.length);
        pos.rightLines.innerHTML = rightLines.join('');
        pos.rightDesc.classList.toggle('empty', !rightLines.length);
        const innerGap = next ? group.innerGap : 0;
        const gap = relPos < 0 ? group.gap : next ? next.gap : 0;
        pos.gap.el.style.setProperty('--inner-gap', innerGap);
        pos.gap.el.style.setProperty('--outer-gap', Math.abs(gap));
        pos.gap.el.style.setProperty('--gap-sign', gap > 0 ? 1 : -1);
        pos.gap.el.classList.toggle('real', !!next && !next.isGapEst);
        pos.gap.el.classList.toggle('alone', !innerGap);
        const dur = innerGap && H.duration(Math.abs(gap), {short: true, seperator: ' '});
        pos.gap.leftLine.textContent = dur ? (gap > 0 ? '+' : '-') + dur : '';
    }
    for (const [i, {el}] of positions.entries()) {
        el.classList.toggle('hidden', !active.has(i));
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
        maxZoomed: 10,
        groupsSecondaryField: 'speed',
        zoomedSecondaryField: 'draft',
        zoomedGapField: 'distance',
        solidBackground: false,
        backgroundColor: '#00ff00',
        refreshInterval: 1,
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
    let ts = 0;
    common.subscribe('groups', groups => {
        if (!groups.length) {
            return;
        }
        curGroups = groups;
        const now = Date.now();
        if (now - ts > (settings.refreshInterval * 1000 - 100)) {
            ts = now;
            render();
        }
    });
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form', {settingsKey});
}
