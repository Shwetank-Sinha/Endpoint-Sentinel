# Endpoint Sentinel

Endpoint Sentinel is a React dashboard backed by a Cloudflare Worker, D1, Cron Triggers, and Cloudflare Queues. It performs real HTTP checks, tracks incident lifecycles, and emits deduplicated webhook alerts when operational state changes.

## Architecture

```text
Cron / manual request
  -> monitoring_jobs -> endpoint-sentinel-checks
  -> validated HTTP probe -> check_results
  -> incident evaluator -> incidents + incident_events
  -> alert_deliveries -> endpoint-sentinel-alerts
  -> generic or Discord webhook
```

Both queues are at-least-once. Unique job/result linkage, deterministic scheduled-job keys, immutable transition events, a single-active-incident index, and alert deduplication keys provide effectively-once result and alert state persistence. Cron republishes stale monitoring and alert jobs and evaluates any persisted results left unevaluated after a temporary infrastructure failure.

## Incident state model

The defaults are `INCIDENT_FAILURE_THRESHOLD=2` and `INCIDENT_RECOVERY_THRESHOLD=1`:

- One unhealthy result is treated as a transient observation and does not open an incident.
- Two consecutive `DEGRADED` or `CRITICAL` results open one incident.
- Further unhealthy results update the incident without generating repeated alerts.
- `DEGRADED` escalating to `CRITICAL` creates one severity event and alert.
- The configured number of consecutive `HEALTHY` results resolves the incident and creates one recovery alert.
- An open incident can be acknowledged. Acknowledgement is audited but does not suppress recovery.
- Manual resolution creates an audit event and resolution alert. If later unhealthy results cross the threshold, a new incident is created.

HTTP 500, timeout, DNS, and network failures remain valid `CRITICAL` monitoring results. D1 and queue failures are infrastructure failures and are recovered separately.

## Alert delivery

Set the webhook URL as a Worker secret; it is never stored in D1, returned by an API, or included in logs:

```powershell
npx wrangler secret put ALERT_WEBHOOK_URL
```

`ALERT_WEBHOOK_FORMAT` is a non-secret environment setting in `wrangler.toml`. Supported values are `generic` and `discord`. Change it to `discord` before deployment when using a Discord channel webhook.

Without `ALERT_WEBHOOK_URL`, incident processing continues and deliveries become `SKIPPED` with an honest status. Webhook bodies are discarded. HTTP 2xx succeeds; 408, 425, 429, and 5xx retry; other 4xx responses fail permanently. Requests have a ten-second timeout and bounded retries.

The generic JSON payload has this shape:

```json
{
  "event": "OPENED | SEVERITY_CHANGED | RESOLVED",
  "incidentId": "<incident id>",
  "endpoint": "<endpoint name>",
  "severity": "DEGRADED | CRITICAL",
  "status": "OPEN | ACKNOWLEDGED | RESOLVED",
  "httpStatus": 500,
  "latencyMs": 125,
  "startedAt": "<UTC ISO timestamp>",
  "reason": "<monitoring reason>",
  "recoveryDurationSeconds": null
}
```

Discord mode sends a concise content line and embed containing the same operational fields.

## API and dashboard

Endpoint CRUD, asynchronous checks, job polling, and result history remain available. Incident routes are scoped to the default workspace:

- `GET /api/incidents?status=&severity=&endpointId=&limit=&cursor=`
- `GET /api/incidents/:id`
- `POST /api/incidents/:id/acknowledge`
- `POST /api/incidents/:id/resolve`
- `GET /api/incidents/:id/events`
- `GET /api/incidents/:id/alerts`

The dashboard retains endpoint monitoring and adds incident counts, filters, duration, detail views, event timelines, delivery status, acknowledgement/resolution actions, and active-incident markers on endpoint cards. Endpoint cards display the complete HTTP/HTTPS URL, link safely to the target, and request favicons using only the normalized public hostname. Missing, blocked, malformed, and reserved test-domain favicons use a deterministic initial fallback. No paths, query strings, credentials, incident data, or queue statistics are sent to the favicon service or fabricated in the UI.

## Local development

Use Node.js 24 LTS:

```powershell
npm ci
npx wrangler d1 migrations apply endpoint-sentinel --local
npm run cf-typegen
npm run dev
```

For a dedicated local scheduled-event session:

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
npm audit --omit=dev
```

## Cloudflare resources and deployment order

Keep the existing D1 database and production database ID. The monitoring queues from Milestone 2 remain unchanged. Create the two new alert queues, configure the webhook secret, apply migration `0003_incidents_alerts.sql`, and only then deploy:

```powershell
npx wrangler login
npx wrangler queues create endpoint-sentinel-alerts
npx wrangler queues create endpoint-sentinel-alerts-dlq
npx wrangler secret put ALERT_WEBHOOK_URL
npx wrangler d1 migrations apply endpoint-sentinel --remote
npm run cf-typegen
npm run typecheck
npm test
npm run build
npx wrangler deploy
```

If alerts are intentionally disabled, omit the `wrangler secret put` command. Verification after deployment:

```powershell
npx wrangler deployments list
npx wrangler queues list
npx wrangler d1 execute endpoint-sentinel --remote --command "SELECT id, endpoint_id, status, severity, started_at, resolved_at FROM incidents ORDER BY updated_at DESC LIMIT 20;"
npx wrangler d1 execute endpoint-sentinel --remote --command "SELECT incident_id, event_type, created_at FROM incident_events ORDER BY created_at DESC LIMIT 20;"
npx wrangler d1 execute endpoint-sentinel --remote --command "SELECT incident_id, status, attempt_count, response_status FROM alert_deliveries ORDER BY created_at DESC LIMIT 20;"
```

## Security and current limitations

Endpoint targets remain HTTP/HTTPS-only; credential-bearing URLs and local/private/reserved literal addresses are rejected; redirects are revalidated; timeouts are enforced; response bodies are discarded; SQL is parameterized; and logs exclude webhook secrets and target URLs. A network-level egress policy is still recommended against DNS rebinding.

Authentication, users, multi-workspace UI, per-user authorization, custom endpoint headers/bodies, secret storage for endpoint credentials, public status pages, alert-channel management, retention controls, and automated DLQ replay remain future work. Incident thresholds are Worker-wide environment settings rather than per-endpoint settings. Duration and next-check values shown in the browser are estimates based on persisted timestamps.
