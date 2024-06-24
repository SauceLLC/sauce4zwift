import * as common from './common.mjs';
import * as curves from '/shared/curves.mjs';
import * as locale from '/shared/sauce/locale.mjs';
import {LRUCache} from '/shared/sauce/base.mjs';

const H = locale.human;


function getCanvasBudget() {
    let budget = JSON.parse(localStorage.getItem('sauce-map-canvas-budget'));
    return 1024 ** 2;
    if (!budget) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        let safeSize = 256;
        for (let s = safeSize; s <= 32768; s *= 2) {
            canvas.width = canvas.height = s;
            ctx.clearRect(0, 0, s, s);
            if (ctx.isContextLost) {
                if (ctx.isContextLost()) {
                    break;
                }
            } else {
                ctx.fillStyle = '#aaaaaa';
                ctx.fillRect(s - 1, s - 1, 1, 1);
                if (ctx.getImageData(s - 1, s - 1, 1, 1).data[0] !== 0xaa) {
                    break;
                }
            }
            safeSize = s;
        }
        canvas.width = canvas.height = 0;
        budget = safeSize ** 2;
        localStorage.setItem('sauce-map-canvas-budget', JSON.stringify(budget));
    }
    const s = Math.sqrt(budget) | 0;
    console.debug(`Max <canvas> size: ${s}x${s}`);
    return budget;
}


function createElementSVG(name, attrs={}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attrs)) {
        el.setAttribute(key, value);
    }
    return el;
}


function createElement(name, attrs={}) {
    const el = document.createElement(name);
    for (const [key, value] of Object.entries(attrs)) {
        el.setAttribute(key, value);
    }
    return el;
}


// We could use eval to make these but it can trigger browser warnings..
const _fastArrayEmplacers = [
    (a, b) => void (a[0] = b[0]),
    (a, b) => void (a[0] = b[0], a[1] = b[1]),
    (a, b) => void (a[0] = b[0], a[1] = b[1], a[2] = b[2]),
    (a, b) => void (a[0] = b[0], a[1] = b[1], a[2] = b[2], a[3] = b[3]),
    (a, b) => void (a[0] = b[0], a[1] = b[1], a[2] = b[2], a[3] = b[3], a[4] = b[4]),
    (a, b) => void (a[0] = b[0], a[1] = b[1], a[2] = b[2], a[3] = b[3], a[4] = b[4], a[5] = b[5]),
];

// Fast GC-free array emplace with branchless code for small arrays
function makeFastArrayEmplace(size) {
    if (size <= _fastArrayEmplacers.length - 1) {
        return _fastArrayEmplacers[size - 1];
    } else {
        console.warn("Creating branchfull emplace function...");
        return (a, b) => {
            for (let i = 0; i < size; i++) {
                a[i] = b[i];
            }
        };
    }
}


class Transition {

    constructor({duration=1000, easing}={}) {
        this.duration = duration;
        this.disabled = false;
        this._src = [];
        this._cur = [];
        this._dst = [];
        this._startTime = 0;
        this._endTime = 0;
        this._easing = undefined;
        this._disabledRefCnt = 0;
        this.disabled = false;
        this.playing = false;
        this.nextId = 1;
        this._emplace = undefined;
        this._valuesSize = undefined;
        if (easing) {
            this.setEasing(easing);
        }
    }

    setEasing(type) {
        if (!type || type === 'linear') {
            this._easing = undefined;
            return;
        }
        let params;
        if (['both', 'in', 'out'].includes(type)) {
            params = {
                'in': [0.42, 0, 1, 1],
                'out': [0, 0, 0.58, 1],
                'both': [0.42, 0, 0.58, 1],
            }[type];
        } else if (Array.isArray(type)) {
            params = type;
        }
        if (!params) {
            throw new TypeError('invalid easing argument');
        }
        const ub = new curves.UnitBezier(...params);
        this._easing = x => ub.solve(x);
    }

    now() {
        return performance.now();
    }

    incDisabled() {
        this._disabledRefCnt++;
        if (this._disabledRefCnt === 1) {
            this.disabled = true;
            this.playing = false;
            if (this._cur.length) {
                // halt at current progress
                this._emplace(this._dst, this._cur);
            }
            this._startTime = this._endTime = 0;
            this.nextId++;
        }
    }

    decDisabled() {
        this._disabledRefCnt--;
        if (this._disabledRefCnt < 0) {
            throw new Error("Transition disabled refcnt < 0");
        }
        if (this._disabledRefCnt === 0) {
            this.disabled = false;
        }
    }

    setDuration(duration) {
        if (!this.disabled) {
            if (this.playing) {
                // Prevent jitter by forwarding the current transition.
                this._recalcCurrent();
                this._emplace(this._src, this._cur);
                this._startTime = this.now();
                this._endTime += duration - this.duration;
            }
        }
        this.duration = duration;
    }

    setValues(values) {
        if (!this._emplace) {
            this._valuesSize = values.length;
            this._emplace = makeFastArrayEmplace(this._valuesSize);
        } else if (this._valuesSize !== values.length) {
            throw new Error('values array size must not change');
        }
        if (!this.disabled) {
            if (this._dst.length) {
                this._recalcCurrent();
                this._emplace(this._src, this._cur);
                this._startTime = this.now();
                this._endTime = this._startTime + this.duration;
                this.playing = true;
            } else {
                this._emplace(this._cur, values);
            }
        } else {
            this._emplace(this._cur, values);
        }
        this._emplace(this._dst, values);
        this.nextId++;
    }

    getStep() {
        if (this.playing) {
            this._recalcCurrent();
            this.nextId++;
            return this._cur;
        } else {
            return this._dst;
        }
    }

    _recalcCurrent() {
        const duration = this._endTime - this._startTime;
        const progress = duration ? (this.now() - this._startTime) / duration : 1;
        if (progress >= 1 || this.disabled) {
            if (!this._dst || !this._dst.length) {
                debugger;
            }
            this._emplace(this._cur, this._dst);
            this.playing = false;
        } else {
            const t = this._easing ? this._easing(progress) : progress;
            for (let i = 0; i < this._dst.length; i++) {
                const delta = this._dst[i] - this._src[i];
                this._cur[i] = this._src[i] + (delta * t);
            }
        }
    }
}


export class MapEntity extends EventTarget {
    constructor(id, type='generic') {
        super();
        this.new = true;
        this.id = id;
        this.type = type;
        this.el = document.createElement('div');
        this.el.classList.add('entity', type);
        this.el.dataset.id = id;
        this.el.dataset.idType = typeof id;
        this.transition = new Transition();
        this.pin = null;
        this._pinContent = null;
        this._pinHTML = null;
        this._position = null;
        this._map = null;
    }

    setMap(map) {
        this._map = map;
        if (this._position) {
            this.transition.incDisabled();
            try {
                this.setPosition(this._position);
            } finally {
                this.transition.decDisabled();
            }
        }
    }

    togglePin(en) {
        if (this.pin) {
            if (en !== true) {
                this.pin.remove();
                this.pin = null;
                this._pinContent = null;
            }
        } else if (en !== false) {
            this.pin = document.createElement('div');
            this.pin.setAttribute('tabindex', 0); // Support click to focus so it can stay higher
            this.pin.classList.add('pin-anchor');
            const inner = document.createElement('div');
            inner.classList.add('pin-inner');
            this.pin.append(inner);
            const wrap = document.createElement('div');
            wrap.classList.add('pin-content-wrap');
            inner.append(wrap);
            this._pinContent = document.createElement('div');
            this._pinContent.classList.add('pin-content');
            wrap.addEventListener('click', ev => {
                if (ev.target === ev.currentTarget) { // basically just match pseudo X close
                    this.togglePin(false);
                }
            });
            wrap.append(this._pinContent);
            this.renderPinHTML(this.getPinHTML());
        }
        const ev = new Event('pinned');
        ev.visible = !!this.pin;
        this.dispatchEvent(ev);
        return !!this.pin;
    }

    toggleHidden(en) {
        this.el.classList.toggle('hidden', en);
        if (this.pin) {
            this.pin.classList.toggle('hidden', this.el.classList.contains('hidden'));
        }
    }

    setPinHTML(html) {
        if (this._pinHTML === html) {
            return;
        }
        this._pinHTML = html;
        this.renderPinHTML(this.getPinHTML());
    }

    getPinHTML() {
        return this._pinHTML;
    }

    renderPinHTML(html) {
        if (this.pin) {
            this._pinContent.innerHTML = html;
            this.pin.classList.toggle('hidden', !html);
        }
    }

    setPosition([x, y]) {
        if (typeof x !== 'number' || typeof y !== 'number') {
            throw new TypeError('invalid position');
        }
        this._position = [x, y]; // Save non-rotate-hacked position.
        if (this._map?.rotateCoordinates) {
            [x, y] = [y, -x];
        }
        this.transition.setValues([x, y]);
        const ev = new Event('position');
        ev.position = this._position;
        this.dispatchEvent(ev);
    }

