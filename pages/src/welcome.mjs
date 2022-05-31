import * as common from './common.mjs';


export async function main() {
    common.initInteractionListeners();
    document.documentElement.classList.add('animate');
    setTimeout(() => document.documentElement.classList.add('fadeout'), 8000);
    const version = await common.rpc.getVersion();
    document.querySelector('footer').textContent = `v${version}`;
}
