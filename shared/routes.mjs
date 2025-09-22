import * as curves from './curves.mjs';

export const routeDistEpsilon = 1 / 200;


/*
 * roadCurvePaths must be a Map of the routes in-use RoadPath objects, where
 * the key is the roadId for this route's world.
 */
export function getRouteRoadSections(route, {roadCurvePaths, epsilon=routeDistEpsilon}) {
    const sections = route.manifest.map(m => ({
        courseId: route.courseId,
        roadId: m.roadId,
        reverse: !!m.reverse,
        leadin: !!m.leadin,
        weld: false,
        roadCurvePath: roadCurvePaths.get(m.roadId).subpathAtRoadPercents(m.start, m.end, {epsilon}),
        distance: 0,
        blockOffsetDistance: 0,
        marginStartDistance: 0,
        marginEndDistance: 0,
    }));
    const fullPath = new curves.CurvePath({epsilon});
    const hasLeadin = route.manifest[0].leadin;
    let leadinDist = 0;
    for (const [i, m] of route.manifest.entries()) {
        const section = sections[i];
        const distToEndOfLast = fullPath.distance() / 100;
        const road = section.roadCurvePath;
        if (i) {
            // Include the margin between the last road's end and our start.
            fullPath.extend(m.reverse ? road.slice(-1) : road.slice(0, 1));
        }
        const distToStartOfThis = fullPath.distance() / 100;
        fullPath.extend(m.reverse ? road.toReversed() : road);
        const distToEndOfThis = fullPath.distance() / 100;
        section.marginStartDistance = distToStartOfThis - distToEndOfLast;
        section.distance = distToEndOfThis - distToStartOfThis;
        if (!leadinDist && hasLeadin && !m.leadin) {
            leadinDist = distToStartOfThis;
            section.blockOffsetDistance = 0;
        } else {
            if (m.leadin) {
                section.blockOffsetDistance = distToStartOfThis;
            } else {
                section.blockOffsetDistance = distToStartOfThis - leadinDist;
            }
        }
        if (i) {
            sections[i - 1].marginEndDistance = distToStartOfThis - distToEndOfLast;
        }
    }
    if (route.supportedLaps) {
        // Handle cases where route data does not properly weld the lap together, (e.g Three Little Sister)
        const lapStart = route.manifest.find(x => !x.leadin);
        const lapEnd = route.manifest.at(-1);
        if (lapStart.roadId !== lapEnd.roadId || lapStart.reverse !== lapEnd.reverse) {
            console.warn("Unable to properly weld lap together for:", route.id);
            const roadCurvePath = new curves.CurvePath();
            roadCurvePath.extend(sections.at(-1).roadCurvePath.slice(-1));
            roadCurvePath.extend(sections[route.manifest.indexOf(lapStart)].roadCurvePath.slice(0, 1));
            sections.push({
                courseId: route.courseId,
                roadId: null,
                reverse: null,
                leadin: false,
                weld: true,
                roadCurvePath,
                distance: roadCurvePath.distance() / 100,
                blockOffsetDistance: 0,
                marginStartDistance: 0,
                marginEndDistance: 0,
            });
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
                const roadCurvePath = roadCurvePaths.get(lapStart.roadId);
                if (start > end) {
                    const w1 = roadCurvePath.subpathAtRoadPercents(start, 1, {epsilon});
                    const w2 = roadCurvePath.subpathAtRoadPercents(0, end, {epsilon});
                    const w1Dist = w1.distance() / 100;
                    const w2Dist = w2.distance() / 100;
                    sections.push({
                        courseId: route.courseId,
                        roadId: lapStart.roadId,
                        reverse: !!lapStart.reverse,
                        leadin: false,
                        weld: true,
                        roadCurvePath: w1,
                        distance: w1Dist,
                        blockOffsetDistance: 0,
                        marginStartDistance: 0,
                        marginEndDistance: 0,
                    }, {
                        courseId: route.courseId,
                        roadId: lapStart.roadId,
                        reverse: !!lapStart.reverse,
                        leadin: false,
                        weld: true,
                        roadCurvePath: w2,
                        distance: w2Dist,
                        blockOffsetDistance: w1Dist,
                        marginStartDistance: 0,
                        marginEndDistance: 0,
                    });
                } else {
                    const w = roadCurvePath.subpathAtRoadPercents(start, end, {epsilon});
                    const wDist = w.distance() / 100;
                    sections.push({
                        courseId: route.courseId,
                        roadId: lapStart.roadId,
                        reverse: !!lapStart.reverse,
                        leadin: false,
                        weld: true,
                        roadCurvePath: w,
                        distance: wDist,
                        blockOffsetDistance: 0,
                        marginStartDistance: 0,
                        marginEndDistance: 0,
                    });
                }
            }
        }
    }
    return sections;
}


export function getRouteMeta(route, {roadCurvePaths}) {
    const meta = {};
    meta.sections = getRouteRoadSections(route, {roadCurvePaths});
    meta.checkpointSectionMap = new Map();
    const lastLeadin = meta.sections[meta.sections.findIndex(x => !x.leadin && !x.weld) - 1];
    if (lastLeadin) {
        meta.leadinDistance = lastLeadin.blockOffsetDistance + lastLeadin.distance +
            lastLeadin.marginEndDistance;
    } else {
        meta.leadinDistance = 0;
    }
    const lastNormal = meta.sections.findLast(x => !x.weld && !x.leadin);
    meta.lapDistance = lastNormal.blockOffsetDistance + lastNormal.distance;
    const lastEntry = meta.sections.at(-1);
    if (lastEntry.weld) {
        meta.weldDistance = lastNormal.marginEndDistance +
            lastEntry.blockOffsetDistance +
            lastEntry.distance +
            lastEntry.marginEndDistance;
    } else {
        meta.weldDistance = 0;
    }
    for (const [i, m] of route.manifest.entries()) {
        if (m.checkpoints) {
            for (let idx = m.checkpoints[0]; idx <= m.checkpoints[1]; idx++) {
                meta.checkpointSectionMap.set(idx, meta.sections[i]);
            }
        }
    }
    return meta;
}