    getPosition() {
        return this._position;
    }
}


export class MapAthlete extends MapEntity {
    constructor(athleteId) {
        super(athleteId, 'athlete');
        this.chats = [];
        this._lastStateRender = 0;
        this._hardPin = false;
    }

    setPinHTML() {
        throw new TypeError("pin html is read-only for athletes");
    }

    togglePin(en, _soft) {
        this._hardPin = !_soft && (en === undefined ? !this.pin : en);
        return super.togglePin(en);
    }

    getPinHTML() {
        const html = [];
        const state = this._state;
        if (state) {
            const ad = common.getAthleteDataCacheEntry(state.athleteId, {maxAge: Infinity});
            const athlete = ad?.athlete;
            let name;
            if (athlete) {
                name = `${athlete.fLast}`;
            } else if (this.chats.length) {
                const c = this.chats[0][0];
                name = `${c.firstName[0]}.${c.lastName}`;
            } else {
                name = `ID: ${state.athleteId}`;
            }
            const avatar = athlete?.avatar ?
                `<avatar-pad></avatar-pad><img class="avatar" src="${athlete.avatar}"/>` : '';
            html.push(`<a class="name" href="/pages/profile.html?id=${state.athleteId}&windowType=profile"
                          target="profile_popup_${state.athleteId}">${common.sanitize(name)}${avatar}</a>`);
            if (this._hardPin) {
                html.push(`<br/>${H.power(state.power, {suffix: true, html: true})}`);
                if (state.heartrate) {
                    html.push(`, ${H.number(state.heartrate, {suffix: 'bpm', html: true})}`);
                }
                html.push(`, ${H.pace(state.speed, {suffix: true, html: true, sport: state.sport})}`);
                if (ad?.gap) {
                    const placement = ad.gap > 0 ? 'behind' : 'ahead';
                    const d = H.duration(Math.abs(ad.gap), {short: true, separator: ' ', html: true});
                    html.push(`<br/>${d} <abbr class="unit">${placement}</abbr>`);
                }
            }
        }
        if (this.chats.length) {
            if (html.length) {
                html.push('<br/>');
            }
            html.push(`<q class="chat">${this.chats.map(x => x[0].message).join('<br/>')}</q>`);
        }
        return html.length ? html.join('') : '';
    }

    setPlayerState(state) {
        this._state = state;
        if (this.pin && this._hardPin) {
            this.renderPinHTML(this.getPinHTML());
        }
    }

    addChatMessage(chat) {
        const expires = 15000;
        this.chats.push([chat, Date.now() + expires]);
        if (this.pin) {
            this.renderPinHTML(this.getPinHTML());
        } else {
            this.togglePin(true, /*soft*/ true);
        }
        setTimeout(() => {
            this.chats = this.chats.filter(x => x[1] > Date.now());
            if (!this.chats.length && !this._hardPin) {
                this.togglePin(false);
            } else if (this.pin) {
                this.renderPinHTML(this.getPinHTML());
            }
        }, expires + 10);
    }
}


async function getIRLMapTileImage(x, y, z, options={}) {
    const mapType = options.mapType || 'terrain';
    const tile = await common.rpc.getIRLMapTile(x, y, z, {
        scale: 1,
        highDpi: false,
        mapType,
        layerTypes: ['layerRoadmap']
    });
    if (!tile) {
        return null;
    }
    let url;
    if (tile.encoding === 'base64') {
        url = `data:${tile.meta.contentType};base64,` + tile.data;
    } else {
        throw new TypeError('unsupported encoding');
    }
    const img = new Image();
    await new Promise((resolve, reject) => {
        img.addEventListener('load', resolve);
        img.addEventListener('error', ev => {
            console.warn('image load error:', ev);
            reject(new Error('Image load error'));
        });
        img.src = url;
    });
    return img;
}


function drawGridOnCanvas(ctx, x, y, width, height, size=16, color='#25e', background='#fffa', lineWidth=1) {
    ctx.save();
    try {
        ctx.fillStyle = background;
        ctx.fillRect(x, y, width, height);
        ctx.beginPath();
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = color;
        for (let lx = x; lx < x + width; lx += size) {
            ctx.moveTo(lx, y);
            ctx.lineTo(lx, y + height);
        }
        for (let ly = y; ly < y + height; ly += size) {
            ctx.moveTo(x, ly);
            ctx.lineTo(x + width, ly);
        }
        ctx.stroke();
        ctx.closePath();
    } finally {
        ctx.restore();
    }
}


export class SauceZwiftMap extends EventTarget {
    constructor({el, worldList, zoom=1, zoomMin=0.05, zoomMax=10, autoHeading=true,
                 style='default', opacity=1, tiltShift=null, maxTiltShiftAngle=65,
                 sparkle=false, quality=1, verticalOffset=0, fpsLimit=30,
                 zoomPriorityTilt=true, preferRoute, autoCenter=true}) {
        super();
        el.classList.add('sauce-map-container');
        this.el = el;
        this.worldList = worldList;
        this.preferRoute = preferRoute;
        this.zoomMin = zoomMin || 1e-8;
        this.zoomMax = zoomMax;
        this.maxTiltShiftAngle = maxTiltShiftAngle;
        this.watchingId = null;
        this.athleteId = null;
        this.courseId = null;
        this.portal = null;
        this.roadId = null;
        this.routeId = null;
        this.route = null;
        this.worldMeta = null;
        this.rotateCoordinates = null;
        this._adjHeading = 0;
        this.style = style;
        this.quality = quality;
        this._canvasScale = null;
        this._zoomScale = 1;
        this._headingRotations = 0;
        this._heading = 0;
        this.headingOffset = 0;
        this._ents = new Map();
        this._pendingEntityUpdates = new Set();
        this._roads = [];
        this._roadPathsCache = new LRUCache(500);
        this.center = [0, 0];
        this._centerXY = [0, 0];
        this._anchorXY = [0, 0];
        this.dragOffset = [0, 0];
        this._dragXY = [0, 0];
        this._layerScale = null;
        this._pauseRefCnt = 1;
        this._pinned = new Set();
        this._mapScale = null;
        this._lastFrameTime = 0;
        this._frameTimeAvg = 0;
        this._frameTimeWeighted = common.expWeightedAvg(10);
        this._perspective = 800;
        this._irlMapTileCache = new LRUCache(1000);
        this._irlDrawTicketCount = 1;
        this._canvasPixelBudget = getCanvasBudget();
        this.pathStyle = {
            highlight: {color: '#cf0606b0'},
            roadGutter: {color: '#000'},
            roadSurface: {color: '#e9e9e9'},
            roadActive: {color: '#ff3939bf'},
            roadRunning: {color: '#69a573'},
        };
        this._styleEl = document.createElement('style');
        this._styleEl.type = 'text/css';
        el.appendChild(this._styleEl);
        this._wheelState = {
            nextAnimFrame: null,
            done: null,
        };
        this._pointerState = {
            nextAnimFrame: null,
            lastDistance: null,
            ev1: null,
            ev2: null,
            lastX: null,
            lastY: null,
        };
        this._transformAnimationLoopBound = this._transformAnimationLoop.bind(this);
        this._onPointerMoveBound = this._onPointerMove.bind(this);
        this._onPointerDoneBound = this._onPointerDone.bind(this);
        this.viewTransition = new Transition({duration: 400, easing: 'out'});
        this.mapTransition = new Transition({duration: 2500});
        this._elements = {
            style: createElement('style', {type: 'text/css'}),
            map: createElement('div', {class: 'sauce-map'}),
            mapCanvas: createElement('canvas', {class: 'map-background', width: 2048, height: 2048}),
            pathCanvas: createElement('canvas', {class: 'path-background'}),
            ents: createElement('div', {class: 'entities'}),
            pins: createElement('div', {class: 'pins'}),
            paths: createElementSVG('svg', {class: 'paths'}),
            roadDefs: createElementSVG('defs'),
            pathLayersGroup: createElementSVG('g', {class: 'path-layers'}),
            roadLayers: {
                gutters: createElementSVG('g', {class: 'gutters'}),
                surfacesLow: createElementSVG('g', {class: 'surfaces low'}),
                surfacesMid: createElementSVG('g', {class: 'surfaces mid'}),
                surfacesHigh: createElementSVG('g', {class: 'surfaces high'}),
            },
            userLayers: {
                surfacesLow: createElementSVG('g', {class: 'surfaces low'}),
                surfacesMid: createElementSVG('g', {class: 'surfaces mid'}),
                surfacesHigh: createElementSVG('g', {class: 'surfaces high'}),
            },
        };
        document.head.append(this._elements.style);
        const css = document.styleSheets[document.styleSheets.length - 1];
        const pathSel = '.sauce-map-container > .sauce-map > svg.paths ';
        css.insertRule(pathSel + '.highlight' + `{stroke: ${this.pathStyle.highlight.color};}`);
        css.insertRule(pathSel + '.gutters .road' + `{stroke: ${this.pathStyle.roadGutter.color};}`);
        css.insertRule(pathSel + '.surfaces .road' + `{stroke: ${this.pathStyle.roadSurface.color};}`);
        css.insertRule(pathSel + '.surfaces .road.active' + `{stroke: ${this.pathStyle.roadActive.color};}`);
        css.insertRule(pathSel + '.surfaces .road.sport-running:not(.sport-cycling)' +
                       `{stroke: ${this.pathStyle.roadRunning.color};}`);
        this._elements.paths.renderers = [];
        this._elements.paths.append(this._elements.roadDefs, this._elements.pathLayersGroup);
        this._elements.pathLayersGroup.append(...Object.values(this._elements.roadLayers));
        this._elements.pathLayersGroup.append(...Object.values(this._elements.userLayers));
        this._elements.map.append(this._elements.mapCanvas, this._elements.pathCanvas,
                                  this._elements.paths, this._elements.ents);
        this.el.addEventListener('wheel', this._onWheelZoom.bind(this), {passive: false});
        this.el.addEventListener('pointerdown', this._onPointerDown.bind(this));
        this._elements.ents.addEventListener('click', this._onEntsClick.bind(this));
        this.setZoom(zoom);
        this.setAutoHeading(autoHeading);
        this.setAutoCenter(autoCenter);
        this.setOpacity(opacity);
        this.setTiltShift(tiltShift);
        this.setZoomPriorityTilt(zoomPriorityTilt);
        this.setSparkle(sparkle);
        this.setVerticalOffset(verticalOffset);
        this.setFPSLimit(fpsLimit);
        this.el.append(this._elements.map, this._elements.pins);
        this._resizeObserver = new ResizeObserver(() => this._updateContainerLayout());
        this._resizeObserver.observe(this.el);
        this._updateContainerLayout();
        this._pauseRefCnt--;
        this._gcLoop();
        requestAnimationFrame(this._transformAnimationLoopBound);
    }

