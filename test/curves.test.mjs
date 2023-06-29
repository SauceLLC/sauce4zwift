import * as curves from '../shared/curves.mjs';
import console from 'node:console'; // Don't use jest's overly verbose console


function fmtPath(p) {
    const o = p.toJSON();
    o.nodes = p.nodes.map(JSON.stringify);
    return o;
}


test('pathReverse bezier 2d', () => {
    const points = [[10, 20], [20, 30], [44, 424], [5234, -1900]];
    const path = curves.cubicBezierPath(points);
    const revPath = path.toReversed();
    for (const [i, x] of path.nodes.entries()) {
        expect(x.end).toEqual(revPath.nodes[points.length - 1 - i].end);
    }
    const dblRevPath = revPath.toReversed();
    expect(path.nodes.length).toBe(revPath.nodes.length);
    expect(path.nodes.length).toBe(dblRevPath.nodes.length);
    for (const [i, x] of path.nodes.entries()) {
        expect(x).toEqual(dblRevPath.nodes[i]);
    }
});

test('pathReverse catmullRom 2d', () => {
    const points = [[10, 20], [20, 30], [44, 424], [5234, -190]];
    const path = curves.catmullRomPath(points);
    const revPath = path.toReversed();
    const dblRevPath = revPath.toReversed();
    expect(path.nodes.length).toBe(revPath.nodes.length);
    expect(path.nodes.length).toBe(dblRevPath.nodes.length);
    for (const [i, x] of path.nodes.entries()) {
        expect(x).toEqual(dblRevPath.nodes[i]);
    }
});

test('pathReverse bezier 3d', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [5234, -190, 1000]];
    const path = curves.cubicBezierPath(points);
    const revPath = path.toReversed();
    const dblRevPath = revPath.toReversed();
    expect(path.nodes.length).toBe(revPath.nodes.length);
    expect(path.nodes.length).toBe(dblRevPath.nodes.length);
    for (const [i, x] of path.nodes.entries()) {
        expect(x).toEqual(dblRevPath.nodes[i]);
    }
});

test('pathReverse catmullRom 3d', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [5234, -190, 1000]];
    const path = curves.catmullRomPath(points);
    const revPath = path.toReversed();
    const dblRevPath = revPath.toReversed();
    expect(path.nodes.length).toBe(revPath.nodes.length);
    expect(path.nodes.length).toBe(dblRevPath.nodes.length);
    for (const [i, x] of path.nodes.entries()) {
        expect(x).toEqual(dblRevPath.nodes[i]);
    }
});

test('point at distance 0', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44, 566, -100]];
    const path = curves.catmullRomPath(points);
    expect(path.pointAtDistance(0)).toStrictEqual(points[0]);
});

test('point at roadPercent 0', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44, 566, -100]];
    const path = curves.catmullRomPath(points, {road: true});
    expect(path.boundsAtRoadPercent(0).point).toStrictEqual(points[1]);
});

test('point at roadPercent 1', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44, 566, -100]];
    const path = curves.catmullRomPath(points, {road: true});
    expect(path.boundsAtRoadPercent(1).point).toStrictEqual(points.at(-2));
});

test('point at roadPercent 3 points', () => {
    const points = [[0, 0], [1, 1], [2, 2]];
    const path = curves.catmullRomPath(points, {road: true});
    expect(path.boundsAtRoadPercent(-1).point.slice(0, 2)).toEqual([1, 1]);
    expect(path.boundsAtRoadPercent(0).point.slice(0, 2)).toEqual([1, 1]);
    expect(path.boundsAtRoadPercent(0.5).point.slice(0, 2)).toEqual([1, 1]);
    expect(path.boundsAtRoadPercent(1).point.slice(0, 2)).toEqual([1, 1]);
    expect(path.boundsAtRoadPercent(2).point.slice(0, 2)).toEqual([1, 1]);
});

test('point at roadPercent 4 points', () => {
    const points = [[0, 0], [1, 1], [2, 2], [3, 3]];
    const path = curves.catmullRomPath(points, {road: true});
    expect(path.boundsAtRoadPercent(0).point.slice(0, 2)).toEqual([1, 1]);
    expect(path.boundsAtRoadPercent(0.5).point.slice(0, 2)).toEqual([1.5, 1.5]);
    expect(path.boundsAtRoadPercent(1).point.slice(0, 2)).toEqual([2, 2]);
});

test('subpath 0 -> 1', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44,566, -100], [5234, -190, 1000],
        [300, 200, 2000]];
    const path = curves.cubicBezierPath(points, {road: true});
    const subpath = path.subpathAtRoadPercents(0, 1);
    expect(subpath.roadLength).toBe(6);
    expect(subpath.offsetIndex).toBe(1);
    expect(subpath.offsetPercent).toBe(0);
    expect(subpath.cropPercent).toBe(0);
    expect(subpath.nodes.length).toBe(path.nodes.length - 2);
    for (const [i, x] of subpath.nodes.entries()) {
        expect(x.end).toStrictEqual(points[i + 1]);
    }
});

