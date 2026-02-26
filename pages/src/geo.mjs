import * as Common from './common.mjs';
import * as Map from './map.mjs';
import * as Elevation from './elevation.mjs';
import * as Fields from './fields.mjs';
import * as Data from '/shared/sauce/data.mjs';

Common.enableSentry();

const doc = document.documentElement;

Common.settingsStore.setDefault({
    // v0.13.0...
    profileOverlay: true,
    mapStyle: 'default',
    tiltShift: false,
    tiltShiftAmount: 80,
    sparkle: false,
    solidBackground: false,
    transparency: 0,
    backgroundColor: '#00ff00',
    fields: 1,
    autoHeading: true,
    quality: 50,
    verticalOffset: 0,
    fpsLimit: 30,
    // v0.13.1...
    zoomPriorityTilt: true,
    // v1.0.0
    profileHeight: 20,
    routeProfile: true,
    showElevationMaxLine: true,
    autoCenter: true,
    // v1.1+
    disableChat: false,
});

const settings = Common.settingsStore.get();
const url = new URL(window.location);
const courseSelect = document.querySelector('#titlebar select[name="course"]');
const routeSelect = document.querySelector('#titlebar select[name="route"]');
const demoState = {};

let worldList;
let routesList;
let watchdog;
let inGame;
let zwiftMap;
let elProfile;
let courseId = Number(url.searchParams.get('course')) || undefined;
let routeId = Number(url.searchParams.get('route')) || undefined;
const laps = Number(url.searchParams.get('laps')) || undefined;


function qualityScale(raw) {
    raw = raw || 1;
    const min = 0.1;
    return Math.min(2, (raw / 100) * (1 - min) + min);
}


function getSetting(key, def) {
    const v = settings[key];
    return v === undefined ? def : v;
}


function createZwiftMap() {
    const opacity = 1 - 1 / (100 / (settings.transparency || 0));
    const autoCenter = getSetting('autoCenter', true);
    const zm = new Map.SauceZwiftMap({
        el: document.querySelector('.map'),
        worldList,
        zoom: settings.zoom,
        autoHeading: autoCenter && getSetting('autoHeading', true),
        autoCenter,
        style: settings.mapStyle,
        opacity,
        tiltShift: settings.tiltShift && ((settings.tiltShiftAmount || 0) / 100),
        sparkle: settings.sparkle,
        quality: qualityScale(settings.quality || 50),
        verticalOffset: settings.verticalOffset / 100,
        fpsLimit: settings.fpsLimit || 30,
        zoomPriorityTilt: getSetting('zoomPriorityTilt', true),
        preferRoute: settings.routeProfile !== false,
        horizWheelMode: settings.horizWheelMode,
    });
    const autoCenterBtn = document.querySelector('.map-controls .button.toggle-auto-center');
    const autoHeadingBtn = document.querySelector('.map-controls .button.toggle-auto-heading');

    function autoCenterHandler(en) {
        if (en) {
            zm.setDragOffset([0, 0]);
        }
        zm.setAutoCenter(en);
        zm.setAutoHeading(!en ? false : !!settings.autoHeading);
        autoCenterBtn.classList.toggle('primary', !!en);
        autoCenterBtn.classList.remove('outline');
        autoHeadingBtn.classList.toggle('disabled', !en);
        settings.autoCenter = en;
        Common.settingsStore.set(null, settings);
    }

    function autoHeadingHandler(en) {
        zm.setAutoHeading(en);
        if (en) {
            zm.setHeadingOffset(0);
        }
        autoHeadingBtn.classList.remove('outline');
        autoHeadingBtn.classList.toggle('primary', !!en);
        settings.autoHeading = en;
        Common.settingsStore.set(null, settings);
    }

    autoCenterBtn.classList.toggle('primary', settings.autoCenter !== false);
    autoCenterBtn.addEventListener('click', () =>
        autoCenterHandler(!autoCenterBtn.classList.contains('primary')));
    autoHeadingBtn.classList.toggle('disabled', settings.autoCenter === false);
    autoHeadingBtn.classList.toggle('primary', settings.autoHeading !== false);
    autoHeadingBtn.addEventListener('click', () =>
        autoHeadingHandler(!autoHeadingBtn.classList.contains('primary')));

    zm.addEventListener('drag', ev => {
        if (!ev.isUserInteraction) {
            return;
        }
        const dragging = !!(ev.drag[0] || ev.drag[1]);
        if (dragging && settings.autoCenter !== false) {
            autoCenterBtn.classList.remove('primary');
            autoCenterBtn.classList.add('outline');
        }
    });
    zm.addEventListener('headingoffset', ev => {
        if (!ev.isUserInteraction) {
            return;
        }
        if (autoHeadingBtn.classList.contains('primary')) {
            autoHeadingBtn.classList.remove('primary');
            autoHeadingBtn.classList.add('outline');
        }
    });
    zm.el.addEventListener('contextmenu', ev => {
        const entEl = ev.target.closest('.entity.athlete');
        if (!entEl) {
            return;
        }
        const id = Number(entEl.dataset.id);
        const ent = zwiftMap.getEntity(id);
        const header = ent.getPinHeaderHTML();
        ent.setPinHTML(`${header}<ul data-athlete-id="${id}">
            <li><a data-geo-action="toggle-marked"
                   href="javascript:void(0)"><ms>bookmark</ms> Toggle Marked</a></li>
            <li><a href="/pages/watching.html?windowId=watching-link-popup&windowType=watching&id=${id}"
                   target="watching_popup_${id}"><ms>grid_view</ms> Stats Grid</a></li>
            <li><a title="Watch this athlete (Game Connection is required)" data-geo-action="watch"
                   href="javascript:void(0)"><ms>video_camera_front</ms> Watch</a></li>
        </ul><div style="margin-top: 1.6em"></div>`);
        ent.togglePin(true, {hard: true});
    });
    zm.el.querySelector('.pins').addEventListener('click', async ev => {
        const actionEl = ev.target.closest('[data-geo-action]');
        if (!actionEl) {
            return;
        }
        const action = actionEl.dataset.geoAction;
        const athleteId = Number(actionEl.closest('[data-athlete-id]').dataset.athleteId);
        if (action === 'toggle-marked') {
            console.info("Toggle Marked:", athleteId, await Common.rpc.toggleMarkedAthlete(athleteId));
        } else if (action === 'watch') {
            console.info("Request Watch:", athleteId);
            await Common.rpc.watch(athleteId);
        } else {
            console.error("Unknown geo action", action);
        }
    });
    return zm;
}


