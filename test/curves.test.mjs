import test from 'node:test';
import assert from 'node:assert';
import * as curves from '../shared/curves.mjs';


function assertCloseTo(a, b, t=0.001) {
    assert.ok(Math.abs(a - b) < t, `${a} !~= ${b}`);
}


test('pathReverse bezier 2d', () => {
    const points = [[10, 20], [20, 30], [44, 424], [5234, -1900]];
    const path = curves.cubicBezierPath(points);
    const revPath = path.toReversed();
    for (const [i, x] of path.nodes.entries()) {
        assert.deepStrictEqual(x.end, revPath.nodes[points.length - 1 - i].end);
    }
    const dblRevPath = revPath.toReversed();
    assert.strictEqual(path.nodes.length, revPath.nodes.length);
    assert.strictEqual(path.nodes.length, dblRevPath.nodes.length);
    for (const [i, x] of path.nodes.entries()) {
        assert.deepStrictEqual(x.end, dblRevPath.nodes[i].end);
    }
});

test('pathReverse catmullRom 2d', () => {
    const points = [[10, 20], [20, 30], [44, 424], [5234, -190]];
    const path = curves.catmullRomPath(points);
    const revPath = path.toReversed();
    const dblRevPath = revPath.toReversed();
    assert.strictEqual(path.nodes.length, revPath.nodes.length);
    assert.strictEqual(path.nodes.length, dblRevPath.nodes.length);
    for (const [i, x] of path.nodes.entries()) {
        assert.deepStrictEqual(x.end, dblRevPath.nodes[i].end);
    }
});

test('pathReverse bezier 3d', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [5234, -190, 1000]];
    const path = curves.cubicBezierPath(points);
    const revPath = path.toReversed();
    const dblRevPath = revPath.toReversed();
    assert.strictEqual(path.nodes.length, revPath.nodes.length);
    assert.strictEqual(path.nodes.length, dblRevPath.nodes.length);
    for (const [i, x] of path.nodes.entries()) {
        assert.deepStrictEqual(x.end, dblRevPath.nodes[i].end);
    }
});

test('pathReverse catmullRom 3d', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [5234, -190, 1000]];
    const path = curves.catmullRomPath(points);
    const revPath = path.toReversed();
    const dblRevPath = revPath.toReversed();
    assert.strictEqual(path.nodes.length, revPath.nodes.length);
    assert.strictEqual(path.nodes.length, dblRevPath.nodes.length);
    for (const [i, x] of path.nodes.entries()) {
        assert.deepStrictEqual(x.end, dblRevPath.nodes[i].end);
    }
});

test('pathReverse with straights', () => {
    const points = [[0, 0, 0], [1, 1, 0], [100, 100, 0, {straight: true}], [200, 200, 0], [201, 201, 0]];
    const path = curves.catmullRomPath(points);
    const revPath = path.toReversed();
    const dblRevPath = revPath.toReversed();
    for (const [i, x] of path.nodes.entries()) {
        assert.deepStrictEqual(x.end, dblRevPath.nodes[i].end);
    }
});

test('pathReverse with straights on n +/- 1 edges', () => {
    const points = [[0, 0, 0], [100, 100, 0, {straight: true}], [200, 200, 0]];
    const path = curves.catmullRomPath(points);
    const revPath = path.toReversed();
    const dblRevPath = revPath.toReversed();
    for (const [i, x] of path.nodes.entries()) {
        assert.deepStrictEqual(x.end, dblRevPath.nodes[i].end);
    }
});

test('point at distance 0', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44, 566, -100]];
    const path = curves.catmullRomPath(points);
    assert.deepStrictEqual(path.pointAtDistance(0), points[0]);
});

test('point at roadPercent 0', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44, 566, -100]];
    const path = curves.catmullRomPath(points, {road: true});
    assert.deepStrictEqual(path.boundsAtRoadPercent(0).point, points[1]);
});

test('point at roadPercent 1', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44, 566, -100]];
    const path = curves.catmullRomPath(points, {road: true});
    assert.deepStrictEqual(path.boundsAtRoadPercent(1).point, points.at(-2));
});

