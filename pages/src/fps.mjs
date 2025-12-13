
const msAvgPeriod = 3000;
const seedDuration = 400;
const drawInterval = 1000;

let fpsExp, tsFirst, tsPrev, visualEl;
let tick = 0;
let calTick = 0;


export function measure() {
    const ts = performance.now();
    const ms = ts - tsPrev;
    if (fpsExp) {
        fpsExp(ms + 1);
    } else if (tsFirst) {
        const totalMs = ts - tsFirst;
        if (totalMs > seedDuration) {
            const avg = totalMs / tick;
            fpsExp = expWeightedAvg(Math.ceil(msAvgPeriod / avg), avg + 1);
            draw();
            setInterval(draw, drawInterval);
            setTimeout(calibrateLoop, 1000);
        }
    } else {
        tsFirst = ts;
        establishVisual();
    }
    tsPrev = ts;
    tick++;
}


function expWeightedAvg(size=2, seed=0) {
    const cPrev = Math.exp(-1 / size);
    const cNext = 1 - cPrev;
    let avg = seed;
    const setGet = v => avg = (avg * cPrev) + (v * cNext);
    setGet.get = () => avg;
    return setGet;
}


function calibrateLoop() {
    // Try to keep the msAvgPeriod honest by occasionally tuning its decay param
    // using the current weighted fps.
    const curAvg = fpsExp.get() - 1;
    fpsExp = expWeightedAvg(Math.ceil(msAvgPeriod / curAvg), curAvg + 1);
    setTimeout(calibrateLoop, Math.min(30_000, (500 * 1.2 ** ++calTick)));
}


function establishVisual() {
    document.body.insertAdjacentHTML('afterbegin', `<div id="measureFPS"></div>`);
    visualEl = window.measureFPS;
    visualEl.style.setProperty('position', 'fixed');
    visualEl.style.setProperty('inset', '0 0 auto auto');
    visualEl.style.setProperty('background', '#111e');
    visualEl.style.setProperty('color', '#fff');
    visualEl.style.setProperty('font-size', '14px');
    visualEl.style.setProperty('font-family', 'monospace');
    visualEl.style.setProperty('padding', '0.5em 1em');
    visualEl.style.setProperty('z-index', '1000000');
    visualEl.textContent = '- fps';
}


function draw() {
    const msPerFrame = fpsExp.get() - 1;
    visualEl.textContent = `${Math.round(1000 / msPerFrame) || '...'} fps`;
}
