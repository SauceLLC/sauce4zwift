/* global Sentry, electron */
import {sleep as _sleep} from '../../shared/sauce/base.mjs';
import * as time from '../../shared/sauce/time.mjs';
import * as locale from '../../shared/sauce/locale.mjs';
import {expWeightedAvg as _expWeightedAvg} from '/shared/sauce/data.mjs';
import * as report from '../../shared/report.mjs';
import * as elements from './custom-elements.mjs';
import * as curves from '/shared/curves.mjs';
import * as routes from '/shared/routes.mjs';
import * as color from './color.mjs';

export const sleep = _sleep; // Come on ES6 modules, really!?
export const expWeightedAvg = _expWeightedAvg;
export let idle;
if (window.requestIdleCallback) {
    idle = options => new Promise(resolve => window.requestIdleCallback(resolve, options));
} else {
    idle = () => new Promise(resolve => setTimeout(resolve, 1));
}
if (!Array.prototype.at) {
    // Old browsers like chromium 86 used by vmix.
    Array.prototype.at = function(idx) {
        idx |= 0;
        return idx < 0 ? this[this.length + idx] : this[idx];
    };
}

const doc = document.documentElement;
const _segments = new Map();

// XXX DEPRECATED...
export const worldCourseDescs = [
    {worldId: 1, courseId: 6, name: 'Watopia', ident: 'WATOPIA'},
    {worldId: 2, courseId: 2, name: 'Richmond', ident: 'RICHMOND'},
    {worldId: 3, courseId: 7, name: 'London', ident: 'LONDON'},
    {worldId: 4, courseId: 8, name: 'New York', ident: 'NEWYORK'},
    {worldId: 5, courseId: 9, name: 'Innsbruck', ident: 'INNSBRUCK'},
    {worldId: 6, courseId: 10, name: 'Bologna', ident: 'BOLOGNATT'},
    {worldId: 7, courseId: 11, name: 'Yorkshire', ident: 'YORKSHIRE'},
    {worldId: 8, courseId: 12, name: 'Crit City', ident: 'CRITCITY'},
    {worldId: 9, courseId: 13, name: 'Makuri Islands', ident: 'MAKURIISLANDS'},
    {worldId: 10, courseId: 14, name: 'France', ident: 'FRANCE'},
    {worldId: 11, courseId: 15, name: 'Paris', ident: 'PARIS'},
    {worldId: 12, courseId: 16, name: 'Gravel Mountain', ident: 'GRAVEL MOUNTAIN'},
    {worldId: 13, courseId: 17, name: 'Scotland', ident: 'SCOTLAND'},
];
// XXX DEPRECATED...
export const courseToWorldIds = Object.fromEntries(worldCourseDescs.map(x => [x.courseId, x.worldId]));
// XXX DEPRECATED...
export const worldToCourseIds = Object.fromEntries(worldCourseDescs.map(x => [x.worldId, x.courseId]));
// XXX DEPRECATED...
export const courseToNames = Object.fromEntries(worldCourseDescs.map(x => [x.courseId, x.name]));
// XXX DEPRECATED...
export const worldToNames = Object.fromEntries(worldCourseDescs.map(x => [x.worldId, x.name]));
// XXX DEPRECATED...
export const identToWorldId = Object.fromEntries(worldCourseDescs.map(x => [x.ident, x.worldId]));

export const attributions = {
    tp: 'Training Stress Score®, TSS®, Normalized Power®, NP®, Intensity Factor® and IF® are ' +
        'trademarks of TrainingPeaks, LLC and are used with permission.<br/><br/>\n\n' +
        'Learn more at <a external target="_blank" href="https://www.trainingpeaks.com' +
        '/learn/articles/glossary-of-trainingpeaks-metrics/' +
        '?utm_source=newsletter&utm_medium=partner&utm_term=sauce_trademark' +
        '&utm_content=cta&utm_campaign=sauce">https://www.trainingpeaks.com' +
        '/learn/articles/glossary-of-trainingpeaks-metrics/</a>',
    support: `
        The Discord server is the best place to start.  There are a lot of lovely people there
        that can help with just about everything.  Use the invite link below to introduce yourself.
        <ul>
            <li><a external target="_blank"
                   href="https://discord.com/invite/3d8TwBHaX2">Discord Invite Link</a> <b>(BEST)</b></li>
            <li><a external target="_blank"
                   href="mailto:support@sauce.llc">Email: support@sauce.llc</a></li>
            <li><a external target="_blank"
                   href="https://github.com/SauceLLC/sauce4zwift/issues">GitHub Issues</a></li>
        </ul>
    `,
};


let rpcCall;
let windowID;
export let imperialUnits;
export let subscribe;
export let unsubscribe;
let schedStorageFlush;


class LocalStorage extends EventTarget {
    constructor(id) {
        super();
        if (!id) {
            throw new Error('id arg required');
        }
        this.prefix = `${id}-`;
        window.addEventListener('storage', this._onStorage.bind(this));
    }

    _onStorage(ev) {
        let evName;
        let key;
        if (ev.key === null) {
            return;  // clear event
        }
        if (ev.key.startsWith(this.prefix)) {
            evName = 'update';
            key = ev.key.substr(this.prefix.length);
        } else if (ev.key[0] === '/') {
            evName = 'globalupdate';
            key = ev.key;
        }
        if (evName) {
            const event = new Event(evName);
            event.data = {key, value: JSON.parse(ev.newValue)};
            this.dispatchEvent(event);
        }
    }

    get(key, def) {
        key = key[0] === '/' ? key : this.prefix + key;
        const value = localStorage.getItem(key);
        if (typeof value !== 'string') {
            if (def !== undefined) {
                this._set(key, def);
            }
            return def;
        } else {
            return JSON.parse(value);
        }
    }

    set(key, value) {
        key = key[0] === '/' ? key : this.prefix + key;
        if (value === undefined) {
            localStorage.removeItem(key);
            schedStorageFlush();
        } else {
            this._set(key, value);
        }
    }

    _set(fqKey, value) {
        const json = JSON.stringify(value);
        if (typeof json !== 'string') {
            throw new TypeError('Non JSON serializable value');
        }
        localStorage.setItem(fqKey, json);
        schedStorageFlush();
    }

    delete(key) {
        key = key[0] === '/' ? key : this.prefix + key;
        localStorage.removeItem(key);
        schedStorageFlush();
    }
}


function b64urlEncode(data) {
    return btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}


