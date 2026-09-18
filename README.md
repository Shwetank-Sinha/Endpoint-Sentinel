# Endpoint Sentinel

Endpoint Sentinel is a production-oriented API reliability platform for small engineering teams. Milestone 1 stores endpoint configuration and completed checks in Cloudflare D1; a fresh database contains a default workspace but no endpoints.

## Implemented

- Workspace-scoped endpoint CRUD through `GET/POST /api/endpoints` and `GET/PATCH/DELETE /api/endpoints/:id`.
- Manual real HTTP checks through `POST /api/endpoints/:id/check`; every completed healthy, degraded, timeout, network-error, or unexpected-status check is persisted.
- Persisted history through `GET /api/endpoints/:id/results?limit=50`, plus latest and average latency in the dashboard details view.
- Strict server validation for methods, HTTP status, timeouts, thresholds, intervals, credentials, local/private/reserved targets, and redirect destinations.
- Empty, loading, success, and error UI states; create/edit/delete/check controls; and accessible modal confirmation instead of `window.confirm`.
- Controlled `/api/demo/healthy`, `/api/demo/slow`, and `/api/demo/failing` development fixtures. They are never seeded into the dashboard.

## Local D1 setup

Use Node.js 24 LTS. Install packages, create the local D1 schema, then start Vite and the Worker together:

```powershell
npm ci
npx wrangler d1 migrations apply endpoint-sentinel --local
npm run dev
```

Useful verification commands:

```powershell
npm test
npm run typecheck
npm run build
npm run preview
```

Local D1 data lives under `.wrangler/` and is intentionally ignored by Git. The migration creates the stable `Default Workspace`; it does not create endpoints or check results.

## Production database and deployment

Create the database once, copy its ID into `wrangler.toml`, apply migrations remotely, and deploy:

```powershell
npx wrangler login
npx wrangler d1 create endpoint-sentinel
npx wrangler d1 migrations apply endpoint-sentinel --remote
npm run deploy
```

Do not deploy while `database_id` is still `REPLACE_WITH_D1_DATABASE_ID`. Build and migration are separate operations; `npm run deploy` builds and deploys but does not apply remote migrations.

## API envelopes

Successful JSON responses use `{ "data": ... }`. Failures use `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "requestId": "..." } }`. DELETE succeeds with HTTP 204 and no body.

All endpoint reads and mutations include the default `workspace_id`, leaving an explicit authorization boundary for a later authentication milestone. D1 statements are parameterized.

## Planned, not implemented

- Authentication, users, workspace switching, and authorization.
- Scheduled checks (Cron), Queues, alerting, and notifications.
- Request bodies, custom headers/secrets, incident aggregation, retention controls, and production analytics charts.
- Automated migration during deployment. Run the documented remote migration command explicitly.

<details>
<summary>Historical demonstration documentation (pre-D1)</summary>

A manual endpoint monitoring MVP built with React, strict TypeScript, Vite and a Cloudflare Worker. All health classifications, observed HTTP codes, elapsed times and check timestamps come from real POST /api/check executions. No checks run at startup.

## Working features

- Check Now and Check All (up to four concurrent checks, independent results).
- Healthy, Degraded, Critical, Not Checked, Checking and request-error feedback.
- Average Latency from current completed API results only, including measured failed probes; excludes unchecked, checking and API request errors. An empty average displays an em dash.
- Add endpoints with validated names, HTTP(S) URLs or the three supported relative demo paths, HTTP methods, expected status and positive integer time limits.
- Confirmed deletion of custom endpoints and their history. The three default entries cannot be individually deleted.
- Restore Demo Endpoints resets configuration, results, errors and history without checking. Late responses cannot restore deleted/reset data.
- Local timestamps from the Worker and up to 20 history entries per endpoint.

## Architecture and persistence

React calls the same-origin Worker POST /api/check. External targets are fetched by the Worker with the selected HTTP method. Redirects are followed; the final response status is classified. performance.now() measures elapsed time through response headers, and AbortController enforces the timeout. Response bodies are discarded and never returned to the dashboard.

Exact relative demo paths execute internal handlers without recursive self-fetching. Absolute URLs are always fetched, even when their pathname matches a demo route. Demo handlers allow GET; other methods return 405.

Endpoint configuration and monitoring history use browser localStorage, not D1. Refresh restores configuration as NOT_CHECKED and preserves historical results and their timestamps. Invalid stored entries are discarded. Storage quota/privacy failures leave the application usable in memory but can prevent persistence. Browser data can be edited by its owner; it is not an audit store.

## Windows local setup

Use Node.js 24 LTS and npm. In PowerShell, from the repository directory:

~~~powershell
npm ci
npm run dev
~~~

Open the local URL printed by Vite. The Cloudflare Vite plugin runs the Worker alongside React; a separate API server is unnecessary.

~~~powershell
npm run build
npm run typecheck
npm run preview
~~~

Build runs strict TypeScript checking and Vite bundling. Preview serves the built application through the configured Cloudflare plugin.

## API

Example request (PowerShell):

~~~powershell
$checkBody = @{ url = '/api/demo/slow'; method = 'GET'; expectedStatus = 200; timeoutMs = 5000; latencyThresholdMs = 800 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'http://localhost:5173/api/check' -ContentType 'application/json' -Body $checkBody
~~~

Response shape below is illustrative documentation, not stored monitoring data. Values are generated by each real execution:

~~~json
{
  "id": "<generated run UUID>",
  "target": { "url": "/api/demo/slow", "method": "GET", "expectedStatus": 200, "timeoutMs": 5000, "latencyThresholdMs": 800 },
  "status": "DEGRADED",
  "reason": "Responded HTTP 200 in 1203 ms, exceeding the 800 ms latency threshold.",
  "latencyMs": 1203,
  "actualStatusCode": 200,
  "checkedAt": "2026-09-17T12:00:00.000Z"
}
~~~

Invalid input returns HTTP 400 with an error message. A completed check returns HTTP 200 with a health result, including CRITICAL results. Network failures/timeouts have actualStatusCode null and measured elapsed time. Failure to call the checking API is shown separately as Check Failed, without an invented health result or check timestamp.

## Health rules and controlled demos

- Timeout or network failure: CRITICAL.
- Unexpected HTTP status: CRITICAL.
- Expected status, elapsed time above threshold: DEGRADED.
- Expected status, elapsed time at or below threshold: HEALTHY.

With defaults (GET, expected 200, 5000 ms timeout, 800 ms threshold):

| Controlled route | Real handler behavior | Expected classification |
| --- | --- | --- |
| /api/demo/healthy | Returns 200 | HEALTHY |
| /api/demo/slow | Waits approximately 1200 ms, returns 200 | DEGRADED |
| /api/demo/failing | Returns 500 | CRITICAL |

Classification always uses measured results; scheduling/load may affect latency. These are controlled demonstrations, not external uptime measurements.

## Deployment and limitations

For deployment with a configured Cloudflare account:

~~~powershell
npx wrangler login
npm run deploy
~~~

Deployment is separate from local build/testing. Production routing and external reachability still need verification on the deployed Worker.

Current limitations: manual checks only, browser-local data, no cross-device synchronization, no authentication, no request-body/custom-header configuration, no alerts or scheduled monitoring. External hosts can reject Worker requests or be unreachable; these failures are reported. Selected methods can have side effects on external services. Latency measures response headers rather than a full body download. Timeout is limited to 2147483647 ms to avoid timer overflow. At most 200 saved endpoints are restored.

Future work (not implemented): Cloudflare D1 storage, Queues for distributed checks, Cron scheduling, and alert delivery.

</details>
