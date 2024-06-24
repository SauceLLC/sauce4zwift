/*
 * Adapted to Sauce's curves.mjs for output nodes
 *
 * Originally: simplify-svg-path
 *
 * The logic is a copy of Paper.js v0.12.11.
 */
/*
 * Paper.js - The Swiss Army Knife of Vector Graphics Scripting.
 * http://paperjs.org/
 *
 * Copyright (c) 2011 - 2020, Jürg Lehni & Jonathan Puckey
 * http://juerglehni.com/ & https://puckey.studio/
 *
 * Distributed under the MIT license. See LICENSE file for details.
 *
 * All rights reserved.
 */
// An Algorithm for Automatically Fitting Digitized Curves
// by Philip J. Schneider
// from "Graphics Gems", Academic Press, 1990
// Modifications and optimizations of original algorithm by Jürg Lehni.
const EPSILON = 1e-12;
const MACHINE_EPSILON = 1.12e-16;
const isMachineZero = (val) => val >= -MACHINE_EPSILON && val <= MACHINE_EPSILON;
// `Math.sqrt(x * x + y * y)` seems to be faster than `Math.hypot(x, y)`
const hypot = (x, y) => Math.sqrt(x * x + y * y);
const point = (x, y) => ({x, y});
const pointLength = (p) => hypot(p.x, p.y);
const pointNegate = (p) => point(-p.x, -p.y);
const pointAdd = (p1, p2) => point(p1.x + p2.x, p1.y + p2.y);
const pointSubtract = (p1, p2) => point(p1.x - p2.x, p1.y - p2.y);
const pointMultiplyScalar = (p, n) => point(p.x * n, p.y * n);
const pointDot = (p1, p2) => p1.x * p2.x + p1.y * p2.y;
const pointDistance = (p1, p2) => hypot(p1.x - p2.x, p1.y - p2.y);
const pointNormalize = (p, length = 1) => pointMultiplyScalar(p, length / (pointLength(p) || Infinity));
const createSegment = (p, i, index) => ({p, i, index});


function fit(points, closed, error) {
    // We need to duplicate the first and last segment when simplifying a
    // closed path.
    if (closed) {
        points.unshift(points[points.length - 1]);
        points.push(points[1]); // The point previously at index 0 is now 1.
    }
    const length = points.length;
    if (length === 0) {
        return [];
    }
    // To support reducing paths with multiple points in the same place
    // to one segment:
    const segments = [createSegment(points[0], undefined, 0)];
    fitCubic(points, segments, error, 0, length - 1,
             // Left Tangent
             pointSubtract(points[1], points[0]),
             // Right Tangent
             pointSubtract(points[length - 2], points[length - 1]));
    // Remove the duplicated segments for closed paths again.
    if (closed) {
        segments.shift();
        segments.pop();
    }
    return segments;
}


// Fit a Bezier curve to a (sub)set of digitized points
function fitCubic(points, segments, error, first, last, tan1, tan2, depth=0) {
    if (depth > 64) {
        console.warn("Dangerously close to stack overflow, rewrite this without recursion", depth);
    }
    //  Use heuristic if region only has two points in it
    if (last - first === 1) {
        const pt1 = points[first];
        const pt2 = points[last];
        const dist = pointDistance(pt1, pt2) / 3;
        addCurve(segments, [
            pt1,
            pointAdd(pt1, pointNormalize(tan1, dist)),
            pointAdd(pt2, pointNormalize(tan2, dist)),
            pt2
        ], last);
        return;
    }
    // Parameterize points, and attempt to fit curve
    const uPrime = chordLengthParameterize(points, first, last);
    let maxError = Math.max(error, error * error);
    let split;
    let parametersInOrder = true;
    // Try not 4 but 5 iterations
    for (let i = 0; i <= 4; i++) {
        const curve = generateBezier(points, first, last, uPrime, tan1, tan2);
        //  Find max deviation of points to fitted curve
        const max = findMaxError(points, first, last, curve, uPrime);
        if (max.error < error && parametersInOrder) {
            addCurve(segments, curve, last);
            return;
        }
        split = max.index;
        // If error not too large, try reparameterization and iteration
        if (max.error >= maxError) {
            break;
        }
        parametersInOrder = reparameterize(points, first, last, uPrime, curve);
        maxError = max.error;
    }
    // Fitting failed -- split at max error point and fit recursively
    const tanCenter = pointSubtract(points[split - 1], points[split + 1]);
    fitCubic(points, segments, error, first, split, tan1, tanCenter, depth+1);
    fitCubic(points, segments, error, split, last, pointNegate(tanCenter), tan2, depth+1);
}