function createElevationProfile() {
    const el = document.querySelector('.elevation-profile');
    if (settings.profileHeight) {
        el.style.setProperty('--profile-height', settings.profileHeight / 100);
    }
    const preferRoute = settings.routeProfile !== false;
    const showMaxLine = settings.showElevationMaxLine !== false;
    return new Elevation.SauceElevationProfile({el, worldList, preferRoute, showMaxLine});
}


function setWatching(id) {
    console.info("Now watching:", id);
    zwiftMap.setWatching(id);
    if (elProfile) {
        elProfile.setWatching(id);
    }
}


async function initialize() {
    let ad = await Common.rpc.getAthleteData('self');
    if (!ad) {
        // Support file replay mode too...
        ad = await Common.rpc.getAthleteData('watching');
    }
    inGame = !!ad && ad.age < 60000;
    if (!inGame) {
        if (!demoState.intervalId) {
            demoState.intervalId = true; // lock
            console.info("User not active: Starting demo mode...");
            if (elProfile) {
                elProfile.clear();
            }
            const notSoRandomCourseId = 6;
            demoState.transitionDurationSave = zwiftMap.getTransitionDuration();
            demoState.zoomSave = zwiftMap.zoom;
            demoState.autoCenterSave = zwiftMap.autoCenter;
            await zwiftMap.setCourse(notSoRandomCourseId);
            if (demoState.intervalId === true) {  // could have been cancelled during await
                let heading = 0;
                const headingStep = 1;
                zwiftMap.setTransitionDuration(1016);
                zwiftMap.setZoom(0.5);
                zwiftMap.setAutoCenter(false);
                zwiftMap.setHeading(heading += headingStep);
                demoState.intervalId = setInterval(() => {
                    zwiftMap.setHeading(heading += headingStep);
                }, 1000);
            }
        }
        return;
    } else if (demoState.intervalId) {
        console.info("User detected in game: Ending demo mode.");
        clearInterval(demoState.intervalId);
        demoState.intervalId = null;
        zwiftMap.setTransitionDuration(demoState.transitionDurationSave);
        zwiftMap.setZoom(demoState.zoomSave);
        zwiftMap.setAutoCenter(demoState.autoCenterSave);
    }
    zwiftMap.setAthlete(ad.athleteId);
    if (elProfile) {
        elProfile.setAthlete(ad.athleteId);
    }
    if (!ad.watching) {
        const watching = await Common.rpc.getAthleteData('watching');
        if (watching) {
            setWatching(watching.athleteId);
        }
    } else {
        setWatching(ad.athleteId);
    }
    if (ad.state) {
        zwiftMap.incPause();
        try {
            await zwiftMap.renderAthleteStates([ad.state]);
        } finally {
            zwiftMap.decPause();
        }
        if (elProfile) {
            await elProfile.renderAthleteStates([ad.state]);
        }
    }
}


