import * as Sauce from '../../shared/sauce/index.mjs';
import * as Common from './common.mjs';

Common.enableSentry();

const L = Sauce.locale;
const H = L.human;
const availPositionBubbles = [];
const availGapSpacers = [];
const positionBubbleElementMap = new WeakMap();
const gapSpacerElementMap = new WeakMap();
const athleteCache = new Sauce.LRUCache(1024);
let zoomedGroup = Common.storage.get('zoomedGroup');
let curGroups;
let eventSubgroup;
let contentEl;
let metaEl;
let aheadEl;
let behindEl;
let containerEl;
const doc = document.documentElement;

Common.settingsStore.setDefault({
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
    hideHeader: false,
    labelAngle: 50,
    horizLTR: true,
    zoomPriority: 'position',
    reduceOverhead: true,
});

// XXX Need a migration system.
const legacyZoomedPosition = Common.storage.get('zoomedPosition');
if (zoomedGroup == null && legacyZoomedPosition != null) {
    Common.storage.set('zoomedGroup', {position: legacyZoomedPosition});
    Common.storage.set('zoomedPosition', null);
}
Common.settingsStore.get('zoomPriority', 'position');
Common.settingsStore.get('groupsPrimaryField', 'power');
Common.settingsStore.get('zoomedPrimaryField', 'power');
Common.settingsStore.get('reduceOverhead', true);

const settings = Common.settingsStore.get();


async function getAthletes(ids) {
    const missing = ids.filter(x => athleteCache.get(x) === undefined);
    if (missing.length) {
        for (const x of missing) {
            athleteCache.set(x, null);
        }
        const athletes = await Common.rpc.getAthletes(missing);
        for (const [i, x] of athletes.entries()) {
            const id = missing[i];
            if (!x) {
                setTimeout(() => {
                    if (athleteCache.get(id) === null) {
                        athleteCache.set(id, undefined);  // allow retry
                    }
                }, 5000);
            } else {
                athleteCache.set(id, x);
            }
        }
    }
    return ids.map(x => athleteCache.get(x));
}


function getSubgroupLazy(id) {
    const sg = Common.getEventSubgroup(id);
    if (!sg || sg instanceof Promise) {
        return null;
    }
    return sg;
}


function setMaxPositions() {
    let v;
    if (zoomedGroup != null) {
        v = settings.maxZoomed || 8;
    } else {
        v = (settings.maxAhead || 0) + (settings.maxBehind || 0) + 1;
    }
    doc.style.setProperty('--max-positions', v);
}


function pwrFmt(p, options) {
    return H.power(p, {suffix: true, html: true, ...options});
}


function wkgFmt(wkg) {
    return H.wkg(wkg, {suffix: true, html: true});
}


function spdFmt(s) {
    return H.pace(s, {precision: 0, suffix: true, html: true});
}

class GapSpacer {

    static create(relPos) {
        const instance = new this(relPos);
        availGapSpacers.push(instance);
        gapSpacerElementMap.set(instance.nodes.el, instance);
        containerEl.append(instance.nodes.el);
        return instance;
    }

    constructor(relPos) {
        this.relativePosition = relPos;
        const el = document.createElement('div');
        el.style.setProperty('order', relPos * 2 + 1);
        el.classList.add('gap', 'hidden');
        el.innerHTML = `<div class="desc"><div class="lines"></div></div>`;
        this.nodes = {
            el,
            desc: el.querySelector('.desc'),
            lines: el.querySelector('.desc .lines'),
        };
    }

    setSizes(inner, outer) {
        const el = this.nodes.el;
        el.style.setProperty('--inner-gap', inner);
        el.style.setProperty('--outer-gap', Math.abs(outer));
        el.style.setProperty('--gap-sign', outer > 0 ? 1 : -1);
    }

    setLines(html) {
        Common.softInnerHTML(this.nodes.lines, html);
        this.nodes.desc.classList.toggle('empty', !html);
    }

    isHidden() {
        return this.nodes.el.classList.contains('hidden');
    }

    toggleHidden(hidden) {
        return this.nodes.el.classList.toggle('hidden', hidden);
    }

    remove() {
        const regIdx = availGapSpacers.indexOf(this);
        if (regIdx !== -1) {
            availGapSpacers.splice(regIdx, 1);
        }
        this.nodes.el.remove();
        this.nodes = null;
    }
}


class PositionBubble {

