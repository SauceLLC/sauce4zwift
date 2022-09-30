import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';

const L = sauce.locale;
const H = L.human;
const positions = new Map();
let zoomedPosition = common.storage.get('zoomedPosition');
let imperial = common.settingsStore.get('/imperialUnits');
L.setImperial(imperial);
let curGroups;
let contentEl;
let metaEl;
let aheadEl;
let behindEl;
let containerEl;
const doc = document.documentElement;

common.settingsStore.setDefault({
    detectAttacks: true,
    maxAhead: 4,
    maxBehind: 2,
    maxZoomed: 8,
    groupsPrimaryField: 'power',
    zoomedPrimaryField: 'power',
    groupsSecondaryField: 'speed',
    zoomedSecondaryField: 'draft',
    zoomedGapField: 'distance',
    solidBackground: false,
    backgroundColor: '#00ff00',
    refreshInterval: 2,
});

// XXX Need a migration system.
common.settingsStore.get('groupsPrimaryField', 'power');
common.settingsStore.get('zoomedPrimaryField', 'power');

const settings = common.settingsStore.get();
setBackground();


function pwrFmt(p) {
    return H.power(p, {suffix: true, html: true});
}


function wkgFmt(wkg) {
    return H.wkg(wkg, {suffix: true, html: true});
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
                <div class="actions">
                    <ms data-action="watch" title="Watch">video_camera_front</ms>
                </div>
                <div class="lines"></div>
            </div>
            <a class="bubble" target="_blank"></a>
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
        const nodes = {
            watchTarget: null,
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
            actions: {
                watch: el.querySelector('[data-action="watch"]'),
            },
        };
        positions.set(relPos, nodes);
        nodes.bubble.addEventListener('click', ev => {
            if (!ev.currentTarget.href && zoomedPosition == null) {
                ev.preventDefault();
                zoomedPosition = relPos;
                common.storage.set('zoomedPosition', zoomedPosition);
                render();
            }
        });
        nodes.leftDesc.querySelector('.actions').addEventListener('click', async ev => {
            const ms = ev.target.closest('ms[data-action]');
            if (!ms) {
                return;
            }
            if (ms.dataset.action === 'watch') {
                await common.rpc.watch(nodes.watchTarget);
            }
        });
    }
    return positions.get(relPos);
}


function render() {
    const zoomed = zoomedPosition != null;
    contentEl.classList.toggle('zoomed', zoomed);
    if (zoomed) {
        renderZoomed(curGroups);
    } else {
        renderGroups(curGroups);
    }
}


function isAttack(power, groupPower) {
    return settings.detectAttacks &&
        (power > 650 || (power > 400 && power > groupPower * 2));
}


