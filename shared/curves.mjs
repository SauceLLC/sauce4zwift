/*
 * Sauce Bezier and catmullRom spline routines.
 *
 * Most functions work with a simple intermediate language that's
 * based on SVG paths but with native types and objects for
 * easier manipulation.
 *
 * The paths can be sliced, reversed, measured and traced in JS
 * so everything works on the backend or frontend.
 */


const curvePathSchemaVersion = 1;


class LRUCache extends Map {
    constructor(capacity) {
        super();
        this._capacity = capacity;
        this._head = null;
    }

    get(key) {
        const entry = super.get(key);
        if (entry === undefined) {
            return;
        }
        this._moveToHead(entry);
        return entry.value;
    }

    set(key, value) {
        let entry = super.get(key);
        if (entry === undefined) {
            if (this.size === this._capacity) {
                // Fast path: just replace tail and rotate.
                entry = this._head.prev;
                this._head = entry;
                this.delete(entry.key);
            } else {
                entry = {};
                if (!this.size) {
                    entry.next = entry.prev = entry;
                    this._head = entry;
                } else {
                    this._moveToHead(entry);
                }
            }
            entry.key = key;
            entry.value = value;
            super.set(key, entry);
        } else {
            entry.value = value;
            this._moveToHead(entry);
        }
    }

    _moveToHead(entry) {
        if (entry === this._head) {
            return;
        }
        if (entry.next) {
            entry.next.prev = entry.prev;
            entry.prev.next = entry.next;
        }
        entry.next = this._head;
        entry.prev = this._head.prev;
        this._head.prev.next = entry;
        this._head.prev = entry;
        this._head = entry;
    }

    clear() {
        this._head = null;
        super.clear();
    }
}


export function vecDist(a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}


export function lerp(t, a, b) {
    const s = 1 - t;
    return [
        a[0] * s + b[0] * t,
        a[1] * s + b[1] * t,
        a[2] * s + b[2] * t
    ];
}


export function computeBezier(t, a, b, c, d) {
    const T = 1 - t;
    const x = T * T * T * a[0]
        + 3 * T * T * t * b[0]
        + 3 * T * t * t * c[0]
        + t * t * t * d[0];
    const y = T * T * T * a[1]
        + 3 * T * T * t * b[1]
        + 3 * T * t * t * c[1]
        + t * t * t * d[1];
    const z = T * T * T * a[2]
        + 3 * T * T * t * b[2]
        + 3 * T * t * t * c[2]
        + t * t * t * d[2];
    return [x, y, z];
}


export function splitBezier(t, start, cp1, cp2, end) {
    const p4 = lerp(t, start, cp1);
    const p5 = lerp(t, cp1, cp2);
    const p6 = lerp(t, cp2, end);
    const p7 = lerp(t, p4, p5);
    const p8 = lerp(t, p5, p6);
    const p9 = lerp(t, p7, p8);
    return [
        [start, p4, p7, p9],
        [p9, p8, p6, end],
    ];
}


export function bezierControl(a, b, c, smoothing, invert=false) {
    const dx = c[0] - a[0];
    const dy = c[1] - a[1];
    const dz = c[2] - a[2];
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) + (invert ? Math.PI : 0);
    const length = distance * smoothing;
    return [
        b[0] + Math.cos(angle) * length,
        b[1] + Math.sin(angle) * length,
        b[2] + dz * (invert ? 1 : -1) * smoothing
    ];
}


export function pointOnLine(t, a, b) {
    // t is from 0 -> 1 where 0 = a and 1 = b
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const angle = Math.atan2(dy, dx);
    const l = Math.sqrt(dx * dx + dy * dy) * t;
    return [
        a[0] + Math.cos(angle) * l,
        a[1] + Math.sin(angle) * l,
        a[2] + dz * t
    ];
}


export function roadTimeToPercent(rt) {
    return (rt - 5000) / 1e6;
}


export function roadPercentToTime(rp) {
    return rp * 1e6 + 5000;
}


export function roadPercentToOffset(rp, length) {
    return rp * (length - 3) + 1;
}


export function roadOffsetToPercent(i, length) {
    return (i - 1) / (length - 3);
}