test('point at roadPercent 3 points', () => {
    const points = [[0, 0], [1, 1], [2, 2]];
    const path = curves.catmullRomPath(points, {road: true});
    assert.deepStrictEqual(path.boundsAtRoadPercent(-1).point.slice(0, 2), [1, 1]);
    assert.deepStrictEqual(path.boundsAtRoadPercent(0).point.slice(0, 2), [1, 1]);
    assert.deepStrictEqual(path.boundsAtRoadPercent(0.5).point.slice(0, 2), [1, 1]);
    assert.deepStrictEqual(path.boundsAtRoadPercent(1).point.slice(0, 2), [1, 1]);
    assert.deepStrictEqual(path.boundsAtRoadPercent(2).point.slice(0, 2), [1, 1]);
});

test('point at roadPercent 4 points', () => {
    const points = [[0, 0], [1, 1], [2, 2], [3, 3]];
    const path = curves.catmullRomPath(points, {road: true});
    assert.deepStrictEqual(path.boundsAtRoadPercent(0).point.slice(0, 2), [1, 1]);
    assert.deepStrictEqual(path.boundsAtRoadPercent(0.5).point.slice(0, 2), [1.5, 1.5]);
    assert.deepStrictEqual(path.boundsAtRoadPercent(1).point.slice(0, 2), [2, 2]);
});

test('subpath 0 -> 1', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44,566, -100], [5234, -190, 1000],
        [300, 200, 2000]];
    const path = curves.cubicBezierPath(points, {road: true});
    const subpath = path.subpathAtRoadPercents(0, 1);
    assert.strictEqual(subpath.roadLength, 6);
    assert.strictEqual(subpath.offsetIndex, 1);
    assert.strictEqual(subpath.offsetPercent, 0);
    assert.strictEqual(subpath.cropPercent, 0);
    assert.strictEqual(subpath.nodes.length, path.nodes.length - 2);
    for (const [i, x] of subpath.nodes.entries()) {
        assert.deepStrictEqual(x.end, points[i + 1]);
    }
});

test('subpath 1e-10 -> 1', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44,566, -100], [5234, -190, 1000],
        [300, 200, 2000]];
    const path = curves.cubicBezierPath(points, {road: true});
    const subpath = path.subpathAtRoadPercents(1e-10, 1);
    assert.strictEqual(subpath.nodes.length, path.nodes.length - 2);
    for (const [i, x] of subpath.nodes.entries()) {
        for (const [ii, n] of x.end.entries()) {
            assertCloseTo(n, points[i + 1][ii], 0.0001);
        }
    }
});

test('subpath 0 -> 0.99999999', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44,566, -100], [5234, -190, 1000],
        [300, 200, 2000]];
    const path = curves.cubicBezierPath(points, {road: true});
    const subpath = path.subpathAtRoadPercents(0, 1 - 1e-10);
    assert.strictEqual(subpath.nodes.length, path.nodes.length - 2);
    for (const [i, x] of subpath.nodes.entries()) {
        for (const [ii, n] of x.end.entries()) {
            assertCloseTo(n, points[i + 1][ii], 0.001);
        }
    }
});

test('subpath 1e-8 -> 0.99999999', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44,566, -100], [5234, -190, 1000],
        [300, 200, 2000]];
    const path = curves.cubicBezierPath(points, {road: true});
    const subpath = path.subpathAtRoadPercents(1e-10, 1 - 1e-10);
    assert.strictEqual(subpath.nodes.length, path.nodes.length - 2);
    for (const [i, x] of subpath.nodes.entries()) {
        for (const [ii, n] of x.end.entries()) {
            assertCloseTo(n, points[i + 1][ii], 0.001);
        }
    }
});

