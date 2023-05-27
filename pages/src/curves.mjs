
function round(n, p=0) {
    return Number(n.toFixed(p));
}


function xy(coord) {
    return `${round(coord[0], 4)},${round(coord[1], 4)}`;
}


export function pathToSVG(path) {
    const svg = [];
    for (const [cmd, arg] of path) {
        if (cmd === 'C') {
            svg.push(`C ${xy(arg.cp1)} ${xy(arg.cp2)} ${xy(arg.end)}`);
        } else if (cmd === 'L' || cmd === 'M') {
            svg.push(`${cmd} ${xy(arg)}`);
        } else {
            throw new TypeError('unhandled SVG comand');
        }
    }
    return svg.join('\n');
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
export function uniformCatmullRomPath(points, {loop}) {
    const svg = document.querySelector('svg.roads');
    const dot = (c, color='#0008', size=10) =>
        svg.insertAdjacentHTML(
            'beforeend', `<circle cx="${c[0]}" cy="${c[1]}" r="${size}" fill="${color}"/>`);
    if (loop) {
        points = Array.from(points);
        points.push(...points.slice(0, 3));
    }
    dot(points[0], '#f005');
    const path = [['M', points[1]]];
    for (let i = 1; i < points.length - 2; i++) {
        const p0 = points[i - 1];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2];
        const meta = p1[2];
        const straight = meta?.straight;
        if (straight) {
            path.push(['L', p2]);
            continue;
        }
        dot(p2, '#0f05');
        const A = 6;
        const B = 6;
        const N = 1 / 6;
        const M = 1 / 6;
        const  cp1 = [(-p0[0] + A * p1[0] + 1 * p2[0]) * N, (-p0[1] + A * p1[1] + 1 * p2[1]) * N];
        const  cp2 = [(p1[0] + B * p2[0] - 1 * p3[0]) * M, (p1[1] + B * p2[1] - 1 * p3[1]) * M];
        dot(cp1, '#fff9', 5);
        dot(cp2, '#0009', 5);
        path.push(['C', {cp1, cp2, end: p2}]);
    }
    dot(points.at(-1), '#0ff5');
    return path;
}


function bezierControl(a, b, c, smoothing, invert=false) {
    const dx = c[0] - a[0];
    const dy = c[1] - a[1];
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) + (invert ? Math.PI : 0);
    const length = distance * smoothing;
    return [b[0] + Math.cos(angle) * length, b[1] + Math.sin(angle) * length];
}


function vecDist(a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    return Math.sqrt(dx * dx + dy * dy);
}


export function cubicBezierPath(points, {loop, smoothing=0.2, verbose}={}) {
    const svg = document.querySelector('svg.roads');
    const dot = (c, color='#0008', size=10) =>
        svg.insertAdjacentHTML(
            'beforeend', `<circle cx="${c[0]}" cy="${c[1]}" r="${size}" fill="${color}"/>`);
    const path = [['M', points[1]]];
    dot(points[0], '#f005');
    if (loop) {
        points = Array.from(points);
        points.push(...points.slice(0, 3));
    }
    for (let i = 2; i < points.length - 1; i++) {
        const p1 = points[i];
        const straight = points[i - 1][2]?.straight;
        if (straight) {
            path.push(['L', p1]);
            continue;
        }
        const p_1 = points[i - 2];
        const p0 = points[i - 1];
        const p2 = points[i + 1];
        const tanIn = points[i][2]?.tanIn;
        const tanOut = points[i - 1][2]?.tanOut;
        const cp1 = tanOut ? [p0[0] + tanOut[0], p0[1] + tanOut[1]] : bezierControl(p_1, p0, p1, smoothing);
        const cp2 = tanIn ? [p1[0] + tanIn[0], p1[1] + tanIn[1]] : bezierControl(p0, p1, p2, smoothing, true);
        path.push(['C', {cp1, cp2, end: p1}]);
        dot(cp1, '#fff9', 5);
        dot(cp2, '#0009', 5);
        dot(p1, '#0f05');
    }
    dot(points.at(-1), '#0ff5');
    return path;
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
    return [x, y];
}


export function pathLength(path, epsilon=0.00001) {
    const C = [0, 0];
    let len = 0;
    for (const [cmd, arg] of path) {
        if (cmd === 'M') {
            [C[0], C[1]] = arg;
        } else if (cmd === 'L') {
            len += vecDist(C, arg);
            [C[0], C[1]] = arg;
        } else if (cmd === 'C') {
            let t = 0;
            let step0 = C;
            while (t < 1) {
                t = Math.min(1, t + epsilon);
                const step = computeBezier(t, C, arg.cp1, arg.cp2, arg.end);
                len += vecDist(step0, step);
                step0 = step;
            }
            [C[0], C[1]] = arg.end;
        } else {
            throw new TypeError("unsupported");
        }
    }
    return len;
}
