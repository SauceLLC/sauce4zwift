export const handlers = new Map();


export function errorReply(e, extra) {
    console.warn("RPC error:", e);
    return {
        ...extra,
        success: false,
        error: {
            name: e.name,
            message: e.message,
            stack: e.stack,
        }
    };
}


export function successReply(value, extra) {
    return {
        ...extra,
        success: true,
        value
    };
}


export async function invoke() {
    try {
        return await _invoke.apply(this, arguments);
    } catch(e) {
        return errorReply(e);
    }
}


async function _invoke(name, ...args) {
    const handler = handlers.get(name);
    if (!handler) {
        throw new Error('Invalid handler name: ' + name);
    }
    const warning = handler.warning; // deprecation, etc
    if (warning) {
        console.warn(warning);
    }
    try {
        return successReply(await handler.fn.call(handler.scope || this, ...args), {warning});
    } catch(e) {
        return errorReply(e, {warning});
    }
}


export function register(fn, options={}) {
    const name = options.name || fn.name;
    if (!name) {
        throw new TypeError("Function name could not be inferred, use options.name");
    }
    let warning;
    if (options.deprecatedBy) {
        warning = `DEPRECATED RPC [${name}]: migrate to -> ${options.deprecatedBy.name}`;
    } else if (options.deprecated) {
        warning = `DEPRECATED RPC [${name}]`;
    }
    handlers.set(options.name || fn.name, {fn, warning, scope: options.scope});
}
