import * as Common from './common.mjs';
import * as Sauce from '../../shared/sauce/index.mjs';
import * as Fields from './fields.mjs';

Common.enableSentry();

let resultsTpl;
let athleteData;
let segmentId;
let segmentResultId;
let segments;
let lastRefId;
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
    segmentId = segmentResultId = null;
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


async function updateResults(id=segmentId) {
    const autoOption = document.querySelector('select[name="segment"] option[value="auto"]');
    const segmentChanged = id !== segmentId;
    segmentId = id;
    if (autoMode && id) {
        const segment = await Common.getSegment(id);
        if (id !== segmentId) {
            return;  // invalidated
        }
        Common.softTextContent(autoOption, `Auto - ${segment.name}`);
    } else {
        Common.softTextContent(autoOption, 'Auto');
    }
    const tab = settings.currentTab || 'live';
    let results;
    if (id) {
        if (tab === 'live') {
            results = await Common.rpc.getSegmentResults(id);
        } else if (tab === 'just-me') {
            if (athleteData) {
                results = await Common.rpc.getSegmentResults(id, {
                    athleteId: athleteData.athleteId,
                    from: await Common.getRealTime() - 86400000 * 90,
                });
            }
        } else {
            throw new TypeError('invalid tab id');
        }
    }
    if (!results || id !== segmentId || tab !== settings.currentTab) {
        return;  // error or invalidated
    }
    let ourMostRecent;
    if (tab !== 'just-me') {
        for (const x of results) {
            if (x.athleteId === athleteData.athleteId) {
                x.self = true;
                if (!ourMostRecent || ourMostRecent.ts < x.ts) {
                    ourMostRecent = x;
                }
            }
        }
    }
    if (ourMostRecent) {
        ourMostRecent.mostRecent = true;
    }
    await Common.renderSurgicalTemplate(`.tabbed > .tab[data-id="${tab}"]`, resultsTpl, {results});
    if (segmentChanged || (ourMostRecent && ourMostRecent.id !== segmentResultId)) {
        segmentResultId = ourMostRecent?.id;
        const r = document.querySelector(ourMostRecent ?
            `.tab.active .result:has([data-result-id="${ourMostRecent.id}"])` :
            `.tab.active .result`);
        if (r) {
            // .result is `display: contents` so grab a visible element for scrolling
            r.querySelector('.place').scrollIntoView({behavior: 'smooth', block: 'center'});
        }
    }
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
    const fieldRenderer = new Fields.Renderer(document.querySelector('#content .field-holder'),
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
    resultsTpl = await Sauce.template.getTemplate(`templates/segment-results.html.tpl`);
    athleteData = await Common.rpc.getAthleteData('self');
    let courseId = athleteData?.courseId;
    Common.subscribe('athlete/self', async ad => {
        athleteData = ad;
        const state = ad.state;
        fieldRenderer.setData(ad);
        fieldRenderer.render();
        if (courseId !== ad.courseId) {
            courseId = ad.courseId;
            console.debug("New course set:", courseId);
            await setCourse(courseId);
            return;
        }
        if (autoMode) {
            const id = segmentField.activeSegment?.id || null;
            if (id !== segmentId) {
                await updateResults(id);
            }
        }
        Common.softTextContent(segmentTypeEl, {
            pending: 'Upcoming:',
            active: 'Active:',
            done: 'Finished:',
        }[segmentField.activeSegment?.type] || '');
        fieldHolderEl.classList.toggle('available', !!segmentField.activeSegment?.type);
        let routeId;
        if (state.eventSubgroupId) {
            const sg = await Common.getEventSubgroup(state.eventSubgroupId);
            if (sg && sg.routeId) {
                routeId = sg.routeId;
            }
        }
        routeId ||= state.routeId;
        const refId = routeId ? `rt-${routeId}` : `rd-${state.courseId}-${state.roadId}-${state.reverse}`;
        if (refId !== lastRefId) {
            lastRefId = refId;
            let segments;
            if (routeId) {
                const route = await Common.getRoute(routeId);
                segments = await Common.getSegments(route.segments.map(x => x.id));
            } else {
                const road = await Common.getRoad(state.courseId, state.roadId);
                segments = await Common.getSegments(road.segments
                    .filter(x => !!x.reverse === !!state.reverse)
                    .map(x => x.id));
            }
            if (lastRefId === refId) {
                Common.softInnerHTML(document.querySelector('#nearbySelectOptions'), segments
                    .map(x => `<option value="${x.id}">${Common.sanitize(x.name)}</option>`)
                    .join('\n'));
            }
        }
    });
    document.querySelector('select[name="segment"]').addEventListener('input', ev => {
        let id = ev.currentTarget.value;
        if (id === 'auto') {
            autoMode = true;
            id = segmentField.activeSegment?.id;
        } else {
            autoMode = false;
        }
        updateResults(id);
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