export function roadOffsetToTime(i, length) {
    return roadOffsetToPercent(i, length) * 1e6 + 5000;
}


export class CurvePath {

    static _distCache = new LRUCache(65536);

    constructor({nodes=[], epsilon=0.001, immutable=false}={}) {
        this.nodes = nodes;
        this.epsilon = epsilon;
        this.immutable = immutable;
    }

    toJSON() {
        const o = Object.assign({}, this);
        o.schemaVersion = curvePathSchemaVersion;
        o.type = this.constructor.name;
        return o;
    }

    toSVGPath({includeEdges}={}) {
        const start = includeEdges ? 0 : 1;
        const end = includeEdges ? this.nodes.length : this.nodes.length - 1;
        if (start >= end) {
            return '';
        }
        let svg = `M${this.nodes[start].end[0]},${this.nodes[start].end[1]}`;
        for (let i = start + 1; i < end; i++) {
            const {cp1, cp2, end} = this.nodes[i];
            if (cp1 && cp2) {
                svg += `C${cp1[0]},${cp1[1]} ${cp2[0]},${cp2[1]} ${end[0]},${end[1]}`;
            } else {
                svg += `L${end[0]},${end[1]}`;
            }
        }
        return svg;
    }

    flatten(t) {
        const values = [];
        this.trace(x => values.push(x.stepNode), t);
        return values;
    }

    toReversed() {
        const last = this.nodes[this.nodes.length - 1];
        const nodes = [{...last, cp1: undefined, cp2: undefined}];
        for (let i = this.nodes.length - 2; i >= 0; i--) {
            const p0 = this.nodes[i];
            const p1 = this.nodes[i + 1];
            if (p1.cp1 && p1.cp2) {
                nodes.push({...p0, cp1: p1.cp2, cp2: p1.cp1});
            } else {
                nodes.push({...p0, cp1: undefined, cp2: undefined});
            }
        }
        return new this.constructor({...this, nodes});
    }

    extend(path) {
        if (this.immutable) {
            throw new TypeError("Object is marked immutable");
        }
        if (!path.nodes.length) {
            return;
        }
        this.nodes.push({...path.nodes[0], cp1: undefined, cp2: undefined});
        for (let i = 1; i < path.nodes.length; i++) {
            this.nodes.push(path.nodes[i]);
        }
    }

    slice(...args) {
        return new this.constructor({...this, nodes: this.nodes.slice(...args)});
    }

    distance(t=this.epsilon) {
        if (!this.nodes.length) {
            return 0;
        }
        const steps = Math.round(1 / t);
        t = 1 / steps;
        let dist = 0;
        let prevPoint = this.nodes[0].end;
        for (let i = 0; i < this.nodes.length - 1; i++) {
            const x = this.nodes[i];
            const next = this.nodes[i + 1];
            if (next.cp1 && next.cp2) {
                const cKey = JSON.stringify([
                    steps,
                    x.end[0],    x.end[1],    x.end[2],
                    next.cp1[0], next.cp1[1], next.cp1[2],
                    next.cp2[0], next.cp2[1], next.cp2[2],
                    next.end[0], next.end[1], next.end[2]
                ]); // Incredibly fast with V8 13.4+
                let d = this.constructor._distCache.get(cKey);
                if (d !== undefined) {
                    prevPoint = next.end;
                } else {
                    d = 0;
                    for (let j = steps - 1; j >= 0; j--) {
                        const point = computeBezier(1 - j * t, x.end, next.cp1, next.cp2, next.end);
                        d += vecDist(prevPoint, point);
                        prevPoint = point;
                    }
                    this.constructor._distCache.set(cKey, d);
                }
                dist += d;
            } else {
                dist += vecDist(prevPoint, next.end);
                prevPoint = next.end;
            }
        }
        return dist;
    }

    trace(callback, t=this.epsilon) {
        // This would be better looking as a generator but it needs it to be fast.
        for (let index = 0; index < this.nodes.length; index++) {
            const origin = this.nodes[index];
            const next = this.nodes[index + 1];
            if (next && next.cp1 && next.cp2) {
                for (let step = 0; step < 1; step += t) {
                    const stepNode = computeBezier(step, origin.end, next.cp1, next.cp2, next.end);
                    const op = callback({origin, next, index, stepNode, step});
                    if (op === false) {
                        return;
                    } else if (op === null) {
                        break;
                    }
                }
            } else if (callback({origin, next, index, stepNode: origin.end, step: 0}) === false) {
                return;
            }
        }
    }

