import * as common from './common.mjs';


function createElementSVG(name, attrs={}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attrs)) {
        el.setAttribute(key, value);
    }
    return el;
}
 

function hypotenuse(a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    return {
        distance: Math.sqrt(dx * dx + dy * dy),
        angle: Math.atan2(dy, dx)
    };
}


function controlPoint(current, previous, next, reverse, smoothing) {
    const p = previous || current;
    const n = next || current;
    let {distance, angle} = hypotenuse(p, n);
    if (reverse) {
        angle += Math.PI;
    }
    const length = distance * smoothing;
    const x = current[0] + Math.cos(angle) * length;
    const y = current[1] + Math.sin(angle) * length;
    return [x, y];
}


function bezierCommand(point, i, a, smoothing) {
    const cps = controlPoint(a[i - 1], a[i - 2], point, false, smoothing);
    const cpe = controlPoint(point, a[i - 1], a[i + 1], true, smoothing);
    return `C ${cps[0]},${cps[1]} ${cpe[0]},${cpe[1]} ${point[0]},${point[1]}`;
}


function smoothPath(points, smoothing=0.2) {
    return points.reduce((acc, [x, y], i, a) =>
        i === 0 ? `M ${x},${y}` : `${acc} ${bezierCommand([x, y], i, a, smoothing)}`, '');
}


export class SauceZwiftMap extends EventTarget {
    constructor({el, worldList, zoom=1, zoomMin=0.25, zoomMax=4.5}) {
        super();
        this.el = el;
        this.worldList = worldList;
        this.zoom = zoom;
        this.zoomMin = zoomMin;
        this.zoomMax = zoomMax;
        this.wheelState = {
            nextAnimFrame: null,
            done: null,
        };
        this.dragX = 0;
        this.dragY = 0;
        this.pointerState = {
            nextAnimFrame: null,
            lastDistance: null,
            ev1: null,
            ev2: null,
            lastX: null,
            lastY: null,
        };
        el.classList.add('sauce-map-container', 'loading');
        this.mapEl = document.createElement('div');
        this.mapEl.classList.add('sauce-map');
        this.dotsEl = document.createElement('div');
        this.dotsEl.classList.add('dots');
        this.svgEl = createElementSVG('svg');
        this.imgEl = document.createElement('img');
        this.imgEl.classList.add('minimap');
        this.mapEl.append(this.dotsEl, this.svgEl, this.imgEl);
        el.append(this.mapEl);
        this.onPointerMoveBound = this.onPointerMove.bind(this);
        this.onPointerDoneBound = this.onPointerDone.bind(this);
        this.watchingId = null;
        this.athleteId = null;
        this.courseId = null;
        this.worldMeta = null;
        this.headingRotations = 0;
        this.lastHeading = 0;
        this.headingOfft = 0;
        this.dots = new Map();
        this.athleteCache = new Map();
        this.style = 'default';
        this.updateZoom();
        el.addEventListener('wheel', this.onWheelZoom.bind(this));
        el.addEventListener('pointerdown', this.onPointerDown.bind(this));
        document.addEventListener('visibilitychange', () => {
            this.el.classList.toggle('hidden', document.visibilityState !== 'visible');
        });
        this.el.classList.toggle('hidden', document.visibilityState !== 'visible');
    }

    setStyle(style) {
        this.style = style || 'default';
        if (this.style.endsWith('Black')) {
            this.imgEl.style.setProperty('background-color', 'black');
        } else {
            this.imgEl.style.removeProperty('background-color');
        }
        if (!this.loading && this.worldMeta) {
            this.updateMapImage();
        }
    }

    setOpacity(v) {
        this.el.style.setProperty('--opacity', v);
    }

    setTiltShift(en) {
        this.el.classList.toggle('tilt-shift', !!en);
    }

    setTiltShiftAngle(deg) {
        this.mapEl.style.setProperty('--tilt-shift-angle', `${deg}deg`);
    }

    setSparkle(en) {
        this.el.classList.toggle('sparkle', !!en);
    }

    updateZoom() {
        this.el.style.setProperty('--zoom', this.zoom);
    }

