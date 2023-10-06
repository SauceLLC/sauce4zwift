import * as common from './common.mjs';

common.enableSentry();

export async function main() {
    common.initInteractionListeners();
    const version = await common.rpc.getVersion();
    setTimeout(() => {
        document.documentElement.classList.add('animate');
        setTimeout(() => document.documentElement.classList.add('fadeout'), 14000);
        document.querySelector('footer').textContent = `v${version}`;
    }, 200);
}