    pointAtDistance(targetDistance, t) {
        let point;
        let dist = 0;
        let prevStep;
        this.trace(x => {
            const stepDist = prevStep ? vecDist(prevStep, x.stepNode) : 0;
            dist += stepDist;
            if (dist > targetDistance) {
                const diff = (dist - targetDistance) / stepDist;
                point = pointOnLine(diff, x.stepNode, prevStep);
                return false;
            } else if (dist === targetDistance) {
                point = x.stepNode;
                return false;
            }
            prevStep = x.stepNode;
        }, t);
        return point;
    }
}


export class RoadPath extends CurvePath {
    constructor(options={}) {
        super({...options, immutable: true});
        this.roadLength = options.roadLength != null ? options.roadLength : this.nodes.length;
        if (this.roadLength < 3) {
            throw new TypeError("roadLength must be >= 3");
        }
        this.offsetIndex = options.offsetIndex || 0;
        this.offsetPercent = options.offsetPercent || 0;
        this.cropPercent = options.cropPercent || 0;
    }

    roadPercentToOffset(rp) {
        const [i, p] = this.roadPercentToOffsetTuple(rp);
        return i + p;
    }

    roadPercentToOffsetTuple(rp) {
        const offt = roadPercentToOffset(rp, this.roadLength);
        // Handle +/-Infinity..
        let index = Math.trunc(offt);
        let percent = (offt % 1) || 0;
        index -= this.offsetIndex;
        if (index < 0) {
            return [0, 0];
        } else if (index >= this.nodes.length - 1) {
            return [this.nodes.length - 1, 0];
        } else if (index === 0) { // and only if length > 1
            percent = Math.max(0, (percent - this.offsetPercent) / (1 - this.offsetPercent));
        }
        if (index === this.nodes.length - 2 && percent && this.cropPercent) {
            percent /= this.cropPercent;
            if (percent >= 1) {
                index++;
                percent = 0;
            }
        }
        return [index, percent];
    }

    includesRoadPercent(rp) {
        if (!this.nodes.length) {
            return false;
        }
        const start = roadOffsetToPercent(this.offsetIndex + this.offsetPercent, this.roadLength);
        const cropAdj = this.cropPercent ? 1 - this.cropPercent : 0;
        const end = roadOffsetToPercent(this.offsetIndex + this.nodes.length - 1 - cropAdj, this.roadLength);
        return rp >= start && rp <= end;
    }

    includesRoadTime(rt) {
        return this.includesRoadPercent(roadTimeToPercent(rt));
    }

    boundsAtRoadTime(rt) {
        return this.boundsAtRoadPercent(roadTimeToPercent(rt));
    }

    boundsAtRoadPercent(rp) {
        if (!this.nodes.length) {
            return;
        }
        const [index, percent] = this.roadPercentToOffsetTuple(rp);
        // Always return at least one edge.
        const origin = this.nodes[index];
        const next = this.nodes[index + 1];
        let point;
        if (next) {
            if (next.cp1) {
                point = computeBezier(percent, origin.end, next.cp1, next.cp2, next.end);
            } else {
                point = pointOnLine(percent, origin.end, next.end);
            }
        } else {
            point = origin ? origin.end : undefined;
        }
        return {index, percent, origin, next, point};
    }

    subpathAtRoadTimes(startRoadTime, endRoadTime) {
        const startRoadPercent = roadTimeToPercent(startRoadTime);
        const endRoadPercent = roadTimeToPercent(endRoadTime);
        return this.subpathAtRoadPercents(startRoadPercent, endRoadPercent);
    }