    _updateContainerLayout() {
        this._elRect = this.el.getBoundingClientRect();
        this._fullUpdateAsNeeded();
    }

    setFPSLimit(fps) {
        this.fpsLimit = fps;
        this._msPerFrame = 1000 / fps | 0;
    }

    async setStyle(style='default') {
        if (style === this.style) {
            return;
        }
        this.style = style;
        await this._updateMapBackground();
    }

    setOpacity(v) {
        this._elements.map.style.setProperty('--opacity', isNaN(v) ? 1 : v);
    }

    _fullUpdateAsNeeded(takeAction) {
        takeAction = takeAction || !this.isPaused();
        if (takeAction) {
            this._updateGlobalTransform();
            this._renderFrame(takeAction && false); // XXX jank, avoid if possible, like on non irl tils I think
        }
        return takeAction;
    }

    setTiltShift(v) {
        this.tiltShift = v || 0;
        this._updateTiltAngle();
        this._fullUpdateAsNeeded();
    }

    setZoomPriorityTilt(en) {
        this._zoomPrioTilt = en;
        this._updateTiltAngle();
        this._fullUpdateAsNeeded();
    }

    _updateTiltAngle() {
        if (this.tiltShift) {
            const f = this._zoomPrioTilt ? Math.min(1, (1 / this.zoomMax * (this.zoom + 1))) : 1;
            this._tiltAngle = this.tiltShift * this.maxTiltShiftAngle * f;
        } else {
            this._tiltAngle = 0;
        }
    }

    setSparkle(en) {
        this.el.classList.toggle('sparkle', !!en);
    }

    _qualityToCanvasScale(quality) {
        if (this.courseId < 0) {
            return 1;
        }
        const pixels = this._elements.mapCanvas._pixels;
        if (!pixels) {
            console.warn("Using naive canvas scale method");
            return quality < 0.5 ? 0.25 : quality < 0.85 ? 0.5 : 1;
        }
        const pixelMegabyte = 1024 * 1024 / 4; // RGBA 8 bits per channel, 4 channels
        const lowBudget = 4 * pixelMegabyte; // ~1024^2
        const highBudget = Math.min(192 * pixelMegabyte /* ~7094^2 */, this._canvasPixelBudget);
        const ratio = Math.sqrt(((highBudget - lowBudget) * quality + lowBudget) / pixels);
        const q = 15;
        const quantizedRatio = Math.round(ratio * q) / q;
        return Math.min(1, quantizedRatio);
    }

    async setQuality(q) {
        this.quality = q;
        const cs = this._qualityToCanvasScale(q);
        if (cs !== this._canvasScale) {
            await this._updateMapBackground();
        }
        this._fullUpdateAsNeeded();
    }

    setVerticalOffset(v) {
        this.verticalOffset = v;
        this._fullUpdateAsNeeded();
    }

    setZoom(zoom, options) {
        this.zoom = Math.max(this.zoomMin, Math.min(this.zoomMax, zoom));
        this._applyZoom(options);
    }

    setBounds(tl, br, {padding=0.20}={}) {
        let width = br[0] - tl[0];
        let height = tl[1] - br[1];
        const center = [tl[0] + width / 2, br[1] + height / 2];
        width *= (1 + padding);
        height *= (1 + padding);
        if (this.courseId >= 0) {
            // As strange as this seems, every world is rotated by -90deg when other
            // correction factors are applied, so width and height are swapped for
            // purposes of finding our ideal bounding box sizes.
            [width, height] = [height, width];
        }
        const boundsRatio = width / height;
        const viewRatio = this._elRect.width / this._elRect.height;
        const axis = viewRatio > boundsRatio ? 'height' : 'width';
        let zoom;
        if (this.courseId < 0) {
            zoom = this._getRealWorldZoom(axis === 'height' ? height : width, axis);
        } else {
            const scale = 1 / (this.worldMeta.mapScale / this.worldMeta.tileScale);
            const pxRatio = axis === 'height' ? this._elRect.height / height : this._elRect.width / width;
            zoom = pxRatio * scale;
        }
        this._setCenter(center);
        this.setZoom(zoom, {disableEvent: true});
    }

    _adjustZoom(adj) {
        this.zoom = Math.max(this.zoomMin, Math.min(this.zoomMax, this.zoom + adj));
    }

    _applyZoom(options={}) {
        this._elements.map.style.setProperty('--zoom', this.zoom);
        if (this._zoomPrioTilt && this.tiltShift) {
            this._updateTiltAngle();
        }
        if (this._fullUpdateAsNeeded() && !options.disableEvent) {
            const ev = new Event('zoom');
            ev.zoom = this.zoom;
            this.dispatchEvent(ev);
        }
    }

    _onWheelZoom(ev) {
        if (!ev.deltaY) {
            return;
        }
        ev.preventDefault();
        this.trackingPaused = true;
        const f = Math.log10(1 + this.zoom);
        const isPinch = ev.ctrlKey; // I can't find a better way to detect this
        const adj = -ev.deltaY / 300 * f * (isPinch ? 5 : 1);
        this._adjustZoom(adj);
        cancelAnimationFrame(this._wheelState.nextAnimFrame);
        this._wheelState.nextAnimFrame = requestAnimationFrame(() => {
            if (this._wheelState.done) {
                clearTimeout(this._wheelState.done);
            }
            this._applyZoom();
            this._wheelState.done = setTimeout(() => {
                this.trackingPaused = false;
                this._wheelState.done = null;
            }, 100);
        });
    }

    _onPointerDown(ev) {
        const state = this._pointerState;
        if (ev.button !== 0 || (state.ev1 && state.ev2)) {
            return;
        }
        if (state.ev1) {
            state.ev2 = ev;
            this.el.classList.remove('moving');
            state.lastDistance = Math.sqrt(
                (ev.pageX - state.ev1.pageX) ** 2 +
                (ev.pageY - state.ev1.pageY) ** 2);
            return;
        } else {
            state.ev1 = ev;
        }
        state.active = false;
        state.lastX  = ev.pageX;
        state.lastY = ev.pageY;
        document.addEventListener('pointermove', this._onPointerMoveBound);
        document.addEventListener('pointerup', this._onPointerDoneBound, {once: true});
        document.addEventListener('pointercancel', this._onPointerDoneBound, {once: true});
    }

    setDragOffset(pos) {
        if (arguments.length === 2 && typeof pos === 'number') {
            pos = Array.from(arguments);
        }
        this.dragOffset = pos;
        this._dragXY = this._rotateWorldPos(pos);
        this._fullUpdateAsNeeded(true);
    }

    setAutoHeading(en) {
        this.autoHeading = en;
        if (!this.trackingPaused) {
            this.setHeading(en ? this._autoHeadingSaved || 0 : 0);
        }
    }