test('subpath 1e-10 -> 1', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44,566, -100], [5234, -190, 1000],
        [300, 200, 2000]];
    const path = curves.cubicBezierPath(points, {road: true});
    const subpath = path.subpathAtRoadPercents(1e-10, 1);
    expect(subpath.nodes.length).toBe(path.nodes.length - 2);
    for (const [i, x] of subpath.nodes.entries()) {
        for (const [ii, n] of x.end.entries()) {
            expect(n).toBeCloseTo(points[i + 1][ii], 2);
        }
    }
});

test('subpath 0 -> 0.99999999', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44,566, -100], [5234, -190, 1000],
        [300, 200, 2000]];
    const path = curves.cubicBezierPath(points, {road: true});
    const subpath = path.subpathAtRoadPercents(0, 1 - 1e-10);
    expect(subpath.nodes.length).toBe(path.nodes.length - 2);
    for (const [i, x] of subpath.nodes.entries()) {
        for (const [ii, n] of x.end.entries()) {
            expect(n).toBeCloseTo(points[i + 1][ii], 2);
        }
    }
});

test('subpath 1e-8 -> 0.99999999', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44,566, -100], [5234, -190, 1000],
        [300, 200, 2000]];
    const path = curves.cubicBezierPath(points, {road: true});
    const subpath = path.subpathAtRoadPercents(1e-10, 1 - 1e-10);
    expect(subpath.nodes.length).toBe(path.nodes.length - 2);
    for (const [i, x] of subpath.nodes.entries()) {
        for (const [ii, n] of x.end.entries()) {
            expect(n).toBeCloseTo(points[i + 1][ii], 2);
        }
    }
});

test('double subpath', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44,566, -100], [5234, -190, 1000],
        [300, 200, 2000]];
    const path = curves.cubicBezierPath(points, {road: true});
    const subpath = path.subpathAtRoadPercents(0.22, 0.55);
    expect(subpath.nodes.length).toBe(3);
    const subpath2 = subpath.subpathAtRoadPercents(0.22, 0.55);
    expect(subpath2.nodes.length).toBe(3);
    expect(subpath.roadLength).toBe(subpath2.roadLength);
    expect(subpath.offsetIndex).toBe(subpath2.offsetIndex);
    expect(subpath.offsetPercent).toBe(subpath2.offsetPercent);
    expect(subpath.cropPercent).toBe(subpath2.cropPercent);
    for (const [i, x] of subpath.nodes.entries()) {
        for (const [ii, n] of x.end.entries()) {
            expect(n).toBeCloseTo(subpath2.nodes[i].end[ii], 2);
        }
    }
});

test('subpath start > end', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44,566, -100], [5234, -190, 1000],
        [300, 200, 2000]];
    const path = curves.cubicBezierPath(points, {road: true});
    const subpath = path.subpathAtRoadPercents(0.6, 0.4);
    expect(subpath.nodes.length).toBe(0);
});

test('subpath small data/selection - perfect boundary', () => {
    const points = [[0, 0, 0], [1,1,1]];
    for (let i = 2; i < 6; i++) {
        points.push([i, i, i]);
        // Make deep copy just in case the internal design changes in the future
        const path = curves.cubicBezierPath(points.map(x => Array.from(x)), {road: true});
        const subpath = path.subpathAtRoadPercents(0, 1);
        expect(subpath.nodes.length).toBe(i - 1);
        expect(subpath.roadLength).toBe(i + 1);
        expect(subpath.offsetIndex).toBe(1);
        expect(subpath.offsetPercent).toBe(0);
        expect(subpath.cropPercent).toBe(0);
    }
});

test('subpath small data/selection - minimum size (3)', () => {
    const points = [[0, 0, 0], [1, 1, 1], [2, 2, 2]];
    const path = curves.catmullRomPath(points, {road: true});
    const subpath = path.subpathAtRoadPercents(0.4, 0.999); // any number returns start/end of index 1
    expect(subpath.nodes.length).toBe(1);
    expect(subpath.offsetIndex).toBe(1);
    expect(subpath.offsetPercent).toBe(0);
    expect(subpath.cropPercent).toBe(0);
    expect(subpath.nodes[0].end).toEqual([1, 1, 1]);
});