test('double subpath', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44,566, -100], [5234, -190, 1000],
        [300, 200, 2000]];
    const path = curves.cubicBezierPath(points, {road: true});
    const subpath = path.subpathAtRoadPercents(0.22, 0.55);
    assert.strictEqual(subpath.nodes.length, 3);
    const subpath2 = subpath.subpathAtRoadPercents(0.22, 0.55);
    assert.strictEqual(subpath2.nodes.length, 3);
    assert.strictEqual(subpath.roadLength, subpath2.roadLength);
    assert.strictEqual(subpath.offsetIndex, subpath2.offsetIndex);
    assert.strictEqual(subpath.offsetPercent, subpath2.offsetPercent);
    assert.strictEqual(subpath.cropPercent, subpath2.cropPercent);
    for (const [i, x] of subpath.nodes.entries()) {
        for (const [ii, n] of x.end.entries()) {
            assertCloseTo(n, subpath2.nodes[i].end[ii], 0.0001);
        }
    }
});

test('subpath start > end', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44,566, -100], [5234, -190, 1000],
        [300, 200, 2000]];
    const path = curves.cubicBezierPath(points, {road: true});
    const subpath = path.subpathAtRoadPercents(0.6, 0.4);
    assert.strictEqual(subpath.nodes.length, 0);
});

test('subpath small data/selection - perfect boundary', () => {
    const points = [[0, 0, 0], [1, 1, 1]];
    for (let i = 2; i < 6; i++) {
        points.push([i, i, i]);
        // Make deep copy just in case the internal design changes in the future
        const path = curves.cubicBezierPath(points.map(x => Array.from(x)), {road: true});
        const subpath = path.subpathAtRoadPercents(0, 1);
        assert.strictEqual(subpath.nodes.length, i - 1);
        assert.strictEqual(subpath.roadLength, i + 1);
        assert.strictEqual(subpath.offsetIndex, 1);
        assert.strictEqual(subpath.offsetPercent, 0);
        assert.strictEqual(subpath.cropPercent, 0);
    }
});

test('subpath small data/selection - minimum size (3)', () => {
    const points = [[0, 0, 0], [1, 1, 1], [2, 2, 2]];
    const path = curves.catmullRomPath(points, {road: true});
    const subpath = path.subpathAtRoadPercents(0.4, 0.999); // any number returns start/end of index 1
    assert.strictEqual(subpath.nodes.length, 1);
    assert.strictEqual(subpath.offsetIndex, 1);
    assert.strictEqual(subpath.offsetPercent, 0);
    assert.strictEqual(subpath.cropPercent, 0);
    assert.deepStrictEqual(subpath.nodes[0].end, [1, 1, 1]);
});

test('subpath small data/selection - perfect boundary', () => {
    const points = [[0, 0], [1, 1], [2, 2], [3, 3]];
    const path = curves.catmullRomPath(points, {road: true});
    const subpath = path.subpathAtRoadPercents(0, 1);
    assert.deepStrictEqual(subpath.nodes[0].end.slice(0, 2), [1, 1]);
    assert.deepStrictEqual(subpath.nodes[1].end.slice(0, 2), [2, 2]);
    assert.strictEqual(subpath.nodes.length, 2);
    assert.strictEqual(subpath.offsetIndex, 1);
    assert.strictEqual(subpath.offsetPercent, 0);
    assert.strictEqual(subpath.cropPercent, 0);
});

test('subpath small data/selection - perfect boundary with float selection', () => {
    const points = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]];
    const path = curves.catmullRomPath(points, {road: true});
    const subpath = path.subpathAtRoadPercents(0.5, 1);
    assert.deepStrictEqual(subpath.nodes[0].end.slice(0, 2), [2, 2]);
    assert.deepStrictEqual(subpath.nodes[1].end.slice(0, 2), [3, 3]);
    assert.strictEqual(subpath.nodes.length, 2);
    assert.strictEqual(subpath.offsetIndex, 2);
    assert.strictEqual(subpath.offsetPercent, 0);
    assert.strictEqual(subpath.cropPercent, 0);
});

test('subpath small data/selection - perfect boundary with real selection', () => {
    const points = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5]];
    const path = curves.catmullRomPath(points, {road: true});
    const subpath = path.subpathAtRoadPercents(1/3, 2/3);
    assert.deepStrictEqual(subpath.nodes[0].end.slice(0, 2), [2, 2]);
    assert.deepStrictEqual(subpath.nodes[1].end.slice(0, 2), [3, 3]);
    assert.strictEqual(subpath.nodes.length, 2);
    assert.strictEqual(subpath.offsetIndex, 2);
    assert.strictEqual(subpath.offsetPercent, 0);
    assert.strictEqual(subpath.cropPercent, 0);
});