    static create(ident) {
        const instance = new this(ident);
        availPositionBubbles.push(instance);
        positionBubbleElementMap.set(instance.nodes.el, instance);
        containerEl.append(instance.nodes.el);
        return instance;
    }

    constructor(ident) {
        this.ident = ident;
        this.watchTarget = null;
        const el = document.createElement('div');
        el.classList.add('position', 'hidden');
        el.innerHTML = `
            <div class="desc left empty">
                <div class="lines"></div>
                <div class="actions"><ms data-action="watch" title="Watch">video_camera_front</ms></div>
            </div>
            <div class="bubble-holder">
                <div class="rings"></div>
                <a class="bubble" target="_blank"></a>
            </div>
            <div class="desc right empty"><div class="lines"></div></div>
        `;
        this.nodes = {
            el,
            bubbleHolder: el.querySelector('.bubble-holder'),
            bubble: el.querySelector('.bubble'),
            leftDesc: el.querySelector('.desc.left'),
            leftLines: el.querySelector('.desc.left .lines'),
            rightDesc: el.querySelector('.desc.right'),
            rightLines: el.querySelector('.desc.right .lines'),
            actions: {
                watch: el.querySelector('[data-action="watch"]'),
            },
        };
        this.nodes.bubble.addEventListener('click', ev => this.onBubbleClick(ev));
        this.nodes.leftDesc.querySelector('.actions')
            .addEventListener('click', ev => this.onLeftActionsClick(ev));
    }

    isHidden() {
        return this.nodes.el.classList.contains('hidden');
    }

    toggleHidden(hidden) {
        return this.nodes.el.classList.toggle('hidden', hidden);
    }

    setWatchTarget(id) {
        this.watchTarget = id;
    }

    setLeftLines(html) {
        Common.softInnerHTML(this.nodes.leftLines, html);
        this.nodes.leftDesc.classList.toggle('empty', !html);
    }

    setRightLines(html) {
        Common.softInnerHTML(this.nodes.rightLines, html);
        this.nodes.rightDesc.classList.toggle('empty', !html);
    }

    setRelativePosition(relPos) {
        if (relPos !== this.relativePosition) {
            this.nodes.el.style.setProperty('order', relPos * 2);
            this.relativePosition = relPos;
        }
    }

    async onLeftActionsClick(ev) {
        const ms = ev.target.closest('ms[data-action]');
        if (!ms) {
            return;
        }
        if (ms.dataset.action === 'watch') {
            if (this.watchTarget != null) {
                await Common.rpc.watch(this.watchTarget);
            }
        }
    }

    onBubbleClick(ev) {
        if (ev.currentTarget.href || zoomedGroup != null) {
            return;
        }
        ev.preventDefault();
        const groupCenterIdx = curGroups.findIndex(x => x.watching);
        const group = curGroups[groupCenterIdx + this.relativePosition];
        if (!group) {
            return;
        }
        if (settings.zoomPriority === 'position') {
            zoomedGroup = {
                position: this.relativePosition,
            };
        } else {
            if (group.id != null) {
                zoomedGroup = {id: group.id};
            } else {
                zoomedGroup = {athleteId: group.athletes[0].athleteId};
            }
        }
        Common.storage.set('zoomedGroup', zoomedGroup);
        setMaxPositions();
        render();
    }

    schedRemoval() {
        if (this._cleanupTimeout) {
            return;
        }
        this._cleanupTimeout = setTimeout(() => this.remove(), 6000);
    }

    cancelRemoval() {
        if (this._cleanupTimeout) {
            clearTimeout(this._cleanupTimeout);
            this._cleanupTimeout = null;
        }
    }

    remove() {
        const regIdx = availPositionBubbles.indexOf(this);
        if (regIdx !== -1) {
            availPositionBubbles.splice(regIdx, 1);
        }
        this.nodes.el.remove();
        this.nodes = null;
    }
}


function getOrCreateGapSpacer(relPos) {
    let gap = availGapSpacers.find(x => x.relativePosition === relPos);
    if (!gap) {
        gap = GapSpacer.create(relPos);
    }
    return gap;
}


function render() {
    const zoomed = zoomedGroup != null;
    contentEl.classList.toggle('zoomed', zoomed);
    if (zoomed) {
        renderZoomed(curGroups);
    } else {
        renderGroups(curGroups);
    }
}


function isAttack(power, groupPower=Infinity) {
    return settings.detectAttacks &&
        (power > 650 || (power > 400 && power > groupPower * 2));
}


