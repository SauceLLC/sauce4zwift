import * as common from './common.mjs';


function createElementSVG(name, attrs={}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attrs)) {
        el.setAttribute(key, value);
    }
    return el;
}


export class SauceZwiftMap extends EventTarget {
    constructor({el, worldList, zoom=1}) {
        super();
        this.el = el;
        this.worldList = worldList;
        this.zoom = zoom;
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
        this.svgEl = createElementSVG('svg', {viewBox: '0 0 4000 4000'});
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
        this.zoom = Math.max(0.03, Math.min(5, this.zoom + adj));
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
        this.adjZoom(-ev.deltaY / 3000 * this.zoom);
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
        state.rotating = ev.ctrlKey;
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
                if (state.rotating) {
                    this.setHeadingOffset(Math.atan((ev.pageY - state.lastY) / (ev.pageX - state.lastX)) * 360);
                } else {
                    const deltaX = ev.pageX - state.lastX;
                    const deltaY = ev.pageY - state.lastY;
                    this.dragX += 1 / this.zoom * deltaX;
                    this.dragY += 1 / this.zoom * deltaY;
                    state.lastX = ev.pageX;
                    state.lastY = ev.pageY;
                    this.el.style.setProperty('--drag-x-offt', `${this.dragX}px`);
                    this.el.style.setProperty('--drag-y-offt', `${this.dragY}px`);
                }
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
        this.el.classList.add('loading'); // Disable animation
        this.worldMeta = this.worldList.find(x => x.courseId === courseId);
        const {minX, minY, tileScale, mapScale, anchorX, anchorY} = this.worldMeta;
        this.el.style.setProperty('--x-offt', -(minX + anchorX) / tileScale * mapScale + 'px');
        this.el.style.setProperty('--y-offt', -(minY + anchorY) / tileScale * mapScale + 'px');
        this.updateMapImage();
        for (const x of this.dots.values()) {
            x.remove();
        }
        this.dots.clear();
        this.athleteCache.clear();
        this.imgEl.decode().then(() => requestAnimationFrame(() => {
            this.el.offsetWidth;
            this.el.classList.remove('loading');
        }));
    }

    setWatching(id) {
        if (this.watchingId && this.dots.has(this.watchingId)) {
            this.dots.get(this.watchingId).classList.remove('watching');
        }
        this.watchingId = id;
        if (this.watchingId && this.watchingId !== this.athleteId && this.dots.has(this.watchingId)) {
            this.dots.get(this.watchingId).classList.add('watching');
        }
    }

    setAthleteId(id) {
        if (this.athleteId && this.dots.has(this.athleteId)) {
            this.dots.get(this.athleteId).classList.remove('self');
        }
        this.athleteId = id;
        if (this.athleteId && this.dots.has(this.athleteId)) {
            const dot = this.dots.get(this.athleteId);
            dot.classList.remove('watching');
            dot.classList.add('self');
        }
    }

    async renderRoadsSVGUNfinishedXXX(ids) {
        const roads = await common.getRoads(this.worldMeta.worldId);
        ids = ids || Object.keys(roads);
        const tileScale = this.worldMeta.tileScale;
        const mapScale = this.worldMeta.mapScale;
        for (const id of ids) {
            const road = roads[id];
            if (!road) {
                console.error("Road not found:", id);
                continue;
            }
            const path = createElementSVG('path', {
                "fill": 'transparent',
                "stroke": 'currentColor',
                "stroke-width": 2000,
                "stroke-linecap": 'round',
                "stroke-linejoin": 'round',
            });
            const d = [];
            for (let [x, y] of road.coords) {
                if (this.worldMeta.mapRotateHack) {
                    [x, y] = [y, -x];
                }
                let x = state.x / this.worldMeta.tileScale * this.worldMeta.mapScale;
                let y = state.y / this.worldMeta.tileScale * this.worldMeta.mapScale;
                d.push(`${x} ${y}`);
            }
            console.log(road);
            path.setAttribute('d', 'M ' + d.join(' L ') + (road.looped ? ' Z' : ''));
            this.svgEl.append(path);
        }
        this.svgEl.setAttribute('viewBox', [-tileScale, -tileScale, tileScale, tileScale].join(' '));
        this.svgEl.setAttribute('preserveAspectRatio', 'xMinYMin meet');
        this.svgEl.append(createElementSVG('circle', {
            cx: 0,
            cy: 0,
            r: tileScale / 2,
            fill: '#f003'
        }));
        /*this.svgEl.append(createElementSVG('path', {
            "stroke": 'currentColor',
            "stroke-width": 2000,
            "d": "M -100000 100000 L 100000 100000 L 100000 -100000 L -100000 -100000 Z"
        }));*/
        
        console.log(this.worldMeta);
    }

    async renderRoads(ids) {
        const roads = await common.getRoads(this.worldMeta.worldId);
        ids = ids || Object.keys(roads);
        const tileScale = this.worldMeta.tileScale;
        const mapScale = this.worldMeta.mapScale;
        for (const id of ids) {
            const road = roads[id];
            if (!road) {
                console.error("Road not found:", id);
                continue;
            }
            for (let [x, y] of road.coords) {
                if (this.worldMeta.mapRotateHack) {
                    [x, y] = [y, -x];
                }
                let X = x / this.worldMeta.tileScale * this.worldMeta.mapScale;
                let Y = y / this.worldMeta.tileScale * this.worldMeta.mapScale;
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
            let x = state.x / this.worldMeta.tileScale * this.worldMeta.mapScale;
            let y = state.y / this.worldMeta.tileScale * this.worldMeta.mapScale;
            if (this.worldMeta.mapRotateHack) {
                [x, y] = [y, -x];
            }
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

    _lazyUpdateAthleteDetails(ids) {
        const now = Date.now();
        for (const id of ids) {
            const dot = this.dots.get(id);
            if (!dot) {
                continue;
            }
            const entry = this.athleteCache.get(id) || {ts: 0, data: null};
            const update = ad => {
                dot.classList.toggle('leader', !!ad.eventLeader);
                dot.classList.toggle('sweeper', !!ad.eventSweeper);
                dot.classList.toggle('marked', ad.athlete ? !!ad.athlete.marked : false);
                dot.classList.toggle('following', ad.athlete ? !!ad.athlete.following : false);
                entry.data = ad;
            };
            if (now - entry.ts > 30000 + Math.random() * 60000) {
                entry.ts = now;
                this.athleteCache.set(id, entry);
                common.rpc.getAthleteData(id).then(update);
            } else if (entry.data) {
                update(entry.data);
            } else {
                console.warn("verified debounce, yay", id);
            }
        }
        for (const [id, entry] of this.athleteCache.entries()) {
            if (now - entry.ts > 300000) {
                this.athleteCache.delete(id);
            }
        }
    }

    setHeadingOffset(deg) {
        console.log(deg);
        this.headingOfft = deg || 0;
        this._setHeading(this.lastHeading);
    }

    _setHeading(heading) {
        if (this.trackingPaused) {
            return false;
        }
        if (Math.abs(this.lastHeading - heading) > 180) {
            this.headingRotations += Math.sign(this.lastHeading - heading);
        }
        const mapAdj = this.worldMeta.rotateMinimap ? 0 : -90;
        this.mapEl.style.setProperty('--heading', `${heading + this.headingRotations * 360 + this.headingOfft + mapAdj}deg`);
        this.lastHeading = heading;
        return true;
    }
}


