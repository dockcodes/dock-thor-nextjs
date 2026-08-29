import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';

import { createBrowserErrorHandler, initThor, thorRequestError, withThor } from '../src/index.js';
import { initThor as initEdgeThor, withThorMiddleware } from '../src/edge.js';

async function withPanel(run) {
    const received = [];
    const server = createServer((req, res) => {
        const chunks = [];

        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            const raw = Buffer.concat(chunks);
            const body = req.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw;

            received.push(JSON.parse(body.toString('utf8')));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
        await run(`http://127.0.0.1:${server.address().port}`, received);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

function request(overrides = {}) {
    return {
        url: 'https://shop.test/orders/8123',
        method: 'GET',
        headers: {
            host: 'shop.test',
            'user-agent': 'Firefox/130',
            'x-forwarded-for': '203.0.113.7, 10.0.0.1',
            cookie: 'session=secret',
            authorization: 'Bearer nope',
        },
        ...overrides,
    };
}

test('the edge entry point pulls in no node built-ins', () => {
    for (const file of ['src/edge.js', 'src/browser-route.js', 'src/shared.js', 'src/client.js']) {
        const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

        assert.deepEqual([...source.matchAll(/from '(node:[^']+)'/g)], [], `${file} imports a node built-in`);
        assert.equal(source.includes("from '@dockcodes/dock-thor'"), false,
            `${file} must import the edge entry, not the node one`);
    }
});

test('onRequestError reports with the route context as tags', async () => {
    await withPanel(async (url, received) => {
        initThor({ token: 'tok', privateKey: 'key', url, environment: 'production' });

        const handler = thorRequestError();

        await handler(new TypeError('boom'), request(), {
            routerKind: 'App Router',
            routePath: '/orders/[id]',
            routeType: 'render',
        });

        const [payload] = received;

        assert.equal(payload.exception.values[0].type, 'TypeError');
        assert.equal(payload.tags.route, '/orders/[id]');
        assert.equal(payload.tags.router, 'App Router');
        assert.equal(payload.request.url, 'https://shop.test/orders/8123');
        assert.equal(payload.request.headers.cookie, undefined, 'cookies are not reported');
        assert.equal(payload.request.headers.authorization, undefined);
        assert.equal(payload.user, undefined, 'no IP address without sendDefaultPii');
    });
});

test('the visitor address is reported only when sendDefaultPii is on', async () => {
    await withPanel(async (url, received) => {
        initThor({ token: 'tok', privateKey: 'key', url, sendDefaultPii: true });

        await thorRequestError()(new Error('boom'), request(), {});

        assert.equal(received[0].user.ip_address, '203.0.113.7', 'the proxy header wins over the socket');
        assert.equal(received[0].user.agent, 'Firefox/130');
    });
});

test('withThor reports and rethrows, never swallows', async () => {
    await withPanel(async (url, received) => {
        const thor = initThor({ token: 'tok', privateKey: 'key', url });
        const handler = withThor(async () => {
            throw new Error('route blew up');
        });

        await assert.rejects(() => handler(request()), /route blew up/);
        await thor.flush();

        assert.equal(received[0].exception.values[0].value, 'route blew up');
    });
});

test('edge middleware awaits its report before the error bubbles', async () => {
    await withPanel(async (url, received) => {
        initEdgeThor({ token: 'tok', privateKey: 'key', url });

        const middleware = withThorMiddleware(async () => {
            throw new Error('middleware blew up');
        });

        await assert.rejects(() => middleware(request()), /middleware blew up/);

        assert.equal(received.length, 1, 'an edge invocation can freeze on return, so the send is awaited');
        assert.equal(received[0].tags.runtime, 'edge');
        assert.equal(received[0].contexts.runtime[0], 'edge');
    });
});

test('the browser route forwards a report and always answers 202', async () => {
    await withPanel(async (url, received) => {
        const thor = initThor({ token: 'tok', privateKey: 'key', url, environment: 'production' });
        const handle = createBrowserErrorHandler(() => thor);

        const good = await handle(new Request('https://shop.test/api/thor/browser', {
            method: 'POST',
            headers: { referer: 'https://shop.test/cart', 'user-agent': 'Firefox/130' },
            body: JSON.stringify({ type: 'TypeError', message: 'null is not an object', url: 'https://shop.test/cart' }),
        }));

        assert.equal(good.status, 202);
        await thor.flush();

        assert.equal(received[0].platform, 'javascript');
        assert.equal(received[0].tags.source, 'browser');
        assert.equal(received[0].environment, 'production');

        const junk = await handle(new Request('https://shop.test/api/thor/browser', {
            method: 'POST',
            body: 'not json',
        }));

        assert.equal(junk.status, 202, 'a bad payload looks exactly like a good one');
        await thor.flush();
        assert.equal(received.length, 1);
    });
});

test('the browser route drops oversized bodies and rate limits an address', async () => {
    await withPanel(async (url, received) => {
        const thor = initThor({ token: 'tok', privateKey: 'key', url });
        const handle = createBrowserErrorHandler(() => thor, { rateLimit: 3 });

        const post = (body, address = '203.0.113.9') => handle(new Request('https://shop.test/api/thor/browser', {
            method: 'POST',
            headers: { 'x-forwarded-for': address },
            body,
        }));

        const huge = await post(JSON.stringify({ message: 'x'.repeat(20000) }));

        assert.equal(huge.status, 202);
        await thor.flush();
        assert.equal(received.length, 0, 'a 20 KB report never reaches the panel');

        for (let i = 0; i < 6; i += 1) {
            await post(JSON.stringify({ message: `error ${i}` }));
        }

        await thor.flush();
        assert.equal(received.length, 3, 'the fourth report from one address onwards is dropped');
    });
});