function fmtLine(html, classes='', title='') {
    return `<div class="line ${classes}" title="${title}">${html}</div>`;
}


function renderZoomed(groups) {
    if (!groups) {
        return;
    }
    const groupCenterIdx = groups.findIndex(x => x.watching);
    let group;
    let selectedBy;
    if (settings.zoomPriority === 'position') {
        if (zoomedGroup.position != null) {
            const idx = Math.max(0, Math.min(groupCenterIdx + zoomedGroup.position, groups.length - 1));
            group = groups[idx];
            selectedBy = 'position';
        }
    } else {
        if (zoomedGroup.id != null) {
            group = groups.find(x => x.id === zoomedGroup.id);
            if (group) {
                selectedBy = 'id';
            }
        }
        if (!group && zoomedGroup.athleteId != null) {
            group = groups.find(x => x.athletes.some(xx => xx.athleteId === zoomedGroup.athleteId));
            if (group) {
                selectedBy = 'athlete';
            }
        }
        if (!group && zoomedGroup.position != null) {
            const idx = Math.max(0, Math.min(groupCenterIdx + zoomedGroup.position, groups.length - 1));
            group = groups[idx];
            if (group) {
                selectedBy = 'position';
            }
        }
    }
    if (!group) {
        console.warn("Group not found: fallback to watching group");
        group = groups[groupCenterIdx];
        selectedBy = 'position';
    }
    const position = groups.indexOf(group) - groupCenterIdx;
    const groupSize = group.athletes.length;
    const athleteCenterIdx = position === 0 ?
        group.athletes.findIndex(x => x.watching) :
        zoomedGroup.athleteId != null ?
            group.athletes.findIndex(x => x.athleteId === zoomedGroup.athleteId) :
            0;
    const ahead = Math.max(0, athleteCenterIdx - Math.ceil(settings.maxZoomed / 2));
    const end = Math.min(group.athletes.length, ahead + settings.maxZoomed);
    const behind = group.athletes.length - end;
    const athletes = group.athletes.slice(ahead, end);
    const athletesLabel = groupSize === 1 ? 'Athlete' : 'Athletes';
    let groupLabel;
    if (selectedBy === 'position') {
        groupLabel = position ?
            `${H.place(Math.abs(position), {suffix: true})} Group ${position > 0 ? 'behind' : 'ahead'}` :
            'Your Group';
    } else if (selectedBy === 'athlete') {
        const a = group.athletes.find(x => x.athleteId === zoomedGroup.athleteId);
        const athlete = athleteCache.get(a.athleteId);
        if (athlete) {
            groupLabel = `Group of ${athlete.fLast}`;
        } else {
            groupLabel = `Group of <${a.athleteId}>`;
        }
    } else if (selectedBy === 'id') {
        groupLabel = `Group ID: ${zoomedGroup.id}`;
    } else {
        console.error("Internal group label error");
        groupLabel = `Unknown Group`;
    }
    const primaryFmt = {
        power: ({power}) => pwrFmt(power),
        wkg: ({power, weight}) => weight ? wkgFmt(power / weight) : pwrFmt(power),
    }[settings.zoomedPrimaryField || 'power'];
    Common.softInnerHTML(metaEl, [groupLabel,
        `${groupSize} ${athletesLabel}`,
        `${primaryFmt(group)}, ${spdFmt(group.speed)}`,
    ].map(x => `<div class="line">${x}</div>`).join(''));
    const activePositions = new Set();
    const activeGaps = new Set();
    aheadEl.classList.toggle('visible', !!ahead);
    if (ahead) {
        aheadEl.textContent = `+${ahead} ahead`;
    }
    behindEl.classList.toggle('visible', !!behind);
    if (behind) {
        behindEl.textContent = `+${behind} behind`;
    }
    for (const [i, ad] of athletes.entries()) {
        const ident = ad.watching ? 'watching' : `aid-${ad.athleteId}`;
        const pb = availPositionBubbles.find(x => x.ident === ident) || PositionBubble.create(ident);
        const gapSpacer = getOrCreateGapSpacer(i);
        pb.setRelativePosition(i);
        activePositions.add(pb);
        activeGaps.add(gapSpacer);
        pb.nodes.bubble.title = `Click for athlete details`;
        pb.nodes.bubble.href = `profile.html?id=${ad.athleteId}&windowType=profile`;
        pb.nodes.el.classList.toggle('watching', !!ad.watching);
        pb.nodes.el.style.setProperty('--size', quantizeSize(1, athletes.length));
        let label;
        let avatar = 'images/blankavatar.png';
        let fLast;
        let team;
        const athlete = athleteCache.get(ad.athleteId);
        if (athlete) {
            team = athlete.team;  // lol
            fLast = athlete.fLast;
            if (athlete.avatar) {
                avatar = athlete.avatar;
            } else {
                label = athlete.initials;
            }
        }
        const unusedLabels = pb.subgroupsInUse || new Set();
        if (eventSubgroup) {
            const sg = getSubgroupLazy(ad.eventSubgroupId);
            const sgLabel = sg && sg.subgroupLabel;
            if (sgLabel) {
                pb.nodes.bubbleHolder.style.setProperty(`--subgroup-${sgLabel}`, 1);
                unusedLabels.delete(sgLabel);
            }
            pb.subgroupsInUse = new Set(sgLabel ? [sgLabel] : []);
            pb.nodes.bubbleHolder.classList.toggle('subgroup-wheel', !!sgLabel);
        } else {
            if (pb.subgroupsInUse) {
                pb.subgroupsInUse.clear();
            } else {
                pb.subgroupsInUse = new Set();
            }
            pb.nodes.bubbleHolder.classList.remove('subgroup-wheel');
        }
        for (const x of unusedLabels) {
            pb.nodes.bubbleHolder.style.removeProperty(`--subgroup-${x}`);
        }
        Common.softInnerHTML(pb.nodes.bubble, label || `<img src="${avatar}"/>`);
        const leftLines = [];
        const attacking = isAttack(ad.state.power, group.power);
        pb.nodes.el.classList.toggle('attn', attacking);
        if (attacking) {
            leftLines.push(fmtLine('Attack!', 'major attn'));
        } else {
            if (fLast) {
                leftLines.push(fmtLine(fLast, 'minor', fLast));
                if (team) {
                    leftLines.push(Common.teamBadge(team));
                }
            }
        }
        const priLine = primaryFmt({
            power: ad.state.power,
            weight: athlete?.weight
        });
        const rightLines = [fmtLine(priLine)];
        const minorField = settings.zoomedSecondaryField || 'heartrate';
        if (minorField === 'heartrate') {
            if (ad.state.heartrate) {
                rightLines.push(fmtLine(
                    H.number(ad.state.heartrate, {suffix: 'bpm', html: true}),
                    'minor'));
            }
        } else if (minorField === 'draft') {
            if (ad.state.draft != null) {
                rightLines.push(fmtLine(
                    H.number(ad.state.draft, {suffix: 'w <ms large>air</ms>', html: true}),
                    'minor', 'Draft'));
            }
        } else if (minorField === 'speed') {
            if (ad.state.speed != null) {
                rightLines.push(fmtLine(
                    H.pace(ad.state.speed, {precision: 0, suffix: true, html: true}),
                    'minor'));
            }
        } else if (minorField === 'power-60s') {
            const p = ad.stats.power.smooth.find(x => x.period === 60).avg;
            if (p != null) {
                rightLines.push(fmtLine(pwrFmt(p), 'minor', '60s smoothed power'));
            }
        }
        pb.setLeftLines(leftLines.join(''));
        pb.setRightLines(rightLines.join(''));
        if (i < athletes.length - 1) {
            const nextAthlete = athletes[i + 1];
            const gap = Math.abs(nextAthlete.gap - ad.gap);
            let gapLine = '';
            if (gap) {
                let dur;
                if (settings.zoomedGapField === 'time') {
                    dur = gap > 0.5 && (H.number(gap) + 's');
                } else {
                    const gapDistance = Math.abs(nextAthlete.gapDistance - ad.gapDistance);
                    const units = Common.imperialUnits ? 'ft' : 'm';
                    dur = gapDistance && gapDistance > 2 &&
                        (H.number(gapDistance * (Common.imperialUnits ? 3.28084 : 1)) + units);
                }
                if (dur) {
                    gapLine = fmtLine(dur);
                }
            }
            gapSpacer.setSizes(gap, -gap);
            gapSpacer.setLines(gapLine);
            gapSpacer.toggleHidden(false);
        } else {
            gapSpacer.setLines('');
            gapSpacer.toggleHidden(true);
        }
        if (!ad.watching) {
            pb.setWatchTarget(ad.athleteId);
        }
    }
    for (const x of availPositionBubbles) {
        if (activePositions.has(x)) {
            x.cancelRemoval();
            x.toggleHidden(false);
        } else {
            x.toggleHidden(true);
            x.schedRemoval();
        }
    }
    for (const x of availGapSpacers) {
        if (!activeGaps.has(x)) {
            x.toggleHidden(true);
        }
    }
}