function renderZoomed(groups) {
    if (!groups) {
        return;
    }
    const groupCenterIdx = groups.findIndex(x => x.watching);
    const pos = zoomedPosition;
    const idx = Math.max(0, Math.min(groupCenterIdx + pos, groups.length - 1));
    const group = groups[idx];
    if (!group) {
        console.warn("XXX Unexpected missing group");
        return;
    }
    const groupSize = group.athletes.length;
    const watchingCenterIdx = pos === 0 ? group.athletes.findIndex(x => x.watching) : 0;
    const ahead = Math.max(0, watchingCenterIdx - Math.ceil(settings.maxZoomed / 2));
    const end = Math.min(group.athletes.length, ahead + settings.maxZoomed);
    const behind = group.athletes.length - end;
    const athletes = group.athletes.slice(ahead, end);
    contentEl.style.setProperty('--total-athletes', athletes.length);  // visual only
    const athletesLabel = groupSize === 1 ? 'Athlete' : 'Athletes';
    const groupLabel = pos ? `${H.place(Math.abs(pos))} ${pos > 0 ? 'behind' : 'ahead'}` : 'Your Group';
    const primaryFmt = {
        power: ({power}) => pwrFmt(power),
        wkg: ({power, weight}) => weight ? wkgFmt(power / weight) : pwrFmt(power),
    }[settings.zoomedPrimaryField || 'power'];
    metaEl.innerHTML = [
        `${groupLabel}, ${groupSize} ${athletesLabel}`,
        `${primaryFmt(group)}, ${spdFmt(group.speed)}`,
    ].map(x => `<div class="line">${x}</div>`).join('');
    const active = new Set();
    aheadEl.classList.toggle('visible', !!ahead);
    if (ahead) {
        aheadEl.textContent = `+${ahead} ahead`;
    }
    behindEl.classList.toggle('visible', !!behind);
    if (behind) {
        behindEl.textContent = `+${behind} behind`;
    }
    for (const [i, athlete] of athletes.entries()) {
        // NOTE: gap measurement is always to the next athlete or null.
        const next = athletes[i + 1];
        active.add(i);
        const pos = getOrCreatePosition(i);
        pos.bubble.title = `Click for athlete details`;
        pos.bubble.href = `athlete.html?athleteId=${athlete.athleteId}&width=800&height=340`;
        pos.el.classList.toggle('watching', !!athlete.watching);
        pos.el.style.setProperty('--athletes', 1);
        let label;
        let avatar = 'images/blankavatar.png';
        let fLast;
        let team;
        if (athlete.athlete) {
            const a = athlete.athlete;
            team = a.team;  // hehehe
            if (a.sanitizedName && a.sanitizedName.length) {
                fLast = a.sanitizedName.length > 1 ?
                    [a.sanitizedName[0][0], a.sanitizedName[1]].filter(x => x).join('. ') :
                    fLast = a.sanitizedName[0];
            }
            if (a.avatar) {
                avatar = a.avatar;
            } else {
                label = a.initials;
            }
        }
        if (label) {
            pos.bubble.textContent = label;
        } else {
            pos.bubble.innerHTML = `<img src="${avatar}"/>`;
        }
        const leftLines = [];
        if (isAttack(athlete.state.power, group.power)) {
            pos.el.classList.add('attn', 'attack');
            leftLines.push(`<div class="line major attn">Attack!</div>`);
        } else {
            pos.el.classList.remove('attn', 'attack');
            if (fLast) {
                leftLines.push(`<div class="line minor">${fLast}</div>`);
                if (team) {
                    leftLines.push(common.teamBadge(team));
                }
            }
        }
        const priLine = primaryFmt({
            power: athlete.state.power,
            weight: athlete.athlete && athlete.athlete.weight
        });
        const rightLines = [`<div class="line">${priLine}</div>`];
        const minorField = settings.zoomedSecondaryField || 'heartrate';
        if (minorField === 'heartrate') {
            if (athlete.state.heartrate) {
                rightLines.push(`<div class="line minor">${H.number(athlete.state.heartrate)}<abbr class="unit">bpm</abbr></div>`);
            }
        } else if (minorField === 'draft') {
            if (athlete.state.draft != null) {
                rightLines.push(`<div class="line minor">${H.number(athlete.state.draft)}<abbr class="unit">% (draft)</abbr></div>`);
            }
        } else if (minorField === 'speed') {
            if (athlete.state.speed != null) {
                const unit = imperial ? 'mph' : 'kph';
                rightLines.push(`<div class="line minor">${H.pace(athlete.state.speed, {precision: 0})}<abbr class="unit">${unit}</abbr></div>`);
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
        const gap = next ? Math.abs(next.gap - athlete.gap) : 0;
        pos.gap.el.style.setProperty('--inner-gap', gap);
        pos.gap.el.style.setProperty('--outer-gap', gap);
        pos.gap.el.style.setProperty('--gap-sign', -1);
        let dur;
        pos.gap.el.classList.toggle('real', true);
        if (gap) {
            if (settings.zoomedGapField === 'time') {
                dur = gap > 0.5 && (H.number(gap) + 's');
            } else {
                const gapDistance = Math.abs(next.gapDistance - athlete.gapDistance);
                const units = imperial ? 'ft' : 'm';
                dur = gapDistance && gapDistance > 2 &&
                    (H.number(gapDistance * (imperial ? 3.28084 : 1)) + units);
            }
        }
        pos.gap.leftLine.textContent = dur ? dur : '';
        pos.gap.el.classList.toggle('alone', !gap);
        pos.gap.el.classList.toggle('has-label', !!dur);
        pos.actions.watch.classList.toggle('hidden', athlete.watching);
        if (!athlete.watching) {
            pos.watchTarget = athlete.athleteId;
        }
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
    const ahead = Math.max(0, centerIdx - (settings.maxAhead || 3));
    const end = Math.min(groups.length, centerIdx + (settings.maxBehind || 3) + 1);
    const behind = groups.length - end;
    groups = groups.slice(ahead, end);
    centerIdx = groups.findIndex(x => x.watching);
    if (centerIdx === -1) {
        return;
    }
    const primaryFmt = {
        power: ({power}) => pwrFmt(power),
        wkg: ({power, weight}) => weight ? wkgFmt(power / weight) : pwrFmt(power),
    }[settings.groupsPrimaryField || 'power'];
    const totAthletes = groups.reduce((agg, x) => agg + x.athletes.length, 0);
    contentEl.style.setProperty('--total-athletes', totAthletes);
    const athletesLabel = totAthletes === 1 ? 'Athlete' : 'Athletes';
    metaEl.innerHTML = `<div class="line">${totAthletes} ${athletesLabel}</div>`;
    const active = new Set();
    aheadEl.classList.toggle('visible', !!ahead);
    if (ahead) {
        aheadEl.textContent = `+${ahead} ahead`;
    }
    behindEl.classList.toggle('visible', !!behind);
    if (behind) {
        behindEl.textContent = `+${behind} behind`;
    }
    for (const [i, group] of groups.entries()) {
        // NOTE: gap measurement is always to the next group or null.
        const next = groups[i + 1];
        const relPos = i - centerIdx;
        active.add(relPos);
        const pos = getOrCreatePosition(relPos);
        pos.bubble.title = `Click to switch to zoomed in view`;
        if (pos.bubble.href) {
            pos.bubble.removeAttribute('href');
        }
        pos.el.classList.toggle('watching', !!group.watching);
        pos.el.style.setProperty('--athletes', group.athletes.length);
        let label;
        const leftLines = [];
        const rightLines = [];
        if (group.athletes.length === 1 && group.athletes[0].athlete) {
            label = group.athletes[0].athlete.initials || '1';
            pos.el.classList.remove('attn', 'attack');
        } else {
            label = H.number(group.athletes.length);
            let max = -Infinity;
            let weight;
            for (const x of group.athletes) {
                const p = x.stats.power.smooth[5];
                if (p > max) {
                    max = p;
                    weight = x.athlete && x.athlete.weight;
                }
            }
            if (isAttack(max, group.power)) {
                pos.el.classList.add('attn', 'attack');
                leftLines.push(`<div class="line attn">Attack!</div>`);
                leftLines.push(`<div class="line minor attn">${primaryFmt({power: max, weight})}</div>`);
            } else {
                pos.el.classList.remove('attn', 'attack');
            }
        }
        pos.bubble.textContent = label;
        rightLines.push(`<div class="line">${primaryFmt(group)}</div>`);
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
            const highest = sauce.data.max(group.athletes.map(x => x.state.power));
            if (highest != null) {
                rightLines.push(`<div class="line minor">${pwrFmt(highest)} ` +
                    `<abbr class="unit">(highest)</abbr></div>`);
            }
        } else if (minorField === 'power-median') {
            const med = sauce.data.median(group.athletes.map(x => x.state.power));
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
        pos.gap.el.classList.toggle('has-label', !!innerGap);
        const dur = innerGap && H.duration(Math.abs(gap), {short: true, seperator: ' '});
        pos.gap.leftLine.textContent = dur ? (gap > 0 ? '+' : '-') + dur : '';
        pos.actions.watch.classList.toggle('hidden', group.watching);
        if (!group.watching) {
            pos.watchTarget = group.athletes[Math.trunc(group.athletes.length / 2)].athleteId;
        }
    }
    for (const [i, {el}] of positions.entries()) {
        el.classList.toggle('hidden', !active.has(i));
    }
}


function setBackground() {
    const {solidBackground, backgroundColor} = settings;
    doc.classList.toggle('solid-background', !!solidBackground);
    if (solidBackground) {
        doc.style.setProperty('--background-color', backgroundColor);
    } else {
        doc.style.removeProperty('--background-color');
    }
}


export async function main() {
    common.initInteractionListeners();
    contentEl = document.querySelector('#content');
    metaEl = document.querySelector('#meta');
    containerEl = document.querySelector('#container');
    aheadEl = document.querySelector('#ahead');
    behindEl = document.querySelector('#behind');
    contentEl.querySelector('.zoom-out').addEventListener('click', ev => {
        zoomedPosition = null;
        common.storage.set('zoomedPosition', zoomedPosition);
        render();
    });
    common.settingsStore.addEventListener('changed', ev => {
        const changed = ev.data.changed;
        if (changed.has('/imperialUnits')) {
            L.setImperial(imperial = changed.get('/imperialUnits'));
        }
        setBackground();
        render();
    });
    const gcs = await common.rpc.getGameConnectionStatus();
    if (gcs) {
        common.subscribe('status', status =>
            doc.classList.toggle('game-connection', status.connected),
            {source: 'gameConnection'});
        doc.classList.toggle('game-connection', gcs.connected);
    }
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
    await common.initSettingsForm('form')();
}