    adjZoom(adj) {
        this.zoom = Math.max(this.zoomMin, Math.min(this.zoomMax, this.zoom + adj));
        const ev = new Event('zoom');
        ev.zoom = this.zoom;
        this.dispatchEvent(ev);
        return this.zoom;
    }

    onWheelZoom(ev) {
        if (!ev.deltaY) {
            return;
        }
        ev.preventDefault();
        this.trackingPaused = true;
        this.adjZoom(-ev.deltaY / 4000 * this.zoom);
        cancelAnimationFrame(this.wheelState.nextAnimFrame);
        this.wheelState.nextAnimFrame = requestAnimationFrame(() => {
            if (this.wheelState.done) {
                clearTimeout(this.wheelState.done);
            } else {
                this.el.classList.add('zooming');
            }
            this.updateZoom();
            // Lazy re-enable of animations to avoid need for forced paint
            this.wheelState.done = setTimeout(() => {
                this.trackingPaused = false;
                this.wheelState.done = null;
                this.el.classList.remove('zooming');
            }, 100);
        });
    }

    onPointerDown(ev) {
        const state = this.pointerState;
        if (ev.button !== 0 || (state.ev1 && state.ev2)) {
            return;
        }
        ev.preventDefault();
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
        document.addEventListener('pointermove', this.onPointerMoveBound);
        document.addEventListener('pointerup', this.onPointerDoneBound, {once: true});
        document.addEventListener('pointercancel', this.onPointerDoneBound, {once: true});
    }

