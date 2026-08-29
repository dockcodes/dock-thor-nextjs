/**
 * Configuration read once from the environment, plus the process-wide client.
 *
 * Next.js runs several isolated bundles per deployment — the Node server, the
 * edge middleware, each edge route — and each gets its own module instance.
 * The singleton is therefore per bundle, not per deployment, which is what we
 * want: an edge bundle must never pull in the Node client.
 */
export function optionsFromEnvironment(overrides = {}) {
    const env = globalThis.process?.env ?? {};

    return {
        token: env.THOR_TOKEN,
        privateKey: env.THOR_PRIVATE_KEY,
        url: env.THOR_URL,
        environment: env.THOR_ENVIRONMENT ?? env.VERCEL_ENV ?? env.NODE_ENV,
        release: env.THOR_RELEASE ?? env.VERCEL_GIT_COMMIT_SHA,
        tracesSampleRate: number(env.THOR_TRACES_SAMPLE_RATE, 0),
        sampleRate: number(env.THOR_SAMPLE_RATE, 1),
        sendDefaultPii: env.THOR_SEND_DEFAULT_PII === 'true',
        ...overrides,
    };
}

export function browserOptionsFromEnvironment(overrides = {}) {
    const env = globalThis.process?.env ?? {};

    return {
        enabled: env.NEXT_PUBLIC_THOR_JS_ERRORS === 'true',
        endpoint: env.NEXT_PUBLIC_THOR_JS_ENDPOINT ?? '/api/thor/browser',
        release: env.NEXT_PUBLIC_THOR_RELEASE,
        sampleRate: number(env.NEXT_PUBLIC_THOR_JS_SAMPLE_RATE, 1),
        ...overrides,
    };
}

function number(value, fallback) {
    const parsed = Number.parseFloat(value);

    return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Next 15 hands `onRequestError` a context describing where the error came
 * from. Turning it into tags is what makes a report readable in the panel:
 * without them a server component error and an API route error look alike.
 */
export function tagsFromContext(context = {}) {
    return dropEmpty({
        router: context.routerKind,
        route: context.routePath,
        route_type: context.routeType,
        render_source: context.renderSource,
        revalidate_reason: context.revalidateReason,
    });
}

export function describeNextRequest(request) {
    if (!request) {
        return { http: undefined, user: undefined };
    }

    const headers = normaliseHeaders(request.headers);
    const forwarded = headers['x-forwarded-for'];

    return {
        http: dropEmpty({
            url: request.url ?? headers['x-url'],
            method: (request.method ?? 'GET').toUpperCase(),
            headers: safeHeaders(headers),
        }),
        user: dropEmpty({
            ip_address: forwarded ? forwarded.split(',')[0].trim() : headers['x-real-ip'],
            agent: headers['user-agent'],
        }),
    };
}

const SENSITIVE = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-dockthor-token']);

function normaliseHeaders(headers) {
    if (!headers) {
        return {};
    }

    if (typeof headers.entries === 'function') {
        return Object.fromEntries([...headers.entries()].map(([key, value]) => [key.toLowerCase(), value]));
    }

    return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

function safeHeaders(headers) {
    return Object.fromEntries(Object.entries(headers).filter(([name]) => !SENSITIVE.has(name)));
}

function dropEmpty(object) {
    const entries = Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== '');

    return entries.length === 0 ? undefined : Object.fromEntries(entries);
}
