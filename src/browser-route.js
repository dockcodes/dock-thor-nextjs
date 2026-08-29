/**
 * The route that receives JavaScript errors from the browser.
 *
 * Kept free of any `node:` import so the same handler can be mounted on the
 * edge runtime, where an import of the Node client would fail to bundle.
 */

const MAX_BODY_BYTES = 16384;

export function createBrowserErrorHandler(resolveClient, { rateLimit = 20, windowMs = 60000 } = {}) {
    const seen = new Map();

    return async function handleBrowserError(request) {
        // One answer for every outcome: a caller learns nothing about the guards.
        const accepted = Response.json({ success: true }, { status: 202 });
        const thor = resolveClient();

        if (!thor.enabled) {
            return accepted;
        }

        const body = await request.text().catch(() => '');

        if (body === '' || body.length > MAX_BODY_BYTES) {
            return accepted;
        }

        if (!withinRateLimit(seen, clientKey(request), rateLimit, windowMs)) {
            return accepted;
        }

        let payload = null;

        try {
            payload = JSON.parse(body);
        } catch {
            return accepted;
        }

        thor.report(thor.captureBrowserReport(payload, {
            pageUrl: request.headers.get('referer'),
            userAgent: request.headers.get('user-agent'),
        }));

        return accepted;
    };
}

function clientKey(request) {
    const forwarded = request.headers.get('x-forwarded-for');

    return forwarded?.split(',')[0].trim() ?? request.headers.get('x-real-ip') ?? 'unknown';
}

/**
 * A fixed window per address, held in module memory. It is per instance rather
 * than global, which is the point: it exists to stop one looping page from
 * flooding the panel, not to be an authorisation boundary.
 */
function withinRateLimit(seen, key, limit, windowMs) {
    const now = Date.now();
    const entry = seen.get(key);

    if (!entry || now - entry.since > windowMs) {
        seen.set(key, { since: now, count: 1 });

        if (seen.size > 10000) {
            seen.clear();
        }

        return true;
    }

    entry.count += 1;

    return entry.count <= limit;
}
