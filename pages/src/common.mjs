/* global Sentry, electron */
import {sleep as _sleep} from '../../shared/sauce/base.mjs';
import * as locale from '../../shared/sauce/locale.mjs';
import {expWeightedAvg as _expWeightedAvg} from '/shared/sauce/data.mjs';
import * as report from '../../shared/report.mjs';
import * as elements from './custom-elements.mjs';
import * as curves from '/shared/curves.mjs';
import * as fields from './fields.mjs';
import * as color from './color.mjs';

export const sleep = _sleep; // Come on ES6 modules, really!?
export const expWeightedAvg = _expWeightedAvg;
export let idle;
if (window.requestIdleCallback) {
    idle = options => new Promise(resolve => requestIdleCallback(resolve, options));
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
    doc.addEventListener('click', async ev => {
        const link = ev.target.closest('a[external][href]');
        if (link) {
            ev.preventDefault();
            await rpcCall('openExternalLink', link.href);
        }
    });
    let storageFlushTimeout;
    schedStorageFlush = () => {
        clearTimeout(storageFlushTimeout);
        storageFlushTimeout = setTimeout(() => rpcCall('flushSessionStorage'), 500);
    };
} else {
    const q = new URLSearchParams(location.search);
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
        const schema = location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${schema}://${location.host}/api/ws/events`);
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
export async function getWorldList() {
    if (!_worldList) {
        _worldList = rpcCall('getWorldMetas');
    }
    return await _worldList;
}


export async function getSegments(worldId) {
    console.warn("DEPRECATED: use rpc.getSegments instead");
    const worldList = await getWorldList();
    const worldMeta = worldList.find(x => x.worldId === worldId);
    return await rpcCall('getSegments', worldMeta.courseId);
}


function zToAltitude(worldMeta, z, {physicsSlopeScale}={}) {
    return worldMeta ? (z + worldMeta.waterPlaneLevel) / 100 *
        (physicsSlopeScale || worldMeta.physicsSlopeScale) + worldMeta.altitudeOffsetHack : null;
}


function supplimentPath(worldMeta, curvePath, {physicsSlopeScale, distances}={}) {
    const balancedT = 1 / 125; // tests to within 0.27 meters (worst case)
    const distEpsilon = 1e-6;
    const elevations = [];
    const grades = [];
    let prevEl = 0;
    if (!distances) {
        distances = [];
        let distance = 0;
        let prevDist = 0;
        let prevNode;
        let prevIndex;
        curvePath.trace(x => {
            distance += prevNode ? curves.vecDist(prevNode, x.stepNode) / 100 : 0;
            if (x.index !== prevIndex) {
                const elevation = worldMeta ?
                    zToAltitude(worldMeta, x.stepNode[2], {physicsSlopeScale}) :
                    x.stepNode[2] / 100 * (physicsSlopeScale || 1);
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
    } else {
        for (const [i, distance] of distances.entries()) {
            const node = curvePath.nodes[i];
            const elevation = worldMeta ?
                zToAltitude(worldMeta, node[2], {physicsSlopeScale}) :
                node[2] / 100 * (physicsSlopeScale || 1);
            if (i) {
                if (distance - distances[i - 1] > distEpsilon) {
                    const grade = (elevation - prevEl) / (distance - distances[i - 1]);
                    grades.push(grade);
                } else {
                    grades.push(grades.at(-1) || 0);
                }
            }
            elevations.push(elevation);
            prevEl = elevation;
        }
    }
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
        _roads.set(courseId, rpcCall('getRoads', courseId).then(async roads => {
            const worldList = await getWorldList();
            const worldMeta = worldList.find(x => x.courseId === courseId);
            for (const x of roads) {
                const curveFunc = {
                    CatmullRom: curves.catmullRomPath,
                    Bezier: curves.cubicBezierPath,
                }[x.splineType];
                x.curvePath = curveFunc(x.path, {loop: x.looped, road: true});
                const physicsSlopeScale = x.physicsSlopeScaleOverride;
                const distances = x.distances;
                Object.assign(x, supplimentPath(worldMeta, x.curvePath, {physicsSlopeScale, distances}));
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


const _segments = new Map();
export function getSegment(id) {
    if (!_segments.has(id)) {
        _segments.set(id, rpcCall('getSegment', id));
    }
    return _segments.get(id);
}


async function computeRoutePath(route) {
    const curvePath = new curves.CurvePath();
    const roadSegments = [];
    const worldList = await getWorldList();
    const worldMeta = worldList.find(x => x.courseId === route.courseId);
    for (const [i, x] of route.manifest.entries()) {
        const road = await getRoad(route.courseId, x.roadId);
        const seg = road.curvePath.subpathAtRoadPercents(x.start, x.end);
        seg.reverse = x.reverse;
        seg.leadin = x.leadin;
        seg.roadId = x.roadId;
        for (const xx of seg.nodes) {
            xx.index = i;
        }
        roadSegments.push(seg);
        curvePath.extend(x.reverse ? seg.toReversed() : seg);
    }
    // NOTE: No support for physicsSlopeScaleOverride of portal roads.
    // But I've not seen portal roads used in a route either.
    return {
        curvePath,
        roadSegments,
        ...supplimentPath(worldMeta, curvePath, {distances: route.distances}),
    };
}


async function addRouteSegments(route) {
    const allSegmentIds = [].concat(...route.manifest.map(x => x.segmentIds || []));
    const segments = await Promise.all(allSegmentIds.map(x => getSegment(x)));
    for (const m of route.manifest.filter(x => x.segmentIds)) {
        m.segments = m.segmentIds.map(id => segments.find(x => x.id === id));
    }
}


let _routeListPromise;
const _routePromises = new Map();
export function getRoute(id) {
    if (!_routePromises.has(id)) {
        if (_routeListPromise) {
            _routePromises.set(id, _routeListPromise.then(async routes => {
                const route = routes && routes.find(x => x.id === id);
                if (route) {
                    await Promise.all([
                        addRouteSegments(route),
                        computeRoutePath(route).then(x => Object.assign(route, x)),
                    ]);
                }
                return route;
            }));
        } else {
            _routePromises.set(id, rpcCall('getRoute', id).then(async route => {
                if (route) {
                    await Promise.all([
                        addRouteSegments(route),
                        computeRoutePath(route).then(x => Object.assign(route, x)),
                    ]);
                }
                return route;
            }));
        }
    }
    return _routePromises.get(id);
}


export function getRouteList(courseId) {
    if (!_routeListPromise) {
        _routeListPromise = rpcCall('getRoutes');
    }
    return courseId == null ?
        _routeListPromise :
        _routeListPromise.then(routes => routes.filter(x => x.courseId === courseId));
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


export function softInnerHTML(el, html) {
    if (el._softInnerHTML !== html) {
        el.innerHTML = html;
        el._softInnerHTML = html;
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
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
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
        const isFirefoxIFrame = location !== parent.location && navigator.userAgent.match(/ Firefox/);
        if (isFirefoxIFrame || navigator.userAgent.match(/ OBS\//)) {
            console.info("Enabling hack to avoid broken tabs handling");
            for (const x of document.querySelectorAll('a[target]')) {
                x.removeAttribute('target');
            }
        }
    }
    const close = document.querySelector('#titlebar .button.close');
    if (close) {
        close.addEventListener('click', ev => rpcCall('closeWindow'));
    }
    const minimize = document.querySelector('#titlebar .button.minimize');
    if (minimize) {
        minimize.addEventListener('click', ev => rpcCall('minimizeWindow'));
    }
    const maximize = document.querySelector('#titlebar .button.maximize');
    if (maximize) {
        maximize.addEventListener('click', ev => rpcCall('toggleMaximizeWindow'));
    }
    for (const el of document.querySelectorAll('.button[data-url]')) {
        el.addEventListener('click', ev => location.assign(el.dataset.url));
    }
    for (const el of document.querySelectorAll('.button[data-ext-url]')) {
        el.addEventListener('click', ev =>
            window.open(el.dataset.extUrl, '_blank', 'popup,width=999,height=333'));
    }
    for (const el of document.querySelectorAll('.tabbed header.tabs')) {
        const tabs = Array.from(el.querySelectorAll(':scope > .tab'));
        const sections = Array.from(el.closest('.tabbed').querySelectorAll(':scope > .tab'));
        el.addEventListener('click', ev => {
            const tab = ev.target.closest('.tab');
            if (!tab) {
                return;
            }
            for (let i = 0; i < tabs.length; i++) {
                const active = tabs[i] === tab;
                tabs[i].classList.toggle('active', active);
                sections[i].classList.toggle('active', active);
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
                if (pos.left < innerWidth / 2) {
                    dialog.style.setProperty('left', pos.left + 'px');
                } else {
                    dialog.style.setProperty('right', innerWidth - pos.right + 'px');
                    dialog.style.setProperty('left', 'unset');
                }
                if (pos.top < innerHeight / 2) {
                    dialog.style.setProperty('top', pos.bottom + 'px');
                } else {
                    dialog.style.setProperty('bottom', innerHeight - pos.top + 'px');
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
        this.fps = options.fps === undefined ? 1 : options.fps;
        this.id = options.id || location.pathname.split('/').at(-1);
        this.fields = new Map();
        this.onKeyDownBound = this.onKeyDown.bind(this);
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
            const handler = longPressListener(el, 1500, ev => {
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
                        container.label = fields.fieldGroupNames[group] || group;
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
                            option.textContent = stripHTML(x.longName ? fGet(x.longName) : fGet(x.key));
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
        const tooltip = field.active?.tooltip ? fGet(field.active.tooltip) + '\n\n' : '';
        try {
            field.el.title = `${tooltip}Long click/press to change this field or use ` +
                `the Left/Right keys when focused.`;
        } catch(e) {
            console.error("Failed to get tooltip name for next field:", mappingId, e);
        }
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
                        try {
                            value = fGet(field.active.value, this._data);
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
                                softInnerHTML(field.subLabelEl, '');
                            }
                        }
                        if (field.keyEl) {
                            let key = '';
                            try {
                                key = field.active.key ? fGet(field.active.key, this._data) : '';
                            } catch(e) {
                                report.errorThrottled(e);
                            }
                            softInnerHTML(field.keyEl, key);
                        }
                        if (field.unitEl) {
                            let unit = '';
                            // Hide unit if there is no value but only if there is no key field too.
                            const showUnit = field.active.unit &&
                                ((value != null && value !== '-') || !field.keyEl);
                            try {
                                unit = showUnit ? fGet(field.active.unit, this._data) : '';
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
        throw new Error("Invalid depends-on grammer field");
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
            console.error("Invalid depends-on grammer field", d, e);
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
        const baseType = {
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
                console.error("Invalid depends-on grammer field", dependsOn, e);
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
    // Escaped HTML turns into HTML so we must run until all the HTML is gone...
    while (true) {
        const output = _stripper.parseFromString(input, 'text/html').body.textContent || '';
        if (output === input) {
            return output;
        }
        input = output;
    }
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
        return `<img class="nation-flag" src="${_flags[code]}" title="${nation}"/>`;
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
        const theme = store.get('/theme');
        if (theme) {
            doc.dataset.theme = theme;
        }
    }
    store.addEventListener('set', ev => {
        const key = ev.data.key;
        if (key === 'themeOverride' || key === '/theme') {
            doc.dataset.theme = store.get('themeOverride') || store.get('/theme') || '';
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
        const row = ev.target.closest('tr');
        if (!row || row.closest('table') !== table) {
            return;
        }
        if (row.classList.contains('summary')) {
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
    if (type === 'byte') {
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
    if (location.pathname.startsWith('/mods/')) {
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
