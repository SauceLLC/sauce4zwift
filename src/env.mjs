import path from 'node:path';
import fs from 'node:fs';
import * as rpc from './rpc.mjs';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const cachedSegments = new Map();
export const worldMetas = {};
try {
    const worldListFile = path.join(__dirname, `../shared/deps/data/worldlist.json`);
    for (const x of JSON.parse(fs.readFileSync(worldListFile))) {
        worldMetas[x.courseId] = x;
    }
} catch {/*no-pragma*/}


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


const _roadsByCourse = {};
export function getRoads(courseId) {
    if (_roadsByCourse[courseId] === undefined) {
        let fname;
        if (courseId === 'portal') {
            fname = path.join(__dirname, `../shared/deps/data/portal_roads.json`);
        } else {
            const worldId = worldMetas[courseId]?.worldId;
            fname = path.join(__dirname, `../shared/deps/data/worlds/${worldId}/roads.json`);
        }
        try {
            _roadsByCourse[courseId] = JSON.parse(fs.readFileSync(fname));
        } catch(e) {
            _roadsByCourse[courseId] = [];
        }
    }
    return _roadsByCourse[courseId];
}
rpc.register(getRoads);


const _roads = {};
export function getRoad(courseId, roadId) {
    if (roadId >= 10000) {
        courseId = 'portal';
    }
    const sig = `${courseId}-${roadId}`;
    if (_roads[sig] === undefined) {
        const road = getRoads(courseId).find(x => x.id === roadId);
        if (road) {
            _roads[sig] = road;
        } else {
            _roads[sig] = null;
        }
    }
    return _roads[sig];
}
rpc.register(getRoad);


let _routes;
export function getRoute(routeId) {
    if (!_routes) {
        const fname = path.join(__dirname, `../shared/deps/data/routes.json`);
        let routes;
        try {
            routes = JSON.parse(fs.readFileSync(fname));
        } catch(e) {
            routes = [];
        }
        _routes = Object.fromEntries(routes.map(route => {
            route.courseId = getCourseId(route.worldId);
            return [route.id, route];
        }));
    }
    return _routes[routeId];
}
rpc.register(getRoute);


export function getCourseId(worldId) {
    return Object.values(worldMetas).find(x => x.worldId === worldId)?.courseId;
}
rpc.register(getCourseId);


rpc.register(() => {
    return Object.values(_routes);
}, {name: 'getRoutes'});
