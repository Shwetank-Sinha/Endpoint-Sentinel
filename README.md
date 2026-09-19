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

Endpoint CRUD, asynchronous checks, job polling, result history, and incident routes are scoped to the authenticated user's selected workspace:

- `GET /api/incidents?status=&severity=&endpointId=&limit=&cursor=`
- `GET /api/incidents/:id`
- `POST /api/incidents/:id/acknowledge`
- `POST /api/incidents/:id/resolve`
- `GET /api/incidents/:id/events`
- `GET /api/incidents/:id/alerts`

The dashboard retains endpoint monitoring and adds incident counts, filters, duration, detail views, event timelines, delivery status, acknowledgement/resolution actions, and active-incident markers on endpoint cards. Endpoint cards display the complete HTTP/HTTPS URL, link safely to the target, and request favicons using only the normalized public hostname. Missing, blocked, malformed, and reserved test-domain favicons use a deterministic initial fallback. No paths, query strings, credentials, incident data, or queue statistics are sent to the favicon service or fabricated in the UI.

## GitHub authentication and workspace authorization

Create a GitHub OAuth App with the deployed origin as its homepage and this exact callback path:

```text
https://sentinel.example.com/api/auth/github/callback
```

For a separate local OAuth App, use `http://localhost:5173/api/auth/github/callback`. Set `APP_BASE_URL` to the matching origin without a trailing path. Configure values interactively so credentials never enter source control:

```powershell
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put BOOTSTRAP_OWNER_GITHUB_LOGIN
npx wrangler secret put APP_BASE_URL
npx wrangler secret put ALERT_WEBHOOK_URL
```

`BOOTSTRAP_OWNER_GITHUB_LOGIN` is the only identity automatically granted `OWNER` access to the existing default workspace. Comparison is case-insensitive. If it is absent, misspelled, or belongs to another account, no visitor can claim existing data; ordinary authenticated users can only create new isolated workspaces. Changing the value later does not transfer existing memberships.

OAuth state is random, hashed in D1, expiring, and single-use. The authorization code is exchanged server-side, the GitHub profile is retained, and the access token is discarded. Browser sessions use random opaque `HttpOnly; Secure; SameSite=Lax` cookies; only SHA-256 token hashes are stored. Sessions expire server-side, rotate after login, and are revoked on logout. Cookie-authenticated mutations require an exact matching `Origin`, return paths are local-only, and API responses carry restrictive security headers.

`OWNER` and `MEMBER` may operate monitors and incidents. Only `OWNER` may list or administer membership. The client-supplied `X-Workspace-ID` only selects from server-verified memberships. Endpoints, jobs, results, incidents, events, alerts, and members remain tenant-isolated. Cron and queue consumers use persisted workspace identity and require no browser session.

## Team invitations

Workspace owners can open **Team**, enter a GitHub username, choose an expiry of 1, 3, 7, or 14 days, and copy the resulting link for private delivery. Endpoint Sentinel does not send email or external messages. Invitation links are credentials and must be shared privately with only the named teammate.

Invitation tokens contain 256 bits of randomness. The raw token is returned once when an invitation is created and is never included in administrative invitation lists, audit events, or logs. D1 stores only its SHA-256 hash. Invitations are single-use, default to seven days, grant only the `MEMBER` role, and can be revoked by an owner. At most 50 pending invitations are allowed per workspace, and only one pending invitation may exist for the same normalized GitHub login in a workspace.

The recipient opens `/invite/<token>`. If signed out, the validated invitation path is preserved through GitHub OAuth. Acceptance requires the authenticated GitHub login to match the invited login case-insensitively, so possession of a stolen link by a different account is insufficient. Expired, revoked, accepted, malformed, and reused invitations cannot grant additional access. Successful acceptance adds an idempotent membership, records a sanitized audit event, selects the shared workspace, and opens its dashboard.

Owners may change roles or remove members. Membership authorization is checked from D1 on every request, so removal takes effect immediately without deleting the user's identity, sessions, or memberships in other workspaces. Atomic owner-count guards prevent removing or demoting the final owner. Audit events cover invitation creation, revocation and acceptance, member removal, and role changes without tokens, cookies, or OAuth values.

## Local development

Use Node.js 24 LTS:

Create an untracked `.dev.vars` with development-only OAuth App values:

```dotenv
GITHUB_CLIENT_ID="your-local-oauth-app-client-id"
GITHUB_CLIENT_SECRET="your-local-oauth-app-client-secret"
BOOTSTRAP_OWNER_GITHUB_LOGIN="your-github-login"
APP_BASE_URL="http://localhost:5173"
```

No `SESSION_SECRET` is required: session and OAuth-state values have 256 bits of randomness and only their SHA-256 hashes are persisted.

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

Keep the existing D1 database, production database ID, and queues. After backing up production, creating the OAuth App, and setting secrets, use this PowerShell deployment order:

```powershell
npm ci
npm run cf-typegen
npm run typecheck
npm test
npm run build
npm audit --omit=dev
npx wrangler d1 migrations list endpoint-sentinel --remote
npx wrangler d1 migrations apply endpoint-sentinel --remote
npx wrangler deploy
npx wrangler deployments list
```

Migration `0005_team_invitations.sql` must follow `0004_auth_workspaces.sql`; it adds invitations and workspace audit events without changing existing monitoring or incident ownership. Never recreate D1. If alerts are intentionally disabled, omit only `ALERT_WEBHOOK_URL`. Verification after deployment:

```powershell
npx wrangler deployments list
npx wrangler queues list
npx wrangler d1 execute endpoint-sentinel --remote --command "SELECT id, endpoint_id, status, severity, started_at, resolved_at FROM incidents ORDER BY updated_at DESC LIMIT 20;"
npx wrangler d1 execute endpoint-sentinel --remote --command "SELECT incident_id, event_type, created_at FROM incident_events ORDER BY created_at DESC LIMIT 20;"
npx wrangler d1 execute endpoint-sentinel --remote --command "SELECT incident_id, status, attempt_count, response_status FROM alert_deliveries ORDER BY created_at DESC LIMIT 20;"
```

## Security and current limitations

Endpoint targets remain HTTP/HTTPS-only; credential-bearing URLs and local/private/reserved literal addresses are rejected; redirects are revalidated; timeouts are enforced; response bodies are discarded; SQL is parameterized; and logs exclude webhook secrets and target URLs. A network-level egress policy is still recommended against DNS rebinding.

Email delivery, organization synchronization, ownership-transfer workflows, additional OAuth providers, custom endpoint headers/bodies, secret storage for endpoint credentials, public status pages, alert-channel management, retention controls, and automated DLQ replay remain future work. Invitations grant only `MEMBER`; owners must explicitly promote a member while another owner remains. Incident thresholds are Worker-wide environment settings rather than per-endpoint settings. Duration and next-check values shown in the browser are estimates based on persisted timestamps.
