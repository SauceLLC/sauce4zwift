import * as curves from '../shared/curves.mjs';
import console from 'node:console'; // Don't use jest's overly verbose console


test('pathReverse bezier 2d', () => {
    const points = [[10, 20], [20, 30], [44, 424], [5234, -1900]];
    const path = curves.cubicBezierPath(points, {includeEdges: true});
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
    const path = curves.catmullRomPath(points, {includeEdges: true});
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
    const path = curves.cubicBezierPath(points, {includeEdges: true});
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
    const path = curves.catmullRomPath(points, {includeEdges: true});
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
    const path = curves.catmullRomPath(points, {includeEdges: true});
    expect(path.pointAtDistance(0)).toStrictEqual(points[0]);
});

test('slice edges catmullrom', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44,566, -100], [5234, -190, 1000],
        [300, 200, 2000]];
    const path = curves.catmullRomPath(points, {includeEdges: true});
    const path2 = curves.catmullRomPath(points, {includeEdges: false});
    //for (const [i, x] of path.entries()) {
    //    expect(x).toStrictEqual(dblRevPath[i]);
    //}
});

test('slice edges cubicbezier', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [44,566, -100], [5234, -190, 1000],
        [300, 200, 2000]];
    const path = curves.cubicBezierPath(points, {includeEdges: true});
    const path2 = curves.cubicBezierPath(points, {includeEdges: false});
    const path3 = curves.catmullRomPath(points, {includeEdges: true});
    for (const [i, x] of path3.flatten(0.5).entries()) {
    //for (const [i, x] of points.entries()) {
        //console.log(i,',', x[2]);
    }
    //console.log(path2.flatten(0.1));
    //for (const [i, x] of path.entries()) {
    //    expect(x).toStrictEqual(dblRevPath[i]);
    //}
});


test('slice edges foo xxxx', () => {
    const nodes = foo.slice(340);
    nodes.unshift({cmd: 'M', end: foo[341].end});
    const path = new curves.CurvePath(nodes);
    for (const [i, x] of path.flatten(1).entries()) {
    //for (const [i, x] of points.entries()) {
        console.log(x.join());
    }
    //console.log(path2.flatten(0.1));
    //for (const [i, x] of path.entries()) {
    //    expect(x).toStrictEqual(dblRevPath[i]);
    //}
});


