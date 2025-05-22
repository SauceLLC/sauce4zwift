import * as mwc from 'macos-window-control';
import process from 'node:process';

const saucePid = Number(process.argv.at(-1));

if (!saucePid) {
    console.error("Missing PID argument");
    process.exit(1);
}


function pidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch(e) {
        return false;
    }
}


async function main() {
    while (true) {
        await new Promise(r => setTimeout(r, 400));
        if (!pidAlive(saucePid)) {
            console.info("Sauce not running, unzooming...");
            const displays = mwc.getDisplays();
            for (const x of displays) {
                mwc.setZoom({scale: 1, displayId: x.id});
            }
            process.exit(0);
        }
    }
}

main();
