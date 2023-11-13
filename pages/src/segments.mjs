import * as common from './common.mjs';

common.enableSentry();
common.settingsStore.setDefault({
    url: 'https://www.google.com',
    solidBackground: false,
    backgroundColor: '#00ff00',
    transparency: 0,
});

const doc = document.documentElement;
const settings = common.settingsStore.get();


function setBackground() {
    const {solidBackground, backgroundColor} = settings;
    doc.classList.toggle('solid-background', solidBackground);
    if (solidBackground) {
        doc.style.setProperty('--background-color', backgroundColor);
    } else {
        doc.style.removeProperty('--background-color');
    }
}


function setOpacity() {
    const {transparency} = settings;
    const opacity = transparency == null ? 1 : 1 - (transparency / 100);
    doc.style.setProperty('--opacity', opacity);
}


export async function main() {
    common.initInteractionListeners();
    //const results = await common.rpc.getSegmentResults(segment.segmentId,
    //    {athleteId: athleteData.athleteId});
    //const results = await common.rpc.getSegmentResults(segment.segmentId);
    const leaders = await common.rpc.getSegmentResults(null);
    const segments = new Set(leaders.map(x => x.segmentId));
    console.log(leaders, segments);
    debugger;

    setBackground();
    setOpacity();
    common.settingsStore.addEventListener('changed', ev => {
        setBackground();
        setOpacity();
    });
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form')();
}
