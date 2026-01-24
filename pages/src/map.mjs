/* global DOMMatrixReadOnly, devicePixelRatio, OffscreenCanvas */
import * as common from './common.mjs';
import * as curves from '/shared/curves.mjs';
import * as locale from '/shared/sauce/locale.mjs';

const H = locale.human;
const timeline = document.timeline;
const isDebug = new URLSearchParams(window.location.search).has('debug');
const radDegF = 180 / Math.PI;
const identMatrix = new DOMMatrixReadOnly();


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


function normalizePoint(p) {
    if (p.w < 1e-6) {
        // Falling off the frustrum... (it's not visible, and thus invalid)
        return undefined;
    } else {
        return {
            x: p.x / p.w,
            y: p.y / p.w,
            z: p.z / p.w
        };
    }
}


async function loadImage(img, src) {
    img.fetchPriority = 'high';
    img.decoding = 'async';
    img.src = src;
    // Perform absolutely CRITICAL image decode.  Without this the rendering pipeline
    // is subject to jank for the lifetime of the image (chromium and firefox).
    await img.decode();
    return img;
}


class Transition {

    FILL_EPSILON = 1e-5;

    constructor({duration=1000}={}) {
        this.duration = duration;
        this.disabled = false;
        this._src = undefined;
        this._cur = [];
        this._dst = undefined;
        this._startTime = 0;
        this._endTime = 0;
        this._progressFactor = 0;
        this._disabledRefCnt = 0;
        this.disabled = false;
        this.playing = false;
    }

