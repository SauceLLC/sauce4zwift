import express from 'express';
import expressWebSocketPatch from 'express-ws';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const wd = path.dirname(fileURLToPath(import.meta.url));


function wrapWebSocketMessage(ws, callback) {
    return async function(msg) {
        let type, data, uid = -1;
        try {
            ({type, data, uid} = JSON.parse(msg));
            ws.send(JSON.stringify({
                type: 'response',
                success: true,
                uid,
                data: await callback(type, data),
            }));
        } catch(e) {
            console.warn("WebSocket request error:", e);
            ws.send(JSON.stringify({
                type: 'response',
                success: false,
                uid,
                error: e.message,
            }));
        }
    };
}


function start(monitor, port) {
    const app = express();
    expressWebSocketPatch(app);
    const cacheDisabled = 'no-cache, no-store, must-revalidate';
    const router = express.Router();
    router.use('/', express.static(`${wd}/../pages`, {index: 'index.html'}));
    router.use('/pages/', express.static(`${wd}/../pages`, {
        cacheControl: true,
        setHeaders: res => res.setHeader('Cache-Control', cacheDisabled)
    }));
    router.use('/shared/', express.static(`${wd}/../shared`, {
        cacheControl: true,
        setHeaders: res => res.setHeader('Cache-Control', cacheDisabled)
    }));
    router.ws('/api/ws', (ws, req) => {
        const subs = new Map();
        ws.on('message', wrapWebSocketMessage(ws, (type, {method, arg}) => {
            if (type !== 'request') {
                throw new TypeError('Invalid type');
            }
            if (method === 'subscribe') {
                const {event, subId} = arg;
                if (!event) {
                    throw new TypeError('"event" arg required');
                }
                const cb = data => {
                    ws.send(JSON.stringify({
                        success: true,
                        type: 'event',
                        data,
                        uid: subId,
                    }));
                };
                subs.set(subId, {event, cb});
                monitor.on(event, cb);
                return;
            } else if (method === 'unsubscribe') {
                const subId = arg;
                if (!subId) {
                    throw new TypeError('"subId" arg required');
                }
                const {event, cb} = subs.get(subId);
                subs.delete(subId);
                monitor.off(event, cb);
                return;
            } else {
                throw new TypeError('Invalid "method"');
            }
        }));
        ws.on('close', () => {
            for (const {event, cb} of subs.values()) {
                monitor.off(event, cb);
            }
            subs.clear();
        });
    });
    router.all('*', (req, res) => res.status(404).send(`File Not Found: "${req.path}"\n`));
    app.use(router);
    app.listen(port);
}

export default {start};
