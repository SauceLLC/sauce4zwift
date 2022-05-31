import * as common from './common.mjs';


export async function main() {
    common.initInteractionListeners();
    const svg = document.querySelector('svg');
    svg.offsetWidth;
    svg.classList.add('animate');
    setTimeout(() => svg.classList.add('fadeout'), 8000);
}
