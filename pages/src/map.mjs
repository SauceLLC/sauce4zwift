import * as common from './common.mjs';
import * as curves from '/shared/curves.mjs';
import * as locale from '/shared/sauce/locale.mjs';

const H = locale.human;
const timeline = document.timeline;


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


class Transition {

    EPSILON = 1 / 0x800000;

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
            this._dst = Array.from(this._cur);
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
            this._src = Array.from(this._cur);
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
                    // Snap to given values if within ieee754 error
                    if (Math.abs(values[i] - this._cur[i]) < this.EPSILON) {
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
            this._cur = Array.from(values);
        }
        this._dst = Array.from(values);
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

    getValues() {
        return this._dst ? Array.from(this._dst) : null;
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
                const delta = this._dst[i] - this._src[i];
                this._cur[i] = this._src[i] + (delta * progress);
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


function getSubgroupLazy(id) {
    const sg = common.getEventSubgroup(id);
    if (!sg || sg instanceof Promise) {
        return null;
    }
    return sg;
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
        this.zoomMin = zoomMin;
        this.zoomMax = zoomMax;
        this.maxTiltShiftAngle = maxTiltShiftAngle;
        this.watchingId = null;
        this.athleteId = null;
        this.courseId = null;
        this.portal = null;
        this.roadId = null;
        this.routeId = null;
        this.route = null;
        this._routeHighlights = [];
        this.worldMeta = null;
        this.rotateCoordinates = null;
        this._adjHeading = 0;
        this.style = style;
        this.quality = quality;
        this._canvasScale = null;
        this._headingRotations = 0;
        this._heading = 0;
        this.headingOffset = 0;
        this._ents = new Map();
        this._pendingEntityUpdates = new Set();
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
        this._frameTimeWeighted = common.expWeightedAvg(30, 1000 / 60);
        this._nativeFrameTime = 1000 / 60;
        this._perspective = 800;
        this._wheelState = {
            nextAnimFrame: null,
            doneTimeout: null,
        };
        this._pointerState = {
            nextAnimFrame: null,
            lastDistance: null,
            ev1: null,
            ev2: null,
            lastX: null,
            lastY: null,
        };
        this._renderLoopActive = false;
        this._renderLoopBound = this._renderLoop.bind(this);
        this._rafForRenderLoopBound = requestAnimationFrame.bind(window, this._renderLoopBound);
        this._onPointerMoveBound = this._onPointerMove.bind(this);
        this._onPointerDoneBound = this._onPointerDone.bind(this);
        this._mapTransition = new Transition({duration: 500});
        this._elements = {
            map: createElement('div', {class: 'sauce-map'}),
            mapCanvas: createElement('canvas', {class: 'map-background'}),
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
            }
        };
        this._elements.paths.append(this._elements.roadDefs, this._elements.pathLayersGroup);
        this._elements.pathLayersGroup.append(...Object.values(this._elements.roadLayers));
        this._elements.pathLayersGroup.append(...Object.values(this._elements.userLayers));
        this._elements.map.append(this._elements.mapCanvas, this._elements.paths, this._elements.ents);
        this.el.addEventListener('wheel', this._onWheelZoom.bind(this), {passive: false /*mute warn*/});
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
        this._resizeObserver = new ResizeObserver(this._updateContainerLayout.bind(this));
        this._resizeObserver.observe(this.el);
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
        setTimeout(() => this._updateNativeFrameTime(), 1000);
        setInterval(() => this._updateNativeFrameTime(), 30_000);
        this._updateContainerLayout();
        this._pauseRefCnt--;
        this._gcLoop();
    }

    async _updateNativeFrameTime() {
        const fps = await common.testFrameRate();
        this._nativeFrameTime = 1000 / fps;
        this.setFPSLimit(this.fpsLimit);
    }

    _updateContainerLayout() {
        this._elRect = this.el.getBoundingClientRect();
        this._fullUpdateAsNeeded();
    }

