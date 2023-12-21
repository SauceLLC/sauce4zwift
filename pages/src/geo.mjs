import * as common from './common.mjs';
import * as map from './map.mjs';
import * as elevation from './elevation.mjs';
import * as fields from './fields.mjs';

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
    let settingsSaveTimeout;
    zm.addEventListener('zoom', ev => {
        clearTimeout(settingsSaveTimeout);
        settings.zoom = Number(ev.zoom.toFixed(2));
        settingsSaveTimeout = setTimeout(() => common.settingsStore.set(null, settings), 100);
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
        common.subscribe('chat', chat => {
            const ent = zwiftMap.getEntity(chat.from);
            if (ent) {
                ent.addChatMessage(chat.message);
            }
        });
    }
    common.settingsStore.addEventListener('set', ev => {
        if (!ev.data.remote) {
            return;
        }
        const {key, value} = ev.data;
        if (key === 'solidBackground' || key === 'backgroundColor') {
            setBackground();
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


setBackground();
