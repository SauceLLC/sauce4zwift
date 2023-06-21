import path from 'node:path';
import fs from 'node:fs';
import * as zwift from './zwift.mjs';
import * as curves from '../shared/curves.mjs';
import * as rpc from './rpc.mjs';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const allSegments = new Map();


export function getRoadSig(courseId, roadId, reverse) {
    return courseId << 18 | roadId << 1 | reverse;
}


const _segmentsByRoadSig = {};
const _segmentsByCourse = {};
export function getNearbySegments(courseId, roadSig) {
    if (_segmentsByRoadSig[roadSig] === undefined) {
        const worldId = zwift.courseToWorldIds[courseId];
        if (_segmentsByCourse[courseId] === undefined) {
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


function zToAltitude(courseId, z) {
    const worldMeta = zwift.worldMetas[courseId];
    return worldMeta ? (z + worldMeta.waterPlaneLevel) / 100 *
        worldMeta.physicsSlopeScale + worldMeta.altitudeOffsetHack : null;
}


function trimNumber(n, p=5) {
    return Number(n.toFixed(p));
}


function supplimentPath(courseId, curvePath) {
    const balancedT = 1 / 125; // tests to within 0.27 meters (worst case)
    const elevations = [];
    const grades = [];
    const distances = [];
    let prevIndex;
    let distance = 0;
    let prevNode;
    curvePath.trace(x => {
        distance += prevNode ? curves.vecDist(prevNode, x.stepNode) / 100 : 0;
        if (x.index !== prevIndex) {
            const elevation = zToAltitude(courseId, x.stepNode[2]);
            if (elevations.length) {
                grades.push(trimNumber((elevation - elevations.at(-1)) / (distance - distances.at(-1) || 0)));
            }
            distances.push(trimNumber(distance, 2));
            elevations.push(trimNumber(elevation, 2));
            prevIndex = x.index;
        }
        prevNode = x.stepNode;
    }, balancedT);
    grades.unshift(grades[0]);
    return {
        elevations,
        grades,
        distances,
    };
}


const _roadsByCourse = {};
export function getRoads(courseId) {
    if (_roadsByCourse[courseId] === undefined) {
        const worldId = zwift.courseToWorldIds[courseId];
        const fname = path.join(__dirname, `../shared/deps/data/worlds/${worldId}/roads.json`);
        try {
            _roadsByCourse[courseId] = JSON.parse(fs.readFileSync(fname));
        } catch(e) {
            _roadsByCourse[courseId] = [];
        }
        for (const road of _roadsByCourse[courseId]) {
            const curveFunc = {
                CatmullRom: curves.catmullRomPath,
                Bezier: curves.cubicBezierPath,
            }[road.splineType];
            const curvePath = curveFunc(road.path, {loop: road.looped});
            for (const x of curvePath) {
                // Reduce JSON size by nearly 3x...
                if (x.cp1) {
                    x.cp1[0] = Math.round(x.cp1[0]);
                    x.cp1[1] = Math.round(x.cp1[1]);
                    x.cp1[2] = Math.round(x.cp1[2]);
                }
                if (x.cp2) {
                    x.cp2[0] = Math.round(x.cp2[0]);
                    x.cp2[1] = Math.round(x.cp2[1]);
                    x.cp2[2] = Math.round(x.cp2[2]);
                }
                if (x.end) {
                    x.end[0] = trimNumber(x.end[0], 2);
                    x.end[1] = trimNumber(x.end[1], 2);
                    x.end[2] = trimNumber(x.end[2], 2);
                }
            }
            const extra = supplimentPath(courseId, curvePath);
            Object.assign(road, {curvePath}, extra);
            delete road.path;
        }
    }
    return _roadsByCourse[courseId];
}
rpc.register(getRoads);


const _roads = {};
export function getRoad(courseId, roadId) {
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
        try {
            _routes = JSON.parse(fs.readFileSync(fname));
        } catch(e) {
            _routes = [];
        }
    }
    const route = _routes.find(x => x.id === routeId);
    //if (route && !route.curvePath) {
    for (const route of _routes) {
        if (route.curvePath) continue; // XXX
        const courseId = zwift.worldToCourseIds[route.worldId];
        const curvePath = new curves.CurvePath();
        for (let i = 0; i < route.checkpoints.length - 1; i++) {
            let p0 = route.checkpoints[i];
            let p1 = route.checkpoints[i + 1];
            const leadin = p1.leadin;
            const p0Sig = `${p0.roadId}-${!!p0.reverse}-${!!p0.leadin}`;
            const p1Sig = `${p1.roadId}-${!!p1.reverse}-${!!p1.leadin}`;
            // Only need these for validation..
            delete p0.pos;
            delete p1.pos;
            if (p0Sig !== p1Sig) {
                const p_1 = route.checkpoints[i - 1];
                if (p_1 != null && `${p_1.roadId}-${!!p_1.reverse}-${!!p_1.leadin}` !== p0Sig) {
                    const road = getRoad(courseId, p0.roadId);
                    const point = road.curvePath.pointAtRoadPercent(p0.roadPercent);
                    curvePath.push({
                        end: point,
                        leadin: p0.leadin ? true : undefined,
                        i,
                    });
                }
                if (i === route.checkpoints.length - 2) {
                    const road = getRoad(courseId, p1.roadId);
                    const point = road.curvePath.pointAtRoadPercent(p1.roadPercent);
                    curvePath.push({
                        end: point,
                        leadin: p1.leadin ? true : undefined,
                        i: i + 1,
                    });
                }
                continue;
            } else if (p0.forceSplit) {
                continue;
            }
            if (p0.reverse) {
                [p1, p0] = [p0, p1];
            }
            const road = getRoad(courseId, p0.roadId);
            let subpath;
            if (p0.roadPercent > p1.roadPercent) {
                subpath = road.curvePath.subpathAtRoadPercents(p0.roadPercent, 1);
                subpath.extend(road.curvePath.subpathAtRoadPercents(0, p1.roadPercent));
            } else {
                subpath = road.curvePath.subpathAtRoadPercents(p0.roadPercent, p1.roadPercent);
            }
            if (p0.reverse) {
                subpath = subpath.reverse();
            }
            for (const x of subpath) {
                x.i = i;
                x.leadin = leadin ? true : undefined;
            }
            curvePath.extend(subpath);
        }
        const extra = supplimentPath(courseId, curvePath);
        const delta = Math.abs(extra.distances.at(-1) - (route.distanceInMeters + (route.leadinDistanceInMeters || 0) - (route.distanceBetweenFirstLastLrCPsInMeters || 0))); // XXX
        if (delta > 1000) {
            console.warn(extra.distances.at(-1), delta, route);
        }
        Object.assign(route, {curvePath}, extra);
    }
    return route;
}
rpc.register(getRoute);