function getSubgroupDistro(group) {
    const sgLabels = new Map();
    let total = 0;
    for (const x of group.athletes) {
        const sg = getSubgroupLazy(x.eventSubgroupId);
        const label = sg && sg.subgroupLabel;
        if (label) {
            const c = sgLabels.get(label) || 0;
            sgLabels.set(label, c + 1);
            total++;
        }
    }
    return new Map(Array.from(sgLabels).map(([k, v]) => [k, v / total]));
}


const quantizeGap = Common.makeQuantizeBaseN(1.5); // about 25 entries for 2 hours


function quantizeSize(size, total) {
    const cardi = 8;
    const growFactor = Math.round(size / Math.max(10, total) * cardi) / cardi;
    return 1.5 + (growFactor * 3.5);
}


function renderGroups(groups=[]) {
    let centerIdx = groups.findIndex(x => x.watching);
    if (centerIdx === -1) {
        return;
    }
    const ahead = Math.max(0, centerIdx - (settings.maxAhead || 3));
    const end = Math.min(groups.length, centerIdx + (settings.maxBehind || 3) + 1);
    const behind = groups.length - end;
    groups = groups.slice(ahead, end);
    centerIdx = groups.findIndex(x => x.watching);
    let forceLayoutRequired = false;
    const assocGroups = new Array(groups.length);
    const unmatched = [];
    const activePositions = new Set();
    const activeGaps = new Set();
    for (const {0: i, 1: group} of groups.entries()) {
        const ident = group.watching ? 'watching' : group.id ?? `aid-${group.athletes[0].athleteId}`;
        const pb = availPositionBubbles.find(x => x.ident === ident);
        if (pb) {
            pb.athleteIds = new Set(group.athletes.map(x => x.athleteId));
            assocGroups[i] = {pb, group};
            activePositions.add(pb);
        } else {
            unmatched.push({i, ident});
        }
    }
    for (const {i, ident} of unmatched) {
        // See if it still makes sense to reuse an existing bubble for less visual turmoil
        // Optional but helps with bouncing on busy roads.
        const group = groups[i];
        const athleteIds = new Set(group.athletes.map(x => x.athleteId));
        let pb = availPositionBubbles.find(x =>
            x.athleteIds && !activePositions.has(x) &&
            x.athleteIds.intersection(athleteIds).size / athleteIds.size >= 0.5);
        if (pb) {
            pb.ident = ident;
        } else {
            forceLayoutRequired = true;  // force grow from zero width/height
            pb = PositionBubble.create(ident);
        }
        activePositions.add(pb);
        pb.athleteIds = athleteIds;
        assocGroups[i] = {pb, group};
    }
    for (const {0: i, 1: x} of assocGroups.entries()) {
        const relPos = i - centerIdx;
        x.pb.setRelativePosition(relPos);
        x.gapSpacer = getOrCreateGapSpacer(relPos);
        if (i < groups.length - 1 && x.gapSpacer.isHidden()) {
            x.gapSpacer.setSizes(0, 0);
            x.gapSpacer.toggleHidden(false);
            forceLayoutRequired = true;  // force flex-grow from zero transition
        }
        activeGaps.add(x.gapSpacer);
    }
    if (forceLayoutRequired) {
        containerEl.offsetHeight;
    }

    // DOM writes permissible...
    const totAthletes = groups.reduce((agg, x) => agg + x.athletes.length, 0);
    const athletesLabel = totAthletes === 1 ? 'Athlete' : 'Athletes';
    Common.softInnerHTML(metaEl, fmtLine(`${totAthletes} ${athletesLabel}`));
    if (ahead) {
        aheadEl.textContent = `+${ahead} ahead`;
    }
    if (behind) {
        behindEl.textContent = `+${behind} behind`;
    }
    aheadEl.classList.toggle('visible', !!ahead);
    behindEl.classList.toggle('visible', !!behind);
    const primaryFmt = {
        power: ({power}) => pwrFmt(power),
        wkg: ({power, weight}) => weight ? wkgFmt(power / weight) : pwrFmt(power),
    }[settings.groupsPrimaryField || 'power'];
    for (const {0: i, 1: {pb, group, gapSpacer}} of assocGroups.entries()) {
        pb.nodes.bubble.title = `Click to switch to zoomed in view`;
        if (pb.nodes.bubble.href) {
            pb.nodes.bubble.removeAttribute('href');
        }
        pb.nodes.el.classList.toggle('watching', !!group.watching);
        pb.nodes.el.style.setProperty('--size', quantizeSize(group.athletes.length, totAthletes));
        const unusedLabels = pb.subgroupsInUse || new Set();
        if (eventSubgroup) {
            const labels = getSubgroupDistro(group);
            for (const [label, pct] of labels.entries()) {
                pb.nodes.bubbleHolder.style.setProperty(`--subgroup-${label}`, pct.toFixed(6));
                unusedLabels.delete(label);
            }
            pb.subgroupsInUse = new Set(labels.keys());
            pb.nodes.bubbleHolder.classList.toggle('subgroup-wheel', labels.size > 0);
        } else {
            if (pb.subgroupsInUse) {
                pb.subgroupsInUse.clear();
            } else {
                pb.subgroupsInUse = new Set();
            }
            pb.nodes.bubbleHolder.classList.remove('subgroup-wheel');
        }
        for (const x of unusedLabels) {
            pb.nodes.bubbleHolder.style.removeProperty(`--subgroup-${x}`);
        }
        let label;
        let attacking = false;
        const leftLines = [];
        const rightLines = [];
        const singleAthlete = group.athletes.length === 1 && athleteCache.get(group.athletes[0].athleteId);
        if (singleAthlete) {
            label = singleAthlete.initials || '1';
            attacking = isAttack(group.power);
            if (attacking) {
                const weight = singleAthlete.weight;
                leftLines.push(fmtLine('Sprint!', 'attn'));
                leftLines.push(fmtLine(primaryFmt({power: group.power, weight}), 'minor attn'));
            }
        } else {
            label = H.number(group.athletes.length);
            let max = -Infinity;
            let weight;
            for (const x of group.athletes) {
                const p = x.state.power;
                if (p > max) {
                    max = p;
                    weight = athleteCache.get(x.athleteId)?.weight;
                }
            }
            attacking = isAttack(max, group.power);
            if (attacking) {
                leftLines.push(fmtLine('Attack!', 'attn'));
                leftLines.push(fmtLine(primaryFmt({power: max, weight}), 'minor attn'));
            }
        }
        pb.nodes.el.classList.toggle('attn', attacking);
        Common.softInnerHTML(pb.nodes.bubble, label);
        rightLines.push(fmtLine(primaryFmt(group), '', 'Group average'));
        const minorField = settings.groupsSecondaryField || 'speed';
        if (minorField === 'heartrate') {
            if (group.heartrate) {
                rightLines.push(fmtLine(H.number(group.heartrate, {suffix: 'bpm', html: true}), 'minor'));
            }
        } else if (minorField === 'draft') {
            if (group.draft != null) {
                rightLines.push(fmtLine(
                    H.number(group.draft, {suffix: 'w <ms large>air</ms>', html: true}),
                    'minor', 'Draft'));
            }
        } else if (minorField === 'speed') {
            if (group.speed != null) {
                rightLines.push(fmtLine(
                    H.pace(group.speed, {precision: 0, suffix: true, html: true}),
                    'minor'));
            }
        } else if (group.athletes.length > 1 || settings.groupsPrimaryField !== 'power') {
            if (minorField === 'power-highest') {
                const highest = Sauce.data.max(group.athletes.map(x => x.state.power));
                if (highest != null) {
                    rightLines.push(fmtLine(
                        pwrFmt(highest, {suffix: '!'}),
                        'minor', 'Highest individual power'));
                }
            } else if (minorField === 'power-median') {
                const med = Sauce.data.median(group.athletes.map(x => x.state.power));
                if (med != null) {
                    rightLines.push(fmtLine(pwrFmt(med, {suffix: 'M'}), 'minor', 'Median group power'));
                }
            }
        }
        pb.setLeftLines(leftLines.join(''));
        pb.setRightLines(rightLines.join(''));
        pb.nodes.actions.watch.classList.toggle('hidden', !!group.watching);
        pb.nodes.el.classList.toggle('pack-position', !!group.watching && group.athletes.length > 1);
        if (i < assocGroups.length - 1) {
            const nextGroup = groups[i + 1];
            const gap = pb.relativePosition < 0 ? group.gap : nextGroup.gap;
            const gapAbs = Math.abs(gap);
            const dur = group.innerGap && H.duration(gapAbs, {short: true, separator: ' '});
            const gapText = dur ? (gap > 0 ? '+' : '-') + dur : '';
            const gapLines = [];
            if (gapText) {
                gapLines.push(fmtLine(gapText));
                if (nextGroup.isGapEst) {
                    gapLines.push(fmtLine('(est)', 'minor', 'est'));
                }
            }
            gapSpacer.setSizes(quantizeGap(group.innerGap), quantizeGap(gap));
            gapSpacer.setLines(gapLines.join(''));
            gapSpacer.toggleHidden(false);
        } else {
            gapSpacer.setLines('');
            gapSpacer.toggleHidden(true);
        }
        if (group.watching) {
            if (group.athletes.length > 1) {
                const wIdx = group.athletes.findIndex(x => x.watching);
                pb.nodes.el.style.setProperty('--pack-position',
                                              (wIdx / (group.athletes.length - 1)).toFixed(2));
            }
        } else {
            pb.setWatchTarget(group.athletes[Math.trunc(group.athletes.length / 2)].athleteId);
        }
    }
    for (const x of availPositionBubbles) {
        if (activePositions.has(x)) {
            x.cancelRemoval();
            x.toggleHidden(false);
        } else {
            x.toggleHidden(true);
            x.schedRemoval();
        }
    }
    for (const x of availGapSpacers) {
        if (!activeGaps.has(x)) {
            x.toggleHidden(true);
        }
    }
}


