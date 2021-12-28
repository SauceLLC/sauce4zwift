import express from 'express';
import expressWebSocketPatch from 'express-ws';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';

let _rejectCount = 0;
process.on('unhandledrejection', ev => {
    console.error(ev);
    if (_rejectCount++ > 100) {
        console.error("Reject count too high, killing process.");
        process.exit(1);
    }
});

const wd = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 1080;


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
    }
}

async function start(monitor) {
    const app = express();
    expressWebSocketPatch(app);
    const cacheDisabled = 'no-cache, no-store, must-revalidate';
    const cacheEnabled = 'public, max-age=31536000, s-maxage=900';
    const router = express.Router();
    router.use('/pages/', express.static(`${wd}/../pages`, {
        cacheControl: true,
        setHeaders: res => res.setHeader('Cache-Control', cacheDisabled)
    }));
    router.use('/shared/', express.static(`${wd}/../shared`, {
        cacheControl: true,
        setHeaders: res => res.setHeader('Cache-Control', cacheDisabled)
    }));
    router.ws('/api/ws', (ws, req) => {
        let subIdInc = 1;
        console.info("client connection", ws, req);
        const subs = new Map();
        ws.on('message', wrapWebSocketMessage(ws, (type, {method, arg}) => {
            if (type !== 'request') {
                throw new TypeError('Invalid type');
            }
            if (method === 'subscribe') {
                const event = arg;
                if (!event) {
                    throw new TypeError('"event" arg required');
                }
                const subId = subIdInc++;
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
                return subId;
            } else if (method === 'unsubscribe') {
                const subId = arg;
                if (!subId) {
                    throw new TypeError('"subId" arg required');
                }
                const {event, cb} = subs.get(subId);
                subs.delete(subId);
                monitor.off(event, cb);
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
    /*router.get('/api/subscribe', (req, res, next) => {
        console.log('client subscribe');
        res.setHeader('content-type': 'application/json');
        res.end(JSON.stringify({success: true}));
    });*/

    router.all('*', (req, res) => res.status(404).send(`File Not Found: "${req.path}"\n`));
    app.use(router);
    app.listen(PORT);
}

export default {start};
