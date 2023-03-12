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
        //path.push('Z');  // XXX Don't think I need it, but maybe it makes the join smoother?
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


export class SauceZwiftMap extends EventTarget {
    constructor({el, worldList, zoom=1, zoomMin=0.25, zoomMax=4.5, autoHeading=true,
                 style='default', opacity=1, tiltShift=null, maxTiltShiftAngle=65,
                 sparkle=false, quality=1, animation=true, verticalOffset=0}) {
        super();
        el.classList.toggle('hidden', !isVisible());
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
        this._loadingRefCnt = 0;
        this._renderAnimFrame = null;
        this._pendingRenderWork = new Map();
        this._mapFinalScale = null;
        this._transformRefCnt = 0;
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
        this._onPointerMoveBound = this._onPointerMove.bind(this);
        this._onPointerDoneBound = this._onPointerDone.bind(this);
        this.mapEl = document.createElement('div');
        this.mapEl.classList.add('sauce-map');
        this.entsSvg = createElementSVG('svg');
        this.entsSvg.classList.add('entities');
        this.pinsEl = document.createElement('div');
        this.pinsEl.classList.add('pins');
        this.roadsSvg = createElementSVG('svg');
        this.roadsSvg.classList.add('roads');
        this.imgEl = document.createElement('img');
        this.imgEl.classList.add('minimap');
        this.imgEl.addEventListener('load', this._onImgLoad.bind(this));
        this.mapEl.append(this.imgEl, this.roadsSvg, this.entsSvg, this.pinsEl);
        this.el.addEventListener('wheel', this._onWheelZoom.bind(this));
        this.el.addEventListener('pointerdown', this._onPointerDown.bind(this));
        document.addEventListener('visibilitychange', () => {
            const visable = isVisible();
            if (visable) {
                // Prevent crazy spinning
                this._applyRender(true);
                this.el.offsetWidth;
            }
            this.el.classList.toggle('hidden', !visable);
        });
        this._elHeight = 0;
        this._resizeObserver = new ResizeObserver(([x]) =>
            this._elHeight = x.contentBoxSize[0].blockSize);
        this._resizeObserver.observe(this.el);
        this.incLoading();
        this.setZoom(zoom);
        this.setAutoHeading(autoHeading);
        this.setStyle(style);
        this.setOpacity(opacity);
        this.setTiltShift(tiltShift);
        this.setSparkle(sparkle);
        this.setQuality(quality);
        this.setAnimation(animation);
        this.setVerticalOffset(verticalOffset);
        this.el.append(this.mapEl);
        this.decLoading();
    }

    setStyle(style) {
        this.style = style || 'default';
        if (this.style.endsWith('Black')) {
            this.imgEl.style.setProperty('background-color', 'black');
        } else {
            this.imgEl.style.removeProperty('background-color');
        }
        if (!this.isLoading()) {
            this._updateMapImage();
        }
    }

    setOpacity(v) {
        this.imgEl.style.setProperty('--opacity', isNaN(v) ? 1 : v);
    }

    setTiltShift(v) {
        v = v || null;
        this._tiltShift = v;
        this._tiltShiftNorm = v ? (1 / this.zoomMax) * v * this.maxTiltShiftAngle : null;
        this.el.classList.toggle('tilt-shift', !!v);
        if (!this.isLoading()) {
            if (!this._adjustLayerScale()) {
                this._transform();
            }
        }
    }

    setSparkle(en) {
        this.el.classList.toggle('sparkle', !!en);
    }

    setQuality(q) {
        this.quality = q;
        if (!this.isLoading()) {
            if (!this._adjustLayerScale()) {
                this._transform();
            }
        }
    }

    setAnimation(en) {
        this.el.classList.toggle('no-animation', !en);
    }

