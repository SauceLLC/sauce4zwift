import path from 'node:path';
import fs from './fs-safe.js';
import * as curves from '../shared/curves.mjs';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const _segments = new Map();
const _segmentsByCourse = new Map();
const _segmentsByRoadSig = new Map();
const _routes = new Map();
const _roads = new Map();
const _roadsByCourse = new Map();
const _roadCurvePaths = new Map();
const _routeSegmentCache = new Map();
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
    const worldListFile = path.join(__dirname, `../shared/deps/data/worldlist.json`);
    for (const x of JSON.parse(fs.readFileSync(worldListFile))) {
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


function readSegmentsForWorldLegacy(worldId) {
    const fname = path.join(__dirname, `../shared/deps/data/worlds/${worldId}/segments.json`);
    let data;
    try {
        data = JSON.parse(fs.readFileSync(fname));
    } catch(e) {
        console.error('No segments loaded for world:', worldId);
        return [];
    }
    const segments = [];
    const courseId = getCourseId(worldId);
    for (const x of data) {
        for (const dir of ['Forward', 'Reverse']) {
            if (!x['id' + dir]) {
                continue;
            }
            const reverse = dir === 'Reverse';
            const segment = {
                ...x,
                reverse,
                courseId,
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


function readSegmentsForWorld(worldId) {
    const fname = path.join(__dirname, `../shared/deps/data/worlds/${worldId}/segments.json`);
    let segments;
    try {
        segments = JSON.parse(fs.readFileSync(fname));
    } catch(e) {
        console.error('No segments loaded for world:', worldId);
        return [];
    }
    const courseId = getCourseId(worldId);
    for (const x of segments) {
        x.courseId = courseId;
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
                CatmullRom: curves.catmullRomPath,
                Bezier: curves.cubicBezierPath,
            }[road.splineType];
            rcp = curveFunc(road.path, {loop: road.looped, road: true});
        }
        _roadCurvePaths.set(sig, rcp);
    }
    return rcp;
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


export function projectRouteSegments(route, {laps=1, distance, epsilon=1/200}={}) {
    // XXX refactor to use routes.getRouteRoadSections
    let state = _routeSegmentCache.get(route.id);
    if (!state) {
        _routeSegmentCache.set(route.id, (state = {}));
        const roadSlices = route.manifest.map(x =>
            getRoadCurvePath(route.courseId, x.roadId).subpathAtRoadPercents(x.start, x.end, {epsilon}));
        const fullPath = new curves.CurvePath({epsilon});
        state.routeSegments = [];
        state.leadinDist = 0;
        state.lapWeldDistance = 0;
        const hasLeadin = route.manifest[0].leadin;
        for (const [i, m] of route.manifest.entries()) {
            const road = roadSlices[i];
            if (i) {
                fullPath.extend(m.reverse ? road.slice(-1) : road.slice(0, 1));
            }
            const distBefore = fullPath.distance() / 100;
            if (!state.leadinDist && hasLeadin && !m.leadin) {
                state.leadinDist = distBefore;
            }
            fullPath.extend(m.reverse ? road.toReversed() : road);
            if (m.segmentIds) {
                let distAfter;
                for (const id of m.segmentIds) {
                    const segment = getSegment(id);
                    const start = road.distanceAtRoadPercent(segment.roadStart) / 100;
                    const end = road.distanceAtRoadPercent(segment.roadFinish) / 100;
                    let startDistance, endDistance;
                    if (!segment.reverse) {
                        startDistance = distBefore + start;
                        endDistance = distBefore + end;
                    } else {
                        distAfter = distAfter || fullPath.distance() / 100;
                        startDistance = distAfter - start;
                        endDistance = distAfter - end;
                    }
                    state.routeSegments.push({id, startDistance, endDistance, leadin: !!m.leadin});
                }
            }
        }
        if (route.supportedLaps) {
            state.lapDist = (fullPath.distance() / 100) - state.leadinDist;
            /*
             * Handle cases where route data does not properly weld the lap together
             *
             * Case info:
             *   routeId: 2627606248
             *   courseId: 6
             *   name: Three Little Sisters
             *   problem: Lap finish is several hundred meters away from the leadin offset.
             */
            const lapStart = route.manifest.find(x => !x.leadin);
            const lapEnd = route.manifest.at(-1);
            if (lapStart.roadId !== lapEnd.roadId || lapStart.reverse !== lapEnd.reverse) {
                console.warn("Unable to properly weld lap together for:", route.id);
                const startNode = roadSlices[route.manifest.indexOf(lapStart)].nodes[0].end;
                const endNode = roadSlices.at(-1).nodes.at(-1).end;
                state.lapWeldDistance = curves.vecDist(endNode, startNode) / 100;
            } else {
                let start, end;
                if (!lapStart.reverse) {
                    start = lapEnd.end;
                    end = lapStart.start;
                } else {
                    start = lapEnd.start;
                    end = lapStart.end;
                }
                if (Math.abs(start - end) > 1e-4) {
                    const road = getRoadCurvePath(route.courseId, lapStart.roadId);
                    let connection;
                    if (start > end) {
                        const joiner = new curves.CurvePath({epsilon});
                        joiner.extend(road.subpathAtRoadPercents(start, 1));
                        joiner.extend(road.subpathAtRoadPercents(0, end));
                        connection = joiner;
                    } else {
                        connection = road.subpathAtRoadPercents(start, end, {epsilon});
                    }
                    state.lapWeldDistance = connection.distance() / 100;
                }
            }
        }
    }
    const maxLaps = 1000;
    if (distance) {
        laps = route.supportedLaps ? Infinity : 1;
    } else if (laps > 1 && !route.supportedLaps) {
        console.error("Route does not support laps:", route.id);
        laps = 1;
    }
    const lapSegments = [];
    if (route.supportedLaps) {
        for (let lap = 1; lap < laps; lap++) {
            const lapOfft = (state.lapDist + state.lapWeldDistance) * lap - state.leadinDist;
            if (distance && state.leadinDist + lapOfft >= distance) {
                break;
            }
            for (const x of state.routeSegments) {
                if (!x.leadin) {
                    lapSegments.push({
                        id: x.id,
                        startDistance: x.startDistance + lapOfft,
                        endDistance: x.endDistance + lapOfft,
                        leadin: false,
                    });
                }
            }
            if (lap === maxLaps) {
                console.error(`Reached maximum laps (${maxLaps}) for route:`, route.id);
                break;
            }
        }
    }
    const allSegments = state.routeSegments.concat(lapSegments);
    return {
        leadinDistance: state.leadinDist,
        lapDistance: state.lapDist,
        lapWeldDistance: state.lapWeldDistance,
        segments: distance ? allSegments.filter(x => x.endDistance <= distance) : allSegments,
    };
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