test('subpath small data/selection - perfect boundary', () => {
    const points = [[0, 0], [1, 1], [2, 2], [3, 3]];
    const path = curves.catmullRomPath(points, {road: true});
    const subpath = path.subpathAtRoadPercents(0, 1);
    expect(subpath.nodes[0].end.slice(0, 2)).toEqual([1, 1]);
    expect(subpath.nodes[1].end.slice(0, 2)).toEqual([2, 2]);
    expect(subpath.nodes.length).toBe(2);
    expect(subpath.offsetIndex).toBe(1);
    expect(subpath.offsetPercent).toBe(0);
    expect(subpath.cropPercent).toBe(0);
});

test('subpath small data/selection - perfect boundary with float selection', () => {
    const points = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]];
    const path = curves.catmullRomPath(points, {road: true});
    const subpath = path.subpathAtRoadPercents(0.5, 1);
    expect(subpath.nodes[0].end.slice(0, 2)).toEqual([2, 2]);
    expect(subpath.nodes[1].end.slice(0, 2)).toEqual([3, 3]);
    expect(subpath.nodes.length).toBe(2);
    expect(subpath.offsetIndex).toBe(2);
    expect(subpath.offsetPercent).toBe(0);
    expect(subpath.cropPercent).toBe(0);
});

test('subpath small data/selection - perfect boundary with real selection', () => {
    const points = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5]];
    const path = curves.catmullRomPath(points, {road: true});
    const subpath = path.subpathAtRoadPercents(1/3, 2/3);
    expect(subpath.nodes[0].end.slice(0, 2)).toEqual([2, 2]);
    expect(subpath.nodes[1].end.slice(0, 2)).toEqual([3, 3]);
    expect(subpath.nodes.length).toBe(2);
    expect(subpath.offsetIndex).toBe(2);
    expect(subpath.offsetPercent).toBe(0);
    expect(subpath.cropPercent).toBe(0);
});

test('subpath small data/selection - imperfect boundary', () => {
    const points = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5]];
    const path = curves.catmullRomPath(points, {road: true});
    const subpath = path.subpathAtRoadPercents(0.5, 0.5 + 1/3);
    expect(subpath.nodes[0].end.slice(0, 2)).toEqual([2.5, 2.5]);
    expect(subpath.nodes[1].end.slice(0, 2)).toEqual([3, 3]);
    expect(subpath.nodes[2].end.slice(0, 2)).toEqual([3.5, 3.5]);
    expect(subpath.nodes.length).toBe(3);
    expect(subpath.offsetIndex).toBe(2);
    expect(subpath.offsetPercent).toBe(0.5);
    expect(subpath.cropPercent).toBe(0.5);
});

test('roadTimeToPercent', () => {
    expect(curves.roadTimeToPercent(5000)).toBe(0);
    expect(curves.roadTimeToPercent(1005000)).toBe(1);
});

test('roadPercentToTime', () => {
    expect(curves.roadPercentToTime(0)).toBe(5000);
    expect(curves.roadPercentToTime(1)).toBe(1005000);
});

test('roadPercentToOffset', () => {
    expect(curves.roadPercentToOffset(-2, 3)).toBe(1);
    expect(curves.roadPercentToOffset(-1, 3)).toBe(1);
    expect(curves.roadPercentToOffset(0, 3)).toBe(1);
    expect(curves.roadPercentToOffset(1, 3)).toBe(1);
    expect(curves.roadPercentToOffset(2, 3)).toBe(1);
    expect(curves.roadPercentToOffset(0, 4)).toBe(1);
    expect(curves.roadPercentToOffset(1, 4)).toBe(2);
    expect(curves.roadPercentToOffset(0, 100)).toBe(1);
    expect(curves.roadPercentToOffset(1, 100)).toBe(98);
});

test('roadOffsetToPercent', () => {
    expect(curves.roadOffsetToPercent(0, 3)).toBe(-Infinity);
    expect(curves.roadOffsetToPercent(1, 3)).toBe(NaN);
    expect(curves.roadOffsetToPercent(2, 3)).toBe(Infinity);
    expect(curves.roadOffsetToPercent(1, 4)).toBe(0);
    expect(curves.roadOffsetToPercent(2, 4)).toBe(1);
    expect(curves.roadOffsetToPercent(1, 100)).toBe(0);
    expect(curves.roadOffsetToPercent(98, 100)).toBe(1);
});

test('roadOffsetToTime', () => {
    expect(curves.roadOffsetToTime(0, 3)).toBe(-Infinity);
    expect(curves.roadOffsetToTime(1, 3)).toBe(NaN);
    expect(curves.roadOffsetToTime(2, 3)).toBe(Infinity);
    expect(curves.roadOffsetToTime(1, 4)).toBe(5000);
    expect(curves.roadOffsetToTime(2, 4)).toBe(1005000);
    expect(curves.roadOffsetToTime(1, 100)).toBe(5000);
    expect(curves.roadOffsetToTime(98, 100)).toBe(1005000);
});
