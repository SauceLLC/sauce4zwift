import path from 'node:path';
import fs from 'node:fs';
import * as rpc from './rpc.mjs';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const allSegments = new Map();
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


const _segmentsByRoadSig = {};
const _segmentsByCourse = {};
export function getNearbySegments(courseId, roadSig) {
    if (_segmentsByRoadSig[roadSig] === undefined) {
        if (_segmentsByCourse[courseId] === undefined) {
            const worldId = worldMetas[courseId]?.worldId;
            const fname = path.join(__dirname, `../shared/deps/data/worlds/${worldId}/segments.json`);
            try {
                _segmentsByCourse[courseId] = JSON.parse(fs.readFileSync(fname));
            } catch(e) {
                _segmentsByCourse[courseId] = [];
            }
            for (const x of _segmentsByCourse[courseId]) {
                for (const dir of ['Forward', 'Reverse']) {
                    if (!x['id' + dir]) {
                        continue;
                    }
                    const reverse = dir === 'Reverse';
                    const segSig = getRoadSig(courseId, x.roadId, reverse);
                    if (!_segmentsByRoadSig[segSig]) {
                        _segmentsByRoadSig[segSig] = [];
                    }
                    const segment = {
                        ...x,
                        reverse,
                        id: x['id' + dir],
                        distance: x['distance' + dir],
                        friendlyName: x['friendlyName' + dir],
                        roadStart: x['roadStart' + dir],
                    };
                    if (!segment.distance) {
                        continue;  // exclude single direction segments
                    }
                    _segmentsByRoadSig[segSig].push(segment);
                    allSegments.set(segment.id, segment);
                }
            }
        }
        if (_segmentsByRoadSig[roadSig] === undefined) {
            _segmentsByRoadSig[roadSig] = null;
        }
    }
    return _segmentsByRoadSig[roadSig];
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
            route.courseId = Object.values(worldMetas).find(x => x.worldId === route.worldId)?.courseId;
            return [route.id, route];
        }));
    }
    return _routes[routeId];
}
rpc.register(getRoute);


rpc.register(() => {
    return Object.values(_routes);
}, {name: 'getRoutes'});
