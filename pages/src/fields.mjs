import * as Locale from '../../shared/sauce/locale.mjs';
import * as Common from './common.mjs';
import * as Report from '../../shared/report.mjs';

const H = Locale.human;

/*
 * Field spec...
 *
 * id: 'immutable-permanent-ident' // Never change this.  It is used for state between software updates
 * group: 'grouping-ident'         // Fields sharing a group are shown together
 * longName: <string|function>     // Used when horizontal compliance is relaxed
 * shortName: <string|function>    // Used when horizontal compliance is strict
 * miniName: <string|function>     // Used when horizontal space is the smallest (i.e. table headers)
 * tooltip: <string|function>      // Tooltip for field
 * label: <string|function>        // Optional contextual label (used in some large data fields)
 * get: athleteData => <any>       // Override the argument for `format`
 * format: (x, {suffix}) => `...`  // The actual display value;  Handle {suffix: false} for highest compat.
 * suffix: <string|function>       // Just the units/suffix for this field, i.e. 'km/h' (only large fields)
 *
 * unit: [DEPRECATED]              // Legacy property for `suffix`
 * key: [DEPRECATED]               // Legacy property for `shortName`
 * value: [DEPRECATED]`            // Legacy property for `format`
 */


const tpAttr = Common.stripHTML(Common.attributions.tp);

export const fieldGroupNames = {
    time: 'Time',
    athlete: 'Athlete',
    power: 'Power',
    speed: 'Speed',
    draft: 'Draft',
    cadence: 'Cadence',
    hr: 'Heart Rate',
    course: 'Course',
    system: 'System',
};


function getSport(ad) {
    return ad?.state?.sport || 'cycling';
}


function isRealNumber(v) {
    return !(v == null || v === Infinity || v === -Infinity || isNaN(v));
}


function fmtPace(v, ad) {
    const sport = getSport(ad);
    return H.pace(v, {sport, precision: 1});
}


function fGet(fnOrValue, ...args) {
    try {
        return (typeof fnOrValue === 'function') ? fnOrValue(...args) : fnOrValue;
    } catch(e) {
        console.error('Field callback fn:', e);
    }
}


export class Renderer {
    constructor(contentEl, options={}) {
        this._contentEl = contentEl;
        this._callbacks = [];
        this._data;
        this._nextRender;
        this._lastRenderTime = 0;
        this.locked = !!options.locked;
        this.backgroundRender = options.backgroundRender;
        contentEl.classList.toggle('unlocked', !this.locked);
        this.stopping = false;
        this.fps = options.fps || null,
        this.id = options.id || window.location.pathname.split('/').at(-1);
        this.fields = new Map();
        this.onKeyDownBound = this.onKeyDown.bind(this);
        // Avoid circular refs so fields.mjs has immediate access..
        this._fieldsModPromise = import('./fields.mjs');
        if (!this.locked) {
            document.addEventListener('keydown', this.onKeyDownBound);
        }
    }

    setLocked(locked) {
        this.locked = locked;
        if (locked) {
            document.removeEventListener('keydown', this.onKeyDownBound);
        }
        this._contentEl.classList.toggle('unlocked', !this.locked);
    }

    stop() {
        this.stopping = true;
        if (!this.locked) {
            document.removeEventListener('keydown', this.onKeyDownBound);
        }
        clearTimeout(this._scheduledRender);
    }

    onKeyDown(ev) {
        const dir = {ArrowRight: 1, ArrowLeft: -1}[ev.key];
        const activeEl = document.activeElement;
        if (!dir || this.locked || !activeEl || !this._contentEl.contains(activeEl)) {
            return;
        }
        const dataField = activeEl.closest('[data-field]');
        const mappingId = dataField && dataField.dataset.field;
        if (mappingId) {
            this.rotateField(mappingId, dir);
        }
    }

    addCallback(cb) {
        this._callbacks.push(cb);
    }

    setData(data) {
        this._data = data;
    }

    getAdjacentFieldIndex(field, offt=1) {
        const cur = field.available.indexOf(field.active);
        if (cur === -1) {
            return 0;
        }
        const adjIdx = (cur + offt) % field.available.length;
        return adjIdx < 0 ? field.available.length + adjIdx : adjIdx;
    }

    rotateField(mappingId, dir=1) {
        if (this.locked) {
            return;
        }
        const field = this.fields.get(mappingId);
        const idx = this.getAdjacentFieldIndex(field, dir);
        const id = field.available[idx].id;
        this.setField(mappingId, id);
    }

    setField(mappingId, id) {
        const field = this.fields.get(mappingId);
        field.active = field.available.find(x => x.id === id);
        Common.storage.set(field.storageKey, id);
        console.debug('Switching field mapping', mappingId, id);
        this.setFieldTooltip(mappingId);
        this.render({force: true});
    }

    addRotatingFields(spec) {
        for (const x of spec.fields) {
            if (!x.shortName && x.key) {
                console.warn("Migrating deprecated field property key -> shortName", x.id);
                x.shortName = x.key;
            }
            if (!x.suffix && x.unit) {
                console.warn("Migrating deprecated field property unit -> suffix", x.id);
                x.suffix = x.unit;
            }
            if (!x.format && x.value) {
                console.warn("Migrating deprecated field property value -> format", x.id);
                x.format = x.value;
            }
            if (!x.version) {
                x.version = 1;
            }
        }
        for (const mapping of spec.mapping) {
            const el = (spec.el || this._contentEl).querySelector(`[data-field="${mapping.id}"]`);
            const storageKey = `${this.id}-${mapping.id}`;
            const savedId = Common.storage.get(storageKey);
            let active;
            for (const id of [savedId, mapping.default, 0]) {
                active = typeof id === 'number' ? spec.fields[id] : spec.fields.find(x => x.id === id);
                if (active) {
                    break;
                }
            }
            if (savedId !== active.id) {
                console.warn("Storing updated field ID:", savedId, '->', active.id);
                Common.storage.set(storageKey, active.id);
            }
            this.fields.set(mapping.id, {
                id: mapping.id,
                el,
                storageKey,
                available: spec.fields,
                active,
                valueEl: el.querySelector('.value'),
                labelEl: el.querySelector('.label'),
                subLabelEl: el.querySelector('.sub-label'),
                keyEl: el.querySelector('.key'),
                unitEl: el.querySelector('.unit'),
            });
            el.setAttribute('tabindex', 0);
            this.setFieldTooltip(mapping.id);
            if (this.locked) {
                continue;
            }
            let anchorEl = el.querySelector('.editing-anchor');
            if (!anchorEl) {
                anchorEl = el;
                el.classList.add('editing-anchor');
            }
            const handler = Common.longPressListener(el, 1500, async ev => {
                const {fieldGroupNames} = (await this._fieldsModPromise);
                handler.setPaused(true);
                const field = this.fields.get(mapping.id);
                const groups = new Set(field.available.map(x => x.group));
                const select = document.createElement('select');
                select.classList.add('rotating-field');
                for (const group of groups) {
                    // group can be undefined, this is fine.
                    let container;
                    if (group) {
                        container = document.createElement('optgroup');
                        container.label = fieldGroupNames[group] || group;
                    } else {
                        container = select;
                    }
                    for (const x of field.available) {
                        if (x.group === group) {
                            const option = document.createElement('option');
                            if (x.id === field.active.id) {
                                option.selected = true;
                            }
                            option.value = x.id;
                            let name;
                            try {
                                name = Common.stripHTML(fGet(x.longName)) ||
                                       Common.stripHTML(fGet(x.shortName));
                            } catch(e) {
                                name = null;
                                Report.errorThrottled(e);
                            }
                            if (!name) {
                                console.error(`Field returned invalid 'longName' and/or 'shortName':`, x);
                            }
                            option.textContent = name || x.id;
                            container.append(option);
                        }
                    }
                    if (container !== select) {
                        select.append(container);
                    }
                }
                const endEditing = () => {
                    if (!select.isConnected) {
                        return;
                    }
                    el.classList.remove('editing');
                    select.remove();
                    handler.setPaused(false);
                };
                select.addEventListener('change', () => {
                    this.setField(mapping.id, select.value);
                    endEditing();
                });
                // Avoid DOM errors caused by DOM manipulation in onblur with microtask..
                select.addEventListener('blur', () => queueMicrotask(endEditing));
                el.classList.add('editing');
                anchorEl.append(select);
                select.focus();
            });
            el.addEventListener('click', ev => {
                const field = this.fields.get(mapping.id).active;
                if (!field.click || el.classList.contains('editing')) {
                    return;
                }
                field.click(ev, field);
            });
        }
    }

