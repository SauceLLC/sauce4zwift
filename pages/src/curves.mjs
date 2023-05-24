

function vectorDelta(a, b) {
    const xd = b[0] - a[0];
    const yd = b[1] - a[1];
    return Math.sqrt(xd * xd + yd * yd);
}


function pushC(path, cp1, cp2, end) {
    path.push(`C${cp1[0]},${cp1[1]} ${cp2[0]},${cp2[1]} ${end[0]},${end[1]}`);
}


/**
 * Original author: Nikolas Kyriakides
 * https://gist.github.com/nicholaswmin/c2661eb11cad5671d816
 *
 * Interpolates a Catmull-Rom Spline through a series of x/y points
 * Converts the CR Spline to Cubic Beziers for use with SVG items
 *
 * If 'alpha' is 0.5 then the 'Centripetal' variant is used
 * If 'alpha' is 1 then the 'Chordal' variant is used
 *
 * @param  {Array} points - Array of points, each point is an [x, y] array.
 * @return {String} d - SVG string with cubic bezier curves representing the Catmull-Rom Spline
 */
export function catmullRomPath(points, {loop, alpha=0.5, verbose}) {
    if (alpha === 0 || alpha === undefined) {
        throw new TypeError("Invalid alpha value");
    }
    if (loop) {
        //points = Array.from(points);
        //points.push(points[0]);
    }
    const start = 2;
    const path = [`M${points[start - 1][0]},${points[start - 1][1]}`];
    for (let i = start; i < points.length - 2; i++) {
        // XXX I think we should just start with p2 as the first end point for open curves
        const p0 = i === 0 ? points[0] : points[i - 1];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = i + 2 < points.length ? points[i + 2] : p2;
        const meta = p1[2];

        const d1 = vectorDelta(p0, p1);
        const d2 = vectorDelta(p1, p2);
        const d3 = vectorDelta(p2, p3);

        // Catmull-Rom to Cubic Bezier conversion matrix

        // A = 2d1^2a + 3d1^a * d2^a + d3^2a
        // B = 2d3^2a + 3d3^a * d2^a + d2^2a

        // [   0             1            0          0          ]
        // [   -d2^2a /N     A/N          d1^2a /N   0          ]
        // [   0             d3^2a /M     B/M        -d2^2a /M  ]
        // [   0             0            1          0          ]

        const d3powA = d3 ** alpha;
        const d3pow2A = d3 ** (2 * alpha);
        const d2powA = d2 ** alpha;
        const d2pow2A = d2 ** (2 * alpha);
        const d1powA = d1 ** alpha;
        const d1pow2A = d1 ** (2 * alpha);

        const A = 2 * d1pow2A + 3 * d1powA * d2powA + d2pow2A;
        const B = 2 * d3pow2A + 3 * d3powA * d2powA + d2pow2A;
        let N = 3 * d1powA * (d1powA + d2powA);
        if (N > 0) {
            N = 1 / N;
        }
        let M = 3 * d3powA * (d3powA + d2powA);
        if (M > 0) {
            M = 1 / M;
        }
        let cp1 = [
            (-d2pow2A * p0[0] + A * p1[0] + d1pow2A * p2[0]) * N,
            (-d2pow2A * p0[1] + A * p1[1] + d1pow2A * p2[1]) * N
        ];
        let cp2 = [
            (d3pow2A * p1[0] + B * p2[0] - d2pow2A * p3[0]) * M,
            (d3pow2A * p1[1] + B * p2[1] - d2pow2A * p3[1]) * M
        ];
        if (cp1[0] === 0 && cp1[1] === 0) {
            cp1 = p1;
        }
        if (cp2[0] === 0 && cp2[1] === 0) {
            cp2 = p2;
        }
        if (verbose) {
            const tanIn = meta?.tanIn;
            const tanOut = meta?.tanOut;
            console.log({p0, p1, p2, p3, d1, d2, d3, cp1, cp2, N, M, A, B, tanIn, tanOut, staight: meta?.straight});
        }
        pushC(path, cp1, cp2, p2);
    }
    return path.join('');
}


function controlPoint(cur, prev, next, reverse, smoothing, dx, dy) {
    prev ||= cur;
    next ||= cur;
    dx = dx == null ? next[0] - prev[0] : dx;
    dy = dy == null ? next[1] - prev[1] : dy;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) + (reverse ? Math.PI : 0);
    const length = distance * smoothing;
    console.log({dx, dy, distance, angle, length}, Math.cos(angle), Math.cos(angle) * length);
    return [cur[0] + Math.cos(angle) * length, cur[1] + Math.sin(angle) * length];
}


export function cubicBezierPath(points, {loop, smoothing=0.2}={}) {
    const path = [`M${points[0][0]},${points[0][1]}`];
    if (loop) {
        for (let i = 1; i < points.length + 1; i++) {
            const prevPrev = points.at(i - 2);
            const prev = points.at(i - 1);
            const cur = points[i % points.length];
            const next = points.at((i + 1) % points.length);
            const cp1 = controlPoint(prev, prevPrev, cur, false, smoothing);
            const cp2 = controlPoint(cur, prev, next, true, smoothing);
            pushC(path, cp1, cp2, cur);
        }
    } else {
        for (let i = 1; i < points.length; i++) {
            let cp1, cp2;
            if (points[i][2]) {
                const tanIn = points[i][2].tanIn;
                const tanOut = points[i][2].tanOut;
                if (tanIn) {
                    //console.warn("Test1-tanin", controlPoint(points[i - 1], points[i - 2], points[i], false, smoothing, ...tanIn));
                    //console.warn("Test2-tanin", controlPoint(points[i - 1], points[i - 2], points[i], true, smoothing, ...tanIn));
                    //cp1 = controlPoint(points[i - 1], points[i - 2], points[i], false, smoothing, ...tanIn);
                    cp1 = controlPoint(points[i - 1], points[i - 2], points[i], false, smoothing);
                    debugger;
                    cp1 = [points[i][0] + tanIn[0], points[i][1] + tanIn[1]];
                }
                if (tanOut) {
                    //console.warn("Test1-tanot", controlPoint(points[i], points[i - 1], points[i + 1], true, smoothing, ...tanOut));
                    //console.warn("Test2-tanot", controlPoint(points[i], points[i - 1], points[i + 1], false, smoothing, ...tanOut));
                    //cp2 = controlPoint(points[i], points[i - 1], points[i + 1], true, smoothing, ...tanOut);
                    cp2 = [points[i][0] - tanOut[0], points[i][1] - tanOut[1]];
                }
            }
            cp1 = cp1 || controlPoint(points[i - 1], points[i - 2], points[i], false, smoothing);
            cp2 = cp2 || controlPoint(points[i], points[i - 1], points[i + 1], true, smoothing);
            console.log({i, cp1, cp2}, points[i][2]);
            pushC(path, cp1, cp2, points[i]);
        }
    }
    return path.join('');
}
