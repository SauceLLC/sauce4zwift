import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as map from './map.mjs';
import * as elevation from './elevation.mjs';
import * as fields from './fields.mjs';

const doc = document.documentElement;
const L = sauce.locale;
let imperial = !!common.storage.get('/imperialUnits');
L.setImperial(imperial);

common.settingsStore.setDefault({
    profileOverlay: true,
    mapStyle: 'default',
    tiltShift: false,
    tiltShiftAngle: 10,
    sparkle: false,
    solidBackground: false,
    transparency: 0,
    backgroundColor: '#00ff00',
    fields: 1,
    autoHeading: true,
});

const settings = common.settingsStore.get();

let initDone;
let watchingId;
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


function createZwiftMap({worldList}) {
    const zwiftMap = new map.SauceZwiftMap({
        el: document.querySelector('.map'),
        worldList,
        zoom: settings.zoom,
        autoHeading: settings.autoHeading,
    });
    let settingsSaveTimeout;
    zwiftMap.addEventListener('zoom', ev => {
        clearTimeout(settingsSaveTimeout);
        settings.zoom = ev.zoom;
        settingsSaveTimeout = setTimeout(() => common.settingsStore.set(null, settings), 100);
    });
    const anchorResetButton = document.querySelector('.map-controls .button.reset-anchor');
    zwiftMap.addEventListener('drag', () => anchorResetButton.classList.remove('disabled'));
    anchorResetButton.addEventListener('click', ev => {
        anchorResetButton.classList.add('disabled');
        zwiftMap.setAnchorOffset(0, 0);
    });
    const headingRotateDisButton = document.querySelector('.map-controls .button.disable-heading');
    const headingRotateEnButton = document.querySelector('.map-controls .button.enable-heading');
    const autoHeadingHandler = en => {
        zwiftMap.setAutoHeading(en);
        headingRotateDisButton.classList.toggle('hidden', !en);
        headingRotateEnButton.classList.toggle('hidden', en);
        settings.autoHeading = en;
        common.settingsStore.set(null, settings);
    };
    headingRotateDisButton.classList.toggle('hidden', settings.autoHeading === false);
    headingRotateEnButton.classList.toggle('hidden', settings.autoHeading !== false);
    headingRotateDisButton.addEventListener('click', () => autoHeadingHandler(false));
    headingRotateEnButton.addEventListener('click', () => autoHeadingHandler(true));
    zwiftMap.setStyle(settings.mapStyle);
    zwiftMap.setOpacity(1 - 1 / (100 / (settings.transparency || 0)));
    zwiftMap.setTiltShift(settings.tiltShift);
    zwiftMap.setTiltShiftAngle(settings.tiltShiftAngle || 10);
    zwiftMap.setSparkle(settings.sparkle);
    return zwiftMap;
}


function createElevationProfile({worldList}) {
    return new elevation.SauceElevationProfile({
        el: document.querySelector('.elevation-profile'),
        worldList,
    });
}


function setWatching(id) {
    console.info("Now watching:", id);
    watchingId = id;
    zwiftMap.setWatching(id);
    if (elProfile) {
        elProfile.setWatching(id);
    }
}


async function initSelfAthlete() {
    const ad = await common.rpc.getAthleteData('self');
    if (!ad) {
        return false;
    }
    zwiftMap.setAthlete(ad.athleteId);
    if (elProfile) {
        elProfile.setAthlete(ad.athleteId);
    }
    if (!ad.watching) {
        const watching = await common.rpc.getAthleteData('watching');
        setWatching(watching.athleteId);
    } else {
        setWatching(ad.athleteId);
    }
    return true;
}


export async function main() {
    common.initInteractionListeners();
    const fieldsEl = document.querySelector('#content .fields');
    const fieldRenderer = new common.Renderer(fieldsEl, {fps: null});
    const mapping = [];
    const defaults = {
        f1: 'grade',
        f2: 'altitude',
    };
    for (let i = 0; i < (common.settingsStore.get('fields') || 1); i++) {
        const id = `f${i + 1}`;
        fieldsEl.insertAdjacentHTML('beforeend', `
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
    elProfile = settings.profileOverlay && createElevationProfile({worldList});
    const urlQuery = new URLSearchParams(location.search);
    if (urlQuery.has('testing')) {
        const [course, road] = urlQuery.get('testing').split(',');
        zwiftMap.setCourse(+course || 6).then(() => {
            zwiftMap.setRoad(+road || 0);
        });
        elProfile.setCourse(+course || 6).then(() => {
            elProfile.setRoad(+road || 0);
        });
        return;
    }
    common.subscribe('watching-athlete-change', async athleteId => {
        if (!initDone) {
            initDone = await initSelfAthlete();
        }
        setWatching(athleteId);
    });
    common.subscribe('states', async states => {
        if (!initDone) {
            initDone = await initSelfAthlete({zwiftMap, elProfile});
        }
        zwiftMap.renderAthleteStates(states);
        if (elProfile) {
            elProfile.renderAthleteStates(states);
        }
        const watching = states.find(x => x.athleteId === watchingId);
        if (watching) {
            fieldRenderer.setData({state: watching});
            fieldRenderer.render();
        }
    });
    initDone = await initSelfAthlete();
    if (!initDone) {
        console.info("User not active, starting demo mode...");
        zwiftMap.setCourse(6);
        if (elProfile) {
            elProfile.setCourse(6);
        }
        let i = 0;
        const updateHeading = () => {
            if (initDone) {
                zwiftMap.setHeadingOffset(0);
            } else {
                zwiftMap.setHeadingOffset(i += 5);
                setTimeout(updateHeading, 1000);
            }
        };
        updateHeading();
    }
    common.settingsStore.addEventListener('changed', async ev => {
        const changed = ev.data.changed;
        if (changed.has('solidBackground') || changed.has('backgroundColor')) {
            setBackground();
        } else if (changed.has('transparency')) {
            zwiftMap.setOpacity(1 - 1 / (100 / changed.get('transparency')));
        } else if (changed.has('mapStyle')) {
            zwiftMap.setStyle(changed.get('mapStyle'));
        } else if (changed.has('tiltShift')) {
            zwiftMap.setTiltShift(changed.get('tiltShift'));
        } else if (changed.has('tiltShiftAngle')) {
            zwiftMap.setTiltShiftAngle(changed.get('tiltShiftAngle'));
        } else if (changed.has('sparkle')) {
            zwiftMap.setSparkle(changed.get('sparkle'));
        } else if (changed.has('profileOverlay') || changed.has('fields')) {
            location.reload();
        }
    });
}


export async function settingsMain() {
    common.initInteractionListeners();
    (await common.initSettingsForm('form'))();
}


setBackground();