    setFieldTooltip(mappingId) {
        this._setFieldTooltip(this.fields.get(mappingId));
    }

    _setFieldTooltip(field) {
        let tooltip;
        try {
            tooltip = fGet(field.active?.tooltip, field) ||
                fGet(field.active?.longName) ||
                fGet(field.active?.shortName);
        } catch(e) {
            console.error("Failed to get tooltip for:", field.id, e);
        }
        tooltip ??= '';
        if (!this.locked) {
            tooltip += (tooltip ? '\n\n' : '') +
                'Long click/press to change this field or use the Left/Right keys when focused.';
        }
        if (field.el._tooltip !== tooltip) {
            field.el.title = Common.sanitizeAttr(tooltip);
            field.el._tooltip = tooltip;
        }
    }

    schedAnimationFrame(cb) {
        if (!this.backgroundRender) {
            return requestAnimationFrame(cb);
        } else {
            return queueMicrotask(cb);
        }
    }

    render(options={}) {
        if (!options.force && this.fps) {
            const age = Date.now() - (this._lastRender || -Infinity);
            const minAge = 1000 / this.fps;
            if (age < minAge - this._lastRenderTime) {
                if (!this._scheduledRender) {
                    this._scheduledRender = setTimeout(() => {
                        this._scheduledRender = null;
                        this.render();
                    }, Math.ceil(minAge - age));
                }
                return;
            }
        }
        if (!this._nextRender) {
            if (this._scheduledRender) {
                clearTimeout(this._scheduledRender);
                this._scheduledRender = null;
            }
            const start = Date.now();
            this._nextRender = new Promise(resolve => {
                this.schedAnimationFrame(() => {
                    if (this.stopping) {
                        resolve();
                        return;
                    }
                    for (const field of this.fields.values()) {
                        let value = '';
                        const options = {};
                        if (field.unitEl) {
                            options.suffix = false;
                        }
                        let data = this._data;
                        try {
                            const d = field.active.get ? field.active.get(this._data) : this._data;
                            if (field.active.version >= 2) {
                                data = d;
                            }
                            value = fGet(field.active.format, d, options);
                        } catch(e) {
                            Report.errorThrottled(e);
                        }
                        const candidate = value != null && !Number.isNaN(value) ? value : '';
                        if (Common.softInnerHTML(field.valueEl, candidate)) {
                            const width = field.valueEl.textContent.length;
                            if (field.valueEl._width !== width) {
                                field.valueEl._width = width;
                                field.valueEl.classList.toggle('x-wide', width > 2);
                                field.valueEl.classList.toggle('x2-wide', width > 3);
                                field.valueEl.classList.toggle('x3-wide', width > 4);
                                field.valueEl.classList.toggle('x4-wide', width > 6);
                                field.valueEl.classList.toggle('x5-wide', width > 9);
                            }
                        }
                        if (field.labelEl) {
                            let labels = '';
                            try {
                                labels = field.active.label ? fGet(field.active.label, data) : '';
                            } catch(e) {
                                Report.errorThrottled(e);
                            }
                            if (Array.isArray(labels)) {
                                Common.softInnerHTML(field.labelEl, labels[0]);
                                if (field.subLabelEl) {
                                    Common.softInnerHTML(field.subLabelEl,
                                                         labels.length > 1 ? labels[1] : '');
                                }
                            } else {
                                Common.softInnerHTML(field.labelEl, labels);
                                if (field.subLabelEl) {
                                    Common.softInnerHTML(field.subLabelEl, '');
                                }
                            }
                        }
                        if (field.keyEl) {
                            let key = '';
                            try {
                                key = field.active.shortName ? fGet(field.active.shortName, data) : '';
                            } catch(e) {
                                Report.errorThrottled(e);
                            }
                            Common.softInnerHTML(field.keyEl, key);
                        }
                        if (field.unitEl) {
                            let unit = '';
                            // Hide unit if there is no value but only if there is no key element too.
                            const showUnit = field.active.suffix &&
                                ((value != null && value !== '-') || !field.keyEl);
                            try {
                                unit = showUnit ? fGet(field.active.suffix, data) : '';
                            } catch(e) {
                                Report.errorThrottled(e);
                            }
                            Common.softInnerHTML(field.unitEl, unit);
                        }
                        if (typeof field.active.tooltip === 'function') {
                            this._setFieldTooltip(field);
                        }
                    }
                    for (const cb of this._callbacks) {
                        try {
                            cb(this._data);
                        } catch(e) {
                            Report.errorThrottled(e);
                        }
                    }
                    resolve();
                });
            }).finally(() => {
                this._lastRender = Date.now();
                this._lastRenderTime = this._lastRender - start;
                this._nextRender = null;
            });
        }
        return this._nextRender;
    }
}



const _smoothedIndexes = new Map();
export function getSmoothCompat(o, field, period) {
    const container = o?.stats?.[field]?.smooth;
    if (!container) {
        return;
    }
    if (Array.isArray(container)) {
        let idx = _smoothedIndexes.get(field + period);
        if (idx === undefined) {
            idx = container.findIndex(x => x.period === period);
            if (idx == null || idx === -1) {
                return;
            }
            _smoothedIndexes.set(field + period, idx);
        }
        return container[idx];
    } else {
        return container != null ? {period, avg: container[period]} : undefined;
    }
}