function setStyles() {
    Common.setBackground(settings);
    if (settings.horizMode != null) {
        doc.classList.toggle('horizontal', settings.horizMode);
        if (settings.horizLTR != null) {
            doc.classList.toggle('horizontal-ltr', settings.horizLTR);
        }
    }
    if (settings.hideHeader != null) {
        doc.classList.toggle('hide-header', settings.hideHeader);
    }
    if (settings.labelAngle != null) {
        doc.style.setProperty('--label-angle', settings.labelAngle);
    }
    doc.classList.toggle('reduce-overhead', !!settings.reduceOverhead);
    setMaxPositions();
}


function computeGroupsEventQuery() {
    const resources = ['state'];
    if (settings.zoomedSecondaryField?.match(/^power-[0-9]/)) {
        resources.push('stats');
    }
    return {resources};
}


export async function main() {
    Common.initInteractionListeners();
    setStyles();
    contentEl = document.querySelector('#content');
    metaEl = document.querySelector('#meta');
    containerEl = document.querySelector('#container');
    aheadEl = document.querySelector('#ahead');
    behindEl = document.querySelector('#behind');
    contentEl.querySelector('.zoom-out').addEventListener('click', ev => {
        zoomedGroup = null;
        Common.storage.set('zoomedGroup', zoomedGroup);
        setMaxPositions();
        render();
    });
    const groupsQuery = computeGroupsEventQuery();
    Common.settingsStore.addEventListener('set', ev => {
        const newGroupsQuery = computeGroupsEventQuery();
        if (JSON.stringify(newGroupsQuery) !== JSON.stringify(groupsQuery)) {
            window.location.reload();
        }
        setStyles();
        render();
    });
    const gcs = await Common.rpc.getGameConnectionStatus();
    if (gcs) {
        Common.subscribe('status',
                         status => doc.classList.toggle('game-connection', status.connected),
                         {source: 'gameConnection', persistent: true});
        doc.classList.toggle('game-connection', gcs.connected);
    }
    let ts = 0;
    Common.subscribe('groups/v2', async groups => {
        if (!groups.length) {
            return;
        }
        curGroups = groups;
        if (!Common.isVisible()) {
            return;
        }
        await getAthletes(groups.map(x => x.athletes.map(xx => xx.athleteId)).flat());
        const now = Date.now();
        if (now - ts > (settings.refreshInterval * 1000 - 100)) {
            ts = now;
            eventSubgroup = groups.find(x => x.watching)
                ?.athletes.find(x => x.watching)
                ?.eventSubgroupId;
            render();
        }
    }, {options: groupsQuery});
}


export async function settingsMain() {
    Common.initInteractionListeners();
    await Common.initSettingsForm('form')();
}
