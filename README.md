# Endpoint Sentinel

Endpoint Sentinel is a React dashboard backed by a Cloudflare Worker, D1, Cron Triggers, and Cloudflare Queues. Milestone 2 performs real HTTP endpoint checks automatically and persists their results.

## Architecture

```text
Cron Trigger (every minute)
  -> bounded D1 due/stale-job selection
  -> monitoring_jobs (QUEUED)
  -> endpoint-sentinel-checks queue
  -> Worker queue consumer
  -> validated HTTP request
  -> check_results + COMPLETED job
  -> dashboard polling/history
```

Manual **Check Now** uses the same path: `POST /api/endpoints/:id/check` creates a job and returns HTTP 202, then the dashboard polls `GET /api/jobs/:id`. The UI displays **Paused**, **Queued**, **Checking**, **Last checked**, and **Next check** states. Endpoint intervals are active scheduling inputs.

The scheduler uses deterministic endpoint/time-bucket deduplication keys. Duplicate Cron invocations cannot create a second job for the same bucket. Queue delivery is at least once, not exactly once; job claiming plus the unique non-null `check_results.job_id` index provides effectively-once result persistence. Duplicate delivery acknowledges a terminal job without probing again. A Cron run republishes stale `QUEUED` jobs, covering the unavoidable D1-insert/queue-publish boundary.

HTTP 500 is a valid `CRITICAL` observation. Timeouts, DNS, and network failures also become persisted `CRITICAL` monitoring results. D1/queue failures are infrastructure errors and are retried; exhausted consumer attempts set a sanitized job error. Responses are never buffered or logged.

## Local development

Use Node.js 24 LTS:

```powershell
npm ci
npx wrangler d1 migrations apply endpoint-sentinel --local
npm run cf-typegen
npm run dev
```

`npm run dev` runs the dashboard, Worker, local D1, and local queue consumer. For a dedicated Cron test session, stop Vite and start Wrangler with scheduled-event testing:

```powershell
npx wrangler dev --test-scheduled
Invoke-WebRequest -Method Get -Uri 'http://localhost:8787/__scheduled?cron=*+*+*+*+*'
```

Verification:

```powershell
npm run typecheck
npm test
npm run build
git diff --check
```

The API uses `{ "data": ... }` success envelopes and `{ "error": { "code": "...", "message": "...", "requestId": "..." } }` errors. Endpoint and job access is currently scoped to the stable default workspace.

## Cloudflare resource creation and deployment

The existing D1 database and its configured production ID must be retained. Create only the two queues, then apply the new migration before deploying:

```powershell
npx wrangler login
npx wrangler queues create endpoint-sentinel-checks
npx wrangler queues create endpoint-sentinel-checks-dlq
npx wrangler d1 migrations apply endpoint-sentinel --remote
npm run cf-typegen
npm run build
npx wrangler deploy
```

Recommended production verification:

```powershell
npx wrangler deployments list
npx wrangler d1 execute endpoint-sentinel --remote --command "SELECT id, endpoint_id, source, status, attempt_count, scheduled_for FROM monitoring_jobs ORDER BY created_at DESC LIMIT 10;"
npx wrangler d1 execute endpoint-sentinel --remote --command "SELECT id, endpoint_id, job_id, outcome, status_code, checked_at FROM check_results ORDER BY checked_at DESC LIMIT 10;"
npx wrangler queues list
```

Deployment order matters: create both queues, apply D1 migration `0002_queue_monitoring.sql`, generate types/build, then deploy the Worker containing the bindings and handlers. Do not recreate the D1 database. If deployment fails after migration, the additive schema remains compatible with the previous endpoint CRUD routes.

## Scheduling and safety

- Cron runs once per minute and schedules at most `MAX_JOBS_PER_SCHEDULE` jobs (default 100, hard cap 500).
- Queue publication uses bounded batches; the consumer batch is capped at 10 messages, waits at most 5 seconds, retries 3 times, and then routes to `endpoint-sentinel-checks-dlq`.
- Disabled endpoints are excluded from scheduling. Jobs delivered after an endpoint is paused are finalized without a request. Deleting an endpoint cascades its jobs/results; any late queue delivery is safely acknowledged, and dashboard polling exits on the resulting not-found response.
- Targets remain HTTP/HTTPS-only, credentials are forbidden, private/local/reserved literal addresses are blocked, every redirect target is revalidated, request timeouts are enforced, and response bodies are discarded.
- SQL is parameterized. Logs include job/endpoint/source/outcome metadata but omit endpoint secrets and response bodies.

## Current limitations and future work

Authentication, users, a multi-workspace UI, authorization, alerts/notifications, custom headers and request bodies, secret storage, public status pages, retention controls, and incident aggregation remain future work. Hostname-based SSRF protection cannot prevent every DNS-rebinding scenario without an egress policy. The dashboard's next-check time is an estimate based on the latest result or creation time; queue latency and scheduler capacity can delay execution. DLQ inspection/replay is operational rather than exposed in the UI.