const _peakIndexes = new Map();
export function getPeakCompat(o, field, period) {
    const container = o?.stats?.[field]?.peaks;
    if (!container) {
        return;
    }
    if (Array.isArray(container)) {
        let idx = _peakIndexes.get(field + period);
        if (idx === undefined) {
            idx = container.findIndex(x => x.period === period);
            if (idx == null || idx === -1) {
                return;
            }
            _peakIndexes.set(field + period, idx);
        }
        return container[idx];
    } else {
        return container[period];
    }
}


export function speedUnit(ad) {
    const sport = getSport(ad);
    return H.pace(ad?.state?.speed, {sport, suffixOnly: true});
}


export function speedLabel(ad) {
    const sport = getSport(ad);
    return sport === 'running' ? 'Pace' : 'Speed';
}


export function shortDuration(x) {
    return H.duration(x, {short: true});
}


export function fmtDur(v) {
    return H.timer(v, {long: true});
}


export function fmtWkg(p, athlete) {
    if (!isRealNumber(p) || !athlete || !athlete.ftp) {
        return '-';
    }
    return H.number(p / athlete.weight, {precision: 1, fixed: true});
}


export function fmtPct(p, options={}) {
    return H.number(p * 100, {suffix: '%', html: true, ...options});
}


export function fmtLap(v) {
    if (!isRealNumber(v)) {
        return '-';
    }
    return H.number(v);
}


export function fmtPackTime(stats) {
    if (stats) {
        return fmtStackedSparkline([{
            color: '#65a354',
            label: 'Following',
            value: stats.followTime || 0,
            format: courseDurationFormat
        }, {
            color: '#d1c209',
            label: 'Solo',
            value: stats.soloTime || 0,
            format: courseDurationFormat
        }, {
            color: '#ca3805',
            label: 'Working',
            value: stats.workTime || 0,
            format: courseDurationFormat
        }]);
    } else {
        return fmtStackedSparkline([{color: '#777', label: 'Inactive', value: 1}]);
    }
}


export function fmtStackedSparkline(data) {
    const tooltips = [];
    let total = 0;
    for (let i = 0; i < data.length; i++) {
        const value = data[i].value;
        if (value != null && !isNaN(value)) {
            total += value;
            if (data[i].format) {
                tooltips.push(`${data[i].label}: ${data[i].format(value)}`);
            }
        }
    }
    return [
        `<div class="field-sparkline"
              style="display: flex;
                     height: 0.7em;
                     border-radius: 0.18rem;
                     overflow: hidden;
                     width: 4em;
                     margin: 0.2rem;"
              title="${tooltips.join('\n')}">`,
        data.map(x => {
            const size = total ? Math.round((x.value / total) * 100) : 1;
            return `<div class="sparkline-bar" style="flex: ${size} 0 0;
                                background-color: ${x.color};"></div>`;
        }).join(''),
        `</div>`
    ].join('');
}


export function makePeakPowerFields(period, lap, extra) {
    const duration = shortDuration(period);
    const longDuration = H.duration(period);
    const lapLabel = {
        '-1': '(lap)',
        '-2': '(last lap)',
    }[lap];

    function getPeak(ad) {
        const o = lap === -1 ? {stats: ad?.lap} : lap === -2 ? {stats: ad?.lastLap} : ad;
        return getPeakCompat(o, 'power', period);
    }

    function label(ad) {
        const l = [`peak ${duration}`, lapLabel].filter(x => x);
        if (!ad?.stats) {
            return l;
        }
        const peak = getPeak(ad);
        if (!(peak && peak.ts)) {
            return l;
        }
        const ago = (Date.now() - peak.ts) / 1000;
        const agoText = `${shortDuration(ago)} ago`;
        if (l.length === 1) {
            l.push(agoText);
        } else {
            l[1] += ' | ' + agoText;
        }
        return l;
    }

    const idExtra = lap ? `-lap${lap}` : '';
    const shortName = lap ?
        `Peak ${duration} ${lap === -1 ? '<ms small>timer</ms>' : lapLabel}` :
        `Peak ${duration}`;
    return [{
        id: `pwr-peak-${period}${idExtra}`,
        group: 'power',
        shortName,
        longName: `Peak Power - ${longDuration}` + (lap ? ` ${lapLabel}` : ''),
        format: x => H.number(getPeak(x)?.avg),
        label,
        suffix: 'w',
        ...extra,
    }, {
        id: `pwr-peak-${period}${idExtra}-wkg`,
        group: 'power',
        shortName,
        longName: `Peak W/kg - ${longDuration}` + (lap ? ` ${lapLabel}` : ''),
        format: x => fmtWkg(getPeak(x)?.avg, x.athlete),
        label,
        suffix: 'w/kg',
        ...extra,
    }];
}


export function makeSmoothPowerFields(period, extra) {
    const duration = shortDuration(period);
    const longDuration = H.duration(period);
    const label = duration;
    return [{
        id: `pwr-smooth-${period}`,
        group: 'power',
        longName: `Smoothed Power - ${longDuration}`,
        format: x => H.number(getSmoothCompat(x, 'power', period)?.avg),
        label,
        shortName: `Power<small> (${duration})</small>`,
        suffix: 'w',
        ...extra,
    }, {
        id: `pwr-smooth-${period}-wkg`,
        group: 'power',
        longName: `Smoothed W/kg - ${longDuration}`,
        format: x => fmtWkg(getSmoothCompat(x, 'power', period)?.avg, x.athlete),
        label,
        shortName: `W/kg<small> (${duration})</small>`,
        suffix: 'w/kg',
        ...extra,
    }];
}


function courseDurationFormat(t, options) {
    const roundTo = t < 60 ? 5 : 60;
    return H.duration(Math.round(t / roundTo) * roundTo, options);
}


export class PowerUpField {

    static subTypeLabels = {
        undefined: '',
        large: ' (Large)',
        xl: ' (XL)',
    };

    static titles = {
        LIGHTNESS: 'Feather',
        DRAFTBOOST: 'Draft',
        UNDRAFTABLE: 'Undraftable',
        AERO: 'Aero',
        NINJA: 'Ghost',
        STEAMROLLER: 'Steamroller',
        ANVIL: 'Anvil',
        COFFEE_STOP: 'Coffee Stop',
        BOOST: 'Boost',
        BONUS_XP: 'XP++',
        BONUS_XP_LIGHT: 'XP',
        NONE: 'None',
    };

    constructor({subType}={}) {
        this.id = subType ? `powerup-${subType}` : 'powerup';
        this.subType = subType;
        this.timer = null;
        this.format = this.format.bind(this);
        this.longName = this.longName.bind(this);
        this.tooltip = this.tooltip.bind(this);
        Common.rpc.getGameConnectionStatus()
            .then(status => this.unavailable = status.state === 'disabled');
    }

