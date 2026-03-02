import Path from 'node:path';
import FS from './fs-safe.js';
import * as Curves from '../shared/curves.mjs';
import {fileURLToPath} from 'node:url';
import Assert from 'node:assert/strict';

const __dirname = Path.dirname(fileURLToPath(import.meta.url));

const _segments = new Map();
const _segmentsByCourse = new Map();
const _segmentsByRoad = new Map();
const _routes = new Map();
const _roads = new Map();
const _roadsByCourse = new Map();
const _roadCurvePaths = new Map();
const _coursesByWorld = new Map();

export const realWorldCourseId = -2;
export const worldMetas = {
    [realWorldCourseId]: {
        worldId: realWorldCourseId,
        courseId: realWorldCourseId,
        name: 'Earth',
        lonOffset: 0,
        latOffset: 0,
        lonDegDist: 0.01,
        latDegDist: -0.01,
        physicsSlopeScale: 100,
        waterPlaneLevel: 0,
        seaLevel: 0,
        anchorX: 500, // XXX
        anchorY: 500, // XXX
        minX: -1000, // XXX
        minY: -1000, // XXX
        maxX: 1000, // XXX
        maxY: 1000, // XXX
        tileScale: 1, // XXX
        mapScale: 4096, // XXX
    }
};
_coursesByWorld.set(realWorldCourseId, worldMetas[realWorldCourseId]);

try {
    const worldListFile = Path.join(__dirname, `../shared/deps/data/worldlist.json`);
    for (const x of JSON.parse(FS.readFileSync(worldListFile))) {
        worldMetas[x.courseId] = x;
        _coursesByWorld.set(x.worldId, x);
        const segments = readSegmentsForWorld(x.worldId);
        _segmentsByCourse.set(x.courseId, segments);
        for (const x of segments) {
            _segments.set(x.id, x);
        }
    }
    for (const x of readRoutes()) {
        _routes.set(x.id, x);
    }
} catch(e) {
    console.error('World data load error:', e);
}


export function getWorldMetas() {
    return Object.values(worldMetas);
}


export function getCourseId(worldId) {
    return _coursesByWorld.get(worldId)?.courseId;
}


export function getRoadSig(courseId, roadId, reverse) {
    return roadId << 9 | courseId << 1 | (reverse ? 1 : 0);
}


export function fromRoadSig(roadSig) {
    return {
        roadId: roadSig >>> 9,
        courseId: roadSig >>> 1 & 0xff,
        reverse: Boolean(roadSig & 0x1),
    };
}


function readSegmentsForWorld(worldId) {
    const fname = Path.join(__dirname, `../shared/deps/data/worlds/${worldId}/segments.json`);
    let segments;
    try {
        segments = JSON.parse(FS.readFileSync(fname));
    } catch(e) {
        console.error('No segments loaded for world:', worldId);
        return [];
    }
    const courseId = getCourseId(worldId);
    for (const x of segments) {
        x.courseId = courseId;
        try {
            if (!x.loop) {
                Assert.ok(x.reverse ? x.roadStart >= x.roadFinish : x.roadStart <= x.roadFinish);
            } else {
                Assert.ok(Math.abs(x.roadFinish - x.roadStart) < 0.1);
            }
        } catch(e) { debugger; }
    }
    return segments;
}


export function getSegment(id) {
    return _segments.get(id);
}


export function getSegments(ids) {
    if (ids == null) {
        return Array.from(_segments.values());
    }
    return ids.map(x => _segments.get(x));
}


export function getCourseSegments(courseId) {
    return _segmentsByCourse.get(courseId) || [];
}


export function getRoadSegments(courseId, id, reverse) {
    const key = `${courseId}-${id}-${reverse ?? '*'}`;
    if (!_segmentsByRoad.has(key)) {
        const segments = [];
        _segmentsByRoad.set(key, segments);
        for (const x of getCourseSegments(courseId)) {
            if (x.roadId === id && (reverse == null || !!reverse === !!x.reverse)) {
                segments.push(x);
            }
        }
    }
    return _segmentsByRoad.get(key);
}