    setVerticalOffset(v) {
        this.verticalOffset = v;
        if (!this.isLoading()) {
            this._transform();
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
        if (!this.isLoading()) {
            const ev = new Event('zoom');
            ev.zoom = this.zoom;
            this.dispatchEvent(ev);
            if (!this._adjustLayerScale()) {
                this._transform();
            }
        }
    }

    _onWheelZoom(ev) {
        if (!ev.deltaY) {
            return;
        }
        ev.preventDefault();
        this.trackingPaused = true;
        this._adjustZoom(-ev.deltaY / 4000 * this.zoom);
        cancelAnimationFrame(this._wheelState.nextAnimFrame);
        this._wheelState.nextAnimFrame = requestAnimationFrame(() => {
            if (this._wheelState.done) {
                clearTimeout(this._wheelState.done);
            } else {
                this.el.classList.add('zooming');
            }
            this._applyZoom();
            // Lazy re-enable of animations to avoid need for forced paint
            this._wheelState.done = setTimeout(() => {
                this.trackingPaused = false;
                this._wheelState.done = null;
                this.el.classList.remove('zooming');
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
            this.el.classList.add('zooming');
            state.lastDistance = Math.sqrt(
                (ev.pageX - state.ev1.pageX) ** 2 +
                (ev.pageY - state.ev1.pageY) ** 2);
            return;
        } else {
            state.ev1 = ev;
        }
        this.el.classList.add('moving');
        state.lastX  = ev.pageX;
        state.lastY = ev.pageY;
        document.addEventListener('pointermove', this._onPointerMoveBound);
        document.addEventListener('pointerup', this._onPointerDoneBound, {once: true});
        document.addEventListener('pointercancel', this._onPointerDoneBound, {once: true});
    }

    setDragOffset(x, y) {
        this._dragXY[0] = x;
        this._dragXY[1] = y;
        if (!this.isLoading()) {
            this._transform();
            const dragEv = new Event('drag');
            dragEv.drag = {x, y};
            this.dispatchEvent(dragEv);
        }
    }

    setAutoHeading(en) {
        if (!en) {
            this._setHeading(0);
        }
        this.autoHeading = en;
        if (!this.isLoading()) {
            this._transform();
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
        this.el.classList.remove(this._pointerState.ev2 ? 'zooming' : 'moving');
        document.removeEventListener('pointermove', this._onPointerMoveBound);
        this._pointerState.ev1 = this._pointerState.ev2 = null;
        this.trackingPaused = false;
    }

    _updateMapImage() {
        const suffix = {
            default: '',
            neon: '-neon',
            neonBlack: '-neon',
        }[this.style];
        this.imgEl.src = `https://www.sauce.llc/products/sauce4zwift/maps/world` +
            `${this.worldMeta.worldId}${suffix}.webp`;
    }

    incLoading() {
        this._loadingRefCnt++;
        if (this._loadingRefCnt === 1) {
            this.el.classList.add('loading');
        }
    }

    decLoading() {
        this._loadingRefCnt--;
        if (this._loadingRefCnt < 0) {
            throw new Error("decLoading < 0");
        } else if (this._loadingRefCnt === 0) {
            this._transform();
            this.el.offsetWidth;
            this.el.classList.remove('loading');
        }
    }

    isLoading() {
        return this._loadingRefCnt > 0;
    }

    setCourse(courseId) {
        if (courseId === this.courseId) {
            console.warn("debounce setCourse");
            return;
        }
        this.incLoading();
        this.courseId = courseId;
        this.worldMeta = this.worldList.find(x => x.courseId === courseId);
        const {minX, minY, tileScale, mapScale, anchorX, anchorY} = this.worldMeta;
        this._mapScale = 1 / (tileScale / mapScale);
        this._anchorXY[0] = -(minX + anchorX) * this._mapScale;
        this._anchorXY[1] = -(minY + anchorY) * this._mapScale;
        this.mapEl.style.setProperty('--anchor-x', this._anchorXY[0] + 'px');
        this.mapEl.style.setProperty('--anchor-y', this._anchorXY[1] + 'px');
        this._setHeading(0);
        this._updateMapImage();
        for (const x of this._ents.values()) {
            x.remove();
        }
        this._ents.clear();
        this._athleteCache.clear();
        this._renderEnts();
        return Promise.all([
            this._renderRoads(),
            this.imgEl.decode().finally(() => this.decLoading()),
        ]);
    }

    setWatching(id) {
        if (this.watchingId != null && this._ents.has(this.watchingId)) {
            this._ents.get(this.watchingId).classList.remove('watching');
        }
        this.watchingId = id;
        if (id != null && id !== this.athleteId && this._ents.has(id)) {
            const ent = this._ents.get(id);
            ent.classList.add('watching');
            console.warn("XXX Unimplmented, this opt makes setWatching lower latency, but needs svg ent support");
            //this._centerXY[0] = ent.style.getPropertyValue('--x');
            //this._centerXY[1] = ent.style.getPropertyValue('--y');
        }
        this.setDragOffset(0, 0);
    }

    setAthlete(id) {
        if (this.athleteId != null && this._ents.has(this.athleteId)) {
            this._ents.get(this.athleteId).classList.remove('self');
        }
        this.athleteId = id;
        if (id != null && this._ents.has(id)) {
            const ent = this._ents.get(id);
            ent.classList.remove('watching');
            ent.classList.add('self');
        }
    }

    _fixWorldPos(pos) {
        // Maybe zomday I'll know why...
        return this.worldMeta.mapRotateHack ? [pos[1], -pos[0]] : pos;
    }

    _renderEnts() {
        this.entsSvg.innerHTML = '';
        const m = this.worldMeta;
        this.entsSvg.setAttribute('viewBox', [
            (m.minX + m.anchorX) * svgInternalScale,
            (m.minY + m.anchorY) * svgInternalScale,
            (m.maxX - m.minX) * svgInternalScale,
            (m.maxY - m.minY) * svgInternalScale,
        ].join(' '));
    }

    async _renderRoads(ids) {
        const roads = await common.getRoads(this.worldMeta.worldId);
        this.roadsSvg.innerHTML = '';
        ids = ids || Object.keys(roads);
        const defs = createElementSVG('defs');
        this.roadsSvg.append(defs);
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
        this.roadsSvg.append(...roadways.gutter);
        this.roadsSvg.append(...roadways.surface);
        this.roadsSvg.append(this._activeRoad);
    }

    setRoad(id) {
        this.roadId = id;
        if (!this._activeRoad) {
            return;
        }
        this._activeRoad.setAttribute('clip-path', `url(#road-clip-${id})`);
        this._activeRoad.setAttribute('href', `#road-path-${id}`);
    }

    // XXX leave for ref of pin wrap until ported
    _addDot(state) {
        const isSelf = state.athleteId === this.athleteId;
        const dot = document.createElement('div');
        dot.classList.add('dot');
        dot.classList.toggle('self', isSelf);
        dot.classList.toggle('watching', !isSelf && state.athleteId === this.watchingId);
        dot.dataset.athleteId = state.athleteId;
        dot.lastSeen = Date.now();
        dot.wt = state.worldTime;
        dot.addEventListener('click', () => {
            if (!dot.pin) {
                const pinWrap = document.createElement('div');
                pinWrap.classList.add('pin-wrap');
                const pin = document.createElement('div');
                pin.classList.add('pin');
                pinWrap.append(pin);
                dot.pin = pin;
                dot.append(pinWrap);
            }
            dot.classList.toggle('pinned');
        });
        this._dots.set(state.athleteId, dot);
        this.dotsEl.append(dot);
    }

    _addAthleteEntity(state) {
        const isSelf = state.athleteId === this.athleteId;
        const ent = createElementSVG('circle', {r: '1em', cx: 0, cy: 0});
        ent.new = true;
        ent.classList.add('entity', 'athlete');
        ent.classList.toggle('self', isSelf);
        ent.classList.toggle('watching', !isSelf && state.athleteId === this.watchingId);
        ent.dataset.athleteId = state.athleteId;
        ent.lastSeen = Date.now();
        ent.wt = state.worldTime;
        ent.addEventListener('click', () => {
            if (!ent.pin) {
                const pinWrap = document.createElement('div');
                pinWrap.classList.add('pin-wrap');
                const pin = document.createElement('div');
                pin.classList.add('pin');
                pinWrap.append(pin);
                ent.pinWrap = pinWrap;
                ent.pin = pin;
                this.pinsEl.append(pinWrap);
            }
            ent.classList.toggle('pinned');
        });
        this._ents.set(state.athleteId, ent);
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
                console.debug("Setting new course from states render:", watching.courseId);
                this.setCourse(watching.courseId);
            }
            if (watching.roadId !== this.roadId) {
                this.setRoad(watching.roadId);
            }
        }
        const now = Date.now();
        const transformRefCntSave = this._transformRefCnt;
        for (const state of states) {
            if (!this._ents.has(state.athleteId)) {
                this._addAthleteEntity(state);
            }
            const ent = this._ents.get(state.athleteId);
            const age = state.worldTime - ent.wt;
            if (age) {
                ent.classList.toggle('fast', age < 250);
                ent.classList.toggle('slow', age > 1500);
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
            ent.powerLevel = powerLevel;
            ent.wt = state.worldTime;
            ent.lastSeen = now;
            ent.pos = this._fixWorldPos([state.x, state.y]);
            if (state.athleteId === this.watchingId && !this.trackingPaused) {
                if (this.autoHeading) {
                    this._setHeading(state.heading);
                }
                this._centerXY[0] = ent.pos[0] * this._mapScale;
                this._centerXY[1] = ent.pos[1] * this._mapScale;
                this._transformRefCnt++;
            }
            this._pendingRenderWork.set(ent, state);
        }
        for (const [athleteId, ent] of this._ents.entries()) {
            if (now - ent.lastSeen > 15000) {
                ent.remove();
                this._pendingRenderWork.delete(ent);
                this._ents.delete(athleteId);
                console.warn("XXX clean up pin");
            }
        }
        this._lazyUpdateAthleteDetails(states.map(x => x.athleteId));
        cancelAnimationFrame(this._renderAnimFrame);
        this._renderAnimFrame = requestAnimationFrame(() =>
            this._applyRender(transformRefCntSave !== this._transformRefCnt));
    }

    _applyRender(doTransform) {
        for (const [ent, state] of this._pendingRenderWork.entries()) {
            ent.dataset.powerLevel = ent.powerLevel;
            ent.style.setProperty('transform',
                `translate(${ent.pos[0] * svgInternalScale}px, ${ent.pos[1] * svgInternalScale}px`);
            if (ent.pin) {
                const ad = this._athleteCache.get(state.athleteId);
                const name = ad && ad.data.athlete ?
                    `${ad.data.athlete.sanitizedFLast}` : `ID: ${state.athleteId}`;
                const t = this._coordToPixels(ent.pos);
                ent.pinWrap.style.setProperty('transform', `translate(${t[0]}px, ${t[1]}px)`);
                ent.pin.innerHTML = `
                    <b>${common.sanitize(name)}</b><br/>
                    Power: ${H.power(state.power, {suffix: true, html: true})}<br/>
                    Speed: ${H.pace(state.speed, {suffix: true, html: true})}
                `;
            }
            if (ent.new) {
                this.entsSvg.append(ent);
                ent.new = false;
            }
        }
        this._pendingRenderWork.clear();
        if (doTransform) {
            this._transform();
        }
    }

    _onImgLoad() {
        this._adjustLayerScale({force: true});
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
            // users from having constantly adjust quality.
            const angle = this.zoom * this._tiltShiftNorm;
            // There is no way to be perfect here so this is tuned with a medium/large
            // sized window on a Linux at 60fps to stay around ~500MB GPU mem on blink.
            quality *= Math.min(1, 5 / Math.max(0, angle - 45));
            console.log("quality adjust:", 'tsnorm', this._tiltShiftNorm, 'angle', angle, 'qual', quality);
            this.mapEl.style.setProperty('--tilt-shift-angle', angle);
        } else {
            this.mapEl.style.removeProperty('--tilt-shift-angle');
        }
        const scale = Math.min(this.zoomMax, Math.max(this.zoomMin,
            Math.round(1 / this.zoom / chunk) * chunk)) / quality;
        if (force || this._layerScale !== scale) {
            this.incLoading();
            this._layerScale = scale;
            this.imgEl.width = this.imgEl.naturalWidth / scale;
            this.imgEl.height = this.imgEl.naturalHeight / scale;
            this.mapEl.style.setProperty('--layer-scale', scale);
            this.decLoading();
            return true;
        }
        return false;
    }

    _coordToPixels([x, y]) {
        const relX = this._anchorXY[0] + x * this._mapScaleFactor;
        const relY = this._anchorXY[1] + y * this._mapScaleFactor;
        const dragX = this._dragXY[0] * (this._layerScale * this.zoom);
        const dragY = this._dragXY[1] * (this._layerScale * this.zoom);
        const xPixel = (relX - dragX) / this._layerScale;
        const yPixel = (relY - dragY) / this._layerScale;
        return [xPixel, yPixel];
    }

    _transform() {
        if (this._layerScale == null) {
            return;
        }
        const scale = this._layerScale * this.zoom;
        const relX = this._anchorXY[0] + this._centerXY[0];
        const relY = this._anchorXY[1] + this._centerXY[1];
        const dragX = this._dragXY[0] * scale;
        const dragY = this._dragXY[1] * scale;
        const tX = (relX - dragX) / this._layerScale;
        const tY = (relY - dragY) / this._layerScale;
        const transform = [
            `translate(${-tX}px, ${-tY}px)`,
            `scale(${scale})`,
        ];
        if (this._tiltShift) {
            transform.push(
                `perspective(${600 / scale}px)`,
                `rotateX(${this.zoom * this._tiltShiftNorm}deg)`);
        }
        if (this.verticalOffset) {
            const offt = this.verticalOffset * this._elHeight / this.zoom / this._layerScale;
            transform.push(`translate(0, ${offt}px)`);
        }
        transform.push(`rotate(${this.adjHeading}deg)`);
        this.mapEl.style.setProperty('transform', transform.join(' '));
        this.mapEl.style.setProperty('transform-origin',
            `${relX / this._layerScale}px ${relY / this._layerScale}px`);
    }

    _updateEntityAthleteData(el, ad) {
        el.classList.toggle('leader', !!ad.eventLeader);
        el.classList.toggle('sweeper', !!ad.eventSweeper);
        el.classList.toggle('marked', ad.athlete ? !!ad.athlete.marked : false);
        el.classList.toggle('following', ad.athlete ? !!ad.athlete.following : false);
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
                for (const ad of ads) {
                    const ent = this._ents.get(ad.athleteId);
                    if (ad && ent) {
                        this._updateEntityAthleteData(ent, ad);
                    }
                    this._athleteCache.get(ad.athleteId).data = ad;
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
        this._transform();
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
