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


export function computeBezier3d(t, a, b, c, d) {
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


export function computeBezier2d(t, a, b, c, d) {
    const T = 1 - t;
    const x = T * T * T * a[0]
        + 3 * T * T * t * b[0]
        + 3 * T * t * t * c[0]
        + t * t * t * d[0];
    const y = T * T * T * a[1]
        + 3 * T * T * t * b[1]
        + 3 * T * t * t * c[1]
        + t * t * t * d[1];
    return [x, y];
}


// Ported from webkit:
// https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/graphics/UnitBezier.h
export class UnitBezier {

    _samplesSize = 11;
    _bezierEpsilon = 1e-7;
    _maxNewtonIters = 4;

    constructor(p1x, p1y, p2x, p2y) {
        // Calculate the polynomial coefficients, implicit first and last control points
        // are (0,0) and (1,1).
        this.cx = 3.0 * p1x;
        this.bx = 3.0 * (p2x - p1x) - this.cx;
        this.ax = 1.0 - this.cx - this.bx;

        this.cy = 3.0 * p1y;
        this.by = 3.0 * (p2y - p1y) - this.cy;
        this.ay = 1.0 - this.cy - this.by;

        // End-point gradients are used to calculate timing function results
        // outside the range [0, 1].
        //
        // There are four possibilities for the gradient at each end:
        // (1) the closest control point is not horizontally coincident with regard to
        //     (0, 0) or (1, 1). In this case the line between the end point and
        //     the control point is tangent to the bezier at the end point.
        // (2) the closest control point is coincident with the end point. In
        //     this case the line between the end point and the far control
        //     point is tangent to the bezier at the end point.
        // (3) both internal control points are coincident with an endpoint. There
        //     are two special case that fall into this category:
        //     CubicBezier(0, 0, 0, 0) and CubicBezier(1, 1, 1, 1). Both are
        //     equivalent to linear.
        // (4) the closest control point is horizontally coincident with the end
        //     point, but vertically distinct. In this case the gradient at the
        //     end point is Infinite. However, this causes issues when
        //     interpolating. As a result, we break down to a simple case of
        //     0 gradient under these conditions.
        if (p1x > 0) {
            this.startGradient = p1y / p1x;
        } else if (!p1y && p2x > 0) {
            this.startGradient = p2y / p2x;
        } else if (!p1y && !p2y) {
            this.startGradient = 1;
        } else {
            this.startGradient = 0;
        }
        if (p2x < 1) {
            this.endGradient = (p2y - 1) / (p2x - 1);
        } else if (p2y === 1 && p1x < 1) {
            this.endGradient = (p1y - 1) / (p1x - 1);
        } else if (p2y === 1 && p1y === 1) {
            this.endGradient = 1;
        } else {
            this.endGradient = 0;
        }
        this.splineSamples = [];
        const deltaT = 1.0 / (this._samplesSize - 1);
        for (let i = 0; i < this._samplesSize; i++) {
            this.splineSamples.push(this.sampleCurveX(i * deltaT));
        }
    }

    sampleCurveX(t) {
        // `ax t^3 + bx t^2 + cx t' expanded using Horner's rule.
        return ((this.ax * t + this.bx) * t + this.cx) * t;
    }

    sampleCurveY(t) {
        return ((this.ay * t + this.by) * t + this.cy) * t;
    }

    sampleCurveDerivativeX(t) {
        return (3.0 * this.ax * t + 2.0 * this.bx) * t + this.cx;
    }

    // Given an x value, find a parametric value it came from.
    solveCurveX(x, epsilon=1e-6) {
        let t0 = 0.0;
        let t1 = 0.0;
        let t2 = x;
        let x2 = 0.0;
        let d2 = 0.0;
        // Linear interpolation of spline curve for initial guess.
        const deltaT = 1.0 / (this._samplesSize - 1);
        for (let i = 1; i < this._samplesSize; i++) {
            if (x <= this.splineSamples[i]) {
                t1 = deltaT * i;
                t0 = t1 - deltaT;
                t2 = t0 + (t1 - t0) * (x - this.splineSamples[i - 1]) /
                    (this.splineSamples[i] - this.splineSamples[i - 1]);
                break;
            }
        }

        // Perform a few iterations of Newton's method -- normally very fast.
        // See https://en.wikipedia.org/wiki/Newton%27s_method.
        const newtonEpsilon = Math.min(this._bezierEpsilon, epsilon);
        for (let i = 0; i < this._maxNewtonIters; i++) {
            x2 = this.sampleCurveX(t2) - x;
            if (Math.abs(x2) < newtonEpsilon) {
                return t2;
            }
            d2 = this.sampleCurveDerivativeX(t2);
            if (Math.abs(d2) < this._bezierEpsilon) {
                break;
            }
            t2 = t2 - x2 / d2;
        }
        if (Math.abs(x2) < epsilon) {
            return t2;
        }
        // Fall back to the bisection method for reliability.
        while (t0 < t1) {
            x2 = this.sampleCurveX(t2);
            if (Math.abs(x2 - x) < epsilon) {
                return t2;
            }
            if (x > x2) {
                t0 = t2;
            } else {
                t1 = t2;
            }
            t2 = (t1 + t0) * 0.5;
        }
        // Failure.
        return t2;
    }

    solve(x, epsilon) {
        if (x < 0.0) {
            return 0.0 + this.startGradient * x;
        }
        if (x > 1.0) {
            return 1.0 + this.endGradient * (x - 1.0);
        }
        return this.sampleCurveY(this.solveCurveX(x, epsilon));
    }
}


export const computeBezier = computeBezier3d;


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

    toSVGPath({includeEdges, scale=1, offset}={}) {
        const svg = [];
        const xOfft = offset ? offset[0] : 0;
        const yOfft = offset ? offset[1] : 0;
        const xy = point => `${point[0] * scale + xOfft},${point[1] * scale + yOfft}`;
        const start = includeEdges ? 0 : 1;
        const end = includeEdges ? this.nodes.length : this.nodes.length - 1;
        for (let i = start; i < end; i++) {
            const x = this.nodes[i];
            if (i === start) {
                svg.push(`M ${xy(x.end)}`);
            } else {
                if (x.cp1 && x.cp2) {
                    svg.push(`C ${xy(x.cp1)} ${xy(x.cp2)} ${xy(x.end)}`);
                } else {
                    svg.push(`L ${xy(x.end)}`);
                }
            }
        }
        return svg.join('\n');
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
        return new CurvePath({...this, nodes});
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
        return new CurvePath({...this, nodes: this.nodes.slice(...args)});
    }

    distance(t) {
        let dist = 0;
        let prevStep;
        this.trace(x => {
            dist += prevStep ? vecDist(prevStep, x.stepNode) : 0;
            prevStep = x.stepNode;
        }, t);
        return dist;
    }

    trace(callback, t) {
        // This would be better looking as a generator but it needs it to be fast.
        t = t || this.epsilon;
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
        let index = offt | 0;
        let percent = offt % 1;
        index -= this.offsetIndex;
        if (index < 0) {
            index = 0;
            percent = 0;
        } else if (index >= this.nodes.length - 1) {
            index = this.nodes.length - 1;
            percent = 0;
        } else if (index === 0) { // and only if length > 1
            percent = Math.max(0, (percent - this.offsetPercent) / (1 - this.offsetPercent));
        }
        if (index === this.nodes.length - 2 && percent && this.cropPercent) {
            percent = percent / this.cropPercent;
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
            return new RoadPath({...this, offsetIndex: 0, offsetPercent: 0, cropPercent: 0, nodes: []});
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
        return new RoadPath({
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

    slice(start, end) {
        if (start < 0) {
            start += this.nodes.length;
        }
        const offsetIndex = this.offsetIndex + start;
        const offsetPercent = start ? 0 : this.offsetPercent;
        const cropPercent = (end === undefined || end >= this.nodes.length) ? this.cropPercent : 0;
        return new RoadPath({
            ...this,
            nodes: this.nodes.slice(start, end),
            offsetIndex,
            offsetPercent,
            cropPercent,
        });
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
