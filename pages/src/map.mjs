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


function smoothPath(points, {looped, smoothing=0.2}={}) {
    const path = ['M' + points[0].join()];
    if (looped) {
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


function isVisible() {
    return document.visibilityState === 'visible';
}

let idle;
if (window.requestIdleCallback) {
    idle = options => new Promise(resolve => requestIdleCallback(resolve, options));
} else {
    idle = () => new Promise(resolve => setTimeout(resolve, 10 + 1000 * Math.random()));
}


class Transition {
    constructor({duration=1000}={}) {
        this.duration = duration;
        this.disabled = false;
        this._src = undefined;
        this._cur = undefined;
        this._dst = undefined;
        this._startTime = 0;
        this._endTime = 0;
        this._disabledRefCnt = 0;
        this.disabled = false;
        this.active = false;
    }

    incDisabled() {
        this._disabledRefCnt++;
        this.disabled = !!this._disabledRefCnt;
        this.active = false;
        this._startTime = 0;
        this._endTime = 0;
    }

    decDisabled() {
        this._disabledRefCnt--;
        if (this._disabledRefCnt < 0) {
            throw new Error("Transition disabled refcnt < 0");
        }
        this.disabled = !!this._disabledRefCnt;
    }

    setDuration(duration) {
        if (this.active) {
            // Prevent jitter by forwarding the current transition.
            this._recalcCurrent();
            this._src = Array.from(this._cur);
            this._startTime = Date.now();
            this._endTime += duration - this.duration;
        }
        this.duration = duration;
    }

    setValues(values) {
        if (!this.disabled) {
            const now = Date.now();
            if (now < this._endTime) {
                // We're interrrupting an active transition.  Set our src to the
                // current frame values.
                this._recalcCurrent();
                this._src = Array.from(this._cur);
            } else if (this._dst) {
                this._src = Array.from(this._dst);
            }
            this._startTime = now;
            this._endTime = now + (this._src ? this.duration : 0);
            this.active = true;
        }
        this._dst = Array.from(values);
    }

    getStep() {
        this._recalcCurrent();
        return this._cur;
    }

    _recalcCurrent() {
        const progress = (Date.now() - this._startTime) / (this._endTime - this._startTime);
        if (this.disabled || progress >= 1) {
            this._cur = this._dst && Array.from(this._dst);
            this.active = false;
        } else {
            this._cur = this._cur || [];
            for (let i = 0; i < this._dst.length; i++) {
                const delta = this._dst[i] - this._src[i];
                this._cur[i] = this._src[i] + (delta * progress);
            }
        }
    }
}


// See: https://developer.mozilla.org/en-US/docs/Web/CSS/transform-function/matrix
// for explanations of all the matrix shapes.
class MatrixTransformTransition extends Transition {
    constructor(options) {
        super(options);
        const el = document.createElement('div');
        el.style.setProperty('visibility', 'hidden');
        el.style.setProperty('opacity', '0');
        el.style.setProperty('z-index', '-10000000');
        el.style.setProperty('position', 'fixed');
        el.style.setProperty('top', '-1000000px');
        el.style.setProperty('left', '-1000000px');
        el.style.setProperty('width', '0');
        el.style.setProperty('height', '0');
        this._computed = getComputedStyle(el);
        this._el = el;
        this._3d = false;
        document.body.append(el);
    }

    _2dTo3dMatrix([a, b, c, d, x, y]) {
        return [
            a, b, 0, 0,
            c, d, 0, 0,
            0, 0, 1, 0,
            x, y, 0, 1,
        ];
    }

    setTransform(value) {
        this._el.style.setProperty('transform', value);
        const parts = this._computed.getPropertyValue('transform').split(/[(,)]/);
        const type = parts[0];
        let matrix = parts.slice(1, -1).map(Number);
        if (type === 'matrix') {
            matrix = this._3d ? this._2dTo3dMatrix(matrix) : matrix;
        } else if (type === 'matrix3d') {
            this._3d = true;
        } else {
            throw new TypeError('Unhandled transform type: ' + type);
        }
        this.setValues(matrix);
    }

    getTransformStep() {
        const s = this.getStep();
        const type = this._3d ? 'matrix3d' : 'matrix';
        return s && `${type}(${s.join()})`;
    }
}


export class SauceZwiftMap extends EventTarget {
    constructor({el, worldList, zoom=1, zoomMin=0.25, zoomMax=4.5, autoHeading=true,
                 style='default', opacity=1, tiltShift=null, maxTiltShiftAngle=60,
                 sparkle=false, quality=1, verticalOffset=0, fpsLimit=60}) {
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
        this._athleteCache = new Map();
        this._centerXY = [0, 0];
        this._anchorXY = [0, 0];
        this._dragXY = [0, 0];
        this._layerScale = null;
        this._pauseRefCnt = 0;
        this._pendingEntityUpdates = new Set();
        this._mapFinalScale = null;
        this._lastFrameTime = 0;
        this._frameCount = 0;
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
        this._mapTransformTransition = new MatrixTransformTransition({duration: 500});
        this._mapOriginTransition = new Transition({duration: 500});
        this.mapEl = document.createElement('div');
        this.mapEl.classList.add('sauce-map');
        this.entsEl = document.createElement('div');
        this.entsEl.classList.add('entities');
        this.pinned = new Set();
        this.pinsEl = document.createElement('div');
        this.pinsEl.classList.add('pins');
        this.roadsSvg = createElementSVG('svg');
        this.roadsSvg.classList.add('roads');
        this.mapCanvas = document.createElement('canvas');
        this.mapCanvas.classList.add('map-background');
        this.mapCanvas = document.createElement('canvas');
        this.mapCanvas.classList.add('map-background');
        this.mapCanvasCtx = this.mapCanvas.getContext('2d', {alpha: true});
        this.mapImage = new Image();
        this.mapImage.loading = 'eager';
        this.mapEl.append(this.mapCanvas, this.roadsSvg, this.entsEl);
        this.el.addEventListener('wheel', this._onWheelZoom.bind(this));
        this.el.addEventListener('pointerdown', this._onPointerDown.bind(this));
        this.entsEl.addEventListener('click', this._onEntsClick.bind(this));
        this.incPause();
        this.setZoom(zoom);
        this.setAutoHeading(autoHeading);
        this.setStyle(style);
        this.setOpacity(opacity);
        this.setTiltShift(tiltShift);
        this.setSparkle(sparkle);
        this.setQuality(quality);
        this.setVerticalOffset(verticalOffset);
        this.setFPSLimit(fpsLimit);
        this._resizeObserver = new ResizeObserver(([x]) => this._elHeight = x.contentRect.height);
        this._resizeObserver.observe(this.el);
        this.el.append(this.mapEl, this.pinsEl);
        this._elHeight = this.el.clientHeight;
        this.decPause();
        this._gcLoop();
        requestAnimationFrame(this._transformAnimationLoopBound);
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
        this.mapCanvas.style.setProperty('--opacity', isNaN(v) ? 1 : v);
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
        this._tiltShiftNorm = v ? (1 / this.zoomMax) * v * this.maxTiltShiftAngle : null;
        this.el.classList.toggle('tilt-shift', !!v);
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

    setZoom(zoom) {
        this.zoom = zoom;
        this._applyZoom();
    }

    _adjustZoom(adj) {
        this.zoom = Math.max(this.zoomMin, Math.min(this.zoomMax, this.zoom + adj));
    }

    _applyZoom() {
        this.mapEl.style.setProperty('--zoom', this.zoom);
        if (this._fullUpdateAsNeeded()) {
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
                /*this.el.classList.add('zooming');*/
                this._mapTransformTransition.incDisabled();
                this._mapOriginTransition.incDisabled();
            }
            this._applyZoom();
            // Lazy re-enable of animations to avoid need for forced paint
            this._wheelState.done = setTimeout(() => {
                this.trackingPaused = false;
                this._wheelState.done = null;
                /*this.el.classList.remove('zooming');*/
                this._mapTransformTransition.decDisabled();
                this._mapOriginTransition.decDisabled();
            }, 100);
        });
    }

    _onPointerDown(ev) {
        const state = this._pointerState;
        if (ev.button !== 0 || (state.ev1 && state.ev2)) {
            return;
        }
        this.trackingPaused = true;
        if (state.ev1) {
            state.ev2 = ev;
            this.el.classList.remove('moving');
            //this.el.classList.add('zooming');
            state.lastDistance = Math.sqrt(
                (ev.pageX - state.ev1.pageX) ** 2 +
                (ev.pageY - state.ev1.pageY) ** 2);
            return;
        } else {
            state.ev1 = ev;
        }
        this.el.classList.add('moving');
        this._mapTransformTransition.incDisabled();
        this._mapOriginTransition.incDisabled();
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
        if (!state.ev2) {
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
        } else {
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
    }

    _onPointerDone(ev) {
        this.el.classList.remove('moving');
        this._mapTransformTransition.decDisabled();
        this._mapOriginTransition.decDisabled();
        document.removeEventListener('pointermove', this._onPointerMoveBound);
        this._pointerState.ev1 = this._pointerState.ev2 = null;
        this.trackingPaused = false;
    }

    async _updateMapBackground() {
        const suffix = {
            default: '',
            neon: '-neon',
        }[this.style];
        this.mapCanvasCtx.clearRect(0, 0, this.mapCanvas.width, this.mapCanvas.height);
        this.mapImage.src = `https://www.sauce.llc/products/sauce4zwift/maps/world` +
            `${this.worldMeta.worldId}${suffix || ''}.webp`;
        try {
            await this.mapImage.decode();
        } catch(e) {
            console.warn("Image decode interrupted/failed", e);
            return;
        }
        this.mapCanvas.width = this.mapImage.naturalWidth;
        this.mapCanvas.height = this.mapImage.naturalHeight;
        this.mapCanvasCtx.drawImage(this.mapImage, 0, 0);
        this._adjustLayerScale({force: true});
    }

    incPause() {
        this._pauseRefCnt++;
        if (this._pauseRefCnt === 1) {
            this._mapTransformTransition.incDisabled();
            this._mapOriginTransition.incDisabled();
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
                this._mapTransformTransition.decDisabled();
                this._mapOriginTransition.decDisabled();
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
        this.worldMeta = this.worldList.find(x => x.courseId === courseId);
        const {minX, minY, tileScale, mapScale, anchorX, anchorY} = this.worldMeta;
        this._mapScale = 1 / (tileScale / mapScale);
        this._anchorXY[0] = -(minX + anchorX) * this._mapScale;
        this._anchorXY[1] = -(minY + anchorY) * this._mapScale;
        this._setHeading(0);
        for (const x of this._ents.values()) {
            x.remove();
        }
        this._ents.clear();
        this._athleteCache.clear();
        const [roads] = await Promise.all([
            common.getRoads(this.worldMeta.worldId),
            this._updateMapBackground(),
        ]);
        this._renderRoads(roads);
    }

    setWatching(id) {
        if (this.watchingId != null && this._ents.has(this.watchingId)) {
            const ent = this._ents.get(this.watchingId);
            ent.classList.remove('watching');
        }
        this.watchingId = id;
        if (id != null && this._ents.has(id)) {
            const ent = this._ents.get(id);
            ent.classList.add('watching');
        }
        this.setDragOffset(0, 0);
    }

    setAthlete(id) {
        if (this.athleteId != null && this._ents.has(this.athleteId)) {
            const ent = this._ents.get(this.athleteId);
            ent.classList.remove('self');
        }
        this.athleteId = id;
        if (id != null && this._ents.has(id)) {
            const ent = this._ents.get(id);
            ent.classList.add('self');
        }
    }

    _fixWorldPos(pos) {
        // Maybe zomday I'll know why...
        return this.worldMeta.mapRotateHack ? [pos[1], -pos[0]] : pos;
    }

    _renderRoads(roads, ids) {
        ids = ids || Object.keys(roads);
        const defs = createElementSVG('defs');
        // Because roads overlap and we want to style some of them differently this
        // make multi-sport roads higher so we don't randomly style overlapping sections.
        ids.sort((a, b) =>
            (roads[a] ? roads[a].sports.length : 0) -
            (roads[b] ? roads[b].sports.length : 0));
        const roadways = {gutter: [], surface: []};
        for (const id of ids) {
            const road = roads[id];
            if (!road) {
                console.error("Road not found:", id);
                continue;
            }
            if (!road.sports.includes('cycling') && !road.sports.includes('running')) {
                continue;
            }
            const d = [];
            for (const pos of road.path) {
                const [x, y] = this._fixWorldPos(pos);
                d.push([x * svgInternalScale, y * svgInternalScale]);
            }
            const path = createElementSVG('path', {
                id: `road-path-${id}`,
                d: smoothPath(d, {looped: road.looped})
            });
            const clip = createElementSVG('clipPath', {id: `road-clip-${id}`});
            let boxMin = this._fixWorldPos(road.boxMin);
            let boxMax = this._fixWorldPos(road.boxMax);
            if (this.worldMeta.mapRotateHack) {
                [boxMin, boxMax] = [boxMax, boxMin];
            }
            const clipBox = createElementSVG('path', {
                d: [
                    `M ${boxMin[0] * svgInternalScale} ${boxMin[1] * svgInternalScale}`,
                    `H ${boxMax[0] * svgInternalScale}`,
                    `V ${boxMax[1] * svgInternalScale}`,
                    `H ${boxMin[0] * svgInternalScale}`,
                    `Z`
                ].join('')
            });
            clip.append(clipBox);
            defs.append(path, clip);
            for (const [key, arr] of Object.entries(roadways)) {
                arr.push(createElementSVG('use', {
                    "class": `${key} ${road.sports.map(x => 'sport-' + x).join(' ')}`,
                    "data-road-id": id,
                    "clip-path": `url(#road-clip-${id})`,
                    "href": `#road-path-${id}`,
                }));
            }
        }
        this.roadsSvg.setAttribute('viewBox', [
            (this.worldMeta.minX + this.worldMeta.anchorX) * svgInternalScale,
            (this.worldMeta.minY + this.worldMeta.anchorY) * svgInternalScale,
            (this.worldMeta.maxX - this.worldMeta.minX) * svgInternalScale,
            (this.worldMeta.maxY - this.worldMeta.minY) * svgInternalScale,
        ].join(' '));
        this._activeRoad = createElementSVG('use', {"class": 'surface active'});
        if (this.roadId != null) {
            this.setRoad(this.roadId);
        }
        // SVG doesn't have z-index, element order is therefore critical.
        this.roadsSvg.replaceChildren(
            defs,
            ...roadways.gutter,
            ...roadways.surface,
            this._activeRoad);
    }

    setRoad(id) {
        this.roadId = id;
        if (!this._activeRoad) {
            return;
        }
        this._activeRoad.setAttribute('clip-path', `url(#road-clip-${id})`);
        this._activeRoad.setAttribute('href', `#road-path-${id}`);
    }

    _addAthleteEntity(state) {
        const ent = document.createElement('div');
        ent.new = true;
        ent.classList.add('entity', 'athlete');
        ent.classList.toggle('self', state.athleteId === this.athleteId);
        ent.classList.toggle('watching', state.athleteId === this.watchingId);
        ent.dataset.athleteId = ent.athleteId = state.athleteId;
        ent.lastSeen = Date.now();
        ent.wt = state.worldTime;
        ent.transition = new Transition({duration: 2000});
        ent.delayEst = common.expWeightedAvg(4, 1000);
        ent.addEventListener('click', ev => {
            console.log("direct handler", ev);
            return;
            /*
            if (!ent.pin) {
                const pin = document.createElement('div');
                pin.setAttribute('tabindex', 0); // Support click to focus
                pin.classList.add('pin-anchor');
                const pinInner = document.createElement('div');
                pinInner.classList.add('pin-inner');
                pin.append(pinInner);
                const pinContent = document.createElement('div');
                pinContent.classList.add('pin-content');
                pinInner.append(pinContent);
                ent.pin = pin;
                this.pinsEl.append(pin);
                this.pinned.add(ent);
            } else {
                this.pinned.delete(ent);
                ent.pin.remove();
                ent.pin = null;
            }
            */
        });
        this._ents.set(state.athleteId, ent);
    }

    _onEntsClick(ev) {
        console.warn('delegate handler', ev);
        return;
        /*
        if (!ent.pin) {
            const pin = document.createElement('div');
            pin.setAttribute('tabindex', 0); // Support click to focus
            pin.classList.add('pin-anchor');
            const pinInner = document.createElement('div');
            pinInner.classList.add('pin-inner');
            pin.append(pinInner);
            const pinContent = document.createElement('div');
            pinContent.classList.add('pin-content');
            pinInner.append(pinContent);
            ent.pin = pin;
            this.pinsEl.append(pin);
            this.pinned.add(ent);
        } else {
            this.pinned.delete(ent);
            ent.pin.remove();
            ent.pin = null;
        }
        */
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
                this.setRoad(watching.roadId);
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
            ent.dataset.powerLevel = powerLevel;
            ent.wt = state.worldTime;
            ent.lastSeen = now;
            const age = state.worldTime - ent.wt;
            if (age) {
                // Try to stay active for smoother view, but also stay close to nominal latency
                const influence = ent.active ? age + 200 : age * 2;
                const duration = ent.delayEst(influence);
                ent.transition.setDuration(duration);
            }
            const pos = this._fixWorldPos([state.x, state.y]);
            ent.transition.setValues(pos);
            if (ent.pin) {
                const ad = this._athleteCache.get(state.athleteId);
                const name = ad && ad.data.athlete ?
                    `${ad.data.athlete.fLast}` : `ID: ${state.athleteId}`;
                common.softInnerHTML(ent.pin.querySelector('.pin-content'), `
                    <b>${common.sanitize(name)}</b><br/>
                    Power: ${H.power(state.power, {suffix: true, html: true})}<br/>
                    Speed: ${H.pace(state.speed, {suffix: true, html: true})}
                `);
            }
            if (state.athleteId === this.watchingId && !this.trackingPaused) {
                if (this.autoHeading) {
                    this._setHeading(state.heading);
                }
                this._centerXY[0] = pos[0] * this._mapScale;
                this._centerXY[1] = pos[1] * this._mapScale;
                this._updateGlobalTransform();
            }
            this._pendingEntityUpdates.add(ent);
        }
        idle().then(() => this._lazyUpdateAthleteDetails(states.map(x => x.athleteId)));
    }

    async _gcLoop() {
        await idle({timeout: 1000});
        setTimeout(() => this._gcLoop(), 10000);
        const now = Date.now();
        for (const [athleteId, ent] of this._ents.entries()) {
            if (now - ent.lastSeen > 15000) {
                ent.remove();
                if (ent.pin) {
                    ent.pin.remove();
                }
                this._pendingEntityUpdates.delete(ent);
                this._ents.delete(athleteId);
            }
        }
    }

    _updatePins() {
        const transforms = [];
        // Avoid spurious reflow with batched reads followed by writes.
        for (const ent of this.pinned) {
            const rect = ent.getBoundingClientRect();
            transforms.push([ent.pin, rect]);
        }
        for (const [pin, rect] of transforms) {
            pin.style.setProperty('transform', `translate(${rect.x + rect.width / 2}px, ${rect.y}px)`);
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
        let quality = this.quality;
        if (this._tiltShift) {
            // When zoomed in tiltShift can exploded the GPU budget if a lot of
            // landscape is visible.  We need an additional scale factor to prevent
            // users from having to constantly adjust quality.
            const angle = this.zoom * this._tiltShiftNorm;
            quality *= Math.min(1, 10 / Math.max(0, angle - 30));
        }
        const adjZoom = Math.min(
            this.zoomMax,
            Math.max(this.zoomMin, Math.round(1 / this.zoom / chunk) * chunk));
        const scale = 1 / adjZoom * quality;
        if (force || this._layerScale !== scale) {
            this.incPause();
            this._layerScale = scale;
            const width = Math.round(this.mapImage.naturalWidth * scale);
            const height = Math.round(this.mapImage.naturalHeight * scale);
            this.mapCanvas.style.setProperty('width', width + 'px');
            this.mapCanvas.style.setProperty('height', height + 'px');
            this.entsEl.style.setProperty('left', `${this._anchorXY[0] * scale}px`);
            this.entsEl.style.setProperty('top', `${this._anchorXY[1] * scale}px`);
            this.mapEl.style.setProperty('--layer-scale', scale);
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
        const tX = (relX - dragX) * this._layerScale;
        const tY = (relY - dragY) * this._layerScale;
        const originX = relX * this._layerScale;
        const originY = relY * this._layerScale;
        const transforms = [
            `translate(${-tX}px, ${-tY}px)`,
            `scale(${scale})`,
        ];
        if (this._tiltShift) {
            transforms.push(
                `perspective(${800 / scale}px)`,
                `rotateX(${this.zoom * this._tiltShiftNorm}deg)`);
        }
        if (this.verticalOffset) {
            const height = this._elHeight * this._layerScale / this.zoom;
            const offt = this.verticalOffset * height;
            transforms.push(`translate(0, ${offt}px)`);
        }
        transforms.push(`rotate(${this.adjHeading}deg)`);
        this._mapOriginTransition.setValues([originX, originY]);
        this._mapTransformTransition.setTransform(transforms.join(' '));
        if (options.render) {
            this._renderFrame();
            this._updatePins(); // XXX Split out animation and rendering of this.
        }
    }

    _transformAnimationLoop(frameTime) {
        requestAnimationFrame(this._transformAnimationLoopBound);
        if (frameTime - this._lastFrameTime < this._msPerFrame) {
            return;
        }
        this._lastFrameTime = frameTime;
        this._frameCount++;
        if (!this._firstFrameTime) {
            this._firstFrameTime = frameTime;
        } else if (this._frameCount % this.fpsLimit === 0) {
            console.debug('fps', this._frameCount / ((frameTime - this._firstFrameTime) / 1000));
        }
        this._renderFrame();
    }

    _renderFrame() {
        const transform = this._mapTransformTransition.getTransformStep();
        const origin = this._mapOriginTransition.getStep();
        if (transform && origin) {
            this.mapEl.style.setProperty('transform-origin', `${origin[0]}px ${origin[1]}px`);
            this.mapEl.style.setProperty('transform', transform);
        }
        const scale = this._mapScale * this._layerScale;
        for (const ent of this._pendingEntityUpdates) {
            const step = ent.transition.getStep();
            if (step) {
                ent.style.setProperty('transform', `translate(${step.map(x => `${x * scale}px`).join()})`);
            }
            if (ent.new) {
                this.entsEl.append(ent);
                ent.new = false;
            }
            if (!ent.transition.active) {
                this._pendingEntityUpdates.delete(ent);
            }
        }
    }

    _updateEntityAthleteData(ent, ad) {
        const leader = !!ad.eventLeader;
        const sweeper = !!ad.eventSweeper;
        const marked = ad.athlete ? !!ad.athlete.marked : false;
        const following = ad.athlete ? !!ad.athlete.following : false;
        if (leader !== ent.leader) {
            ent.classList.toggle('leader', leader);
            ent.leader = leader;
        }
        if (sweeper !== ent.sweeper) {
            ent.classList.toggle('sweeper', sweeper);
            ent.sweeper = sweeper;
        }
        if (marked !== ent.marked) {
            ent.classList.toggle('marked', marked);
            ent.marked = marked;
        }
        if (following !== ent.following) {
            ent.classList.toggle('following', following);
            ent.following = following;
        }
    }

    _lazyUpdateAthleteDetails(ids) {
        const now = Date.now();
        const refresh = [];
        for (const id of ids) {
            const ent = this._ents.get(id);
            if (!ent) {
                continue;
            }
            const entry = this._athleteCache.get(id) || {ts: 0, data: null};
            if (now - entry.ts > 30000 + Math.random() * 60000) {
                entry.ts = now;
                this._athleteCache.set(id, entry);
                refresh.push(id);
            } else if (entry.data) {
                this._updateEntityAthleteData(ent, entry.data);
            }
        }
        if (refresh.length && isVisible()) {
            common.rpc.getAthletesData(refresh).then(ads => {
                for (const [id, ad] of ads.entries()) {
                    const ent = this._ents.get(id);
                    if (ent) {
                        this._updateEntityAthleteData(ent, ad);
                    }
                    const ac = this._athleteCache.get(id);
                    if (ac) {
                        ac.data = ad;
                    }
                }
            });
        }
        for (const [id, entry] of this._athleteCache.entries()) {
            if (now - entry.ts > 300000) {
                this._athleteCache.delete(id);
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
