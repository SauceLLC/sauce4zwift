import * as common from './common.mjs';
import * as locale from '../../shared/sauce/locale.mjs';

const H = locale.human;
const svgInternalScale = 0.01;


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


function controlPoint(cur, prev, next, reverse, smoothing) {
    prev ||= cur;
    next ||= cur;
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) + (reverse ? Math.PI : 0);
    const length = distance * smoothing;
    return [cur[0] + Math.cos(angle) * length, cur[1] + Math.sin(angle) * length];
}


function smoothPath(points, {loop, smoothing=0.2}={}) {
    const path = ['M' + points[0].join()];
    if (loop) {
        for (let i = 1; i < points.length + 1; i++) {
            const prevPrev = points.at(i - 2);
            const prev = points.at(i - 1);
            const cur = points[i % points.length];
            const next = points.at((i + 1) % points.length);
            const cpStart = controlPoint(prev, prevPrev, cur, false, smoothing);
            const cpEnd = controlPoint(cur, prev, next, true, smoothing);
            path.push('C' + [cpStart.join(), cpEnd.join(), cur.join()].join(' '));
        }
    } else {
        for (let i = 1; i < points.length; i++) {
            const cpStart = controlPoint(points[i - 1], points[i - 2], points[i], false, smoothing);
            const cpEnd = controlPoint(points[i], points[i - 1], points[i + 1], true, smoothing);
            path.push('C' + [cpStart.join(), cpEnd.join(), points[i].join()].join(' '));
        }
    }
    return path.join('');
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
        this._disabledRefCnt = 0;
        this.disabled = false;
        this.playing = false;
    }

    now() {
        return performance.now();
    }

    incDisabled() {
        this._disabledRefCnt++;
        if (this._disabledRefCnt === 1) {
            this.disabled = true;
            this.playing = false;
            this._dst = Array.from(this._cur);
            this._startTime = this._endTime = 0;
        }
    }

    decDisabled() {
        this._disabledRefCnt--;
        if (this._disabledRefCnt < 0) {
            throw new Error("Transition disabled refcnt < 0");
        }
        if (this._disabledRefCnt === 0) {
            this.disabled = false;
            if (this.playing && this._remainingTime) {
                const now = this.now();
                this._startTime = now;
                this._endTime = now + this._remainingTime;
            }
            this._remainingTime = null;
        }
    }

    setDuration(duration) {
        if (!this.disabled) {
            this._recalcCurrent();
            if (this.playing) {
                // Prevent jitter by forwarding the current transition.
                this._src = Array.from(this._cur);
                this._startTime = this.now();
                this._endTime += duration - this.duration;
            }
        }
        this.duration = duration;
    }

    setValues(values) {
        if (!this.disabled) {
            if (this._dst) {
                const now = this.now();
                if (now < this._endTime) {
                    // Start from current position (and prevent Zeno's paradaox)
                    this._recalcCurrent();
                    this._src = this._cur.map((x, i) =>
                        Math.abs(values[i] - x) < this.EPSILON ? values[i] : x);
                } else {
                    // Start from last position.
                    this._src = this._dst;
                }
                this._startTime = now;
                this._endTime = now + this.duration;
                this.playing = true;
            }
            this._cur.length = values.length;
        } else {
            this._cur = Array.from(values);
        }
        this._dst = Array.from(values);
    }

    getStep() {
        if (this.disabled) {
            // Return the last used position
            return this._cur;
        } else if (this.playing) {
            this._recalcCurrent();
            return this._cur;
        } else if (this._dst) {
            return this._dst;
        }
    }

    getValues() {
        return this._dst ? Array.from(this._dst) : null;
    }

    _recalcCurrent() {
        const now = this.now();
        const progress = (now - this._startTime) / (this._endTime - this._startTime);
        if (progress >= 1 || this.disabled) {
            if (this._dst) {
                this._cur = this._dst;
            }
            this.playing = false;
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
        this.worldMeta = null;
        this.pin = null;
        this._pinContent = null;
        this._pinHTML = null;
        this._position = null;
    }

    setWorldMeta(wm) {
        this.worldMeta = wm;
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
            const pinInner = document.createElement('div');
            pinInner.classList.add('pin-inner');
            this.pin.append(pinInner);
            this._pinContent = document.createElement('div');
            this._pinContent.classList.add('pin-content');
            this._pinContent.addEventListener('click', ev => {
                if (!ev.target.closest('a')) {
                    this.togglePin(false);
                }
            });
            pinInner.append(this._pinContent);
            if (this._pinHTML) {
                this._pinContent.innerHTML = this._pinHTML;
            } else {
                this.pin.classList.add('hidden');
            }
        }
        const ev = new Event('pinned');
        ev.visible = !!this.pin;
        this.dispatchEvent(ev);
        return !!this.pin;
    }

    setPinHTML(html) {
        if (this._pinHTML === html) {
            return;
        }
        this._pinHTML = html;
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
        if (this.worldMeta && this.worldMeta.rotateRouteSelect) {
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


export class SauceZwiftMap extends EventTarget {
    constructor({el, worldList, zoom=1, zoomMin=0.25, zoomMax=10, autoHeading=true,
                 style='default', opacity=1, tiltShift=null, maxTiltShiftAngle=65,
                 sparkle=false, quality=1, verticalOffset=0, fpsLimit=30,
                 zoomPriorityTilt=true}) {
        super();
        el.classList.add('sauce-map-container');
        this.el = el;
        this.worldList = worldList;
        this.zoomMin = zoomMin;
        this.zoomMax = zoomMax;
        this.maxTiltShiftAngle = maxTiltShiftAngle;
        this.watchingId = null;
        this.athleteId = null;
        this.courseId = null;
        this.roadId = null;
        this.worldMeta = null;
        this.adjHeading = 0;
        this._headingRotations = 0;
        this._lastHeading = 0;
        this._headingOfft = 0;
        this._ents = new Map();
        this._pendingEntityUpdates = new Set();
        this._centerXY = [0, 0];
        this._anchorXY = [0, 0];
        this._dragXY = [0, 0];
        this._layerScale = null;
        this._pauseRefCnt = 0;
        this._pinned = new Set();
        this._mapScale = null;
        this._lastFrameTime = 0;
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
        this._mapTransition = new Transition({duration: 500});
        this._elements = {
            map: createElement('div', {class: 'sauce-map'}),
            mapCanvas: createElement('canvas', {class: 'map-background'}),
            ents: createElement('div', {class: 'entities'}),
            pins: createElement('div', {class: 'pins'}),
            roads: createElementSVG('svg', {class: 'roads'}),
            roadLayers: {
                defs: createElementSVG('defs'),
                gutters: createElementSVG('g', {class: 'gutters'}),
                surfacesLow: createElementSVG('g', {class: 'surfaces low'}),
                surfacesMid: createElementSVG('g', {class: 'surfaces mid'}),
                surfacesHigh: createElementSVG('g', {class: 'surfaces high'}),
            }
        };
        this._elements.roads.append(...Object.values(this._elements.roadLayers));
        this._elements.map.append(this._elements.mapCanvas, this._elements.roads,
                                  this._elements.ents);
        this.el.addEventListener('wheel', this._onWheelZoom.bind(this));
        this.el.addEventListener('pointerdown', this._onPointerDown.bind(this));
        this._elements.ents.addEventListener('click', this._onEntsClick.bind(this));
        this.incPause();
        this.setZoom(zoom);
        this.setAutoHeading(autoHeading);
        this.setStyle(style);
        this.setOpacity(opacity);
        this.setTiltShift(tiltShift);
        this.setZoomPriorityTilt(zoomPriorityTilt);
        this.setSparkle(sparkle);
        this.setQuality(quality);
        this.setVerticalOffset(verticalOffset);
        this.setFPSLimit(fpsLimit);
        this.el.append(this._elements.map, this._elements.pins);
        this._resizeObserver = new ResizeObserver(() => this._updateContainerLayout());
        this._resizeObserver.observe(this.el);
        this._updateContainerLayout();
        this.decPause();
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

    setStyle(style) {
        this.style = style || 'default';
        if (!this.isPaused()) {
            this._updateMapBackground();
        }
    }

    setOpacity(v) {
        this._elements.mapCanvas.style.setProperty('--opacity', isNaN(v) ? 1 : v);
    }

    _fullUpdateAsNeeded() {
        if (!this.isPaused()) {
            if (!this._adjustLayerScale()) {
                this._updateGlobalTransform({render: true});
            }
            return true;
        }
        return false;
    }

    setTiltShift(v) {
        v = v || null;
        this._tiltShift = v;
        this._fullUpdateAsNeeded();
    }

    setZoomPriorityTilt(en) {
        this._zoomPrioTilt = en;
        this._fullUpdateAsNeeded();
    }

    setSparkle(en) {
        this.el.classList.toggle('sparkle', !!en);
    }

    setQuality(q) {
        this.quality = q;
        this._fullUpdateAsNeeded();
    }

    setVerticalOffset(v) {
        this.verticalOffset = v;
        if (!this.isPaused()) {
            this._updateGlobalTransform({render: true});
        }
    }

    setZoom(zoom, options) {
        this.zoom = Math.max(this.zoomMin, Math.min(this.zoomMax, zoom));
        this._applyZoom(options);
    }

    setBounds(tl, br, pad=0.12) {
        let width = br[0] - tl[0];
        let height = tl[1] - br[1];
        const center = [tl[0] + width / 2, br[1] + height / 2];
        // As strange as this seems, every world is rotated by -90deg when other
        // correction factors are applied, so width and height are swapped for
        // purposes of finding our ideal bounding box sizes.
        [width, height] = [height, width];
        const boundsRatio = width / height;
        const viewRatio = this._elRect.width / this._elRect.height;
        const zoom = viewRatio > boundsRatio ?
            this._elRect.height / (height * (1 + pad) * this._mapScale) :
            this._elRect.width / (width * (1 + pad) * this._mapScale);
        this.setCenter(center);
        this.setZoom(zoom, {disableEvent: true});
    }

    _adjustZoom(adj) {
        this.zoom = Math.max(this.zoomMin, Math.min(this.zoomMax, this.zoom + adj));
    }

    _applyZoom(options={}) {
        this._elements.map.style.setProperty('--zoom', this.zoom);
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
        this._adjustZoom(-ev.deltaY / 2000 * this.zoom);
        cancelAnimationFrame(this._wheelState.nextAnimFrame);
        this._wheelState.nextAnimFrame = requestAnimationFrame(() => {
            if (this._wheelState.done) {
                clearTimeout(this._wheelState.done);
            } else {
                this._mapTransition.incDisabled();
            }
            this._applyZoom();
            // Lazy re-enable of animations to avoid need for forced paint
            this._wheelState.done = setTimeout(() => {
                this.trackingPaused = false;
                this._wheelState.done = null;
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

    setDragOffset(x, y) {
        this._dragXY[0] = x;
        this._dragXY[1] = y;
        if (!this.isPaused()) {
            this._updateGlobalTransform({render: true});
            const dragEv = new Event('drag');
            dragEv.drag = [x, y];
            this.dispatchEvent(dragEv);
        }
    }

    setAutoHeading(en) {
        if (!en) {
            this._setHeading(0);
        }
        this.autoHeading = en;
        if (!this.isPaused()) {
            this._updateGlobalTransform({render: true});
        }
    }

    _onPointerMove(ev) {
        const state = this._pointerState;
        if (!state.active) {
            state.active = true;
            this.trackingPaused = true;
            this.el.classList.add('moving');
            this._mapTransition.incDisabled();
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
            const deltaX = ev.pageX - state.lastX;
            const deltaY = ev.pageY - state.lastY;
            state.lastX = ev.pageX;
            state.lastY = ev.pageY;
            const x = this._dragXY[0] + (deltaX / this.zoom);
            const y = this._dragXY[1] + (deltaY / this.zoom);
            this.setDragOffset(x, y);
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

    async _updateMapBackground() {
        const suffix = {
            default: '',
            neon: '-neon',
        }[this.style];
        const canvas = this._elements.mapCanvas;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const img = new Image();
        img.src = `https://www.sauce.llc/products/sauce4zwift/maps/world` +
            `${this.worldMeta.worldId}${suffix || ''}.webp`;
        try {
            await img.decode();
        } catch(e) {
            console.warn("Image decode interrupted/failed", e);
            return;
        }
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
        this._adjustLayerScale({force: true});
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
                this._updateGlobalTransform({render: true});
            } finally {
                this._mapTransition.decDisabled();
            }
        }
    }

    isPaused() {
        return this._pauseRefCnt > 0;
    }

    async setCourse(courseId) {
        if (courseId === this.courseId) {
            console.warn("debounce setCourse");
            return;
        }
        this.incPause();
        try {
            await this._setCourse(courseId);
        } finally {
            this.decPause();
        }
    }

    async _setCourse(courseId) {
        this.courseId = courseId;
        const m = this.worldMeta = this.worldList.find(x => x.courseId === courseId);
        this._mapScale = 1 / (m.tileScale / m.mapScale);
        this._anchorXY[0] = -(m.minX + m.anchorX) * this._mapScale;
        this._anchorXY[1] = -(m.minY + m.anchorY) * this._mapScale;
        Object.values(this._elements.roadLayers).forEach(x => x.replaceChildren());
        this._elements.ents.replaceChildren();
        this._elements.pins.replaceChildren();
        this._elements.roads.setAttribute('viewBox', [
            (m.minX + m.anchorX) * svgInternalScale,
            (m.minY + m.anchorY) * svgInternalScale,
            (m.maxX - m.minX) * svgInternalScale,
            (m.maxY - m.minY) * svgInternalScale,
        ].join(' '));
        this._setHeading(0);
        this._ents.clear();
        this._pendingEntityUpdates.clear();
        const [roads] = await Promise.all([
            common.getRoads(this.worldMeta.worldId),
            this._updateMapBackground(),
        ]);
        this._renderRoads(roads);
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
        this.setDragOffset(0, 0);
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

    _fixWorldPos(pos) {
        return this.worldMeta.rotateRouteSelect ? [pos[1], -pos[0]] : pos;
    }

    _createRoadPath(points, id, loop) {
        const d = [];
        for (const pos of points) {
            const [x, y] = this._fixWorldPos(pos);
            d.push([x * svgInternalScale, y * svgInternalScale]);
        }
        return createElementSVG('path', {
            id: `road-path-${id}`,
            d: smoothPath(d, {loop})
        });
    }

    _renderRoads(roads, ids) {
        ids = ids || Object.keys(roads);
        const {defs, surfacesLow, gutters} = this._elements.roadLayers;
        // Because roads overlap and we want to style some of them differently this
        // make multi-sport roads higher so we don't randomly style overlapping sections.
        ids.sort((a, b) =>
            (roads[a] ? roads[a].sports.length : 0) -
            (roads[b] ? roads[b].sports.length : 0));
        for (const id of ids) {
            const road = roads[id];
            if (!road) {
                console.error("Road not found:", id);
                continue;
            }
            if (!road.sports.includes('cycling') && !road.sports.includes('running')) {
                continue;
            }
            const path = this._createRoadPath(road.path, id, road.looped);
            const clip = createElementSVG('clipPath', {id: `road-clip-${id}`});
            // These are not actually min/max if rotate hack is present.
            const boxC1 = this._fixWorldPos(road.boxMin);
            const boxC2 = this._fixWorldPos(road.boxMax);
            const clipBox = createElementSVG('path', {
                d: [
                    `M ${boxC1[0] * svgInternalScale} ${boxC1[1] * svgInternalScale}`,
                    `H ${boxC2[0] * svgInternalScale}`,
                    `V ${boxC2[1] * svgInternalScale}`,
                    `H ${boxC1[0] * svgInternalScale}`,
                    `Z`
                ].join('')
            });
            clip.append(clipBox);
            defs.append(path, clip);
            for (const g of [gutters, surfacesLow]) {
                g.append(createElementSVG('use', {
                    "class": road.sports.map(x => 'road sport-' + x).join(' '),
                    "data-id": id,
                    "clip-path": `url(#road-clip-${id})`,
                    "href": `#road-path-${id}`,
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

    setActiveRoad(id) {
        this.roadId = id;
        const surface = this._elements.roadLayers.surfacesMid;
        let r = surface.querySelector('.road.active');
        if (!r) {
            r = createElementSVG('use', {class: 'road active'});
            surface.append(r);
        }
        r.setAttribute('clip-path', `url(#road-clip-${id})`);
        r.setAttribute('href', `#road-path-${id}`);
    }

    addHighlightPath(points, id, loop) {
        const path = this._createRoadPath(points, id, loop);
        this._elements.roadLayers.defs.append(path);
        const node = createElementSVG('use', {
            "class": `highlight`,
            "data-id": id,
            "href": `#road-path-${id}`,
        });
        this._elements.roadLayers.surfacesHigh.append(node);
        return {path, node};
    }

    addEntity(ent) {
        if (!(ent instanceof MapEntity)) {
            throw new TypeError("MapEntity argument required");
        }
        if (this._ents.has(ent.id)) {
            throw new Error("id already in use");
        }
        ent.setWorldMeta(this.worldMeta);
        this._ents.set(ent.id, ent);
        this._pendingEntityUpdates.add(ent);
        ent.addEventListener('position', () => this._pendingEntityUpdates.add(ent));
    }

    removeEntity(ent) {
        this._ents.delete(ent.id);
        this._pinned.delete(ent);
        this._pendingEntityUpdates.delete(ent);
        ent.togglePin(false);
        ent.el.remove();
    }

    _addAthleteEntity(state) {
        const ent = new MapEntity(state.athleteId, 'athlete');
        ent.lastSeen = 0;
        ent.gc = true;
        ent.delayEst = common.expWeightedAvg(6, 2000);
        ent.el.classList.toggle('self', state.athleteId === this.athleteId);
        ent.el.classList.toggle('watching', state.athleteId === this.watchingId);
        ent.setPinHTML('<ms>hourglass_empty</ms>...');
        ent.setWorldMeta(this.worldMeta);
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

    renderAthleteStates(states) {
        if (this.watchingId == null) {
            return;
        }
        const watching = states.find(x => x.athleteId === this.watchingId);
        if (!watching && this.courseId == null) {
            return;
        } else if (watching) {
            if (watching.courseId !== this.courseId) {
                console.debug("Setting new course:", watching.courseId);
                this.setCourse(watching.courseId);
            }
            if (watching.roadId !== this.roadId) {
                this.setActiveRoad(watching.roadId);
            }
        }
        const now = Date.now();
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
            if (ent.pin) {
                const ad = common.getAthleteDataCacheEntry(state.athleteId);
                console.log('pin', ad);
                const athlete = ad?.athlete;
                const name = athlete ? `${athlete.fLast}` : `ID: ${state.athleteId}`;
                const avatar = athlete?.avatar ?
                    `<avatar-pad></avatar-pad><img class="avatar" src="${athlete.avatar}"/>` : '';
                ent.setPinHTML(`
                    <a href="/pages/profile.html?id=${state.athleteId}&windowType=profile"
                       target="profile_popup_${state.athleteId}">${common.sanitize(name)}${avatar}</a><br/>
                    Power: ${H.power(state.power, {suffix: true, html: true})}<br/>
                    Speed: ${H.pace(state.speed, {suffix: true, html: true, sport: state.sport})}
                `);
            }
            if (state.athleteId === this.watchingId && !this.trackingPaused) {
                if (this.autoHeading) {
                    this._setHeading(state.heading);
                }
                this.setCenter([state.x, state.y]);
            }
            this._pendingEntityUpdates.add(ent);
        }
        common.idle().then(() => this._updateAthleteDetails(states.map(x => x.athleteId)));
    }

    setCenter(pos) {
        const [x, y] = this._fixWorldPos(pos);
        this._centerXY[0] = x * this._mapScale;
        this._centerXY[1] = y * this._mapScale;
        this._updateGlobalTransform();
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

    _adjustLayerScale({force}={}) {
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
        //  The technique here is quite simple, we just examine the zoom level and
        //  essentially swap out the layer with a different size.  Currently we just
        //  use the same assets.  The SVG scales of course, and the img is only ever
        //  scaled down (mostly).  It introduces some jank, so we chunk this operation
        //  to only perform as needed to stay within GPU constraints.
        const chunk = 0.5; // How frequently we jank.
        const adjZoom = Math.min(
            this.zoomMax,
            Math.max(this.zoomMin, Math.round(1 / this.zoom / chunk) * chunk));
        let quality = this.quality;
        if (this._tiltShift) {
            // When zoomed in tiltShift can exploded the GPU budget if a lot of
            // landscape is visible.  We need an additional scale factor to prevent
            // users from having to constantly adjust quality.
            const tiltFactor = this._zoomPrioTilt ? Math.min(1, (1 / this.zoomMax * (this.zoom + 1))) : 1;
            this._tiltShiftAngle = this._tiltShift * this.maxTiltShiftAngle * tiltFactor;
            quality *= Math.min(1, 15 / Math.max(0, this._tiltShiftAngle - 30));
        } else {
            this._tiltShiftAngle = 0;
        }
        const scale = 1 / adjZoom * quality;
        this._tiltHeight = this._tiltShift ? 800 / (this.zoom / scale) : 0;
        if (force || this._layerScale !== scale) {
            this.incPause();
            this._layerScale = scale;
            const {mapCanvas, ents, map} = this._elements;
            mapCanvas.style.setProperty('width', `${mapCanvas.width * scale}px`);
            mapCanvas.style.setProperty('height', `${mapCanvas.height * scale}px`);
            ents.style.setProperty('left', `${this._anchorXY[0] * scale}px`);
            ents.style.setProperty('top', `${this._anchorXY[1] * scale}px`);
            map.style.setProperty('--layer-scale', scale);
            for (const x of this._ents.values()) {
                // force refresh of _all_ ents.
                this._pendingEntityUpdates.add(x);
            }
            this.decPause();
            return true;
        }
        return false;
    }

    _updateGlobalTransform(options={}) {
        if (this._layerScale == null) {
            return;
        }
        const scale = this.zoom / this._layerScale;
        const relX = this._anchorXY[0] + this._centerXY[0];
        const relY = this._anchorXY[1] + this._centerXY[1];
        const dragX = this._dragXY[0] * scale;
        const dragY = this._dragXY[1] * scale;
        const tX = -(relX - dragX) * this._layerScale;
        const tY = -(relY - dragY) * this._layerScale;
        const originX = relX * this._layerScale;
        const originY = relY * this._layerScale;
        let vertOffset = 0;
        if (this.verticalOffset) {
            const height = this._elRect.height * this._layerScale / this.zoom;
            vertOffset = this.verticalOffset * height;
        }
        this._mapTransition.setValues([
            originX, originY,
            tX, tY,
            scale,
            this._tiltHeight, this._tiltShiftAngle,
            vertOffset,
            this.adjHeading,
        ]);
        if (options.render) {
            this._renderFrame();
        }
    }

    _transformAnimationLoop(frameTime) {
        requestAnimationFrame(this._transformAnimationLoopBound);
        if (frameTime - this._lastFrameTime < this._msPerFrame) {
            return;
        }
        this._lastFrameTime = frameTime;
        this._renderFrame();
    }

    _renderFrame() {
        let affectedPins;
        const transform = (this._mapTransition.disabled || this._mapTransition.playing) &&
            this._mapTransition.getStep();
        if (transform) {
            const [oX, oY, tX, tY, scale, tiltHeight, tiltAngle, vertOffset, rotate] = transform;
            this._elements.map.style.setProperty('transform-origin', `${oX}px ${oY}px`);
            this._elements.map.style.setProperty('transform', `
                translate(${tX}px, ${tY}px)
                scale(${scale})
                ${tiltHeight ? `perspective(${tiltHeight}px) rotateX(${tiltAngle}deg)` : ''}
                ${vertOffset ? `translate(0, ${vertOffset}px)` : ''}
                rotate(${rotate}deg)
            `);
            affectedPins = this._pinned.size ? Array.from(this._pinned).map(ent => ({ent})) : [];
        } else {
            affectedPins = [];
        }
        const scale = this._mapScale * this._layerScale;
        for (const ent of this._pendingEntityUpdates) {
            const pos = ent.transition.getStep();
            if (pos) {
                ent.el.style.setProperty('transform', `translate(${pos[0] * scale}px, ${pos[1] * scale}px)`);
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
                ent.pin.style.setProperty(
                    'transform', `translate(${rect.x + rect.width / 2 + xOfft}px, ${rect.y + yOfft}px)`);
            }
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

    async _updateAthleteDetails(ids) {
        const ads = await common.getAthletesDataCached(ids);
        for (const ad of ads) {
            const ent = this._ents.get(ad?.athleteId);
            if (ent && ad) {
                this._updateEntityAthleteData(ent, ad);
            }
        }
    }

    setHeadingOffset(deg) {
        this._headingOfft = deg || 0;
        this._setHeading(this._lastHeading, true);
        this._updateGlobalTransform({render: true});
    }

    _setHeading(heading, force) {
        if (!force && this.trackingPaused) {
            return false;
        }
        if (Math.abs(this._lastHeading - heading) > 180) {
            this._headingRotations += Math.sign(this._lastHeading - heading);
        }
        const mapAdj = this.worldMeta ? (this.worldMeta.rotateRouteSelect ? 0 : -90) : 0;
        this.adjHeading = heading + this._headingRotations * 360 + this._headingOfft + mapAdj;
        this._lastHeading = heading;
        return true;
    }
}

self.common = common;
