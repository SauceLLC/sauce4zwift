import * as MWC from 'macos-window-control';
import Process from 'node:process';

const saucePid = Number(Process.argv.at(-1));

if (!saucePid) {
    console.error("Missing PID argument");
    Process.exit(1);
}


function pidAlive(pid) {
    try {
        Process.kill(pid, 0);
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
            const displays = MWC.getDisplays();
            for (const x of displays) {
                MWC.setZoom({scale: 1, displayId: x.id});
            }
            Process.exit(0);
        }
    }
}

main();