if (window.isElectron) {
    // Probably already set by src/preload/common.js but not always for non widget pages..
    doc.classList.add('electron-mode');
    doc.classList.toggle('frame', !!electron.context.frame);
    doc.dataset.platform = electron.context.platform;

    windowID = electron.context.id;
    const subs = [];
    const pendingPorts = new Map();
    addEventListener('message', ev => {
        if (ev.source === window && ev.data && ev.data.channel === 'subscribe-port') {
            const subId = ev.data.subId;
            const descr = subs.find(x => x.subId === subId);
            if (descr && descr.deleted) {
                return;
            }
            const port = ev.ports[0];
            if (!descr) {
                // Port arrived before ipcInvoke finished (rare but normal)
                pendingPorts.set(subId, port);
            } else {
                descr.port = port;
                port.addEventListener('message', descr.handler);
                port.start();
            }
        }
    });
    subscribe = async function(event, callback, options={}) {
        console.debug("Event subscribe:", event);
        const descr = {event, callback};
        descr.handler = ev => {
            if (!descr.deleted) {
                callback(JSON.parse(ev.data));
            }
        };
        subs.push(descr);
        const subId = await electron.ipcInvoke('subscribe', {event, ...options});
        if (!descr.deleted) {
            descr.subId = subId;
            if (pendingPorts.has(subId)) {
                const port = pendingPorts.get(subId);
                pendingPorts.delete(subId);
                // The order varies, sometimes the port shows up before ipcInvoke is back.
                descr.port = port;
                port.addEventListener('message', descr.handler);
                port.start();
            }
        }
    };
    unsubscribe = async function(event, callback) {
        console.debug("Event unsubscribe:", event);
        const descrIdx = subs.findIndex(x => x.event === event && (!callback || x.callback === callback));
        if (descrIdx === -1) {
            throw new TypeError("not found");
        }
        const [descr] = subs.splice(descrIdx, 1);
        descr.deleted = true;
        if (descr.port) {
            descr.port.close();
        }
        if (descr.subId) {
            await electron.ipcInvoke('unsubscribe', {subId: descr.subId});
        }
    };
    rpcCall = async function(name, ...args) {
        const env = JSON.parse(await electron.ipcInvoke('rpc', name, ...args));
        if (env.warning) {
            console.warn(env.warning);
        }
        if (env.success) {
            return env.value;
        } else {
            throw makeRPCError(env.error);
        }
    };
    let storageFlushTimeout;
    schedStorageFlush = () => {
        clearTimeout(storageFlushTimeout);
        storageFlushTimeout = setTimeout(() => rpcCall('flushSessionStorage'), 500);
    };
} else {
    const q = new URLSearchParams(window.location.search);
    windowID = q.get('windowId') || q.get('windowid') || 'browser-def-id';
    const respHandlers = new Map();
    const subs = [];
    let uidInc = 1;
    let errBackoff = 500;
    let wsp;
    const _subscribe = async function(ws, event, callback, options={}) {
        const uid = uidInc++;
        const subId = uidInc++;
        let resolve, reject;
        const p = new Promise((_resolve, _reject) => (resolve = _resolve, reject = _reject));
        respHandlers.set(uid, {resolve, reject});
        respHandlers.set(subId, {resolve: callback, reject: e => console.error(e)});
        ws.send(JSON.stringify({
            type: 'request',
            uid,
            data: {
                method: 'subscribe',
                arg: {
                    event,
                    subId,
                    ...options,
                }
            }
        }));
        await p;
        return subId;
    };
    const _unsubscribe = async function(ws, subId) {
        const uid = uidInc++;
        let resolve, reject;
        const p = new Promise((_resolve, _reject) => (resolve = _resolve, reject = _reject));
        respHandlers.set(uid, {resolve, reject});
        ws.send(JSON.stringify({type: 'request', uid, data: {method: 'unsubscribe', arg: {subId}}}));
        await p;
    };
    const connectWebSocket = async function() {
        const schema = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${schema}://${window.location.host}/api/ws/events`);
        ws.addEventListener('message', ev => {
            const env = JSON.parse(ev.data);
            const handler = respHandlers.get(env.uid);
            if (env.type === 'response') {
                respHandlers.delete(env.uid);
            }
            if (handler) {
                if (env.warning) {
                    console.warn(env.warning);
                }
                if (env.success) {
                    handler.resolve(env.data);
                } else {
                    handler.reject(new Error(env.error));
                }
            }
        });
        ws.addEventListener('close', ev => {
            errBackoff = Math.min(errBackoff * 1.1, 60000);
            console.warn('WebSocket connection issue: retry in', (errBackoff / 1000).toFixed(1), 's');
            for (const x of subs) {
                x.disconnected = true;
            }
            wsp = sleep(errBackoff).then(connectWebSocket);
            document.dispatchEvent(new CustomEvent('sauce-ws-status', {detail: 'disconnected'}));
        });
        const tO = setTimeout(() => ws.close(), 5000);
        ws.addEventListener('error', ev => clearTimeout(tO));
        return await new Promise(resolve => {
            ws.addEventListener('open', () => {
                console.debug("WebSocket connected");
                errBackoff = 500;
                clearTimeout(tO);
                for (const descr of subs) {
                    if (descr.deleted || !descr.disconnected) {
                        continue;
                    }
                    _subscribe(ws, descr.event, descr.callback, descr.options).then(subId => {
                        if (!descr.deleted && descr.disconnected) {
                            descr.subId = subId;
                            delete descr.disconnected;
                        }
                    });
                }
                resolve(ws);
                document.dispatchEvent(new CustomEvent('sauce-ws-status', {detail: 'connected'}));
            });
        });
    };
    subscribe = async function(event, callback, options={}) {
        console.info("Event subscribe:", event);
        if (!wsp) {
            wsp = connectWebSocket();
        }
        const descr = {event, callback, options};
        subs.push(descr);
        const ws = await wsp;
        const subId = await _subscribe(ws, event, callback, options);
        if (!descr.deleted) {
            descr.subId = subId;
        }
    };
    unsubscribe = async function(event, callback) {
        console.info("Event unsubscribe:", event);
        const descrIdx = subs.findIndex(x => x.event === event && x.callback === callback);
        if (descrIdx === -1) {
            throw new TypeError("not found");
        }
        const [descr] = subs.splice(descrIdx, 1);
        descr.deleted = true;
        if (descr.subId) {
            respHandlers.delete(descr.subId);
            if (wsp) {
                await _unsubscribe(await wsp, descr.subId);
            }
        }
    };
    rpcCall = async function(name, ...args) {
        const encodedArgs = args.map(x => x !== undefined ? b64urlEncode(JSON.stringify(x)) : '');
        let resp = await fetch(`/api/rpc/v2/${name}${args.length ? '/' : ''}${encodedArgs.join('/')}`);
        if (!resp.ok && resp.status === 431) {
            resp = await fetch(`/api/rpc/v1/${name}`, {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify(args),
            });
        }
        if (!resp.ok && resp.status >= 500) {
            throw new Error(`RPC network error: ${resp.status}`);
        }
        const env = await resp.json();
        if (env.warning) {
            console.warn(env.warning);
        }
        if (env.success) {
            return env.value;
        } else {
            throw makeRPCError(env.error);
        }
    };
    schedStorageFlush = () => undefined;
}
export let storage;
if (windowID) {
    storage = new LocalStorage(windowID);
}


function makeRPCError({name, message, stack}) {
    const e = new Error(`${name}: ${message}`);
    e.stack = stack;
    return e;
}

export function longPressListener(el, timeout, callback) {
    let paused;
    let matureTimeout;
    const onPointerDown = ev => {
        if (paused) {
            return;
        }
        let complete = false;
        el.classList.add('pointer-pressing');
        const onCancel = ev => {
            clearTimeout(matureTimeout);
            document.removeEventListener('pointerup', onCancel, {once: true});
            document.removeEventListener('pointercancel', onCancel, {once: true});
            if (!complete) {
                el.classList.remove('pointer-pressing');
            }
            complete = true;
        };
        document.addEventListener('pointerup', onCancel, {once: true});
        document.addEventListener('pointercancel', onCancel, {once: true});
        clearTimeout(matureTimeout);
        matureTimeout = setTimeout(() => {
            complete = true;
            el.classList.remove('pointer-pressing');
            callback(ev);
        }, timeout);
    };
    el.addEventListener('pointerdown', onPointerDown);
    return {
        setPaused: en => paused = en,
        removeListener: () => {
            el.removeEventListener('pointerdown', onPointerDown);
            clearTimeout(matureTimeout);
        }
    };
}


let _worldList;
export async function getWorldList({all}={}) {
    if (!_worldList) {
        _worldList = rpcCall('getWorldMetas');
    }
    const data = await _worldList;
    return all ? data : data.filter(x => x.courseId > 0);
}


export async function getSegments(ids) {
    if (typeof ids === 'number') {
        console.warn("DEPRECATED: use rpc.getCourseSegments instead");
        const worldId = ids;
        const worldList = await getWorldList();
        const worldMeta = worldList.find(x => x.worldId === worldId);
        if (worldMeta?.courseId == null) {
            console.error("World info not found for:", worldId);
            return [];
        }
        return await rpcCall('getCourseSegments', worldMeta.courseId);
    }
    const missing = new Set();
    for (const x of ids) {
        if (!_segments.has(x)) {
            missing.add(x);
        }
    }
    if (missing.size) {
        const missingArr = Array.from(missing);
        const p = rpcCall('getSegments', missingArr);
        for (const [i, x] of missingArr.entries()) {
            _segments.set(x, p.then(segments => {
                _segments.set(x, segments[i]);
                return segments[i];
            }));
        }
    }
    return Promise.all(ids.map(x => _segments.get(x)));
}


export function zToAltitude(worldMeta, z, {physicsSlopeScale}={}) {
    const scale = physicsSlopeScale || worldMeta?.physicsSlopeScale || 1;
    const seaLevel = worldMeta?.seaLevel || 0;
    const elOffset = worldMeta?.eleOffset || 0;
    return (z - seaLevel + elOffset) / 100 * scale;
}