    subpathAtRoadPercents(startRoadPercent=-1e6, endRoadPercent=1e6) {
        if (startRoadPercent > endRoadPercent) {
            return new this.constructor({
                ...this,
                offsetIndex: 0,
                offsetPercent: 0,
                cropPercent: 0,
                nodes: []
            });
        }
        const start = this.boundsAtRoadPercent(startRoadPercent);
        const end = this.boundsAtRoadPercent(endRoadPercent);
        const nodes = [{end: start.point}];
        for (const x of this.nodes.slice(start.index + 1, end.index + 1)) {
            nodes.push({...x});
        }
        let cropPercent = 0;
        if (end.percent) {
            if (end.next.cp1) {
                const [p] = splitBezier(end.percent, end.origin.end, end.next.cp1,
                                        end.next.cp2, end.next.end);
                nodes.push({cp1: p[1], cp2: p[2], end: p[3]});
            } else {
                nodes.push({end: end.point});
            }
            if (this.cropPercent && end.index === this.nodes.length - 2) {
                // subpath is on our boundry so denormalize percent based on our trim..
                cropPercent = end.percent * this.cropPercent;
            } else {
                cropPercent = end.percent;
            }
        } else if (end.index === this.nodes.length - 1) {
            cropPercent = this.cropPercent;
        }
        if (startRoadPercent === endRoadPercent) {
            nodes.length = 1;
        }
        if (nodes.length > 1 && start.percent && start.next.cp1) {
            let [, p] = splitBezier(start.percent, start.origin.end, start.next.cp1, start.next.cp2,
                                    start.next.end);
            if (end && start.index === end.index) {
                const percent = (end.percent - start.percent) / (1 - start.percent);
                [p] = splitBezier(percent, start.point, p[1], p[2], end.point);
            }
            nodes[1].cp1 = p[1];
            nodes[1].cp2 = p[2];
        }
        const absStartPercent = start.index === 0 ?
            start.percent * (1 - this.offsetPercent) + this.offsetPercent : start.percent;
        return new this.constructor({
            ...this,
            nodes,
            offsetIndex: start.index + this.offsetIndex,
            offsetPercent: absStartPercent,
            cropPercent,
        });
    }

    pointAtRoadTime(rt) {
        return this.pointAtRoadPercent(roadTimeToPercent(rt));
    }

    pointAtRoadPercent(rp) {
        return this.boundsAtRoadPercent(rp).point;
    }

    toCurvePath() {
        return new CurvePath({...this, immutable: false});
    }

    toReversed() {
        if (this.offsetIndex || this.offsetPercent) {
            // TBD
            throw new Error("toReversed only works with unsliced RoadPath");
        }
        return super.toReversed();
    }

    slice(start, end) {
        if (start < 0) {
            start += this.nodes.length;
        }
        const offsetIndex = this.offsetIndex + start;
        const offsetPercent = start ? 0 : this.offsetPercent;
        const cropPercent = (end === undefined || end >= this.nodes.length) ? this.cropPercent : 0;
        return new this.constructor({
            ...this,
            nodes: this.nodes.slice(start, end),
            offsetIndex,
            offsetPercent,
            cropPercent,
        });
    }

    distanceAtRoadPercent(rp, t=this.epsilon) {
        const [endIndex, endPercent] = this.roadPercentToOffsetTuple(rp);
        if (endIndex < 0 || endIndex === 0 && endPercent <= 0) {
            return 0;
        }
        if (endIndex >= this.nodes.length - 1) {
            return this.distance(t);
        }
        const steps = Math.round(1 / t);
        t = 1 / steps;
        let dist = 0;
        let prevPoint = this.nodes[0].end;
        // Avoid a few branches with core loops, followed later by end loop..
        for (let i = 0; i < endIndex; i++) {
            const x = this.nodes[i];
            const next = this.nodes[i + 1];
            if (next.cp1 && next.cp2) {
                const cKey = JSON.stringify([
                    steps,
                    x.end[0],    x.end[1],    x.end[2],
                    next.cp1[0], next.cp1[1], next.cp1[2],
                    next.cp2[0], next.cp2[1], next.cp2[2],
                    next.end[0], next.end[1], next.end[2]
                ]); // Incredibly fast with V8 13.4+
                let d = this.constructor._distCache.get(cKey);
                if (d !== undefined) {
                    prevPoint = next.end;
                } else {
                    d = 0;
                    for (let j = steps - 1; j >= 0; j--) {
                        const point = computeBezier(1 - j * t, x.end, next.cp1, next.cp2, next.end);
                        d += vecDist(prevPoint, point);
                        prevPoint = point;
                    }
                    this.constructor._distCache.set(cKey, d);
                }
                dist += d;
            } else {
                dist += vecDist(prevPoint, next.end);
                prevPoint = next.end;
            }
        }
        if (endPercent > 0) {
            const endNode = this.nodes[endIndex];
            const next = this.nodes[endIndex + 1];
            if (next.cp1 && next.cp2) {
                for (let j = steps - 1; j >= 0; j--) {
                    const s = Math.min(endPercent, 1 - j * t);
                    const point = computeBezier(s, endNode.end, next.cp1, next.cp2, next.end);
                    dist += vecDist(prevPoint, point);
                    prevPoint = point;
                    if (s === endPercent) {
                        break;
                    }
                }
            } else {
                dist += vecDist(prevPoint, next.end) * endPercent;
            }
        }
        return dist;
    }
}