test('subpath small data/selection - imperfect boundary', () => {
    const points = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5]];
    const path = curves.catmullRomPath(points, {road: true});
    const subpath = path.subpathAtRoadPercents(0.5, 0.5 + 1/3);
    assert.deepStrictEqual(subpath.nodes[0].end.slice(0, 2), [2.5, 2.5]);
    assert.deepStrictEqual(subpath.nodes[1].end.slice(0, 2), [3, 3]);
    assert.deepStrictEqual(subpath.nodes[2].end.slice(0, 2), [3.5, 3.5]);
    assert.strictEqual(subpath.nodes.length, 3);
    assert.strictEqual(subpath.offsetIndex, 2);
    assert.strictEqual(subpath.offsetPercent, 0.5);
    assert.strictEqual(subpath.cropPercent, 0.5);
});

test('subpath roadTime integrity - start clipped', () => {
    const ep = 0.000001;
    for (let i = 0; i < 1000; i++) {
        const points = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5]];
        const path = curves.catmullRomPath(points, {road: true});
        const start = Math.random();
        const end = 1;
        const subpath = path.subpathAtRoadPercents(start, end);
        assert(subpath.includesRoadPercent((end - start) / 2 + start));
        assert(subpath.includesRoadPercent(start + ep));
        assert(subpath.includesRoadPercent(end - ep));
        assert(!subpath.includesRoadPercent(end + ep));
        assert(!subpath.includesRoadPercent(start - ep));
    }
});

test('subpath roadTime integrity - end clipped', () => {
    const ep = 0.000001;
    for (let i = 0; i < 1000; i++) {
        const points = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5]];
        const path = curves.catmullRomPath(points, {road: true});
        const start = 0;
        const end = Math.max(ep * 2, Math.random());
        const subpath = path.subpathAtRoadPercents(start, end);
        assert(subpath.includesRoadPercent((end - start) / 2 + start));
        assert(subpath.includesRoadPercent((end - start) / 2 + start));
        assert(subpath.includesRoadPercent(start + ep));
        assert(subpath.includesRoadPercent(end - ep));
        assert(!subpath.includesRoadPercent(end + ep));
        assert(!subpath.includesRoadPercent(start - ep));
    }
});

test('subpath roadTime integrity - start and end clipped', () => {
    const ep = 0.000001;
    for (let i = 0; i < 1000; i++) {
        const points = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5]];
        const path = curves.catmullRomPath(points, {road: true});
        const a = Math.random();
        const b = Math.random();
        const [start, end] = a < b ? [a, b] : [b, a];
        const subpath = path.subpathAtRoadPercents(start, end);
        assert(subpath.includesRoadPercent((end - start) / 2 + start));
        assert(subpath.includesRoadPercent(start + ep));
        assert(subpath.includesRoadPercent(end - ep));
        assert(!subpath.includesRoadPercent(end + ep));
        assert(!subpath.includesRoadPercent(start - ep));
    }
});

test('roadTimeToPercent', () => {
    assert.strictEqual(curves.roadTimeToPercent(5000), 0);
    assert.strictEqual(curves.roadTimeToPercent(1005000), 1);
});

test('roadPercentToTime', () => {
    assert.strictEqual(curves.roadPercentToTime(0), 5000);
    assert.strictEqual(curves.roadPercentToTime(1), 1005000);
});

test('roadPercentToOffset', () => {
    assert.strictEqual(curves.roadPercentToOffset(-2, 3), 1);
    assert.strictEqual(curves.roadPercentToOffset(-1, 3), 1);
    assert.strictEqual(curves.roadPercentToOffset(0, 3), 1);
    assert.strictEqual(curves.roadPercentToOffset(1, 3), 1);
    assert.strictEqual(curves.roadPercentToOffset(2, 3), 1);
    assert.strictEqual(curves.roadPercentToOffset(0, 4), 1);
    assert.strictEqual(curves.roadPercentToOffset(1, 4), 2);
    assert.strictEqual(curves.roadPercentToOffset(0, 100), 1);
    assert.strictEqual(curves.roadPercentToOffset(1, 100), 98);
});

