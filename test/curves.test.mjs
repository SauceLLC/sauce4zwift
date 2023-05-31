import * as curves from '../shared/curves.mjs';
//import console from 'node:console'; // Don't use jest's overly verbose console


test('pathReverse bezier 2d', () => {
    const points = [[10, 20], [20, 30], [44, 424], [5234, -1900]];
    const path = curves.cubicBezierPath(points, {includeEdges: true});
    const revPath = curves.reversePath(path);
    const dblRevPath = curves.reversePath(revPath);
    expect(path.length).toBe(revPath.length);
    expect(path.length).toBe(dblRevPath.length);
    for (const [i, x] of path.entries()) {
        expect(x).toStrictEqual(dblRevPath[i]);
    }
});

test('pathReverse catmullRom 2d', () => {
    const points = [[10, 20], [20, 30], [44, 424], [5234, -190]];
    const path = curves.catmullRomPath(points, {includeEdges: true});
    const revPath = curves.reversePath(path);
    const dblRevPath = curves.reversePath(revPath);
    expect(path.length).toBe(revPath.length);
    expect(path.length).toBe(dblRevPath.length);
    for (const [i, x] of path.entries()) {
        expect(x).toStrictEqual(dblRevPath[i]);
    }
});

test('pathReverse bezier 3d', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [5234, -190, 1000]];
    const path = curves.cubicBezierPath(points, {includeEdges: true});
    const revPath = curves.reversePath(path);
    const dblRevPath = curves.reversePath(revPath);
    expect(path.length).toBe(revPath.length);
    expect(path.length).toBe(dblRevPath.length);
    for (const [i, x] of path.entries()) {
        expect(x).toStrictEqual(dblRevPath[i]);
    }
});

test('pathReverse catmullRom 3d', () => {
    const points = [[10, 20, -10], [20, 30, 100], [44, 424, 200], [5234, -190, 1000]];
    const path = curves.catmullRomPath(points, {includeEdges: true});
    const revPath = curves.reversePath(path);
    const dblRevPath = curves.reversePath(revPath);
    expect(path.length).toBe(revPath.length);
    expect(path.length).toBe(dblRevPath.length);
    for (const [i, x] of path.entries()) {
        expect(x).toStrictEqual(dblRevPath[i]);
    }
});
