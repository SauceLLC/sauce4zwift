import * as curves from '../shared/curves.mjs';
import console from 'node:console'; // Don't use jest's overly verbose console


test('pathReverse bezier 2d', () => {
    const points = [[10, 20], [20, 30], [44, 424], [5234, -1900]];
    const path = curves.cubicBezierPath(points);
    const revPath = path.reverse();
    const dblRevPath = revPath.reverse();
    expect(path.length).toBe(revPath.length);
    expect(path.length).toBe(dblRevPath.length);
    for (const [i, x] of path.entries()) {
        expect(x).toStrictEqual(dblRevPath[i]);
    }
});

test('pathReverse catmullRom 2d', () => {
    const points = [[10, 20], [20, 30], [44, 424], [5234, -190]];
    const path = curves.catmullRomPath(points);
    const revPath = path.reverse();
    const dblRevPath = revPath.reverse();
    expect(path.length).toBe(revPath.length);
    expect(path.length).toBe(dblRevPath.length);
    for (const [i, x] of path.entries()) {
        expect(x).toStrictEqual(dblRevPath[i]);
    }
});

test('pathReverse bezier 3d', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [5234, -190, 1000]];
    const path = curves.cubicBezierPath(points);
    const revPath = path.reverse();
    const dblRevPath = revPath.reverse();
    expect(path.length).toBe(revPath.length);
    expect(path.length).toBe(dblRevPath.length);
    for (const [i, x] of path.entries()) {
        expect(x).toStrictEqual(dblRevPath[i]);
    }
});

test('pathReverse catmullRom 3d', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [5234, -190, 1000]];
    const path = curves.catmullRomPath(points);
    const revPath = path.reverse();
    const dblRevPath = revPath.reverse();
    expect(path.length).toBe(revPath.length);
    expect(path.length).toBe(dblRevPath.length);
    for (const [i, x] of path.entries()) {
        expect(x).toStrictEqual(dblRevPath[i]);
    }
});

test('point at distance 0', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44,566, -100]];
    const path = curves.catmullRomPath(points);
    expect(path.pointAtDistance(0)).toStrictEqual(points[0]);
});

test('point at roadPercent 0', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44,566, -100]];
    const path = curves.catmullRomPath(points);
    expect(path.boundsAtRoadPercent(0).point).toStrictEqual(points[1]);
});

test('point at roadPercent 1', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44,566, -100]];
    const path = curves.catmullRomPath(points);
    expect(path.boundsAtRoadPercent(1).point).toStrictEqual(points.at(-2));
});


test('subpath 0 -> 1', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44,566, -100], [5234, -190, 1000],
        [300, 200, 2000]];
    const path = curves.cubicBezierPath(points);
    const subpath = path.subpathAtRoadPercents(0, 1);
    expect(subpath.length).toBe(path.length - 2);
    for (const [i, x] of subpath.entries()) {
        expect(x.end).toStrictEqual(points[i + 1]);
    }
});

test('subpath 1e-10 -> 1', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44,566, -100], [5234, -190, 1000],
        [300, 200, 2000]];
    const path = curves.cubicBezierPath(points);
    const subpath = path.subpathAtRoadPercents(1e-10, 1);
    expect(subpath.length).toBe(path.length - 2);
    for (const [i, x] of subpath.entries()) {
        for (const [ii, n] of x.end.entries()) {
            expect(n).toBeCloseTo(points[i + 1][ii], 2);
        }
    }
});

test('subpath 0 -> 0.99999999', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44,566, -100], [5234, -190, 1000],
        [300, 200, 2000]];
    const path = curves.cubicBezierPath(points);
    const subpath = path.subpathAtRoadPercents(0, 1 - 1e-10);
    expect(subpath.length).toBe(path.length - 2);
    for (const [i, x] of subpath.entries()) {
        for (const [ii, n] of x.end.entries()) {
            expect(n).toBeCloseTo(points[i + 1][ii], 2);
        }
    }
});

test('subpath 1e-8 -> 0.99999999', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44,566, -100], [5234, -190, 1000],
        [300, 200, 2000]];
    const path = curves.cubicBezierPath(points);
    const subpath = path.subpathAtRoadPercents(1e-10, 1 - 1e-10);
    expect(subpath.length).toBe(path.length - 2);
    for (const [i, x] of subpath.entries()) {
        for (const [ii, n] of x.end.entries()) {
            expect(n).toBeCloseTo(points[i + 1][ii], 2);
        }
    }
});