function centerMap(positions, options) {
    const xMin = Data.min(positions.map(x => x[0]));
    const yMin = Data.min(positions.map(x => x[1]));
    const xMax = Data.max(positions.map(x => x[0]));
    const yMax = Data.max(positions.map(x => x[1]));
    zwiftMap.setDragOffset([0, 0]);
    zwiftMap.setBounds([xMin, yMax], [xMax, yMin], options);
}


async function applyRoute() {
    if (routeId != null && routeId !== -1) {
        url.searchParams.set('route', routeId);
    } else {
        url.searchParams.delete('route');
    }
    window.history.replaceState({}, '', url);
    routeSelect.replaceChildren();
    routeSelect.insertAdjacentHTML('beforeend', `<option value disabled selected>Route</option>`);
    if (!routesList) {
        routesList = Array.from(await Common.getRouteList()).sort((a, b) => a.name < b.name ? -1 : 1);
    }
    if (routeId === -1) {
        const courseRoutes = routesList.filter(x => x.courseId === courseId);
        routeId = courseRoutes[courseRoutes.length * Math.random() | 0].id;
        url.searchParams.set('route', routeId);
        window.history.replaceState({}, '', url);
    }
    for (const x of routesList) {
        if (x.courseId !== courseId) {
            continue;
        }
        routeSelect.insertAdjacentHTML('beforeend', `
            <option ${x.id === routeId ? 'selected' : ''}
                    value="${x.id}">${Common.stripHTML(x.name)}</option>`);
    }
    if (routeId != null) {
        await zwiftMap.setActiveRoute(routeId, {showWeld: true});
        console.debug('Route:', zwiftMap.route);
        centerMap(zwiftMap.route.curvePath.flatten(1/3));
        if (elProfile) {
            await elProfile.setRoute(routeId, {laps});
        }
    } else {
        zwiftMap.setVerticalOffset(0);
        zwiftMap.setDragOffset([0, 0]);
        zwiftMap.setZoom(0.2);
        if (elProfile) {
            elProfile.clear();
        }
    }
}


async function applyCourse() {
    if (courseId != null) {
        url.searchParams.set('course', courseId);
    } else {
        url.searchParams.delete('course');
    }
    window.history.replaceState({}, '', url);
    courseSelect.replaceChildren();
    for (const x of worldList) {
        courseSelect.insertAdjacentHTML('beforeend', `
            <option ${x.courseId === courseId ? 'selected' : ''}
                    value="${x.courseId}">${Common.stripHTML(x.name)}</option>`);
    }
    if (courseId != null) {
        await zwiftMap.setCourse(courseId);
        if (elProfile) {
            await elProfile.setCourse(courseId);
        }
    }
}


