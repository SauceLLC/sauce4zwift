
const msAvgPeriod = 1000;
let fpsExp, tsPrev, tsDraw, visualEl;
let tick = 0;

function expWeightedAvg(size=2, seed=0) {
    const cPrev = Math.exp(-1 / size);
    const cNext = 1 - cPrev;
    let avg = seed;
    const setGet = v => avg = (avg * cPrev) + (v * cNext);
    setGet.get = () => avg;
    return setGet;
}


export function measure() {
    const ts = performance.now();
    if (fpsExp) {
        fpsExp(ts - tsPrev + 1);
        if (!tsDraw || ts - tsDraw > 200) {
            tsDraw = ts;
            draw();
        }
    } else if (tick > 60) {
        const ms = ts - tsPrev;
        fpsExp = expWeightedAvg(Math.ceil(msAvgPeriod / ms), ms + 1);
    } else if (!visualEl) {
        establishVisual();
    }
    tsPrev = ts;
    tick++;
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