/**
 * Original author: Nikolas Kyriakides
 * https://gist.github.com/nicholaswmin/c2661eb11cad5671d816
 *
 * Interpolates a Catmull-Rom Spline through a series of x/y points
 * Converts the CR Spline to Cubic Beziers for use with SVG items
 *
 * This is a simplified uniform (alpha=0) impl, as that is all Zwift uses.
 */
export function catmullRomPath(points, {loop, epsilon, road}={}) {
    if (loop) {
        points = Array.from(points);
        points.unshift(points[points.length - 1]);
        points.push(...points.slice(1, 3));
    }
    const nodes = [{end: points[0]}];
    for (let i = 0; i < points.length - 1; i++) {
        const p_1 = points[i - 1];
        const p0 = points[i];
        const p1 = points[i + 1];
        const p2 = points[i + 2];
        const meta = p0[3];
        const straight = meta?.straight;
        if (straight) {
            nodes.push({end: p1});
            continue;
        }
        const A = 6;
        const B = 6;
        const N = 1 / 6;
        const M = 1 / 6;
        const cp1 = p_1 ? [
            (-p_1[0] + A * p0[0] + 1 * p1[0]) * N,
            (-p_1[1] + A * p0[1] + 1 * p1[1]) * N,
            (-p_1[2] + A * p0[2] + 1 * p1[2]) * N,
        ] : p0;
        const cp2 = p2 ? [
            (p0[0] + B * p1[0] - 1 * p2[0]) * M,
            (p0[1] + B * p1[1] - 1 * p2[1]) * M,
            (p0[2] + B * p1[2] - 1 * p2[2]) * M
        ] : p1;
        nodes.push({cp1, cp2, end: p1});
    }
    const Klass = road ? RoadPath : CurvePath;
    return new Klass({nodes, epsilon});
}


export function cubicBezierPath(points, {loop, smoothing=0.2, epsilon, road}={}) {
    if (loop) {
        points = Array.from(points);
        points.unshift(points[points.length - 1]);
        points.push(...points.slice(1, 3));
    }
    const nodes = [{end: points[0]}];
    for (let i = 0; i < points.length - 1; i++) {
        const p_1 = points[i - 1];
        const p0 = points[i];
        const p1 = points[i + 1];
        const p2 = points[i + 2];
        const meta = i ? p0[3] : null;
        const straight = meta?.straight;
        if (straight) {
            nodes.push({end: p1});
            continue;
        }
        const tanIn = p1[3]?.tanIn;
        const tanOut = p0[3]?.tanOut;
        const cp1 = tanOut ?
            [p0[0] + tanOut[0], p0[1] + tanOut[1], p0[2] + tanOut[2]] :
            p_1 ? bezierControl(p_1, p0, p1, smoothing) : p0;
        const cp2 = tanIn ?
            [p1[0] + tanIn[0], p1[1] + tanIn[1], p1[2] + tanIn[2]] :
            p2 ? bezierControl(p0, p1, p2, smoothing, true) : p1;
        nodes.push({cp1, cp2, end: p1});
    }
    const Klass = road ? RoadPath : CurvePath;
    return new Klass({nodes, epsilon});
}
