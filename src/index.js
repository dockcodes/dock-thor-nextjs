import { DockThorClient, browserEvent } from '@dockcodes/dock-thor';
import { createBrowserErrorHandler } from './browser-route.js';
import { describeNextRequest, optionsFromEnvironment, tagsFromContext } from './shared.js';

export { browserEvent };
export { optionsFromEnvironment, browserOptionsFromEnvironment } from './shared.js';

let client = null;

/**
 * Builds the server client. Call it from `register()` in `instrumentation.ts`,
 * which Next runs once per server bundle before anything is handled.
 */
export function initThor(options = {}) {
    client = new DockThorClient(optionsFromEnvironment(options));

    return client;
}

export function getThor() {
    return client ?? initThor();
}

/**
 * The `onRequestError` export of `instrumentation.ts`.
 *
 * Next calls it for every error it catches — server components, route
 * handlers, server actions — and this is the only hook that sees all of them.
 * It runs after the response has failed, so the report never delays a request.
 *
 *     export const onRequestError = thorRequestError();
 */
export function thorRequestError({ shouldReport = () => true } = {}) {
    return async function onRequestError(error, request, context) {
        const thor = getThor();

        if (!thor.enabled || !shouldReport(error, context)) {
            return;
        }

        const described = describeNextRequest(request);

        await thor.captureException(error, {
            request: described.http,
            user: described.user,
            tags: tagsFromContext(context),
        });
    };
}

/**
 * Wraps a route handler so a throw is reported and then rethrown.
 *
 * `onRequestError` already covers App Router handlers; this is for Pages
 * Router API routes and for anywhere you want the error tagged as yours.
 */
export function withThor(handler, { tags = {} } = {}) {
    return async function thorWrappedHandler(...args) {
        try {
            return await handler(...args);
        } catch (error) {
            const thor = getThor();

            if (thor.enabled) {
                const described = describeNextRequest(args[0]);

                thor.report(thor.captureException(error, {
                    request: described.http,
                    user: described.user,
                    tags,
                }));
            }

            throw error;
        }
    };
}

/**
 * The route that receives JavaScript errors from the browser.
 *
 * A browser cannot hold the project private key, so the page reports here and
 * the server forwards. Mount it at `app/api/thor/browser/route.js`:
 *
 *     export const POST = createBrowserErrorRoute();
 *     export const runtime = 'nodejs';
 */
export function createBrowserErrorRoute(options = {}) {
    return createBrowserErrorHandler(getThor, options);
}

export { createBrowserErrorHandler } from './browser-route.js';
