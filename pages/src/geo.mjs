import * as common from './common.mjs';
import * as map from './map.mjs';
import * as elevation from './elevation.mjs';
import * as fields from './fields.mjs';
import * as data from '/shared/sauce/data.mjs';

common.enableSentry();

const doc = document.documentElement;

common.settingsStore.setDefault({
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

const settings = common.settingsStore.get();
const url = new URL(location);
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


function qualityScale(raw) {
    raw = raw || 1;
    const min = 0.2;
    return Math.min(2, (raw / 100) * (1 - min) + min);
}


function getSetting(key, def) {
    const v = settings[key];
    return v === undefined ? def : v;
}


function createZwiftMap() {
    const opacity = 1 - 1 / (100 / (settings.transparency || 0));
    const autoCenter = getSetting('autoCenter', true);
    const zm = new map.SauceZwiftMap({
        el: document.querySelector('.map'),
        worldList,
        zoom: settings.zoom,
        autoHeading: autoCenter && getSetting('autoHeading', true),
        autoCenter,
        style: settings.mapStyle,
        opacity,
        tiltShift: settings.tiltShift && ((settings.tiltShiftAmount || 0) / 100),
        sparkle: settings.sparkle,
        quality: qualityScale(settings.quality || 80),
        verticalOffset: settings.verticalOffset / 100,
        fpsLimit: settings.fpsLimit || 30,
        zoomPriorityTilt: getSetting('zoomPriorityTilt', true),
        preferRoute: settings.routeProfile !== false,
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
        common.settingsStore.set(null, settings);
    }

    function autoHeadingHandler(en) {
        zm.setAutoHeading(en);
        if (en) {
            zm.setHeadingOffset(0);
        }
        autoHeadingBtn.classList.remove('outline');
        autoHeadingBtn.classList.toggle('primary', !!en);
        settings.autoHeading = en;
        common.settingsStore.set(null, settings);
    }

    autoCenterBtn.classList.toggle('primary', settings.autoCenter !== false);
    autoCenterBtn.addEventListener('click', () =>
        autoCenterHandler(!autoCenterBtn.classList.contains('primary')));
    autoHeadingBtn.classList.toggle('disabled', settings.autoCenter === false);
    autoHeadingBtn.classList.toggle('primary', settings.autoHeading !== false);
    autoHeadingBtn.addEventListener('click', () =>
        autoHeadingHandler(!autoHeadingBtn.classList.contains('primary')));

    zm.addEventListener('drag', ev => {
        if (ev.drag) {
            const dragging = !!(ev.drag && (ev.drag[0] || ev.drag[1]));
            if (dragging && settings.autoCenter !== false) {
                autoCenterBtn.classList.remove('primary');
                autoCenterBtn.classList.add('outline');
            }
        } else if (ev.heading) {
            if (autoHeadingBtn.classList.contains('primary')) {
                autoHeadingBtn.classList.remove('primary');
                autoHeadingBtn.classList.add('outline');
            }
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
    return new elevation.SauceElevationProfile({el, worldList, preferRoute, showMaxLine});
}


function setWatching(id) {
    console.info("Now watching:", id);
    zwiftMap.setWatching(id);
    if (elProfile) {
        elProfile.setWatching(id);
    }
}


async function initialize() {
    let ad = await common.rpc.getAthleteData('self');
    if (!ad) {
        // Support file replay mode too...
        ad = await common.rpc.getAthleteData('watching');
    }
    inGame = !!ad && ad.age < 15000;
    if (!inGame) {
        if (!demoState.intervalId) {
            demoState.intervalId = true; // lock
            console.info("User not active: Starting demo mode...");
            if (elProfile) {
                elProfile.clear();
            }
            const randomCourseId = worldList[worldList.length * Math.random() | 0].courseId;
            let heading = 0;
            demoState.transitionDurationSave = zwiftMap.getTransitionDuration();
            demoState.zoomSave = zwiftMap.zoom;
            zwiftMap.setZoom(0.2, {disableEvent: true});
            await zwiftMap.setCourse(randomCourseId);
            if (demoState.intervalId === true) {  // could have been cancelled during await
                zwiftMap.setHeading(heading += 5);
                zwiftMap.setTransitionDuration(1100);
                demoState.intervalId = setInterval(() => {
                    zwiftMap.setHeading(heading += 5);
                }, 1000);
            }
        }
        return;
    } else if (demoState.intervalId) {
        console.info("User detected in game: Ending demo mode.");
        clearInterval(demoState.intervalId);
        demoState.intervalId = null;
        zwiftMap.setTransitionDuration(demoState.transitionDurationSave);
        zwiftMap.setZoom(demoState.zoomSave, {disableEvent: true});
    }
    zwiftMap.setAthlete(ad.athleteId);
    if (elProfile) {
        elProfile.setAthlete(ad.athleteId);
    }
    if (!ad.watching) {
        const watching = await common.rpc.getAthleteData('watching');
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
    const xMin = data.min(positions.map(x => x[0]));
    const yMin = data.min(positions.map(x => x[1]));
    const xMax = data.max(positions.map(x => x[0]));
    const yMax = data.max(positions.map(x => x[1]));
    zwiftMap.setDragOffset([0, 0]);
    zwiftMap.setBounds([xMin, yMax], [xMax, yMin], options);
}


const _routeHighlights = [];
async function applyRoute() {
    if (routeId != null) {
        url.searchParams.set('route', routeId);
    } else {
        url.searchParams.delete('route');
    }
    history.replaceState({}, '', url);
    while (_routeHighlights.length) {
        _routeHighlights.pop().elements.forEach(x => x.remove());
    }
    routeSelect.replaceChildren();
    routeSelect.insertAdjacentHTML('beforeend', `<option value disabled selected>Route</option>`);
    for (const x of routesList) {
        if (x.courseId !== courseId) {
            continue;
        }
        routeSelect.insertAdjacentHTML('beforeend', `
            <option ${x.id === routeId ? 'selected' : ''}
                    value="${x.id}">${common.stripHTML(x.name)}</option>`);
    }
    if (routeId != null) {
        const route = await common.getRoute(routeId);
        const path = route.curvePath;
        _routeHighlights.push(
            zwiftMap.addHighlightPath(path, `route-1-${route.id}`, {width: 5, color: '#0004'}),
            zwiftMap.addHighlightPath(path, `route-2-${route.id}`, {width: 1.2, color: 'black'}),
            zwiftMap.addHighlightPath(path, `route-3-${route.id}`, {width: 0.5, color: 'gold'}),
        );
        centerMap(route.curvePath.flatten(1/3));
        if (elProfile) {
            await elProfile.setRoute(routeId);
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
    history.replaceState({}, '', url);
    courseSelect.replaceChildren();
    for (const x of worldList) {
        courseSelect.insertAdjacentHTML('beforeend', `
            <option ${x.courseId === courseId ? 'selected' : ''}
                    value="${x.courseId}">${common.stripHTML(x.name)}</option>`);
    }
    if (courseId != null) {
        await zwiftMap.setCourse(courseId);
        if (elProfile) {
            await elProfile.setCourse(courseId);
        }
    }
}


export async function main() {
    common.initInteractionListeners();
    common.setBackground(settings);
    const fieldsEl = document.querySelector('#content .fields');
    const fieldRenderer = new common.Renderer(fieldsEl, {fps: 1});
    const mapping = [];
    const defaults = {
        f1: 'grade',
        f2: 'altitude',
    };
    const numFields = common.settingsStore.get('fields');
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
        fields: fields.fields.filter(({id}) => {
            const type = id.split('-')[0];
            return ['ev', 'game-laps', 'progress', 'rt', 'el', 'grade', 'altitude'].includes(type);
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
    [worldList, routesList] = await Promise.all([common.getWorldList(), common.getRouteList()]);
    routesList = Array.from(routesList).sort((a, b) => a.name < b.name ? -1 : 1);
    zwiftMap = createZwiftMap();
    window.zwiftMap = zwiftMap;  // DEBUG
    window.MapEntity = map.MapEntity;
    if (settings.profileOverlay) {
        const point = zwiftMap.addPoint([0, 0], 'circle');
        point.toggleHidden(true);
        elProfile = createElevationProfile();
        elProfile.chart.on('updateAxisPointer', ev => {
            const pos = elProfile.curvePath.nodes[ev.dataIndex]?.end;
            point.toggleHidden(!pos);
            if (pos) {
                point.setPosition(pos);
            }
        });
    }
    if (courseId != null) {
        doc.classList.add('explore');
        doc.querySelector('#titlebar').classList.add('always-visible');
        zwiftMap.setZoom(0.2);
        zwiftMap.setTiltShift(0);
        zwiftMap.setVerticalOffset(0);
        zwiftMap._mapTransition.setDuration(1500);
        await applyCourse();
        await applyRoute();
    } else {
        let settingsSaveTimeout;
        zwiftMap.addEventListener('zoom', ev => {
            clearTimeout(settingsSaveTimeout);
            settings.zoom = Number(ev.zoom.toFixed(2));
            settingsSaveTimeout = setTimeout(() => common.settingsStore.set(null, settings), 100);
        });
        await initialize();
        fieldRenderer.setData({});
        fieldRenderer.render();
        common.subscribe('watching-athlete-change', async athleteId => {
            if (!inGame) {
                await initialize();
            } else {
                setWatching(athleteId);
            }
        });
        common.subscribe('athlete/watching', ad => {
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
        common.subscribe('states', async states => {
            if (!inGame) {
                await initialize();
            }
            watchdog = performance.now();
            zwiftMap.renderAthleteStates(states);
            if (elProfile) {
                elProfile.renderAthleteStates(states);
            }
        });
        common.subscribe('chat', chat => {
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
    common.settingsStore.addEventListener('set', ev => {
        if (!ev.data.remote) {
            return;
        }
        const {key, value} = ev.data;
        if (['solidBackground', 'backgroundColor', 'backgroundAlpha'].includes(key)) {
            common.setBackground(settings);
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
        } else if (['profileOverlay', 'fields', 'routeProfile', 'showElevationMaxLine'].includes(key)) {
            location.reload();
        }
    });
}


export async function settingsMain() {
    common.initInteractionListeners();
    (await common.initSettingsForm('form'))();
}
