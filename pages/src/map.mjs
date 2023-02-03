import * as common from './common.mjs';


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
        this.imgEl = document.createElement('img');
        this.imgEl.classList.add('minimap');
        this.mapEl.append(this.dotsEl, this.imgEl);
        el.append(this.mapEl);
        this.onPointerMoveBound = this.onPointerMove.bind(this);
        this.onPointerDoneBound = this.onPointerDone.bind(this);
        this.courseId = null;
        this.worldMeta = null;
        this.headingRotations = 0;
        this.lastHeading = 0;
        this.dots = new Map();
        this.style = 'default';
        this.updateZoom();
        el.addEventListener('wheel', this.onWheelZoom.bind(this));
        el.addEventListener('pointerdown', this.onPointerDown.bind(this));
    }

    setStyle(style) {
        this.style = style;
        if (!this.loading && this.worldMeta) {
            this.setCourse(this.worldMeta.courseId);
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

    updateZoom() {
        this.el.style.setProperty('--zoom', this.zoom);
    }

    adjZoom(adj) {
        this.zoom = Math.max(0.30, Math.min(5, this.zoom + adj));
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
        this.adjZoom(-ev.deltaY / 2000);
        cancelAnimationFrame(this.wheelState.nextAnimFrame);
        this.wheelState.nextAnimFrame = requestAnimationFrame(() => {
            if (this.wheelState.done) {
                clearTimeout(this.wheelState.done);
            } else {
                this.el.classList.add('zooming');
            }
            this.el.classList.add('zooming');
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
            this.el.classList.remove('dragging');
            this.el.classList.add('zooming');
            state.lastDistance = Math.sqrt(
                (ev.pageX - state.ev1.pageX) ** 2 +
                (ev.pageY - state.ev1.pageY) ** 2);
            return;
        } else {
            state.ev1 = ev;
        }
        this.el.classList.add('dragging');
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
            console.log("pinch zooming", ev);
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
        this.el.classList.remove(this.pointerState.ev2 ? 'zooming' : 'dragging');
        document.removeEventListener('pointermove', this.onPointerMoveBound);
        this.pointerState.ev1 = this.pointerState.ev2 = null;
        this.trackingPaused = false;
    }

    setCourse(courseId) {
        this.el.classList.add('loading'); // Disable animation
        this.worldMeta = this.worldList.find(x => x.courseId === courseId);
        this.el.style.setProperty('--x-offt', `${this.worldMeta.mapOffsetX}px`);
        this.el.style.setProperty('--y-offt', `${this.worldMeta.mapOffsetY}px`);
        const suffix = {
            default: '',
            neon: '-neon',
            neonBlack: '-neon',
        }[this.style];
        if (this.style.endsWith('Black')) {
            this.imgEl.style.setProperty('background-color', 'black');
        } else {
            this.imgEl.style.removeProperty('background-color');
        }
        this.imgEl.src = `/pages/deps/maps/world${this.worldMeta.worldId}${suffix}.webp`;
        for (const x of this.dots.values()) {
            x.remove();
        }
        this.dots.clear();
        this.imgEl.decode().then(() => requestAnimationFrame(() => {
            this.el.offsetWidth;
            this.el.classList.remove('loading');
        }));
    }

    async renderRoads(ids) {
        const roads = await common.getRoads(this.worldMeta.worldId);
        ids = ids || Object.keys(roads);
        for (const id of ids) {
            const road = roads[id];
            if (!road) {
                console.error("Road not found:", id);
                continue;
            }
            for (let [x, y] of road.coords) {
                const dot = document.createElement('div');
                dot.classList.add('dot', 'leader');
                this.dotsEl.append(dot);
                if (this.worldMeta.mapRotateHack) {
                    [x, y] = [y, -x];
                }
                dot.style.setProperty('--x', `${(x / this.worldMeta.tileScale) * this.worldMeta.mapScale}px`);
                dot.style.setProperty('--y', `${(y / this.worldMeta.tileScale) * this.worldMeta.mapScale}px`);
            }
        }
    }

    renderAthleteData(data) {
        if (!this.worldMeta) {
            return;
        }
        const now = Date.now();
        for (const entry of data) {
            if (!this.dots.has(entry.athleteId)) {
                const dot = document.createElement('div');
                dot.classList.add('dot');
                dot.dataset.athleteId = entry.athleteId;
                dot.lastSeen = now;
                dot.wt = entry.state.worldTime;
                this.dotsEl.append(dot);
                this.dots.set(entry.athleteId, dot);
            }
            const dot = this.dots.get(entry.athleteId);
            dot.classList.toggle('self', !!entry.self);
            dot.classList.toggle('watching', !!entry.watching && !entry.self);
            dot.classList.toggle('leader', !!entry.eventLeader);
            dot.classList.toggle('sweeper', !!entry.eventSweeper);
            dot.classList.toggle('marked', entry.athlete ? !!entry.athlete.marked : false);
            dot.classList.toggle('following', entry.athlete ? !!entry.athlete.following : false);
            const age = entry.state.worldTime - dot.wt;
            if (age) {
                dot.classList.toggle('fast', age < 250);
                dot.classList.toggle('slow', age > 1500);
            }
            let powerLevel;
            if (entry.state.power < 100) {
                powerLevel = 'z1';
            } else if (entry.state.power < 200) {
                powerLevel = 'z2';
            } else if (entry.state.power < 300) {
                powerLevel = 'z3';
            } else if (entry.state.power < 400) {
                powerLevel = 'z4';
            } else if (entry.state.power < 500) {
                powerLevel = 'z5';
            } else {
                powerLevel = 'z6';
            }
            dot.dataset.powerLevel = powerLevel;
            dot.wt = entry.state.worldTime;
            dot.lastSeen = now;
            let x = (entry.state.x / this.worldMeta.tileScale) * this.worldMeta.mapScale;
            let y = (entry.state.y / this.worldMeta.tileScale) * this.worldMeta.mapScale;
            if (this.worldMeta.mapRotateHack) {
                [x, y] = [y, -x];
            }
            dot.style.setProperty('--x', `${x}px`);
            dot.style.setProperty('--y', `${y}px`);
            if (entry.watching && !this.trackingPaused) {
                this.mapEl.style.setProperty('--anchor-x', `${x}px`);
                this.mapEl.style.setProperty('--anchor-y', `${y}px`);
            }
        }
        for (const [athleteId, dot] of this.dots.entries()) {
            if (now - dot.lastSeen > 10000) {
                dot.remove();
                this.dots.delete(athleteId);
            }
        }
    }

    setHeading(heading) {
        if (this.trackingPaused) {
            return false;
        }
        if (Math.abs(this.lastHeading - heading) > 180) {
            this.headingRotations += Math.sign(this.lastHeading - heading);
        }
        this.mapEl.style.setProperty('--heading', `${heading + this.headingRotations * 360}deg`);
        this.lastHeading = heading;
        return true;
    }
}