export function getCourseRoads(courseId) {
    if (!_roadsByCourse.has(courseId)) {
        let fname;
        if (courseId === 'portal') {
            fname = Path.join(__dirname, `../shared/deps/data/portal_roads.json`);
        } else {
            const worldId = worldMetas[courseId]?.worldId;
            fname = Path.join(__dirname, `../shared/deps/data/worlds/${worldId}/roads.json`);
        }
        try {
            const roads = JSON.parse(FS.readFileSync(fname));
            if (courseId === 'portal') {
                for (const x of roads) {
                    let minZ = Infinity;
                    for (const coord of x.path) {
                        if (coord[2] < minZ) {
                            minZ = coord[2];
                        }
                    }
                    for (const coord of x.path) {
                        coord[2] -= minZ;
                    }
                }
            }
            _roadsByCourse.set(courseId, roads);
        } catch(e) {
            _roadsByCourse.set(courseId, []);
        }
    }
    return _roadsByCourse.get(courseId);
}


export function getRoad(courseId, roadId) {
    if (roadId >= 10000) {
        courseId = 'portal';
    }
    const sig = getRoadSig(courseId, roadId);
    let road = _roads.get(sig);
    if (!road) {
        road = getCourseRoads(courseId).find(x => x.id === roadId) || null;
        _roads.set(sig, road);
    }
    return road;
}


export function getRoadCurvePath(courseId, roadId) {
    const sig = getRoadSig(courseId, roadId);
    let rcp = _roadCurvePaths.get(sig);
    if (!rcp) {
        const road = getRoad(courseId, roadId);
        if (!road) {
            rcp = null;
        } else {
            const curveFunc = {
                CatmullRom: Curves.catmullRomPath,
                Bezier: Curves.cubicBezierPath,
            }[road.splineType];
            rcp = curveFunc(road.path, {loop: road.looped, road: true});
        }
        _roadCurvePaths.set(sig, rcp);
    }
    return rcp;
}


function readRoutes() {
    const fname = Path.join(__dirname, `../shared/deps/data/routes.json`);
    let routes;
    try {
        routes = JSON.parse(FS.readFileSync(fname));
    } catch(e) {
        console.error("Failed to read route data");
        return [];
    }
    for (const route of routes) {
        route.courseId = getCourseId(route.worldId);
        // Legacy segment projection.
        // Does not handle loops, and segments spanning different section types (leadin, lap, weld).
        for (const m of route.manifest) {
            const segments = [];
            for (const x of _segmentsByCourse.get(route.courseId)) {
                if (x.roadId === m.roadId && !!x.reverse === !!m.reverse) {
                    if (!x.reverse) {
                        if (x.roadStart >= m.start && x.roadFinish <= m.end &&
                            (!x.loop || m.end - m.start > 0.90)) {
                            segments.push(x);
                        }
                    } else {
                        if (x.roadStart <= m.end && x.roadFinish >= m.start &&
                            (!x.loop || m.end - m.start > 0.90)) {
                            segments.push(x);
                        }
                    }
                }
            }
            if (segments.length) {
                segments.sort((a, b) =>
                    m.reverse ? b.roadStart - a.roadStart : a.roadStart - b.roadStart);
                m.segmentIds = segments.map(x => x.id);
            }
        }
    }
    return routes;
}


export function getRoute(routeId) {
    return _routes.get(routeId);
}


export function getRoutes(ids) {
    if (ids == null) {
        return Array.from(_routes.keys()).map(getRoute);
    }
    return ids.map(getRoute);
}


export function getCourseRoutes(courseId) {
    return Array.from(_routes.values().filter(x => x.courseId === courseId)).map(x => getRoute(x.id));
}


export function webMercatorProjection([lat, lng]) {
    let siny = Math.sin((lat * Math.PI) / 180);
    siny = Math.min(Math.max(siny, -0.9999), 0.9999);
    return [
        0.5 + lng / 360,
        0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI),
    ];
}
