import path from 'node:path';
import fs from './fs-safe.js';
import * as rpc from './rpc.mjs';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const realWorldCourseId = -2;
export const cachedSegments = new Map();
export const worldMetas = {
    [realWorldCourseId]: {
        worldId: realWorldCourseId,
        courseId: realWorldCourseId,
        lonOffset: 0,
        latOffset: 0,
        lonDegDist: 0.01,
        latDegDist: -0.01,
        altitudeOffsetHack: 0,
        physicsSlopeScale: 100,
        waterPlaneLevel: 0,
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
    }
} catch {/*no-pragma*/}


export function getWorldMetas() {
    return Object.values(worldMetas);
}
rpc.register(getWorldMetas);


export function getCourseId(worldId) {
    return Object.values(worldMetas).find(x => x.worldId === worldId)?.courseId;
}
rpc.register(getCourseId);


export function getRoadSig(courseId, roadId, reverse) {
    return courseId << 18 | roadId << 1 | reverse;
}


const _segmentsByCourse = new Map();
export function getCourseSegments(courseId) {
    if (!_segmentsByCourse.has(courseId)) {
        const worldId = worldMetas[courseId]?.worldId;
        const fname = path.join(__dirname, `../shared/deps/data/worlds/${worldId}/segments.json`);
        const segments = [];
        _segmentsByCourse.set(courseId, segments);
        let data;
        try {
            data = JSON.parse(fs.readFileSync(fname));
        } catch(e) {
            console.error('No segments loaded for:', courseId);
            data = [];
        }
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
                cachedSegments.set(segment.id, segment);
            }
        }
    }
    return _segmentsByCourse.get(courseId);
}


const _segmentsByRoadSig = new Map();
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


const _roadsByCourse = new Map();
export function getRoads(courseId) {
    if (!_roadsByCourse.has(courseId)) {
        let fname;
        if (courseId === 'portal') {
            fname = path.join(__dirname, `../shared/deps/data/portal_roads.json`);
        } else {
            const worldId = worldMetas[courseId]?.worldId;
            fname = path.join(__dirname, `../shared/deps/data/worlds/${worldId}/roads.json`);
        }
        try {
            _roadsByCourse.set(courseId, JSON.parse(fs.readFileSync(fname)));
        } catch(e) {
            _roadsByCourse.set(courseId, []);
        }
    }
    return _roadsByCourse.get(courseId);
}
rpc.register(getRoads);


const _roads = new Map();
export function getRoad(courseId, roadId) {
    if (roadId >= 10000) {
        courseId = 'portal';
    }
    const sig = `${courseId}-${roadId}`;
    if (!_roads.has(sig)) {
        const road = getRoads(courseId).find(x => x.id === roadId);
        if (road) {
            _roads.set(sig, road);
        } else {
            _roads.set(sig, null);
        }
    }
    return _roads.get(sig);
}
rpc.register(getRoad);


let _routes;
function loadRoutes() {
    if (!_routes) {
        const fname = path.join(__dirname, `../shared/deps/data/routes.json`);
        let routes;
        try {
            routes = JSON.parse(fs.readFileSync(fname));
        } catch(e) {
            routes = [];
        }
        _routes = new Map(routes.map(route => {
            route.courseId = getCourseId(route.worldId);
            const allSegments = getCourseSegments(route.courseId);
            for (const m of route.manifest) {
                const segments = [];
                for (const x of allSegments) {
                    if (x.roadId === m.roadId && !!x.reverse === !!m.reverse) {
                        if (!x.reverse) {
                            if (x.roadStart >= m.start && x.roadFinish <= m.end) {
                                segments.push(x);
                            }
                        } else {
                            if (x.roadStart <= m.end && x.roadFinish >= m.start) {
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
            return [route.id, route];
        }));
    }
}


export function getRoute(routeId) {
    loadRoutes();
    return _routes.get(routeId);
}
rpc.register(getRoute);


export function getRoutes(courseId) {
    loadRoutes();
    let routes = Array.from(_routes.values());
    if (courseId != null) {
        routes = routes.filter(x => x.courseId === courseId);
    }
    return routes;
}
rpc.register(getRoutes);


export function webMercatorProjection([lat, lng]) {
    let siny = Math.sin((lat * Math.PI) / 180);
    siny = Math.min(Math.max(siny, -0.9999), 0.9999);
    return [
        0.5 + lng / 360,
        0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI),
    ];
}