    format(ad) {
        const gs = ad?.gameState;
        if (gs?.gameConnection != null) {
            this.unavailable = !gs.gameConnection;
        }
        if (this.unavailable) {
            return '<ms small>mobiledata_off</ms>';
        }
        if (gs) {
            let type, state, timer;
            if (gs.activePowerUp) {
                state = 'active';
                type = gs.activePowerUp;
                timer = this.timer ?? `${Math.round(gs.activePowerUpEnd - Date.now())}ms`;
            } else if (gs.availablePowerUp) {
                state = 'available';
                type = gs.availablePowerUp;
            } else {
                state = 'inactive';
                type = 'NONE';
            }
            this.timer = timer;
            this.presentingType = type;
            const style = timer ? `style="--active-timer: ${timer};"` : '';
            const stCls = this.subType ? `subtype-${this.subType}` : '';
            return `<div class="field-powerup ${state} ${stCls}" ${style}>
                <img src="/pages/images/powerups/${type}.svg"/></div>`;
        } else {
            this.timer = null;
            return '-';
        }
    }

    shortName(ad) {
        return !ad?.gameState ? 'PowerUp' : '';
    }

    longName() {
        return `PowerUp${this.constructor.subTypeLabels[this.subType]}`;
    }

    tooltip(field) {
        if (this.unavailable) {
            return 'Game Connection required for PowerUp field\n\n' +
                'See: Settings -> General -> Game Connection';
        } else if (this.presentingType) {
            return `PowerUp - ${this.constructor.titles[this.presentingType]}`;
        }
    }

    click() {
        if (this.unavailable) {
            return;
        }
        Common.rpc.powerup();
    }
}


export const timeFields = [{
    id: 'time-active',
    longName: 'Active Time',
    shortName: 'Active',
    format: x => fmtDur(x?.stats?.activeTime || 0),
    tooltip: 'Sauce based active time',
}, {
    id: 'time-elapsed',
    longName: 'Elapsed Time',
    shortName: 'Elapsed',
    miniName: 'Elpsd',
    format: x => fmtDur(x?.stats?.elapsedTime || 0),
    tooltip: 'Sauce based elapsed time',
}, {
    id: 'time-session',
    longName: 'Session Time',
    shortName: 'Time',
    format: x => fmtDur(x?.state?.time || 0),
    tooltip: 'Time as reported by the current Zwift session',
}, {
    id: 'time-gap',
    longName: 'Gap Time',
    shortName: 'Gap',
    format: x => fmtDur(x.gap),
    label: 'gap',
}, {
    id: 'time-gap-distance',
    longName: 'Gap Distance',
    shortName: 'Gap',
    format: x => H.distance(x.gapDistance),
    label: 'gap',
    suffix: x => H.distance(0, {suffixOnly: true})
}, {
    id: 'clock',
    longName: 'Clock',
    format: x => new Date().toLocaleTimeString(),
    shortName: '',
}, {
    id: 'time-coffee',
    longName: 'Coffee Time',
    get: x => x?.stats?.coffeeTime || 0,
    format: fmtDur,
    shortName: 'Coffee',
    miniName: '<ms>coffee</ms>',
    label: 'coffee',
    tooltip: 'Time observed taking a Coffee break',
}, {
    id: 'time-solo',
    longName: 'Solo Time',
    get: x => x?.stats?.soloTime || 0,
    format: fmtDur,
    shortName: 'Solo',
    miniName: '<ms>self_improvement</ms>',
    label: 'solo',
    tooltip: 'Time observed riding alone',
}, {
    id: 'time-follow',
    longName: 'Following Time',
    get: x => x?.stats?.followTime || 0,
    format: fmtDur,
    shortName: 'Following',
    label: 'following',
    miniName: '<ms>group_remove</ms>',
    tooltip: 'Time observed sitting-in/following in a group',
}, {
    id: 'time-work',
    longName: 'Working Time',
    get: x => x?.stats?.workTime || 0,
    format: fmtDur,
    shortName: 'Working',
    miniName: '<ms>group_add</ms>',
    label: 'working',
    tooltip: 'Time observed working/pulling in a group',
}, {
    id: 'time-pack-graph',
    longName: 'Pack Time Graph',
    shortName: 'Pack',
    label: 'pack time',
    format: x => fmtPackTime(x?.stats),
    tooltip: 'Pack Time Graph\n\nHow much time has been spent sitting-in vs solo vs working',
}, {
    id: 'time-lap',
    format: x => fmtDur(x?.lap?.activeTime || 0),
    longName: 'Time (lap)',
    shortName: 'Lap',
    label: 'lap',
}, {
    id: 'time-coffee-lap',
    longName: 'Coffee Time (lap)',
    get: x => x?.lap?.coffeeTime || 0,
    format: fmtDur,
    shortName: 'Coffee <ms small>timer</ms>',
    miniName: '<ms>coffee</ms> <ms>timer</ms>',
    label: ['coffee', '(lap)'],
    tooltip: 'Time observed taking a Coffee break (lap)',
}, {
    id: 'time-solo-lap',
    longName: 'Solo Time (lap)',
    get: x => x?.lap?.soloTime || 0,
    format: fmtDur,
    shortName: 'Solo <ms small>timer</ms>',
    miniName: '<ms>self_improvement</ms> <ms small>timer</ms>',
    label: ['solo', '(lap)'],
    tooltip: 'Time observed riding alone (lap)',
}, {
    id: 'time-follow-lap',
    longName: 'Following Time (lap)',
    get: x => x?.lap?.followTime || 0,
    format: fmtDur,
    shortName: 'Following <ms small>timer</ms>',
    miniName: '<ms>group_remove</ms> <ms small>timer</ms>',
    label: ['following', '(lap)'],
    tooltip: 'Time observed sitting-in/following in a group (lap)',
}, {
    id: 'time-work-lap',
    longName: 'Working Time (lap)',
    get: x => x?.lap?.workTime || 0,
    format: fmtDur,
    shortName: 'Working <ms small>timer</ms>',
    miniName: '<ms>group_add</ms> <ms small>timer</ms>',
    label: ['working', '(lap)'],
    tooltip: 'Time observed working/pulling in a group (lap)',
}, {
    id: 'time-pack-graph-lap',
    longName: 'Pack Time Graph (lap)',
    shortName: 'Pack <ms small>timer</ms>',
    format: x => fmtPackTime(x?.lap),
    label: ['pack time', '(lap)'],
    tooltip: 'Pack Time Graph\n\nHow much time has been spent sitting-in vs solo vs working (lap)',
}];
timeFields.forEach(x => x.group = 'time');


