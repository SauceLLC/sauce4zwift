import * as common from './common.mjs';


export async function main() {
    common.initInteractionListeners();
    document.querySelector('svg').classList.add('animate');
}