export function supplimentPath(worldMeta, curvePath, {physicsSlopeScale}={}) {
    const balancedT = routes.routeDistEpsilon;
    const distEpsilon = 1e-6;
    const elevations = [];
    const grades = [];
    const distances = [];
    let prevIndex;
    let distance = 0;
    let prevDist = 0;
    let prevEl = 0;
    let prevNode;
    curvePath.trace(x => {
        distance += prevNode ? curves.vecDist(prevNode, x.stepNode) / 100 : 0;
        if (x.index !== prevIndex) {
            const elevation = zToAltitude(worldMeta, x.stepNode[2], {physicsSlopeScale});
            if (elevations.length) {
                if (distance - prevDist > distEpsilon) {
                    const grade = (elevation - prevEl) / (distance - prevDist);
                    grades.push(grade);
                } else {
                    grades.push(grades.at(-1) || 0);
                }
            }
            distances.push(distance);
            elevations.push(elevation);
            prevDist = distance;
            prevEl = elevation;
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


const _roads = new Map();
export function getRoads(courseId) {
    if (!_roads.has(courseId)) {
        _roads.set(courseId, rpcCall('getCourseRoads', courseId).then(async roads => {
            const worldList = await getWorldList();
            const worldMeta = worldList.find(x => x.courseId === courseId);
            for (const x of roads) {
                const curveFunc = {
                    CatmullRom: curves.catmullRomPath,
                    Bezier: curves.cubicBezierPath,
                }[x.splineType];
                x.curvePath = curveFunc(x.path, {loop: x.looped, road: true});
                const physicsSlopeScale = x.physicsSlopeScaleOverride;
                Object.assign(x, supplimentPath(worldMeta, x.curvePath, {physicsSlopeScale}));
            }
            return roads;
        }));
    }
    return _roads.get(courseId);
}


export async function getRoad(courseId, id) {
    const roads = await getRoads(courseId);
    return roads ? roads.find(x => x.id === id) : null;
}


export async function getSegment(id) {
    return (await getSegments([id]))[0];
}


export async function computeRoutePath(route, options={}) {
    const worldList = await getWorldList();
    const worldMeta = worldList.find(x => x.courseId === route.courseId);
    const roadCurvePaths = new Map();
    for (const m of route.manifest) {
        if (!roadCurvePaths.has(m.roadId)) {
            const road = await getRoad(route.courseId, m.roadId);
            roadCurvePaths.set(m.roadId, road.curvePath);
        }
    }
    const {sections, ...meta} = routes.getRouteMeta(route, {roadCurvePaths});
    let lapWeldPath;
    let lapWeldData;
    if (route.supportedLaps) {
        if (sections.find(x => x.weld)) {
            lapWeldPath = new curves.CurvePath();
            for (const x of sections.filter(xx => xx.weld)) {
                lapWeldPath.extend(x.reverse ? x.roadCurvePath.toReversed() : x.roadCurvePath);
            }
            lapWeldData = supplimentPath(worldMeta, lapWeldPath);
        }
    }
    // Mostly for legacy reasons the curvePath property begins with the prelude..
    const curvePath = new curves.CurvePath();
    if (options.prelude === 'weld' && lapWeldPath) {
        curvePath.extend(lapWeldPath);
    }
    for (const [sectionIndex, section] of sections.entries()) {
        if (!section.weld && (!section.leadin || options.prelude !== 'weld')) {
            const nodesOfft = curvePath.nodes.length;
            curvePath.extend(section.reverse ?
                section.roadCurvePath.toReversed() :
                section.roadCurvePath);
            for (let j = 0; j < section.roadCurvePath.nodes.length; j++) {
                curvePath.nodes[nodesOfft + j].index = sectionIndex;
            }
        }
    }
    return {
        meta,
        sections,
        curvePath,
        lapWeldPath,
        lapWeldData,
        ...supplimentPath(worldMeta, curvePath),
    };
}


function emplaceDeprecatedRouteRoadSegmentsField(routeData) {
    const deprecatedRoadSegments = routeData.sections.map(x => {
        // Avoid polluting the existing subpaths sections..
        const clone = x.roadCurvePath.slice();
        clone.reverse = x.reverse;
        clone.leadin = x.leadin;
        clone.roadId = x.roadId;
        return clone;
    });
    Object.defineProperty(routeData, 'roadSegments', {
        enumerable: true,
        get: () => {
            console.warn("DEPRECATED: Migrate to `.sections[]`");
            return deprecatedRoadSegments;
        }
    });
}


async function addRouteSegments(route) {
    const ids = new Set([].concat(...route.manifest.map(x => x.segmentIds || [])));
    if (!ids.size) {
        return;
    }
    const segments = new Map((await getSegments(Array.from(ids))).map(x => [x.id, x]));
    for (const m of route.manifest) {
        if (m.segmentIds) {
            m.segments = m.segmentIds.map(x => segments.get(x));
        }
    }
}


let _routeListPromise;
const _routes = new Map();
export function getRoute(id, options={prelude: 'leadin'}) {
    const sig = JSON.stringify({id, options});
    if (!_routes.has(sig)) {
        const extendAndSave = async route => {
            let obj;
            if (route) {
                const p = addRouteSegments(route);
                const extra = await computeRoutePath(route, options);
                await p;
                obj = {...route, ...extra};
                emplaceDeprecatedRouteRoadSegmentsField(obj);
            }
            _routes.set(sig, obj);
            return obj;
        };
        _routes.set(sig, _routeListPromise ?
            _routeListPromise.then(routes => extendAndSave(routes && routes.find(x => x.id === id))) :
            rpcCall('getRoute', id).then(extendAndSave));
    }
    return _routes.get(sig);
}


export function getRouteList(courseId) {
    if (!_routeListPromise) {
        _routeListPromise = rpcCall('getRoutes');
    }
    return courseId == null ?
        _routeListPromise :
        _routeListPromise.then(routes => routes.filter(x => x.courseId === courseId));
}


const _eventSubgroups = new Map();
export function getEventSubgroup(id) {
    if (!id) {
        return null;
    }
    if (!_eventSubgroups.has(id)) {
        _eventSubgroups.set(id, rpcCall('getEventSubgroup', id).then(sg => {
            if (sg) {
                _eventSubgroups.set(id, sg);
            } else {
                // set it to null but allow retry later..
                _eventSubgroups.set(id, null);
                setTimeout(() => {
                    if (_eventSubgroups.get(id) == null) {
                        _eventSubgroups.delete(id);
                    }
                }, 30000);
            }
            return sg;
        }));
    }
    return _eventSubgroups.get(id);
}


export function addOpenSettingsParam(key, value) {
    for (const el of document.querySelectorAll('a.open-settings')) {
        const url = new URL(el.href);
        const q = new URLSearchParams(url.search);
        q.set(key, value);
        url.search = q;
        el.href = url;
    }
}


export function softInnerHTML(el, html, {force}={}) {
    const h = hash(html);
    if (el._softInnerHTMLHash !== h || force) {
        el.innerHTML = html;
        el._softInnerHTMLHash = h;
        return true;
    }
}


export function initInteractionListeners() {
    if (window.isElectron) {
        const spec = electron.context.spec;
        let customName = spec && spec.customName;
        if (customName) {
            if (doc.classList.contains('settings-page')) {
                customName += ' - Settings';
            }
            document.title = `${customName} - Sauce for Zwift™`;
            const headerTitle = document.querySelector('#titlebar header .title');
            if (headerTitle) {
                headerTitle.textContent = customName;
            }
        }
    }
    if (!doc.classList.contains('settings-mode') &&
        !doc.classList.contains('disable-settings-mode')) {
        window.addEventListener('contextmenu', ev => {
            ev.preventDefault();
            doc.classList.toggle('settings-mode');
            if (window.isElectron) {
                // Helps ensure we get a blur event on defocus on mac.
                rpcCall('focusOwnWindow');
            }
        });
        window.addEventListener('blur', () => void doc.classList.remove('settings-mode'));
        window.addEventListener('click', ev => {
            if (!ev.target.closest('#titlebar')) {
                doc.classList.remove('settings-mode');
            }
        });
        const isSafari = /^((?!chrome|android).)*safari/i.test(window.navigator.userAgent);
        if (isSafari) {
            let touching;
            window.addEventListener("touchstart", ev => {
                clearTimeout(touching);
                touching = setTimeout(() => window.dispatchEvent(new Event('contextmenu')), 500);
            });
            window.addEventListener("touchmove", () => clearTimeout(touching));
            window.addEventListener("touchend", () => clearTimeout(touching));
        }
    }
    if (!window.isElectron) {
        addOpenSettingsParam('windowId', windowID);
        const isFirefoxIFrame = window.location !== window.parent.location &&
                                window.navigator.userAgent.match(/ Firefox/);
        if (isFirefoxIFrame || window.navigator.userAgent.match(/ OBS\//)) {
            console.info("Enabling hack to avoid broken tabs handling");
            for (const x of document.querySelectorAll('a[target]')) {
                x.removeAttribute('target');
            }
        }
    }
    const titleBar = document.querySelector('#titlebar');
    if (titleBar) {
        titleBar.addEventListener('pointerdown', ev => {
            if (ev.target.closest('a,[href],.button,.btn,button')) {
                // Prevent focus state..
                // On small windows focus is used for overflow/underflow layout.
                // Don't trigger it if we detect an action (i.e. button or link clicked).
                ev.preventDefault();
            }
        });
        titleBar.addEventListener('click', ev => {
            const btn = ev.target.closest('.button');
            if (btn) {
                if (btn.classList.contains('close')) {
                    rpcCall('closeWindow');
                } else if (btn.classList.contains('minimize')) {
                    rpcCall('minimizeWindow');
                }
            }
        });
    }
    for (const el of document.querySelectorAll('.button[data-url]')) {
        // XXX I think I can remove these, but just check first...
        console.error("DEPRECATED");
        debugger;
        el.addEventListener('click', ev => window.location.assign(el.dataset.url));
    }
    for (const el of document.querySelectorAll('.button[data-ext-url]')) {
        // XXX I think I can remove these, but just check first...
        console.error("DEPRECATED");
        debugger;
        el.addEventListener('click', ev =>
            window.open(el.dataset.extUrl, '_blank', 'popup,width=999,height=333'));
    }
    for (const el of document.querySelectorAll('.tabbed header.tabs')) {
        const tabs = Array.from(el.querySelectorAll(':scope > .tab'));
        const sections = Array.from(el.closest('.tabbed').querySelectorAll(':scope > .tab'));
        const mapping = new Map();
        if (tabs.every(x => x.dataset.id) && sections.every(x => x.dataset.id)) {
            for (const x of tabs) {
                const s = sections.find(xx => x.dataset.id === xx.dataset.id);
                if (!s) {
                    console.error('tabbed id mapping not found:', x.dataset.id);
                }
                mapping.set(x, s);
            }
        } else {
            console.warn("Using legacy index based tab mapping (not recommended)");
            for (const [i, x] of tabs.entries()) {
                mapping.set(x, sections[i]);
            }
        }
        el.addEventListener('click', ev => {
            const tab = ev.target.closest('.tab');
            if (!tab) {
                return;
            }
            for (const x of tabs) {
                const active = x === tab;
                x.classList.toggle('active', active);
                mapping.get(x)?.classList.toggle('active', active);
            }
            const tev = new Event('tab');
            tev.data = {
                tab,
                id: tab.dataset.id,
            };
            el.closest('.tabbed').dispatchEvent(tev);
        });
    }
    let _attrDialog;
    document.documentElement.addEventListener('click', ev => {
        const attr = ev.target.closest('attr[for]');
        if (!attr) {
            return;
        }
        if (_attrDialog) {
            _attrDialog.close();
        } else {
            const dialog = document.createElement('dialog');
            dialog.classList.add('sauce-attr');
            dialog.innerHTML = attributions[attr.getAttribute('for')];
            const pos = attr.getBoundingClientRect(attr);
            if (pos.left || pos.top) {
                if (pos.left < window.innerWidth / 2) {
                    dialog.style.setProperty('left', pos.left + 'px');
                } else {
                    dialog.style.setProperty('right', window.innerWidth - pos.right + 'px');
                    dialog.style.setProperty('left', 'unset');
                }
                if (pos.top < window.innerHeight / 2) {
                    dialog.style.setProperty('top', pos.bottom + 'px');
                } else {
                    dialog.style.setProperty('bottom', window.innerHeight - pos.top + 'px');
                    dialog.style.setProperty('top', 'unset');
                }
                dialog.classList.add('anchored');
            }
            dialog.addEventListener('click', ev2 => {
                if (ev2.target.closest('a')) {
                    return;
                }
                dialog.close();
            });
            dialog.addEventListener('close', () => {
                if (dialog === _attrDialog) {
                    _attrDialog = null;
                    dialog.remove();
                }
            });
            _attrDialog = dialog;
            document.body.append(dialog);
            dialog.showModal();
        }
    });
    document.documentElement.addEventListener('click', ev => {
        const restart = ev.target.closest('.edited .restart-required:empty');
        if (!restart) {
            return;
        }
        ev.preventDefault();
        rpcCall('restart');
    });
}


function fGet(fnOrValue, ...args) {
    return (typeof fnOrValue === 'function') ? fnOrValue(...args) : fnOrValue;
}


export class Renderer {
    constructor(contentEl, options={}) {
        this._contentEl = contentEl;
        this._callbacks = [];
        this._data;
        this._nextRender;
        this._lastRenderTime = 0;
        this.locked = !!options.locked;
        this.backgroundRender = options.backgroundRender;
        contentEl.classList.toggle('unlocked', !this.locked);
        this.stopping = false;
        this.fps = options.fps || null,
        this.id = options.id || window.location.pathname.split('/').at(-1);
        this.fields = new Map();
        this.onKeyDownBound = this.onKeyDown.bind(this);
        // Avoid circular refs so fields.mjs has immediate access..
        this._fieldsModPromise = import('./fields.mjs');
        if (!this.locked) {
            document.addEventListener('keydown', this.onKeyDownBound);
        }
    }

    setLocked(locked) {
        this.locked = locked;
        if (locked) {
            document.removeEventListener('keydown', this.onKeyDownBound);
        }
        this._contentEl.classList.toggle('unlocked', !this.locked);
    }

    stop() {
        this.stopping = true;
        if (!this.locked) {
            document.removeEventListener('keydown', this.onKeyDownBound);
        }
        clearTimeout(this._scheduledRender);
    }

    onKeyDown(ev) {
        const dir = {ArrowRight: 1, ArrowLeft: -1}[ev.key];
        const activeEl = document.activeElement;
        if (!dir || this.locked || !activeEl || !this._contentEl.contains(activeEl)) {
            return;
        }
        const dataField = activeEl.closest('[data-field]');
        const mappingId = dataField && dataField.dataset.field;
        if (mappingId) {
            this.rotateField(mappingId, dir);
        }
    }

    addCallback(cb) {
        this._callbacks.push(cb);
    }

    setData(data) {
        this._data = data;
    }

    getAdjacentFieldIndex(field, offt=1) {
        const cur = field.available.indexOf(field.active);
        if (cur === -1) {
            return 0;
        }
        const adjIdx = (cur + offt) % field.available.length;
        return adjIdx < 0 ? field.available.length + adjIdx : adjIdx;
    }

    rotateField(mappingId, dir=1) {
        if (this.locked) {
            return;
        }
        const field = this.fields.get(mappingId);
        const idx = this.getAdjacentFieldIndex(field, dir);
        const id = field.available[idx].id;
        this.setField(mappingId, id);
    }

    setField(mappingId, id) {
        const field = this.fields.get(mappingId);
        field.active = field.available.find(x => x.id === id);
        storage.set(field.storageKey, id);
        console.debug('Switching field mapping', mappingId, id);
        this.setFieldTooltip(mappingId);
        this.render({force: true});
    }

    addRotatingFields(spec) {
        for (const x of spec.fields) {
            if (!x.shortName && x.key) {
                console.warn("Migrating deprecated field property key -> shortName", x.id);
                x.shortName = x.key;
            }
            if (!x.suffix && x.unit) {
                console.warn("Migrating deprecated field property unit -> suffix", x.id);
                x.suffix = x.unit;
            }
            if (!x.format && x.value) {
                console.warn("Migrating deprecated field property value -> format", x.id);
                x.format = x.value;
            }
        }
        for (const mapping of spec.mapping) {
            const el = (spec.el || this._contentEl).querySelector(`[data-field="${mapping.id}"]`);
            const storageKey = `${this.id}-${mapping.id}`;
            const savedId = storage.get(storageKey);
            let active;
            for (const id of [savedId, mapping.default, 0]) {
                active = typeof id === 'number' ? spec.fields[id] : spec.fields.find(x => x.id === id);
                if (active) {
                    break;
                }
            }
            if (savedId !== active.id) {
                console.warn("Storing updated field ID:", savedId, '->', active.id);
                storage.set(storageKey, active.id);
            }
            this.fields.set(mapping.id, {
                id: mapping.id,
                el,
                storageKey,
                available: spec.fields,
                active,
                valueEl: el.querySelector('.value'),
                labelEl: el.querySelector('.label'),
                subLabelEl: el.querySelector('.sub-label'),
                keyEl: el.querySelector('.key'),
                unitEl: el.querySelector('.unit'),
            });
            el.setAttribute('tabindex', 0);
            this.setFieldTooltip(mapping.id);
            if (this.locked) {
                continue;
            }
            let anchorEl = el.querySelector('.editing-anchor');
            if (!anchorEl) {
                anchorEl = el;
                el.classList.add('editing-anchor');
            }
            const handler = longPressListener(el, 1500, async ev => {
                const {fieldGroupNames} = (await this._fieldsModPromise);
                handler.setPaused(true);
                const field = this.fields.get(mapping.id);
                const groups = new Set(field.available.map(x => x.group));
                const select = document.createElement('select');
                select.classList.add('rotating-field');
                for (const group of groups) {
                    // group can be undefined, this is fine.
                    let container;
                    if (group) {
                        container = document.createElement('optgroup');
                        container.label = fieldGroupNames[group] || group;
                    } else {
                        container = select;
                    }
                    for (const x of field.available) {
                        if (x.group === group) {
                            const option = document.createElement('option');
                            if (x.id === field.active.id) {
                                option.selected = true;
                            }
                            option.value = x.id;
                            let name;
                            try {
                                name = stripHTML(fGet(x.longName)) || stripHTML(fGet(x.shortName));
                            } catch(e) {
                                name = null;
                                report.errorThrottled(e);
                            }
                            if (!name) {
                                console.error(`Field returned invalid 'longName' and/or 'shortName':`, x);
                            }
                            option.textContent = name || x.id;
                            container.append(option);
                        }
                    }
                    if (container !== select) {
                        select.append(container);
                    }
                }
                const endEditing = () => {
                    if (!select.isConnected) {
                        return;
                    }
                    el.classList.remove('editing');
                    select.remove();
                    handler.setPaused(false);
                };
                select.addEventListener('change', () => {
                    this.setField(mapping.id, select.value);
                    endEditing();
                });
                // Avoid DOM errors caused by DOM manipulation in onblur with microtask..
                select.addEventListener('blur', () => queueMicrotask(endEditing));
                el.classList.add('editing');
                anchorEl.append(select);
                select.focus();
            });
        }
    }

    setFieldTooltip(mappingId) {
        const field = this.fields.get(mappingId);
        let tooltip;
        try {
            tooltip = fGet(field.active?.tooltip) ||
                fGet(field.active?.longName) ||
                fGet(field.active?.shortName);
        } catch(e) {
            console.error("Failed to get tooltip name for next field:", mappingId, e);
        }
        field.el.title = (tooltip ? tooltip + '\n\n' : '') +
            `Long click/press to change this field or use the Left/Right keys when focused.`;
    }

    schedAnimationFrame(cb) {
        if (!this.backgroundRender) {
            return requestAnimationFrame(cb);
        } else {
            return queueMicrotask(cb);
        }
    }

    render(options={}) {
        if (!options.force && this.fps) {
            const age = Date.now() - (this._lastRender || -Infinity);
            const minAge = 1000 / this.fps;
            if (age < minAge - this._lastRenderTime) {
                if (!this._scheduledRender) {
                    this._scheduledRender = setTimeout(() => {
                        this._scheduledRender = null;
                        this.render();
                    }, Math.ceil(minAge - age));
                }
                return;
            }
        }
        if (!this._nextRender) {
            if (this._scheduledRender) {
                clearTimeout(this._scheduledRender);
                this._scheduledRender = null;
            }
            const start = Date.now();
            this._nextRender = new Promise(resolve => {
                this.schedAnimationFrame(() => {
                    if (this.stopping) {
                        resolve();
                        return;
                    }
                    for (const field of this.fields.values()) {
                        let value = '';
                        const options = {};
                        if (field.unitEl) {
                            options.suffix = false;
                        }
                        try {
                            const arg = field.active.get ? field.active.get(this._data) : this._data;
                            value = fGet(field.active.format, arg, options);
                        } catch(e) {
                            report.errorThrottled(e);
                        }
                        const candidate = value != null && !Number.isNaN(value) ? value : '';
                        if (softInnerHTML(field.valueEl, candidate)) {
                            const width = field.valueEl.textContent.length;
                            if (field.valueEl._width !== width) {
                                field.valueEl._width = width;
                                field.valueEl.classList.toggle('x-wide', width > 2);
                                field.valueEl.classList.toggle('x2-wide', width > 3);
                                field.valueEl.classList.toggle('x3-wide', width > 4);
                                field.valueEl.classList.toggle('x4-wide', width > 6);
                                field.valueEl.classList.toggle('x5-wide', width > 9);
                            }
                        }
                        if (field.labelEl) {
                            let labels = '';
                            try {
                                labels = field.active.label ? fGet(field.active.label, this._data) : '';
                            } catch(e) {
                                report.errorThrottled(e);
                            }
                            if (Array.isArray(labels)) {
                                softInnerHTML(field.labelEl, labels[0]);
                                if (field.subLabelEl) {
                                    softInnerHTML(field.subLabelEl, labels.length > 1 ? labels[1] : '');
                                }
                            } else {
                                softInnerHTML(field.labelEl, labels);
                                if (field.subLabelEl) {
                                    softInnerHTML(field.subLabelEl, '');
                                }
                            }
                        }
                        if (field.keyEl) {
                            let key = '';
                            try {
                                key = field.active.shortName ? fGet(field.active.shortName, this._data) : '';
                            } catch(e) {
                                report.errorThrottled(e);
                            }
                            softInnerHTML(field.keyEl, key);
                        }
                        if (field.unitEl) {
                            let unit = '';
                            // Hide unit if there is no value but only if there is no key element too.
                            const showUnit = field.active.suffix &&
                                ((value != null && value !== '-') || !field.keyEl);
                            try {
                                unit = showUnit ? fGet(field.active.suffix, this._data) : '';
                            } catch(e) {
                                report.errorThrottled(e);
                            }
                            softInnerHTML(field.unitEl, unit);
                        }
                    }
                    for (const cb of this._callbacks) {
                        try {
                            cb(this._data);
                        } catch(e) {
                            report.errorThrottled(e);
                        }
                    }
                    resolve();
                });
            }).finally(() => {
                this._lastRender = Date.now();
                this._lastRenderTime = this._lastRender - start;
                this._nextRender = null;
            });
        }
        return this._nextRender;
    }
}


export class SettingsStore extends EventTarget {
    constructor(settingsKey) {
        super();
        this.settingsKey = settingsKey;
        this._storage = new LocalStorage(windowID);
        this._settings = this._storage.get(this.settingsKey);
        this._ephemeral = !this._settings;
        if (this._ephemeral) {
            this._settings = {};
        }
        this._storage.addEventListener('globalupdate', ev => {
            const {key, value} = ev.data;
            const legacyEv = new Event('changed');
            legacyEv.data = {changed: new Map([[key, value]])};
            this.dispatchEvent(legacyEv);
            const setEv = new Event('set');
            setEv.data = {key, value, remote: true};
            this.dispatchEvent(setEv);
        });
        this._storage.addEventListener('update', ev => {
            if (ev.data.key !== this.settingsKey) {
                return;
            }
            const origKeys = new Set(Object.keys(this._settings));
            const changed = new Map();
            for (const [key, value] of Object.entries(ev.data.value)) {
                if (!origKeys.has(key)) {
                    changed.set(key, value);
                } else if (JSON.stringify(this._settings[key]) !== JSON.stringify(value)) {
                    changed.set(key, value);
                }
                this._settings[key] = value;
                origKeys.delete(key);
            }
            for (const key of origKeys) {
                // set -> unset
                changed.set(key, undefined);
                delete this._settings[key];
            }
            for (const [key, value] of changed) {
                const setEv = new Event('set');
                setEv.data = {key, value, remote: true};
                this.dispatchEvent(setEv);
            }
            const legacyEv = new Event('changed');
            legacyEv.data = {changed};
            this.dispatchEvent(legacyEv);
        });
    }

    setDefault(value) {
        this.get(null, value);
    }

    get(key, def) {
        if (key == null) {
            if (this._ephemeral && def !== undefined) {
                this.set(null, def);
            }
            return this._settings;
        } else if (key[0] !== '/') {
            if (def !== undefined && !Object.prototype.hasOwnProperty.call(this._settings, key)) {
                this.set(key, def);
            }
            return this._settings[key];
        } else {
            const value = this._storage.get(key);
            if (value === undefined && def !== undefined) {
                this._storage.set(key, def);
                return def;
            } else {
                return value;
            }
        }
    }

    set(key, value) {
        if (key == null) {
            Object.assign(this._settings, value);
            this._ephemeral = false;
            this._storage.set(this.settingsKey, this._settings);
        } else if (key[0] !== '/') {
            this._settings[key] = value;
            this._ephemeral = false;
            this._storage.set(this.settingsKey, this._settings);
        } else {
            // global
            this._storage.set(key, value);
        }
        const ev = new Event('set');
        ev.data = {key, value};
        this.dispatchEvent(ev);
    }
}
export const settingsStore = doc.dataset.settingsKey && new SettingsStore(doc.dataset.settingsKey);


function parseDependsOn(dependsOn) {
    const m = dependsOn.match(/^(!)?([a-z0-9]+?)((==|!=|>|<|>=|<=)([a-z0-9]+?))?$/i);
    if (!m) {
        throw new Error("Invalid depends-on grammar field");
    }
    const negate = !!m[1];
    const name = m[2];
    const operator = m[4];
    const value = m[5];
    return {negate, name, operator, value};
}


function compareDependsOn(a, operator, b) {
    return (
        operator === '==' ? a == b : // eslint-disable-line eqeqeq
            operator === '!=' ? a != b : // eslint-disable-line eqeqeq
                operator === '>=' ? a >= b :
                    operator === '<=' ? a <= b :
                        operator === '>' ? a > b :
                            operator === '<' ? a < b :
                                !!b
    );
}


function updateDependants(el) {
    for (const x of el.dependants) {
        const d = x.dataset.dependsOn;
        let negate, operator, value;
        try {
            ({negate, operator, value} = parseDependsOn(d));
        } catch(e) {
            console.error("Invalid depends-on grammar field", d, e);
            continue;
        }
        const elValue = el.type === 'checkbox' ? el.checked : el.value;
        const enabled = compareDependsOn(value, operator, elValue);
        if (negate ? !enabled : enabled) {
            x.disabled = false;
            x.removeAttribute('disabled');
        } else {
            x.disabled = true;
            x.setAttribute('disabled', 'disabled');
        }
        const parentLabel = x.closest('label');
        if (parentLabel) {
            parentLabel.classList.toggle('disabled', x.disabled);
        }
    }
}


function bindFormData(selector, storageIface, options={}) {
    const form = (selector instanceof Element) ? selector : document.querySelector(selector);
    const now = Date.now();
    for (const x of form.querySelectorAll('[data-added]')) {
        if (now - (new Date(x.dataset.added)).getTime() < 14 * 86400000) {
            x.classList.add('new');
        }
    }
    const fieldConnections = new Map();
    let updateCalled;
    async function onFieldUpdate(el, ev) {
        if (!updateCalled) {
            console.error("You forgot to call the update() callback returned by bindFormData");
        }
        const baseType = el.dataset.type || {
            range: 'number',
        }[el.type] || el.type;
        const val = (({
            number: () => el.value ? Number(el.value) : undefined,
            checkbox: () => el.checked,
        }[baseType]) || (() => el.value || undefined))();
        el.closest('label').classList.add('edited');
        for (const x of fieldConnections.get(el.name)) {
            if (!Object.is(x, el)) {
                if (x.type === 'checkbox') {
                    x.checked = val;
                } else {
                    x.value = val;
                }
            }
        }
        if (el.dependants) {
            updateDependants(el);
        }
        await storageIface.set(el.name, val);
    }
    for (const el of form.querySelectorAll('input,textarea')) {
        el.addEventListener('input', onFieldUpdate.bind(null, el));
    }
    for (const el of form.querySelectorAll('select')) {
        el.addEventListener('change', onFieldUpdate.bind(null, el));
    }
    return async function update() {
        updateCalled = true;
        for (const el of form.querySelectorAll('input,select,textarea')) {
            const name = el.name;
            if (!fieldConnections.has(name)) {
                fieldConnections.set(name, new Set());
            }
            fieldConnections.get(name).add(el);
            const val = await storageIface.get(name);
            if (el.type === 'checkbox') {
                if (val !== undefined) {
                    el.checked = val;
                }
            } else {
                if (val !== undefined) {
                    el.value = val == null ? '' : val;
                }
            }
        }
        for (const el of form.querySelectorAll('.display-field[name]')) {
            const name = el.getAttribute('name');
            const val = await storageIface.get(name);
            if (val !== undefined) {
                el.textContent = val;
                if (el.hasAttribute('href')) {
                    el.href = val;
                }
            }
        }
        for (const el of form.querySelectorAll('[data-depends-on]')) {
            const dependsOn = el.dataset.dependsOn;
            let negate, name, operator, value;
            try {
                ({negate, name, operator, value} = parseDependsOn(dependsOn));
            } catch(e) {
                console.error("Invalid depends-on grammar field", dependsOn, e);
                continue;
            }
            const depEl = form.querySelector(`[name="${name}"]`);
            if (!depEl) {
                console.error("Field depends-on missing field", dependsOn);
                continue;
            }
            const depValue = depEl.type === 'checkbox' ? depEl.checked : depEl.value;
            const enabled = compareDependsOn(value, operator, depValue);
            if (negate ? !enabled : enabled) {
                el.disabled = false;
                el.removeAttribute('disabled');
            } else {
                el.disabled = true;
                el.setAttribute('disabled', 'disabled');
            }
            const parentLabel = el.closest('label');
            if (parentLabel) {
                parentLabel.classList.toggle('disabled', el.disabled);
            }
            if (!depEl.dependants) {
                depEl.dependants = new Set();
            }
            depEl.dependants.add(el);
        }
    };
}


async function setAppSetting(key, value) {
    await rpcCall('setSetting', key, value);
    const ev = new Event('app-setting-set');
    ev.data = {key, value};
    document.dispatchEvent(ev);
}


export function initAppSettingsForm(selector) {
    let extraData;
    const storageIface = {
        get: async key => (extraData && Object.prototype.hasOwnProperty.call(extraData, key)) ?
            extraData[key] : await rpcCall('getSetting', key),
        set: async (key, value) => await setAppSetting(key, value),
    };
    const update = bindFormData(selector, storageIface);
    return async data => {
        extraData = data;
        await update();
    };
}


export function initSettingsForm(selector, options={}) {
    let extraData;
    const store = options.store || settingsStore;
    const storageIface = {
        get: key => (extraData && Object.prototype.hasOwnProperty.call(extraData, key)) ?
            extraData[key] : store.get(key),
        set: (key, value) => store.set(key, value),
    };
    const update = bindFormData(selector, storageIface);
    return async x => {
        extraData = x;
        await update();
    };
}


const _saniEl = document.createElement('span');
export function sanitizeAttr(raw) {
    _saniEl.setAttribute('clean', raw);
    try {
        return _saniEl.outerHTML.substr(13, _saniEl.outerHTML.length - 22);
    } finally {
        _saniEl.setAttribute('clean', '');
    }
}


export function sanitize(raw) {
    _saniEl.textContent = raw;
    try {
        return _saniEl.innerHTML;
    } finally {
        _saniEl.textContent = '';
    }
}


const _stripper = new DOMParser();
export function stripHTML(input) {
    if (!input) {
        return input;
    }
    // Escaped HTML turns into HTML so we must run until all the HTML is gone...
    for (let i = 0; i < 1000; i++) {
        const output = _stripper.parseFromString(input, 'text/html').body.textContent || '';
        if (output === input) {
            return output;
        }
        input = output;
    }
    console.error("Possibly nefarious input given to stripHTML");
}


export function teamBadge(t) {
    if (!t) {
        return '';
    }
    const hue = badgeHue(t);
    return `<span class="badge" style="--hue: ${hue};">${sanitize(t)}</span>`;
}


let _nations, _flags;
export function fmtFlag(code, {empty='-'}={}) {
    if (code && _flags && _flags[code]) {
        const nation = sanitizeAttr(_nations[code]);
        return `<img class="nation-flag" src="${_flags[code]}" title="${nation || ''}"/>`;
    } else {
        return empty;
    }
}


const _batSyms = [
    'battery_0_bar',
    'battery_1_bar',
    'battery_2_bar',
    'battery_3_bar',
    'battery_4_bar',
    'battery_5_bar',
    'battery_6_bar',
    'battery_full',
];
export function fmtBattery(pct, options={}) {
    let sym;
    let cls;
    if (pct >= 0 && pct <= 1) {
        sym = _batSyms[(pct * _batSyms.length - 0.000001) | 0];
        cls = pct > 0.75 ? 'good' : pct > 0.50 ? 'caution' : pct > 0.25 ? 'warn' : 'alert';
    } else if (pct < 0) {
        sym = 'battery_alert';
        cls = 'alert';
    } else {
        sym = 'battery_unknown';
        cls = 'warn';
    }
    return `<ms class="battery ${cls}" data-pct="${Math.round(pct * 100)}">${sym}</ms>`;
}


export async function initNationFlags() {
    const r = await fetch('/shared/deps/data/countries.json');
    if (!r.ok) {
        throw new Error('Failed to get country data: ' + r.status);
    }
    const data = await r.json();
    _nations = Object.fromEntries(data.map(({id, en}) => [id, en]));
    _flags = Object.fromEntries(data.map(({id, alpha2}) => [id, `deps/flags/${alpha2}.png`]));
    // Hack in the custom codes I've seen for UK
    _flags[900] = _flags[826]; // Scotland
    _flags[901] = _flags[826]; // Wales
    _flags[902] = _flags[826]; // England
    _flags[903] = _flags[826]; // Northern Ireland
    return {nations: _nations, flags: _flags};
}


export function eventBadge(label) {
    if (!label) {
        return '';
    }
    const hue = {
        A: 0,
        B: 90,
        C: 180,
        D: 60,
        E: 260,
    }[label];
    return `<span class="badge category" style="--hue: ${hue}deg;">${label}</span>`;
}


export function badgeHue(name) {
    return hash(name) % 360;
}


export const rpc = new Proxy({}, {
    get: (_, prop) => (...args) => rpcCall(prop, ...args)
});
self.rpc = rpc; // DEBUG


export function themeInit(store) {
    const themeOverride = store.get('themeOverride');
    if (themeOverride) {
        doc.dataset.theme = themeOverride;
    } else if (!window.isElectron) {
        // Electron already did this in preload to avoid paint flashing.
        const v = store.get('/theme');
        if (v) {
            doc.dataset.theme = v;
        }
    }
    const bgTextureOverride = store.get('bgTextureOverride');
    if (bgTextureOverride) {
        doc.dataset.bgTexture = bgTextureOverride;
    } else if (!window.isElectron) {
        // Electron already did this in preload to avoid paint flashing.
        const v = store.get('/bgTexture');
        if (v) {
            doc.dataset.bgTexture = v;
        }
    }
    store.addEventListener('set', ev => {
        const key = ev.data.key;
        if (key === 'themeOverride' || key === '/theme') {
            doc.dataset.theme = store.get('themeOverride') || store.get('/theme') || '';
        } else if (key === 'bgTextureOverride' || key === '/bgTexture') {
            doc.dataset.bgTexture = store.get('bgTextureOverride') || store.get('/bgTexture') || '';
        }
    });
}


export function localeInit(store) {
    imperialUnits = !!store.get('/imperialUnits');
    locale.setImperial(imperialUnits);
    store.addEventListener('set', ev => {
        if (ev.data.key === '/imperialUnits') {
            imperialUnits = !!ev.data.value;
            locale.setImperial(imperialUnits);
        }
    });
}


export function initExpanderTable(table, expandCallback, cleanupCallback) {
    let active;
    table.querySelector('tbody').addEventListener('click', ev => {
        if (ev.target.closest('a')) {
            return;
        }
        const row = ev.target.closest('tr.summary');
        if (!row || row.closest('table') !== table) {
            return;
        }
        if (active) {
            if (cleanupCallback) {
                cleanupCallback(...active);
            }
            active = null;
        }
        const shouldCollapse = row.classList.contains('expanded');
        table.querySelectorAll(':scope > tbody > tr.expanded')
            .forEach(x => x.classList.remove('expanded'));
        const el = row.nextElementSibling.querySelector(':scope > td');
        el.innerHTML = '';
        if (!shouldCollapse) {
            row.classList.add('expanded');
            expandCallback(el, row);
            active = [el, row];
        }
    });
}


export const powerZonesColorSpectrum = [
    {midPct: 0.275, color: '#666'},
    {midPct: 0.650, color: '#24d'},
    {midPct: 0.825, color: '#5b5'},
    {midPct: 0.975, color: '#dd3'},
    {midPct: 1.125, color: '#fa0'},
    {midPct: 1.350, color: '#b22'},
    {midPct: 1.750, color: '#a0b'},
];


export function getPowerZoneColors(powerZones) {
    const colors = {};
    const available = Array.from(powerZonesColorSpectrum);
    for (const x of powerZones) {
        const midPct = ((x.to || 2) - (x.from || 0)) / 2 + (x.from || 0);
        available.sort((a, b) => Math.abs(a.midPct - midPct) - Math.abs(b.midPct - midPct));
        colors[x.zone] = available[0].color;
    }
    return colors;
}


export function addTheme(entry) {
    elements.themes.push(entry);
    for (const el of document.querySelectorAll('select[is="sauce-theme"]')) {
        el.update();
    }
}


export function coordDistance([x1, y1], [x2, y2]) {
    const xd = x2 - x1;
    const yd = y2 - y1;
    return Math.sqrt(xd * xd + yd * yd);
}


export function rotateCoords([x, y], angle) {
    if (!angle) {
        return [x, y];
    }
    const c = Math.sqrt(x * x + y * y);
    if (!c) {
        return [x, y];
    }
    let A = Math.atan2(x, y);
    A += angle * Math.PI / 180;
    A %= Math.PI * 2;
    if (A < 0) {
        A += Math.PI * 2;
    }
    return [Math.sin(A) * c, Math.cos(A) * c];
}


export function chunkNumber(n, step) {
    return Math.round(n / step) * step;
}


export function isVisible() {
    return document.visibilityState === 'visible';
}


/*
 * cyrb53 (c) 2018 bryc (github.com/bryc)
 * License: Public domain. Attribution appreciated.
 * A fast and simple 53-bit string hash function with decent collision resistance.
 * Largely inspired by MurmurHash2/3, but with a focus on speed/simplicity.
 */
export function cyrb53(str, seed=0) {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for(let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1  = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2  = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}


export function hash(str) {
    return cyrb53(str || '');
}


let _crc32Table;
export function makeCRC32(type) {
    if (!_crc32Table) {
        let c;
        _crc32Table = [];
        for (let i = 0; i < 256; i++) {
            c = i;
            for (let ii = 0; ii < 8; ii++){
                c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            }
            _crc32Table[i] = c;
        }
    }
    let crc = -1;
    if (type === 'btye') {
        return u8 => {
            if (u8 === undefined) {
                return (crc ^ (-1)) >>> 0;
            }
            crc = (crc >>> 8) ^ _crc32Table[(crc ^ u8) & 0xff];
        };
    } else if (type === 'number') {
        const f64Arr = new Float64Array(1);
        const f64View = new DataView(f64Arr.buffer);
        return num => {
            if (num === undefined) {
                return (crc ^ (-1)) >>> 0;
            }
            f64Arr[0] = num;
            for (let i = 0; i < 8; i++) {
                crc = (crc >>> 8) ^ _crc32Table[(crc ^ f64View.getUint8(i)) & 0xff];
            }
        };
    } else if (type === 'string') {
        const encoder = new TextEncoder();
        return str => {
            if (str === undefined) {
                return (crc ^ (-1)) >>> 0;
            }
            const arr = encoder.encode(str);
            for (let i = 0; i < arr.length; i++) {
                crc = (crc >>> 8) ^ _crc32Table[(crc ^ arr[i]) & 0xff];
            }
        };
    } else {
        throw new Error("valid type required");
    }
}


export function binarySearchClosest(arr, value) {
    let left = 0;
    let right = arr.length - 1;
    let c = 0;
    while (left <= right) {
        c = (left + right) * 0.5 | 0;
        const v = arr[c];
        if (v > value) {
            right = c - 1;
        } else if (v < value) {
            left = c + 1;
        } else if (v === value) {
            return c;
        } else {
            return -1;
        }
    }
    // tie breaker
    if (right >= 0 && left < arr.length) {
        const leftDelta = Math.abs(arr[left] - value);
        const rightDelta = Math.abs(arr[right] - value);
        if (leftDelta > rightDelta) {
            return right;
        } else {
            return left;
        }
    }
    return c;
}


const _athletesDataCache = new Map();
export function getAthleteDataCacheEntry(id, {maxAge=60000}={}) {
    const entry = _athletesDataCache.get(id);
    const now = Date.now();
    if (entry && now - entry.ts <= maxAge) {
        return entry.data;
    }
}


export async function getAthletesDataCached(ids, {maxAge=60000}={}) {
    const now = Date.now();
    let fetchResolve;
    const postFetch = new Promise(resolve => fetchResolve = resolve);
    const fetchIds = [];
    for (const id of ids) {
        const entry = _athletesDataCache.get(id);
        if (!entry || now - entry.ts > maxAge) {
            fetchIds.push(id);
            if (entry) {
                entry.ts = now;
                entry.pending = postFetch;
            } else {
                _athletesDataCache.set(id, {ts: now, pending: postFetch});
            }
        }
    }
    if (fetchIds.length) {
        try {
            const data = await rpc.getAthletesData(fetchIds);
            for (const [i, id] of fetchIds.entries()) {
                const entry = _athletesDataCache.get(id);
                entry.pending = null;
                entry.data = data[i];
            }
        } finally {
            fetchResolve(); // release concurrent calls after cache update
        }
    }
    const results = [];
    for (const id of ids) {
        const entry = _athletesDataCache.get(id);
        if (entry.pending) {
            await entry.pending;
            entry.pending = null; // exception during fetch, reset entry and try again next time
        }
        results.push(entry.data);
    }
    if (_athletesDataCache.size > 1000) {
        setTimeout(() => {
            for (const [id, entry] of _athletesDataCache.entries()) {
                if (now - entry.ts > 300000) {
                    _athletesDataCache.delete(id);
                }
            }
        }, 1);
    }
    return results;
}


export async function getAthleteDataCached(id, {maxAge=60000}={}) {
    return (await getAthletesDataCached([id]))[0];
}


let _sentryEnabled;
export async function enableSentry() {
    if (window.location.pathname.startsWith('/mods/')) {
        throw new Error("Please don't use sentry error logging in a mod");
    }
    if (_sentryEnabled) {
        return;
    }
    _sentryEnabled = true;
    const [version, id, dsn] = await Promise.all([
        rpc.getVersion(),
        rpc.getSentryAnonId(),
        rpc.getSentryDSN(),
        import('./sentry.js') // side-effect is self.Sentry
    ]);
    if (version && id && dsn) {
        Sentry.setTag('version', version);
        Sentry.setUser({id});
        Sentry.init({
            dsn,
            beforeSend: report.beforeSentrySend,
            integrations: arr => arr.filter(x => !['Breadcrumbs', 'TryCatch'].includes(x.name)),
            sampleRate: 0.1,
        });
        report.setSentry(Sentry);
    }
}


export function asyncSerialize(asyncFunc) {
    let p;
    const fn = function() {
        if (p) {
            const chain = p = p.catch(() => null).then(() => asyncFunc.apply(this, arguments));
            chain.finally(() => {
                if (p === chain) {
                    p = undefined; // optimize next call
                }
            });
        } else {
            const r = asyncFunc.apply(this, arguments);
            if (r instanceof Promise) {
                p = r;
            } else {
                return r;
            }
        }
        return p;
    };
    Object.defineProperty(fn, 'name', {value: 'serialized ' + asyncFunc.name});
    return fn;
}


export function parseBackgroundColor({backgroundColor, solidBackground, backgroundAlpha}={}) {
    if (!solidBackground || !backgroundColor) {
        return;
    }
    try {
        const c = color.parse(backgroundColor);
        return (c.a === undefined && backgroundAlpha !== undefined) ? c.alpha(backgroundAlpha / 100) : c;
    } catch(e) {
        console.warn(e.message);
    }
}


export function setBackground(settings) {
    const bgColor = parseBackgroundColor(settings);
    doc.classList.toggle('solid-background', !!bgColor);
    if (bgColor) {
        doc.style.setProperty('--background-color', bgColor.toString());
    } else {
        doc.style.removeProperty('--background-color');
    }
}


function shallowCompareNodes(n1, n2) {
    if (n1.nodeType !== n2.nodeType) {
        return false;
    }
    if (n1.nodeType === Node.TEXT_NODE || n1.nodeType === Node.COMMENT_NODE) {
        return n1.nodeValue === n2.nodeValue;
    } else if (n1.nodeType !== Node.ELEMENT_NODE) {
        console.warn("Unsupported node type:", n1.nodeType, n1.nodeName);
        return false;
    }
    if (n1.nodeName !== n2.nodeName ||
        n1.attributes.length !== n2.attributes.length) {
        return false;
    }
    for (let i = 0; i < n1.attributes.length; i++) {
        const a1 = n1.attributes[i];
        const a2 = n2.attributes[i];
        if (a1.name !== a2.name || a1.value !== a2.value) {
            return false;
        }
    }
    return true;
}


const _surgicalTemplateRoots = new Map();
export async function renderSurgicalTemplate(selector, tpl, attrs) {
    const frag = await tpl(attrs);
    const key = `${selector}-${tpl.id}`;
    const beforeRoot = _surgicalTemplateRoots.get(key);
    if (!beforeRoot) {
        const root = document.querySelector(selector);
        root.replaceChildren(frag);
        _surgicalTemplateRoots.set(key, root);
        return true;
    }
    // BFS for differences...
    const q = [[frag, beforeRoot]];
    const replacements = [];
    while (q.length) {
        const [now, before] = q.shift();
        if (now.childNodes.length !== before.childNodes.length) {
            replacements.push([now, before]);
        } else {
            for (let i = 0; i < now.childNodes.length; i++) {
                const xNow = now.childNodes[i];
                const xBefore = before.childNodes[i];
                if (shallowCompareNodes(xNow, xBefore)) {
                    q.push([xNow, xBefore]);
                } else {
                    replacements.push([xNow, xBefore]);
                }
            }
        }
    }
    for (let i = 0; i < replacements.length; i++) {
        const [now, before] = replacements[i];
        if (before === beforeRoot) {
            // Special care is required for the root to preserve attributes
            before.replaceChildren(now);
        } else {
            before.replaceWith(now);
            if (now.nodeName === 'OPTION') {
                // Unfortunately replacing options one by one has side effects because
                // the engine will mend the `selected` state of the options remaining
                // in the fragment as required to ensure there is at least one selection.
                // This mended selected state overrides the "selected" attribute, which
                // has the unintended consequence of selecting the wrong option.
                now.selected = now.defaultSelected;
            }
        }
    }
    return replacements.length > 0;
}


function initClockSourceConfidence() {
    const csc = storage.get('/clock-source-confidence');
    let expWeightFn;
    if (!csc) {
        expWeightFn = expWeightedAvg(10, 1);
    } else {
        expWeightFn = expWeightedAvg(10, csc.value);
        const localNow = Date.now();
        const recheckPeriod = 6 * 3600_000;
        if (localNow - csc.ts > recheckPeriod) {
            for (let t = csc.ts + recheckPeriod; t < localNow; t += recheckPeriod) {
                expWeightFn(0);
            }
            storage.set('/clock-source-confidence', {
                ts: localNow,
                value: expWeightFn.get()
            });
        }
    }
    return expWeightFn;
}


let _clockSourceWeightedConfidence;
let _haveValidClock;
let _pendingClockSync;
let _clockSyncError;
export function getRealTime() {
    if (_clockSourceWeightedConfidence === undefined) {
        _clockSourceWeightedConfidence = initClockSourceConfidence();
        _haveValidClock = _clockSourceWeightedConfidence.get() > 1;
    }
    if (_haveValidClock || _clockSyncError) {
        return Date.now();
    }
    if (_pendingClockSync === false) {
        return time.getTime();
    } else if (_pendingClockSync) {
        return _pendingClockSync.then(() => _haveValidClock || _clockSyncError ? Date.now() : time.getTime());
    } else {
        return _pendingClockSync = time.establish().catch(e => {
            _clockSyncError = true;
            console.error('Failed to get real clock', e);
            // If we are having infra problems backoff locally...
            _clockSourceWeightedConfidence(1.1);
            storage.set('/clock-source-confidence', {
                ts: Date.now(),
                value: _clockSourceWeightedConfidence.get()
            });
        }).then(() => {
            _pendingClockSync = false;
            if (_clockSyncError) {
                return Date.now();
            }
            const localTime = Date.now();
            const drift = Math.abs(localTime - time.getTime());
            // bin drift into good, bad, terrible..
            const conf = drift < 100 ? 5 : drift < 1000 ? 2 : drift < 10_000 ?  0.5 : -1;
            _clockSourceWeightedConfidence(conf);
            storage.set('/clock-source-confidence', {
                ts: localTime,
                value: _clockSourceWeightedConfidence.get()
            });
            if (drift < 100) {
                // Hot wire valid clock source locally for this session only,
                // but we may still recheck on reloads..
                _haveValidClock = true;
                return Date.now();
            } else {
                return time.getTime();
            }
        });
    }
}


export function makeQuantizeBaseN(base) {
    const logBaseF = 1 / Math.log(base);
    return n => {
        let sign = 1;
        if (n < 0) {
            sign = -1;
            n = -n;
        }
        const lo = base ** Math.floor(Math.log(n) * logBaseF);
        const hi = base ** Math.ceil(Math.log(n) * logBaseF);
        return Math.round((n - lo < hi - n ? lo : hi) * sign) || 0;
    };
}


export function stddev(values) {
    values = values.toSorted((a, b) => a - b);
    const mean = values.reduce((a, x) => a + x, 0) / values.length;
    const variance = values.reduce((a, x) => a + (mean - x) * (mean - x), 0) / values.length;
    return Math.sqrt(variance);
}


export function winsorizedMean(values, clip=0.2) {
    if (values.length > 3) {
        values = values.toSorted((a, b) => a - b);
        const clipLen = Math.round(values.length * clip) || 1;
        const min = values[clipLen];
        const max = values[values.length - 1 - clipLen];
        for (let i = 0; i < clipLen; i++) {
            values[i] = min;
            values[values.length - 1 - i] = max;
        }
    } else if (values.length === 3) {
        values = values.toSorted((a, b) => a - b);
        return values[1];
    }
    return values.reduce((a, x) => a + x, 0) / values.length;
}


const _rafInitial = window.requestAnimationFrame;
export async function testFrameRate({raf=_rafInitial, mean=false, ticks=10}={}) {
    const times = [];
    let i = 0;
    let pts;
    return await new Promise(resolve => {
        const onRaf = ts => {
            if (pts) {
                times.push(ts - pts);
            }
            pts = ts;
            if (times.length && ++i >= ticks) {
                const msPerFrame = mean ?
                    times.reduce((a, x) => a + x, 0) / times.length :
                    winsorizedMean(times, 0.2);
                resolve(1000 / msPerFrame);
            } else {
                raf(onRaf);
            }
        };
        raf(onRaf);
    });
}


export class RAFThrottlePatcher {

    static requestAnimationFrameInitial = window.requestAnimationFrame;
    static cancelAnimationFrameInitial = window.cancelAnimationFrame;
    static idCounter = -1;
    static instance;

    static singleton() {
        return this.instance || (this.instance = new this());
    }

    constructor() {
        if (this.instance) {
            throw new Error("Illegal Instantiation");
        }
        const raf = this.constructor.requestAnimationFrameInitial;
        this.runners = {
            native: this._runnerNative.bind(this, raf),
            drop: this._runnerDrop.bind(this, raf),
            sched: this._runnerSched.bind(this, raf),
        };
        this.calibrating = false;
        this.queue = [];
        this.queueSwap = [];
        this.fps = 60;
        this.rafTime = 1000 / this.fps;
        this.setFPSLimit();
        this._pts = 0;
        window.requestAnimationFrame = this.requestAnimationFrame.bind(this);
        window.cancelAnimationFrame = this.cancelAnimationFrame.bind(this);
        this._stayCalibratedTask();
        this.constructor.requestAnimationFrameInitial.call(window, this.runner);
    }

    setFPSLimit(fps=this.fps) {
        this.throttledTime = 1000 / fps;
        this.fps = fps;
        const nativeFps = Math.round(1000 / this.rafTime);
        const ratio = this.rafTime / this.throttledTime;
        if (ratio > 0.95) {
            if (this.runner !== this.runners.native) {
                console.debug(`Using native RAF: ${nativeFps} -> ${fps} fps`);
                this.runner = this.runners.native;
            }
        } else if (this.throttledTime - this.rafTime < 10) {
            this._dropRate = ratio;
            this._dropAccum = 0;
            if (this.runner !== this.runners.drop) {
                console.debug(`Using RAF-drop-frames throttle: ${nativeFps} -> ${fps} fps`);
                this.runner = this.runners.drop;
            }
        } else {
            this._schedDelay = Math.round(this.throttledTime - this.rafTime / 2) - 1;
            if (this.runner !== this.runners.sched) {
                console.debug(`Using scheduled RAF throttle: ${nativeFps} -> ${fps} fps`);
                this.runner = this.runners.sched;
            }
        }
    }

    async calibrate() {
        if (document.hidden || this.calibrating) {
            return;
        }
        this.calibrating = true;
        try {
            const fps = await testFrameRate();
            this.rafTime = 1000 / fps;
            this.setFPSLimit();
        } finally {
            this.calibrating = false;
        }
    }

    requestAnimationFrame(cb) {
        const id = this.constructor.idCounter--;
        this.queue.push({cb, id});
        return id;
    }

    cancelAnimationFrame(id) {
        if (id != null) {
            for (let i = 0; i < this.queue.length; i++) {
                if (this.queue[i].id === id) {
                    this.queue.splice(i, 1);
                    break;
                }
            }
        }
    }

    _flush(ts) {
        const batch = this.queue;
        this.queue = this.queueSwap;
        this.queueSwap = batch;
        for (let i = 0; i < batch.length; i++) {
            try {
                batch[i].cb(ts);
            } catch(e) {
                queueMicrotask(() => {
                    throw e;
                });
            }
        }
        batch.length = 0;
        this._pts = ts;
    }

    _runnerNative(_raf, ts) {
        this._flush(ts);
        _raf.call(window, this.runner);
    }

    _runnerDrop(_raf, ts) {
        if ((this._dropAccum += this._dropRate) >= 1) {
            this._dropAccum -= 1;
            this._flush(ts);
        }
        _raf.call(window, this.runner);
    }

    _runnerSched(_raf, ts) {
        this._flush(ts);
        setTimeout(() => _raf.call(window, this.runner), this._schedDelay);
    }

    async _stayCalibratedTask() {
        let backoff = 1000;
        await sleep(200);
        while(true) {
            await this.calibrate();
            await sleep(Math.min(120_000, backoff *= 1.5));
        }
    }
}


if (window.CSS && CSS.registerProperty) {
    CSS.registerProperty({
        name: '--final-bg-opacity',
        syntax: '<percentage>',
        inherits: true,
        initialValue: '0%'
    });
}

if (settingsStore) {
    themeInit(settingsStore);
    localeInit(settingsStore);
}
