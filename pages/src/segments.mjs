import * as Common from './common.mjs';
import * as Sauce from '../../shared/sauce/index.mjs';
import * as Fields from './fields.mjs';

Common.enableSentry();

const q = new URLSearchParams(window.location.search);
const customIdent = q.get('id');
const athleteIdent = customIdent || 'watching';
let resultsTpl;
let athleteData;
let segmentId;
let segments;
let lastRouteId;
let autoMode = true;

Common.settingsStore.setDefault({
    solidBackground: false,
    backgroundColor: '#00ff00',
    transparency: 0,
    currentTab: 'live',
});

const settings = Common.settingsStore.get();
// Migration hack...
if (settings.bgTransparency !== undefined) {
    settings.backgroundAlpha = 100 - settings.bgTransparency;
    delete settings.bgTransparency;
    Common.settingsStore.set(null, settings);
}


async function setCourse(id) {
    segments = await Common.rpc.getCourseSegments(id);
    segments.sort((a, b) => a.name < b.name ? -1 : 1);
    segmentId = null;
    const courseOpts = document.querySelector('#courseSelectOptions');
    courseOpts.replaceChildren();
    for (const x of segments) {
        courseOpts.insertAdjacentHTML('beforeend',
                                      `<option value="${x.id}">${Common.sanitize(x.name)}</option>`);
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
    const autoOption = document.querySelector('select[name="segment"] option[value="auto"]');
    if (autoMode && segmentId) {
        const segment = await Common.getSegment(segmentId);
        Common.softTextContent(autoOption, `Auto - ${segment.name}`);
    } else {
        Common.softTextContent(autoOption, 'Auto');
    }
    const tab = settings.currentTab || 'live';
    const getResults = {
        'live': () => segmentId ? Common.rpc.getSegmentResults(segmentId) : undefined,
        'just-me': () => athleteData ? Common.rpc.getSegmentResults(segmentId, {
            athleteId: athleteData.athleteId,
            from: Date.now() - 86400000 * 90,
        }) : undefined,
    }[tab];
    const results = segmentId && (await getResults()) || [];
    document.querySelector('.tabbed > .tab.active').replaceChildren(await resultsTpl({results}));
    console.log(results);
}


export async function main() {
    Common.initInteractionListeners();
    Common.setBackground(settings);
    Common.settingsStore.addEventListener('set', ev => {
        if (!ev.data.remote) {
            return;
        }
        Common.setBackground(settings);
    });
    const fieldRenderer = new Common.Renderer(document.querySelector('#content .field-holder'),
                                              {locked: true});
    const segmentField = new Fields.SegmentField();
    fieldRenderer.addRotatingFields({
        mapping: [{id: 'segment-field-top', default: 'segment-auto'}],
        fields: [segmentField],
    });
    fieldRenderer.setData({});
    fieldRenderer.render();
    const fieldHolderEl = document.querySelector('.field-holder');
    const segmentTypeEl = fieldHolderEl.querySelector('.segment-type');
    Common.subscribe('athlete/self', async ad => {
        fieldRenderer.setData(ad);
        fieldRenderer.render();
        if (autoMode) {
            const id = segmentField.activeSegment?.id;
            if (id !== segmentId) {
                segmentId = id;
                updateResults();
            }
        }
        Common.softTextContent(segmentTypeEl, {
            pending: 'Upcoming:',
            active: 'Active:',
            done: 'Finished:',
        }[segmentField.activeSegment?.type] || '');
        fieldHolderEl.classList.toggle('available', !!segmentField.activeSegment?.type);
        let routeId;
        if (ad.state.eventSubgroupId) {
            const sg = await Common.getEventSubgroup(ad.state.eventSubgroupId);
            if (sg && sg.routeId) {
                routeId = sg.routeId;
            }
        }
        routeId ||= ad.state.routeId;
        if (routeId !== lastRouteId) {
            lastRouteId = routeId;
            const rtOpts = document.querySelector('#routeSelectOptions');
            if (routeId) {
                const route = await Common.getRoute(routeId);
                const segments = await Common.getSegments(route.segments.map(x => x.id));
                Common.softInnerHTML(rtOpts, segments
                    .map(x => `<option value="${x.id}">${Common.sanitize(x.name)}</option>`)
                    .join('\n'));
            } else {
                rtOpts.replaceChildren();
            }
        }
    });
    resultsTpl = await Sauce.template.getTemplate(`templates/segment-results.html.tpl`);
    athleteData = await Common.rpc.getAthleteData(athleteIdent);
    let courseId = athleteData?.courseId;
    Common.subscribe(`athlete/${athleteIdent}`, ad => {
        athleteData = ad;
        if (courseId !== ad.courseId) {
            courseId = ad.courseId;
            console.debug("New course set:", courseId);
            setCourse(courseId);
        }
    });
    document.querySelector('select[name="segment"]').addEventListener('input', ev => {
        const id = ev.currentTarget.value;
        if (id === 'auto') {
            autoMode = true;
            segmentId = segmentField.activeSegment?.id;
        } else {
            autoMode = false;
            segmentId = id;
        }
        updateResults();
    });
    document.querySelector('.tabbed').addEventListener('tab', ev => {
        console.debug('Switch tabs:', ev.data.id);
        settings.currentTab = ev.data.id;
        Common.settingsStore.set(null, settings);
        updateTab();
    });
    if (courseId) {
        setCourse(courseId); // bg okay
    }
    setInterval(() => updateResults(), 10_000);
}


export async function settingsMain() {
    Common.initInteractionListeners();
    await Common.initSettingsForm('form')();
}


const importParams = new URL(import.meta.url).searchParams;
if (importParams.has('main')) {
    main();
} else if (importParams.has('settings')) {
    settingsMain();
}
