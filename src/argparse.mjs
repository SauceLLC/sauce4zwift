import process from 'node:process';


function snakeToCamelCase(v) {
    return v.split(/[_-]/).map((x, i) =>
        i ? x[0].toUpperCase() + x.substr(1) : x).join('');
}


function wrapText(text, width) {
    const words = text.split(/(\s)/);
    const lines = [];
    let line = '';
    while (words.length) {
        const word = words.shift();
        const split = words.shift();
        if (line && line.length + word.length > width) {
            lines.push(line);
            line = '';
        }
        line = line ? `${line} ${word}` : word;
        if (split === '\n') {
            lines.push(line);
            line = '';
        }
    }
    if (line != null) {
        lines.push(line);
    }
    return lines;
}


export function parseArgs(_options) {
    const options = [
        {arg: 'help', type: 'switch', help: 'Show this info about args'},
        ..._options
    ];
    const iter = process.argv.entries();
    const args = {};
    for (let [i, arg] of iter) {
        if (!arg.startsWith('--')) {
            continue;
        }
        arg = arg.substr(2);
        const option = options.find(x => x.arg === arg);
        if (!option) {
            continue;
        }
        if (option.type === 'switch') {
            args[snakeToCamelCase(arg)] = true;
        } else {
            let value = process.argv[i + 1];
            if (value === undefined || value.startsWith('--')) {
                if (option.optional) {
                    value = true;
                } else {
                    throw new TypeError('Missing value for option: ' + arg);
                }
            } else {
                iter.next();
                if (option.type === 'num') {
                    value = Number(value);
                    if (Number.isNaN(value)) {
                        throw new TypeError('Number argument required for option: ' + arg);
                    }
                }
            }
            args[snakeToCamelCase(arg)] = value;
        }
    }
    if (args.help) {
        const usage = [];
        const helps = [];
        const argColWidth = 29;
        const maxWidth = 79;
        for (const x of options) {
            let arg;
            if (x.type === 'switch') {
                arg = `--${x.arg}`;
            } else {
                const type = (x.label || x.type).toUpperCase();
                arg = `--${x.arg} ${(x.optional ? `[${type}]` : type)}`;
            }
            usage.push(`[${arg}]`);
            const help = wrapText(x.help || '', maxWidth - argColWidth);
            helps.push('  ' + arg.padEnd(argColWidth - 3, ' ') + ' ' + help[0],
                       ...help.slice(1).map(xx => ''.padStart(argColWidth, ' ') + xx));
        }
        console.warn(wrapText(`Usage: ${process.argv[0]} ` + usage.join(' '), maxWidth).join('\n  '));
        console.warn('\nArguments:\n' + helps.join('\n'));
    }
    return args;
}