export async function main() {
    Common.initInteractionListeners();
    Common.setBackground(settings);
    const fieldsEl = document.querySelector('#content .fields');
    const fieldRenderer = new Common.Renderer(fieldsEl, {fps: 1});
    const mapping = [];
    const defaults = {
        f1: 'grade',
        f2: 'altitude',
    };
    const numFields = Common.settingsStore.get('fields');
    for (let i = 0; i < (isNaN(numFields) ? 1 : numFields); i++) {
        const id = `f${i + 1}`;
        fieldsEl.insertAdjacentHTML('afterbegin', `
            <div class="field" data-field="${id}">
                <div class="key"></div><div class="value"></div><abbr class="unit"></abbr>
            </div>
        `);
        mapping.push({id, default: defaults[id] || 'time-elapsed'});
    }
    fieldRenderer.addRotatingFields({
        mapping,
        fields: Fields.fields.filter(({id, group}) => {
            const type = id.split('-')[0];
            return group === 'system' ||
                ['ev', 'game-laps', 'progress', 'rt', 'el', 'grade', 'altitude'].includes(type);
        })
    });
    routeSelect.addEventListener('change', async ev => {
        routeId = Number(routeSelect.value);
        await applyRoute();
    });
    courseSelect.addEventListener('change', async ev => {
        const id = Number(courseSelect.value);
        if (id === courseId) {
            console.debug("debounce course change");
            return;
        }
        courseId = id;
        routeId = undefined;
        await applyCourse();
        await applyRoute();
    });
    worldList = await Common.getWorldList();
    zwiftMap = createZwiftMap();
    window.zwiftMap = zwiftMap;  // DEBUG
    if (settings.profileOverlay) {
        const point = zwiftMap.addPoint([0, 0], 'circle');
        point.toggleHidden(true);
        elProfile = createElevationProfile();
        elProfile.chart.on('updateAxisPointer', ev => {
            const pos = elProfile.curvePath?.nodes[ev.dataIndex]?.end;
            point.toggleHidden(!pos);
            if (pos) {
                point.setPosition(pos);
            }
        });
    }
    if (courseId != null) {
        doc.classList.add('explore');
        doc.querySelector('#titlebar').classList.add('always-visible');
        zwiftMap.setAutoCenter(false);
        zwiftMap.setZoom(0.2);
        zwiftMap.setTiltShift(0);
        zwiftMap.setVerticalOffset(0);
        zwiftMap.setTransitionDuration(1500);
        await applyCourse();
        await applyRoute();
    } else {
        let settingsSaveTimeout;
        zwiftMap.addEventListener('zoom', ev => {
            if (!ev.isUserInteraction) {
                return;
            }
            clearTimeout(settingsSaveTimeout);
            settings.zoom = Number(ev.zoom.toFixed(2));
            settingsSaveTimeout = setTimeout(() => Common.settingsStore.set(null, settings), 100);
        });
        await initialize();
        fieldRenderer.setData({});
        fieldRenderer.render();
        Common.subscribe('watching-athlete-change', async athleteId => {
            if (!inGame) {
                await initialize();
            } else {
                setWatching(athleteId);
            }
        });
        Common.subscribe('athlete/watching', ad => {
            fieldRenderer.setData(ad);
            fieldRenderer.render();
        });
        setInterval(() => {
            if (inGame && performance.now() - watchdog > 30000) {
                console.warn("Watchdog triggered by inactivity");
                inGame = false;
                initialize();
            }
        }, 3333);
        Common.subscribe('states', async states => {
            if (!inGame) {
                await initialize();
            }
            watchdog = performance.now();
            zwiftMap.renderAthleteStates(states);
            if (elProfile) {
                elProfile.renderAthleteStates(states);
            }
        });
        Common.subscribe('chat', chat => {
            if (settings.disableChat) {
                return;
            }
            if (chat.muted) {
                console.debug("Ignoring muted chat message");
                return;
            }
            const ent = zwiftMap.getEntity(chat.from);
            if (ent) {
                ent.addChatMessage(chat);
            }
        });
    }
    document.querySelector('#titlebar .button.explore-mode').addEventListener('click', () => {
        if (courseId) {
            window.location.search = '';
        } else {
            const q = new URLSearchParams({
                course: zwiftMap.courseId ?? 6,
                route: zwiftMap.routeId ?? -1,
            });
            window.location.search = q;
        }
    });
    Common.settingsStore.addEventListener('set', async ev => {
        if (!ev.data.remote) {
            return;
        }
        await 0;  // prevent storage handler timing violations
        const {key, value} = ev.data;
        if (['solidBackground', 'backgroundColor', 'backgroundAlpha'].includes(key)) {
            Common.setBackground(settings);
        } else if (key === 'transparency') {
            zwiftMap.setOpacity(1 - 1 / (100 / (value || 0)));
        } else if (key === 'mapStyle') {
            zwiftMap.setStyle(value);
        } else if (key === 'tiltShift' || key === 'tiltShiftAmount') {
            zwiftMap.setTiltShift(settings.tiltShift && ((settings.tiltShiftAmount || 0) / 100));
        } else if (key === 'zoomPriorityTilt') {
            zwiftMap.setZoomPriorityTilt(value);
        } else if (key === 'sparkle') {
            zwiftMap.setSparkle(value);
        } else if (key === 'quality') {
            zwiftMap.setQuality(qualityScale(value));
        } else if (key === 'zoom') {
            zwiftMap.setZoom(value);
        } else if (key === 'verticalOffset') {
            zwiftMap.setVerticalOffset(value / 100);
        } else if (key === 'fpsLimit') {
            zwiftMap.setFPSLimit(value);
        } else if (key === 'profileHeight') {
            if (elProfile) {
                elProfile.el.style.setProperty('--profile-height', value / 100);
                elProfile.chart.resize();
            }
        } else if (key === 'horizWheelMode') {
            zwiftMap.setHorizWheelMode(value);
        } else if (['profileOverlay', 'fields', 'routeProfile', 'showElevationMaxLine'].includes(key)) {
            window.location.reload();
        }
    });
}


export async function settingsMain() {
    Common.initInteractionListeners();
    (await Common.initSettingsForm('form'))();
}