    setAutoCenter(en) {
        this.autoCenter = en;
        if (en && this._autoCenterSaved) {
            this.setCenter(this._autoCenterSaved);
        }
    }

    _onPointerMove(ev) {
        const state = this._pointerState;
        if (!state.active) {
            state.active = true;
            this.trackingPaused = true;
            this.el.classList.add('moving');
            this.incPause();
        }
        if (!state.ev2) {
            this._handlePointerDragEvent(ev, state);
        } else {
            this._handlePointerPinchEvent(ev, state);
        }
    }

    _handlePointerDragEvent(ev, state) {
        cancelAnimationFrame(state.nextAnimFrame);
        state.nextAnimFrame = requestAnimationFrame(() => {
            const dragEv = new Event('drag');
            const dx = ev.pageX - state.lastX;
            const dy =  ev.pageY - state.lastY;
            state.lastX = ev.pageX;
            state.lastY = ev.pageY;
            if (ev.ctrlKey) {
                const heading = this.headingOffset - dx * 0.1;
                this.headingOffset = heading;
                dragEv.heading = heading;
                const tiltShift = this.tiltShift - dy * 0.001;
                this._zoomPrioTilt = false;
                this.setTiltShift(tiltShift);
                this._fullUpdateAsNeeded(true);
                dragEv.tiltShift = tiltShift;
            } else {
                const [tx, ty] = this._unrotateWorldPos([dx, dy]);
                const l = Math.sqrt(tx * tx + ty * ty);
                const a = Math.atan2(ty, tx) - (this._rotate / 180 * Math.PI);
                const adjX = Math.cos(a) * l;
                const adjY = Math.sin(a) * l;
                const f = 1 / (this.zoom * this._mapScale / this._canvasScale / this._zoomScale);
                const pos = [this.dragOffset[0] + adjX * f, this.dragOffset[1] + adjY * f];
                this.setDragOffset(pos);
                dragEv.drag = pos;
            }
            this.dispatchEvent(dragEv);
        });
    }

    _handlePointerPinchEvent(ev, state) {
        let otherEvent;
        if (ev.pointerId === state.ev1.pointerId) {
            otherEvent = state.ev2;
            state.ev1 = ev;
        } else if (ev.pointerId === state.ev2.pointerId) {
            otherEvent = state.ev1;
            state.ev2 = ev;
        } else {
            // third finger, ignore
            return;
        }
        const distance = Math.sqrt(
            (ev.pageX - otherEvent.pageX) ** 2 +
            (ev.pageY - otherEvent.pageY) ** 2);
        const deltaDistance = distance - state.lastDistance;
        state.lastDistance = distance;
        this._adjustZoom(deltaDistance / 600);
        requestAnimationFrame(() => this._applyZoom());
    }

    _onPointerDone(ev) {
        const state = this._pointerState;
        if (state.active) {
            state.active = false;
            this.el.classList.remove('moving');
            this.decPause();
        }
        document.removeEventListener('pointermove', this._onPointerMoveBound);
        document.removeEventListener('pointerup', this._onPointerDoneBound, {once: true});
        document.removeEventListener('pointercancel', this._onPointerDoneBound, {once: true});
        this._pointerState.ev1 = this._pointerState.ev2 = null;
        this.trackingPaused = false;
    }

    _updateMapBackground = common.asyncSerialize(async function() {
        if (this.courseId < 0) {
            this._updateRealWorldTiles(this.zoom);
        } else {
            await this._drawZwiftWorldBackground();
        }
        //this._renderRoads();
        this._updateGlobalTransform();
        this._renderFrame(/*force*/ true);
    });

    webMercatorProjection([lat, lng]) {
        const lngRad = lng / 180 * Math.PI;
        const latRad = lat / 180 * Math.PI;
        const term1 = 1 / (2 * Math.PI);
        const x = term1 * (Math.PI + lngRad);
        const y = term1 * (Math.PI - Math.log(Math.tan((Math.PI / 4) + (latRad / 2))));
        return [x, y];
    }