    onPointerMove(ev) {
        const state = this.pointerState;
        if (!state.ev2) {
            cancelAnimationFrame(state.nextAnimFrame);
            state.nextAnimFrame = requestAnimationFrame(() => {
                const deltaX = ev.pageX - state.lastX;
                const deltaY = ev.pageY - state.lastY;
                this.dragX += 1 / this.zoom * deltaX;
                this.dragY += 1 / this.zoom * deltaY;
                state.lastX = ev.pageX;
                state.lastY = ev.pageY;
                this.el.style.setProperty('--drag-x-offt', `${this.dragX}px`);
                this.el.style.setProperty('--drag-y-offt', `${this.dragY}px`);
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
            this.adjZoom(deltaDistance / 600);
            this.updateZoom();
        }
    }

    onPointerDone(ev) {
        this.el.classList.remove(this.pointerState.ev2 ? 'zooming' : 'moving');
        document.removeEventListener('pointermove', this.onPointerMoveBound);
        this.pointerState.ev1 = this.pointerState.ev2 = null;
        this.trackingPaused = false;
    }

    updateMapImage() {
        const suffix = {
            default: '',
            neon: '-neon',
            neonBlack: '-neon',
        }[this.style];
        this.imgEl.src = `https://www.sauce.llc/products/sauce4zwift/maps/world` +
            `${this.worldMeta.worldId}${suffix}.webp`;
    }

    setCourse(courseId) {
        this.courseId = courseId;
        this.el.classList.add('loading'); // Disable animation
        this.worldMeta = this.worldList.find(x => x.courseId === courseId);
        const {minX, minY, tileScale, mapScale, anchorX, anchorY} = this.worldMeta;
        this.el.style.setProperty('--x-offt', -(minX + anchorX) / tileScale * mapScale + 'px');
        this.el.style.setProperty('--y-offt', -(minY + anchorY) / tileScale * mapScale + 'px');
        this._setHeading(0);
        this.updateMapImage();
        for (const x of this.dots.values()) {
            x.remove();
        }
        this.dots.clear();
        this.athleteCache.clear();
        this.renderRoadsSVG();
        this.imgEl.decode().then(() => {
            this.el.offsetWidth;
            this.el.classList.remove('loading');
        });
    }

    setWatching(id) {
        if (this.watchingId != null && this.dots.has(this.watchingId)) {
            this.dots.get(this.watchingId).classList.remove('watching');
        }
        this.watchingId = id;
        if (id != null && id !== this.athleteId && this.dots.has(id)) {
            this.dots.get(id).classList.add('watching');
        }
    }

    setAthleteId(id) {
        if (this.athleteId != null && this.dots.has(this.athleteId)) {
            this.dots.get(this.athleteId).classList.remove('self');
        }
        this.athleteId = id;
        if (id != null && this.dots.has(id)) {
            const dot = this.dots.get(id);
            dot.classList.remove('watching');
            dot.classList.add('self');
        }
    }

    fixWorldPos(pos) {
        // Maybe zomday I'll know why...
        return this.worldMeta.mapRotateHack ? [pos[1], -pos[0], pos[2]] : pos;
    }

    async renderRoadsSVG(ids) {
        const roads = await common.getRoads(this.worldMeta.worldId);
        this.svgEl.innerHTML = '';
        ids = ids || Object.keys(roads);
        const defs = createElementSVG('defs');
        const scale = 0.01;
        this.svgEl.append(defs);
        for (const id of ids) {
            const road = roads[id];
            if (!road) {
                console.error("Road not found:", id);
                continue;
            }
            const d = [];
            for (const node of road.nodes) {
                const [x, y] = this.fixWorldPos(node.pos);
                d.push([x * scale, y * scale]);
            }
            const path = createElementSVG('path', {
                id: `road-path-${id}`,
                d: smoothPath(d) + (road.looped ? ' Z' : ''),
            });
            const clip = createElementSVG('clipPath', {id: `road-clip-${id}`});
            let boxMin = this.fixWorldPos(road.boxMin);
            let boxMax = this.fixWorldPos(road.boxMax);
            if (this.worldMeta.mapRotateHack) {
                [boxMin, boxMax] = [boxMax, boxMin];
            }
            const clipBox = createElementSVG('path', {
                d: `M ${boxMin[0] * scale} ${boxMin[1] * scale} H ${boxMax[0] * scale} V ${boxMax[1] * scale} H ${boxMin[0] * scale} Z`,
            });
            clip.append(clipBox);
            defs.append(path, clip);
            for (const x of ['gutter', 'road']) {
                const use = createElementSVG('use', {
                    "class": x,
                    "clip-path": `url(#road-clip-${id})`,
                    "href": `#road-path-${id}`,
                });
                //use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#road-path-${id}`);
                this.svgEl.append(use);
            }
        }
        this.svgEl.setAttribute('viewBox', [
            (this.worldMeta.minX + this.worldMeta.anchorX) * scale,
            (this.worldMeta.minY + this.worldMeta.anchorY) * scale,
            (this.worldMeta.maxX - this.worldMeta.minX) * scale,
            (this.worldMeta.maxY - this.worldMeta.minY) * scale,
        ].join(' '));
    }

    async renderRoadsDots(ids) {
        const roads = await common.getRoads(this.worldMeta.worldId);
        ids = ids || Object.keys(roads);
        for (const id of ids) {
            const road = roads[id];
            if (!road) {
                console.error("Road not found:", id);
                continue;
            }
            for (const node of road.nodes) {
                const [x, y] = this.fixWorldPos(node.pos);
                const X = x / this.worldMeta.tileScale * this.worldMeta.mapScale;
                const Y = y / this.worldMeta.tileScale * this.worldMeta.mapScale;
                const dot = document.createElement('div');
                dot.classList.add('dot', 'leader');
                dot.style.setProperty('--x', `${X}px`);
                dot.style.setProperty('--y', `${Y}px`);
                this.dotsEl.append(dot);
            }
            if (id > 30)
                break;
        }
    }

    renderAthleteStates(states) {
        const now = Date.now();
        if (this.watchingId == null) {
            return;
        }
        const watching = states.find(x => x.athleteId === this.watchingId);
        if (!watching && this.courseId == null) {
            return;
        } else if (watching && watching.courseId !== this.courseId) {
            console.debug("Setting new course from states render:", watching.courseId);
            this.setCourse(watching.courseId);
        }
        for (const state of states) {
            if (!this.dots.has(state.athleteId)) {
                const isSelf = state.athleteId === this.athleteId;
                const dot = document.createElement('div');
                dot.classList.add('dot');
                dot.classList.toggle('self', isSelf);
                dot.classList.toggle('watching', !isSelf && state.athleteId === this.watchingId);
                dot.dataset.athleteId = state.athleteId;
                dot.lastSeen = now;
                dot.wt = state.worldTime;
                this.dotsEl.append(dot);
                this.dots.set(state.athleteId, dot);
            }
            const dot = this.dots.get(state.athleteId);
            const age = state.worldTime - dot.wt;
            if (age) {
                dot.classList.toggle('fast', age < 250);
                dot.classList.toggle('slow', age > 1500);
            }
            let powerLevel;
            if (state.power < 100) {
                powerLevel = 'z1';
            } else if (state.power < 200) {
                powerLevel = 'z2';
            } else if (state.power < 300) {
                powerLevel = 'z3';
            } else if (state.power < 400) {
                powerLevel = 'z4';
            } else if (state.power < 500) {
                powerLevel = 'z5';
            } else {
                powerLevel = 'z6';
            }
            dot.dataset.powerLevel = powerLevel;
            dot.wt = state.worldTime;
            dot.lastSeen = now;
            const pos = this.fixWorldPos([state.x, state.y]);
            const x = pos[0] / this.worldMeta.tileScale * this.worldMeta.mapScale;
            const y = pos[1] / this.worldMeta.tileScale * this.worldMeta.mapScale;
            dot.style.setProperty('--x', `${x}px`);
            dot.style.setProperty('--y', `${y}px`);
            if (state.athleteId === this.watchingId && !this.trackingPaused) {
                this.mapEl.style.setProperty('--anchor-x', `${x}px`);
                this.mapEl.style.setProperty('--anchor-y', `${y}px`);
                this._setHeading(state.heading);
            }
        }
        for (const [athleteId, dot] of this.dots.entries()) {
            if (now - dot.lastSeen > 15000) {
                dot.remove();
                this.dots.delete(athleteId);
            }
        }
        this._lazyUpdateAthleteDetails(states.map(x => x.athleteId));
    }

    _updateDotAthleteData(dot, ad) {
        dot.classList.toggle('leader', !!ad.eventLeader);
        dot.classList.toggle('sweeper', !!ad.eventSweeper);
        dot.classList.toggle('marked', ad.athlete ? !!ad.athlete.marked : false);
        dot.classList.toggle('following', ad.athlete ? !!ad.athlete.following : false);
    }

    _lazyUpdateAthleteDetails(ids) {
        const now = Date.now();
        const refresh = [];
        for (const id of ids) {
            const dot = this.dots.get(id);
            if (!dot) {
                continue;
            }
            const entry = this.athleteCache.get(id) || {ts: 0, data: null};
            if (now - entry.ts > 30000 + Math.random() * 60000) {
                entry.ts = now;
                this.athleteCache.set(id, entry);
                refresh.push(id);
            } else if (entry.data) {
                this._updateDotAthleteData(dot, entry.data);
            }
        }
        if (refresh.length) {
            common.rpc.getAthletesData(refresh).then(ads => {
                for (const [i, ad] of ads.entries()) {
                    const id = ids[i];
                    const dot = this.dots.get(id);
                    if (ad && dot) {
                        dot.classList.toggle('leader', !!ad.eventLeader);
                        dot.classList.toggle('sweeper', !!ad.eventSweeper);
                        dot.classList.toggle('marked', ad.athlete ? !!ad.athlete.marked : false);
                        dot.classList.toggle('following', ad.athlete ? !!ad.athlete.following : false);
                    }
                    this.athleteCache.get(id).data = ad;
                }
            });
        }
        for (const [id, entry] of this.athleteCache.entries()) {
            if (now - entry.ts > 300000) {
                this.athleteCache.delete(id);
            }
        }
    }

    setHeadingOffset(deg) {
        this.headingOfft = deg || 0;
        this._setHeading(this.lastHeading, true);
    }

    _setHeading(heading, force) {
        if (!force && this.trackingPaused) {
            return false;
        }
        if (Math.abs(this.lastHeading - heading) > 180) {
            this.headingRotations += Math.sign(this.lastHeading - heading);
        }
        const mapAdj = this.worldMeta.rotateRouteSelect ? 0 : -90;
        this.mapEl.style.setProperty('--heading',
            `${heading + this.headingRotations * 360 + this.headingOfft + mapAdj}deg`);
        this.lastHeading = heading;
        return true;
    }
}