function addCurve(segments, curve, index) {
    const prev = segments[segments.length - 1];
    prev.o = pointSubtract(curve[1], curve[0]);
    segments.push(createSegment(curve[3], pointSubtract(curve[2], curve[3]), index));
}


// Use least-squares method to find Bezier control points for region.
function generateBezier(points, first, last, uPrime, tan1, tan2) {
    const epsilon = EPSILON;
    const abs = Math.abs;
    const pt1 = points[first];
    const pt2 = points[last];
    const C = [[0, 0], [0, 0]];
    const X = [0, 0];
    for (let i = 0, l = last - first + 1; i < l; i++) {
        const u = uPrime[i];
        const t = 1 - u;
        const b = 3 * u * t;
        const b0 = t * t * t;
        const b1 = b * t;
        const b2 = b * u;
        const b3 = u * u * u;
        const a1 = pointNormalize(tan1, b1);
        const a2 = pointNormalize(tan2, b2);
        const tmp = pointSubtract(
            pointSubtract(points[first + i], pointMultiplyScalar(pt1, b0 + b1)),
            pointMultiplyScalar(pt2, b2 + b3));
        C[0][0] += pointDot(a1, a1);
        C[0][1] += pointDot(a1, a2);
        // C[1][0] += a1.dot(a2);
        C[1][0] = C[0][1];
        C[1][1] += pointDot(a2, a2);
        X[0] += pointDot(a1, tmp);
        X[1] += pointDot(a2, tmp);
    }
    // Compute the determinants of C and X
    const detC0C1 = C[0][0] * C[1][1] - C[1][0] * C[0][1];
    let alpha1, alpha2;
    if (abs(detC0C1) > epsilon) {
        // Kramer's rule
        const detC0X = C[0][0] * X[1] - C[1][0] * X[0];
        const detXC1 = X[0] * C[1][1] - X[1] * C[0][1];
        // Derive alpha values
        alpha1 = detXC1 / detC0C1;
        alpha2 = detC0X / detC0C1;
    } else {
        // Matrix is under-determined, try assuming alpha1 == alpha2
        const c0 = C[0][0] + C[0][1];
        const c1 = C[1][0] + C[1][1];
        alpha1 = alpha2 = abs(c0) > epsilon ? X[0] / c0 : abs(c1) > epsilon ? X[1] / c1 : 0;
    }
    // If alpha negative, use the Wu/Barsky heuristic (see text)
    // (if alpha is 0, you get coincident control points that lead to
    // divide by zero in any subsequent NewtonRaphsonRootFind() call.
    const segLength = pointDistance(pt2, pt1);
    const eps = epsilon * segLength;
    let handle1, handle2;
    if (alpha1 < eps || alpha2 < eps) {
        // fall back on standard (probably inaccurate) formula,
        // and subdivide further if needed.
        alpha1 = alpha2 = segLength / 3;
    } else {
        // Check if the found control points are in the right order when
        // projected onto the line through pt1 and pt2.
        const line = pointSubtract(pt2, pt1);
        // Control points 1 and 2 are positioned an alpha distance out
        // on the tangent vectors, left and right, respectively
        handle1 = pointNormalize(tan1, alpha1);
        handle2 = pointNormalize(tan2, alpha2);
        if (pointDot(handle1, line) - pointDot(handle2, line) > segLength * segLength) {
            // Fall back to the Wu/Barsky heuristic above.
            alpha1 = alpha2 = segLength / 3;
            handle1 = handle2 = null; // Force recalculation
        }
    }
    // First and last control points of the Bezier curve are
    // positioned exactly at the first and last data points
    return [
        pt1,
        pointAdd(pt1, handle1 || pointNormalize(tan1, alpha1)),
        pointAdd(pt2, handle2 || pointNormalize(tan2, alpha2)),
        pt2
    ];
}


// Given set of points and their parameterization, try to find
// a better parameterization.
function reparameterize(points, first, last, u, curve) {
    for (let i = first; i <= last; i++) {
        u[i - first] = findRoot(curve, points[i], u[i - first]);
    }
    // Detect if the new parameterization has reordered the points.
    // In that case, we would fit the points of the path in the wrong order.
    for (let i = 1, l = u.length; i < l; i++) {
        if (u[i] <= u[i - 1]) {
            return false;
        }
    }
    return true;
}


