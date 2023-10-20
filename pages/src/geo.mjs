import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as map from './map.mjs';
import * as elevation from './elevation.mjs';
import * as fields from './fields.mjs';

common.enableSentry();

const doc = document.documentElement;
const L = sauce.locale;
const imperial = !!common.storage.get('/imperialUnits');
L.setImperial(imperial);

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
});

const settings = common.settingsStore.get();

let watchdog;
let inGame;
let zwiftMap;
let elProfile;


function setBackground() {
    const {solidBackground, backgroundColor} = common.settingsStore.get();
    doc.classList.toggle('solid-background', !!solidBackground);
    if (solidBackground) {
        doc.style.setProperty('--background-color', backgroundColor);
    } else {
        doc.style.removeProperty('--background-color');
    }
}


function qualityScale(raw) {
    raw = raw || 1;
    const min = 0.2;
    return Math.min(2, (raw / 100) * (1 - min) + min);
}


function getSetting(key, def) {
    const v = settings[key];
    return v === undefined ? def : v;
}


function createZwiftMap({worldList}) {
    const opacity = 1 - 1 / (100 / (settings.transparency || 0));
    const zm = new map.SauceZwiftMap({
        el: document.querySelector('.map'),
        worldList,
        zoom: settings.zoom,
        autoHeading: settings.autoHeading,
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
    let settingsSaveTimeout;
    zm.addEventListener('zoom', ev => {
        clearTimeout(settingsSaveTimeout);
        settings.zoom = Number(ev.zoom.toFixed(2));
        settingsSaveTimeout = setTimeout(() => common.settingsStore.set(null, settings), 100);
    });
    const anchorResetButton = document.querySelector('.map-controls .button.reset-anchor');
    zm.addEventListener('drag', ev =>
        anchorResetButton.classList.toggle('disabled', !ev.drag[0] && !ev.drag[1]));
    anchorResetButton.addEventListener('click', ev => zm.setDragOffset(0, 0));
    const headingRotateDisButton = document.querySelector('.map-controls .button.disable-heading');
    const headingRotateEnButton = document.querySelector('.map-controls .button.enable-heading');
    const autoHeadingHandler = en => {
        zm.setAutoHeading(en);
        headingRotateDisButton.classList.toggle('hidden', !en);
        headingRotateEnButton.classList.toggle('hidden', en);
        settings.autoHeading = en;
        common.settingsStore.set(null, settings);
    };
    headingRotateDisButton.classList.toggle('hidden', settings.autoHeading === false);
    headingRotateEnButton.classList.toggle('hidden', settings.autoHeading !== false);
    headingRotateDisButton.addEventListener('click', () => autoHeadingHandler(false));
    headingRotateEnButton.addEventListener('click', () => autoHeadingHandler(true));
    return zm;
}


function createElevationProfile({worldList}) {
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
    const ad = await common.rpc.getAthleteData('self');
    inGame = !!ad;
    if (!inGame) {
        console.info("User not active, starting demo mode...");
        zwiftMap.setCourse(6);
        if (elProfile) {
            elProfile.setCourse(6);
        }
        return;
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


export async function main() {
    common.initInteractionListeners();
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
    const worldList = await common.getWorldList();
    zwiftMap = createZwiftMap({worldList});
    window.zwiftMap = zwiftMap;  // DEBUG
    window.MapEntity = map.MapEntity;
    elProfile = settings.profileOverlay && createElevationProfile({worldList});
    const urlQuery = new URLSearchParams(location.search);
    if (urlQuery.has('testing')) {
        const center = urlQuery.get('center');
        const [course, road] = urlQuery.get('testing').split(',');
        const routeId = urlQuery.get('route');
        await zwiftMap.setCourse(+course || 6);
        if (elProfile) {
            await elProfile.setCourse(+course || 6);
        }
        if (center) {
            zwiftMap.setCenter(center.split(',').map(Number));
        }
        if (routeId) {
            const route = await zwiftMap.setActiveRoute(+routeId);
            console.log({route});
            for (const [i, xx] of route.checkpoints.entries()) {
                console.log(i, xx.roadPercent.toFixed(8), xx.roadId, xx.reverse, xx.leadin, xx.forceSplit);
            }
            let start = 0;
            let end = route.curvePath.nodes.length;
            const point = zwiftMap.addPoint([0, 0], 'star');
            let hi;
            const drawRouteHighlight = () => {
                if (hi) {
                    hi.elements.forEach(x => x.remove());
                }
                const path = route.curvePath.slice(start, end);
                point.setPosition(route.curvePath.nodes[start].end);
                console.debug({start, end});
                hi = zwiftMap.addHighlightPath(path, `route-${route.id}`, {width: 0.3, color: 'yellow'});
            };
            window.addEventListener('keydown', ev => {
                if (ev.key === 'ArrowRight') {
                    end = Math.min(route.curvePath.nodes.length, end + 1);
                } else if (ev.key === 'ArrowLeft') {
                    end = Math.max(start, end - 1);
                } else if (ev.key === 'ArrowUp') {
                    start = Math.min(end, start + 1);
                } else if (ev.key === 'ArrowDown') {
                    start = Math.max(0, start - 1);
                } else {
                    return;
                }
                ev.preventDefault();
                drawRouteHighlight();
            });
            drawRouteHighlight();
        } else {
            zwiftMap.setActiveRoad(+road || 0);
        }
        if (elProfile) {
            if (routeId) {
                await elProfile.setRoute(+routeId);
            } else {
                elProfile.setRoad(+road || 0);
            }
        }
    } else {
        await initialize();
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
            inGame = performance.now() - watchdog < 10000;
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
    }
    common.settingsStore.addEventListener('changed', ev => {
        const changed = ev.data.changed;
        if (changed.has('solidBackground') || changed.has('backgroundColor')) {
            setBackground();
        } else if (changed.has('transparency')) {
            zwiftMap.setOpacity(1 - 1 / (100 / (changed.get('transparency') || 0)));
        } else if (changed.has('mapStyle')) {
            zwiftMap.setStyle(changed.get('mapStyle'));
        } else if (changed.has('tiltShift') || changed.has('tiltShiftAmount')) {
            zwiftMap.setTiltShift(settings.tiltShift && ((settings.tiltShiftAmount || 0) / 100));
        } else if (changed.has('zoomPriorityTilt')) {
            zwiftMap.setZoomPriorityTilt(changed.get('zoomPriorityTilt'));
        } else if (changed.has('sparkle')) {
            zwiftMap.setSparkle(changed.get('sparkle'));
        } else if (changed.has('quality')) {
            zwiftMap.setQuality(qualityScale(changed.get('quality')));
        } else if (changed.has('zoom')) {
            zwiftMap.setZoom(changed.get('zoom'));
        } else if (changed.has('verticalOffset')) {
            zwiftMap.setVerticalOffset(changed.get('verticalOffset') / 100);
        } else if (changed.has('fpsLimit')) {
            zwiftMap.setFPSLimit(changed.get('fpsLimit'));
        } else if (changed.has('profileHeight')) {
            if (elProfile) {
                elProfile.el.style.setProperty('--profile-height', changed.get('profileHeight') / 100);
                elProfile.chart.resize();
            }
        } else if (changed.has('profileOverlay') || changed.has('fields') ||
            changed.has('routeProfile') || changed.has('showElevationMaxLine')) {
            location.reload();
        }
    });
}


export async function settingsMain() {
    common.initInteractionListeners();
    (await common.initSettingsForm('form'))();
}


setBackground();