test('roadOffsetToPercent', () => {
    assert.strictEqual(curves.roadOffsetToPercent(0, 3), -Infinity);
    assert.strictEqual(curves.roadOffsetToPercent(1, 3), NaN);
    assert.strictEqual(curves.roadOffsetToPercent(2, 3), Infinity);
    assert.strictEqual(curves.roadOffsetToPercent(1, 4), 0);
    assert.strictEqual(curves.roadOffsetToPercent(2, 4), 1);
    assert.strictEqual(curves.roadOffsetToPercent(1, 100), 0);
    assert.strictEqual(curves.roadOffsetToPercent(98, 100), 1);
});

test('roadOffsetToTime', () => {
    assert.strictEqual(curves.roadOffsetToTime(0, 3), -Infinity);
    assert.strictEqual(curves.roadOffsetToTime(1, 3), NaN);
    assert.strictEqual(curves.roadOffsetToTime(2, 3), Infinity);
    assert.strictEqual(curves.roadOffsetToTime(1, 4), 5000);
    assert.strictEqual(curves.roadOffsetToTime(2, 4), 1005000);
    assert.strictEqual(curves.roadOffsetToTime(1, 100), 5000);
    assert.strictEqual(curves.roadOffsetToTime(98, 100), 1005000);
});

test('distance with finish straight', () => {
    const points = [
        [0, 0, 0, {straight: false}],
        [10, 0, 0, {straight: false}],
        [30, 0, 0, {straight: true}],
        [60, 0, 0, {straight: true}],
    ];
    const path = curves.catmullRomPath(points);
    assert.strictEqual(path.distance(0.1), 60);
});

test('distance with len - 1 straight', () => {
    const points = [
        [0, 0, 0, {straight: false}],
        [0, 10, 0, {straight: true}],
        [0, 30, 0, {straight: false}],
        [0, 60, 0, {straight: false}],
    ];
    const path = curves.catmullRomPath(points);
    assert.strictEqual(path.distance(0.1), 60);
});

test('distanceAtRoadPercent', () => {
    const points = [
        [0, 0, 0, {straight: false}],
        [0, 10, 0, {straight: false}],
        [0, 30, 0, {straight: false}],
        [0, 40, 0, {straight: false}],
        [0, 50, 0, {straight: false}],
    ];
    const path = curves.catmullRomPath(points, {road: true});
    for (const x of [0, 1/3, 0.5, 2/3, .9, 1, 1.1, 2, -0.1, -1.1]) {
        const subpath = path.subpathAtRoadPercents(-1, x);
        const subpathDist = subpath.distance();
        const dist = path.distanceAtRoadPercent(x);
        assertCloseTo(dist, subpathDist, 1e-6);
    }
});

test('distanceAtRoadPercent boundaries', () => {
    const points = [
        [0, 0, 0, {straight: false}],
        [0, 10, 0, {straight: false}],
        [0, 30, 0, {straight: false}],
        [0, 40, 0, {straight: false}],
        [0, 50, 0, {straight: false}],
    ];
    const path = curves.catmullRomPath(points, {road: true});
    assertCloseTo(path.distanceAtRoadPercent(-Infinity), 0, 1e-6);
    assertCloseTo(path.distanceAtRoadPercent(-1), 0, 1e-6);
    assertCloseTo(path.distanceAtRoadPercent(0), 10, 1e-6);
    assertCloseTo(path.distanceAtRoadPercent(1), 40, 1e-6);
    assertCloseTo(path.distanceAtRoadPercent(2), 50, 1e-6);
    assertCloseTo(path.distanceAtRoadPercent(Infinity), 50, 1e-6);
});

