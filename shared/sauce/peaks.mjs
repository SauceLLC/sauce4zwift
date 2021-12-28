/* global sauce */
delete me

import sauce from './sauce.mjs';

const metersPerMile = 1609.344;
const defaults = {
    periods: [
        {value: 5},
        {value: 15},
        {value: 30},
        {value: 60},
        {value: 120},
        {value: 300},
        {value: 600},
        {value: 1200},
        {value: 1800},
        {value: 3600},
        {value: 10800},
    ],
    distances: [
        {value: 400},
        {value: 1000},
        {value: Math.round(metersPerMile)},
        {value: 3000},
        {value: 5000},
        {value: 10000},
        {value: Math.round(metersPerMile * 13.1), types: ['run', 'walk', 'hike']},
        {value: Math.round(metersPerMile * 26.2), types: ['run', 'walk', 'hike']},
        {value: 50000},
        {value: 100000},
        {value: Math.round(metersPerMile * 100)},
    ]
};


async function getRanges(type) {
    const custom = await sauce.storage.get('analysis_peak_ranges');
    return custom && custom[type] || defaults[type];
}


async function setRanges(type, data) {
    await sauce.storage.update('analysis_peak_ranges', {[type]: data});
}


async function resetRanges(type) {
    await sauce.storage.update('analysis_peak_ranges', {[type]: null});
}


async function getForActivityType(type, activityType) {
    const data = await getRanges(type);
    const t = activityType.toLowerCase();
    return data.filter(x => !x.types || x.types.includes(t));
}


async function isCustom(type) {
    return await getRanges(type) === defaults[type];
}

export defaults {
    defaults,
    getForActivityType,
    getRanges,
    setRanges,
    resetRanges,
    isCustom,
};
