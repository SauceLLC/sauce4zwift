import * as Common from './common.mjs';

Common.enableSentry();

export async function main() {
    Common.initInteractionListeners();
    const version = await Common.rpc.getVersion();
    setTimeout(() => {
        document.documentElement.classList.add('animate');
        setTimeout(() => document.documentElement.classList.add('fadeout'), 14000);
        document.querySelector('footer').textContent = `v${version}`;
    }, 200);
}