export const athleteFields = [
    {
        id: 'fullname',
        format: x => x.athlete && x.athlete.sanitizedFullname || '-',
        shortName: x => (x && x.athlete) ? '' : 'Athlete Name',
    }, {
        id: 'flastname',
        format: x => x.athlete && x.athlete.fLast || '-',
        shortName: x => (x && x.athlete) ? '' : 'Athlete F.Last',
    }, {
        id: 'team',
        format: x => x.athlete && Common.teamBadge(x.athlete.team) || '-',
        shortName: x => (x && x.athlete && x.athlete.team) ? '' : 'Team',
    }, {
        id: 'level',
        format: x => H.number(x.athlete && x.athlete.level),
        shortName: 'Level',
    }, {
        id: 'rideons',
        format: x => H.number(x?.state?.rideons),
        shortName: 'Ride Ons',
    }, {
        id: 'weight',
        format: x => H.weightClass(x.athlete && x.athlete.weight, {html: true}),
        shortName: 'Weight',
        suffix: () => Locale.isImperial() ? 'lbs' : 'kg',
    }, {
        id: 'ftp',
        format: x => H.number(x.athlete && x.athlete.ftp),
        shortName: 'FTP',
        suffix: 'w'
    },
    new PowerUpField(),
    //new PowerUpField({subType: 'large'}),
    //new PowerUpField({subType: 'xl'}),
];
athleteFields.forEach(x => x.group = 'athlete');


export const speedFields = [{
    id: 'spd-cur',
    format: x => fmtPace(x?.state?.speed, x),
    shortName: speedLabel,
    suffix: speedUnit,
}, {
    id: 'spd-smooth-60',
    longName: `Smoothed ${speedLabel()} (${shortDuration(60)})`,
    format: x => fmtPace(getSmoothCompat(x, 'speed', 60)?.avg, x),
    shortName: x => `${speedLabel(x)}<small> (${shortDuration(60)})</small>`,
    suffix: speedUnit,
}, {
    id: 'spd-avg',
    format: x => fmtPace(x?.stats?.speed.avg, x),
    shortName: x => `${speedLabel(x)}<small> (avg)</small>`,
    suffix: speedUnit,
}, {
    id: 'spd-lap',
    format: x => fmtPace(x?.lap?.speed.avg, x),
    longName: x => `${speedLabel(x)} (lap)`,
    shortName: x => `${speedLabel(x)} <ms small>timer</ms>`,
    suffix: speedUnit,
}];
speedFields.forEach(x => x.group = 'speed');


export const hrFields = [{
    id: 'hr-cur',
    format: x => H.number(x?.state?.heartrate),
    shortName: 'HR',
    suffix: 'bpm',
}, {
    id: 'hr-avg',
    format: x => H.number(x?.stats?.hr.avg),
    shortName: 'HR<small> (avg)</small>',
    suffix: 'bpm',
}, {
    id: 'hr-lap',
    format: x => H.number(x?.lap?.hr.avg),
    longName: 'HR (lap)',
    shortName: 'HR <ms small>timer</ms>',
    suffix: 'bpm',
}, {
    id: 'hr-smooth-60',
    longName: `Smoothed HR (${shortDuration(60)})`,
    format: x => H.number(getSmoothCompat(x, 'hr', 60)?.avg),
    shortName: `HR<small> (${shortDuration(60)})</small>`,
    suffix: 'bpm',
}, {
    id: 'hr-smooth-300',
    longName: `Smoothed HR (${shortDuration(300)})`,
    format: x => H.number(getSmoothCompat(x, 'hr', 300)?.avg),
    shortName: `HR<small> (${shortDuration(300)})</small>`,
    suffix: 'bpm',
}, {
    id: 'hr-smooth-1200',
    longName: `Smoothed HR (${shortDuration(1200)})`,
    format: x => H.number(getSmoothCompat(x, 'hr', 1200)?.avg),
    shortName: `HR<small> (${shortDuration(1200)})</small>`,
    suffix: 'bpm',
}, {
    id: 'hr-ef-300',
    tooltip: 'Effeciency Factor is Normalized-Power® / Heart-Rate',
    format: x => H.number(getSmoothCompat(x, 'np', 300)?.avg /
                          getSmoothCompat(x, 'hr', 300)?.avg, {precision: 2}),
    shortName: `hrEF<small> (${shortDuration(300)})</small>`,
}, {
    id: 'hr-ef-1200',
    tooltip: 'Effeciency Factor is Normalized-Power® / Heart-Rate',
    format: x => H.number(getSmoothCompat(x, 'np', 1200)?.avg /
                          getSmoothCompat(x, 'hr', 1200)?.avg, {precision: 2}),
    shortName: `hrEF<small> (${shortDuration(1200)})</small>`,
}];
hrFields.forEach(x => x.group = 'hr');


