globalThis.Sentry = function(exports) {
	exports.Severity = void 0;
	(function(Severity) {
		Severity["Fatal"] = "fatal";
		Severity["Error"] = "error";
		Severity["Warning"] = "warning";
		Severity["Log"] = "log";
		Severity["Info"] = "info";
		Severity["Debug"] = "debug";
		Severity["Critical"] = "critical";
	})(exports.Severity || (exports.Severity = {}));
	function forget(promise) {
		void promise.then(null, (e => {
			console.error(e);
		}));
	}
	function isDebugBuild() {
		return typeof __SENTRY_NO_DEBUG__ !== 'undefined' && !true;
	}
	const fallbackGlobalObject = {};
	function getGlobalObject() {
		return typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : fallbackGlobalObject;
	}
	const objectToString = Object.prototype.toString;
	function isError(wat) {
		switch (objectToString.call(wat)) {
		case '[object Error]':
		case '[object Exception]':
		case '[object DOMException]':
			return true;

		default:
			return isInstanceOf(wat, Error);
		}
	}
	function isBuiltin(wat, ty) {
		return objectToString.call(wat) === `[object ${ty}]`;
	}
	function isErrorEvent(wat) {
		return isBuiltin(wat, 'ErrorEvent');
	}
	function isDOMError(wat) {
		return isBuiltin(wat, 'DOMError');
	}
	function isDOMException(wat) {
		return isBuiltin(wat, 'DOMException');
	}
	function isString(wat) {
		return isBuiltin(wat, 'String');
	}
	function isPrimitive(wat) {
		return wat === null || typeof wat !== 'object' && typeof wat !== 'function';
	}
	function isPlainObject(wat) {
		return isBuiltin(wat, 'Object');
	}
	function isEvent(wat) {
		return typeof Event !== 'undefined' && isInstanceOf(wat, Event);
	}
	function isElement(wat) {
		return typeof Element !== 'undefined' && isInstanceOf(wat, Element);
	}
	function isRegExp(wat) {
		return isBuiltin(wat, 'RegExp');
	}
	function isThenable(wat) {
		return Boolean(wat && wat.then && typeof wat.then === 'function');
	}
	function isSyntheticEvent(wat) {
		return isPlainObject(wat) && 'nativeEvent' in wat && 'preventDefault' in wat && 'stopPropagation' in wat;
	}
	function isInstanceOf(wat, base) {
		try {
			return wat instanceof base;
		} catch (_e) {
			return false;
		}
	}
	function htmlTreeAsString(elem, keyAttrs) {
		try {
			let currentElem = elem;
			const MAX_TRAVERSE_HEIGHT = 5;
			const MAX_OUTPUT_LEN = 80;
			const out = [];
			let height = 0;
			let len = 0;
			const separator = ' > ';
			const sepLength = separator.length;
			let nextStr;
			while (currentElem && height++ < MAX_TRAVERSE_HEIGHT) {
				nextStr = _htmlElementAsString(currentElem, keyAttrs);
				if (nextStr === 'html' || height > 1 && len + out.length * sepLength + nextStr.length >= MAX_OUTPUT_LEN) {
					break;
				}
				out.push(nextStr);
				len += nextStr.length;
				currentElem = currentElem.parentNode;
			}
			return out.reverse().join(separator);
		} catch (_oO) {
			return '<unknown>';
		}
	}
	function _htmlElementAsString(el, keyAttrs) {
		const elem = el;
		const out = [];
		let className;
		let classes;
		let key;
		let attr;
		let i;
		if (!elem || !elem.tagName) {
			return '';
		}
		out.push(elem.tagName.toLowerCase());
		const keyAttrPairs = keyAttrs && keyAttrs.length ? keyAttrs.filter((keyAttr => elem.getAttribute(keyAttr))).map((keyAttr => [ keyAttr, elem.getAttribute(keyAttr) ])) : null;
		if (keyAttrPairs && keyAttrPairs.length) {
			keyAttrPairs.forEach((keyAttrPair => {
				out.push(`[${keyAttrPair[0]}="${keyAttrPair[1]}"]`);
			}));
		} else {
			if (elem.id) {
				out.push(`#${elem.id}`);
			}
			className = elem.className;
			if (className && isString(className)) {
				classes = className.split(/\s+/);
				for (i = 0; i < classes.length; i++) {
					out.push(`.${classes[i]}`);
				}
			}
		}
		const allowedAttrs = [ 'type', 'name', 'title', 'alt' ];
		for (i = 0; i < allowedAttrs.length; i++) {
			key = allowedAttrs[i];
			attr = elem.getAttribute(key);
			if (attr) {
				out.push(`[${key}="${attr}"]`);
			}
		}
		return out.join('');
	}
	function getLocationHref() {
		const global = getGlobalObject();
		try {
			return global.document.location.href;
		} catch (oO) {
			return '';
		}
	}
	const setPrototypeOf = Object.setPrototypeOf || ({
		__proto__: []
	} instanceof Array ? setProtoOf : mixinProperties);
	function setProtoOf(obj, proto) {
		obj.__proto__ = proto;
		return obj;
	}
	function mixinProperties(obj, proto) {
		for (const prop in proto) {
			if (!Object.prototype.hasOwnProperty.call(obj, prop)) {
				obj[prop] = proto[prop];
			}
		}
		return obj;
	}
	class SentryError extends Error {
		constructor(message) {
			super(message);
			this.message = message;
			this.name = new.target.prototype.constructor.name;
			setPrototypeOf(this, new.target.prototype);
		}
	}
	const DSN_REGEX = /^(?:(\w+):)\/\/(?:(\w+)(?::(\w+))?@)([\w.-]+)(?::(\d+))?\/(.+)/;
	function isValidProtocol(protocol) {
		return protocol === 'http' || protocol === 'https';
	}
	function dsnToString(dsn, withPassword = false) {
		const {host, path, pass, port, projectId, protocol, publicKey} = dsn;
		return `${protocol}://${publicKey}${withPassword && pass ? `:${pass}` : ''}` + `@${host}${port ? `:${port}` : ''}/${path ? `${path}/` : path}${projectId}`;
	}
	function dsnFromString(str) {
		const match = DSN_REGEX.exec(str);
		if (!match) {
			throw new SentryError(`Invalid Sentry Dsn: ${str}`);
		}
		const [protocol, publicKey, pass = '', host, port = '', lastPath] = match.slice(1);
		let path = '';
		let projectId = lastPath;
		const split = projectId.split('/');
		if (split.length > 1) {
			path = split.slice(0, -1).join('/');
			projectId = split.pop();
		}
		if (projectId) {
			const projectMatch = projectId.match(/^\d+/);
			if (projectMatch) {
				projectId = projectMatch[0];
			}
		}
		return dsnFromComponents({
			host,
			pass,
			path,
			projectId,
			port,
			protocol,
			publicKey
		});
	}
	function dsnFromComponents(components) {
		if ('user' in components && !('publicKey' in components)) {
			components.publicKey = components.user;
		}
		return {
			user: components.publicKey || '',
			protocol: components.protocol,
			publicKey: components.publicKey || '',
			pass: components.pass || '',
			host: components.host,
			port: components.port || '',
			path: components.path || '',
			projectId: components.projectId
		};
	}
	function validateDsn(dsn) {
		if (!isDebugBuild()) {
			return;
		}
		const {port, projectId, protocol} = dsn;
		const requiredComponents = [ 'protocol', 'publicKey', 'host', 'projectId' ];
		requiredComponents.forEach((component => {
			if (!dsn[component]) {
				throw new SentryError(`Invalid Sentry Dsn: ${component} missing`);
			}
		}));
		if (!projectId.match(/^\d+$/)) {
			throw new SentryError(`Invalid Sentry Dsn: Invalid projectId ${projectId}`);
		}
		if (!isValidProtocol(protocol)) {
			throw new SentryError(`Invalid Sentry Dsn: Invalid protocol ${protocol}`);
		}
		if (port && isNaN(parseInt(port, 10))) {
			throw new SentryError(`Invalid Sentry Dsn: Invalid port ${port}`);
		}
		return true;
	}
	function makeDsn(from) {
		const components = typeof from === 'string' ? dsnFromString(from) : dsnFromComponents(from);
		validateDsn(components);
		return components;
	}
	const SeverityLevels = [ 'fatal', 'error', 'warning', 'log', 'info', 'debug', 'critical' ];
	const global$6 = getGlobalObject();
	const PREFIX = 'Sentry Logger ';
	function consoleSandbox(callback) {
		const global = getGlobalObject();
		const levels = [ 'debug', 'info', 'warn', 'error', 'log', 'assert' ];
		if (!('console' in global)) {
			return callback();
		}
		const originalConsole = global.console;
		const wrappedLevels = {};
		levels.forEach((level => {
			if (level in global.console && originalConsole[level].__sentry_original__) {
				wrappedLevels[level] = originalConsole[level];
				originalConsole[level] = originalConsole[level].__sentry_original__;
			}
		}));
		const result = callback();
		Object.keys(wrappedLevels).forEach((level => {
			originalConsole[level] = wrappedLevels[level];
		}));
		return result;
	}
	class Logger {
		constructor() {
			this._enabled = false;
		}
		disable() {
			this._enabled = false;
		}
		enable() {
			this._enabled = true;
		}
		log(...args) {
			if (!this._enabled) {
				return;
			}
			consoleSandbox((() => {
				global$6.console.log(`${PREFIX}[Log]:`, ...args);
			}));
		}
		warn(...args) {
			if (!this._enabled) {
				return;
			}
			consoleSandbox((() => {
				global$6.console.warn(`${PREFIX}[Warn]:`, ...args);
			}));
		}
		error(...args) {
			if (!this._enabled) {
				return;
			}
			consoleSandbox((() => {
				global$6.console.error(`${PREFIX}[Error]:`, ...args);
			}));
		}
	}
	global$6.__SENTRY__ = global$6.__SENTRY__ || {};
	const logger = global$6.__SENTRY__.logger || (global$6.__SENTRY__.logger = new Logger);
	function memoBuilder() {
		const hasWeakSet = typeof WeakSet === 'function';
		const inner = hasWeakSet ? new WeakSet : [];
		function memoize(obj) {
			if (hasWeakSet) {
				if (inner.has(obj)) {
					return true;
				}
				inner.add(obj);
				return false;
			}
			for (let i = 0; i < inner.length; i++) {
				const value = inner[i];
				if (value === obj) {
					return true;
				}
			}
			inner.push(obj);
			return false;
		}
		function unmemoize(obj) {
			if (hasWeakSet) {
				inner.delete(obj);
			} else {
				for (let i = 0; i < inner.length; i++) {
					if (inner[i] === obj) {
						inner.splice(i, 1);
						break;
					}
				}
			}
		}
		return [ memoize, unmemoize ];
	}
	const STACKTRACE_LIMIT = 50;
	function createStackParser(...parsers) {
		const sortedParsers = parsers.sort(((a, b) => a[0] - b[0])).map((p => p[1]));
		return (stack, skipFirst = 0) => {
			const frames = [];
			for (const line of stack.split('\n').slice(skipFirst)) {
				for (const parser of sortedParsers) {
					const frame = parser(line);
					if (frame) {
						frames.push(frame);
						break;
					}
				}
			}
			return stripSentryFramesAndReverse(frames);
		};
	}
	function stripSentryFramesAndReverse(stack) {
		if (!stack.length) {
			return [];
		}
		let localStack = stack;
		const firstFrameFunction = localStack[0].function || '';
		const lastFrameFunction = localStack[localStack.length - 1].function || '';
		if (firstFrameFunction.indexOf('captureMessage') !== -1 || firstFrameFunction.indexOf('captureException') !== -1) {
			localStack = localStack.slice(1);
		}
		if (lastFrameFunction.indexOf('sentryWrapped') !== -1) {
			localStack = localStack.slice(0, -1);
		}
		return localStack.slice(0, STACKTRACE_LIMIT).map((frame => Object.assign(Object.assign({}, frame), {
			filename: frame.filename || localStack[0].filename,
			function: frame.function || '?'
		}))).reverse();
	}
	const defaultFunctionName = '<anonymous>';
	function getFunctionName(fn) {
		try {
			if (!fn || typeof fn !== 'function') {
				return defaultFunctionName;
			}
			return fn.name || defaultFunctionName;
		} catch (e) {
			return defaultFunctionName;
		}
	}
	function truncate(str, max = 0) {
		if (typeof str !== 'string' || max === 0) {
			return str;
		}
		return str.length <= max ? str : `${str.substr(0, max)}...`;
	}
	function safeJoin(input, delimiter) {
		if (!Array.isArray(input)) {
			return '';
		}
		const output = [];
		for (let i = 0; i < input.length; i++) {
			const value = input[i];
			try {
				output.push(String(value));
			} catch (e) {
				output.push('[value cannot be serialized]');
			}
		}
		return output.join(delimiter);
	}
	function isMatchingPattern(value, pattern) {
		if (!isString(value)) {
			return false;
		}
		if (isRegExp(pattern)) {
			return pattern.test(value);
		}
		if (typeof pattern === 'string') {
			return value.indexOf(pattern) !== -1;
		}
		return false;
	}
	function fill(source, name, replacementFactory) {
		if (!(name in source)) {
			return;
		}
		const original = source[name];
		const wrapped = replacementFactory(original);
		if (typeof wrapped === 'function') {
			try {
				markFunctionWrapped(wrapped, original);
			} catch (_Oo) {}
		}
		source[name] = wrapped;
	}
	function addNonEnumerableProperty(obj, name, value) {
		Object.defineProperty(obj, name, {
			value,
			writable: true,
			configurable: true
		});
	}
	function markFunctionWrapped(wrapped, original) {
		const proto = original.prototype || {};
		wrapped.prototype = original.prototype = proto;
		addNonEnumerableProperty(wrapped, '__sentry_original__', original);
	}
	function getOriginalFunction(func) {
		return func.__sentry_original__;
	}
	function urlEncode(object) {
		return Object.keys(object).map((key => `${encodeURIComponent(key)}=${encodeURIComponent(object[key])}`)).join('&');
	}
	function getWalkSource(value) {
		if (isError(value)) {
			const error = value;
			const err = {
				message: error.message,
				name: error.name,
				stack: error.stack
			};
			for (const i in error) {
				if (Object.prototype.hasOwnProperty.call(error, i)) {
					err[i] = error[i];
				}
			}
			return err;
		}
		if (isEvent(value)) {
			const event = value;
			const source = {};
			source.type = event.type;
			try {
				source.target = isElement(event.target) ? htmlTreeAsString(event.target) : Object.prototype.toString.call(event.target);
			} catch (_oO) {
				source.target = '<unknown>';
			}
			try {
				source.currentTarget = isElement(event.currentTarget) ? htmlTreeAsString(event.currentTarget) : Object.prototype.toString.call(event.currentTarget);
			} catch (_oO) {
				source.currentTarget = '<unknown>';
			}
			if (typeof CustomEvent !== 'undefined' && isInstanceOf(value, CustomEvent)) {
				source.detail = event.detail;
			}
			for (const attr in event) {
				if (Object.prototype.hasOwnProperty.call(event, attr)) {
					source[attr] = event[attr];
				}
			}
			return source;
		}
		return value;
	}
	function utf8Length(value) {
		return ~-encodeURI(value).split(/%..|./).length;
	}
	function jsonSize(value) {
		return utf8Length(JSON.stringify(value));
	}
	function normalizeToSize(object, depth = 3, maxSize = 100 * 1024) {
		const serialized = normalize(object, depth);
		if (jsonSize(serialized) > maxSize) {
			return normalizeToSize(object, depth - 1, maxSize);
		}
		return serialized;
	}
	function serializeValue(value) {
		if (typeof value === 'string') {
			return value;
		}
		const type = Object.prototype.toString.call(value);
		if (type === '[object Object]') {
			return '[Object]';
		}
		if (type === '[object Array]') {
			return '[Array]';
		}
		const serializable = makeSerializable(value);
		return isPrimitive(serializable) ? serializable : type;
	}
	function makeSerializable(value, key) {
		if (key === 'domain' && value && typeof value === 'object' && value._events) {
			return '[Domain]';
		}
		if (key === 'domainEmitter') {
			return '[DomainEmitter]';
		}
		if (typeof global !== 'undefined' && value === global) {
			return '[Global]';
		}
		if (typeof window !== 'undefined' && value === window) {
			return '[Window]';
		}
		if (typeof document !== 'undefined' && value === document) {
			return '[Document]';
		}
		if (isSyntheticEvent(value)) {
			return '[SyntheticEvent]';
		}
		if (typeof value === 'number' && value !== value) {
			return '[NaN]';
		}
		if (value === void 0) {
			return '[undefined]';
		}
		if (typeof value === 'function') {
			return `[Function: ${getFunctionName(value)}]`;
		}
		if (typeof value === 'symbol') {
			return `[${String(value)}]`;
		}
		if (typeof value === 'bigint') {
			return `[BigInt: ${String(value)}]`;
		}
		return value;
	}
	function walk(key, value, depth = +Infinity, memo = memoBuilder()) {
		const [memoize, unmemoize] = memo;
		if (depth === 0) {
			return serializeValue(value);
		}
		if (value !== null && value !== undefined && typeof value.toJSON === 'function') {
			return value.toJSON();
		}
		const serializable = makeSerializable(value, key);
		if (isPrimitive(serializable)) {
			return serializable;
		}
		const source = getWalkSource(value);
		const acc = Array.isArray(value) ? [] : {};
		if (memoize(value)) {
			return '[Circular ~]';
		}
		for (const innerKey in source) {
			if (!Object.prototype.hasOwnProperty.call(source, innerKey)) {
				continue;
			}
			const innerValue = source[innerKey];
			acc[innerKey] = walk(innerKey, innerValue, depth - 1, memo);
		}
		unmemoize(value);
		return acc;
	}
	function normalize(input, depth) {
		try {
			return walk('', input, depth);
		} catch (_oO) {
			return '**non-serializable**';
		}
	}
	function extractExceptionKeysForMessage(exception, maxLength = 40) {
		const keys = Object.keys(getWalkSource(exception));
		keys.sort();
		if (!keys.length) {
			return '[object has no keys]';
		}
		if (keys[0].length >= maxLength) {
			return truncate(keys[0], maxLength);
		}
		for (let includedKeys = keys.length; includedKeys > 0; includedKeys--) {
			const serialized = keys.slice(0, includedKeys).join(', ');
			if (serialized.length > maxLength) {
				continue;
			}
			if (includedKeys === keys.length) {
				return serialized;
			}
			return truncate(serialized, maxLength);
		}
		return '';
	}
	function dropUndefinedKeys(val) {
		if (isPlainObject(val)) {
			const obj = val;
			const rv = {};
			for (const key of Object.keys(obj)) {
				if (typeof obj[key] !== 'undefined') {
					rv[key] = dropUndefinedKeys(obj[key]);
				}
			}
			return rv;
		}
		if (Array.isArray(val)) {
			return val.map(dropUndefinedKeys);
		}
		return val;
	}
	function supportsFetch() {
		if (!('fetch' in getGlobalObject())) {
			return false;
		}
		try {
			new Headers;
			new Request('');
			new Response;
			return true;
		} catch (e) {
			return false;
		}
	}
	function isNativeFetch(func) {
		return func && /^function fetch\(\)\s+\{\s+\[native code\]\s+\}$/.test(func.toString());
	}
	function supportsNativeFetch() {
		if (!supportsFetch()) {
			return false;
		}
		const global = getGlobalObject();
		if (isNativeFetch(global.fetch)) {
			return true;
		}
		let result = false;
		const doc = global.document;
		if (doc && typeof doc.createElement === 'function') {
			try {
				const sandbox = doc.createElement('iframe');
				sandbox.hidden = true;
				doc.head.appendChild(sandbox);
				if (sandbox.contentWindow && sandbox.contentWindow.fetch) {
					result = isNativeFetch(sandbox.contentWindow.fetch);
				}
				doc.head.removeChild(sandbox);
			} catch (err) {
				if (isDebugBuild()) {
					logger.warn('Could not create sandbox iframe for pure fetch check, bailing to window.fetch: ', err);
				}
			}
		}
		return result;
	}
	function supportsReferrerPolicy() {
		if (!supportsFetch()) {
			return false;
		}
		try {
			new Request('_', {
				referrerPolicy: 'origin'
			});
			return true;
		} catch (e) {
			return false;
		}
	}
	function supportsHistory() {
		const global = getGlobalObject();
		const chrome = global.chrome;
		const isChromePackagedApp = chrome && chrome.app && chrome.app.runtime;
		const hasHistoryApi = 'history' in global && !!global.history.pushState && !!global.history.replaceState;
		return !isChromePackagedApp && hasHistoryApi;
	}
	const global$5 = getGlobalObject();
	const handlers = {};
	const instrumented = {};
	function instrument(type) {
		if (instrumented[type]) {
			return;
		}
		instrumented[type] = true;
		switch (type) {
		case 'console':
			instrumentConsole();
			break;

		case 'dom':
			instrumentDOM();
			break;

		case 'xhr':
			instrumentXHR();
			break;

		case 'fetch':
			instrumentFetch();
			break;

		case 'history':
			instrumentHistory();
			break;

		case 'error':
			instrumentError();
			break;

		case 'unhandledrejection':
			instrumentUnhandledRejection();
			break;

		default:
			logger.warn('unknown instrumentation type:', type);
		}
	}
	function addInstrumentationHandler(type, callback) {
		handlers[type] = handlers[type] || [];
		handlers[type].push(callback);
		instrument(type);
	}
	function triggerHandlers(type, data) {
		if (!type || !handlers[type]) {
			return;
		}
		for (const handler of handlers[type] || []) {
			try {
				handler(data);
			} catch (e) {
				if (isDebugBuild()) {
					logger.error(`Error while triggering instrumentation handler.\nType: ${type}\nName: ${getFunctionName(handler)}\nError:`, e);
				}
			}
		}
	}
	function instrumentConsole() {
		if (!('console' in global$5)) {
			return;
		}
		[ 'debug', 'info', 'warn', 'error', 'log', 'assert' ].forEach((function(level) {
			if (!(level in global$5.console)) {
				return;
			}
			fill(global$5.console, level, (function(originalConsoleMethod) {
				return function(...args) {
					triggerHandlers('console', {
						args,
						level
					});
					if (originalConsoleMethod) {
						originalConsoleMethod.apply(global$5.console, args);
					}
				};
			}));
		}));
	}
	function instrumentFetch() {
		if (!supportsNativeFetch()) {
			return;
		}
		fill(global$5, 'fetch', (function(originalFetch) {
			return function(...args) {
				const handlerData = {
					args,
					fetchData: {
						method: getFetchMethod(args),
						url: getFetchUrl(args)
					},
					startTimestamp: Date.now()
				};
				triggerHandlers('fetch', Object.assign({}, handlerData));
				return originalFetch.apply(global$5, args).then((response => {
					triggerHandlers('fetch', Object.assign(Object.assign({}, handlerData), {
						endTimestamp: Date.now(),
						response
					}));
					return response;
				}), (error => {
					triggerHandlers('fetch', Object.assign(Object.assign({}, handlerData), {
						endTimestamp: Date.now(),
						error
					}));
					throw error;
				}));
			};
		}));
	}
	function getFetchMethod(fetchArgs = []) {
		if ('Request' in global$5 && isInstanceOf(fetchArgs[0], Request) && fetchArgs[0].method) {
			return String(fetchArgs[0].method).toUpperCase();
		}
		if (fetchArgs[1] && fetchArgs[1].method) {
			return String(fetchArgs[1].method).toUpperCase();
		}
		return 'GET';
	}
	function getFetchUrl(fetchArgs = []) {
		if (typeof fetchArgs[0] === 'string') {
			return fetchArgs[0];
		}
		if ('Request' in global$5 && isInstanceOf(fetchArgs[0], Request)) {
			return fetchArgs[0].url;
		}
		return String(fetchArgs[0]);
	}
	function instrumentXHR() {
		if (!('XMLHttpRequest' in global$5)) {
			return;
		}
		const xhrproto = XMLHttpRequest.prototype;
		fill(xhrproto, 'open', (function(originalOpen) {
			return function(...args) {
				const xhr = this;
				const url = args[1];
				const xhrInfo = xhr.__sentry_xhr__ = {
					method: isString(args[0]) ? args[0].toUpperCase() : args[0],
					url: args[1]
				};
				if (isString(url) && xhrInfo.method === 'POST' && url.match(/sentry_key/)) {
					xhr.__sentry_own_request__ = true;
				}
				const onreadystatechangeHandler = function() {
					if (xhr.readyState === 4) {
						try {
							xhrInfo.status_code = xhr.status;
						} catch (e) {}
						triggerHandlers('xhr', {
							args,
							endTimestamp: Date.now(),
							startTimestamp: Date.now(),
							xhr
						});
					}
				};
				if ('onreadystatechange' in xhr && typeof xhr.onreadystatechange === 'function') {
					fill(xhr, 'onreadystatechange', (function(original) {
						return function(...readyStateArgs) {
							onreadystatechangeHandler();
							return original.apply(xhr, readyStateArgs);
						};
					}));
				} else {
					xhr.addEventListener('readystatechange', onreadystatechangeHandler);
				}
				return originalOpen.apply(xhr, args);
			};
		}));
		fill(xhrproto, 'send', (function(originalSend) {
			return function(...args) {
				if (this.__sentry_xhr__ && args[0] !== undefined) {
					this.__sentry_xhr__.body = args[0];
				}
				triggerHandlers('xhr', {
					args,
					startTimestamp: Date.now(),
					xhr: this
				});
				return originalSend.apply(this, args);
			};
		}));
	}
	let lastHref;
	function instrumentHistory() {
		if (!supportsHistory()) {
			return;
		}
		const oldOnPopState = global$5.onpopstate;
		global$5.onpopstate = function(...args) {
			const to = global$5.location.href;
			const from = lastHref;
			lastHref = to;
			triggerHandlers('history', {
				from,
				to
			});
			if (oldOnPopState) {
				try {
					return oldOnPopState.apply(this, args);
				} catch (_oO) {}
			}
		};
		function historyReplacementFunction(originalHistoryFunction) {
			return function(...args) {
				const url = args.length > 2 ? args[2] : undefined;
				if (url) {
					const from = lastHref;
					const to = String(url);
					lastHref = to;
					triggerHandlers('history', {
						from,
						to
					});
				}
				return originalHistoryFunction.apply(this, args);
			};
		}
		fill(global$5.history, 'pushState', historyReplacementFunction);
		fill(global$5.history, 'replaceState', historyReplacementFunction);
	}
	const debounceDuration = 1000;
	let debounceTimerID;
	let lastCapturedEvent;
	function shouldShortcircuitPreviousDebounce(previous, current) {
		if (!previous) {
			return true;
		}
		if (previous.type !== current.type) {
			return true;
		}
		try {
			if (previous.target !== current.target) {
				return true;
			}
		} catch (e) {}
		return false;
	}
	function shouldSkipDOMEvent(event) {
		if (event.type !== 'keypress') {
			return false;
		}
		try {
			const target = event.target;
			if (!target || !target.tagName) {
				return true;
			}
			if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
				return false;
			}
		} catch (e) {}
		return true;
	}
	function makeDOMEventHandler(handler, globalListener = false) {
		return event => {
			if (!event || lastCapturedEvent === event) {
				return;
			}
			if (shouldSkipDOMEvent(event)) {
				return;
			}
			const name = event.type === 'keypress' ? 'input' : event.type;
			if (debounceTimerID === undefined) {
				handler({
					event,
					name,
					global: globalListener
				});
				lastCapturedEvent = event;
			} else if (shouldShortcircuitPreviousDebounce(lastCapturedEvent, event)) {
				handler({
					event,
					name,
					global: globalListener
				});
				lastCapturedEvent = event;
			}
			clearTimeout(debounceTimerID);
			debounceTimerID = global$5.setTimeout((() => {
				debounceTimerID = undefined;
			}), debounceDuration);
		};
	}
	function instrumentDOM() {
		if (!('document' in global$5)) {
			return;
		}
		const triggerDOMHandler = triggerHandlers.bind(null, 'dom');
		const globalDOMEventHandler = makeDOMEventHandler(triggerDOMHandler, true);
		global$5.document.addEventListener('click', globalDOMEventHandler, false);
		global$5.document.addEventListener('keypress', globalDOMEventHandler, false);
		[ 'EventTarget', 'Node' ].forEach((target => {
			const proto = global$5[target] && global$5[target].prototype;
			if (!proto || !proto.hasOwnProperty || !proto.hasOwnProperty('addEventListener')) {
				return;
			}
			fill(proto, 'addEventListener', (function(originalAddEventListener) {
				return function(type, listener, options) {
					if (type === 'click' || type == 'keypress') {
						try {
							const el = this;
							const handlers = el.__sentry_instrumentation_handlers__ = el.__sentry_instrumentation_handlers__ || {};
							const handlerForType = handlers[type] = handlers[type] || {
								refCount: 0
							};
							if (!handlerForType.handler) {
								const handler = makeDOMEventHandler(triggerDOMHandler);
								handlerForType.handler = handler;
								originalAddEventListener.call(this, type, handler, options);
							}
							handlerForType.refCount += 1;
						} catch (e) {}
					}
					return originalAddEventListener.call(this, type, listener, options);
				};
			}));
			fill(proto, 'removeEventListener', (function(originalRemoveEventListener) {
				return function(type, listener, options) {
					if (type === 'click' || type == 'keypress') {
						try {
							const el = this;
							const handlers = el.__sentry_instrumentation_handlers__ || {};
							const handlerForType = handlers[type];
							if (handlerForType) {
								handlerForType.refCount -= 1;
								if (handlerForType.refCount <= 0) {
									originalRemoveEventListener.call(this, type, handlerForType.handler, options);
									handlerForType.handler = undefined;
									delete handlers[type];
								}
								if (Object.keys(handlers).length === 0) {
									delete el.__sentry_instrumentation_handlers__;
								}
							}
						} catch (e) {}
					}
					return originalRemoveEventListener.call(this, type, listener, options);
				};
			}));
		}));
	}
	let _oldOnErrorHandler = null;
	function instrumentError() {
		_oldOnErrorHandler = global$5.onerror;
		global$5.onerror = function(msg, url, line, column, error) {
			triggerHandlers('error', {
				column,
				error,
				line,
				msg,
				url
			});
			if (_oldOnErrorHandler) {
				return _oldOnErrorHandler.apply(this, arguments);
			}
			return false;
		};
	}
	let _oldOnUnhandledRejectionHandler = null;
	function instrumentUnhandledRejection() {
		_oldOnUnhandledRejectionHandler = global$5.onunhandledrejection;
		global$5.onunhandledrejection = function(e) {
			triggerHandlers('unhandledrejection', e);
			if (_oldOnUnhandledRejectionHandler) {
				return _oldOnUnhandledRejectionHandler.apply(this, arguments);
			}
			return true;
		};
	}
	function uuid4() {
		const global = getGlobalObject();
		const crypto = global.crypto || global.msCrypto;
		if (!(crypto === void 0) && crypto.getRandomValues) {
			const arr = new Uint16Array(8);
			crypto.getRandomValues(arr);
			arr[3] = arr[3] & 0xfff | 0x4000;
			arr[4] = arr[4] & 0x3fff | 0x8000;
			const pad = num => {
				let v = num.toString(16);
				while (v.length < 4) {
					v = `0${v}`;
				}
				return v;
			};
			return pad(arr[0]) + pad(arr[1]) + pad(arr[2]) + pad(arr[3]) + pad(arr[4]) + pad(arr[5]) + pad(arr[6]) + pad(arr[7]);
		}
		return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c => {
			const r = Math.random() * 16 | 0;
			const v = c === 'x' ? r : r & 0x3 | 0x8;
			return v.toString(16);
		}));
	}
	function parseUrl(url) {
		if (!url) {
			return {};
		}
		const match = url.match(/^(([^:/?#]+):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?$/);
		if (!match) {
			return {};
		}
		const query = match[6] || '';
		const fragment = match[8] || '';
		return {
			host: match[4],
			path: match[5],
			protocol: match[2],
			relative: match[5] + query + fragment
		};
	}
	function getFirstException(event) {
		return event.exception && event.exception.values ? event.exception.values[0] : undefined;
	}
	function getEventDescription(event) {
		const {message, event_id: eventId} = event;
		if (message) {
			return message;
		}
		const firstException = getFirstException(event);
		if (firstException) {
			if (firstException.type && firstException.value) {
				return `${firstException.type}: ${firstException.value}`;
			}
			return firstException.type || firstException.value || eventId || '<unknown>';
		}
		return eventId || '<unknown>';
	}
	function addExceptionTypeValue(event, value, type) {
		const exception = event.exception = event.exception || {};
		const values = exception.values = exception.values || [];
		const firstException = values[0] = values[0] || {};
		if (!firstException.value) {
			firstException.value = value || '';
		}
		if (!firstException.type) {
			firstException.type = type || 'Error';
		}
	}
	function addExceptionMechanism(event, newMechanism) {
		const firstException = getFirstException(event);
		if (!firstException) {
			return;
		}
		const defaultMechanism = {
			type: 'generic',
			handled: true
		};
		const currentMechanism = firstException.mechanism;
		firstException.mechanism = Object.assign(Object.assign(Object.assign({}, defaultMechanism), currentMechanism), newMechanism);
		if (newMechanism && 'data' in newMechanism) {
			const mergedData = Object.assign(Object.assign({}, currentMechanism && currentMechanism.data), newMechanism.data);
			firstException.mechanism.data = mergedData;
		}
	}
	function checkOrSetAlreadyCaught(exception) {
		if (exception && exception.__sentry_captured__) {
			return true;
		}
		try {
			addNonEnumerableProperty(exception, '__sentry_captured__', true);
		} catch (err) {}
		return false;
	}
	function resolvedSyncPromise(value) {
		return new SyncPromise((resolve => {
			resolve(value);
		}));
	}
	function rejectedSyncPromise(reason) {
		return new SyncPromise(((_, reject) => {
			reject(reason);
		}));
	}
	class SyncPromise {
		constructor(executor) {
			this._state = 0;
			this._handlers = [];
			this._resolve = value => {
				this._setResult(1, value);
			};
			this._reject = reason => {
				this._setResult(2, reason);
			};
			this._setResult = (state, value) => {
				if (this._state !== 0) {
					return;
				}
				if (isThenable(value)) {
					void value.then(this._resolve, this._reject);
					return;
				}
				this._state = state;
				this._value = value;
				this._executeHandlers();
			};
			this._executeHandlers = () => {
				if (this._state === 0) {
					return;
				}
				const cachedHandlers = this._handlers.slice();
				this._handlers = [];
				cachedHandlers.forEach((handler => {
					if (handler[0]) {
						return;
					}
					if (this._state === 1) {
						handler[1](this._value);
					}
					if (this._state === 2) {
						handler[2](this._value);
					}
					handler[0] = true;
				}));
			};
			try {
				executor(this._resolve, this._reject);
			} catch (e) {
				this._reject(e);
			}
		}
		then(onfulfilled, onrejected) {
			return new SyncPromise(((resolve, reject) => {
				this._handlers.push([ false, result => {
					if (!onfulfilled) {
						resolve(result);
					} else {
						try {
							resolve(onfulfilled(result));
						} catch (e) {
							reject(e);
						}
					}
				}, reason => {
					if (!onrejected) {
						reject(reason);
					} else {
						try {
							resolve(onrejected(reason));
						} catch (e) {
							reject(e);
						}
					}
				} ]);
				this._executeHandlers();
			}));
		}
		catch(onrejected) {
			return this.then((val => val), onrejected);
		}
		finally(onfinally) {
			return new SyncPromise(((resolve, reject) => {
				let val;
				let isRejected;
				return this.then((value => {
					isRejected = false;
					val = value;
					if (onfinally) {
						onfinally();
					}
				}), (reason => {
					isRejected = true;
					val = reason;
					if (onfinally) {
						onfinally();
					}
				})).then((() => {
					if (isRejected) {
						reject(val);
						return;
					}
					resolve(val);
				}));
			}));
		}
	}
	function makePromiseBuffer(limit) {
		const buffer = [];
		function isReady() {
			return limit === undefined || buffer.length < limit;
		}
		function remove(task) {
			return buffer.splice(buffer.indexOf(task), 1)[0];
		}
		function add(taskProducer) {
			if (!isReady()) {
				return rejectedSyncPromise(new SentryError('Not adding Promise due to buffer limit reached.'));
			}
			const task = taskProducer();
			if (buffer.indexOf(task) === -1) {
				buffer.push(task);
			}
			void task.then((() => remove(task))).then(null, (() => remove(task).then(null, (() => {}))));
			return task;
		}
		function drain(timeout) {
			return new SyncPromise(((resolve, reject) => {
				let counter = buffer.length;
				if (!counter) {
					return resolve(true);
				}
				const capturedSetTimeout = setTimeout((() => {
					if (timeout && timeout > 0) {
						resolve(false);
					}
				}), timeout);
				buffer.forEach((item => {
					void resolvedSyncPromise(item).then((() => {
						if (!--counter) {
							clearTimeout(capturedSetTimeout);
							resolve(true);
						}
					}), reject);
				}));
			}));
		}
		return {
			$: buffer,
			add,
			drain
		};
	}
	function isSupportedSeverity(level) {
		return SeverityLevels.indexOf(level) !== -1;
	}
	function severityFromString(level) {
		if (level === 'warn') return exports.Severity.Warning;
		if (isSupportedSeverity(level)) {
			return level;
		}
		return exports.Severity.Log;
	}
	function eventStatusFromHttpCode(code) {
		if (code >= 200 && code < 300) {
			return 'success';
		}
		if (code === 429) {
			return 'rate_limit';
		}
		if (code >= 400 && code < 500) {
			return 'invalid';
		}
		if (code >= 500) {
			return 'failed';
		}
		return 'unknown';
	}
	const dateTimestampSource = {
		nowSeconds: () => Date.now() / 1000
	};
	function getBrowserPerformance() {
		const {performance} = getGlobalObject();
		if (!performance || !performance.now) {
			return undefined;
		}
		const timeOrigin = Date.now() - performance.now();
		return {
			now: () => performance.now(),
			timeOrigin
		};
	}
	const platformPerformance = getBrowserPerformance();
	const timestampSource = platformPerformance === undefined ? dateTimestampSource : {
		nowSeconds: () => (platformPerformance.timeOrigin + platformPerformance.now()) / 1000
	};
	const dateTimestampInSeconds = dateTimestampSource.nowSeconds.bind(dateTimestampSource);
	const timestampInSeconds = timestampSource.nowSeconds.bind(timestampSource);
	(() => {
		const {performance} = getGlobalObject();
		if (!performance || !performance.now) {
			return undefined;
		}
		const threshold = 3600 * 1000;
		const performanceNow = performance.now();
		const dateNow = Date.now();
		const timeOriginDelta = performance.timeOrigin ? Math.abs(performance.timeOrigin + performanceNow - dateNow) : threshold;
		const timeOriginIsReliable = timeOriginDelta < threshold;
		const navigationStart = performance.timing && performance.timing.navigationStart;
		const hasNavigationStart = typeof navigationStart === 'number';
		const navigationStartDelta = hasNavigationStart ? Math.abs(navigationStart + performanceNow - dateNow) : threshold;
		const navigationStartIsReliable = navigationStartDelta < threshold;
		if (timeOriginIsReliable || navigationStartIsReliable) {
			if (timeOriginDelta <= navigationStartDelta) {
				return performance.timeOrigin;
			} else {
				return navigationStart;
			}
		}
		return dateNow;
	})();
	function createEnvelope(headers, items = []) {
		return [ headers, items ];
	}
	function serializeEnvelope(envelope) {
		const [headers, items] = envelope;
		const serializedHeaders = JSON.stringify(headers);
		return items.reduce(((acc, item) => {
			const [itemHeaders, payload] = item;
			const serializedPayload = isPrimitive(payload) ? String(payload) : JSON.stringify(payload);
			return `${acc}\n${JSON.stringify(itemHeaders)}\n${serializedPayload}`;
		}), serializedHeaders);
	}
	function createClientReportEnvelope(discarded_events, dsn, timestamp) {
		const clientReportItem = [ {
			type: 'client_report'
		}, {
			timestamp: timestamp || dateTimestampInSeconds(),
			discarded_events
		} ];
		return createEnvelope(dsn ? {
			dsn
		} : {}, [ clientReportItem ]);
	}
	const DEFAULT_RETRY_AFTER = 60 * 1000;
	function parseRetryAfterHeader(header, now = Date.now()) {
		const headerDelay = parseInt(`${header}`, 10);
		if (!isNaN(headerDelay)) {
			return headerDelay * 1000;
		}
		const headerDate = Date.parse(`${header}`);
		if (!isNaN(headerDate)) {
			return headerDate - now;
		}
		return DEFAULT_RETRY_AFTER;
	}
	const MAX_BREADCRUMBS = 100;
	class Scope {
		constructor() {
			this._notifyingListeners = false;
			this._scopeListeners = [];
			this._eventProcessors = [];
			this._breadcrumbs = [];
			this._user = {};
			this._tags = {};
			this._extra = {};
			this._contexts = {};
			this._sdkProcessingMetadata = {};
		}
		static clone(scope) {
			const newScope = new Scope;
			if (scope) {
				newScope._breadcrumbs = [ ...scope._breadcrumbs ];
				newScope._tags = Object.assign({}, scope._tags);
				newScope._extra = Object.assign({}, scope._extra);
				newScope._contexts = Object.assign({}, scope._contexts);
				newScope._user = scope._user;
				newScope._level = scope._level;
				newScope._span = scope._span;
				newScope._session = scope._session;
				newScope._transactionName = scope._transactionName;
				newScope._fingerprint = scope._fingerprint;
				newScope._eventProcessors = [ ...scope._eventProcessors ];
				newScope._requestSession = scope._requestSession;
			}
			return newScope;
		}
		addScopeListener(callback) {
			this._scopeListeners.push(callback);
		}
		addEventProcessor(callback) {
			this._eventProcessors.push(callback);
			return this;
		}
		setUser(user) {
			this._user = user || {};
			if (this._session) {
				this._session.update({
					user
				});
			}
			this._notifyScopeListeners();
			return this;
		}
		getUser() {
			return this._user;
		}
		getRequestSession() {
			return this._requestSession;
		}
		setRequestSession(requestSession) {
			this._requestSession = requestSession;
			return this;
		}
		setTags(tags) {
			this._tags = Object.assign(Object.assign({}, this._tags), tags);
			this._notifyScopeListeners();
			return this;
		}
		setTag(key, value) {
			this._tags = Object.assign(Object.assign({}, this._tags), {
				[key]: value
			});
			this._notifyScopeListeners();
			return this;
		}
		setExtras(extras) {
			this._extra = Object.assign(Object.assign({}, this._extra), extras);
			this._notifyScopeListeners();
			return this;
		}
		setExtra(key, extra) {
			this._extra = Object.assign(Object.assign({}, this._extra), {
				[key]: extra
			});
			this._notifyScopeListeners();
			return this;
		}
		setFingerprint(fingerprint) {
			this._fingerprint = fingerprint;
			this._notifyScopeListeners();
			return this;
		}
		setLevel(level) {
			this._level = level;
			this._notifyScopeListeners();
			return this;
		}
		setTransactionName(name) {
			this._transactionName = name;
			this._notifyScopeListeners();
			return this;
		}
		setTransaction(name) {
			return this.setTransactionName(name);
		}
		setContext(key, context) {
			if (context === null) {
				delete this._contexts[key];
			} else {
				this._contexts = Object.assign(Object.assign({}, this._contexts), {
					[key]: context
				});
			}
			this._notifyScopeListeners();
			return this;
		}
		setSpan(span) {
			this._span = span;
			this._notifyScopeListeners();
			return this;
		}
		getSpan() {
			return this._span;
		}
		getTransaction() {
			const span = this.getSpan();
			return span && span.transaction;
		}
		setSession(session) {
			if (!session) {
				delete this._session;
			} else {
				this._session = session;
			}
			this._notifyScopeListeners();
			return this;
		}
		getSession() {
			return this._session;
		}
		update(captureContext) {
			if (!captureContext) {
				return this;
			}
			if (typeof captureContext === 'function') {
				const updatedScope = captureContext(this);
				return updatedScope instanceof Scope ? updatedScope : this;
			}
			if (captureContext instanceof Scope) {
				this._tags = Object.assign(Object.assign({}, this._tags), captureContext._tags);
				this._extra = Object.assign(Object.assign({}, this._extra), captureContext._extra);
				this._contexts = Object.assign(Object.assign({}, this._contexts), captureContext._contexts);
				if (captureContext._user && Object.keys(captureContext._user).length) {
					this._user = captureContext._user;
				}
				if (captureContext._level) {
					this._level = captureContext._level;
				}
				if (captureContext._fingerprint) {
					this._fingerprint = captureContext._fingerprint;
				}
				if (captureContext._requestSession) {
					this._requestSession = captureContext._requestSession;
				}
			} else if (isPlainObject(captureContext)) {
				captureContext = captureContext;
				this._tags = Object.assign(Object.assign({}, this._tags), captureContext.tags);
				this._extra = Object.assign(Object.assign({}, this._extra), captureContext.extra);
				this._contexts = Object.assign(Object.assign({}, this._contexts), captureContext.contexts);
				if (captureContext.user) {
					this._user = captureContext.user;
				}
				if (captureContext.level) {
					this._level = captureContext.level;
				}
				if (captureContext.fingerprint) {
					this._fingerprint = captureContext.fingerprint;
				}
				if (captureContext.requestSession) {
					this._requestSession = captureContext.requestSession;
				}
			}
			return this;
		}
		clear() {
			this._breadcrumbs = [];
			this._tags = {};
			this._extra = {};
			this._user = {};
			this._contexts = {};
			this._level = undefined;
			this._transactionName = undefined;
			this._fingerprint = undefined;
			this._requestSession = undefined;
			this._span = undefined;
			this._session = undefined;
			this._notifyScopeListeners();
			return this;
		}
		addBreadcrumb(breadcrumb, maxBreadcrumbs) {
			const maxCrumbs = typeof maxBreadcrumbs === 'number' ? Math.min(maxBreadcrumbs, MAX_BREADCRUMBS) : MAX_BREADCRUMBS;
			if (maxCrumbs <= 0) {
				return this;
			}
			const mergedBreadcrumb = Object.assign({
				timestamp: dateTimestampInSeconds()
			}, breadcrumb);
			this._breadcrumbs = [ ...this._breadcrumbs, mergedBreadcrumb ].slice(-maxCrumbs);
			this._notifyScopeListeners();
			return this;
		}
		clearBreadcrumbs() {
			this._breadcrumbs = [];
			this._notifyScopeListeners();
			return this;
		}
		applyToEvent(event, hint) {
			if (this._extra && Object.keys(this._extra).length) {
				event.extra = Object.assign(Object.assign({}, this._extra), event.extra);
			}
			if (this._tags && Object.keys(this._tags).length) {
				event.tags = Object.assign(Object.assign({}, this._tags), event.tags);
			}
			if (this._user && Object.keys(this._user).length) {
				event.user = Object.assign(Object.assign({}, this._user), event.user);
			}
			if (this._contexts && Object.keys(this._contexts).length) {
				event.contexts = Object.assign(Object.assign({}, this._contexts), event.contexts);
			}
			if (this._level) {
				event.level = this._level;
			}
			if (this._transactionName) {
				event.transaction = this._transactionName;
			}
			if (this._span) {
				event.contexts = Object.assign({
					trace: this._span.getTraceContext()
				}, event.contexts);
				const transactionName = this._span.transaction && this._span.transaction.name;
				if (transactionName) {
					event.tags = Object.assign({
						transaction: transactionName
					}, event.tags);
				}
			}
			this._applyFingerprint(event);
			event.breadcrumbs = [ ...event.breadcrumbs || [], ...this._breadcrumbs ];
			event.breadcrumbs = event.breadcrumbs.length > 0 ? event.breadcrumbs : undefined;
			event.sdkProcessingMetadata = this._sdkProcessingMetadata;
			return this._notifyEventProcessors([ ...getGlobalEventProcessors(), ...this._eventProcessors ], event, hint);
		}
		setSDKProcessingMetadata(newData) {
			this._sdkProcessingMetadata = Object.assign(Object.assign({}, this._sdkProcessingMetadata), newData);
			return this;
		}
		_notifyEventProcessors(processors, event, hint, index = 0) {
			return new SyncPromise(((resolve, reject) => {
				const processor = processors[index];
				if (event === null || typeof processor !== 'function') {
					resolve(event);
				} else {
					const result = processor(Object.assign({}, event), hint);
					if (isThenable(result)) {
						void result.then((final => this._notifyEventProcessors(processors, final, hint, index + 1).then(resolve))).then(null, reject);
					} else {
						void this._notifyEventProcessors(processors, result, hint, index + 1).then(resolve).then(null, reject);
					}
				}
			}));
		}
		_notifyScopeListeners() {
			if (!this._notifyingListeners) {
				this._notifyingListeners = true;
				this._scopeListeners.forEach((callback => {
					callback(this);
				}));
				this._notifyingListeners = false;
			}
		}
		_applyFingerprint(event) {
			event.fingerprint = event.fingerprint ? Array.isArray(event.fingerprint) ? event.fingerprint : [ event.fingerprint ] : [];
			if (this._fingerprint) {
				event.fingerprint = event.fingerprint.concat(this._fingerprint);
			}
			if (event.fingerprint && !event.fingerprint.length) {
				delete event.fingerprint;
			}
		}
	}
	function getGlobalEventProcessors() {
		const global = getGlobalObject();
		global.__SENTRY__ = global.__SENTRY__ || {};
		global.__SENTRY__.globalEventProcessors = global.__SENTRY__.globalEventProcessors || [];
		return global.__SENTRY__.globalEventProcessors;
	}
	function addGlobalEventProcessor(callback) {
		getGlobalEventProcessors().push(callback);
	}
	class Session {
		constructor(context) {
			this.errors = 0;
			this.sid = uuid4();
			this.duration = 0;
			this.status = 'ok';
			this.init = true;
			this.ignoreDuration = false;
			const startingTime = timestampInSeconds();
			this.timestamp = startingTime;
			this.started = startingTime;
			if (context) {
				this.update(context);
			}
		}
		update(context = {}) {
			if (context.user) {
				if (!this.ipAddress && context.user.ip_address) {
					this.ipAddress = context.user.ip_address;
				}
				if (!this.did && !context.did) {
					this.did = context.user.id || context.user.email || context.user.username;
				}
			}
			this.timestamp = context.timestamp || timestampInSeconds();
			if (context.ignoreDuration) {
				this.ignoreDuration = context.ignoreDuration;
			}
			if (context.sid) {
				this.sid = context.sid.length === 32 ? context.sid : uuid4();
			}
			if (context.init !== undefined) {
				this.init = context.init;
			}
			if (!this.did && context.did) {
				this.did = `${context.did}`;
			}
			if (typeof context.started === 'number') {
				this.started = context.started;
			}
			if (this.ignoreDuration) {
				this.duration = undefined;
			} else if (typeof context.duration === 'number') {
				this.duration = context.duration;
			} else {
				const duration = this.timestamp - this.started;
				this.duration = duration >= 0 ? duration : 0;
			}
			if (context.release) {
				this.release = context.release;
			}
			if (context.environment) {
				this.environment = context.environment;
			}
			if (!this.ipAddress && context.ipAddress) {
				this.ipAddress = context.ipAddress;
			}
			if (!this.userAgent && context.userAgent) {
				this.userAgent = context.userAgent;
			}
			if (typeof context.errors === 'number') {
				this.errors = context.errors;
			}
			if (context.status) {
				this.status = context.status;
			}
		}
		close(status) {
			if (status) {
				this.update({
					status
				});
			} else if (this.status === 'ok') {
				this.update({
					status: 'exited'
				});
			} else {
				this.update();
			}
		}
		toJSON() {
			return dropUndefinedKeys({
				sid: `${this.sid}`,
				init: this.init,
				started: new Date(this.started * 1000).toISOString(),
				timestamp: new Date(this.timestamp * 1000).toISOString(),
				status: this.status,
				errors: this.errors,
				did: typeof this.did === 'number' || typeof this.did === 'string' ? `${this.did}` : undefined,
				duration: this.duration,
				attrs: {
					release: this.release,
					environment: this.environment,
					ip_address: this.ipAddress,
					user_agent: this.userAgent
				}
			});
		}
	}
	const API_VERSION = 4;
	const DEFAULT_BREADCRUMBS = 100;
	class Hub {
		constructor(client, scope = new Scope, _version = API_VERSION) {
			this._version = _version;
			this._stack = [ {} ];
			this.getStackTop().scope = scope;
			if (client) {
				this.bindClient(client);
			}
		}
		isOlderThan(version) {
			return this._version < version;
		}
		bindClient(client) {
			const top = this.getStackTop();
			top.client = client;
			if (client && client.setupIntegrations) {
				client.setupIntegrations();
			}
		}
		pushScope() {
			const scope = Scope.clone(this.getScope());
			this.getStack().push({
				client: this.getClient(),
				scope
			});
			return scope;
		}
		popScope() {
			if (this.getStack().length <= 1) return false;
			return !!this.getStack().pop();
		}
		withScope(callback) {
			const scope = this.pushScope();
			try {
				callback(scope);
			} finally {
				this.popScope();
			}
		}
		getClient() {
			return this.getStackTop().client;
		}
		getScope() {
			return this.getStackTop().scope;
		}
		getStack() {
			return this._stack;
		}
		getStackTop() {
			return this._stack[this._stack.length - 1];
		}
		captureException(exception, hint) {
			const eventId = this._lastEventId = hint && hint.event_id ? hint.event_id : uuid4();
			let finalHint = hint;
			if (!hint) {
				let syntheticException;
				try {
					throw new Error('Sentry syntheticException');
				} catch (exception) {
					syntheticException = exception;
				}
				finalHint = {
					originalException: exception,
					syntheticException
				};
			}
			this._invokeClient('captureException', exception, Object.assign(Object.assign({}, finalHint), {
				event_id: eventId
			}));
			return eventId;
		}
		captureMessage(message, level, hint) {
			const eventId = this._lastEventId = hint && hint.event_id ? hint.event_id : uuid4();
			let finalHint = hint;
			if (!hint) {
				let syntheticException;
				try {
					throw new Error(message);
				} catch (exception) {
					syntheticException = exception;
				}
				finalHint = {
					originalException: message,
					syntheticException
				};
			}
			this._invokeClient('captureMessage', message, level, Object.assign(Object.assign({}, finalHint), {
				event_id: eventId
			}));
			return eventId;
		}
		captureEvent(event, hint) {
			const eventId = hint && hint.event_id ? hint.event_id : uuid4();
			if (event.type !== 'transaction') {
				this._lastEventId = eventId;
			}
			this._invokeClient('captureEvent', event, Object.assign(Object.assign({}, hint), {
				event_id: eventId
			}));
			return eventId;
		}
		lastEventId() {
			return this._lastEventId;
		}
		addBreadcrumb(breadcrumb, hint) {
			const {scope, client} = this.getStackTop();
			if (!scope || !client) return;
			const {beforeBreadcrumb = null, maxBreadcrumbs = DEFAULT_BREADCRUMBS} = client.getOptions && client.getOptions() || {};
			if (maxBreadcrumbs <= 0) return;
			const timestamp = dateTimestampInSeconds();
			const mergedBreadcrumb = Object.assign({
				timestamp
			}, breadcrumb);
			const finalBreadcrumb = beforeBreadcrumb ? consoleSandbox((() => beforeBreadcrumb(mergedBreadcrumb, hint))) : mergedBreadcrumb;
			if (finalBreadcrumb === null) return;
			scope.addBreadcrumb(finalBreadcrumb, maxBreadcrumbs);
		}
		setUser(user) {
			const scope = this.getScope();
			if (scope) scope.setUser(user);
		}
		setTags(tags) {
			const scope = this.getScope();
			if (scope) scope.setTags(tags);
		}
		setExtras(extras) {
			const scope = this.getScope();
			if (scope) scope.setExtras(extras);
		}
		setTag(key, value) {
			const scope = this.getScope();
			if (scope) scope.setTag(key, value);
		}
		setExtra(key, extra) {
			const scope = this.getScope();
			if (scope) scope.setExtra(key, extra);
		}
		setContext(name, context) {
			const scope = this.getScope();
			if (scope) scope.setContext(name, context);
		}
		configureScope(callback) {
			const {scope, client} = this.getStackTop();
			if (scope && client) {
				callback(scope);
			}
		}
		run(callback) {
			const oldHub = makeMain(this);
			try {
				callback(this);
			} finally {
				makeMain(oldHub);
			}
		}
		getIntegration(integration) {
			const client = this.getClient();
			if (!client) return null;
			try {
				return client.getIntegration(integration);
			} catch (_oO) {
				logger.warn(`Cannot retrieve integration ${integration.id} from the current Hub`);
				return null;
			}
		}
		startSpan(context) {
			return this._callExtensionMethod('startSpan', context);
		}
		startTransaction(context, customSamplingContext) {
			return this._callExtensionMethod('startTransaction', context, customSamplingContext);
		}
		traceHeaders() {
			return this._callExtensionMethod('traceHeaders');
		}
		captureSession(endSession = false) {
			if (endSession) {
				return this.endSession();
			}
			this._sendSessionUpdate();
		}
		endSession() {
			const layer = this.getStackTop();
			const scope = layer && layer.scope;
			const session = scope && scope.getSession();
			if (session) {
				session.close();
			}
			this._sendSessionUpdate();
			if (scope) {
				scope.setSession();
			}
		}
		startSession(context) {
			const {scope, client} = this.getStackTop();
			const {release, environment} = client && client.getOptions() || {};
			const global = getGlobalObject();
			const {userAgent} = global.navigator || {};
			const session = new Session(Object.assign(Object.assign(Object.assign({
				release,
				environment
			}, scope && {
				user: scope.getUser()
			}), userAgent && {
				userAgent
			}), context));
			if (scope) {
				const currentSession = scope.getSession && scope.getSession();
				if (currentSession && currentSession.status === 'ok') {
					currentSession.update({
						status: 'exited'
					});
				}
				this.endSession();
				scope.setSession(session);
			}
			return session;
		}
		_sendSessionUpdate() {
			const {scope, client} = this.getStackTop();
			if (!scope) return;
			const session = scope.getSession && scope.getSession();
			if (session) {
				if (client && client.captureSession) {
					client.captureSession(session);
				}
			}
		}
		_invokeClient(method, ...args) {
			const {scope, client} = this.getStackTop();
			if (client && client[method]) {
				client[method](...args, scope);
			}
		}
		_callExtensionMethod(method, ...args) {
			const carrier = getMainCarrier();
			const sentry = carrier.__SENTRY__;
			if (sentry && sentry.extensions && typeof sentry.extensions[method] === 'function') {
				return sentry.extensions[method].apply(this, args);
			}
			logger.warn(`Extension method ${method} couldn't be found, doing nothing.`);
		}
	}
	function getMainCarrier() {
		const carrier = getGlobalObject();
		carrier.__SENTRY__ = carrier.__SENTRY__ || {
			extensions: {},
			hub: undefined
		};
		return carrier;
	}
	function makeMain(hub) {
		const registry = getMainCarrier();
		const oldHub = getHubFromCarrier(registry);
		setHubOnCarrier(registry, hub);
		return oldHub;
	}
	function getCurrentHub() {
		const registry = getMainCarrier();
		if (!hasHubOnCarrier(registry) || getHubFromCarrier(registry).isOlderThan(API_VERSION)) {
			setHubOnCarrier(registry, new Hub);
		}
		return getHubFromCarrier(registry);
	}
	function hasHubOnCarrier(carrier) {
		return !!(carrier && carrier.__SENTRY__ && carrier.__SENTRY__.hub);
	}
	function getHubFromCarrier(carrier) {
		if (carrier && carrier.__SENTRY__ && carrier.__SENTRY__.hub) return carrier.__SENTRY__.hub;
		carrier.__SENTRY__ = carrier.__SENTRY__ || {};
		carrier.__SENTRY__.hub = new Hub;
		return carrier.__SENTRY__.hub;
	}
	function setHubOnCarrier(carrier, hub) {
		if (!carrier) return false;
		carrier.__SENTRY__ = carrier.__SENTRY__ || {};
		carrier.__SENTRY__.hub = hub;
		return true;
	}
	function callOnHub(method, ...args) {
		const hub = getCurrentHub();
		if (hub && hub[method]) {
			return hub[method](...args);
		}
		throw new Error(`No hub defined or ${method} was not found on the hub, please open a bug report.`);
	}
	function captureException(exception, captureContext) {
		let syntheticException;
		try {
			throw new Error('Sentry syntheticException');
		} catch (exception) {
			syntheticException = exception;
		}
		return callOnHub('captureException', exception, {
			captureContext,
			originalException: exception,
			syntheticException
		});
	}
	function captureMessage(message, captureContext) {
		let syntheticException;
		try {
			throw new Error(message);
		} catch (exception) {
			syntheticException = exception;
		}
		const level = typeof captureContext === 'string' ? captureContext : undefined;
		const context = typeof captureContext !== 'string' ? {
			captureContext
		} : undefined;
		return callOnHub('captureMessage', message, level, Object.assign({
			originalException: message,
			syntheticException
		}, context));
	}
	function captureEvent(event) {
		return callOnHub('captureEvent', event);
	}
	function configureScope(callback) {
		callOnHub('configureScope', callback);
	}
	function addBreadcrumb(breadcrumb) {
		callOnHub('addBreadcrumb', breadcrumb);
	}
	function setContext(name, context) {
		callOnHub('setContext', name, context);
	}
	function setExtras(extras) {
		callOnHub('setExtras', extras);
	}
	function setTags(tags) {
		callOnHub('setTags', tags);
	}
	function setExtra(key, extra) {
		callOnHub('setExtra', key, extra);
	}
	function setTag(key, value) {
		callOnHub('setTag', key, value);
	}
	function setUser(user) {
		callOnHub('setUser', user);
	}
	function withScope(callback) {
		callOnHub('withScope', callback);
	}
	function startTransaction(context, customSamplingContext) {
		return callOnHub('startTransaction', Object.assign({}, context), customSamplingContext);
	}
	const SENTRY_API_VERSION = '7';
	function initAPIDetails(dsn, metadata, tunnel) {
		return {
			initDsn: dsn,
			metadata: metadata || {},
			dsn: makeDsn(dsn),
			tunnel
		};
	}
	function getBaseApiEndpoint(dsn) {
		const protocol = dsn.protocol ? `${dsn.protocol}:` : '';
		const port = dsn.port ? `:${dsn.port}` : '';
		return `${protocol}//${dsn.host}${port}${dsn.path ? `/${dsn.path}` : ''}/api/`;
	}
	function _getIngestEndpoint(dsn, target) {
		return `${getBaseApiEndpoint(dsn)}${dsn.projectId}/${target}/`;
	}
	function _encodedAuth(dsn) {
		return urlEncode({
			sentry_key: dsn.publicKey,
			sentry_version: SENTRY_API_VERSION
		});
	}
	function getStoreEndpoint(dsn) {
		return _getIngestEndpoint(dsn, 'store');
	}
	function getStoreEndpointWithUrlEncodedAuth(dsn) {
		return `${getStoreEndpoint(dsn)}?${_encodedAuth(dsn)}`;
	}
	function _getEnvelopeEndpoint(dsn) {
		return _getIngestEndpoint(dsn, 'envelope');
	}
	function getEnvelopeEndpointWithUrlEncodedAuth(dsn, tunnel) {
		return tunnel ? tunnel : `${_getEnvelopeEndpoint(dsn)}?${_encodedAuth(dsn)}`;
	}
	function getReportDialogEndpoint(dsnLike, dialogOptions) {
		const dsn = makeDsn(dsnLike);
		const endpoint = `${getBaseApiEndpoint(dsn)}embed/error-page/`;
		let encodedOptions = `dsn=${dsnToString(dsn)}`;
		for (const key in dialogOptions) {
			if (key === 'dsn') {
				continue;
			}
			if (key === 'user') {
				if (!dialogOptions.user) {
					continue;
				}
				if (dialogOptions.user.name) {
					encodedOptions += `&name=${encodeURIComponent(dialogOptions.user.name)}`;
				}
				if (dialogOptions.user.email) {
					encodedOptions += `&email=${encodeURIComponent(dialogOptions.user.email)}`;
				}
			} else {
				encodedOptions += `&${encodeURIComponent(key)}=${encodeURIComponent(dialogOptions[key])}`;
			}
		}
		return `${endpoint}?${encodedOptions}`;
	}
	const installedIntegrations = [];
	function filterDuplicates(integrations) {
		return integrations.reduce(((acc, integrations) => {
			if (acc.every((accIntegration => integrations.name !== accIntegration.name))) {
				acc.push(integrations);
			}
			return acc;
		}), []);
	}
	function getIntegrationsToSetup(options) {
		const defaultIntegrations = options.defaultIntegrations && [ ...options.defaultIntegrations ] || [];
		const userIntegrations = options.integrations;
		let integrations = [ ...filterDuplicates(defaultIntegrations) ];
		if (Array.isArray(userIntegrations)) {
			integrations = [ ...integrations.filter((integrations => userIntegrations.every((userIntegration => userIntegration.name !== integrations.name)))), ...filterDuplicates(userIntegrations) ];
		} else if (typeof userIntegrations === 'function') {
			integrations = userIntegrations(integrations);
			integrations = Array.isArray(integrations) ? integrations : [ integrations ];
		}
		const integrationsNames = integrations.map((i => i.name));
		const alwaysLastToRun = 'Debug';
		if (integrationsNames.indexOf(alwaysLastToRun) !== -1) {
			integrations.push(...integrations.splice(integrationsNames.indexOf(alwaysLastToRun), 1));
		}
		return integrations;
	}
	function setupIntegration(integration) {
		if (installedIntegrations.indexOf(integration.name) !== -1) {
			return;
		}
		integration.setupOnce(addGlobalEventProcessor, getCurrentHub);
		installedIntegrations.push(integration.name);
		logger.log(`Integration installed: ${integration.name}`);
	}
	function setupIntegrations(options) {
		const integrations = {};
		getIntegrationsToSetup(options).forEach((integration => {
			integrations[integration.name] = integration;
			setupIntegration(integration);
		}));
		addNonEnumerableProperty(integrations, 'initialized', true);
		return integrations;
	}
	const ALREADY_SEEN_ERROR = "Not capturing exception because it's already been captured.";
	class BaseClient {
		constructor(backendClass, options) {
			this._integrations = {};
			this._numProcessing = 0;
			this._backend = new backendClass(options);
			this._options = options;
			if (options.dsn) {
				this._dsn = makeDsn(options.dsn);
			}
		}
		captureException(exception, hint, scope) {
			if (checkOrSetAlreadyCaught(exception)) {
				logger.log(ALREADY_SEEN_ERROR);
				return;
			}
			let eventId = hint && hint.event_id;
			this._process(this._getBackend().eventFromException(exception, hint).then((event => this._captureEvent(event, hint, scope))).then((result => {
				eventId = result;
			})));
			return eventId;
		}
		captureMessage(message, level, hint, scope) {
			let eventId = hint && hint.event_id;
			const promisedEvent = isPrimitive(message) ? this._getBackend().eventFromMessage(String(message), level, hint) : this._getBackend().eventFromException(message, hint);
			this._process(promisedEvent.then((event => this._captureEvent(event, hint, scope))).then((result => {
				eventId = result;
			})));
			return eventId;
		}
		captureEvent(event, hint, scope) {
			if (hint && hint.originalException && checkOrSetAlreadyCaught(hint.originalException)) {
				logger.log(ALREADY_SEEN_ERROR);
				return;
			}
			let eventId = hint && hint.event_id;
			this._process(this._captureEvent(event, hint, scope).then((result => {
				eventId = result;
			})));
			return eventId;
		}
		captureSession(session) {
			if (!this._isEnabled()) {
				if (isDebugBuild()) {
					logger.warn('SDK not enabled, will not capture session.');
				}
				return;
			}
			if (!(typeof session.release === 'string')) {
				if (isDebugBuild()) {
					logger.warn('Discarded session because of missing or non-string release');
				}
			} else {
				this._sendSession(session);
				session.update({
					init: false
				});
			}
		}
		getDsn() {
			return this._dsn;
		}
		getOptions() {
			return this._options;
		}
		getTransport() {
			return this._getBackend().getTransport();
		}
		flush(timeout) {
			return this._isClientDoneProcessing(timeout).then((clientFinished => this.getTransport().close(timeout).then((transportFlushed => clientFinished && transportFlushed))));
		}
		close(timeout) {
			return this.flush(timeout).then((result => {
				this.getOptions().enabled = false;
				return result;
			}));
		}
		setupIntegrations() {
			if (this._isEnabled() && !this._integrations.initialized) {
				this._integrations = setupIntegrations(this._options);
			}
		}
		getIntegration(integration) {
			try {
				return this._integrations[integration.id] || null;
			} catch (_oO) {
				logger.warn(`Cannot retrieve integration ${integration.id} from the current Client`);
				return null;
			}
		}
		_updateSessionFromEvent(session, event) {
			let crashed = false;
			let errored = false;
			const exceptions = event.exception && event.exception.values;
			if (exceptions) {
				errored = true;
				for (const ex of exceptions) {
					const mechanism = ex.mechanism;
					if (mechanism && mechanism.handled === false) {
						crashed = true;
						break;
					}
				}
			}
			const sessionNonTerminal = session.status === 'ok';
			const shouldUpdateAndSend = sessionNonTerminal && session.errors === 0 || sessionNonTerminal && crashed;
			if (shouldUpdateAndSend) {
				session.update(Object.assign(Object.assign({}, crashed && {
					status: 'crashed'
				}), {
					errors: session.errors || Number(errored || crashed)
				}));
				this.captureSession(session);
			}
		}
		_sendSession(session) {
			this._getBackend().sendSession(session);
		}
		_isClientDoneProcessing(timeout) {
			return new SyncPromise((resolve => {
				let ticked = 0;
				const tick = 1;
				const interval = setInterval((() => {
					if (this._numProcessing == 0) {
						clearInterval(interval);
						resolve(true);
					} else {
						ticked += tick;
						if (timeout && ticked >= timeout) {
							clearInterval(interval);
							resolve(false);
						}
					}
				}), tick);
			}));
		}
		_getBackend() {
			return this._backend;
		}
		_isEnabled() {
			return this.getOptions().enabled !== false && this._dsn !== undefined;
		}
		_prepareEvent(event, scope, hint) {
			const {normalizeDepth = 3} = this.getOptions();
			const prepared = Object.assign(Object.assign({}, event), {
				event_id: event.event_id || (hint && hint.event_id ? hint.event_id : uuid4()),
				timestamp: event.timestamp || dateTimestampInSeconds()
			});
			this._applyClientOptions(prepared);
			this._applyIntegrationsMetadata(prepared);
			let finalScope = scope;
			if (hint && hint.captureContext) {
				finalScope = Scope.clone(finalScope).update(hint.captureContext);
			}
			let result = resolvedSyncPromise(prepared);
			if (finalScope) {
				result = finalScope.applyToEvent(prepared, hint);
			}
			return result.then((evt => {
				if (evt) {
					evt.sdkProcessingMetadata = Object.assign(Object.assign({}, evt.sdkProcessingMetadata), {
						normalizeDepth: normalize(normalizeDepth)
					});
				}
				if (typeof normalizeDepth === 'number' && normalizeDepth > 0) {
					return this._normalizeEvent(evt, normalizeDepth);
				}
				return evt;
			}));
		}
		_normalizeEvent(event, depth) {
			if (!event) {
				return null;
			}
			const normalized = Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, event), event.breadcrumbs && {
				breadcrumbs: event.breadcrumbs.map((b => Object.assign(Object.assign({}, b), b.data && {
					data: normalize(b.data, depth)
				})))
			}), event.user && {
				user: normalize(event.user, depth)
			}), event.contexts && {
				contexts: normalize(event.contexts, depth)
			}), event.extra && {
				extra: normalize(event.extra, depth)
			});
			if (event.contexts && event.contexts.trace) {
				normalized.contexts.trace = event.contexts.trace;
			}
			event.sdkProcessingMetadata = Object.assign(Object.assign({}, event.sdkProcessingMetadata), {
				baseClientNormalized: true
			});
			return normalized;
		}
		_applyClientOptions(event) {
			const options = this.getOptions();
			const {environment, release, dist, maxValueLength = 250} = options;
			if (!('environment' in event)) {
				event.environment = 'environment' in options ? environment : 'production';
			}
			if (event.release === undefined && release !== undefined) {
				event.release = release;
			}
			if (event.dist === undefined && dist !== undefined) {
				event.dist = dist;
			}
			if (event.message) {
				event.message = truncate(event.message, maxValueLength);
			}
			const exception = event.exception && event.exception.values && event.exception.values[0];
			if (exception && exception.value) {
				exception.value = truncate(exception.value, maxValueLength);
			}
			const request = event.request;
			if (request && request.url) {
				request.url = truncate(request.url, maxValueLength);
			}
		}
		_applyIntegrationsMetadata(event) {
			const integrationsArray = Object.keys(this._integrations);
			if (integrationsArray.length > 0) {
				event.sdk = event.sdk || {};
				event.sdk.integrations = [ ...event.sdk.integrations || [], ...integrationsArray ];
			}
		}
		_sendEvent(event) {
			this._getBackend().sendEvent(event);
		}
		_captureEvent(event, hint, scope) {
			return this._processEvent(event, hint, scope).then((finalEvent => finalEvent.event_id), (reason => {
				logger.error(reason);
				return undefined;
			}));
		}
		_processEvent(event, hint, scope) {
			const {beforeSend, sampleRate} = this.getOptions();
			const transport = this.getTransport();
			function recordLostEvent(outcome, category) {
				if (transport.recordLostEvent) {
					transport.recordLostEvent(outcome, category);
				}
			}
			if (!this._isEnabled()) {
				return rejectedSyncPromise(new SentryError('SDK not enabled, will not capture event.'));
			}
			const isTransaction = event.type === 'transaction';
			if (!isTransaction && typeof sampleRate === 'number' && Math.random() > sampleRate) {
				recordLostEvent('sample_rate', 'event');
				return rejectedSyncPromise(new SentryError(`Discarding event because it's not included in the random sample (sampling rate = ${sampleRate})`));
			}
			return this._prepareEvent(event, scope, hint).then((prepared => {
				if (prepared === null) {
					recordLostEvent('event_processor', event.type || 'event');
					throw new SentryError('An event processor returned null, will not send event.');
				}
				const isInternalException = hint && hint.data && hint.data.__sentry__ === true;
				if (isInternalException || isTransaction || !beforeSend) {
					return prepared;
				}
				const beforeSendResult = beforeSend(prepared, hint);
				return _ensureBeforeSendRv(beforeSendResult);
			})).then((processedEvent => {
				if (processedEvent === null) {
					recordLostEvent('before_send', event.type || 'event');
					throw new SentryError('`beforeSend` returned `null`, will not send event.');
				}
				const session = scope && scope.getSession && scope.getSession();
				if (!isTransaction && session) {
					this._updateSessionFromEvent(session, processedEvent);
				}
				this._sendEvent(processedEvent);
				return processedEvent;
			})).then(null, (reason => {
				if (reason instanceof SentryError) {
					throw reason;
				}
				this.captureException(reason, {
					data: {
						__sentry__: true
					},
					originalException: reason
				});
				throw new SentryError(`Event processing pipeline threw an error, original event will not be sent. Details have been sent as a new event.\nReason: ${reason}`);
			}));
		}
		_process(promise) {
			this._numProcessing += 1;
			void promise.then((value => {
				this._numProcessing -= 1;
				return value;
			}), (reason => {
				this._numProcessing -= 1;
				return reason;
			}));
		}
	}
	function _ensureBeforeSendRv(rv) {
		const nullErr = '`beforeSend` method has to return `null` or a valid event.';
		if (isThenable(rv)) {
			return rv.then((event => {
				if (!(isPlainObject(event) || event === null)) {
					throw new SentryError(nullErr);
				}
				return event;
			}), (e => {
				throw new SentryError(`beforeSend rejected with ${e}`);
			}));
		} else if (!(isPlainObject(rv) || rv === null)) {
			throw new SentryError(nullErr);
		}
		return rv;
	}
	class NoopTransport {
		sendEvent(_) {
			return resolvedSyncPromise({
				reason: 'NoopTransport: Event has been skipped because no Dsn is configured.',
				status: 'skipped'
			});
		}
		close(_) {
			return resolvedSyncPromise(true);
		}
	}
	class BaseBackend {
		constructor(options) {
			this._options = options;
			if (!this._options.dsn) {
				logger.warn('No DSN provided, backend will not do anything.');
			}
			this._transport = this._setupTransport();
		}
		eventFromException(_exception, _hint) {
			throw new SentryError('Backend has to implement `eventFromException` method');
		}
		eventFromMessage(_message, _level, _hint) {
			throw new SentryError('Backend has to implement `eventFromMessage` method');
		}
		sendEvent(event) {
			void this._transport.sendEvent(event).then(null, (reason => {
				if (isDebugBuild()) {
					logger.error('Error while sending event:', reason);
				}
			}));
		}
		sendSession(session) {
			if (!this._transport.sendSession) {
				if (isDebugBuild()) {
					logger.warn("Dropping session because custom transport doesn't implement sendSession");
				}
				return;
			}
			void this._transport.sendSession(session).then(null, (reason => {
				if (isDebugBuild()) {
					logger.error('Error while sending session:', reason);
				}
			}));
		}
		getTransport() {
			return this._transport;
		}
		_setupTransport() {
			return new NoopTransport;
		}
	}
	function getSdkMetadataForEnvelopeHeader(api) {
		if (!api.metadata || !api.metadata.sdk) {
			return;
		}
		const {name, version} = api.metadata.sdk;
		return {
			name,
			version
		};
	}
	function enhanceEventWithSdkInfo(event, sdkInfo) {
		if (!sdkInfo) {
			return event;
		}
		event.sdk = event.sdk || {};
		event.sdk.name = event.sdk.name || sdkInfo.name;
		event.sdk.version = event.sdk.version || sdkInfo.version;
		event.sdk.integrations = [ ...event.sdk.integrations || [], ...sdkInfo.integrations || [] ];
		event.sdk.packages = [ ...event.sdk.packages || [], ...sdkInfo.packages || [] ];
		return event;
	}
	function sessionToSentryRequest(session, api) {
		const sdkInfo = getSdkMetadataForEnvelopeHeader(api);
		const envelopeHeaders = Object.assign(Object.assign({
			sent_at: (new Date).toISOString()
		}, sdkInfo && {
			sdk: sdkInfo
		}), !!api.tunnel && {
			dsn: dsnToString(api.dsn)
		});
		const type = 'aggregates' in session ? 'sessions' : 'session';
		const envelopeItem = [ {
			type
		}, session ];
		const envelope = createEnvelope(envelopeHeaders, [ envelopeItem ]);
		return {
			body: serializeEnvelope(envelope),
			type,
			url: getEnvelopeEndpointWithUrlEncodedAuth(api.dsn, api.tunnel)
		};
	}
	function eventToSentryRequest(event, api) {
		const sdkInfo = getSdkMetadataForEnvelopeHeader(api);
		const eventType = event.type || 'event';
		const useEnvelope = eventType === 'transaction' || !!api.tunnel;
		const {transactionSampling} = event.sdkProcessingMetadata || {};
		const {method: samplingMethod, rate: sampleRate} = transactionSampling || {};
		enhanceEventWithSdkInfo(event, api.metadata.sdk);
		event.tags = event.tags || {};
		event.extra = event.extra || {};
		if (!(event.sdkProcessingMetadata && event.sdkProcessingMetadata.baseClientNormalized)) {
			event.tags.skippedNormalization = true;
			event.extra.normalizeDepth = event.sdkProcessingMetadata ? event.sdkProcessingMetadata.normalizeDepth : 'unset';
		}
		delete event.sdkProcessingMetadata;
		let body;
		try {
			body = JSON.stringify(event);
		} catch (err) {
			event.tags.JSONStringifyError = true;
			event.extra.JSONStringifyError = err;
			try {
				body = JSON.stringify(normalize(event));
			} catch (newErr) {
				const innerErr = newErr;
				body = JSON.stringify({
					message: 'JSON.stringify error after renormalization',
					extra: {
						message: innerErr.message,
						stack: innerErr.stack
					}
				});
			}
		}
		const req = {
			body,
			type: eventType,
			url: useEnvelope ? getEnvelopeEndpointWithUrlEncodedAuth(api.dsn, api.tunnel) : getStoreEndpointWithUrlEncodedAuth(api.dsn)
		};
		if (useEnvelope) {
			const envelopeHeaders = Object.assign(Object.assign({
				event_id: event.event_id,
				sent_at: (new Date).toISOString()
			}, sdkInfo && {
				sdk: sdkInfo
			}), !!api.tunnel && {
				dsn: dsnToString(api.dsn)
			});
			const eventItem = [ {
				type: eventType,
				sample_rates: [ {
					id: samplingMethod,
					rate: sampleRate
				} ]
			}, req.body ];
			const envelope = createEnvelope(envelopeHeaders, [ eventItem ]);
			req.body = serializeEnvelope(envelope);
		}
		return req;
	}
	function initAndBind(clientClass, options) {
		if (options.debug === true) {
			logger.enable();
		}
		const hub = getCurrentHub();
		const scope = hub.getScope();
		if (scope) {
			scope.update(options.initialScope);
		}
		const client = new clientClass(options);
		hub.bindClient(client);
	}
	const SDK_VERSION = '6.18.2';
	let originalFunctionToString;
	class FunctionToString {
		constructor() {
			this.name = FunctionToString.id;
		}
		setupOnce() {
			originalFunctionToString = Function.prototype.toString;
			Function.prototype.toString = function(...args) {
				const context = getOriginalFunction(this) || this;
				return originalFunctionToString.apply(context, args);
			};
		}
	}
	FunctionToString.id = 'FunctionToString';
	const DEFAULT_IGNORE_ERRORS = [ /^Script error\.?$/, /^Javascript error: Script error\.? on line 0$/ ];
	class InboundFilters {
		constructor(_options = {}) {
			this._options = _options;
			this.name = InboundFilters.id;
		}
		setupOnce() {
			addGlobalEventProcessor((event => {
				const hub = getCurrentHub();
				if (!hub) {
					return event;
				}
				const self = hub.getIntegration(InboundFilters);
				if (self) {
					const client = hub.getClient();
					const clientOptions = client ? client.getOptions() : {};
					const options = typeof self._mergeOptions === 'function' ? self._mergeOptions(clientOptions) : {};
					if (typeof self._shouldDropEvent !== 'function') {
						return event;
					}
					return self._shouldDropEvent(event, options) ? null : event;
				}
				return event;
			}));
		}
		_shouldDropEvent(event, options) {
			if (this._isSentryError(event, options)) {
				if (isDebugBuild()) {
					logger.warn(`Event dropped due to being internal Sentry Error.\nEvent: ${getEventDescription(event)}`);
				}
				return true;
			}
			if (this._isIgnoredError(event, options)) {
				if (isDebugBuild()) {
					logger.warn(`Event dropped due to being matched by \`ignoreErrors\` option.\nEvent: ${getEventDescription(event)}`);
				}
				return true;
			}
			if (this._isDeniedUrl(event, options)) {
				if (isDebugBuild()) {
					logger.warn(`Event dropped due to being matched by \`denyUrls\` option.\nEvent: ${getEventDescription(event)}.\nUrl: ${this._getEventFilterUrl(event)}`);
				}
				return true;
			}
			if (!this._isAllowedUrl(event, options)) {
				if (isDebugBuild()) {
					logger.warn(`Event dropped due to not being matched by \`allowUrls\` option.\nEvent: ${getEventDescription(event)}.\nUrl: ${this._getEventFilterUrl(event)}`);
				}
				return true;
			}
			return false;
		}
		_isSentryError(event, options) {
			if (!options.ignoreInternal) {
				return false;
			}
			try {
				return event.exception.values[0].type === 'SentryError';
			} catch (e) {}
			return false;
		}
		_isIgnoredError(event, options) {
			if (!options.ignoreErrors || !options.ignoreErrors.length) {
				return false;
			}
			return this._getPossibleEventMessages(event).some((message => options.ignoreErrors.some((pattern => isMatchingPattern(message, pattern)))));
		}
		_isDeniedUrl(event, options) {
			if (!options.denyUrls || !options.denyUrls.length) {
				return false;
			}
			const url = this._getEventFilterUrl(event);
			return !url ? false : options.denyUrls.some((pattern => isMatchingPattern(url, pattern)));
		}
		_isAllowedUrl(event, options) {
			if (!options.allowUrls || !options.allowUrls.length) {
				return true;
			}
			const url = this._getEventFilterUrl(event);
			return !url ? true : options.allowUrls.some((pattern => isMatchingPattern(url, pattern)));
		}
		_mergeOptions(clientOptions = {}) {
			return {
				allowUrls: [ ...this._options.whitelistUrls || [], ...this._options.allowUrls || [], ...clientOptions.whitelistUrls || [], ...clientOptions.allowUrls || [] ],
				denyUrls: [ ...this._options.blacklistUrls || [], ...this._options.denyUrls || [], ...clientOptions.blacklistUrls || [], ...clientOptions.denyUrls || [] ],
				ignoreErrors: [ ...this._options.ignoreErrors || [], ...clientOptions.ignoreErrors || [], ...DEFAULT_IGNORE_ERRORS ],
				ignoreInternal: typeof this._options.ignoreInternal !== 'undefined' ? this._options.ignoreInternal : true
			};
		}
		_getPossibleEventMessages(event) {
			if (event.message) {
				return [ event.message ];
			}
			if (event.exception) {
				try {
					const {type = '', value = ''} = event.exception.values && event.exception.values[0] || {};
					return [ `${value}`, `${type}: ${value}` ];
				} catch (oO) {
					if (isDebugBuild()) {
						logger.error(`Cannot extract message for event ${getEventDescription(event)}`);
					}
					return [];
				}
			}
			return [];
		}
		_getLastValidUrl(frames = []) {
			for (let i = frames.length - 1; i >= 0; i--) {
				const frame = frames[i];
				if (frame && frame.filename !== '<anonymous>' && frame.filename !== '[native code]') {
					return frame.filename || null;
				}
			}
			return null;
		}
		_getEventFilterUrl(event) {
			try {
				if (event.stacktrace) {
					return this._getLastValidUrl(event.stacktrace.frames);
				}
				let frames;
				try {
					frames = event.exception.values[0].stacktrace.frames;
				} catch (e) {}
				return frames ? this._getLastValidUrl(frames) : null;
			} catch (oO) {
				if (isDebugBuild()) {
					logger.error(`Cannot extract url for event ${getEventDescription(event)}`);
				}
				return null;
			}
		}
	}
	InboundFilters.id = 'InboundFilters';
	var CoreIntegrations = Object.freeze({
		__proto__: null,
		FunctionToString,
		InboundFilters
	});
	const UNKNOWN_FUNCTION = '?';
	const OPERA10_PRIORITY = 10;
	const OPERA11_PRIORITY = 20;
	const CHROME_PRIORITY = 30;
	const WINJS_PRIORITY = 40;
	const GECKO_PRIORITY = 50;
	function createFrame(filename, func, lineno, colno) {
		const frame = {
			filename,
			function: func,
			in_app: true
		};
		if (lineno !== undefined) {
			frame.lineno = lineno;
		}
		if (colno !== undefined) {
			frame.colno = colno;
		}
		return frame;
	}
	const chromeRegex = /^\s*at (?:(.*?) ?\((?:address at )?)?((?:file|https?|blob|chrome-extension|address|native|eval|webpack|<anonymous>|[-a-z]+:|.*bundle|\/).*?)(?::(\d+))?(?::(\d+))?\)?\s*$/i;
	const chromeEvalRegex = /\((\S*)(?::(\d+))(?::(\d+))\)/;
	const chrome = line => {
		const parts = chromeRegex.exec(line);
		if (parts) {
			const isEval = parts[2] && parts[2].indexOf('eval') === 0;
			if (isEval) {
				const subMatch = chromeEvalRegex.exec(parts[2]);
				if (subMatch) {
					parts[2] = subMatch[1];
					parts[3] = subMatch[2];
					parts[4] = subMatch[3];
				}
			}
			const [func, filename] = extractSafariExtensionDetails(parts[1] || UNKNOWN_FUNCTION, parts[2]);
			return createFrame(filename, func, parts[3] ? +parts[3] : undefined, parts[4] ? +parts[4] : undefined);
		}
		return;
	};
	const chromeStackParser = [ CHROME_PRIORITY, chrome ];
	const geckoREgex = /^\s*(.*?)(?:\((.*?)\))?(?:^|@)?((?:file|https?|blob|chrome|webpack|resource|moz-extension|capacitor).*?:\/.*?|\[native code\]|[^@]*(?:bundle|\d+\.js)|\/[\w\-. /=]+)(?::(\d+))?(?::(\d+))?\s*$/i;
	const geckoEvalRegex = /(\S+) line (\d+)(?: > eval line \d+)* > eval/i;
	const gecko = line => {
		const parts = geckoREgex.exec(line);
		if (parts) {
			const isEval = parts[3] && parts[3].indexOf(' > eval') > -1;
			if (isEval) {
				const subMatch = geckoEvalRegex.exec(parts[3]);
				if (subMatch) {
					parts[1] = parts[1] || 'eval';
					parts[3] = subMatch[1];
					parts[4] = subMatch[2];
					parts[5] = '';
				}
			}
			let filename = parts[3];
			let func = parts[1] || UNKNOWN_FUNCTION;
			[func, filename] = extractSafariExtensionDetails(func, filename);
			return createFrame(filename, func, parts[4] ? +parts[4] : undefined, parts[5] ? +parts[5] : undefined);
		}
		return;
	};
	const geckoStackParser = [ GECKO_PRIORITY, gecko ];
	const winjsRegex = /^\s*at (?:((?:\[object object\])?.+) )?\(?((?:file|ms-appx|https?|webpack|blob):.*?):(\d+)(?::(\d+))?\)?\s*$/i;
	const winjs = line => {
		const parts = winjsRegex.exec(line);
		return parts ? createFrame(parts[2], parts[1] || UNKNOWN_FUNCTION, +parts[3], parts[4] ? +parts[4] : undefined) : undefined;
	};
	const winjsStackParser = [ WINJS_PRIORITY, winjs ];
	const opera10Regex = / line (\d+).*script (?:in )?(\S+)(?:: in function (\S+))?$/i;
	const opera10 = line => {
		const parts = opera10Regex.exec(line);
		return parts ? createFrame(parts[2], parts[3] || UNKNOWN_FUNCTION, +parts[1]) : undefined;
	};
	const opera10StackParser = [ OPERA10_PRIORITY, opera10 ];
	const opera11Regex = / line (\d+), column (\d+)\s*(?:in (?:<anonymous function: ([^>]+)>|([^)]+))\(.*\))? in (.*):\s*$/i;
	const opera11 = line => {
		const parts = opera11Regex.exec(line);
		return parts ? createFrame(parts[5], parts[3] || parts[4] || UNKNOWN_FUNCTION, +parts[1], +parts[2]) : undefined;
	};
	const opera11StackParser = [ OPERA11_PRIORITY, opera11 ];
	const extractSafariExtensionDetails = (func, filename) => {
		const isSafariExtension = func.indexOf('safari-extension') !== -1;
		const isSafariWebExtension = func.indexOf('safari-web-extension') !== -1;
		return isSafariExtension || isSafariWebExtension ? [ func.indexOf('@') !== -1 ? func.split('@')[0] : UNKNOWN_FUNCTION, isSafariExtension ? `safari-extension:${filename}` : `safari-web-extension:${filename}` ] : [ func, filename ];
	};
	function exceptionFromError(ex) {
		const frames = parseStackFrames(ex);
		const exception = {
			type: ex && ex.name,
			value: extractMessage(ex)
		};
		if (frames.length) {
			exception.stacktrace = {
				frames
			};
		}
		if (exception.type === undefined && exception.value === '') {
			exception.value = 'Unrecoverable error caught';
		}
		return exception;
	}
	function eventFromPlainObject(exception, syntheticException, isUnhandledRejection) {
		const event = {
			exception: {
				values: [ {
					type: isEvent(exception) ? exception.constructor.name : isUnhandledRejection ? 'UnhandledRejection' : 'Error',
					value: `Non-Error ${isUnhandledRejection ? 'promise rejection' : 'exception'} captured with keys: ${extractExceptionKeysForMessage(exception)}`
				} ]
			},
			extra: {
				__serialized__: normalizeToSize(exception)
			}
		};
		if (syntheticException) {
			const frames = parseStackFrames(syntheticException);
			if (frames.length) {
				event.stacktrace = {
					frames
				};
			}
		}
		return event;
	}
	function eventFromError(ex) {
		return {
			exception: {
				values: [ exceptionFromError(ex) ]
			}
		};
	}
	function parseStackFrames(ex) {
		const stacktrace = ex.stacktrace || ex.stack || '';
		const popSize = getPopSize(ex);
		try {
			return createStackParser(opera10StackParser, opera11StackParser, chromeStackParser, winjsStackParser, geckoStackParser)(stacktrace, popSize);
		} catch (e) {}
		return [];
	}
	const reactMinifiedRegexp = /Minified React error #\d+;/i;
	function getPopSize(ex) {
		if (ex) {
			if (typeof ex.framesToPop === 'number') {
				return ex.framesToPop;
			}
			if (reactMinifiedRegexp.test(ex.message)) {
				return 1;
			}
		}
		return 0;
	}
	function extractMessage(ex) {
		const message = ex && ex.message;
		if (!message) {
			return 'No error message';
		}
		if (message.error && typeof message.error.message === 'string') {
			return message.error.message;
		}
		return message;
	}
	function eventFromException(exception, hint, attachStacktrace) {
		const syntheticException = hint && hint.syntheticException || undefined;
		const event = eventFromUnknownInput(exception, syntheticException, attachStacktrace);
		addExceptionMechanism(event);
		event.level = exports.Severity.Error;
		if (hint && hint.event_id) {
			event.event_id = hint.event_id;
		}
		return resolvedSyncPromise(event);
	}
	function eventFromMessage(message, level = exports.Severity.Info, hint, attachStacktrace) {
		const syntheticException = hint && hint.syntheticException || undefined;
		const event = eventFromString(message, syntheticException, attachStacktrace);
		event.level = level;
		if (hint && hint.event_id) {
			event.event_id = hint.event_id;
		}
		return resolvedSyncPromise(event);
	}
	function eventFromUnknownInput(exception, syntheticException, attachStacktrace, isUnhandledRejection) {
		let event;
		if (isErrorEvent(exception) && exception.error) {
			const errorEvent = exception;
			return eventFromError(errorEvent.error);
		}
		if (isDOMError(exception) || isDOMException(exception)) {
			const domException = exception;
			if ('stack' in exception) {
				event = eventFromError(exception);
			} else {
				const name = domException.name || (isDOMError(domException) ? 'DOMError' : 'DOMException');
				const message = domException.message ? `${name}: ${domException.message}` : name;
				event = eventFromString(message, syntheticException, attachStacktrace);
				addExceptionTypeValue(event, message);
			}
			if ('code' in domException) {
				event.tags = Object.assign(Object.assign({}, event.tags), {
					'DOMException.code': `${domException.code}`
				});
			}
			return event;
		}
		if (isError(exception)) {
			return eventFromError(exception);
		}
		if (isPlainObject(exception) || isEvent(exception)) {
			const objectException = exception;
			event = eventFromPlainObject(objectException, syntheticException, isUnhandledRejection);
			addExceptionMechanism(event, {
				synthetic: true
			});
			return event;
		}
		event = eventFromString(exception, syntheticException, attachStacktrace);
		addExceptionTypeValue(event, `${exception}`, undefined);
		addExceptionMechanism(event, {
			synthetic: true
		});
		return event;
	}
	function eventFromString(input, syntheticException, attachStacktrace) {
		const event = {
			message: input
		};
		if (attachStacktrace && syntheticException) {
			const frames = parseStackFrames(syntheticException);
			if (frames.length) {
				event.stacktrace = {
					frames
				};
			}
		}
		return event;
	}
	const global$4 = getGlobalObject();
	let cachedFetchImpl;
	function getNativeFetchImplementation() {
		if (cachedFetchImpl) {
			return cachedFetchImpl;
		}
		if (isNativeFetch(global$4.fetch)) {
			return cachedFetchImpl = global$4.fetch.bind(global$4);
		}
		const document = global$4.document;
		let fetchImpl = global$4.fetch;
		if (document && typeof document.createElement === 'function') {
			try {
				const sandbox = document.createElement('iframe');
				sandbox.hidden = true;
				document.head.appendChild(sandbox);
				const contentWindow = sandbox.contentWindow;
				if (contentWindow && contentWindow.fetch) {
					fetchImpl = contentWindow.fetch;
				}
				document.head.removeChild(sandbox);
			} catch (e) {
				if (isDebugBuild()) {
					logger.warn('Could not create sandbox iframe for pure fetch check, bailing to window.fetch: ', e);
				}
			}
		}
		return cachedFetchImpl = fetchImpl.bind(global$4);
	}
	function sendReport(url, body) {
		const isRealNavigator = Object.prototype.toString.call(global$4 && global$4.navigator) === '[object Navigator]';
		const hasSendBeacon = isRealNavigator && typeof global$4.navigator.sendBeacon === 'function';
		if (hasSendBeacon) {
			const sendBeacon = global$4.navigator.sendBeacon.bind(global$4.navigator);
			return sendBeacon(url, body);
		}
		if (supportsFetch()) {
			const fetch = getNativeFetchImplementation();
			return forget(fetch(url, {
				body,
				method: 'POST',
				credentials: 'omit',
				keepalive: true
			}));
		}
	}
	function requestTypeToCategory(ty) {
		const tyStr = ty;
		return tyStr === 'event' ? 'error' : tyStr;
	}
	const global$3 = getGlobalObject();
	class BaseTransport {
		constructor(options) {
			this.options = options;
			this._buffer = makePromiseBuffer(30);
			this._rateLimits = {};
			this._outcomes = {};
			this._api = initAPIDetails(options.dsn, options._metadata, options.tunnel);
			this.url = getStoreEndpointWithUrlEncodedAuth(this._api.dsn);
			if (this.options.sendClientReports && global$3.document) {
				global$3.document.addEventListener('visibilitychange', (() => {
					if (global$3.document.visibilityState === 'hidden') {
						this._flushOutcomes();
					}
				}));
			}
		}
		sendEvent(event) {
			return this._sendRequest(eventToSentryRequest(event, this._api), event);
		}
		sendSession(session) {
			return this._sendRequest(sessionToSentryRequest(session, this._api), session);
		}
		close(timeout) {
			return this._buffer.drain(timeout);
		}
		recordLostEvent(reason, category) {
			var _a;
			if (!this.options.sendClientReports) {
				return;
			}
			const key = `${requestTypeToCategory(category)}:${reason}`;
			logger.log(`Adding outcome: ${key}`);
			this._outcomes[key] = (_a = this._outcomes[key], _a !== null && _a !== void 0 ? _a : 0) + 1;
		}
		_flushOutcomes() {
			if (!this.options.sendClientReports) {
				return;
			}
			const outcomes = this._outcomes;
			this._outcomes = {};
			if (!Object.keys(outcomes).length) {
				logger.log('No outcomes to flush');
				return;
			}
			logger.log(`Flushing outcomes:\n${JSON.stringify(outcomes, null, 2)}`);
			const url = getEnvelopeEndpointWithUrlEncodedAuth(this._api.dsn, this._api.tunnel);
			const discardedEvents = Object.keys(outcomes).map((key => {
				const [category, reason] = key.split(':');
				return {
					reason,
					category,
					quantity: outcomes[key]
				};
			}));
			const envelope = createClientReportEnvelope(discardedEvents, this._api.tunnel && dsnToString(this._api.dsn));
			try {
				sendReport(url, serializeEnvelope(envelope));
			} catch (e) {
				logger.error(e);
			}
		}
		_handleResponse({requestType, response, headers, resolve, reject}) {
			const status = eventStatusFromHttpCode(response.status);
			const limited = this._handleRateLimit(headers);
			if (limited && isDebugBuild()) {
				logger.warn(`Too many ${requestType} requests, backing off until: ${this._disabledUntil(requestType)}`);
			}
			if (status === 'success') {
				resolve({
					status
				});
				return;
			}
			reject(response);
		}
		_disabledUntil(requestType) {
			const category = requestTypeToCategory(requestType);
			return this._rateLimits[category] || this._rateLimits.all;
		}
		_isRateLimited(requestType) {
			return this._disabledUntil(requestType) > new Date(Date.now());
		}
		_handleRateLimit(headers) {
			const now = Date.now();
			const rlHeader = headers['x-sentry-rate-limits'];
			const raHeader = headers['retry-after'];
			if (rlHeader) {
				for (const limit of rlHeader.trim().split(',')) {
					const parameters = limit.split(':', 2);
					const headerDelay = parseInt(parameters[0], 10);
					const delay = (!isNaN(headerDelay) ? headerDelay : 60) * 1000;
					for (const category of parameters[1].split(';')) {
						this._rateLimits[category || 'all'] = new Date(now + delay);
					}
				}
				return true;
			} else if (raHeader) {
				this._rateLimits.all = new Date(now + parseRetryAfterHeader(raHeader, now));
				return true;
			}
			return false;
		}
	}
	class FetchTransport extends BaseTransport {
		constructor(options, fetchImpl = getNativeFetchImplementation()) {
			super(options);
			this._fetch = fetchImpl;
		}
		_sendRequest(sentryRequest, originalPayload) {
			if (this._isRateLimited(sentryRequest.type)) {
				this.recordLostEvent('ratelimit_backoff', sentryRequest.type);
				return Promise.reject({
					event: originalPayload,
					type: sentryRequest.type,
					reason: `Transport for ${sentryRequest.type} requests locked till ${this._disabledUntil(sentryRequest.type)} due to too many requests.`,
					status: 429
				});
			}
			const options = {
				body: sentryRequest.body,
				method: 'POST',
				referrerPolicy: supportsReferrerPolicy() ? 'origin' : ''
			};
			if (this.options.fetchParameters !== undefined) {
				Object.assign(options, this.options.fetchParameters);
			}
			if (this.options.headers !== undefined) {
				options.headers = this.options.headers;
			}
			return this._buffer.add((() => new SyncPromise(((resolve, reject) => {
				void this._fetch(sentryRequest.url, options).then((response => {
					const headers = {
						'x-sentry-rate-limits': response.headers.get('X-Sentry-Rate-Limits'),
						'retry-after': response.headers.get('Retry-After')
					};
					this._handleResponse({
						requestType: sentryRequest.type,
						response,
						headers,
						resolve,
						reject
					});
				})).catch(reject);
			})))).then(undefined, (reason => {
				if (reason instanceof SentryError) {
					this.recordLostEvent('queue_overflow', sentryRequest.type);
				} else {
					this.recordLostEvent('network_error', sentryRequest.type);
				}
				throw reason;
			}));
		}
	}
	class XHRTransport extends BaseTransport {
		_sendRequest(sentryRequest, originalPayload) {
			if (this._isRateLimited(sentryRequest.type)) {
				this.recordLostEvent('ratelimit_backoff', sentryRequest.type);
				return Promise.reject({
					event: originalPayload,
					type: sentryRequest.type,
					reason: `Transport for ${sentryRequest.type} requests locked till ${this._disabledUntil(sentryRequest.type)} due to too many requests.`,
					status: 429
				});
			}
			return this._buffer.add((() => new SyncPromise(((resolve, reject) => {
				const request = new XMLHttpRequest;
				request.onreadystatechange = () => {
					if (request.readyState === 4) {
						const headers = {
							'x-sentry-rate-limits': request.getResponseHeader('X-Sentry-Rate-Limits'),
							'retry-after': request.getResponseHeader('Retry-After')
						};
						this._handleResponse({
							requestType: sentryRequest.type,
							response: request,
							headers,
							resolve,
							reject
						});
					}
				};
				request.open('POST', sentryRequest.url);
				for (const header in this.options.headers) {
					if (Object.prototype.hasOwnProperty.call(this.options.headers, header)) {
						request.setRequestHeader(header, this.options.headers[header]);
					}
				}
				request.send(sentryRequest.body);
			})))).then(undefined, (reason => {
				if (reason instanceof SentryError) {
					this.recordLostEvent('queue_overflow', sentryRequest.type);
				} else {
					this.recordLostEvent('network_error', sentryRequest.type);
				}
				throw reason;
			}));
		}
	}
	var index = Object.freeze({
		__proto__: null,
		BaseTransport,
		FetchTransport,
		XHRTransport
	});
	class BrowserBackend extends BaseBackend {
		eventFromException(exception, hint) {
			return eventFromException(exception, hint, this._options.attachStacktrace);
		}
		eventFromMessage(message, level = exports.Severity.Info, hint) {
			return eventFromMessage(message, level, hint, this._options.attachStacktrace);
		}
		_setupTransport() {
			if (!this._options.dsn) {
				return super._setupTransport();
			}
			const transportOptions = Object.assign(Object.assign({}, this._options.transportOptions), {
				dsn: this._options.dsn,
				tunnel: this._options.tunnel,
				sendClientReports: this._options.sendClientReports,
				_metadata: this._options._metadata
			});
			if (this._options.transport) {
				return new this._options.transport(transportOptions);
			}
			if (supportsFetch()) {
				return new FetchTransport(transportOptions);
			}
			return new XHRTransport(transportOptions);
		}
	}
	const global$2 = getGlobalObject();
	let ignoreOnError = 0;
	function shouldIgnoreOnError() {
		return ignoreOnError > 0;
	}
	function ignoreNextOnError() {
		ignoreOnError += 1;
		setTimeout((() => {
			ignoreOnError -= 1;
		}));
	}
	function wrap$1(fn, options = {}, before) {
		if (typeof fn !== 'function') {
			return fn;
		}
		try {
			const wrapper = fn.__sentry_wrapped__;
			if (wrapper) {
				return wrapper;
			}
			if (getOriginalFunction(fn)) {
				return fn;
			}
		} catch (e) {
			return fn;
		}
		const sentryWrapped = function() {
			const args = Array.prototype.slice.call(arguments);
			try {
				if (before && typeof before === 'function') {
					before.apply(this, arguments);
				}
				const wrappedArguments = args.map((arg => wrap$1(arg, options)));
				return fn.apply(this, wrappedArguments);
			} catch (ex) {
				ignoreNextOnError();
				withScope((scope => {
					scope.addEventProcessor((event => {
						if (options.mechanism) {
							addExceptionTypeValue(event, undefined, undefined);
							addExceptionMechanism(event, options.mechanism);
						}
						event.extra = Object.assign(Object.assign({}, event.extra), {
							arguments: args
						});
						return event;
					}));
					captureException(ex);
				}));
				throw ex;
			}
		};
		try {
			for (const property in fn) {
				if (Object.prototype.hasOwnProperty.call(fn, property)) {
					sentryWrapped[property] = fn[property];
				}
			}
		} catch (_oO) {}
		markFunctionWrapped(sentryWrapped, fn);
		addNonEnumerableProperty(fn, '__sentry_wrapped__', sentryWrapped);
		try {
			const descriptor = Object.getOwnPropertyDescriptor(sentryWrapped, 'name');
			if (descriptor.configurable) {
				Object.defineProperty(sentryWrapped, 'name', {
					get() {
						return fn.name;
					}
				});
			}
		} catch (_oO) {}
		return sentryWrapped;
	}
	function injectReportDialog(options = {}) {
		if (!global$2.document) {
			return;
		}
		if (!options.eventId) {
			if (isDebugBuild()) {
				logger.error('Missing eventId option in showReportDialog call');
			}
			return;
		}
		if (!options.dsn) {
			if (isDebugBuild()) {
				logger.error('Missing dsn option in showReportDialog call');
			}
			return;
		}
		const script = global$2.document.createElement('script');
		script.async = true;
		script.src = getReportDialogEndpoint(options.dsn, options);
		if (options.onLoad) {
			script.onload = options.onLoad;
		}
		const injectionPoint = global$2.document.head || global$2.document.body;
		if (injectionPoint) {
			injectionPoint.appendChild(script);
		}
	}
	class GlobalHandlers {
		constructor(options) {
			this.name = GlobalHandlers.id;
			this._installFunc = {
				onerror: _installGlobalOnErrorHandler,
				onunhandledrejection: _installGlobalOnUnhandledRejectionHandler
			};
			this._options = Object.assign({
				onerror: true,
				onunhandledrejection: true
			}, options);
		}
		setupOnce() {
			Error.stackTraceLimit = 50;
			const options = this._options;
			for (const key in options) {
				const installFunc = this._installFunc[key];
				if (installFunc && options[key]) {
					globalHandlerLog(key);
					installFunc();
					this._installFunc[key] = undefined;
				}
			}
		}
	}
	GlobalHandlers.id = 'GlobalHandlers';
	function _installGlobalOnErrorHandler() {
		addInstrumentationHandler('error', (data => {
			const [hub, attachStacktrace] = getHubAndAttachStacktrace();
			if (!hub.getIntegration(GlobalHandlers)) {
				return;
			}
			const {msg, url, line, column, error} = data;
			if (shouldIgnoreOnError() || error && error.__sentry_own_request__) {
				return;
			}
			const event = error === undefined && isString(msg) ? _eventFromIncompleteOnError(msg, url, line, column) : _enhanceEventWithInitialFrame(eventFromUnknownInput(error || msg, undefined, attachStacktrace, false), url, line, column);
			event.level = exports.Severity.Error;
			addMechanismAndCapture(hub, error, event, 'onerror');
		}));
	}
	function _installGlobalOnUnhandledRejectionHandler() {
		addInstrumentationHandler('unhandledrejection', (e => {
			const [hub, attachStacktrace] = getHubAndAttachStacktrace();
			if (!hub.getIntegration(GlobalHandlers)) {
				return;
			}
			let error = e;
			try {
				if ('reason' in e) {
					error = e.reason;
				} else if ('detail' in e && 'reason' in e.detail) {
					error = e.detail.reason;
				}
			} catch (_oO) {}
			if (shouldIgnoreOnError() || error && error.__sentry_own_request__) {
				return true;
			}
			const event = isPrimitive(error) ? _eventFromRejectionWithPrimitive(error) : eventFromUnknownInput(error, undefined, attachStacktrace, true);
			event.level = exports.Severity.Error;
			addMechanismAndCapture(hub, error, event, 'onunhandledrejection');
			return;
		}));
	}
	function _eventFromRejectionWithPrimitive(reason) {
		return {
			exception: {
				values: [ {
					type: 'UnhandledRejection',
					value: `Non-Error promise rejection captured with value: ${String(reason)}`
				} ]
			}
		};
	}
	function _eventFromIncompleteOnError(msg, url, line, column) {
		const ERROR_TYPES_RE = /^(?:[Uu]ncaught (?:exception: )?)?(?:((?:Eval|Internal|Range|Reference|Syntax|Type|URI|)Error): )?(.*)$/i;
		let message = isErrorEvent(msg) ? msg.message : msg;
		let name = 'Error';
		const groups = message.match(ERROR_TYPES_RE);
		if (groups) {
			name = groups[1];
			message = groups[2];
		}
		const event = {
			exception: {
				values: [ {
					type: name,
					value: message
				} ]
			}
		};
		return _enhanceEventWithInitialFrame(event, url, line, column);
	}
	function _enhanceEventWithInitialFrame(event, url, line, column) {
		const e = event.exception = event.exception || {};
		const ev = e.values = e.values || [];
		const ev0 = ev[0] = ev[0] || {};
		const ev0s = ev0.stacktrace = ev0.stacktrace || {};
		const ev0sf = ev0s.frames = ev0s.frames || [];
		const colno = isNaN(parseInt(column, 10)) ? undefined : column;
		const lineno = isNaN(parseInt(line, 10)) ? undefined : line;
		const filename = isString(url) && url.length > 0 ? url : getLocationHref();
		if (ev0sf.length === 0) {
			ev0sf.push({
				colno,
				filename,
				function: '?',
				in_app: true,
				lineno
			});
		}
		return event;
	}
	function globalHandlerLog(type) {
		if (isDebugBuild()) {
			logger.log(`Global Handler attached: ${type}`);
		}
	}
	function addMechanismAndCapture(hub, error, event, type) {
		addExceptionMechanism(event, {
			handled: false,
			type
		});
		hub.captureEvent(event, {
			originalException: error
		});
	}
	function getHubAndAttachStacktrace() {
		const hub = getCurrentHub();
		const client = hub.getClient();
		const attachStacktrace = client && client.getOptions().attachStacktrace;
		return [ hub, attachStacktrace ];
	}
	const DEFAULT_EVENT_TARGET = [ 'EventTarget', 'Window', 'Node', 'ApplicationCache', 'AudioTrackList', 'ChannelMergerNode', 'CryptoOperation', 'EventSource', 'FileReader', 'HTMLUnknownElement', 'IDBDatabase', 'IDBRequest', 'IDBTransaction', 'KeyOperation', 'MediaController', 'MessagePort', 'ModalWindow', 'Notification', 'SVGElementInstance', 'Screen', 'TextTrack', 'TextTrackCue', 'TextTrackList', 'WebSocket', 'WebSocketWorker', 'Worker', 'XMLHttpRequest', 'XMLHttpRequestEventTarget', 'XMLHttpRequestUpload' ];
	class TryCatch {
		constructor(options) {
			this.name = TryCatch.id;
			this._options = Object.assign({
				XMLHttpRequest: true,
				eventTarget: true,
				requestAnimationFrame: true,
				setInterval: true,
				setTimeout: true
			}, options);
		}
		setupOnce() {
			const global = getGlobalObject();
			if (this._options.setTimeout) {
				fill(global, 'setTimeout', _wrapTimeFunction);
			}
			if (this._options.setInterval) {
				fill(global, 'setInterval', _wrapTimeFunction);
			}
			if (this._options.requestAnimationFrame) {
				fill(global, 'requestAnimationFrame', _wrapRAF);
			}
			if (this._options.XMLHttpRequest && 'XMLHttpRequest' in global) {
				fill(XMLHttpRequest.prototype, 'send', _wrapXHR);
			}
			const eventTargetOption = this._options.eventTarget;
			if (eventTargetOption) {
				const eventTarget = Array.isArray(eventTargetOption) ? eventTargetOption : DEFAULT_EVENT_TARGET;
				eventTarget.forEach(_wrapEventTarget);
			}
		}
	}
	TryCatch.id = 'TryCatch';
	function _wrapTimeFunction(original) {
		return function(...args) {
			const originalCallback = args[0];
			args[0] = wrap$1(originalCallback, {
				mechanism: {
					data: {
						function: getFunctionName(original)
					},
					handled: true,
					type: 'instrument'
				}
			});
			return original.apply(this, args);
		};
	}
	function _wrapRAF(original) {
		return function(callback) {
			return original.call(this, wrap$1(callback, {
				mechanism: {
					data: {
						function: 'requestAnimationFrame',
						handler: getFunctionName(original)
					},
					handled: true,
					type: 'instrument'
				}
			}));
		};
	}
	function _wrapXHR(originalSend) {
		return function(...args) {
			const xhr = this;
			const xmlHttpRequestProps = [ 'onload', 'onerror', 'onprogress', 'onreadystatechange' ];
			xmlHttpRequestProps.forEach((prop => {
				if (prop in xhr && typeof xhr[prop] === 'function') {
					fill(xhr, prop, (function(original) {
						const wrapOptions = {
							mechanism: {
								data: {
									function: prop,
									handler: getFunctionName(original)
								},
								handled: true,
								type: 'instrument'
							}
						};
						const originalFunction = getOriginalFunction(original);
						if (originalFunction) {
							wrapOptions.mechanism.data.handler = getFunctionName(originalFunction);
						}
						return wrap$1(original, wrapOptions);
					}));
				}
			}));
			return originalSend.apply(this, args);
		};
	}
	function _wrapEventTarget(target) {
		const global = getGlobalObject();
		const proto = global[target] && global[target].prototype;
		if (!proto || !proto.hasOwnProperty || !proto.hasOwnProperty('addEventListener')) {
			return;
		}
		fill(proto, 'addEventListener', (function(original) {
			return function(eventName, fn, options) {
				try {
					if (typeof fn.handleEvent === 'function') {
						fn.handleEvent = wrap$1(fn.handleEvent.bind(fn), {
							mechanism: {
								data: {
									function: 'handleEvent',
									handler: getFunctionName(fn),
									target
								},
								handled: true,
								type: 'instrument'
							}
						});
					}
				} catch (err) {}
				return original.call(this, eventName, wrap$1(fn, {
					mechanism: {
						data: {
							function: 'addEventListener',
							handler: getFunctionName(fn),
							target
						},
						handled: true,
						type: 'instrument'
					}
				}), options);
			};
		}));
		fill(proto, 'removeEventListener', (function(originalRemoveEventListener) {
			return function(eventName, fn, options) {
				const wrappedEventHandler = fn;
				try {
					const originalEventHandler = wrappedEventHandler && wrappedEventHandler.__sentry_wrapped__;
					if (originalEventHandler) {
						originalRemoveEventListener.call(this, eventName, originalEventHandler, options);
					}
				} catch (e) {}
				return originalRemoveEventListener.call(this, eventName, wrappedEventHandler, options);
			};
		}));
	}
	class Breadcrumbs {
		constructor(options) {
			this.name = Breadcrumbs.id;
			this._options = Object.assign({
				console: true,
				dom: true,
				fetch: true,
				history: true,
				sentry: true,
				xhr: true
			}, options);
		}
		addSentryBreadcrumb(event) {
			if (!this._options.sentry) {
				return;
			}
			getCurrentHub().addBreadcrumb({
				category: `sentry.${event.type === 'transaction' ? 'transaction' : 'event'}`,
				event_id: event.event_id,
				level: event.level,
				message: getEventDescription(event)
			}, {
				event
			});
		}
		setupOnce() {
			if (this._options.console) {
				addInstrumentationHandler('console', _consoleBreadcrumb);
			}
			if (this._options.dom) {
				addInstrumentationHandler('dom', _domBreadcrumb(this._options.dom));
			}
			if (this._options.xhr) {
				addInstrumentationHandler('xhr', _xhrBreadcrumb);
			}
			if (this._options.fetch) {
				addInstrumentationHandler('fetch', _fetchBreadcrumb);
			}
			if (this._options.history) {
				addInstrumentationHandler('history', _historyBreadcrumb);
			}
		}
	}
	Breadcrumbs.id = 'Breadcrumbs';
	function _domBreadcrumb(dom) {
		function _innerDomBreadcrumb(handlerData) {
			let target;
			let keyAttrs = typeof dom === 'object' ? dom.serializeAttribute : undefined;
			if (typeof keyAttrs === 'string') {
				keyAttrs = [ keyAttrs ];
			}
			try {
				target = handlerData.event.target ? htmlTreeAsString(handlerData.event.target, keyAttrs) : htmlTreeAsString(handlerData.event, keyAttrs);
			} catch (e) {
				target = '<unknown>';
			}
			if (target.length === 0) {
				return;
			}
			getCurrentHub().addBreadcrumb({
				category: `ui.${handlerData.name}`,
				message: target
			}, {
				event: handlerData.event,
				name: handlerData.name,
				global: handlerData.global
			});
		}
		return _innerDomBreadcrumb;
	}
	function _consoleBreadcrumb(handlerData) {
		const breadcrumb = {
			category: 'console',
			data: {
				arguments: handlerData.args,
				logger: 'console'
			},
			level: severityFromString(handlerData.level),
			message: safeJoin(handlerData.args, ' ')
		};
		if (handlerData.level === 'assert') {
			if (handlerData.args[0] === false) {
				breadcrumb.message = `Assertion failed: ${safeJoin(handlerData.args.slice(1), ' ') || 'console.assert'}`;
				breadcrumb.data.arguments = handlerData.args.slice(1);
			} else {
				return;
			}
		}
		getCurrentHub().addBreadcrumb(breadcrumb, {
			input: handlerData.args,
			level: handlerData.level
		});
	}
	function _xhrBreadcrumb(handlerData) {
		if (handlerData.endTimestamp) {
			if (handlerData.xhr.__sentry_own_request__) {
				return;
			}
			const {method, url, status_code, body} = handlerData.xhr.__sentry_xhr__ || {};
			getCurrentHub().addBreadcrumb({
				category: 'xhr',
				data: {
					method,
					url,
					status_code
				},
				type: 'http'
			}, {
				xhr: handlerData.xhr,
				input: body
			});
			return;
		}
	}
	function _fetchBreadcrumb(handlerData) {
		if (!handlerData.endTimestamp) {
			return;
		}
		if (handlerData.fetchData.url.match(/sentry_key/) && handlerData.fetchData.method === 'POST') {
			return;
		}
		if (handlerData.error) {
			getCurrentHub().addBreadcrumb({
				category: 'fetch',
				data: handlerData.fetchData,
				level: exports.Severity.Error,
				type: 'http'
			}, {
				data: handlerData.error,
				input: handlerData.args
			});
		} else {
			getCurrentHub().addBreadcrumb({
				category: 'fetch',
				data: Object.assign(Object.assign({}, handlerData.fetchData), {
					status_code: handlerData.response.status
				}),
				type: 'http'
			}, {
				input: handlerData.args,
				response: handlerData.response
			});
		}
	}
	function _historyBreadcrumb(handlerData) {
		const global = getGlobalObject();
		let from = handlerData.from;
		let to = handlerData.to;
		const parsedLoc = parseUrl(global.location.href);
		let parsedFrom = parseUrl(from);
		const parsedTo = parseUrl(to);
		if (!parsedFrom.path) {
			parsedFrom = parsedLoc;
		}
		if (parsedLoc.protocol === parsedTo.protocol && parsedLoc.host === parsedTo.host) {
			to = parsedTo.relative;
		}
		if (parsedLoc.protocol === parsedFrom.protocol && parsedLoc.host === parsedFrom.host) {
			from = parsedFrom.relative;
		}
		getCurrentHub().addBreadcrumb({
			category: 'navigation',
			data: {
				from,
				to
			}
		});
	}
	const DEFAULT_KEY = 'cause';
	const DEFAULT_LIMIT = 5;
	class LinkedErrors {
		constructor(options = {}) {
			this.name = LinkedErrors.id;
			this._key = options.key || DEFAULT_KEY;
			this._limit = options.limit || DEFAULT_LIMIT;
		}
		setupOnce() {
			addGlobalEventProcessor(((event, hint) => {
				const self = getCurrentHub().getIntegration(LinkedErrors);
				return self ? _handler(self._key, self._limit, event, hint) : event;
			}));
		}
	}
	LinkedErrors.id = 'LinkedErrors';
	function _handler(key, limit, event, hint) {
		if (!event.exception || !event.exception.values || !hint || !isInstanceOf(hint.originalException, Error)) {
			return event;
		}
		const linkedErrors = _walkErrorTree(limit, hint.originalException, key);
		event.exception.values = [ ...linkedErrors, ...event.exception.values ];
		return event;
	}
	function _walkErrorTree(limit, error, key, stack = []) {
		if (!isInstanceOf(error[key], Error) || stack.length + 1 >= limit) {
			return stack;
		}
		const exception = exceptionFromError(error[key]);
		return _walkErrorTree(limit, error[key], key, [ exception, ...stack ]);
	}
	const global$1 = getGlobalObject();
	class UserAgent {
		constructor() {
			this.name = UserAgent.id;
		}
		setupOnce() {
			addGlobalEventProcessor((event => {
				if (getCurrentHub().getIntegration(UserAgent)) {
					if (!global$1.navigator && !global$1.location && !global$1.document) {
						return event;
					}
					const url = event.request && event.request.url || global$1.location && global$1.location.href;
					const {referrer} = global$1.document || {};
					const {userAgent} = global$1.navigator || {};
					const headers = Object.assign(Object.assign(Object.assign({}, event.request && event.request.headers), referrer && {
						Referer: referrer
					}), userAgent && {
						'User-Agent': userAgent
					});
					const request = Object.assign(Object.assign({}, url && {
						url
					}), {
						headers
					});
					return Object.assign(Object.assign({}, event), {
						request
					});
				}
				return event;
			}));
		}
	}
	UserAgent.id = 'UserAgent';
	class Dedupe {
		constructor() {
			this.name = Dedupe.id;
		}
		setupOnce(addGlobalEventProcessor, getCurrentHub) {
			addGlobalEventProcessor((currentEvent => {
				const self = getCurrentHub().getIntegration(Dedupe);
				if (self) {
					try {
						if (_shouldDropEvent(currentEvent, self._previousEvent)) {
							logger.warn('Event dropped due to being a duplicate of previously captured event.');
							return null;
						}
					} catch (_oO) {
						return self._previousEvent = currentEvent;
					}
					return self._previousEvent = currentEvent;
				}
				return currentEvent;
			}));
		}
	}
	Dedupe.id = 'Dedupe';
	function _shouldDropEvent(currentEvent, previousEvent) {
		if (!previousEvent) {
			return false;
		}
		if (_isSameMessageEvent(currentEvent, previousEvent)) {
			return true;
		}
		if (_isSameExceptionEvent(currentEvent, previousEvent)) {
			return true;
		}
		return false;
	}
	function _isSameMessageEvent(currentEvent, previousEvent) {
		const currentMessage = currentEvent.message;
		const previousMessage = previousEvent.message;
		if (!currentMessage && !previousMessage) {
			return false;
		}
		if (currentMessage && !previousMessage || !currentMessage && previousMessage) {
			return false;
		}
		if (currentMessage !== previousMessage) {
			return false;
		}
		if (!_isSameFingerprint(currentEvent, previousEvent)) {
			return false;
		}
		if (!_isSameStacktrace(currentEvent, previousEvent)) {
			return false;
		}
		return true;
	}
	function _isSameExceptionEvent(currentEvent, previousEvent) {
		const previousException = _getExceptionFromEvent(previousEvent);
		const currentException = _getExceptionFromEvent(currentEvent);
		if (!previousException || !currentException) {
			return false;
		}
		if (previousException.type !== currentException.type || previousException.value !== currentException.value) {
			return false;
		}
		if (!_isSameFingerprint(currentEvent, previousEvent)) {
			return false;
		}
		if (!_isSameStacktrace(currentEvent, previousEvent)) {
			return false;
		}
		return true;
	}
	function _isSameStacktrace(currentEvent, previousEvent) {
		let currentFrames = _getFramesFromEvent(currentEvent);
		let previousFrames = _getFramesFromEvent(previousEvent);
		if (!currentFrames && !previousFrames) {
			return true;
		}
		if (currentFrames && !previousFrames || !currentFrames && previousFrames) {
			return false;
		}
		currentFrames = currentFrames;
		previousFrames = previousFrames;
		if (previousFrames.length !== currentFrames.length) {
			return false;
		}
		for (let i = 0; i < previousFrames.length; i++) {
			const frameA = previousFrames[i];
			const frameB = currentFrames[i];
			if (frameA.filename !== frameB.filename || frameA.lineno !== frameB.lineno || frameA.colno !== frameB.colno || frameA.function !== frameB.function) {
				return false;
			}
		}
		return true;
	}
	function _isSameFingerprint(currentEvent, previousEvent) {
		let currentFingerprint = currentEvent.fingerprint;
		let previousFingerprint = previousEvent.fingerprint;
		if (!currentFingerprint && !previousFingerprint) {
			return true;
		}
		if (currentFingerprint && !previousFingerprint || !currentFingerprint && previousFingerprint) {
			return false;
		}
		currentFingerprint = currentFingerprint;
		previousFingerprint = previousFingerprint;
		try {
			return !!(currentFingerprint.join('') === previousFingerprint.join(''));
		} catch (_oO) {
			return false;
		}
	}
	function _getExceptionFromEvent(event) {
		return event.exception && event.exception.values && event.exception.values[0];
	}
	function _getFramesFromEvent(event) {
		const exception = event.exception;
		if (exception) {
			try {
				return exception.values[0].stacktrace.frames;
			} catch (_oO) {
				return undefined;
			}
		} else if (event.stacktrace) {
			return event.stacktrace.frames;
		}
		return undefined;
	}
	var BrowserIntegrations = Object.freeze({
		__proto__: null,
		GlobalHandlers,
		TryCatch,
		Breadcrumbs,
		LinkedErrors,
		UserAgent,
		Dedupe
	});
	class BrowserClient extends BaseClient {
		constructor(options = {}) {
			options._metadata = options._metadata || {};
			options._metadata.sdk = options._metadata.sdk || {
				name: 'sentry.javascript.browser',
				packages: [ {
					name: 'npm:@sentry/browser',
					version: SDK_VERSION
				} ],
				version: SDK_VERSION
			};
			super(BrowserBackend, options);
		}
		showReportDialog(options = {}) {
			const document = getGlobalObject().document;
			if (!document) {
				return;
			}
			if (!this._isEnabled()) {
				logger.error('Trying to call showReportDialog with Sentry Client disabled');
				return;
			}
			injectReportDialog(Object.assign(Object.assign({}, options), {
				dsn: options.dsn || this.getDsn()
			}));
		}
		_prepareEvent(event, scope, hint) {
			event.platform = event.platform || 'javascript';
			return super._prepareEvent(event, scope, hint);
		}
		_sendEvent(event) {
			const integration = this.getIntegration(Breadcrumbs);
			if (integration) {
				integration.addSentryBreadcrumb(event);
			}
			super._sendEvent(event);
		}
	}
	const defaultIntegrations = [ new InboundFilters, new FunctionToString, new TryCatch, new Breadcrumbs, new GlobalHandlers, new LinkedErrors, new Dedupe, new UserAgent ];
	function init(options = {}) {
		if (options.defaultIntegrations === undefined) {
			options.defaultIntegrations = defaultIntegrations;
		}
		if (options.release === undefined) {
			const window = getGlobalObject();
			if (window.SENTRY_RELEASE && window.SENTRY_RELEASE.id) {
				options.release = window.SENTRY_RELEASE.id;
			}
		}
		if (options.autoSessionTracking === undefined) {
			options.autoSessionTracking = true;
		}
		if (options.sendClientReports === undefined) {
			options.sendClientReports = true;
		}
		initAndBind(BrowserClient, options);
		if (options.autoSessionTracking) {
			startSessionTracking();
		}
	}
	function showReportDialog(options = {}) {
		const hub = getCurrentHub();
		const scope = hub.getScope();
		if (scope) {
			options.user = Object.assign(Object.assign({}, scope.getUser()), options.user);
		}
		if (!options.eventId) {
			options.eventId = hub.lastEventId();
		}
		const client = hub.getClient();
		if (client) {
			client.showReportDialog(options);
		}
	}
	function lastEventId() {
		return getCurrentHub().lastEventId();
	}
	function forceLoad() {}
	function onLoad(callback) {
		callback();
	}
	function flush(timeout) {
		const client = getCurrentHub().getClient();
		if (client) {
			return client.flush(timeout);
		}
		if (isDebugBuild()) {
			logger.warn('Cannot flush events. No client defined.');
		}
		return resolvedSyncPromise(false);
	}
	function close(timeout) {
		const client = getCurrentHub().getClient();
		if (client) {
			return client.close(timeout);
		}
		if (isDebugBuild()) {
			logger.warn('Cannot flush events and disable SDK. No client defined.');
		}
		return resolvedSyncPromise(false);
	}
	function wrap(fn) {
		return wrap$1(fn)();
	}
	function startSessionOnHub(hub) {
		hub.startSession({
			ignoreDuration: true
		});
		hub.captureSession();
	}
	function startSessionTracking() {
		const window = getGlobalObject();
		const document = window.document;
		if (typeof document === 'undefined') {
			if (isDebugBuild()) {
				logger.warn('Session tracking in non-browser environment with @sentry/browser is not supported.');
			}
			return;
		}
		const hub = getCurrentHub();
		if (!hub.captureSession) {
			return;
		}
		startSessionOnHub(hub);
		addInstrumentationHandler('history', (({from, to}) => {
			if (!(from === undefined || from === to)) {
				startSessionOnHub(getCurrentHub());
			}
		}));
	}
	const SDK_NAME = 'sentry.javascript.browser';
	let windowIntegrations = {};
	const _window = getGlobalObject();
	if (_window.Sentry && _window.Sentry.Integrations) {
		windowIntegrations = _window.Sentry.Integrations;
	}
	const INTEGRATIONS = Object.assign(Object.assign(Object.assign({}, windowIntegrations), CoreIntegrations), BrowserIntegrations);
	exports.BrowserClient = BrowserClient;
	exports.Hub = Hub;
	exports.Integrations = INTEGRATIONS;
	exports.SDK_NAME = SDK_NAME;
	exports.SDK_VERSION = SDK_VERSION;
	exports.Scope = Scope;
	exports.Session = Session;
	exports.Transports = index;
	exports.addBreadcrumb = addBreadcrumb;
	exports.addGlobalEventProcessor = addGlobalEventProcessor;
	exports.captureEvent = captureEvent;
	exports.captureException = captureException;
	exports.captureMessage = captureMessage;
	exports.close = close;
	exports.configureScope = configureScope;
	exports.defaultIntegrations = defaultIntegrations;
	exports.eventFromException = eventFromException;
	exports.eventFromMessage = eventFromMessage;
	exports.flush = flush;
	exports.forceLoad = forceLoad;
	exports.getCurrentHub = getCurrentHub;
	exports.getHubFromCarrier = getHubFromCarrier;
	exports.init = init;
	exports.injectReportDialog = injectReportDialog;
	exports.lastEventId = lastEventId;
	exports.makeMain = makeMain;
	exports.onLoad = onLoad;
	exports.setContext = setContext;
	exports.setExtra = setExtra;
	exports.setExtras = setExtras;
	exports.setTag = setTag;
	exports.setTags = setTags;
	exports.setUser = setUser;
	exports.showReportDialog = showReportDialog;
	exports.startTransaction = startTransaction;
	exports.withScope = withScope;
	exports.wrap = wrap;
	return exports;
}({});