    setFPSLimit(fps) {
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

    _fullUpdateAsNeeded() {
        const takeAction = !this.isPaused();
        if (takeAction) {
            this._updateGlobalTransform();
            if (this.worldMeta) {
                this._renderFrame();
            }
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
        const cd = this._elements.mapCanvas.dataset;
        const pixels = Number(cd.naturalWidth) * Number(cd.naturalHeight);
        if (!pixels) {
            console.warn("Using naive canvas scale method");
            return quality < 0.5 ? 0.25 : quality < 0.85 ? 0.5 : 1;
        }
        const pixelMegabyte = 1024 * 1024 / 4; // RGBA 8 bits per channel, 4 channels
        const lowBudget = 4 * pixelMegabyte; // ~1024^2
        const highBudget = 192 * pixelMegabyte; // ~7094^2
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

    pixelToCoord(px, py) {
        // TODO: handle tilt shift
        const cx = px - (this._elRect.width / 2);
        let cy = py - (this._elRect.height / 2);
        if (this.verticalOffset) {
            cy -= this.verticalOffset * this._elRect.height;
        }
        const [rcx, rcy] = this._unrotateWorldPos([cx, cy]);
        const l = Math.hypot(rcx, rcy);
        const a = Math.atan2(rcy, rcx) - (this._rotate / 180 * Math.PI);
        const s = 1 / (this.zoom * this.worldMeta.mapScale / this.worldMeta.tileScale);
        const center = this._unrotateWorldPos([
            this._centerXY[0] - this._dragXY[0],
            this._centerXY[1] - this._dragXY[1],
        ]);
        const x = Math.cos(a) * l * s + center[0];
        const y = Math.sin(a) * l * s + center[1];
        return [x, y];
    }

    _onWheelZoom(ev) {
        if (!ev.deltaY) {
            return;
        }
        ev.preventDefault();
        this.trackingPaused = true;
        if (!this.autoCenter && !this._wheelState.origin) {
            this._wheelState.origin = this.pixelToCoord(ev.clientX - this._elRect.x,
                                                        ev.clientY - this._elRect.y);
        }
        this._adjustZoom(-ev.deltaY / 2000 * this.zoom);
        cancelAnimationFrame(this._wheelState.nextAnimFrame);
        this._wheelState.nextAnimFrame = requestAnimationFrame(() => {
            if (this._wheelState.doneTimeout) {
                clearTimeout(this._wheelState.doneTimeout);
            } else {
                this._mapTransition.incDisabled();
            }
            const origin = this._wheelState.origin;
            if (origin) {
                this._wheelState.origin = null;
                const target = this.pixelToCoord(ev.clientX - this._elRect.x, ev.clientY - this._elRect.y);
                this.dragOffset[0] += target[0] - origin[0];
                this.dragOffset[1] += target[1] - origin[1];
                this._dragXY = this._rotateWorldPos(this.dragOffset);
            }
            this._applyZoom();
            // Lazy re-enable of animations to avoid need for forced paint
            this._wheelState.doneTimeout = setTimeout(() => {
                this.trackingPaused = false;
                this._wheelState.doneTimeout = null;
                this._wheelState.origin = null;
                this._mapTransition.decDisabled();
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
        this._fullUpdateAsNeeded();
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
            this._mapTransition.incDisabled();
            let x, y;
            [
                x,
                y,
                this.zoom,
                this._tiltAngle,
                this.verticalOffset,
                this._adjHeading
            ] = this._mapTransition.getValues();
            this._centerXY[0] = x + this._dragXY[0];
            this._centerXY[1] = y + this._dragXY[1];
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
                this.setHeadingOffset(heading);
                dragEv.heading = heading;
                const tiltShift = this.tiltShift - dy * 0.001;
                this.setTiltShift(tiltShift);
                dragEv.tiltShift = tiltShift;
            } else {
                const [tx, ty] = this._unrotateWorldPos([dx, dy]);
                const l = Math.sqrt(tx * tx + ty * ty);
                const a = Math.atan2(ty, tx) - (this._rotate / 180 * Math.PI);
                const adjX = Math.cos(a) * l;
                const adjY = Math.sin(a) * l;
                const f = this._canvasScale / (this.zoom * this._mapScale);
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
            this.el.classList.remove('moving');
            this._mapTransition.decDisabled();
            state.active = false;
        }
        document.removeEventListener('pointermove', this._onPointerMoveBound);
        document.removeEventListener('pointerup', this._onPointerDoneBound, {once: true});
        document.removeEventListener('pointercancel', this._onPointerDoneBound, {once: true});
        this._pointerState.ev1 = this._pointerState.ev2 = null;
        this.trackingPaused = false;
    }

    _updateMapBackground = common.asyncSerialize(async function() {
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
        const canvas = this._elements.mapCanvas;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.classList.toggle('hidden', !!this.portal);
        canvas.dataset.naturalWidth = img.naturalWidth;
        canvas.dataset.naturalHeight = img.naturalHeight;
        this._canvasScale = this._qualityToCanvasScale(this.quality);
        this._mapScale = this._canvasScale / (this.worldMeta.tileScale / this.worldMeta.mapScale);
        canvas.width = img.naturalWidth * this._canvasScale;
        canvas.height = img.naturalHeight * this._canvasScale;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        this._updateGlobalTransform();
        this._renderFrame(/*force*/ true);
    });

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
                this._updateGlobalTransform();
                this._renderFrame();
            } finally {
                this._mapTransition.decDisabled();
            }
        }
    }

    isPaused() {
        return this._pauseRefCnt > 0;
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
            this.courseId = courseId;
            this.portal = isPortal;
            const m = this.worldMeta = this.worldList.find(x => x.courseId === courseId);
            this._anchorXY = [m.minX + m.anchorX, m.minY + m.anchorY];
            this.rotateCoordinates = isPortal ? false : !!this.worldMeta.rotateRouteSelect;
            this.geoCenter = this._unrotateWorldPos([
                m.minX + ((m.maxX - m.minX) / 2) + m.anchorX,
                m.minY + ((m.maxY - m.minY) / 2) + m.anchorY,
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
        if (!this._renderLoopActive) {
            this._renderLoopActive = true;
            this._rafForRenderLoopBound();
        }
    });

    async _applyCourse() {
        const m = this.worldMeta;
        this._resetElements([
            m.minX + m.anchorX,
            m.minY + m.anchorY,
            m.maxX - m.minX,
            m.maxY - m.minY
        ]);
        const [roads] = await Promise.all([
            common.getRoads(this.courseId),
            this._updateMapBackground(),
        ]);
        this._renderRoads(roads);
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
        await this._updateMapBackground();
        this._renderRoads([road]);
        this.setActiveRoad(roadId);
    }

    _resetElements(viewBox) {
        this.clearRoute();
        this.roadId = null;
        Object.values(this._elements.roadLayers).forEach(x => x.replaceChildren());
        Object.values(this._elements.userLayers).forEach(x => x.replaceChildren());
        for (const ent of Array.from(this._ents.values()).filter(x => x.gc)) {
            this.removeEntity(ent);
        }
        this._elements.roadDefs.replaceChildren();
        this._elements.pins.replaceChildren();
        this._elements.paths.setAttribute('viewBox', viewBox.join(' '));
        this._elements.pathLayersGroup.classList.toggle('rotated-coordinates', !!this.rotateCoordinates);
        this._setHeading(0);
        this._pendingEntityUpdates.clear();
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
        const {surfacesLow, gutters} = this._elements.roadLayers;
        // Because roads overlap and we want to style some of them differently this
        // make multi-sport roads higher so we don't randomly style overlapping sections.
        roads = Array.from(roads);
        roads.sort((a, b) => a.sports.length - b.sports.length);
        for (const road of roads) {
            if ((!road.sports.includes('cycling') && !road.sports.includes('running')) || !road.isAvailable) {
                continue;
            }
            this._elements.roadDefs.append(createElementSVG('path', {
                id: `road-path-${road.id}`,
                d: road.curvePath.toSVGPath()
            }));
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
        this._routeHighlights.forEach(x => this.removeHighlightPath(x));
        this._routeHighlights.length = 0;
        this.routeId = null;
        this.route = null;
    }

    setActiveRoad(id) {
        this.roadId = id;
        this.clearRoute();
        const surface = this._elements.roadLayers.surfacesMid;
        let r = surface.querySelector('.road.active');
        if (!r) {
            r = createElementSVG('use', {class: 'road active'});
            surface.append(r);
        }
        r.setAttribute('href', `#road-path-${id}`);
    }

    setActiveRoute = common.asyncSerialize(async function(id, options={}) {
        if (typeof options === 'number') {
            console.warn("DEPRECATED use of laps argument");
            options = {showWeld: options > 1};
        }
        this.clearRoute();
        this.roadId = null;
        this.routeId = id;
        this.route = await common.getRoute(id);
        const activeRoad = this._elements.roadLayers.surfacesMid.querySelector('.road.active');
        if (activeRoad) {
            activeRoad.remove();
        }
        let fullPath, lapPath;
        const path = fullPath = lapPath = this.route.curvePath;
        const lapRoadIdx = this.route.manifest.findIndex(x => !x.leadin);
        const lapIdx = lapRoadIdx ? path.nodes.findIndex(x => x.index === lapRoadIdx) : 0;
        if (lapIdx) {
            lapPath = path.slice(lapIdx);
            if (!options.hideLeadin) {
                this._routeHighlights.push(this.addHighlightPath(path.slice(0, lapIdx), `rt-leadin-${id}`,
                                                                 {extraClass: 'route-leadin'}));
            } else {
                fullPath = path.slice(lapIdx);
            }
        }
        if (options.showWeld && this.route.lapWeldPath) {
            const weld = this.route.lapWeldPath;
            fullPath = fullPath.slice();
            fullPath.extend(weld);
            this._routeHighlights.push(this.addHighlightPath(weld, `route-weld-${id}`,
                                                             {extraClass: 'route-weld'}));
        }
        this._routeHighlights.push(
            this.addHighlightPath(lapPath, `rt-lap-${id}`, {extraClass: 'route-lap'}),
            this.addHighlightPath(fullPath, `rt-shadow-${id}`, {layer: 'low', extraClass: 'active-shadow'}),
            this.addHighlightPath(fullPath, `rt-gutters-${id}`, {layer: 'low', extraClass: 'active-gutter'})
        );

        return this.route;
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

    addHighlightPath(path, id, {debug, includeEdges=true, extraClass, width, color, layer='mid'}={}) {
        const elements = debug ? this._createDebugPathElements(path.nodes, layer) : [];
        const svgPath = createElementSVG('path', {
            class: `highlight ${extraClass || ''}`,
            "data-id": id,
            d: path.toSVGPath({includeEdges}),
        });
        if (width != null) {
            svgPath.style.setProperty('--width', width);
        }
        if (color != null) {
            svgPath.style.setProperty('stroke', color);
        }
        const surfaceEl = this._elements.userLayers[{
            high: 'surfacesHigh',
            mid: 'surfacesMid',
            low: 'surfacesLow',
        }[layer]];
        surfaceEl.append(svgPath);
        elements.push(svgPath);
        return {id, path, elements, svgPath, debug, includeEdges, layer};
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
        ent.addEventListener('pinned', ev => {
            if (ev.visible) {
                this._pinned.add(ent);
                this._elements.pins.append(ent.pin);
                this._pendingEntityUpdates.add(ent);
            } else {
                this._pinned.delete(ent);
            }
        });
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
        ent.togglePin();
    }

    setTransitionDuration(ms) {
        this._mapTransition.setDuration(ms);
    }

    getTransitionDuration(ms) {
        return this._mapTransition.duration;
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
                let routeId;
                let showWeld;
                let hideLeadin;
                if (watching.eventSubgroupId) {
                    const sg = await common.getEventSubgroup(watching.eventSubgroupId);
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
        const lowPrioAthleteUpdates = [];
        const highPrioAthleteUpdates = [];
        for (const state of states) {
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
            let category;
            if (state.eventSubgroupId) {
                const sg = getSubgroupLazy(state.eventSubgroupId);
                if (sg) {
                    category = sg.subgroupLabel;
                }
            }
            ent.setCategory(category);
            if (state.athleteId === this.watchingId && !this.trackingPaused) {
                this._autoHeadingSaved = state.heading;
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
        const mapAdj = this.rotateCoordinates ? 0 : -90;
        this._adjHeading = heading + this.headingOffset + this._headingRotations * 360 + mapAdj;
        this.heading = heading;
    }

    setCenter(pos) {
        this._setCenter(pos);
        this._fullUpdateAsNeeded();
    }

    _setCenter(pos) {
        this.center = pos;
        this._centerXY = this._rotateWorldPos(pos);
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

    _updateLayerScale(zoom, tiltAngle, force) {
        // This is a solution for 3 problems:
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
        let quality = this.quality;
        if (tiltAngle) {
            // When zoomed in tiltShift can exploded the GPU budget if a lot of
            // landscape is visible.  We need an additional scale factor to prevent
            // users from having to constantly adjust quality.
            quality *= Math.min(1, 20 / Math.max(0, tiltAngle - 30));
        }
        const scale = Math.max(0.05, Math.round(zoom * quality / this._canvasScale / 0.25) * 0.25);
        if (this._layerScale !== scale || force) {
            this._layerScale = scale;
            const {mapCanvas, ents, map} = this._elements;
            mapCanvas.style.setProperty('width', `${mapCanvas.width * scale}px`);
            mapCanvas.style.setProperty('height', `${mapCanvas.height * scale}px`);
            mapCanvas.classList.toggle('hidden', !!this.portal);
            ents.style.setProperty('left', `${-this._anchorXY[0] * scale * this._mapScale}px`);
            ents.style.setProperty('top', `${-this._anchorXY[1] * scale * this._mapScale}px`);
            map.style.setProperty('--layer-scale', scale * this._canvasScale);
            for (const x of this._ents.values()) {
                // force refresh of _all_ ents.
                this._pendingEntityUpdates.add(x);
            }
        }
    }

    _updateGlobalTransform() {
        const x = this._centerXY[0] - this._dragXY[0];
        const y = this._centerXY[1] - this._dragXY[1];
        this._mapTransition.setValues([
            x, y,
            this.zoom,
            this._tiltAngle,
            this.verticalOffset,
            this._adjHeading,
        ]);
    }

    _renderFrame(force, frameTime=timeline.currentTime) {
        this._frameTimeAvg = this._frameTimeWeighted(frameTime - this._lastFrameTime);
        this._lastFrameTime = frameTime;
        let affectedPins;
        const transform = (this._mapTransition.disabled || this._mapTransition.playing || force) &&
            this._mapTransition.getStep(frameTime);
        if (transform) {
            let {0: x, 1: y, 2: zoom, 3: tiltAngle, 4: vertOffset, 5: rotate} = transform;
            this._updateLayerScale(zoom, tiltAngle, force);
            const mlScale = this._mapScale * this._layerScale;
            x -= this._anchorXY[0];
            y -= this._anchorXY[1];
            x *= mlScale;
            y *= mlScale;
            const scale = zoom / this._layerScale / this._canvasScale;
            this._rotate = rotate;
            this._elements.map.style.setProperty('transform-origin', `${x}px ${y}px`);
            this._elements.map.style.setProperty('transform', `
                translate(${-x}px, ${-y}px)
                scale(${scale})
                ${tiltAngle ? `perspective(${this._perspective / scale}px) rotateX(${tiltAngle}deg)` : ''}
                ${vertOffset ? `translate(0, ${vertOffset * this._elRect.height / scale}px)` : ''}
                rotate(${rotate}deg)
            `);
            affectedPins = this._pinned.size ? Array.from(this._pinned).map(ent => ({ent})) : [];
        } else {
            affectedPins = [];
        }
        if (this._pendingEntityUpdates.size) {
            const scale = this._mapScale * this._layerScale;
            for (const ent of this._pendingEntityUpdates) {
                const pos = ent.transition.getStep(frameTime);
                if (pos) {
                    ent.el.style.setProperty('transform', `translate(${pos[0] * scale}px,
                                                                     ${pos[1] * scale}px)`);
                    if (!transform && ent.pin) {
                        affectedPins.push({ent});
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
        if (affectedPins.length) {
            // Avoid spurious reflow with batched reads followed by writes.
            const xOfft = -this._elRect.left;
            const yOfft = -this._elRect.top;
            for (let i = 0; i < affectedPins.length; i++) {
                const x = affectedPins[i];
                x.rect = x.ent.el.getBoundingClientRect();
            }
            for (let i = 0; i < affectedPins.length; i++) {
                const {rect, ent} = affectedPins[i];
                ent.pin.style.setProperty('transform', `translate(${rect.x + rect.width / 2 + xOfft}px,
                                                                  ${rect.y + yOfft}px)`);
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
        } else {
            this._rafForRenderLoopBound();
        }
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