export const powerFields = [{
    id: 'pwr-cur',
    format: x => H.number(x?.state?.power),
    shortName: `Power`,
    longName: `Current Power`,
    suffix: 'w',
}, {
    id: 'pwr-cur-wkg',
    format: x => fmtWkg(x?.state?.power, x.athlete),
    shortName: `W/kg`,
    longName: `Current W/kg`,
}, {
    id: 'pwr-avg',
    format: x => H.number(x?.stats?.power.avg),
    shortName: 'Power<small> (avg)</small>',
    longName: 'Average Power',
    suffix: 'w',
}, {
    id: 'pwr-avg-wkg',
    format: x => fmtWkg(x?.stats?.power.avg, x.athlete),
    shortName: 'W/kg<small> (avg)</small>',
    longName: 'Average W/kg',
},
...makeSmoothPowerFields(5),
...makeSmoothPowerFields(15),
...makeSmoothPowerFields(60),
...makeSmoothPowerFields(300),
...makeSmoothPowerFields(1200),
{
    id: 'energy',
    format: x => H.number(x?.state?.kj),
    shortName: 'Energy',
    suffix: 'kJ',
}, {
    id: 'energy-solo',
    longName: 'Solo Energy',
    get: x => x?.stats?.soloKj || 0,
    format: H.number,
    suffix: 'kJ',
    shortName: 'Solo',
    miniName: '<ms>self_improvement</ms>',
    label: 'solo',
    tooltip: 'Energy total while riding alone',
}, {
    id: 'energy-follow',
    longName: 'Following Energy',
    get: x => x?.stats?.followKj || 0,
    format: H.number,
    suffix: 'kJ',
    shortName: 'Following',
    miniName: '<ms>group_remove</ms>',
    label: 'following',
    tooltip: 'Energy total while sitting-in/following in a group',
}, {
    id: 'energy-work',
    longName: 'Working Energy',
    get: x => x?.stats?.workKj || 0,
    format: H.number,
    suffix: 'kJ',
    shortName: 'Working',
    miniName: '<ms>group_add</ms>',
    label: 'working',
    tooltip: 'Energy total while working/pulling in a group',
}, {
    id: 'power-avg-solo',
    longName: 'Solo Average Power',
    get: x => (x?.stats?.soloKj / x?.stats?.soloTime * 1000) || 0,
    format: H.power,
    suffix: 'w',
    shortName: 'Solo',
    miniName: '<ms>self_improvement</ms>',
    label: 'solo',
    tooltip: 'Average power while riding alone',
}, {
    id: 'power-avg-follow',
    longName: 'Following Average Power',
    get: x => (x?.stats?.followKj / x?.stats?.followTime * 1000) || 0,
    format: H.power,
    suffix: 'w',
    shortName: 'Following',
    miniName: '<ms>group_remove</ms>',
    label: 'following',
    tooltip: 'Average power while sitting-in/following in a group',
}, {
    id: 'power-avg-work',
    longName: 'Working Average Power',
    get: x => (x?.stats?.workKj / x?.stats?.workTime * 1000) || 0,
    format: H.power,
    suffix: 'w',
    shortName: 'Working',
    miniName: '<ms>group_add</ms>',
    label: 'working',
    tooltip: 'Average power while working/pulling in a group',
}, {
    id: 'wbal',
    format: x => (x.wBal != null && x.athlete && x.athlete.wPrime) ?
        Common.fmtBattery(x.wBal / x.athlete.wPrime) +
            H.number(x.wBal / 1000, {precision: 1}) : '-',
    shortName: 'W\'bal',
    suffix: 'kJ',
}, {
    id: 'tss',
    format: x => H.number(x?.stats?.power.tss),
    shortName: 'TSS<abbr>®</abbr>',
    tooltip: tpAttr,
}, {
    id: 'pwr-np',
    format: x => H.number(x?.stats?.power.np),
    shortName: 'NP<abbr>®</abbr>',
    tooltip: tpAttr,
}, {
    id: 'pwr-if',
    format: x => fmtPct((x?.stats?.power.np || 0) / (x.athlete && x.athlete.ftp)),
    shortName: 'IF<abbr>®</abbr>',
    tooltip: tpAttr,
}, {
    id: 'pwr-vi',
    format: x => H.number(x?.stats?.power.np / x?.stats?.power.avg, {precision: 2, fixed: true}),
    shortName: 'VI',
}, {
    id: 'pwr-max',
    format: x => H.number(x?.stats?.power.max),
    shortName: 'Power<small> (max)</small>',
    suffix: 'w',
},
...makePeakPowerFields(5),
...makePeakPowerFields(15),
...makePeakPowerFields(60),
...makePeakPowerFields(300),
...makePeakPowerFields(1200),
{
    id: 'pwr-lap',
    format: x => H.number(x?.lap?.power.avg),
    shortName: 'Power <ms small>timer</ms>',
    longName: 'Average Power (lap)',
    suffix: 'w',
}, {
    id: 'pwr-lap-wkg',
    format: x => fmtWkg(x?.lap?.power.avg, x.athlete),
    shortName: 'W/kg <ms small>timer</ms>',
    longName: 'Average W/kg (lap)',
}, {
    id: 'energy-solo-lap',
    longName: 'Solo Energy (lap)',
    get: x => x?.lap?.soloKj || 0,
    format: H.number,
    suffix: 'kJ',
    shortName: 'Solo <ms small>timer</ms>',
    miniName: '<ms>self_improvement</ms> <ms small>timer</ms>',
    label: ['solo', '(lap)'],
    tooltip: 'Energy total while riding alone (lap)',
}, {
    id: 'energy-follow-lap',
    longName: 'Following Energy (lap)',
    get: x => x?.lap?.followKj || 0,
    format: H.number,
    suffix: 'kJ',
    shortName: 'Following <ms small>timer</ms>',
    miniName: '<ms>group_remove</ms> <ms small>timer</ms>',
    label: ['following', '(lap)'],
    tooltip: 'Energy total while sitting-in/following in a group (lap)',
}, {
    id: 'energy-work-lap',
    longName: 'Working Energy (lap)',
    get: x => x?.lap?.workKj || 0,
    format: H.number,
    suffix: 'kJ',
    shortName: 'Working <ms small>timer</ms>',
    miniName: '<ms>group_add</ms> <ms small>timer</ms>',
    label: ['working', '(lap)'],
    tooltip: 'Energy total while working/pulling in a group (lap)',
}, {
    id: 'power-avg-solo-lap',
    longName: 'Solo Average Power (lap)',
    get: x => (x?.lap?.soloKj / x?.lap?.soloTime * 1000) || 0,
    format: H.power,
    suffix: 'w',
    shortName: 'Solo <ms small>timer</ms>',
    miniName: '<ms>self_improvement</ms> <ms small>timer</ms>',
    label: ['solo', '(lap)'],
    tooltip: 'Average power while riding alone (lap)',
}, {
    id: 'power-avg-follow-lap',
    longName: 'Following Average Power (lap)',
    get: x => (x?.lap?.followKj / x?.lap?.followTime * 1000) || 0,
    format: H.power,
    suffix: 'w',
    shortName: 'Following <ms small>timer</ms>',
    miniName: '<ms>group_remove</ms> <ms small>timer</ms>',
    label: ['following', '(lap)'],
    tooltip: 'Average power while sitting-in/following in a group (lap)',
}, {
    id: 'power-avg-work-lap',
    longName: 'Working Average Power (lap)',
    get: x => (x?.lap?.workKj / x?.lap?.workTime * 1000) || 0,
    format: H.power,
    suffix: 'w',
    shortName: 'Working <ms small>timer</ms>',
    miniName: '<ms>group_add</ms> <ms small>timer</ms>',
    label: ['working', '(lap)'],
    tooltip: 'Average power while working/pulling in a group (lap)',
},
...makePeakPowerFields(5, -1),
...makePeakPowerFields(15, -1),
...makePeakPowerFields(60, -1),
...makePeakPowerFields(300, -1),
...makePeakPowerFields(1200, -1)
];
powerFields.forEach(x => x.group = 'power');


export const draftFields = [{
    id: 'draft-cur',
    format: x => H.power(x?.state?.draft),
    shortName: 'Draft',
    suffix: x => H.power(x?.state?.draft, {suffixOnly: true}),
}, {
    id: 'draft-avg',
    format: x => H.power(x?.stats?.draft.avg),
    shortName: 'Draft<small> (avg)</small>',
    suffix: x => H.power(x?.stats?.draft.avg, {suffixOnly: true}),
}, {
    id: 'draft-lap',
    format: x => H.power(x?.lap?.draft.avg),
    shortName: 'Draft <ms small>timer</ms>',
    suffix: x => H.power(x?.lap?.draft.avg, {suffixOnly: true}),
}, {
    id: 'draft-energy',
    format: x => H.number(x?.stats?.draft?.kj),
    shortName: 'Draft<small> (energy)</small>',
    suffix: 'kJ',
}];
draftFields.forEach(x => x.group = 'draft');


export const cadenceFields = [{
    id: 'cad-cur',
    format: x => H.number(x?.state?.cadence),
    shortName: 'Cadence',
    suffix: x => getSport(x) === 'running' ? 'spm' : 'rpm',
}, {
    id: 'cad-avg',
    format: x => H.number(x?.stats?.cadence.avg),
    shortName: 'Cadence<small> (avg)</small>',
    suffix: x => getSport(x) === 'running' ? 'spm' : 'rpm',
}, {
    id: 'cad-lap',
    format: x => H.number(x?.lap?.cadence.avg),
    shortName: 'Cadence <ms small>timer</ms>',
    suffix: x => getSport(x) === 'running' ? 'spm' : 'rpm',
}];
cadenceFields.forEach(x => x.group = 'cadence');