    _drawRealWorldBackground(config) {
        const canvas = this._elements.mapCanvas;
        //canvas.classList.toggle('hidden', !!this.portal);
        const tileSize = config.size;
        const tileScale = config.scale;
        const anchorX = Math.round(this._anchorXY[0] * tileScale);
        const anchorY = Math.round(this._anchorXY[1] * tileScale);
        const ctx = canvas.getContext('2d', {alpha: false});
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const width = tileSize * config.cols * this._canvasScale;
        const height = tileSize * config.rows * this._canvasScale;
        // Avoid setting canvas width and height as they will reset everything causing jank
        // on otherwise smooth transitions like zooming.
        if (canvas.width !== width) {
            canvas.width = width;
        }
        if (canvas.height !== height) {
            canvas.height = height;
        }
        drawGridOnCanvas(ctx, 0, 0, width, height);
        if (canvas.tileQueue) {
            // Pre fill the current canvas with scaled or moved tiles from the previous render.
            // If any of these tiles need to be fetched from the network they'll stand in while
            // we wait making for much reduced jank.  Namely this works nicely for zooming.
            for (const entry of canvas.tileQueue) {
                if (!entry.img) {
                    continue;
                }
                const scale = tileScale / entry.tileScale;
                const cx = (entry.x * scale - anchorX) * tileSize;
                const cy = (entry.y * scale - anchorY) * tileSize;
                if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
                    const scaledTileSize = tileSize * scale;
                    ctx.drawImage(entry.img, cx, cy, scaledTileSize, scaledTileSize);
                }
            }
        }
        const ticket = ++this._irlDrawTicketCount;
        const tileQueue = [];
        for (let row = 0; row < config.rows; row++) {
            for (let col = 0; col < config.cols; col++) {
                const x = anchorX + col;
                const y = anchorY + row;
                const z = config.zoom;
                const entry = {x, y, tileScale};
                tileQueue.push(entry);
                const sig = [x, y, z].join();
                const img = this._irlMapTileCache.get(sig);
                const cx = col * tileSize;
                const cy = row * tileSize;
                if (img === undefined) {
                    getIRLMapTileImage(x, y, z).then(img => {
                        this._irlMapTileCache.set(sig, img);
                        if (!img || this._irlDrawTicketCount !== ticket) {
                            return;
                        }
                        entry.img = img;
                        ctx.drawImage(img, cx, cy, tileSize, tileSize);
                    }).catch(e => {
                        this._irlMapTileCache.set(sig, null);
                        console.error("IRL map tile image error:",
                                      {x, y, z, config, anchorXY: this._anchorXY},
                                      e.message.split('\n')[0]);
                    });
                } else if (img) {
                    entry.img = img;
                    ctx.drawImage(img, cx, cy, tileSize, tileSize);
                }
            }
        }
        canvas.tileQueue = tileQueue;
    }

    async _drawZwiftWorldBackground() {
        const canvas = this._elements.mapCanvas;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        //canvas.classList.toggle('hidden', !!this.portal);
        drawGridOnCanvas(ctx, 0, 0, canvas.width, canvas.height);
        const img = new Image();
        try {
            await new Promise((resolve, reject) => {
                img.addEventListener('load', resolve);
                img.addEventListener('error', ev => {
                    console.warn('image load error:', ev);
                    reject(new Error('Image load error'));
                });
                const version = this.worldMeta.mapVersion ? `-v${this.worldMeta.mapVersion}` : '';
                const suffix = {
                    default: '',
                    neon: '-neon',
                }[this.style];
                img.src = `https://www.sauce.llc/products/sauce4zwift/maps/world` +
                    `${this.worldMeta.worldId}${version}${suffix || ''}.webp`;
            });
        } catch(e) {
            console.warn("Image decode interrupted/failed", e);
            return;
        }
        canvas._pixels = img.naturalWidth * img.naturalHeight;
        this._canvasScale = this._qualityToCanvasScale(this.quality);
        this._mapScale = 1 / (this.worldMeta.tileScale / this.worldMeta.mapScale / this._canvasScale);
        canvas.width = img.naturalWidth * this._canvasScale;
        canvas.height = img.naturalHeight * this._canvasScale;
        //canvas.classList.toggle('hidden', !!this.portal);
        if (!this.portal) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        }
    }

    incPause() {
        this._pauseRefCnt++;
        if (this._pauseRefCnt === 1) {
            if (this.mapTransition.playing) {
                // Freeze current position and heading transitioning value instead of target value.
                // Otherwise we hard teleport and spin on the next render.
                // NOTE: We assume the dragXY and headingOffset components are static at this point even
                // though they might be mid transition if set by user code.  In this case there will be jank.
                const [x, y, h] = this.mapTransition.getStep();
                if (this._rotate != null) {
                    this._adjHeading = h - this.headingOffset;
                }
                this._centerXY[0] = x + this._dragXY[0];
                this._centerXY[1] = y + this._dragXY[1];
            }
            this.viewTransition.incDisabled();
            this.mapTransition.incDisabled();
        }
    }

    decPause() {
        this._pauseRefCnt--;
        if (this._pauseRefCnt < 0) {
            throw new Error("decPause < 0");
        } else if (this._pauseRefCnt === 0) {
            try {
                this._updateGlobalTransform();
                this._renderFrame();
            } finally {
                this.viewTransition.decDisabled();
                this.mapTransition.decDisabled();
            }
        }
    }

    isPaused() {
        return this._pauseRefCnt > 0 || this.worldMeta == null;
    }

    setCourse = common.asyncSerialize(async function(courseId, {portalRoad}={}) {
        const isPortal = portalRoad != null;
        this._elements.map.classList.toggle('real-world', courseId < 0);
        if (isPortal) {
            if (courseId === this.courseId && this.portal && portalRoad === this.roadId) {
                return;
            }
        } else if (courseId === this.courseId && !this.portal) {
            return;
        }
        this.incPause();
        try {
            this.courseId = courseId;
            this.portal = isPortal;
            const m = this.worldMeta = this.worldList.find(x => x.courseId === courseId);
            this._anchorXY = [m.minX + m.anchorX, m.minY + m.anchorY];
            this.rotateCoordinates = isPortal ? false : !!this.worldMeta.rotateRouteSelect;
            this.geoCenter = this._unrotateWorldPos([
                m.maxX - (m.maxX - m.minX) / 2 + m.anchorX,
                m.maxY - (m.maxY - m.minY) / 2 + m.anchorY,
            ]);
            this._setCenter(this.geoCenter);
            if (isPortal) {
                await this._applyPortal(portalRoad);
            } else {
                await this._applyCourse();
            }
        } finally {
            this.decPause();
        }
    });

    async _applyCourse() {
        const m = this.worldMeta;
        const scale = m.svgScale || 1;
        this._resetElements([
            (m.minX + m.anchorX) * scale,
            (m.minY + m.anchorY) * scale,
            (m.maxX - m.minX) * scale,
            (m.maxY - m.minY) * scale,
        ]);
        this._roads.length = 0;
        this._roads.push(...await common.getRoads(this.courseId));
        await this._updateMapBackground();
        //this._renderRoads(roads);
    }

    async _applyPortal(roadId) {
        const m = this.worldMeta;
        const road = await common.getRoad('portal', roadId);
        this._resetElements([
            m.minX + m.anchorX + road.path[0][0],
            m.minY + m.anchorY + road.path[0][1],
            m.maxX - m.minX,
            m.maxY - m.minY
        ]);
        this._roads.length = 0;
        this._roads.push(road);
        await this._updateMapBackground();
        //this._renderRoads([road]);
        this.setActiveRoad(roadId);
    }

    _resetElements(viewBox) {
        if (this._routeHighlight) {
            this._routeHighlight.elements.forEach(x => x.remove());
            this._routeHighlight = null;
        }
        Object.values(this._elements.roadLayers).forEach(x => x.replaceChildren());
        Object.values(this._elements.userLayers).forEach(x => x.replaceChildren());
        for (const ent of Array.from(this._ents.values()).filter(x => x.gc)) {
            this.removeEntity(ent);
        }
        this._elements.paths.renderers.length = 0;
        this._elements.roadDefs.replaceChildren();
        this._elements.pins.replaceChildren();
        this._elements.pathLayersGroup.classList.toggle('rotated-coordinates', !!this.rotateCoordinates);
        this._setPathsViewBox(viewBox);
        this._setHeading(0);
        this._pendingEntityUpdates.clear();
    }

    _setPathsViewBox([x, y, width, height]) {
        this._foo = (this._foo || 0) + 1;
        if (this._foo < 5) {
            console.warn("set viewbox");
            this._elements.paths.setAttribute('viewBox', [x, y, width, height].join(' '));
        }
        const scale = this.worldMeta.svgScale || 1;
        const offset = this.worldMeta.svgOffset || [0, 0];
        for (const x of this._elements.paths.renderers) {
            if (!x.el.isConnected) {
                continue;
            }
            x(scale, offset);
        }
    }

    setWatching(id) {
        if (this.watchingId != null && this._ents.has(this.watchingId)) {
            const ent = this._ents.get(this.watchingId);
            ent.el.classList.remove('watching');
        }
        this.watchingId = id;
        if (id != null && this._ents.has(id)) {
            const ent = this._ents.get(id);
            ent.el.classList.add('watching');
        }
        this.setDragOffset([0, 0]);
    }

    setAthlete(id) {
        if (this.athleteId != null && this._ents.has(this.athleteId)) {
            const ent = this._ents.get(this.athleteId);
            ent.el.classList.remove('self');
        }
        this.athleteId = id;
        if (id != null && this._ents.has(id)) {
            const ent = this._ents.get(id);
            ent.el.classList.add('self');
        }
    }

    _rotateWorldPos(pos) {
        // Use sparingly;  If working with large groups of entities rotate the group instead.
        return this.rotateCoordinates ? [pos[1], -pos[0], pos[2]] : pos;
    }

    _unrotateWorldPos(pos) {
        // Use sparingly;  If working with large groups of entities rotate the group instead.
        return this.rotateCoordinates ? [-pos[1], pos[0], pos[2]] : pos;
    }

    _createCurvePath(points, loop, type='Fitted', options) {
        const curveFunc = {
            Line: curves.linePath,
            Fitted: curves.fittedPath,
            CatmullRom: curves.catmullRomPath,
            Bezier: curves.cubicBezierPath,

        }[type];
        return curveFunc(points, {loop, ...options});
    }

    _renderRoadsCanvas(roads) {
        // Because roads overlap and we want to style some of them differently this
        // make multi-sport roads higher so we don't randomly style overlapping sections.
        roads = Array.from(roads);
        roads.sort((a, b) => a.sports.length - b.sports.length);
        const paths = [];
        const etagAdd = common.makeCRC32('number');
        etagAdd(this.courseId);
        for (const road of roads) {
            if ((!road.sports.includes('cycling') && !road.sports.includes('running')) || !road.isAvailable) {
                continue;
            }
            etagAdd(road.id);
            const key = `${this.courseId}-${road.id}`;
            let path = this._roadPathsCache.get(key);
            if (!path || true) {
                const scale = this.worldMeta?.svgScale || 1;
                const offset = this.worldMeta?.svgOffset || [0, 0];
                path = road.curvePath.toCanvasPath({scale, offset});
                this._roadPathsCache.set(key, path);
                //console.info("MISS", key);
            }
            let color;
            if (road.sports[0] === 'running' && road.sports.length === 1) {
                color = this.pathStyle.roadRunning.color;
            } else {
                color = this.pathStyle.roadSurface.color;
            }
            paths.push({path, color});
        }
        const {mapCanvas, pathCanvas} = this._elements;
        // XXX I'd like to get mapCanvas.width statically from worldList.
        // This will make background updates non async as well since we won't need
        // to wait for the network image load to know our foundational size.
        const m = this.worldMeta;
        const surfaceWidth = mapCanvas.width * this._layerScale;
        const surfaceHeight = mapCanvas.height * this._layerScale;
        const pixelBudget = this._canvasPixelBudget;
        const pixelRequest = surfaceWidth * surfaceHeight;
        const clipOffset = [0, 0];
        let width = surfaceWidth;
        let height = surfaceHeight;
        if (pixelRequest > pixelBudget) {
            const budgetScale = Math.sqrt(pixelBudget / pixelRequest);
            width = surfaceWidth * budgetScale | 0;
            height = surfaceHeight * budgetScale | 0;
            const mapLayerScale = 1 / (m.tileScale / m.mapScale / this._canvasScale) * this._layerScale;
            const centerX = (this._centerXY[0] - this._dragXY[0] - this._anchorXY[0]) * mapLayerScale;
            const centerY = (this._centerXY[1] - this._dragXY[1] - this._anchorXY[1]) * mapLayerScale;
            clipOffset[0] = (((surfaceWidth - width) * (centerX / surfaceWidth)) / 50 | 0) * 50;
            clipOffset[1] = (((surfaceHeight - height) * (centerY / surfaceHeight)) / 50 | 0) * 50;
        }
        const scale = m.mapScale * this._canvasScale / m.tileScale * this._layerScale;
        const offset = [
            (m.minX + m.anchorX + (clipOffset[0] / scale)) * (this.worldMeta?.svgScale || 1),
            (m.minY + m.anchorY + (clipOffset[1] / scale)) * (this.worldMeta?.svgScale || 1)
        ];
        etagAdd(scale);
        etagAdd(width);
        etagAdd(height);
        etagAdd(offset[0]);
        etagAdd(offset[1]);
        const etag = etagAdd();
        if (etag === this._lastRenderRoadsCanvasEtag && false) {
            return;
        } else {
            //console.log(m.mapScale, this._canvasScale, m.tileScale, this._layerScale);
            //console.log({scale, width, height}, offset[0], offset[1], ...clipOffset);
            //console.count("DOOOOOO rnd");
        }
        this._lastRenderRoadsCanvasEtag = etag;

        const ctx = pathCanvas.getContext('2d');
        pathCanvas.style.setProperty('transform', `translate(${clipOffset[0]}px, ${clipOffset[1]}px)`);
        // Use clearRect (lighter impact) when possible..
        if (pathCanvas.width !== width || pathCanvas.height !== height) {
            pathCanvas.width = width;
            pathCanvas.height = height;
        } else {
            ctx.clearRect(0, 0, pathCanvas.width, pathCanvas.height);
        }
        ctx.save();
        try {
            //ctx.scale(scale, scale);
            //console.count("draw");
            if (this.courseId < 0) { 
                const config = this._getRealWorldTileConfig(this.zoom);
                const scale = config.size / (this.worldMeta.svgScale / config.scale);
                ctx.scale(scale, scale);
            } else {
                ctx.scale(scale, scale);
            }
            ctx.translate(-offset[0], -offset[1]);
            if (this.rotateCoordinates) {
                ctx.rotate(-90 * Math.PI / 180);
            }
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = this.pathStyle.roadGutter.color;
            ctx.lineWidth = 3200;
            for (const {path} of paths) {
                ctx.stroke(path);
            }
            ctx.lineWidth = 2200;
            for (const {path, color} of paths) {
                ctx.strokeStyle = color;
                ctx.stroke(path);
            }
        } finally {
            ctx.restore();
        }
        if (this.roadId != null) {
            this.setActiveRoad(this.roadId);
        }
    }

    _renderRoads() {
        const roads = Array.from(this._roads);
        roads.sort((a, b) => a.sports.length - b.sports.length);
        this._renderRoadsCanvas(roads);
        return;
        const {surfacesLow, gutters} = this._elements.roadLayers;
        // Because roads overlap and we want to style some of them differently this
        // makes multi-sport roads higher so we don't randomly style overlapping sections.
        const scale = this.worldMeta?.svgScale || 1;
        const offset = this.worldMeta?.svgOffset || [0, 0];
        for (const road of roads) {
            if ((!road.sports.includes('cycling') && !road.sports.includes('running')) || !road.isAvailable) {
                continue;
            }
            const path = createElementSVG('path', {id: `road-path-${road.id}`});
            const cache = new LRUCache(100);
            const render = (scale, offset) => {
                const key = '' + scale + offset.join();
                let d = cache.get(key);
                if (!d) {
                    console.debug("'rnede roadmiss", key);
                    d = road.curvePath.toSVGPath({scale, offset});
                    cache.set(key, d);
                }
                path.setAttribute('d', d);
            };
            render(scale, offset);
            this._elements.roadDefs.append(path);
            render.el = path;
            this._elements.paths.renderers.push(render);
            for (const g of [gutters, surfacesLow]) {
                g.append(createElementSVG('use', {
                    "class": 'road ' + road.sports.map(x => `sport-${x}`).join(' '),
                    "data-id": road.id,
                    "href": `#road-path-${road.id}`,
                }));
            }
        }
        if (this.roadId != null) {
            this.setActiveRoad(this.roadId);
        }
    }

    latlngToPosition([lat, lng]) {
        if (this.courseId >= 0) {
            return this.worldMeta.flippedHack ? [
                (lat - this.worldMeta.latOffset) * this.worldMeta.latDegDist * 100,
                (lng - this.worldMeta.lonOffset) * this.worldMeta.lonDegDist * 100
            ] : [
                (lng - this.worldMeta.lonOffset) * this.worldMeta.lonDegDist * 100,
                -(lat - this.worldMeta.latOffset) * this.worldMeta.latDegDist * 100
            ];
        } else {
            return this.webMercatorProjection([lat, lng]);
        }
    }

    positionToLatLng([x, y]) {
        debugger;
        return this.worldMeta.flippedHack ? [
            (x / (this.worldMeta.latDegDist * 100)) + this.worldMeta.latOffset,
            (y / (this.worldMeta.lonDegDist * 100)) + this.worldMeta.lonOffset
        ] : [
            -(y / (this.worldMeta.latDegDist * 100)) + this.worldMeta.latOffset,
            (x / (this.worldMeta.lonDegDist * 100)) + this.worldMeta.lonOffset
        ];
    }

    setRoad(id) {
        console.warn("DEPRECATED: use setActiveRoad");
        return this.setActiveRoad(id);
    }

    setActiveRoad(id) {
        return;
        this.roadId = id;
        this.routeId = null;
        this.route = null;
        if (this._routeHighlight) {
            this._routeHighlight.elements.forEach(x => x.remove());
            this._routeHighlight = null;
        }
        const surface = this._elements.roadLayers.surfacesMid;
        let r = surface.querySelector('.road.active');
        if (!r) {
            r = createElementSVG('use', {class: 'road active'});
            surface.append(r);
        }
        r.setAttribute('href', `#road-path-${id}`);
    }

    setActiveRoute = common.asyncSerialize(async function(id, laps=1) {
        this.roadId = null;
        this.routeId = id;
        const activeRoad = this._elements.roadLayers.surfacesMid.querySelector('.road.active');
        if (activeRoad) {
            activeRoad.remove();
        }
        const route = await common.getRoute(id);
        if (this._routeHighlight) {
            this._routeHighlight.elements.forEach(x => x.remove());
            this._routeHighlight = null;
        }
        if (route) {
            this._routeHighlight = this.addHighlightPath(route.curvePath, 'route-' + id, {layer: 'mid'});
        } else {
            console.warn("Route not found:", id);
        }
        this.route = route;
        return route;
    });

    _addShape(shape, attrs, options={}) {
        const layer = this._elements.userLayers[{
            high: 'surfacesHigh',
            mid: 'surfacesMid',
            low: 'surfacesLow',
        }[options.layer || 'high']];
        const el = createElementSVG(shape, attrs);
        layer.append(el);
        return el;
    }

    drawLine(p0, p1, {color="#000a", size=2, layer='high', scale=1, ...attrs}={}) {
        return this._addShape('line', {
            x1: p0[0] * scale,
            y1: p0[1] * scale,
            x2: p1[0] * scale,
            y2: p1[1] * scale,
            "stroke-width": `${size}em`,
            stroke: color,
            ...attrs,
        });
    }

    drawCircle(c, {color="#000a", size=10, borderColor="gold", borderSize=0.5, layer='high', ...attrs}={}) {
        const scale = this.worldMeta?.svgScale || 1;
        return this._addShape('circle', {
            cx: c[0] * scale,
            cy: c[1] * scale,
            r: `${size}em`,
            fill: color,
            "stroke-width": `${borderSize}em`,
            stroke: borderColor,
            ...attrs,
        });
    }

    addHighlightPath(path, id, {debug, includeEdges=true, extraClass='', width, color, layer='mid'}={}) {
        const elements = [];
        if (debug) {
            const nodes = path.nodes;
            for (let i = 0; i < nodes.length; i++) {
                elements.push(this.drawCircle(nodes[i].end, {
                    color: '#40ba',
                    borderColor: 'black',
                    size: 4,
                    title: i
                }));
                if (nodes[i].cp1) {
                    if (i) {
                        const title = `cp1-${i}`;
                        elements.push(this.drawLine(nodes[i].cp1, nodes[i - 1].end, {layer, title}));
                        elements.push(this.drawCircle(nodes[i].cp1, {color: '#000b', size: 3, title}));
                    }
                    const title = `cp2-${i}`;
                    elements.push(this.drawLine(nodes[i].cp2, nodes[i].end, {layer, title}));
                    elements.push(this.drawCircle(nodes[i].cp2, {color: '#fffb', size: 3, title}));
                }
            }
            if (nodes.length) {
                elements.push(this.drawCircle(nodes[0].end, {color: '#0f09', size: 8, title: 'start'}));
                elements.push(this.drawCircle(nodes.at(-1).end, {color: '#f009', size: 8, title: 'end'}));
            }
        }
        const scale = this.worldMeta?.svgScale || 1;
        const offset = this.worldMeta?.svgOffset || [0, 0];
        const node = createElementSVG('path', {
            class: `highlight ${extraClass}`,
            "data-id": id,
        });
        const cache = new LRUCache(100);
        const render = (scale, offset) => {
            const key = '' + scale + offset.join();
            let d = cache.get(key);
            if (!d) {
                console.debug('addhlpath miss', key);
                d = path.toSVGPath({includeEdges, scale, offset});
                cache.set(key, d);
            } else {
                console.count('hit');
            }
            node.setAttribute('d', d);
        };
        render(scale, offset);
        render.el = node;
        this._elements.paths.renderers.push(render);
        if (width) {
            node.style.setProperty('--width', width);
        }
        if (color) {
            node.style.setProperty('stroke', color);
        }
        const surfaceEl = this._elements.userLayers[{
            high: 'surfacesHigh',
            mid: 'surfacesMid',
            low: 'surfacesLow',
        }[layer]];
        surfaceEl.append(node);
        elements.push(node);
        return {id, node, elements};
    }

    addHighlightLine(points, id, options={}) {
        return this.addHighlightPath(this._createCurvePath(points, options.loop), id, options);
    }

    addPoint(point, extraClass) {
        if (!this._pointIdSeq) {
            this._pointIdSeq = 1;
        }
        const ent = new MapEntity(`${point[0]}-${point[1]}-${this._pointIdSeq++}`, 'point');
        ent.transition.setDuration(0);
        ent.setPosition(point);
        if (extraClass) {
            ent.el.classList.add(extraClass);
        }
        this.addEntity(ent);
        return ent;
    }

    addEntity(ent) {
        if (!(ent instanceof MapEntity)) {
            throw new TypeError("MapEntity argument required");
        }
        if (this._ents.has(ent.id)) {
            throw new Error("id already in use");
        }
        ent.setMap(this);
        this._ents.set(ent.id, ent);
        this._pendingEntityUpdates.add(ent);
        ent.addEventListener('position', () => this._pendingEntityUpdates.add(ent));
    }

    getEntity(id) {
        return this._ents.get(id);
    }

    removeEntity(ent) {
        this._ents.delete(ent.id);
        this._pinned.delete(ent);
        this._pendingEntityUpdates.delete(ent);
        ent.togglePin(false);
        ent.el.remove();
    }

    _addAthleteEntity(state) {
        const ent = new MapAthlete(state.athleteId);
        ent.lastSeen = 0;
        ent.gc = true;
        ent.delayEst = common.expWeightedAvg(6, 2000);
        ent.el.classList.toggle('self', state.athleteId === this.athleteId);
        ent.el.classList.toggle('watching', state.athleteId === this.watchingId);
        ent.setMap(this);
        ent.addEventListener('pinned', ev => {
            if (ev.visible) {
                this._pinned.add(ent);
                this._elements.pins.append(ent.pin);
                this._pendingEntityUpdates.add(ent);
            } else {
                this._pinned.delete(ent);
            }
        });
        this._ents.set(ent.id, ent);
    }

    _onEntsClick(ev) {
        const entEl = ev.target.closest('.entity');
        if (!entEl) {
            return;
        }
        const id = entEl.dataset.idType === 'number' ? Number(entEl.dataset.id) : entEl.dataset.id;
        const ent = this._ents.get(id);
        if (!ent) {
            return;
        }
        ent.togglePin();
    }

    renderAthleteStates = common.asyncSerialize(async states => {
        if (this.watchingId == null || !common.isVisible()) {
            return;
        }
        const watching = states.find(x => x.athleteId === this.watchingId);
        if (!watching && this.courseId == null) {
            return;
        } else if (watching) {
            if (watching.portal) {
                if (!this.portal || watching.roadId !== this.roadId || watching.courseId !== this.courseId) {
                    await this.setCourse(watching.courseId, {portalRoad: watching.roadId});
                }
            } else if (this.portal || watching.courseId !== this.courseId) {
                await this.setCourse(watching.courseId);
            }
            if (this.preferRoute) {
                if (watching.routeId) {
                    if (this.routeId !== watching.routeId) {
                        let sg;
                        if (watching.eventSubgroupId) {
                            sg = await common.rpc.getEventSubgroup(watching.eventSubgroupId);
                        }
                        // Note sg.routeId is sometimes out of sync with state.routeId; avoid thrash
                        if (sg && sg.routeId === watching.routeId) {
                            await this.setActiveRoute(sg.routeId, sg.laps);
                        } else {
                            await this.setActiveRoute(watching.routeId);
                        }
                    }
                } else {
                    this.route = null;
                    this.routeId = null;
                }
            }
            if (!this.routeId && watching.roadId !== this.roadId) {
                this.setActiveRoad(watching.roadId);
            }
        }
        const now = Date.now();
        const lowPrioAthleteUpdates = [];
        const highPrioAthleteUpdates = [];
        for (const state of states) {
            if (state.courseId !== this.courseId) {
                continue;
            }
            if (!this._ents.has(state.athleteId)) {
                this._addAthleteEntity(state);
            }
            let powerLevel;
            if (state.power < 200) {
                powerLevel = 'z1';
            } else if (state.power < 250) {
                powerLevel = 'z2';
            } else if (state.power < 300) {
                powerLevel = 'z3';
            } else if (state.power < 450) {
                powerLevel = 'z4';
            } else if (state.power < 600) {
                powerLevel = 'z5';
            } else {
                powerLevel = 'z6';
            }
            const ent = this._ents.get(state.athleteId);
            if (ent && ent.pin) {
                highPrioAthleteUpdates.push(state.athleteId);
            } else {
                lowPrioAthleteUpdates.push(state.athleteId);
            }
            const age = now - ent.lastSeen;
            if (age) {
                if (age < 2500) {
                    // Try to animate close to the update rate without going under.
                    // If we miss (transition is not playing) prefer lag over jank.
                    // Note the lag is calibrated to reducing jumping at 200ms rates (i.e. watching).
                    const influence = ent.transition.playing ? age + 100 : age * 8;
                    const duration = ent.delayEst(influence);
                    ent.transition.setDuration(duration);
                } else {
                    ent.transition.setDuration(0);
                }
            }
            ent.setPosition([state.x, state.y]);
            ent.el.dataset.powerLevel = powerLevel;
            ent.lastSeen = now;
            ent.setPlayerState(state);
            if (state.athleteId === this.watchingId && !this.trackingPaused) {
                this._autoHeadingSaved = state.heading || 0;
                if (this.autoHeading) {
                    this._setHeading(this._autoHeadingSaved);
                }
                this._autoCenterSaved = [state.x, state.y];
                if (this.autoCenter) {
                    this._setCenter(this._autoCenterSaved);
                }
                if (this.autoCenter || this.autoHeading) {
                    this._updateGlobalTransform();
                }
            }
            this._pendingEntityUpdates.add(ent);
        }
        common.idle().then(() => {
            this._updateAthleteDetails(lowPrioAthleteUpdates, {maxAge: 300000});
            this._updateAthleteDetails(highPrioAthleteUpdates, {maxAge: 2000});
        });
    });

    setHeadingOffset(heading) {
        this.headingOffset = heading;
        this.setHeading(this.heading);
    }

    setHeading(heading) {
        this._setHeading(heading);
        this._fullUpdateAsNeeded();
    }

    _setHeading(heading) {
        if (Math.abs(this.heading - heading) > 180) {
            this._headingRotations += Math.sign(this.heading - heading);
        }
        const mapAdj = (this.rotateCoordinates || this.courseId < 0) ? 0 : -90;
        this._adjHeading = heading + this._headingRotations * 360 + mapAdj;
        this.heading = heading;
    }

    setCenter(pos) {
        this._setCenter(pos);
        this._fullUpdateAsNeeded();
    }

    _setCenter(pos) {
        this.center = pos;
        this._centerXY = this._rotateWorldPos(pos);
        this._renderRoads();
    }

    async _gcLoop() {
        await common.idle({timeout: 1000});
        setTimeout(() => this._gcLoop(), 10000);
        const now = Date.now();
        for (const ent of this._ents.values()) {
            if (ent.gc && now - ent.lastSeen > 15000) {
                this.removeEntity(ent);
            }
        }
    }

    _getRealWorldTileConfig(mapZoom) {
        const etagAdd = common.makeCRC32('number');
        const normal = 14;
        const size = 256;  // Based on params used in getIRLMapTileImage
        const zoomFactor = Math.max(-normal, Math.min(22 - normal, Math.round(Math.log2(mapZoom))));
        const zoom = normal + zoomFactor;
        const scale = 2 ** zoom;
        const cols = Math.ceil(this._elRect.width / size + 2);
        const rows = Math.ceil(this._elRect.height / size + 2);
        etagAdd(rows);
        etagAdd(cols);
        etagAdd(zoomFactor);
        const etag = etagAdd();
        return {cols, rows, scale, zoom, zoomFactor, size, etag};
    }

    _getRealWorldZoom(range, axis='width') {
        const normal = 14;
        const size = 256;  // Based on params used in getIRLMapTileImage
        const tiles = (axis === 'width' ? this._elRect.width : this._elRect.height) / size;
        const spanRange = range / tiles;
        const zoom = 2 ** (-Math.log2(spanRange) - normal);
        return zoom;
    }

    _updateRealWorldTiles(zoom) {
        const config = this._getRealWorldTileConfig(zoom);
        // XXX should be floor maybe?
        const ax = Math.round((this._centerXY[0] - this._dragXY[0]) * config.scale - config.cols / 2);
        const ay = Math.round((this._centerXY[1] - this._dragXY[1]) * config.scale - config.rows / 2);
        this._zoomScale = 2 ** config.zoomFactor;
        if (ax !== this._irlX || ay !== this._irlY || config.etag !== this._irlTilesEtag) {
            this._irlX = ax;
            this._irlY = ay;
            this._irlTilesEtag = config.etag;
            console.info("update real world tiles", {ax, ay, config});
            const m = this.worldMeta;
            m.mapScale = config.size * config.scale;
            m.svgScale = config.scale * 100000;
            m.svgOffset = [ax / config.scale * m.svgScale, ay / config.scale * m.svgScale];
            this._canvasScale = this._qualityToCanvasScale(this.quality);
            this._mapScale = 1 / (m.tileScale / m.mapScale / this._canvasScale);
            this._anchorXY = [ax / config.scale, ay / config.scale];
            this._setPathsViewBox([
                0, // ax / config.scale * m.svgScale,
                0, // ay / config.scale * m.svgScale,
                (config.cols) / config.scale * m.svgScale,
                (config.rows) / config.scale * m.svgScale,
            ]);
            this._drawRealWorldBackground(config);
            return true;
        }
    }

    _updateLayerScale(zoom, tiltAngle, force) {
        // This is a solution for 3 problems:
        // *0. Handling IRL map tile scaling.
        //  1. Blink will convert compositing layers to bitmaps using suboptimal
        //     resolutions during transitions, which we are always doing.  This
        //     makes all scaled elements look fuzzy and very low resolution.
        //  2. The GPU memory budget can explode when zooming out on large worlds
        //     like Watopia.  Mobile devices only have about 256MB (maybe less) of
        //     GPU memory to work with.  On Watopia, fully zoomed out, with the layer
        //     size being 8192x4096 will use about 1GB of memory if unscaled.  This
        //     causes the render pipeline to fail spectacularly and the page is broken.
        //  3. Performance because of #2 is pretty bad for large worlds when zoomed
        //     out.
        if (this.courseId < 0) {
            force = this._updateRealWorldTiles(zoom) || force;
        }
        if (!this._canvasScale) {
            return;
        }
        let quality = this.quality;
        if (tiltAngle) {
            // When zoomed in tiltShift can exploded the GPU budget if a lot of
            // landscape is visible.  We need an additional scale factor to prevent
            // users from having to constantly adjust quality.
            quality *= Math.min(1, 20 / Math.max(0, tiltAngle - 30));
        }
        const fineScale = zoom * quality / this._canvasScale / this._zoomScale;
        const scale = 2 ** Math.round(Math.log2(fineScale));
        if (this._layerScale !== scale || force) {
            console.debug("new layer scale", this._layerScale,
                          {force, scale, zoom, mapScale: this._mapScale, zoomscale: this._zoomScale});
            this._layerScale = scale;
            const {mapCanvas, map} = this._elements;
            mapCanvas.style.setProperty('width', `${mapCanvas.width * scale}px`);
            mapCanvas.style.setProperty('height', `${mapCanvas.height * scale}px`);
            //mapCanvas.classList.toggle('hidden', !!this.portal);
            map.style.setProperty('--layer-scale', scale * this._canvasScale);
            map.style.setProperty('--canvas-scale', this._canvasScale);
            map.style.setProperty('--scale-scale', scale);
            for (const x of this._ents.values()) {
                // force refresh of _all_ ents.
                this._pendingEntityUpdates.add(x);
            }
            this._renderRoads(); // if we can only be slow, maybe toggle based on sys perf?
        }
        //this._renderRoads(); // if we can make renderRoads super fast.
    }

    _updateGlobalTransform() {
        const x = this._centerXY[0] - this._dragXY[0];
        const y = this._centerXY[1] - this._dragXY[1];
        this.mapTransition.setValues([x, y, this._adjHeading + this.headingOffset]);
        this.viewTransition.setValues([this.zoom, this._tiltAngle, this.verticalOffset]);
    }

    _renderFrame(force) {
        const frameTime = document.timeline.currentTime;
        this._frameTimeAvg = this._frameTimeWeighted(frameTime - this._lastFrameTime);
        this._lastFrameTime = frameTime;
        let affectedPins;
        const nextRenderSig = `${this.mapTransition.nextId}-${this.viewTransition.nextId}`;
        if (this._nextRenderSig !== nextRenderSig || force) {
            const mapStep = this.mapTransition.getStep();
            const viewStep = this.viewTransition.getStep();
            if (mapStep.length && viewStep.length) {
                this._nextRenderSig = nextRenderSig;
                let [x, y, rotate] = mapStep;
                const [zoom, tiltAngle, vertOffset] = viewStep;
                this._updateLayerScale(zoom, tiltAngle, force);
                const mapLayerScale = this._mapScale * this._layerScale;
                x = (x - this._anchorXY[0]) * mapLayerScale;
                y = (y - this._anchorXY[1]) * mapLayerScale;
                const scale = zoom / this._zoomScale / this._layerScale / this._canvasScale;
                this._rotate = rotate;
                if (this._lastScale !== scale) {
                    this._lastScale = scale;
                    this._elements.map.style.setProperty('--scale', scale * this._layerScale);
                }
                this._elements.map.style.setProperty('transform-origin', `${x}px ${y}px`);
                this._elements.map.style.setProperty('transform', `
                    translate(${-x}px, ${-y}px)
                    scale(${scale})
                    ${tiltAngle ? `perspective(${this._perspective / scale}px) rotateX(${tiltAngle}deg)` : ''}
                    ${vertOffset ? `translate(0, ${vertOffset * this._elRect.height / scale}px)` : ''}
                    rotate(${rotate}deg)
                `);
                affectedPins = new Set(this._pinned);
            }
        }
        if (!affectedPins) {
            affectedPins = new Set();
        }
        if (this._pendingEntityUpdates.size) {
            const mapLayerScale = this._mapScale * this._layerScale;
            for (const ent of this._pendingEntityUpdates) {
                const pos = ent.transition.getStep();
                if (pos) {
                    const x = (pos[0] - this._anchorXY[0] * 1) * mapLayerScale;
                    const y = (pos[1] - this._anchorXY[1] * 1) * mapLayerScale;
                    ent.el.style.setProperty('transform', `translate(${x}px, ${y}px)`);
                    if (ent.pin) {
                        affectedPins.add(ent);
                    }
                }
                if (ent.new) {
                    this._elements.ents.append(ent.el);
                    ent.new = false;
                }
                if (!ent.transition.playing) {
                    this._pendingEntityUpdates.delete(ent);
                }
            }
        }
        if (affectedPins.size) {
            // Avoid spurious reflow with batched reads followed by writes.
            const xOfft = -this._elRect.left;
            const yOfft = -this._elRect.top;
            const batch = [];
            for (const x of affectedPins) {
                batch.push([x, x.el.getBoundingClientRect()]);
            }
            for (let i = 0; i < batch.length; i++) {
                const [ent, rect] = batch[i];
                ent.pin.style.setProperty('transform', `translate(${rect.x + rect.width / 2 + xOfft}px,
                                                                  ${rect.y + yOfft}px)`);
            }
        }
    }

    _transformAnimationLoop(frameTime) {
        requestAnimationFrame(this._transformAnimationLoopBound);
        const elapsed = frameTime - this._lastFrameTime;
        if (elapsed < this._msPerFrame && this._frameTimeAvg < this._msPerFrame) {
            return;
        }
        this._renderFrame();
    }

    _updateEntityAthleteData(ent, ad) {
        const leader = !!ad.eventLeader;
        const sweeper = !!ad.eventSweeper;
        const marked = !!ad.athlete?.marked;
        const following = !!ad.athlete?.following;
        const bot = ad.athlete?.type === 'PACER_BOT';
        if (bot !== ent.bot) {
            ent.el.classList.toggle('bot', bot);
            ent.bot = bot;
        }
        if (leader !== ent.leader) {
            ent.el.classList.toggle('leader', leader);
            ent.leader = leader;
        }
        if (sweeper !== ent.sweeper) {
            ent.el.classList.toggle('sweeper', sweeper);
            ent.sweeper = sweeper;
        }
        if (marked !== ent.marked) {
            ent.el.classList.toggle('marked', marked);
            ent.marked = marked;
        }
        if (following !== ent.following) {
            ent.el.classList.toggle('following', following);
            ent.following = following;
        }
    }

    async _updateAthleteDetails(ids, options) {
        const ads = await common.getAthletesDataCached(ids, options);
        for (const ad of ads) {
            const ent = this._ents.get(ad?.athleteId);
            if (ent && ad) {
                this._updateEntityAthleteData(ent, ad);
            }
        }
    }
}
