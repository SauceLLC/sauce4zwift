import * as common from './common.mjs';
import * as sauce from '../../shared/sauce/index.mjs';

common.enableSentry();

const q = new URLSearchParams(window.location.search);
const customIdent = q.get('id');
const athleteIdent = customIdent || 'watching';
let resultsTpl;
let athleteData;
let segmentId;
let segments;

common.settingsStore.setDefault({
    solidBackground: false,
    backgroundColor: '#00ff00',
    transparency: 0,
    currentTab: 'live',
});

const settings = common.settingsStore.get();
// Migration hack...
if (settings.bgTransparency !== undefined) {
    settings.backgroundAlpha = 100 - settings.bgTransparency;
    delete settings.bgTransparency;
    common.settingsStore.set(null, settings);
}


async function setCourse(id) {
    segments = await common.rpc.getCourseSegments(id);
    segmentId = (segments && segments.length) ? segments[0].id : null;
    const segmentSelect = document.querySelector('select[name="segment"]');
    segmentSelect.replaceChildren();
    for (const x of segments) {
        segmentSelect.insertAdjacentHTML('beforeend', `
            <option value="${x.id}">${common.sanitize(x.name)}</option>
        `);
    }
    await updateTab();
}


async function updateTab() {
    const tab = settings.currentTab || 'live';
    for (const x of document.querySelectorAll(`.tabbed .tab`)) {
        x.classList.toggle('active', x.dataset.id === tab);
    }
    await updateResults();
}


async function updateResults() {
    const tab = settings.currentTab || 'live';
    const getResults = {
        'live': () => segmentId ? common.rpc.getSegmentResults(segmentId) : undefined,
        'just-me': () => athleteData ? common.rpc.getSegmentResults(segmentId, {
            athleteId: athleteData.athleteId,
            from: Date.now() - 86400000 * 90,
        }) : undefined,
    }[tab];
    const results = segmentId && (await getResults()) || [];
    document.querySelector('.tabbed > .tab.active').replaceChildren(await resultsTpl({results}));
    console.log(results);
}


export async function main() {
    common.initInteractionListeners();
    common.setBackground(settings);
    common.settingsStore.addEventListener('set', ev => {
        if (!ev.data.remote) {
            return;
        }
        common.setBackground(settings);
    });
    resultsTpl = await sauce.template.getTemplate(`templates/segment-results.html.tpl`);
    athleteData = await common.rpc.getAthleteData(athleteIdent);
    let courseId = athleteData?.courseId;
    common.subscribe(`athlete/${athleteIdent}`, ad => {
        athleteData = ad;
        if (courseId !== ad.courseId) {
            courseId = ad.courseId;
            console.debug("New course set:", courseId);
            setCourse(courseId);
        }
    });
    document.querySelector('select[name="segment"]').addEventListener('input', ev => {
        segmentId = ev.currentTarget.value;
        updateResults(courseId);
    });
    document.querySelector('.tabbed').addEventListener('tab', ev => {
        console.debug('Switch tabs:', ev.data.id);
        settings.currentTab = ev.data.id;
        common.settingsStore.set(null, settings);
        updateTab();
    });
    if (courseId) {
        setCourse(courseId); // bg okay
    }
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form')();
}


const importParams = new URL(import.meta.url).searchParams;
if (importParams.has('main')) {
    main();
} else if (importParams.has('settings')) {
    settingsMain();
}