function getEventOrRouteFinish(ad) {
    if (ad && ad.state && !ad.state.time && !ad.state.eventDistance) {
        const ts = Common.getRealTime();
        const sg = Common.getEventSubgroup(ad.state?.eventSubgroupId);
        if (sg && ts && !(sg instanceof Promise) && !(ts instanceof Promise)) {
            if (ts <= sg.eventSubgroupStart) {
                return {
                    type: 'start',
                    metric: 'time',
                    event: true,
                    value: (ts - sg.eventSubgroupStart) / 1000,
                };
            }
        }
    }
    return {
        type: 'finish',
        metric: ad?.remainingMetric,
        event: !!ad?.state?.eventSubgroupId,
        value: ad?.remaining,
    };
}


export class SegmentField {

    static resultsCache = new Map();
    static resultsCutoffs = new Map();

    constructor({type='auto'}={}) {
        Object.assign(this, {
            id: `segment-${type}`,
            version: 2,
            type,
        });
        if (type === 'auto') {
            this.tooltip = 'Most Relevant Segment';
            this.longName = 'Segment (Auto)';
        } else if (type === 'pending') {
            this.tooltip = 'Upcoming Segment';
            this.longName = 'Upcoming Segment';
        } else if (type === 'active') {
            this.tooltip = 'Active Segment';
            this.longName = 'Active Segment';
        } else if (type === 'done') {
            this.tooltip = 'Last Completed Segment';
            this.longName = 'Completed Segment';
        }
        this.get = this.get.bind(this);
        this.format = this.format.bind(this);
        this.shortName = this.shortName.bind(this);
    }

    get(ad) {
        this.activeSegment = this.getRelevantSegments(ad)?.[0];
        return this.activeSegment;
    }

    shortName(entry) {
        if (!entry || !entry.segment?.name) {
            return 'Segment';
        }
        let name = entry.segment.name || 'Segment';
        if (name.length > 18) {
            name = `<span style="font-stretch: 88%;"
                          title="${Common.sanitizeAttr(name)}">${name.slice(0, 18)}</span>`;
        } else if (name.length > 8) {
            name = `<span style="font-stretch: 92%;">${name}</span>`;
        }
        if (entry.type === 'active') {
            const icons = ['circle', 'clock_loader_10', 'clock_loader_20', null, 'clock_loader_40',
                null, 'clock_loader_60', null, 'clock_loader_80', 'clock_loader_90', ];
            const tenth = Math.trunc(entry.progress * 10);
            return `<ms title="Active Segment">${icons[tenth] || icons[tenth - 1]}</ms> ${name}`;
        }
        return {
            pending: `<ms title="Upcoming Segment">text_select_jump_to_end</ms> ${name}`,
            done: `<ms title="Most Recent Segment">data_check</ms> ${name}`,
        }[entry.type];
    }

    format(entry) {
        if (!entry) {
            return '-';
        }
        if (entry.type === 'done') {
            return H.timer(entry.result.elapsed, {html: true, ms: true, long: true}) +
                ` <small>(${H.power(entry.result.avgPower, {suffix: true, html: true})})</small>`;
        } else if (entry.type === 'pending') {
            return '...' + H.distance(entry.toStart, {suffix: true, html: true});
        } else if (entry.type === 'active') {
            return H.distance(entry.toFinish, {suffix: true, html: true}) + '...<ms>sports_score</ms>';
        }
        return '-';
    }

    getRelevantSegments(ad) {
        if (!ad?.state) {
            return;
        }
        const ts = Common.getRealTime();
        const sg = Common.getEventSubgroup(ad.state.eventSubgroupId);
        if (sg instanceof Promise) {
            // prime caches..
            sg.then(s => Promise.resolve(Common.getRoute(s?.routeId || ad.state.routeId))
                .then(r => Common.getSegments(r.segments.map(x => x.id))));
            return;
        }
        const routeId = ad.state.routeDistance && (sg?.routeId || ad.state.routeId);
        const routeOrRoad = routeId ?
            Common.getRoute(routeId) :
            Common.getRoad(ad.state.courseId, ad.state.roadId);
        if (!routeOrRoad || (routeOrRoad instanceof Promise)) {
            // prime cache..
            if (routeOrRoad) {
                routeOrRoad.then(r => Common.getSegments(r.segments.map(x => x.id)));
            }
            return;
        }
        let segmentInfos = Common.getSegments(routeOrRoad.segments.map(x => x.id));
        if (segmentInfos instanceof Promise) {
            return;
        }
        segmentInfos = new Map(segmentInfos.map(x => [x.id, x]));
        let ourDist, filteredSegments;
        if (routeId) {
            filteredSegments = routeOrRoad.segments;
            ourDist = ad.state.routeDistance -
                (ad.state.laps ? routeOrRoad.meta.weldDistance : routeOrRoad.meta.leadinDistance);
        } else {
            filteredSegments = routeOrRoad.segments.filter(x => !!ad.state.reverse === !!x.reverse);
            ourDist = routeOrRoad.curvePath.distanceAtRoadTime(ad.state.roadTime) / 100;
            if (ad.state.reverse) {
                ourDist = routeOrRoad.distances[routeOrRoad.distances.length - 1] - ourDist;
            }
            for (const x of filteredSegments.slice()) {
                if (ad.state.distance > x.distance && segmentInfos.get(x.id).loop) {
                    // Duplicate loop segments on roads so we can show results.  Otherwise they
                    // just immediately become active again.
                    filteredSegments.push({
                        ...x,
                        offset: x.offset - x.distance,
                    });
                }
            }
        }
        let segments = filteredSegments.map(seg => {
            const segEndDist = seg.offset + seg.distance;
            const toStart = seg.offset - ourDist;
            const toFinish = segEndDist - ourDist;
            const segment = segmentInfos.get(seg.id);
            return {
                ...seg,
                type: toStart > 0 ?
                    'pending' :
                    toStart <= 0 && toFinish > 0 ?
                        'active' :
                        'done',
                segment,
                toStart,
                toFinish,
                progress: Math.min(1, Math.max(0, (ourDist - seg.offset) / seg.distance)),
                proximity: Math.min(Math.abs(toStart), Math.abs(toFinish)),
            };
        });
        segments.sort((a, b) => {
            // Prioratize done segments so looping will show them for a bit.
            const aPrio = a.type !== 'done' ? a.proximity : (-a.toFinish - 100) * 1.8;
            const bPrio = b.type !== 'done' ? b.proximity : (-b.toFinish - 100) * 1.8;
            return aPrio - bPrio;
        });
        if (this.type !== 'auto') {
            segments = segments.filter(x => x.type === this.type);
        }
        for (const seg of segments.filter(x => x.type === 'done')) {
            const cKey = `${ad.athleteId}-${seg.id}`;
            if (!(ts instanceof Promise) && !this.constructor.resultsCache.has(cKey)) {
                // Setting a cutoff on the segment results request improves backend cache friendliness.
                const cutoffKey = `${cKey}-${Math.round((ad.state.eventDistance + seg.toFinish) / 200)}`;
                if (!this.constructor.resultsCutoffs.has(cutoffKey)) {
                    this.constructor.resultsCutoffs.set(cutoffKey, ts + 15_000);
                }
                const cutoff = this.constructor.resultsCutoffs.get(cutoffKey);
                const gettingResults = Common.rpc.getSegmentResults(seg.id, {
                    athleteId: ad.athleteId,
                    to: cutoff
                });
                this.constructor.resultsCache.set(cKey, gettingResults.then(results => {
                    // XXX we don't have real timestamp correlation here, just grab most recent..
                    results.sort((a, b) => b.ts - a.ts);
                    const result = results[0];
                    this.constructor.resultsCache.set(cKey, result);
                    setTimeout(() => this.constructor.resultsCache.delete(cKey), result ? 300_000 : 5000);
                }));
            }
            const result = this.constructor.resultsCache.get(cKey);
            if (result && !(result instanceof Promise)) {
                seg.result = result;
            } else {
                segments.splice(segments.indexOf(seg), 1);
            }
        }
        return segments;
    }
}