test('distanceAtRoadPercent with straights', () => {
    const arrangements = [
        [
            [0, 0, 0, {straight: true}],
            [0, 10, 0, {straight: false}],
            [0, 30, 0, {straight: true}],
            [0, 40, 0, {straight: false}],
            [0, 50, 0, {straight: true}],
        ], [
            [0, 0, 0, {straight: false}],
            [0, 10, 0, {straight: true}],
            [0, 30, 0, {straight: false}],
            [0, 40, 0, {straight: true}],
            [0, 50, 0, {straight: false}],
        ], [
            [0, 0, 0, {straight: true}],
            [0, 10, 0, {straight: true}],
            [0, 30, 0, {straight: true}],
            [0, 40, 0, {straight: true}],
            [0, 50, 0, {straight: true}],
        ], [
            [0, 0, 0, {straight: true}],
            [0, 10, 0, {straight: false}],
            [0, 30, 0, {straight: false}],
            [0, 40, 0, {straight: false}],
            [0, 50, 0, {straight: true}],
        ], [
            [0, 0, 0, {straight: false}],
            [0, 10, 0, {straight: true}],
            [0, 30, 0, {straight: true}],
            [0, 40, 0, {straight: true}],
            [0, 50, 0, {straight: false}],
        ]
    ];
    for (const points of arrangements) {
        const path = curves.catmullRomPath(points, {road: true});
        for (const x of [0, 1/3, 0.5, 2/3, .9, 1, 1.1, 2, -0.1, -1.1]) {
            const subpath = path.subpathAtRoadPercents(-1, x);
            const subpathDist = subpath.distance();
            const dist = path.distanceAtRoadPercent(x);
            assertCloseTo(dist, subpathDist);
        }
    }
});

test('distance bench', () => {
    const points = [];
    for (let i = 0; i < 400; i++) {
        points.push([i, 0, 0, {straight: Math.random() > 0.9}]);
    }
    const path = curves.catmullRomPath(points, {road: true});
    for (let i = 0; i < 2000; i++) {
        const d = path.subpathAtRoadPercents(0.2, 0.2 + Math.random()).distance();
        assert.ok(d > 0);
    }
});

test('distanceAtRoadPercent bench', () => {
    const points = [];
    for (let i = 0; i < 200; i++) {
        points.push([i, 0, 0, {straight: Math.random() > 0.9}]);
    }
    const path = curves.catmullRomPath(points, {road: true});
    for (let i = 0; i < 100; i++) {
        const d = path.distanceAtRoadPercent(0.9999);
        assert.ok(d > 0);
    }
});

test('roadPercentToOffsetTuple boundaries', () => {
    let points = [
        [0, 0, 0],
        [0, 10, 0],
        [0, 20, 0],
        [0, 30, 0],
        [0, 40, 0],
    ];
    let path = curves.catmullRomPath(points, {road: true});
    assert.deepEqual(path.roadPercentToOffsetTuple(0), [1, 0]);
    assert.deepEqual(path.roadPercentToOffsetTuple(-1), [0, 0]);
    assert.deepEqual(path.roadPercentToOffsetTuple(-2), [0, 0]);
    assert.deepEqual(path.roadPercentToOffsetTuple(1), [3, 0]);
    assert.deepEqual(path.roadPercentToOffsetTuple(2), [4, 0]);
    assert.deepEqual(path.roadPercentToOffsetTuple(-Infinity), [0, 0]);
    assert.deepEqual(path.roadPercentToOffsetTuple(Infinity), [4, 0]);
    points = [
        [0, 0, 0],
        [0, 10, 0],
        [0, 20, 0],
        [0, 30, 0],
    ];
    path = curves.catmullRomPath(points, {road: true});
    assert.deepEqual(path.roadPercentToOffsetTuple(0), [1, 0]);
    assert.deepEqual(path.roadPercentToOffsetTuple(-1), [0, 0]);
    assert.deepEqual(path.roadPercentToOffsetTuple(-2), [0, 0]);
    assert.deepEqual(path.roadPercentToOffsetTuple(1), [2, 0]);
    assert.deepEqual(path.roadPercentToOffsetTuple(2), [3, 0]);
    assert.deepEqual(path.roadPercentToOffsetTuple(-Infinity), [0, 0]);
    assert.deepEqual(path.roadPercentToOffsetTuple(Infinity), [3, 0]);
});
