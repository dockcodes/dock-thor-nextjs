# @dockcodes/dock-thor-next

Next.js integration for [DockTHOR](https://dock.codes). Reports server errors,
edge and middleware errors, request timings and — optionally — JavaScript
errors from the browser.

Works with the App Router and the Pages Router, Next 14 and 15.

## Installation

```bash
npm install @dockcodes/dock-thor-next
```

```dotenv
THOR_TOKEN=project-token
THOR_PRIVATE_KEY=project-private-key
THOR_URL=https://thor.dock.codes
THOR_TRACES_SAMPLE_RATE=0.2
```

`THOR_PRIVATE_KEY` has no `NEXT_PUBLIC_` prefix, and must never get one: a
public environment variable is inlined into the client bundle, where anyone can
read it. Without a token and a key the package is inert — no requests, no
errors.

## Server errors

`instrumentation.ts` in the project root:

```ts
import { initThor, thorRequestError } from '@dockcodes/dock-thor-next';

export function register() {
    initThor();
}

export const onRequestError = thorRequestError();
```

`onRequestError` is the only hook that sees every error Next catches — server
components, route handlers, server actions, streaming renders. Next calls it
after the response has already failed, so reporting never delays a request.

Each report is tagged with the route context Next supplies, which is what makes
the panel readable: `router` (App / Pages), `route` (`/orders/[id]`, the
pattern rather than the concrete path), `route_type` and `render_source`.

For Pages Router API routes, or anywhere you want an explicit wrapper:

```ts
import { withThor } from '@dockcodes/dock-thor-next';

export default withThor(async function handler(req, res) { /* ... */ });
```

`withThor` reports and rethrows. It never swallows an error, so your own error
handling still runs.

## Middleware and edge routes

Middleware is always an edge bundle, and an edge bundle cannot resolve
`node:fs` or `node:zlib`. Import the edge entry point there:

```ts
import { initThor, withThorMiddleware } from '@dockcodes/dock-thor-next/edge';

initThor();

export const middleware = withThorMiddleware(async (request) => {
    // ...
});
```

Events lose stack source context and gzip; everything else is the same. The
edge wrapper **awaits** its report rather than firing and forgetting, because
an edge invocation can be frozen the moment it returns.

`instrumentation-edge.ts` should use `thorRequestError` from the same entry
point.

## JavaScript errors

Off by default. Two things are needed.

**The route that receives them** — `app/api/thor/browser/route.ts`:

```ts
import { createBrowserErrorRoute } from '@dockcodes/dock-thor-next';

export const POST = createBrowserErrorRoute();
export const runtime = 'nodejs';
```

**The collector**, mounted once in the root layout:

```tsx
import { ThorBrowserReporting } from '@dockcodes/dock-thor-next/client';

export default function RootLayout({ children }) {
    return (
        <html>
            <body>
                <ThorBrowserReporting />
                {children}
            </body>
        </html>
    );
}
```

```dotenv
NEXT_PUBLIC_THOR_JS_ERRORS=true
```

The browser reports to **your route**, not to the panel. It cannot report
directly: authenticating means holding the project private key, and a key in a
client bundle is a published key. Your server forwards each report with its
own.

The route answers `202` to everything — a valid report, a malformed one, a
rate-limited one — so a caller learns nothing about the guards. It drops
bodies over 16 KB and allows 20 reports per address per minute. Envelope
fields (environment, release, timestamp) are filled in on the server; a browser
cannot choose which environment its errors land in.

The collector caps itself as well: one report per distinct error per page view,
ten per page view by default, with `ResizeObserver loop` and cross-origin
`Script error.` filtered out.

From an error boundary or `app/global-error.tsx`:

```tsx
'use client';
import { captureBrowserException } from '@dockcodes/dock-thor-next/client';

export default function GlobalError({ error }) {
    captureBrowserException(error);

    return <html><body><h1>Something went wrong</h1></body></html>;
}
```

## What is reported and what is not

`Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key` and the collector's own
token are stripped from reported headers. The visitor's IP address and user
agent are only attached when `THOR_SEND_DEFAULT_PII=true`; without it a report
carries no `user` at all.

## Vercel

`VERCEL_ENV` becomes the environment and `VERCEL_GIT_COMMIT_SHA` the release
when `THOR_ENVIRONMENT` and `THOR_RELEASE` are not set, so a preview deployment
does not report as production.

## Tests

```bash
npm test
```

## License

MIT.