export const courseFields = [{
    id: 'ev-place',
    format: x => x.eventPosition ?
        `${H.place(x.eventPosition, {suffix: true, html: true})}<small> / ${x.eventParticipants}</small>` :
        '-',
    shortName: 'Place',
}, {
    id: 'ev-fin',
    tooltip: 'Remaining Event or Route time/distance',
    format: ad => {
        const d = getEventOrRouteFinish(ad);
        return d.metric === 'distance' ?
            H.distance(Math.max(0, d.value)) :
            d.metric === 'time' ?
                fmtDur(d.value) :
                '-';
    },
    longName: ad => {
        const d = getEventOrRouteFinish(ad);
        return `${d.event ? 'Event' : 'Event/Route'} ${d.type === 'start' ? 'Start' : 'Finish'}`;
    },
    shortName: ad => {
        const d = getEventOrRouteFinish(ad);
        return d.type === 'start' ? 'Start' : 'Finish';
    },
    suffix: ad => {
        const d = getEventOrRouteFinish(ad);
        return d.metric === 'distance' ?
            H.distance(d.value, {suffixOnly: true}) : '';
    }
}, {
    id: 'ev-dst', // legacy id, is essentially ev-progress now
    format: x => x?.state ?
        x.remainingMetric === 'distance' ?
            `${H.distance(x.remainingEnd - x.remaining, {suffix: true, html: true})}<small> / ` +
                `${H.distance(x.remainingEnd, {suffix: true, html: true})}</small>` :
            x.remainingMetric === 'time' ?
                `${fmtDur(x.remainingEnd - x.remaining)}<small> / ${fmtDur(x.remainingEnd)}</small>` :
                H.distance(x.state.eventDistance, {suffix: true, html: true}) :
        '-',
    tooltip: 'Event, Route or Session progress',
    longName: x => x?.remainingType === 'event' ?
        'Event Progress' :
        x?.remainingType === 'route' ?
            'Route Progress' :
            x ?
                'Progress' :
                'Event/Route Progress',
    shortName: x => x?.remainingType === 'event' ?
        'Event <ms>sports_score</ms>' :
        x?.remainingType === 'route' ?
            'Route <ms>sports_score</ms>' :
            x ?
                'Dist' :
                '<ms>sports_score</ms>'
}, {
    id: 'dst',
    format: x => H.distance(x?.state?.distance),
    shortName: 'Dist',
    suffix: x => H.distance(x?.state?.distance, {suffixOnly: true}),
}, {
    id: 'game-laps',
    format: x => fmtLap(x?.state ? x.state.laps + 1 : undefined),
    tooltip: 'Zwift route lap number',
    shortName: 'Lap<small> (zwift)</small>',
}, {
    id: 'sauce-laps',
    format: x => fmtLap(x?.lapCount),
    tooltip: 'Sauce stats lap number',
    shortName: 'Lap<small> (sauce)</small>',
}, {
    id: 'progress',
    format: x => fmtPct(x?.state?.progress || 0),
    shortName: 'Progress',
},{
    id: 'ev-name',
    format: x => {
        const sg = Common.getEventSubgroup(x?.state?.eventSubgroupId);
        return (sg && !(sg instanceof Promise) && sg.name) ? `${sg.name} <ms>event</ms>` : '-';
    },
    shortName: x => (x?.state?.eventSubgroupId) ? '' : 'Event',
    tooltip: 'Event',
}, {
    id: 'rt-name',
    format: x => {
        const sg = Common.getEventSubgroup(x?.state?.eventSubgroupId);
        const routeId = sg?.routeId || x?.state?.routeId;
        const route = routeId && Common.getRoute(routeId);
        if (route && !(route instanceof Promise)) {
            const icon = ' <ms>route</ms>';
            if (sg) {
                return ((sg.laps && sg.laps > 1) ? `${sg.laps} x ` : '') + route.name + icon;
            } else {
                return route.name + icon;
            }
        } else {
            return '-';
        }
    },
    shortName: x => (x?.state?.eventSubgroupId || x?.state?.routeId) ? '' : 'Route',
    tooltip: 'Route',
}, {
    id: 'el-gain',
    format: x => H.elevation(x?.state?.climbing),
    shortName: 'Climbed',
    suffix: x => H.elevation(x?.state?.climbing, {suffixOnly: true}),
}, {
    id: 'el-altitude',
    format: x => H.elevation(x?.state?.altitude),
    longName: 'Altitude',
    shortName: 'Alt',
    suffix: x => H.elevation(x?.state?.altitude, {suffixOnly: true}),
}, {
    id: 'grade',
    get: x => x?.state?.grade,
    format: x => fmtPct(x, {precision: 1, fixed: true, html: true}),
    longName: 'Grade',
    shortName: '',
    suffix: x => x?.state?.grade < 0 ? '<ms>downhill_skiing</ms>' : '<ms>altitude</ms>',
    tooltip: 'Grade of terrain in percent of rise'
},
new SegmentField({type: 'auto'}),
new SegmentField({type: 'pending'}),
new SegmentField({type: 'active'}),
new SegmentField({type: 'done'}),
];
courseFields.forEach(x => x.group = 'course');


export const systemFields = [{
    id: 'system-cpu-state',
    get: () => Common.cpuState,
    format: x => x ?? '-',
    shortName: 'CPU',
    longName: 'CPU State',
}];
systemFields.forEach(x => x.group = 'system');


export const fields = [].concat(
    timeFields,
    powerFields,
    athleteFields,
    speedFields,
    draftFields,
    cadenceFields,
    hrFields,
    courseFields,
    systemFields,
);