    incDisabled() {
        this._disabledRefCnt++;
        if (this._disabledRefCnt === 1) {
            this.disabled = true;
            this.playing = false;
            this._dst = this._cur.slice();
            this._startTime = this._endTime = 0;
            this._progressFactor = Infinity;
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
        if (this.playing) {
            // Prevent jitter by forwarding the current transition.
            this._src = this._cur.slice();
            this._startTime = timeline.currentTime;
            this._endTime += duration - this.duration;
            this._progressFactor = 1 / (this._endTime - this._startTime);
        }
        this.duration = duration;
    }

    setValues(values) {
        if (!this.disabled && this._dst) {
            // Can animate...
            const frameTime = timeline.currentTime;
            if (frameTime < this._endTime) {
                // Start from current position
                this._recalcCurrent(frameTime);
                this._src = new Array(this._cur.length);
                for (let i = 0; i < this._cur.length; i++) {
                    if (values[i] === this._dst[i] &&
                        Math.abs(values[i] - this._cur[i]) < this.FILL_EPSILON) {
                        // Snap to given values when close to avoid zeno's paradox
                        this._src[i] = values[i];
                    } else {
                        this._src[i] = this._cur[i];
                    }
                }
            } else {
                // Start from last position.
                this._src = this._dst;
            }
            this._startTime = frameTime;
            this._endTime = frameTime + this.duration;
            this._progressFactor = 1 / this.duration;
            this.playing = true;
        } else {
            this._cur = values.slice();
        }
        this._dst = values.slice();
    }

    getStep(_frameTime=timeline.currentTime) {
        if (this.playing) {
            this._recalcCurrent(_frameTime);
            return this._cur;
        } else if (this.disabled) {
            return this._cur;
        } else {
            return this._dst;
        }
    }

    getCurrent() {
        if (this.playing || this.disabled) {
            return this._cur;
        } else {
            return this._dst;
        }
    }

    getValues() {
        return this._dst ? this._dst.slice() : null;
    }

    _recalcCurrent(frameTime) {
        const progress = (frameTime - this._startTime) * this._progressFactor;
        if (progress >= 1) {
            this.playing = false;
            if (this._dst) {
                this._cur = this._dst;
            }
        } else {
            for (let i = 0; i < this._dst.length; i++) {
                this._cur[i] = this._src[i] + (this._dst[i] - this._src[i]) * progress;
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
            this.pin.new = true;
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

    setPosition(pos) {
        if (typeof pos[0] !== 'number' || typeof pos[1] !== 'number') {
            throw new TypeError('invalid position');
        }
        this._position = pos; // Save non-rotate-hacked position.
        if (this._map?.rotateCoordinates) {
            pos = [pos[1], -pos[0]];
        }
        this.transition.setValues(pos);
        // XXX might be redundant
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

    togglePin(en, {hard}={}) {
        if (en == null) {
            en = !this.pin;
        }
        if (hard) {
            this._hardPin = en;
        } else if (hard === false && this.pin && this._hardPin && !en) {
            // Ignore hide action when we are hard pinned
            return true;
        }
        if (!en && this._pinHTML) {
            this._pinHTML = null;
        }
        return super.togglePin(en);
    }

    getPinHeaderHTML() {
        const ad = common.getAthleteDataCacheEntry(this.id, {maxAge: Infinity});
        const athlete = ad?.athlete;
        let name;
        if (athlete) {
            name = `${athlete.fLast}`;
        } else if (this.chats.length) {
            const c = this.chats[0][0];
            name = `${c.firstName[0]}.${c.lastName}`;
        } else {
            name = `ID: ${this.id}`;
        }
        const avatar = athlete?.avatar ?
            `<avatar-pad></avatar-pad><img class="avatar" src="${athlete.avatar}"/>` : '';
        return `<a class="name" href="/pages/profile.html?id=${this.id}&windowType=profile"
                   target="profile_popup_${this.id}">${common.sanitize(name)}${avatar}</a>`;
    }

    getPinHTML() {
        if (this._pinHTML) {
            return this._pinHTML;
        }
        const html = [];
        const state = this._state;
        if (state) {
            html.push(this.getPinHeaderHTML());
            if (this._hardPin) {
                html.push(`<br/>${H.power(state.power, {suffix: true, html: true})}`);
                if (state.heartrate) {
                    html.push(`, ${H.number(state.heartrate, {suffix: 'bpm', html: true})}`);
                }
                html.push(`, ${H.pace(state.speed, {suffix: true, html: true, sport: state.sport})}`);
                const ad = common.getAthleteDataCacheEntry(this.id, {maxAge: Infinity});
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

    setCategory(cat) {
        if (cat !== this._category) {
            if (cat) {
                this.el.dataset.category = cat;
            } else {
                delete this.el.dataset.category;
            }
            this._category = cat;
        }
    }

    addChatMessage(chat) {
        const expires = 15000;
        this.chats.push([chat, Date.now() + expires]);
        if (this.pin) {
            this.renderPinHTML(this.getPinHTML());
        } else {
            this.togglePin(true);
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


function getSubgroupLazy(id) {
    const sg = common.getEventSubgroup(id);
    if (!sg || sg instanceof Promise) {
        return null;
    }
    return sg;
}


const MapTransitionStepEnum = {
    x: 0,
    y: 1,
    zoom: 2,
    tiltAngle: 3,
    verticalOffset: 4,
    heading: 5,
};


export class SauceZwiftMap extends EventTarget {

    constructor({el, worldList, zoom=1, zoomMin=0.05, zoomMax=10, autoHeading=true,
                 style='default', opacity=1, tiltShift=null, maxTiltShiftAngle=65,
                 sparkle=false, quality=0.5, verticalOffset=0, fpsLimit=30,
                 zoomPriorityTilt=true, preferRoute, autoCenter=true}) {
        super();
        // Order matters, find appropriate section before altering.
        // Start with pure internal state..
        this.el = el;
        this.worldList = worldList;
        this.preferRoute = preferRoute;
        this.zoomMin = zoomMin;
        this.zoomMax = zoomMax;
        this.autoHeading = autoHeading;
        this.autoCenter = autoCenter;
        this.maxTiltShiftAngle = maxTiltShiftAngle;
        this.verticalOffset = verticalOffset;
        this.watchingId = null;
        this.athleteId = null;
        this.courseId = null;
        this.portal = null;
        this.roadId = null;
        this.routeId = null;
        this.route = null;
        this._roadsById = new Map();
        this._pathHighlights = [];
        this._segmentElsById = new Map();
        this.worldMeta = null;
        this.rotateCoordinates = null;
        this.style = style;
        this._headingRotations = 0;
        this._heading = 0;
        this.headingOffset = 0;
        this._ents = new Map();
        this._renderingEnts = [];
        this._pinnedEnts = [];
        this.center = [0, 0];
        this._centerXY = [0, 0];
        this._anchorXY = [0, 0];
        this.dragOffset = [0, 0];
        this._dragXY = [0, 0];
        this._pauseRefCnt = 1;
        this._pauseTrackingRefCnt = 0;
        this._layerScale = zoom || 1;
        this._mapTileScale = null;
        this._lastFrameTime = 0;
        this._frameTimeAvg = 0;
        this._frameTimeWeighted = common.expWeightedAvg(30, 1000 / 60);
        this._nativeFrameTime = 1000 / 60;
        this._perspective = 1200;
        this._wheelState = {};
        this._pointerState = {};
        this._renderCallbacks = [];
        this._renderCallbacksSwap = [];
        this._renderLoopActive = false;
        this._mapTransition = new Transition({duration: 500});
        this._activeTransform = null;
        this._renderLoopBound = this._renderLoop.bind(this);
        this._rafForRenderLoopBound = requestAnimationFrame.bind(window, this._renderLoopBound);
        this._scaleUpCooldown = 0;
        this._pendingAthleteUpdates = new Set();
        this._setQuality(quality);
        this._setZoom(zoom);
        this._setTiltShift(tiltShift);
        this._setZoomPriorityTilt(zoomPriorityTilt);
        this._setFPSLimit(fpsLimit);

        // Build DOM and apply initial styles - still unattached..
        this._elements = {
            map: createElement('div', {class: 'sauce-map'}),
            mapBackground: createElement('img', {class: 'map-background'}),
            ents: createElement('div', {class: 'entities'}),
            pins: createElement('div', {class: 'pins'}),
            paths: createElementSVG('svg', {class: 'paths'}),
            shapeDefs: createElementSVG('defs'),
            roadDefs: createElementSVG('defs'),
            pathLayersGroup: createElementSVG('g', {class: 'path-layers'}),
            intLayers: {
                shadows: createElementSVG('g', {class: 'internal-layer shadows'}),
                gutters: createElementSVG('g', {class: 'internal-layer gutters'}),
                low: createElementSVG('g', {class: 'internal-layer low'}),
                mid: createElementSVG('g', {class: 'internal-layer mid'}),
                high: createElementSVG('g', {class: 'internal-layer high'}),
            },
            userLayers: {
                low: createElementSVG('g', {class: 'user-layer low'}),
                mid: createElementSVG('g', {class: 'user-layer mid'}),
                high: createElementSVG('g', {class: 'user-layer high'}),
            }
        };
        this._elements.shapeDefs.innerHTML = `
            <pattern id="pattern-road-style-dirt" patternUnits="userSpaceOnUse" width="600" height="600">
                <image width="600" height="600" href="/pages/images/map/pattern-road-style-dirt.svg"/>
            </pattern>
            <pattern id="pattern-road-style-cobbles" patternUnits="userSpaceOnUse" width="2500" height="2500">
                <image width="2500" height="2500" href="/pages/images/map/pattern-road-style-cobbles.svg"/>
            </pattern>
            <pattern id="pattern-road-style-sand" patternUnits="userSpaceOnUse" width="500" height="500">
                <image width="500" height="500" href="/pages/images/map/pattern-road-style-sand.svg"/>
            </pattern>
            <pattern id="pattern-road-style-grass" patternUnits="userSpaceOnUse" width="1000" height="1000">
                <image width="1000" height="1000" href="/pages/images/map/pattern-road-style-grass.svg"/>
            </pattern>
            <pattern id="pattern-checkered" patternUnits="userSpaceOnUse" width="4" height="4">
                <image width="4" height="4" href="/pages/images/map/pattern-checkered.svg"/>
            </pattern>

            <filter x="-100%" y="-100%" width="300%" height="300%" in="StrokePaint" id="segment-shadow">
                <feDropShadow stdDeviation="150" flood-color="#000"/>
                <feDropShadow stdDeviation="600" flood-color="#0009"/>
            </filter>

            <path id="marker-chevron" d="M3,3 L9,10 L3,17" fill="none" stroke-width="4"
                  stroke-linecap="round" stroke-linejoin="round"/>
            <path id="marker-bar" d="M3,0 L3,20" fill="none" stroke-width="6" stroke-linecap="round"/>

            <marker class="segment-marker mid" id="segment-marker-chevron" viewBox="0 0 12 20"
                    refX="6" refY="10" orient="auto" markerWidth="1"
                    markerHeight="1"><use href="#marker-chevron"/></marker>
            <marker class="segment-marker mid active" id="segment-marker-chevron-active"
                    viewBox="0 0 12 20" refX="6" refY="10" orient="auto"
                    markerWidth="1" markerHeight="1"><use href="#marker-chevron"/></marker>

            <marker class="segment-marker start" id="segment-marker-bar-start"
                    viewBox="0 0 6 20" refX="0" refY="10" orient="auto"
                    markerWidth="1.5" markerHeight="1.62"><use href="#marker-bar"/></marker>
            <marker class="segment-marker start active" id="segment-marker-bar-start-active"
                    viewBox="0 0 6 20" refX="0" refY="10" orient="auto" markerWidth="1.5"
                    markerHeight="1.62"><use href="#marker-bar"/></marker>

            <marker class="segment-marker end" id="segment-marker-bar-end" viewBox="0 0 6 20"
                    refX="6" refY="10" orient="auto" markerWidth="1.5" markerHeight="1.62"
                    stroke="url(#pattern-checkered)"><use href="#marker-bar"/></marker>
            <marker class="segment-marker end active" id="segment-marker-bar-end-active"
                    viewBox="0 0 6 20" refX="6" refY="10" orient="auto" markerWidth="1.5"
                    markerHeight="1.62" stroke="url(#pattern-checkered)"><use href="#marker-bar"/></marker>
        `;
        this._elements.paths.append(this._elements.shapeDefs, this._elements.roadDefs,
                                    this._elements.pathLayersGroup);
        this._elements.pathLayersGroup.append(
            this._elements.intLayers.shadows,
            this._elements.intLayers.gutters,
            this._elements.intLayers.low,
            this._elements.userLayers.low,
            this._elements.intLayers.mid,
            this._elements.userLayers.mid,
            this._elements.intLayers.high,
            this._elements.userLayers.high);
        this._elements.map.append(this._elements.mapBackground, this._elements.paths, this._elements.ents);
        this.setSparkle(sparkle);
        this.setOpacity(opacity);

        // Attach DOM and apply parent element styles..
        this.el.classList.add('sauce-map-container');
        this.el.append(this._elements.map, this._elements.pins);
        this._updateContainerLayout();

        // Attach event listeners..
        this._resizeObserver = new ResizeObserver(this._updateContainerLayout.bind(this));
        this._resizeObserver.observe(this.el);
        this.el.addEventListener('wheel', this._onWheelZoom.bind(this), {passive: false /*mute warn*/});
        this.el.addEventListener('pointerdown', this._onPointerDown.bind(this));
        this._elements.ents.addEventListener('click', this._onEntsClick.bind(this));
        let handleScrollTimeout = null;
        addEventListener('scroll', ev => {
            if (!handleScrollTimeout) {
                handleScrollTimeout = setTimeout(() => {
                    handleScrollTimeout = null;
                    this._elRect = this.el.getBoundingClientRect();
                    this._renderFrame(/*force*/ true);
                }, this._msPerFrame);
            }
        }, {passive: true, capture: true});

        // Start misc calibration loops and garbage collector(s)..
        setTimeout(() => this._updateNativeFrameTime(), 1000);
        setInterval(() => this._updateNativeFrameTime(), 30_000);
        setInterval(() => this._drainPendingAthleteUpdates(), 2000);
        this._gcLoop();

        this._pauseRefCnt--;

        if (isDebug) {
            import('./fps.mjs').then(fps => {
                const measure = () => {
                    fps.measure();
                    this.requestRenderFrame(measure);
                };
                measure();
            });
        }
    }

    async _updateNativeFrameTime() {
        const fps = await common.testFrameRate();
        this._nativeFrameTime = 1000 / fps;
        this.setFPSLimit(this.fpsLimit);
    }

    _updateContainerLayout() {
        this._elRect = this.el.getBoundingClientRect();
        this._maybeUpdateAndRender();
    }

    setFPSLimit(fps) {
        this._setFPSLimit(fps);
    }

    _setFPSLimit(fps) {
        this.fpsLimit = fps;
        this._msPerFrame = 1000 / fps | 0;
        this._schedNextFrameDelay = Math.round((1000 / fps) - (this._nativeFrameTime / 2)) - 1;
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

    _maybeUpdateAndRender() {
        const takeAction = !this.isPaused();
        if (takeAction) {
            this._updateGlobalTransition();
            if (this.worldMeta) {
                this._renderFrame();
            }
        }
        return takeAction;
    }

    setTiltShift(v) {
        this._setTiltShift(v);
        this._maybeUpdateAndRender();
    }

    _setTiltShift(v, options={}) {
        this.tiltShift = Math.max(0, Math.min(1, v || 0));
        this._updateTiltAngle();
        const ev = new Event('tilt');
        ev.tiltAngle = this._tiltAngle;
        ev.tiltShift = this.tiltShift;
        ev.isUserInteraction = !!options.userInteraction;
        this.dispatchEvent(ev);
    }

    setTiltAngle(a) {
        this.setTiltShift(a / this.maxTiltShiftAngle);
    }

    setZoomPriorityTilt(en) {
        this._setZoomPriorityTilt(en);
        this._maybeUpdateAndRender();
    }

    _setZoomPriorityTilt(en) {
        this._zoomPrioTilt = en;
        this._updateTiltAngle();
    }

    _updateTiltAngle() {
        if (this.tiltShift) {
            const f = this._zoomPrioTilt ? Math.min(1, (1 / this.zoomMax * (this.zoom + 1))) : 1;
            this._tiltAngle = Math.min(1, this.tiltShift * f) * this.maxTiltShiftAngle;
        } else {
            this._tiltAngle = 0;
        }
    }

    setSparkle(en) {
        this.el.classList.toggle('sparkle', !!en);
    }

    _getBackgroundImageScale(width, height) {
        width ??= this._elements.mapBackground.naturalWidth;
        height ??= this._elements.mapBackground.naturalHeight;
        const pixels = width * height;
        const q = 0.1 + this.quality * 0.9;
        const lowBudget = 512 * 512;
        const highBudget = 8192 * 8192;
        const scale = ((highBudget - lowBudget) * (q * q)) / (pixels - lowBudget);
        const ceil = this.style === 'pixelated' ? 0.25 : 1;
        return Math.min(ceil, Math.round(scale / 0.125) * 0.125);
    }

    setQuality(q) {
        this._setQuality(q);
        this._maybeUpdateAndRender();
    }

    _setQuality(q) {
        this.quality = q;
        const dynRange = 300 * q;
        this._memHighWater = 10 + dynRange;
        this._memLowWater = 10 + dynRange * 0.5;
        this._memTarget = this._memLowWater + (this._memHighWater - this._memLowWater) / 2;
        if (this._mapFullImage) {
            const pendingScale = this._getBackgroundImageScale();
            if (pendingScale !== this._elements.mapBackground._scale &&
                pendingScale !== this._setQualityPendingScale) {
                this._setQualityPendingScale = pendingScale;
                this._maybeScaleBackgroundImage(this._mapFullImage).then(img => {
                    if (pendingScale === this._setQualityPendingScale) {
                        this._replaceBackgroundImage(img);
                    } else {
                        if (img._revokeURL) {
                            URL.revokeObjectURL(img._revokeURL);
                        }
                        console.warn("Aborted replace background image");
                    }
                }).finally(() => this._setQualityPendingScale = null);
            }
        }
    }

    setVerticalOffset(v) {
        this.verticalOffset = v;
        this._maybeUpdateAndRender();
    }

    setBounds(tl, br, {padding=0.12}={}) {
        let width = br[0] - tl[0];
        let height = tl[1] - br[1];
        const center = [tl[0] + width / 2, br[1] + height / 2];
        // As strange as this seems, every world is rotated by -90deg when other
        // correction factors are applied, so width and height are swapped for
        // purposes of finding our ideal bounding box sizes.
        [width, height] = [height, width];
        const rectWidth = this._elRect.width * (1 - padding * 2);
        const rectHeight = this._elRect.height * (1 - padding * 2);
        const boundsRatio = width / height;
        const viewRatio = rectWidth / rectHeight;
        const zoom = viewRatio > boundsRatio ? rectHeight / height : rectWidth / width;
        const zoomFactor = 1 / (this.worldMeta.mapScale / this.worldMeta.tileScale);
        this._setCenter(center);
        this.setZoom(zoom * zoomFactor, {disableEvent: true});
    }

    setZoom(zoom) {
        this._setZoom(zoom);
        this._maybeUpdateAndRender();
    }

    _setZoom(zoom, options={}) {
        this.zoom = Math.max(this.zoomMin, Math.min(this.zoomMax, zoom));
        this._zoomDirty = true;
        if (this._zoomPrioTilt && this.tiltShift) {
            this._updateTiltAngle();
        }
        const ev = new Event('zoom');
        ev.zoom = this.zoom;
        ev.isUserInteraction = !!options.userInteraction;
        this.dispatchEvent(ev);
    }

    mapPixelToContainerPixel(x, y, {transform}={}) {
        transform = transform ?? this._activeTransform;
        const point = normalizePoint(transform.transformPoint({x, y}));
        // container has a 50% top/left inset, we need to uncompensate for..
        return point && [point.x + this._elRect.width * 0.5, point.y + this._elRect.height * 0.5];
    }

    containerPixelToMapPixel(x, y, {inverseTransform}={}) {
        // container has a 50% top/left inset, we need to compensate for first..
        x -= this._elRect.width * 0.5;
        y -= this._elRect.height * 0.5;
        const transform = inverseTransform ?? this._activeTransform.inverse();
        if (transform.is2D) {
            const p = transform.transformPoint({x, y});
            return [p.x, p.y];
        } else {
            // ray cast required..
            const r0 = transform.transformPoint({x, y, z: 0});
            const r1 = transform.transformPoint({x, y, z: 1});
            const dx = r1.x - r0.x;
            const dy = r1.y - r0.y;
            const dz = r1.z - r0.z;
            const dw = r1.w - r0.w;
            const t = -r0.z / dz;
            const rx = r0.x + t * dx;
            const ry = r0.y + t * dy;
            const rw = r0.w + t * dw;
            return rw > 0 ?
                [rx / rw, ry / rw] :
                undefined;
        }
    }

    containerPixelToCoord(x, y) {
        const mp = this.containerPixelToMapPixel(x, y);
        if (!mp) {
            return; // unprojectable
        }
        return this.mapPixelToCoord(mp[0], mp[1]);
    }

    // Lightly deprecated...
    pixelToCoord(x, y) {
        return this.containerPixelToCoord(x, y);
    }

    mapPixelToCoord(x, y) {
        const mlbScale = this._mapTileScale * this._layerScale * this._elements.mapBackground._scale;
        const coordX = x / mlbScale + this._anchorXY[0];
        const coordY = y / mlbScale + this._anchorXY[1];
        return this._unrotateWorldPos([coordX, coordY]);
    }

    _onWheelZoom(ev) {
        if (!ev.deltaY) {
            return;
        }
        ev.preventDefault();
        if (!this._wheelState.active) {
            this._wheelState.active = true;
            this._freezeAndDisableMapTransition();
            this.incPauseTracking();
        } else {
            clearTimeout(this._wheelState.doneTimeout);
            cancelAnimationFrame(this._wheelState.nextAnimFrame);
        }
        const px = ev.clientX - this._elRect.x;
        const py = ev.clientY - this._elRect.y;
        let preZoomAnchor;
        if (!this.autoCenter) {
            preZoomAnchor = this.containerPixelToCoord(px, py);
        }
        const preZoom = this.zoom;
        this._setZoom(this.zoom + (-ev.deltaY / 2000 * this.zoom), {userInteraction: true});
        const postZoom = this.zoom;
        if (preZoomAnchor) {
            // Drag the chart towards the cursor.
            // Lerp the delta from center by the zoom change factor..
            const centerXY = this._unrotateWorldPos(this._centerXY);
            const dCX = centerXY[0] - preZoomAnchor[0] - this.dragOffset[0];
            const dCY = centerXY[1] - preZoomAnchor[1] - this.dragOffset[1];
            const f = (postZoom - preZoom) / postZoom;
            const pos = [this.dragOffset[0] + dCX * f, this.dragOffset[1] + dCY * f];
            this._setDragOffset(pos, {userInteraction: true, zoomOrigin: true});
        }
        this._wheelState.nextAnimFrame = requestAnimationFrame(() => {
            this._maybeUpdateAndRender();
            this._wheelState.doneTimeout = setTimeout(() => {
                this._wheelState.active = false;
                this._wheelState.origin = null;
                this.decPauseTracking();
                this._mapTransition.decDisabled();
            }, 100);
        });
    }

    setDragOffset(pos) {
        if (arguments.length === 2 && typeof pos === 'number') {
            pos = Array.from(arguments);
        }
        this._setDragOffset(pos);
        this._maybeUpdateAndRender();
    }

    _setDragOffset(pos, options={}) {
        this.dragOffset = pos;
        this._dragXY = this._rotateWorldPos(pos);
        const ev = new Event('drag');
        ev.drag = [pos[0], pos[1]];
        ev.isUserInteraction = !!options.userInteraction;
        ev.isZoomOrigin = !!options.zoomOrigin;
        this.dispatchEvent(ev);
    }

    setAutoHeading(en) {
        this.autoHeading = en;
        if (!this.isTrackingPaused()) {
            this.setHeading(en ? this._autoHeadingSaved || 0 : 0);
        }
    }

    setAutoCenter(en) {
        this.autoCenter = en;
        if (en && this._autoCenterSaved) {
            this.setCenter(this._autoCenterSaved);
        }
    }

    _freezeAndDisableMapTransition() {
        const step = this._mapTransition.getCurrent();
        this._centerXY[0] = this._dragXY[0] + step[MapTransitionStepEnum.x];
        this._centerXY[1] = this._dragXY[1] + step[MapTransitionStepEnum.y];
        this.zoom = step[MapTransitionStepEnum.zoom];
        this._tiltAngle = step[MapTransitionStepEnum.tiltAngle];
        this.verticalOffset = step[MapTransitionStepEnum.verticalOffset];
        this._heading = step[MapTransitionStepEnum.heading];
        this._mapTransition.incDisabled();
    }

    _onPointerDown(ev) {
        const state = this._pointerState;
        if (ev.button !== 0) {
            if (isDebug) {
                const px = ev.clientX - this._elRect.x;
                const py = ev.clientY - this._elRect.y;
                const mp = this.containerPixelToMapPixel(px, py);
                console.debug(px, py, mp);
                this.addPoint(this.containerPixelToCoord(px, py)).setPinHTML(`
                    container: ${px | 0}, ${py | 0}<br/>
                    map: ${mp[0] | 0}, ${mp[1] | 0}
                `);
            }
            return;
        }
        if (!state.ev1) {
            state.ev1 = state.ev1Prev = ev;
        } else if (!state.ev2) {
            // Promote from moving to gesture..
            state.ev2 = state.ev2Prev = ev;
            this.el.classList.remove('moving');
            state.action = 'gesture';
            return;
        } else {
            console.info("Ignoring 3rd touch input:", ev.pointerId);
            return;
        }
        if (state.aborter) {
            throw new Error("INTERNAL ERROR");
        }
        state.aborter = new AbortController();
        const signal = state.aborter.signal;
        document.addEventListener('pointermove', ev => this._onPointerMove(ev, state), {signal});
        document.addEventListener('pointerup', ev => this._onPointerDone(ev, state), {signal});
        document.addEventListener('pointercancel', ev => this._onPointerDone(ev, state), {signal});
    }

    _onPointerMove(ev, state) {
        // NOTE: multiple pointers are possible, such as touch pad + mouse.
        // Only use the down pointers.
        if (ev.pointerId === state.ev1.pointerId) {
            state.ev1 = ev;
        } else if (ev.pointerId === state.ev2?.pointerId) {
            state.ev2 = ev;
        } else {
            return;  // ignoring 3rd touch movement
        }
        if (!state.action) {
            state.action = 'moving';
            // Capture current state from active transition to avoid jank
            this._freezeAndDisableMapTransition();
            this.incPauseTracking();
            this.el.classList.add('moving');
        }
        cancelAnimationFrame(state.nextAnimFrame);
        if (!state.ev2) {
            state.nextAnimFrame = requestAnimationFrame(() => this._handlePointerDragEvent(ev, state));
        } else {
            state.nextAnimFrame = requestAnimationFrame(() => this._handlePointerGestureEvent(ev, state));
        }
    }

    _handlePointerDragEvent(ev, state) {
        const dX = ev.pageX - state.ev1Prev.pageX;
        const dY =  ev.pageY - state.ev1Prev.pageY;
        let handled;
        if (ev.ctrlKey) {
            if (Math.abs(dX) > 4) {
                this._setHeadingOffset(this.headingOffset - dX * 0.1, {userInteraction: true});
                handled = true;
            }
            if (Math.abs(dY) > 4) {
                handled = true;
                const tiltShift = this.tiltShift - dY * 0.001;
                this._setTiltShift(tiltShift, {userInteraction: true});
            }
        } else {
            handled = true;
            const {0: dRX, 1: dRY} = this._unrotateWorldPos([dX, dY]);
            const l = Math.hypot(dRX, dRY);
            const a = Math.atan2(dRY, dRX) - (this._activeTransform._rotate / radDegF);
            const adjX = Math.cos(a) * l;
            const adjY = Math.sin(a) * l;
            const f = 1 / (this.zoom * this._mapTileScale);
            const pos = [this.dragOffset[0] + adjX * f, this.dragOffset[1] + adjY * f];
            this._setDragOffset(pos, {userInteraction: true});
        }
        if (handled) {
            this._didHandlePointerEvent(state);
            this._maybeUpdateAndRender();
        }
    }

    _handlePointerGestureEvent(ev, state) {
        const {ev1, ev2, ev1Prev, ev2Prev} = state;
        if (ev.pointerId !== ev1.pointerId && ev.pointerId !== ev2.pointerId) {
            throw new Error("INTERNAL ERROR");
        }
        const dX = ev2.pageX - ev1.pageX;
        const dY = ev2.pageY - ev1.pageY;
        const dPrevX = ev2Prev.pageX - ev1Prev.pageX;
        const dPrevY = ev2Prev.pageY - ev1Prev.pageY;
        const dot = dPrevX * dX + dPrevY * dY;
        const cross = dPrevX * dY - dPrevY * dX;
        const dAngle = Math.atan2(cross, dot) * radDegF;
        const dist = Math.hypot(dX, dY);
        const distPrev = Math.hypot(dPrevX, dPrevY);
        const dDist = dist - distPrev;
        let shiftDelta = 0;
        if (Math.abs(dAngle) < 4 && Math.abs(dDist) < 20) {
            // Two parallel fingers dragging together is possibly a tilt shift..
            const dy1 = ev1.pageY - ev1Prev.pageY;
            const dy2 = ev2.pageY - ev2Prev.pageY;
            const dy = (dy1 + dy2) / 2;
            shiftDelta = dy;
        }
        const handleTilt = Math.abs(shiftDelta) > 10;
        const handleZoom = !handleTilt && Math.abs(dDist) > 20;
        const handleRotate = !handleTilt && !handleZoom && Math.abs(dAngle) > 6;
        if (handleZoom || handleRotate || handleTilt) {
            if (handleZoom) {
                // TODO: calculate drag offset based on finger locations like wheel scroll does.
                this._setZoom(this.zoom + (dDist / 300 * this.zoom), {userInteraction: true});
            }
            if (handleRotate) {
                this._setHeadingOffset(this.headingOffset + dAngle, {userInteraction: true});
            }
            if (handleTilt) {
                this._setTiltShift(this.tiltShift - shiftDelta * 0.002, {userInteraction: true});
            }
            this._didHandlePointerEvent(state);
            this._maybeUpdateAndRender();
        }
    }

    _didHandlePointerEvent(state) {
        if (state.ev1 !== state.ev1Prev) {
            state.ev1Prev = state.ev1;
        }
        if (state.ev2 !== state.ev2Prev) {
            state.ev2Prev = state.ev2;
        }
    }

    _onPointerDone(ev, state) {
        if (ev.pointerId !== state.ev1.pointerId && ev.pointerId !== state.ev2?.pointerId) {
            console.debug("Ignoring 3rd touch release:", ev.pointerId);
            return;
        }
        cancelAnimationFrame(state.nextAnimFrame);
        state.aborter.abort();
        if (state.action) {
            this.decPauseTracking();
            this._mapTransition.decDisabled();
        }
        if (state === this._pointerState) {
            this._pointerState = {};
        } else {
            console.warn("Unexpected pointer state collision");
            return;
        }
        // Assume out of order pointerState is possible for css class removal..
        if (this._pointerState.action !== 'moving') {
            this.el.classList.remove('moving');
        }
    }

    async _maybeScaleBackgroundImage(fullImg) {
        const fullWidth = fullImg.naturalWidth;
        const fullHeight = fullImg.naturalHeight;
        const scale = this._getBackgroundImageScale(fullWidth, fullHeight);
        let finalImg;
        if (scale !== 1) {
            const canvas = new OffscreenCanvas(Math.round(fullWidth * scale),
                                               Math.round(fullHeight * scale));
            const ctx = canvas.getContext('2d');
            ctx.drawImage(fullImg, 0, 0, canvas.width, canvas.height);
            const blob = await canvas.convertToBlob({type: 'image/png'});
            const url = URL.createObjectURL(blob);
            finalImg = await loadImage(new Image(), url);
            finalImg._revokeURL = url;
        } else {
            finalImg = fullImg;
        }
        finalImg._scale = scale;
        return finalImg;
    }

    async _getMapBackgroundImages(courseId) {
        const worldMeta = this.worldList.find(x => x.courseId === courseId);
        const version = worldMeta.mapVersion ? `-v${worldMeta.mapVersion}` : '';
        const suffix = {
            default: '',
            pixelated: '',
            neon: '-neon',
        }[this.style] || '';
        const file = `world${worldMeta.worldId}${version}${suffix}.webp`;
        const url = `https://www.sauce.llc/products/sauce4zwift/maps/${file}`;
        const fullImg = new Image();
        fullImg.crossOrigin = 'anonymous';  // required for canvas scaling
        try {
            await loadImage(fullImg, url);
        } catch(e) {
            console.warn("Image decode interrupted/failed", e);
            return;
        }
        const finalImg = await this._maybeScaleBackgroundImage(fullImg);
        return {finalImg, fullImg};
    }

    _updateMapBackground = common.asyncSerialize(async function() {
        const {finalImg, fullImg} = await this._getMapBackgroundImages(this.courseId);
        this._mapFullImage = fullImg;
        this._replaceBackgroundImage(finalImg);
    });

    _replaceBackgroundImage(img) {
        img.className = this._elements.mapBackground.className;
        img.style.setProperty('image-rendering', this.style === 'pixelated' ? 'pixelated' : 'auto');
        const revokeURL = this._elements.mapBackground._revokeURL;
        if (revokeURL) {
            setTimeout(() => URL.revokeObjectURL(revokeURL), 1000);
        }
        this._elements.mapBackground.replaceWith(img);
        this._elements.mapBackground = img;
        this._updateGlobalTransition();
        this._renderFrame(/*force*/ true);
    }

    incPause() {
        this._pauseRefCnt++;
        if (this._pauseRefCnt === 1) {
            this._mapTransition.incDisabled();
        }
    }

    decPause() {
        this._pauseRefCnt--;
        if (this._pauseRefCnt < 0) {
            throw new Error("decPause < 0");
        } else if (this._pauseRefCnt === 0) {
            try {
                this._updateGlobalTransition();
                if (this._renderLoopActive) {
                    this._renderFrame();
                }
            } finally {
                this._mapTransition.decDisabled();
            }
        }
    }

    isPaused() {
        return this._pauseRefCnt > 0;
    }

    incPauseTracking() {
        this._pauseTrackingRefCnt++;
    }

    decPauseTracking() {
        this._pauseTrackingRefCnt--;
        if (this._pauseTrackingRefCnt < 0) {
            throw new Error("decPauseTracking < 0");
        }
    }

    isTrackingPaused() {
        return this._pauseTrackingRefCnt > 0;
    }

    setCourse = common.asyncSerialize(async function(courseId, {portalRoad}={}) {
        const isPortal = portalRoad != null;
        if (isPortal) {
            if (courseId === this.courseId && this.portal && portalRoad === this.roadId) {
                return;
            }
        } else if (courseId === this.courseId && !this.portal) {
            return;
        }
        this.incPause();
        try {
            const {fullImg, finalImg} = await this._getMapBackgroundImages(courseId);
            let roads, segments;
            if (isPortal) {
                const road = await common.getRoad('portal', portalRoad);
                roads = [road];
                segments = [];
            } else {
                [roads, segments] = await Promise.all([
                    common.getRoads(courseId),
                    common.rpc.getCourseSegments(courseId)
                ]);
            }
            this._setCourse({courseId, isPortal, fullImg, finalImg, roads, segments});
        } finally {
            this.decPause();
        }
        if (!this._renderLoopActive) {
            this._renderLoopActive = true;
            this._rafForRenderLoopBound();
        }
    });

    _setCourse({courseId, isPortal, fullImg, finalImg, roads, segments}) {
        // Do all the layout/paint affecting work here..
        this._resetElements();
        this._mapFullImage = fullImg;
        this._roadsById.clear();
        for (const x of roads) {
            this._roadsById.set(x.id, x);
        }
        this.worldMeta = this.worldList.find(x => x.courseId === courseId);
        this.courseId = courseId;
        this.portal = isPortal;
        this._mapTileScale = this.worldMeta.mapScale / this.worldMeta.tileScale;
        if (isPortal) {
            this._setPortalGeometry(courseId, roads[0]);
        } else {
            this._setCourseGeometry(courseId);
        }
        this._elements.pathLayersGroup.classList.toggle('rotated-coordinates', !!this.rotateCoordinates);
        this.el.classList.toggle('portal', isPortal);
        this._setHeading(0);
        this._setCenter(this.geoCenter);
        this._replaceBackgroundImage(finalImg);
        this._renderRoads(roads);
        this._renderSegments(segments);
        if (isPortal) {
            this.setActiveRoad(roads[0].id);
        }
    }

    _setPortalGeometry(courseId, road) {
        const m = this.worldMeta;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const [x, y] of road.path) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
        const centerX = (maxX - minX) / 2;
        const centerY = (maxY - minY) / 2;
        const coordCenterX = (m.maxX - m.minX) / 2;
        const coordCenterY = (m.maxY - m.minY) / 2;
        const magicAnchor = road.path[0].slice(0, 2); // The first point is magic
        this._anchorXY = [
            minX - magicAnchor[0] + centerX - coordCenterX,
            minY - magicAnchor[1] + centerY - coordCenterY
        ];
        this.rotateCoordinates = false;
        this.geoCenter = [
            (m.maxX - m.minX) / 2 + this._anchorXY[0],
            (m.maxY - m.minY) / 2 + this._anchorXY[1],
        ];
        const viewBox = [
            this._anchorXY[0] + magicAnchor[0],
            this._anchorXY[1] + magicAnchor[1],
            m.maxX - m.minX,
            m.maxY - m.minY
        ].join(' ');
        this._elements.paths.setAttribute('viewBox', viewBox);
    }

    _setCourseGeometry(courseId) {
        const m = this.worldMeta;
        this._anchorXY = [m.minX + m.anchorX, m.minY + m.anchorY];
        this.rotateCoordinates = !!m.rotateRouteSelect;
        this.geoCenter = this._unrotateWorldPos([
            m.minX + ((m.maxX - m.minX) / 2) + m.anchorX,
            m.minY + ((m.maxY - m.minY) / 2) + m.anchorY,
        ]);
        const viewBox = [
            this._anchorXY[0],
            this._anchorXY[1],
            m.maxX - m.minX,
            m.maxY - m.minY
        ].join(' ');
        this._elements.paths.setAttribute('viewBox', viewBox);
    }

    _resetElements() {
        this.clearPathHighlights();
        this._routeSig = this.routeId = this.route = this.roadId = null;
        Object.values(this._elements.intLayers).forEach(x => x.replaceChildren());
        Object.values(this._elements.userLayers).forEach(x => x.replaceChildren());
        for (const ent of Array.from(this._ents.values()).filter(x => x.gc)) {
            this.removeEntity(ent);
        }
        this._elements.roadDefs.replaceChildren();
        this._elements.pins.replaceChildren();
        this._renderingEnts.length = 0;
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
        if (this.rotateCoordinates) {
            return pos.length === 2 ? [pos[1], -pos[0]] : [pos[1], -pos[0], pos[2]];
        } else {
            return pos;
        }
    }

    _unrotateWorldPos(pos) {
        // Use sparingly;  If working with large groups of entities rotate the group instead.
        return this.rotateCoordinates ? [-pos[1], pos[0], pos[2]] : pos;
    }

    _createCurvePath(points, loop, type='CatmullRom') {
        const curveFunc = {
            CatmullRom: curves.catmullRomPath,
            Bezier: curves.cubicBezierPath,
        }[type];
        return curveFunc(points, {loop});
    }

    _renderRoads(roads) {
        const roadDefs = this._elements.roadDefs;
        const {low: laneLayer, mid: styleLayer, gutters: guttersLayer} = this._elements.intLayers;
        // Because roads overlap and we want to style some of them differently this
        // makes multi-sport roads higher so we don't randomly style overlapping sections.
        roads = roads.slice();
        roads.sort((a, b) => a.sports.length - b.sports.length);
        for (const road of roads) {
            if ((!road.sports.includes('cycling') && !road.sports.includes('running')) || !road.isAvailable) {
                continue;
            }
            const pathId = `road-path-${road.id}`;
            roadDefs.append(createElementSVG('path', {
                id: pathId,
                d: road.curvePath.toSVGPath(),
                fill: 'none',
            }));
            guttersLayer.append(createElementSVG('use', {
                "class": 'road-gutter',
                "data-id": road.id,
                "href": `#${pathId}`,
            }));
            laneLayer.append(createElementSVG('use', {
                "class": `road-lane ${road.sports.map(x => `sport-${x}`).join(' ')}`,
                "data-id": road.id,
                "href": `#${pathId}`,
            }));
            for (const [i, style] of road.styles.entries()) {
                const m = style.style.match(/(wood|dirt|gravel|grass)/i);
                if (!m) {
                    continue;
                }
                const baseStyle = m[1].toLowerCase();
                // See: https://zwiftinsider.com/crr/
                const fasterOnGravel = ['gravel', 'dirt', 'grass'];
                const fasterOnMTB = ['grass'];
                const id = `${road.id}-${i}`;
                const stylePathId = `road-style-path-${id}`;
                roadDefs.append(createElementSVG('path', {
                    id: stylePathId,
                    d: style.curvePath.toSVGPath({includeEdges: true}),
                    fill: 'none',
                }));
                const tooltip = createElementSVG('title');
                tooltip.textContent = `${baseStyle[0].toUpperCase()}${baseStyle.slice(1)}`;
                const extraClasses = [];
                if (fasterOnGravel.includes(baseStyle)) {
                    extraClasses.push('faster-on-gravel');
                    tooltip.textContent += `\n\nFaster on Gravel bike`;
                }
                if (fasterOnMTB.includes(baseStyle)) {
                    extraClasses.push('faster-on-mtb');
                    if (extraClasses.includes('faster-on-gravel')) {
                        tooltip.textContent += `\nFastest on MTB`;
                    } else {
                        tooltip.textContent += `\n\nFaster on MTB`;
                    }
                }
                const path = createElementSVG('use', {
                    "class": `road-style style-${baseStyle} ${extraClasses.join(' ')}`,
                    "data-id": id,
                    "href": `#${stylePathId}`,
                });
                path.append(tooltip);
                styleLayer.append(path);
            }
        }
        if (this.roadId != null) {
            this.setActiveRoad(this.roadId);
        }
    }

    _renderSegments(segments) {
        const roadDefs = this._elements.roadDefs;
        const {shadows: shadowLayer, high: dirLayer} = this._elements.intLayers;
        this._segmentElsById.clear();
        for (const seg of segments) {
            const {0: start, 1: end} = seg.reverse ?
                [seg.roadFinish, seg.roadStart] :
                [seg.roadStart, seg.roadFinish];
            let curvePath = this._roadsById.get(seg.roadId).curvePath.subpathAtRoadPercents(start, end);
            if (curvePath.nodes.length < 2) {
                console.error("tossing segment:", seg);
                continue;
            }
            if (seg.requiresAllCheckpoints) {
                console.warn("requies all", seg);
            }
            if (seg.reverse) {
                curvePath = curvePath.toReversed();
            }
            const defPathId = `segment-path-${seg.id}`;
            const defPath = createElementSVG('path', {
                id: defPathId,
                d: curvePath.toSVGPath({includeEdges: true}),
                fill: 'none',
                class: 'segment-path-def',
                "data-road-id": seg.roadId,
                "data-road-dir": seg.reverse ? 'reverse' : 'forward',
            });
            const tooltip = createElementSVG('title');
            tooltip.textContent = `Segment: ${seg.name}`;
            defPath.append(tooltip);
            roadDefs.append(defPath);
            const shadowPath = createElementSVG('use', {
                class: `segment-shadow`,
                href: `#${defPathId}`,
            });
            shadowLayer.append(shadowPath);
            const dirPath = createElementSVG('use', {
                "class": `segment-dir`,
                "href": `#${defPathId}`,
            });
            dirLayer.append(dirPath);
            this._segmentElsById.set(seg.id, [shadowPath, dirPath]);
        }
    }

    latlngToPosition([lat, lon]) {
        return this.worldMeta.flippedHack ? [
            (lat - this.worldMeta.latOffset) * this.worldMeta.latDegDist * 100,
            (lon - this.worldMeta.lonOffset) * this.worldMeta.lonDegDist * 100
        ] : [
            (lon - this.worldMeta.lonOffset) * this.worldMeta.lonDegDist * 100,
            -(lat - this.worldMeta.latOffset) * this.worldMeta.latDegDist * 100
        ];
    }

    setRoad(id) {
        console.warn("DEPRECATED: use setActiveRoad");
        return this.setActiveRoad(id);
    }

    clearRoute() {
        this.routeId = this.route = null;
        this.clearPathHighlights();
    }

    clearPathHighlights() {
        this._pathHighlights.forEach(x => this.removeHighlightPath(x));
        this._pathHighlights.length = 0;
    }

    setActiveRoad(id) {
        this.roadId = id;
        this.routeId = this.route = null;
        this.clearPathHighlights();
        const road = this._roadsById.get(id);
        if (!road) {
            console.error('Road ID not found:', id);
            this.roadId = null;
            return;
        }
        const path = road.curvePath;
        const includeEdges = false;
        this._pathHighlights.push(
            this.addHighlightPath(path, `rd-gutters-${id}`, {includeEdges, extraClass: 'active-gutter'}),
            this.addHighlightPath(path, `rd-path-${id}`, {includeEdges, extraClass: 'active-path'}));
    }

    setActiveRoute = common.asyncSerialize(async function(id, options={}) {
        if (typeof options === 'number') {
            console.warn("DEPRECATED use of laps argument");
            options = {showWeld: options > 1};
        }
        this.clearPathHighlights();
        this.roadId = null;
        this.routeId = id;
        this.route = undefined;
        const route = await common.getRoute(id);
        if (!route) {
            console.error("Route ID not found:", id);
            this.routeId = this.route = null;
            return;
        }
        this.route = route;
        let fullPath, lapPath;
        const path = fullPath = lapPath = this.route.curvePath;
        let leadinPath, weldPath;
        const lapRoadIdx = this.route.manifest.findIndex(x => !x.leadin);
        const lapIdx = lapRoadIdx ? path.nodes.findIndex(x => x.index === lapRoadIdx) : 0;
        if (lapIdx) {
            lapPath = path.slice(lapIdx);
            if (!options.hideLeadin) {
                leadinPath = path.slice(0, lapIdx);
            } else {
                fullPath = path.slice(lapIdx);
            }
        }
        if (options.showWeld && this.route.lapWeldPath) {
            weldPath = this.route.lapWeldPath;
            fullPath = fullPath.slice();
            fullPath.extend(weldPath);
        }
        // Add paths, lowest level -> highest..
        const tooltip = `Route: ${route.name}`;
        this._pathHighlights.push(
            this.addHighlightPath(fullPath, `rt-gutters-${id}`, {extraClass: 'active-gutter', tooltip}),
            this.addHighlightPath(lapPath, `rt-lap-${id}`, {extraClass: 'active-path', tooltip}));
        if (weldPath) {
            this._pathHighlights.push(this.addHighlightPath(weldPath, `route-weld-${id}`, {
                extraClass: 'route-weld',
                tooltip: 'Route Lap Interlude'
            }));
        }
        if (leadinPath) {
            this._pathHighlights.push(this.addHighlightPath(leadinPath, `rt-leadin-${id}`, {
                extraClass: 'route-leadin',
                tooltip: 'Route Leadin',
            }));
        }
        const activeSegIds = new Set(route.manifest.filter(x => x.segmentIds).map(x => x.segmentIds).flat());
        for (const [id, els] of this._segmentElsById.entries()) {
            const active = activeSegIds.has(id);
            for (const x of els) {
                x.classList.toggle('active', active);
            }
        }
        return this.route;
    });

    _addShape(shape, attrs, {layer='high'}={}) {
        if (!Object.hasOwn(this._elements.userLayers, layer)) {
            throw new TypeError('invalid layer');
        }
        const el = createElementSVG(shape, attrs);
        this._elements.userLayers[layer].append(el);
        return el;
    }

    drawLine(p0, p1, {color="#000a", size=2, layer='high', ...attrs}={}) {
        return this._addShape('line', {
            x1: p0[0],
            y1: p0[1],
            x2: p1[0],
            y2: p1[1],
            "stroke-width": `${size}em`,
            stroke: color,
            ...attrs,
        });
    }

    drawCircle(c, {color="#000a", size=10, borderColor="gold", borderSize=0.5, layer='high', ...attrs}={}) {
        return this._addShape('circle', {
            cx: c[0],
            cy: c[1],
            r: `${size}em`,
            fill: color,
            "stroke-width": `${borderSize}em`,
            stroke: borderColor,
            ...attrs,
        });
    }

    _createDebugPathElements(nodes, layer) {
        const elements = [];
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
        return elements;
    }

    addHighlightPath(path, id, {includeEdges=true, layer='mid', ...options}={}) {
        if (!Object.hasOwn(this._elements.userLayers, layer)) {
            throw new TypeError('invalid layer');
        }
        const elements = options.debug ? this._createDebugPathElements(path.nodes, layer) : [];
        const svgPath = createElementSVG('path', {
            class: `highlight ${options.extraClass || ''}`,
            "data-id": id,
            d: path.toSVGPath({includeEdges}),
            fill: 'none',
        });
        if (options.tooltip) {
            const tooltip = createElementSVG('title');
            tooltip.textContent = options.tooltip;
            svgPath.append(tooltip);
        }
        if (options.width != null) {
            svgPath.style.setProperty('--width', options.width);
        }
        if (options.color != null) {
            svgPath.style.setProperty('stroke', options.color);
        }
        this._elements.userLayers[layer].append(svgPath);
        elements.push(svgPath);
        return {id, path, elements, svgPath, debug: !!options.debug, includeEdges, layer};
    }

    updateHighlightPath(pathObj, path, {debug, includeEdges=true, width, color}={}) {
        const svgPath = pathObj.svgPath;
        if (pathObj.debug || debug) {
            for (const x of pathObj.elements) {
                if (x !== svgPath) {
                    x.remove();
                }
            }
            const elements = debug ? this._createDebugPathElements(path.nodes, pathObj.layer) : [];
            elements.push(svgPath);
            pathObj.elements = elements;
            pathObj.debug = debug;
        }
        svgPath.setAttribute('d', path.toSVGPath({includeEdges}));
        if (width !== undefined) {
            if (width === null) {
                svgPath.style.removeProperty('--width');
            } else {
                svgPath.style.setProperty('--width', width);
            }
        }
        if (color !== undefined) {
            if (color === null) {
                svgPath.style.removeProperty('stroke');
            } else {
                svgPath.style.setProperty('stroke', color);
            }
        }
        return pathObj;
    }

    addHighlightLine(points, id, options={}) {
        return this.addHighlightPath(this._createCurvePath(points, options.loop), id, options);
    }

    updateHighlightLine(pathObj, points, options={}) {
        return this.updateHighlightPath(pathObj, this._createCurvePath(points, options.loop), options);
    }

    removeHighlightPath(pathObj) {
        for (const x of pathObj.elements) {
            x.remove();
        }
    }

    removeHighlightLine(pathObj) {
        return this.removeHighlightPath(pathObj);
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

    removePoint(ent) {
        this.removeEntity(ent);
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
        this._renderingEnts.push(ent);
        ent.addEventListener('pinned', ev => {
            if (ev.visible) {
                if (!this._pinnedEnts.includes(ent)) {
                    this._pinnedEnts.push(ent);
                }
                if (!this._renderingEnts.includes(ent)) {
                    this._renderingEnts.push(ent);
                }
                this._renderFrame();
            } else {
                const i = this._pinnedEnts.indexOf(ent);
                if (i !== -1) {
                    this._pinnedEnts.splice(i, 1);
                }
            }
        });
        ent.addEventListener('position', () => {
            if (!this._renderingEnts.includes(ent)) {
                this._renderingEnts.push(ent);
            }
        });
    }

    getEntity(id) {
        return this._ents.get(id);
    }

    removeEntity(ent) {
        this._ents.delete(ent.id);
        let i = this._pinnedEnts.indexOf(ent);
        if (i !== -1) {
            this._pinnedEnts.splice(i, 1);
        }
        i = this._renderingEnts.indexOf(ent);
        if (i !== -1) {
            this._renderingEnts.splice(i, 1);
        }
        ent.togglePin(false);
        ent.el.remove();
    }

    _addAthleteEntity(state) {
        const ent = new MapAthlete(state.athleteId);
        ent.lastSeen = 0;
        ent.gc = true;
        ent.delayDecay = common.expWeightedAvg(20, 1000);
        ent.el.classList.toggle('self', state.athleteId === this.athleteId);
        ent.el.classList.toggle('watching', state.athleteId === this.watchingId);
        this.addEntity(ent);
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
        ent.togglePin(undefined, {hard: true});
    }

    setTransitionDuration(ms) {
        this._mapTransition.setDuration(ms);
    }

    getTransitionDuration(ms) {
        return this._mapTransition.duration;
    }

    renderAthleteStates = common.asyncSerialize(async states => {
        if (this.watchingId == null || !common.isVisible() || this.isPaused()) {
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
            let sg;
            if (watching.eventSubgroupId) {
                sg = await common.getEventSubgroup(watching.eventSubgroupId);
                if (sg?.eventId && sg._mixedCats === undefined) {
                    const event = await common.getEvent(sg.eventId);
                    sg._mixedCats = event.cullingType !== 'CULLING_SUBGROUP_ONLY' &&
                        !(event.cullingType === 'CULLING_EVENT_ONLY' && event.eventSubgroups.length === 1);
                }
            }
            if (this.preferRoute) {
                let routeId;
                let showWeld;
                let hideLeadin;
                if (watching.eventSubgroupId) {
                    routeId = sg?.routeId || null;
                    showWeld = sg?.laps > 1;
                } else {
                    routeId = watching.routeId || null;
                    showWeld = watching.laps || (watching.routeDistance / watching.routeEnd > 0.5);
                    hideLeadin = showWeld;
                }
                if (routeId) {
                    const rtSig = `${routeId}-${showWeld}-${hideLeadin}`;
                    if (rtSig !== this._routeSig) {
                        this._routeSig = rtSig;
                        await this.setActiveRoute(routeId, {showWeld, hideLeadin});
                    }
                } else {
                    this._routeSig = null;
                    if (this.routeId) {
                        this.clearRoute();
                    }
                }
            }
            if (!this.routeId && watching.roadId !== this.roadId) {
                this.setActiveRoad(watching.roadId);
            }
        }
        const now = Date.now();
        let requestImmediateAthleteUpdate;
        for (const state of states) {
            if (!this.portal !== !state.portal) {
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
            if (ent) {
                const sinceLastUpdate = ent._athleteUpdate ? now - ent._athleteUpdate : Infinity;
                if (ent.pin) {
                    if (sinceLastUpdate >= 2000) {
                        this._pendingAthleteUpdates.add(state.athleteId);
                        if (sinceLastUpdate >= 60_000) {
                            requestImmediateAthleteUpdate = true;
                        }
                    }
                } else if (sinceLastUpdate >= 300_000) {
                    this._pendingAthleteUpdates.add(state.athleteId);
                }
            }
            const age = now - ent.lastSeen;
            if (age) {
                if (age < 3000) {
                    // Try to animate close to the update rate without going under.
                    // Prefer lag over jank.
                    const agePadF = 1.15;
                    const paddedAge = age * agePadF;
                    const dur = ent.delayDecay(paddedAge);
                    if (dur < paddedAge) {
                        // Reset decay func to new high and with calibrated period..
                        const size = Math.ceil(30000 / (dur / agePadF));
                        ent.delayDecay = common.expWeightedAvg(size, paddedAge * 1.5);
                    }
                    const quantDur = Math.ceil(dur / 100) * 100;
                    if (quantDur !== ent.transition.duration) {
                        ent.transition.setDuration(quantDur);
                    }
                } else {
                    ent.transition.setDuration(0);
                }
            }
            ent.setPosition([state.x, state.y]);
            ent.powerLevel = powerLevel;
            ent.lastSeen = now;
            ent.setPlayerState(state);
            let category;
            if (state.eventSubgroupId) {
                const sg = getSubgroupLazy(state.eventSubgroupId);
                if (sg && sg._mixedCats) {
                    category = sg.subgroupLabel;
                }
            }
            ent.setCategory(category);
            if (state.athleteId === this.watchingId && !this.isTrackingPaused()) {
                this._autoHeadingSaved = state.heading;
                if (this.autoHeading) {
                    this._setHeading(this._autoHeadingSaved);
                }
                this._autoCenterSaved = [state.x, state.y];
                if (this.autoCenter) {
                    this._setCenter(this._autoCenterSaved);
                }
                if (this.autoCenter || this.autoHeading) {
                    this._updateGlobalTransition();
                }
            }
        }
        if (requestImmediateAthleteUpdate) {
            this._drainPendingAthleteUpdates();  // bg okay
        }
    });

    setHeadingOffset(headingOffset) {
        this._setHeadingOffset(headingOffset);
        this._maybeUpdateAndRender();
    }

    _setHeadingOffset(headingOffset, options={}) {
        this.headingOffset = headingOffset;
        this._setHeading(this.heading);
        const ev = new Event('headingoffset');
        ev.headingOffset = this.headingOffset;
        ev.heading = this.heading;
        ev.isUserInteraction = !!options.userInteraction;
        this.dispatchEvent(ev);
    }

    setHeading(heading) {
        this._setHeading(heading);
        this._maybeUpdateAndRender();
    }

    _setHeading(heading) {
        if (Math.abs(this.heading - heading) > 180) {
            this._headingRotations += Math.sign(this.heading - heading);
        }
        const mapAdj = this.rotateCoordinates ? 0 : -90;
        this._heading = heading + this.headingOffset + this._headingRotations * 360 + mapAdj;
        this.heading = heading;
        // Too busy for its own event, see headingOffset instead.
    }

    setCenter(pos) {
        this._setCenter(pos);
        this._maybeUpdateAndRender();
    }

    _setCenter(pos) {
        this.center = pos;
        this._centerXY = this._rotateWorldPos(pos);
        // Too busy for its own event, see drag instead.
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

    _rotateCoord(x, y, angle) {
        const aR = angle / radDegF;
        const aCos = Math.cos(aR);
        const aSin = Math.sin(aR);
        return [x * aCos - y * aSin, x * aSin + y * aCos];
    }

    _estimate3DGraphicsSize(transform) {
        // Acquire the worst case scenerio of map pixels by projecting up to the viewport.
        // This is axis aligned, so a 45deg rotation will overestimate (acceptable)..
        const mapWidth = this._elements.mapBackground.naturalWidth * transform._layerScale;
        const mapHeight = this._elements.mapBackground.naturalHeight * transform._layerScale;
        const cc0 = this.mapPixelToContainerPixel(0, 0, {transform}) ??
            this._rotateCoord(-1e9, -1e9, transform._rotate);
        const cc1 = this.mapPixelToContainerPixel(mapWidth, 0, {transform}) ??
            this._rotateCoord(1e9, -1e9, transform._rotate);
        const cc2 = this.mapPixelToContainerPixel(mapWidth, mapHeight, {transform}) ??
            this._rotateCoord(1e9, 1e9, transform._rotate);
        const cc3 = this.mapPixelToContainerPixel(0, mapHeight, {transform}) ??
            this._rotateCoord(-1e9, 1e9, transform._rotate);
        // Find the extrema and clip to viewport (container)..
        const minCX = Math.max(Math.min(cc0[0], cc1[0], cc2[0], cc3[0]), 0);
        const maxCX = Math.min(Math.max(cc0[0], cc1[0], cc2[0], cc3[0]), this._elRect.width);
        const minCY = Math.max(Math.min(cc0[1], cc1[1], cc2[1], cc3[1]), 0);
        const maxCY = Math.min(Math.max(cc0[1], cc1[1], cc2[1], cc3[1]), this._elRect.height);
        // With our final corners, calculate the proper pixel scale..
        const inverseTransform = transform.inverse();
        const mc0 = this.containerPixelToMapPixel(minCX, minCY, {inverseTransform}) ??
            this._rotateCoord(0, 0, -transform._rotate);
        const mc1 = this.containerPixelToMapPixel(maxCX, minCY, {inverseTransform}) ??
            this._rotateCoord(mapWidth, 0, -transform._rotate);
        const mc2 = this.containerPixelToMapPixel(maxCX, maxCY, {inverseTransform}) ??
            this._rotateCoord(mapWidth, mapHeight, -transform._rotate);
        const mc3 = this.containerPixelToMapPixel(minCX, maxCY, {inverseTransform}) ??
            this._rotateCoord(0, mapHeight, -transform._rotate);
        const minMX = Math.min(mc0[0], mc1[0], mc2[0], mc3[0]);
        const maxMX = Math.max(mc0[0], mc1[0], mc2[0], mc3[0]);
        const minMY = Math.min(mc0[1], mc1[1], mc2[1], mc3[1]);
        const maxMY = Math.max(mc0[1], mc1[1], mc2[1], mc3[1]);
        const pixels = (maxMX - minMX) * (maxMY - minMY) *
            devicePixelRatio * devicePixelRatio *
            transform._layerScale * transform._layerScale;
        // manual curve fit..
        return 3e-6 * pixels + 33.9;
    }

    _createGlobalTransform(tStep, layerScale) {
        const lbScale = layerScale * this._elements.mapBackground._scale;
        const mlbScale = this._mapTileScale * lbScale;
        const scale = tStep[MapTransitionStepEnum.zoom] / lbScale;
        const t = identMatrix.scale(scale);
        const tiltAngle = tStep[MapTransitionStepEnum.tiltAngle];
        if (tiltAngle > 1e-6) {
            t.m34 = -scale / this._perspective;
            t.rotateSelf(tiltAngle, 0, 0);
        }
        t.translateSelf(0, tStep[MapTransitionStepEnum.verticalOffset] * this._elRect.height / scale);
        t.rotateSelf(t._rotate = tStep[MapTransitionStepEnum.heading]);
        t.translateSelf(-(tStep[MapTransitionStepEnum.x] - this._anchorXY[0]) * mlbScale,
                        -(tStep[MapTransitionStepEnum.y] - this._anchorXY[1]) * mlbScale);
        t._layerScale = layerScale;
        return t;
    }

    _updateLayerScale(layerScale) {
        const {ents, map, mapBackground} = this._elements;
        const lbScale = layerScale * mapBackground._scale;
        const mlbScale = this._mapTileScale * lbScale;
        this._layerScale = layerScale;
        map.style.width = `${this._mapFullImage.naturalWidth * lbScale}px`;
        map.style.height = `${this._mapFullImage.naturalHeight * lbScale}px`;
        map.style.setProperty('--lb-scale', lbScale);
        ents.style.left = `${-this._anchorXY[0] * mlbScale}px`;
        ents.style.top = `${-this._anchorXY[1] * mlbScale}px`;
    }

    _renderFrame(force, frameTime=timeline.currentTime) {
        this._frameTimeAvg = this._frameTimeWeighted(frameTime - this._lastFrameTime);
        this._lastFrameTime = frameTime;
        let pinUpdates;
        // If not playing and not disabled (i.e. user-interaction) we can skip..
        const step = (this._mapTransition.playing || this._mapTransition.disabled || force) &&
            this._mapTransition.getStep(frameTime);
        if (step) {
            const is2D = Math.abs(step[MapTransitionStepEnum.tiltAngle]) < 0.1;
            let layerScale;
            let transform;
            const zoom = step[MapTransitionStepEnum.zoom];
            // Below a combined layerScale * bgScale of ~0.5 we get _increased_ mem usage and
            // unnacceptable quality..
            const magicMinLayerBGScale = 0.5;
            const minLayerScale = magicMinLayerBGScale / this._elements.mapBackground._scale;
            this._scaleUpCooldown--;
            if (is2D) {
                layerScale = Math.max(minLayerScale, Math.round(zoom / 0.25) * 0.25);
                transform = this._createGlobalTransform(step, layerScale);
            } else {
                // 3d transforms need dynamic layerscale handling to avoid gpu mem abuse..
                layerScale = Math.max(minLayerScale, this._layerScale);
                const layerScaleLowWater = zoom * Math.max(0.1, this.quality);
                transform = this._createGlobalTransform(step, layerScale);
                let sz = this._estimate3DGraphicsSize(transform);
                if (sz < this._memLowWater && layerScale < layerScaleLowWater && this._scaleUpCooldown <= 0) {
                    let fuse = 20;
                    while (sz < this._memLowWater && layerScale < layerScaleLowWater && fuse--) {
                        layerScale *= 1.05;
                        transform = this._createGlobalTransform(step, layerScale);
                        sz = this._estimate3DGraphicsSize(transform);
                        console.debug("LayerScale up:", layerScale, 'size', sz);
                    }
                    if (sz > this._memHighWater) {
                        console.warn("Scale up broke mem bounds, tune LayerScale-up params");
                    }
                    this._scaleUpCooldown = Math.ceil(100 / this._frameTimeAvg);
                }
                if (sz > this._memHighWater && layerScale > minLayerScale) {
                    let fuse = 100;
                    while (sz > this._memTarget && layerScale > minLayerScale && fuse--) {
                        layerScale = Math.max(minLayerScale, layerScale * 0.90);
                        transform = this._createGlobalTransform(step, layerScale);
                        sz = this._estimate3DGraphicsSize(transform);
                        console.debug("LayerScale down:", layerScale, 'size', sz);
                    }
                    this._scaleUpCooldown = Math.ceil(2000 / this._frameTimeAvg);
                }
            }
            if (layerScale !== this._layerScale || force) {
                console.info("LAYER SCALE", layerScale);
                this._renderingEnts.length = 0;
                for (const x of this._ents.values()) {
                    this._renderingEnts.push(x);
                }
                this._updateLayerScale(layerScale);
            }
            this._activeTransform = transform;
            this._elements.map.style.transform = transform;
            pinUpdates = this._pinnedEnts.length ? this._pinnedEnts.slice() : [];
        } else {
            pinUpdates = [];
        }
        if (this._zoomDirty) {
            this._elements.map.style.setProperty('--zoom', this.zoom);
            this._zoomDirty = false;
        }
        const mlbScale = this._mapTileScale * this._layerScale * this._elements.mapBackground._scale;
        for (let i = this._renderingEnts.length - 1; i >= 0; i--) {
            const ent = this._renderingEnts[i];
            const pos = ent.transition.getStep(frameTime);
            if (pos) {
                // On chromium this method is faster than using DOMMatrix and even writing
                // matrix(...) by hand.  Do not change without benchmarks.
                ent._lastPos = pos;
                ent.el.style.transform = `translate(${pos[0] * mlbScale}px, ${pos[1] * mlbScale}px)`;
                if (ent.pin && !step) {
                    pinUpdates.push(ent);
                }
            }
            if (ent.el._powerLevel !== ent.powerLevel) {
                ent.el.dataset.powerLevel = ent.el._powerLevel = ent.powerLevel;
            }
            if (ent.new) {
                this._elements.ents.append(ent.el);
                ent.new = false;
            }
            if (!ent.transition.playing) {
                this._renderingEnts.splice(i, 1);
            }
        }
        for (let i = 0; i < pinUpdates.length; i++) {
            const ent = pinUpdates[i];
            const p = this._activeTransform.transformPoint({
                x: (ent._lastPos[0] - this._anchorXY[0]) * mlbScale,
                y: (ent._lastPos[1] - this._anchorXY[1]) * mlbScale
            });
            ent.pin.style.transform = `translate(${p.x / p.w}px, ${p.y / p.w}px)`;
            if (ent.pin.new) {
                this._elements.pins.append(ent.pin);
                ent.pin.new = false;
            }
        }
    }

    _renderLoop(frameTime) {
        const elapsed = frameTime - this._lastFrameTime;
        if (this._msPerFrame < elapsed || this._msPerFrame < this._frameTimeAvg) {
            if (this._schedNextFrameDelay > 8) {
                setTimeout(this._rafForRenderLoopBound, this._schedNextFrameDelay);
            } else {
                this._rafForRenderLoopBound();
            }
            this._renderFrame(false, frameTime);
            if (this._renderCallbacks.length) {
                const q = this._renderCallbacks;
                this._renderCallbacks = this._renderCallbacksSwap;
                this._renderCallbacksSwap = q;
                for (let i = 0; i < q.length; i++) {
                    q[i](frameTime);
                }
                q.length = 0;
            }
        } else {
            this._rafForRenderLoopBound();
        }
    }

    requestRenderFrame(callback) {
        this._renderCallbacks.push(callback);
        return callback;  // We don't use IDs, but can retain the cancel pattern of RAF still
    }

    cancelRenderFrame(callback) {
        const i = this._renderCallbacks.indexOf(callback);
        if (i !== -1) {
            this._renderCallbacks.splice(i, 1);
        }
    }

    _updateGlobalTransition() {
        const x = this._centerXY[0] - this._dragXY[0];
        const y = this._centerXY[1] - this._dragXY[1];
        // See MapTransitionStepEnum for order
        this._mapTransition.setValues([
            x,
            y,
            this.zoom,
            this._tiltAngle,
            this.verticalOffset,
            this._heading,
        ]);
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

    async _drainPendingAthleteUpdates() {
        if (!this._pendingAthleteUpdates.size) {
            return;
        }
        let now = Date.now();
        const ids = [];
        for (const id of this._pendingAthleteUpdates) {
            const ent = this._ents.get(id);
            if (ent) {
                ids.push(id);
                ent._athleteUpdate = now;  // prevent double fetches while we hang on the wire
            }
        }
        this._pendingAthleteUpdates.clear();
        const ads = await common.getAthletesDataCached(ids, {maxAge: 1000});
        now = Date.now();
        for (const ad of ads) {
            const ent = ad && this._ents.get(ad.athleteId);
            if (ent) {
                ent._athleteUpdate = now;
                this._updateEntityAthleteData(ent, ad);
            }
        }
    }
}
