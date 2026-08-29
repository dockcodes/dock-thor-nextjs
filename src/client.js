'use client';

import { startCollector, collectorConfig } from '@dockcodes/dock-thor/browser';
import { browserOptionsFromEnvironment } from './shared.js';

let stop = null;

/**
 * Starts browser error collection.
 *
 * Off unless `NEXT_PUBLIC_THOR_JS_ERRORS` is `true`, because the collector is
 * a decision about visitors' pages, not a default. Errors go to your own
 * route, which forwards them with the project key — a browser cannot hold that
 * key without publishing it.
 *
 * Mount it once, in the root layout:
 *
 *     'use client';
 *     import { ThorBrowserReporting } from '@dockcodes/dock-thor-next/client';
 */
export function startThorBrowserReporting(overrides = {}) {
    const options = browserOptionsFromEnvironment(overrides);

    if (!options.enabled || typeof window === 'undefined') {
        return () => {};
    }

    // React strict mode mounts effects twice; a second collector would double
    // every report.
    stop?.();
    stop = startCollector(collectorConfig(options));

    return () => {
        stop?.();
        stop = null;
    };
}

/**
 * A component for the root layout. It renders nothing and only sets the
 * listeners up.
 */
export function ThorBrowserReporting(props = {}) {
    if (typeof window !== 'undefined' && !stop) {
        startThorBrowserReporting(props);
    }

    return null;
}

/**
 * Reports an error you caught yourself, through the same route.
 * Useful from `app/global-error.jsx` and React error boundaries.
 */
export function captureBrowserException(error, overrides = {}) {
    const options = browserOptionsFromEnvironment(overrides);

    if (!options.enabled || typeof window === 'undefined' || !error) {
        return;
    }

    if (window.DockThor) {
        window.DockThor.captureException(error);

        return;
    }

    startThorBrowserReporting(overrides);
    window.DockThor?.captureException(error);
}
