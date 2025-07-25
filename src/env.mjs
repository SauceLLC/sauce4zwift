import path from 'node:path';
import fs from './fs-safe.js';
import * as curves from '../shared/curves.mjs';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const _segments = new Map();
const _segmentsByCourse = new Map();
const _segmentsByRoadSig = new Map();
const _routes = new Map();
const _routesByCourse = new Map();
const _roads = new Map();
const _roadsByCourse = new Map();
const _roadCurvePaths = new Map();

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
try {
    const worldListFile = path.join(__dirname, `../shared/deps/data/worldlist.json`);
    for (const x of JSON.parse(fs.readFileSync(worldListFile))) {
        worldMetas[x.courseId] = x;
        const segments = readSegmentsForWorld(x.worldId);
        _segmentsByCourse.set(x.courseId, segments);
        for (const x of segments) {
            _segments.set(x.id, x);
        }
    }
    for (const x of readRoutes()) {
        if (!_routesByCourse.has(x.courseId)) {
            _routesByCourse.set(x.courseId, []);
        }
        _routes.set(x.id, x);
        _routesByCourse.get(x.courseId).push(x);
    }
} catch {/*no-pragma*/}


export function getWorldMetas() {
    return Object.values(worldMetas);
}


export function getCourseId(worldId) {
    return Object.values(worldMetas).find(x => x.worldId === worldId)?.courseId;
}


export function getRoadSig(courseId, roadId, reverse) {
    return courseId << 18 | roadId << 1 | reverse;
}


export function fromRoadSig(roadSig) {
    return {
        courseId: roadSig >>> 18,
        roadId: (roadSig >>> 1) & 0x3fff,
        reverse: !!(roadSig & 0x1),
    };
}


function readSegmentsForWorld(worldId) {
    const fname = path.join(__dirname, `../shared/deps/data/worlds/${worldId}/segments.json`);
    let data;
    try {
        data = JSON.parse(fs.readFileSync(fname));
    } catch(e) {
        console.error('No segments loaded for world:', worldId);
        return [];
    }
    const segments = [];
    for (const x of data) {
        for (const dir of ['Forward', 'Reverse']) {
            if (!x['id' + dir]) {
                continue;
            }
            const reverse = dir === 'Reverse';
            const segment = {
                ...x,
                reverse,
                id: x['id' + dir],
                distance: x['distance' + dir],
                name: reverse ? x.nameReverse || x.nameForward + ' Reverse' : x.nameForward,
                roadStart: x['roadStart' + dir],
            };
            delete segment.nameForward;
            delete segment.nameReverse;
            delete segment.idForward;
            delete segment.idReverse;
            delete segment.distanceForward;
            delete segment.distanceReverse;
            delete segment.roadStartForward;
            delete segment.roadStartReverse;
            if (!segment.distance) {
                continue;  // exclude single direction segments
            }
            segments.push(segment);
        }
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


export function getRoadSegments(courseId, roadSig) {
    if (!_segmentsByRoadSig.has(roadSig)) {
        const segments = [];
        _segmentsByRoadSig.set(roadSig, segments);
        for (const x of getCourseSegments(courseId)) {
            const segSig = getRoadSig(courseId, x.roadId, x.reverse);
            if (segSig === roadSig) {
                segments.push(x);
            }
        }
    }
    return _segmentsByRoadSig.get(roadSig);
}


export function getCourseRoads(courseId) {
    if (!_roadsByCourse.has(courseId)) {
        let fname;
        if (courseId === 'portal') {
            fname = path.join(__dirname, `../shared/deps/data/portal_roads.json`);
        } else {
            const worldId = worldMetas[courseId]?.worldId;
            fname = path.join(__dirname, `../shared/deps/data/worlds/${worldId}/roads.json`);
        }
        try {
            const roads = JSON.parse(fs.readFileSync(fname));
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
    const sig = `${courseId}-${roadId}`;
    if (!_roads.has(sig)) {
        const road = getCourseRoads(courseId).find(x => x.id === roadId);
        if (road) {
            _roads.set(sig, road);
        } else {
            _roads.set(sig, null);
        }
    }
    return _roads.get(sig);
}


export function getRoadCurvePath(courseId, roadId, reverse) {
    const sig = `${courseId}-${roadId}-${!!reverse}`;
    if (!_roadCurvePaths.has(sig)) {
        const road = getRoad(courseId, roadId);
        if (!road) {
            return;
        }
        const curveFunc = {
            CatmullRom: curves.catmullRomPath,
            Bezier: curves.cubicBezierPath,
        }[road.splineType];
        const rcp = curveFunc(road.path, {loop: road.looped, road: true});
        _roadCurvePaths.set(sig, reverse ? rcp.toReversed() : rcp);
    }
    return _roadCurvePaths.get(sig);
}


function readRoutes() {
    const fname = path.join(__dirname, `../shared/deps/data/routes.json`);
    let routes;
    try {
        routes = JSON.parse(fs.readFileSync(fname));
    } catch(e) {
        console.error("Failed to read route data");
        return [];
    }
    for (const route of routes) {
        route.courseId = getCourseId(route.worldId);
        for (const m of route.manifest) {
            const segments = [];
            for (const x of _segmentsByCourse.get(route.courseId)) {
                if (x.roadId === m.roadId && !!x.reverse === !!m.reverse) {
                    if (!x.reverse) {
                        if (x.roadStart >= m.start && x.roadFinish <= m.end &&
                            (!x.requiresAllCheckpoints || m.end - m.start > 0.90)) {
                            segments.push(x);
                        }
                    } else {
                        if (x.roadStart <= m.end && x.roadFinish >= m.start &&
                            (!x.requiresAllCheckpoints || m.end - m.start > 0.90)) {
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
        return Array.from(_routes.values());
    }
    return ids.map(x => _routes.get(x));
}


export function getCourseRoutes(courseId) {
    return _routesByCourse.get(courseId) || [];
}


export function webMercatorProjection([lat, lng]) {
    let siny = Math.sin((lat * Math.PI) / 180);
    siny = Math.min(Math.max(siny, -0.9999), 0.9999);
    return [
        0.5 + lng / 360,
        0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI),
    ];
}
