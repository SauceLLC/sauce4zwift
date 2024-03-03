const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const process = require('node:process');
const path = require('node:path');

const logFileName = 'sauce.log';
const levels = {
    debug: 'debug',
    info: 'info',
    log: 'info',
    count: 'info',
    dir: 'info',
    warn: 'warn',
    assert: 'warn',
    error: 'error',
    trace: 'error',
};
const consoleDescriptors = Object.getOwnPropertyDescriptors(console);
const ansiEscRegex = new RegExp(`\x1b(?:[@-Z\\-_]|[[0-?]*[ -/]*[@-~])`, 'g');


function fmtLogDate(d) {
    const h = d.getHours().toString();
    const m = d.getMinutes().toString().padStart(2, '0');
    const s = d.getSeconds().toString().padStart(2, '0');
    const ms = d.getMilliseconds().toString().padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
}


function rotateLogFiles(logsPath, limit=5) {
    const logs = fs.readdirSync(logsPath).filter(x => x.startsWith(logFileName));
    logs.sort((a, b) => a < b ? 1 : -1);
    while (logs.length > limit) {
        // NOTE: this is only for if we change the limit to a lower number
        // in a subsequent release.
        const fName = logs.shift();
        console.warn("Delete old log file:", fName);
        fs.unlinkSync(path.join(logsPath, fName));
    }
    let end = Math.min(logs.length, limit - 1);
    for (const fName of logs.slice(-(limit - 1))) {
        const newFName = `${logFileName}.${end--}`;
        if (newFName === fName) {
            continue;
        }
        fs.renameSync(path.join(logsPath, fName), path.join(logsPath, newFName));
    }
}


function getConsoleSymbol(name) {
    /*
     * The symbols of functions in the console module are somehow not in the
     * global registry.  So we need to use this hack to get the real symbols
     * for monkey patching.
     */
    const symString = Symbol.for(name).toString();
    return Object.getOwnPropertySymbols(console).filter(x =>
        x.toString() === symString)[0];
}


function getCurStackFrameFile() {
    const o = {};
    const saveTraceLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = 4;
    Error.captureStackTrace(o);
    Error.stackTraceLimit = saveTraceLimit;
    const stack = o.stack;
    const fileMatch = stack.match(/([^/\\: (]+:[0-9]+):[0-9]+\)?$/);
    return fileMatch ? fileMatch[1] : null;
}



function ansiColorize(text, color, options={}) {
    const esc = '\x1b[';
    const params = [];
    if (color) {
        // NOTE: Mostly using the "bright" colors...
        params.push({
            black: 30,
            red: 91,
            green: 92,
            yellow: 93,
            blue: 94,
            magenta: 95,
            cyan: 96,
            white: 97,
        }[color] || color);
    }
    if (options.bold) {
        params.push('1');
    }
    if (options.faint) {
        params.push('2');
    }
    if (options.italic) {
        params.push('3');
    }
    if (options.underline) {
        params.push('4');
    }
    return `${esc}${params.join(';')}m${text}${esc}0m`;
}


function metaPrefix({date, level, file}) {
    let color;
    const style = {};
    if (level === 'debug') {
        style.faint = true;
    } else if (level === 'warn') {
        style.faint = true;
        color = 'yellow';
    } else if (level === 'error') {
        color = 'red';
        style.bold = true;
    }
    const prettyTime = ansiColorize(fmtLogDate(date), null, style);
    const prettyLevel = ansiColorize(level.toUpperCase(), color, style);
    const prettyFile = ansiColorize(file, null, style);
    return `${prettyTime} [${prettyLevel}] (${prettyFile})`;
}


function monkeyPatchConsoleWithEmitter() {
    /*
     * This is highly Node specific but it maintains console logging,
     * devtools logging with correct file:lineno references, and allows
     * us to support file logging and logging windows.
     */
    let curLogLevel;
    for (const [fn, level] of Object.entries(levels)) {
        Object.defineProperty(console, fn, {
            enumerable: consoleDescriptors[fn].enumerable,
            get: () => (curLogLevel = level, consoleDescriptors[fn].value),
            set: () => {
                throw new Error("Double console monkey patch detected!");
            },
        });
    }
    const kWriteToConsoleSymbol = getConsoleSymbol('kWriteToConsole');
    const kWriteToConsoleFunction = console[kWriteToConsoleSymbol];
    const emitter = new EventEmitter();
    let seqno = 1;
    console[kWriteToConsoleSymbol] = function(useStdErr, message) {
        const date = new Date();
        try {
            const prefix = metaPrefix({date, level: curLogLevel, file: getCurStackFrameFile()});
            return kWriteToConsoleFunction.call(this, useStdErr, `${prefix}: ${message}`);
        } finally {
            emitter.emit('message', {
                seqno: seqno++,
                date,
                level: curLogLevel,
                message: message.replace(ansiEscRegex, ''),
                file: getCurStackFrameFile(),
            });
        }
    };
    return emitter;
}


function initFileLogging(logsPath, isDev) {
    let rotateErr;
    try {
        rotateLogFiles(logsPath);
    } catch(e) {
        // Probably windows with anti virus. :/
        rotateErr = e;
    }
    const logEmitter = monkeyPatchConsoleWithEmitter();
    const logFile = path.join(logsPath, logFileName);
    const logQueue = [];
    const logFileStream = fs.createWriteStream(logFile);
    logEmitter.on('message', o => {
        logQueue.push(o);
        const time = fmtLogDate(o.date);
        const level = `[${o.level.toUpperCase()}]`;
        logFileStream.write(`${time} ${level} (${o.file}): ${o.message}\n`);
        while (logQueue.length > 2000) {
            logQueue.shift();
        }
    });
    if (rotateErr) {
        console.error('Log rotate error:', rotateErr);
    }
    console.info("Sauce log file:", logFile);
    return {logEmitter, logQueue, logFile};
}


function initTTYLogging(logsPath, isDev) {
    const logEmitter = monkeyPatchConsoleWithEmitter();
    const logQueue = [];
    logEmitter.on('message', o => {
        logQueue.push(o);
        while (logQueue.length > 2000) {
            logQueue.shift();
        }
    });
    return {logEmitter, logQueue};
}


module.exports = {
    initFileLogging,
    initTTYLogging,
};
