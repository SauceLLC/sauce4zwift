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
        ..._options,
        {arg: 'help', type: 'switch', help: 'Show this info about args'},
    ];
    const argColWidth = 34;
    const maxWidth = 79;
    const required = new Set(options.filter(x => x.required));
    const fulfilled = new Set();
    const iter = process.argv.entries();
    const args = {};
    for (const x of options.filter(x => x.default !== undefined)) {
        args[snakeToCamelCase(x.arg)] = x.default;
    }
    for (let [i, arg] of iter) {
        if (!arg.startsWith('--')) {
            continue;
        }
        arg = arg.substr(2);
        const option = options.find(x => x.arg === arg);
        if (!option) {
            continue;
        }
        required.delete(option);
        fulfilled.add(option);
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
    const envVars = options.filter(x => x.env && !fulfilled.has(x));
    for (const option of envVars) {
        let value = process.env[option.env];
        if (!value) {
            continue;
        }
        if (option.type === 'switch') {
            value = true;
        } else if (option.type === 'num') {
            value = Number(value);
            if (Number.isNaN(value)) {
                throw new TypeError('Number argument required for env var: ' + option.env);
            }
        }
        args[snakeToCamelCase(option.arg)] = value;
        required.delete(option);
    }
    if (args.help) {
        const usage = [];
        const helps = [];
        for (const x of options) {
            let arg;
            if (x.type === 'switch') {
                arg = `--${x.arg}`;
            } else {
                const type = (x.label || x.type).toUpperCase();
                arg = `--${x.arg} ${(x.optional ? `[${type}]` : type)}`;
            }
            usage.push(x.required ? arg : `[${arg}]`);
            const help = [];
            if (x.help) {
                help.push(x.help);
            }
            if (x.env) {
                help.push(`(env variable: ${x.env})`);
            }
            if (x.required) {
                help.push('[REQUIRED]');
            } else if (x.default !== undefined) {
                help.push(`[default=${x.default}]`);
            }
            const helpText = wrapText(help.join('\n'), maxWidth - argColWidth);
            helps.push('  ' + arg.padEnd(argColWidth - 3, ' ') + ' ' + helpText[0],
                       ...helpText.slice(1).map(xx => ''.padStart(argColWidth, ' ') + xx));
        }
        console.warn(wrapText(`Usage: ${process.argv[0]} ` + usage.join(' '), maxWidth).join('\n  '));
        console.warn('\nArguments:\n' + helps.join('\n'));
    } else if (required.size) {
        console.warn(`\nMissing required arguments: ${Array.from(required).map(x => x.arg).join(', ')}`);
        return;
    }
    return args;
}