// Use Newton-Raphson iteration to find better root.
function findRoot(curve, point, u) {
    const curve1 = [], curve2 = [];
    // Generate control vertices for Q'
    for (let i = 0; i <= 2; i++) {
        curve1[i] = pointMultiplyScalar(pointSubtract(curve[i + 1], curve[i]), 3);
    }
    // Generate control vertices for Q''
    for (let i = 0; i <= 1; i++) {
        curve2[i] = pointMultiplyScalar(pointSubtract(curve1[i + 1], curve1[i]), 2);
    }
    // Compute Q(u), Q'(u) and Q''(u)
    const pt = evaluate(3, curve, u);
    const pt1 = evaluate(2, curve1, u);
    const pt2 = evaluate(1, curve2, u);
    const diff = pointSubtract(pt, point);
    const df = pointDot(pt1, pt1) + pointDot(diff, pt2);
    // u = u - f(u) / f'(u)
    return isMachineZero(df) ? u : u - pointDot(diff, pt1) / df;
}


// Evaluate a bezier curve at a particular parameter value
function evaluate(degree, curve, t) {
    const tmp = Array.from(curve);
    // Triangle computation
    for (let i = 1; i <= degree; i++) {
        for (let j = 0; j <= degree - i; j++) {
            tmp[j] = pointAdd(pointMultiplyScalar(tmp[j], 1 - t), pointMultiplyScalar(tmp[j + 1], t));
        }
    }
    return tmp[0];
}


// Assign parameter values to digitized points
// using relative distances between points.
function chordLengthParameterize(points, first, last) {
    const u = [0];
    for (let i = first + 1; i <= last; i++) {
        u[i - first] = u[i - first - 1] + pointDistance(points[i], points[i - 1]);
    }
    for (let i = 1, m = last - first; i <= m; i++) {
        u[i] /= u[m];
    }
    return u;
}


// Find the maximum squared distance of digitized points to fitted curve.
function findMaxError(points, first, last, curve, u) {
    let index = Math.floor((last - first + 1) / 2);
    let maxDist = 0;
    for (let i = first + 1; i < last; i++) {
        const P = evaluate(3, curve, u[i - first]);
        const v = pointSubtract(P, points[i]);
        const dist = v.x * v.x + v.y * v.y; // squared
        if (dist >= maxDist) {
            maxDist = dist;
            index = i;
        }
    }
    return {
        error: maxDist,
        index: index,
    };
}


function getSegmentsPathData(segments, closed, precision) {
    const length = segments.length;
    const precisionMultiplier = 10 ** precision;
    const round = precision < 16 ?
        n => Math.round(n * precisionMultiplier) / precisionMultiplier :
        n => n;
    const formatPair = (x, y) => [round(x), round(y)];
    let first = true;
    let prevX, prevY, outX, outY;
    const nodes = [];
    const addSegment = (segment, skipLine) => {
        const curX = segment.p.x;
        const curY = segment.p.y;
        if (first) {
            nodes.push({end: formatPair(curX, curY), originalIndex: segment.index});
            first = false;
        } else {
            const inX = curX + (segment.i?.x ?? 0);
            const inY = curY + (segment.i?.y ?? 0);
            if (inX === curX && inY === curY && outX === prevX && outY === prevY) {
                if (!skipLine) {
                    nodes.push({end: formatPair(curX, curY), originalIndex: segment.index});
                }
            } else {
                nodes.push({
                    cp1: formatPair(outX, outY),
                    cp2: formatPair(inX, inY),
                    end: formatPair(curX, curY),
                    originalIndex: segment.index,
                });
            }
        }
        prevX = curX;
        prevY = curY;
        outX = curX + (segment.o?.x ?? 0);
        outY = curY + (segment.o?.y ?? 0);
    };
    if (!length) {
        return [];
    }
    for (let i = 0; i < length; i++) {
        addSegment(segments[i]);
    }
    // Close path by drawing first segment again
    if (closed && length > 0) {
        addSegment(segments[0], true);
    }
    return nodes;
}


export function simplify(points, {closed, tolerance=2.5, precision=5}={}) {
    if (points.length === 0) {
        return '';
    }
    return getSegmentsPathData(fit(points.map(p => point(p[0], p[1])), closed, tolerance), closed, precision);
}
