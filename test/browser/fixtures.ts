/** Browser-only API simulation. Never imported by src or the Worker. */
import type { BrowserContext, Route } from 'playwright';
import type { AuthSession, WorkspaceInvitation, WorkspaceMember, InvitationDetail } from '../../src/services/endpointsApi';
import type { EndpointRecord, IncidentDetail, IncidentEvent, AlertDelivery } from '../../src/types/monitoring';

const now = new Date().toISOString();
const ago = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
export function createFixtures() {
  const session: AuthSession = { user: { id: 'test-owner', githubId: 101, githubLogin: 'sentinel-owner', displayName: 'Alex Morgan', avatarUrl: null }, workspaces: [{ id: 'test-production', name: 'Platform operations', slug: 'platform', role: 'OWNER' }, { id: 'test-staging', name: 'Staging', slug: 'staging', role: 'MEMBER' }] };
  const endpoints: EndpointRecord[] = [
    ['gateway', 'API gateway', 'https://gateway.example.test/v1/health', 'HEALTHY', 124, 200],
    ['payments', 'Payments service', 'https://payments.example.test/health', 'CRITICAL', 5000, null],
    ['search', 'Search index', 'https://search.example.test/status', 'DEGRADED', 1240, 200],
    ['legacy', 'Legacy reporting', 'http://legacy.example.test/health', 'HEALTHY', 89, 200],
    ['new', 'Analytics ingestion / EU region / long endpoint name for layout inspection', 'https://analytics.example.test/ingestion/europe-west/v2/availability/check?region=europe-west&format=summary', null, 0, null],
  ].map(([id, name, url, status, latency, code], i) => {
    const target = { url: String(url), method: 'GET' as const, expectedStatus: 200, timeoutMs: 5000, latencyThresholdMs: 800 };
    return { ...target, id: String(id), name: String(name), workspaceId: 'test-production', checkIntervalMinutes: 5, enabled: i !== 3, createdAt: ago(120), updatedAt: now, activeJobStatus: null,
      activeIncident: i === 1 || i === 2 ? { id: `incident-${id}`, status: 'OPEN' as const, severity: i === 1 ? 'CRITICAL' as const : 'DEGRADED' as const } : null,
      latestResult: status ? { id: `result-${id}`, target, status: status as 'HEALTHY' | 'DEGRADED' | 'CRITICAL', reason: i === 1 ? 'Request timed out after 5000 ms; no HTTP response.' : i === 2 ? 'Response exceeded the 800 ms latency threshold.' : 'HTTP 200 matched the expected status within the latency threshold.', latencyMs: Number(latency), actualStatusCode: code === null ? null : Number(code), checkedAt: ago(2) } : null };
  });
  const incidents: IncidentDetail[] = ['payments', 'search', 'gateway'].map((id, i) => ({ id: `incident-${id}`, endpointId: id, endpointName: endpoints.find(e => e.id === id)!.name, status: i === 2 ? 'RESOLVED' : 'OPEN', severity: i === 1 ? 'DEGRADED' : 'CRITICAL', title: `Incident for ${id}`, summary: i === 2 ? 'HTTP 503 did not match expected HTTP 200.' : endpoints.find(e => e.id === id)!.latestResult!.reason, consecutiveFailureCount: i === 2 ? 0 : 4, startedAt: ago(37 + i * 10), acknowledgedAt: null, resolvedAt: i === 2 ? ago(5) : null, createdAt: ago(37 + i * 10), updatedAt: now, firstResultId: `first-${id}`, latestResultId: `result-${id}` }));
  const events: Record<string, IncidentEvent[]> = Object.fromEntries(incidents.map(incident => [incident.id, [{ id: `${incident.id}-opened`, incidentId: incident.id, eventType: 'OPENED', fromSeverity: null, toSeverity: incident.severity, resultId: incident.firstResultId, message: 'Incident opened after consecutive failed checks.', createdAt: incident.startedAt }, ...(incident.status === 'RESOLVED' ? [{ id: `${incident.id}-recovered`, incidentId: incident.id, eventType: 'RESOLVED' as const, fromSeverity: incident.severity, toSeverity: incident.severity, resultId: 'healthy-result', message: 'Endpoint recovered after healthy monitoring results.', createdAt: ago(5) }] : [])]]));
  const alerts: Record<string, AlertDelivery[]> = Object.fromEntries(incidents.map(incident => [incident.id, (['DELIVERED', 'QUEUED', 'FAILED'] as const).map((status, i) => ({ id: `${incident.id}-alert-${i}`, incidentId: incident.id, incidentEventId: events[incident.id]![0]!.id, channel: 'WEBHOOK', status, attemptCount: i + 1, responseStatus: status === 'DELIVERED' ? 204 : status === 'FAILED' ? 429 : null, lastError: status === 'FAILED' ? 'HTTP 429: delivery retry limit reached.' : null, createdAt: incident.startedAt, deliveredAt: status === 'DELIVERED' ? ago(35) : null, updatedAt: now }))]));
  const members: WorkspaceMember[] = [{ id: 'test-owner', githubLogin: 'sentinel-owner', displayName: 'Alex Morgan', avatarUrl: null, role: 'OWNER', createdAt: ago(1000) }, { id: 'test-member', githubLogin: 'sam-dev', displayName: 'Sam Rivera', avatarUrl: null, role: 'MEMBER', createdAt: ago(1000) }];
  const invitations: WorkspaceInvitation[] = (['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'] as const).map((status, i) => ({ id: `invite-${i}`, invitedGithubLogin: ['jordan-dev', 'casey-dev', 'morgan-dev', 'riley-dev'][i]!, role: 'MEMBER', status, invitedBy: { githubLogin: 'sentinel-owner', displayName: 'Alex Morgan' }, expiresAt: new Date(Date.now() + 86400000).toISOString(), acceptedAt: status === 'ACCEPTED' ? now : null, revokedAt: status === 'REVOKED' ? now : null, createdAt: ago(1000) }));
  return { session, endpoints, incidents, events, alerts, members, invitations, signedIn: true, empty: false, sessionDelay: 0, delay: 30, fail: '' as string, failStatus: 503, jobStates: ['COMPLETED'], invitationStatus: 'PENDING' as InvitationDetail['status'], mismatch: false, calls: [] as { path: string; method: string; workspace: string | undefined; body: unknown }[] };
}

export async function installFixtures(context: BrowserContext, state = createFixtures()) {
  await context.route('**/api/**', async (route: Route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Fixtures are restricted to localhost');
    const body = request.postDataJSON();
    state.calls.push({ path, method, workspace: request.headers()['x-workspace-id'], body });
    await new Promise(resolve => setTimeout(resolve, path === '/api/auth/session' ? state.sessionDelay : state.delay));
    const send = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ data }) });
    const error = (message: string, status: number) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: { message, code: 'TEST_ONLY', requestId: 'local-browser-test' } }) });
    if (state.fail && path.includes(state.fail)) return error(state.failStatus === 403 ? 'You do not have access to this workspace.' : 'Service temporarily unavailable. Please retry.', state.failStatus);
    if (path === '/api/auth/session') return state.signedIn ? send(state.session) : error('Sign in required.', 401);
    if (path === '/api/auth/logout') { state.signedIn = false; return route.fulfill({ status: 204 }); }
    if (path === '/api/auth/github') return route.fulfill({ contentType: 'text/html', body: '<title>Local OAuth handoff</title><h1>Local OAuth handoff</h1>' });
    if (path === '/api/workspaces' && method === 'POST') { const workspace = { id: 'created-workspace', name: body.name, slug: 'created', role: 'OWNER' as const }; state.session.workspaces.push(workspace); return send(workspace); }
    if (path === '/api/endpoints') {
      if (method === 'POST') { const endpoint: EndpointRecord = { ...body, id: 'created-endpoint', workspaceId: 'test-production', latestResult: null, activeJobStatus: null, activeIncident: null, createdAt: now, updatedAt: now }; state.endpoints.push(endpoint); return send(endpoint, 201); }
      return send(state.empty || request.headers()['x-workspace-id'] === 'test-staging' ? [] : state.endpoints);
    }
    const endpoint = state.endpoints.find(e => e.id === path.split('/')[3]);
    if (path.startsWith('/api/endpoints/') && endpoint) {
      if (path.endsWith('/results')) return send(endpoint.latestResult ? [endpoint.latestResult, { ...endpoint.latestResult, id: 'older-result', checkedAt: ago(7) }] : []);
      if (path.endsWith('/check')) return send({ jobId: endpoint.id, status: 'QUEUED' }, 202);
      if (method === 'PATCH') { Object.assign(endpoint, body); return send(endpoint); }
      if (method === 'DELETE') { state.endpoints.splice(state.endpoints.indexOf(endpoint), 1); return route.fulfill({ status: 204 }); }
    }
    if (path.startsWith('/api/jobs/')) { const status = state.jobStates.length > 1 ? state.jobStates.shift()! : state.jobStates[0]; return send({ id: path.split('/').at(-1), endpointId: path.split('/').at(-1), source: 'MANUAL', status, scheduledFor: now, attemptCount: 1, lastError: status === 'FAILED' ? 'The isolated test check failed.' : null, createdAt: now, startedAt: status === 'QUEUED' ? null : now, completedAt: status === 'COMPLETED' ? now : null, result: null }); }
    if (path === '/api/incidents') { const items = state.empty ? [] : state.incidents.filter(i => (!url.searchParams.get('status') || i.status === url.searchParams.get('status')) && (!url.searchParams.get('severity') || i.severity === url.searchParams.get('severity'))); return send({ items, nextCursor: null, counts: { open: state.empty ? 0 : state.incidents.filter(i => i.status !== 'RESOLVED').length, critical: state.empty ? 0 : state.incidents.filter(i => i.status !== 'RESOLVED' && i.severity === 'CRITICAL').length, resolved: state.empty ? 0 : state.incidents.filter(i => i.status === 'RESOLVED').length } }); }
    const incident = state.incidents.find(i => i.id === path.split('/')[3]);
    if (path.startsWith('/api/incidents/') && incident) {
      if (path.endsWith('/events')) return send(state.events[incident.id]);
      if (path.endsWith('/alerts')) return send(state.alerts[incident.id]);
      if (method === 'POST') { const resolve = path.endsWith('/resolve'); incident.status = resolve ? 'RESOLVED' : 'ACKNOWLEDGED'; incident.resolvedAt = resolve ? now : null; incident.acknowledgedAt = resolve ? incident.acknowledgedAt : now; state.events[incident.id]!.push({ id: `${incident.id}-${incident.status}`, incidentId: incident.id, eventType: resolve ? 'RESOLVED' : 'ACKNOWLEDGED', fromSeverity: incident.severity, toSeverity: incident.severity, resultId: null, message: resolve ? 'Incident resolved manually.' : 'Incident acknowledged manually.', createdAt: now }); const associated = state.endpoints.find(e => e.id === incident.endpointId); if (associated) associated.activeIncident = resolve ? null : { id: incident.id, status: 'ACKNOWLEDGED', severity: incident.severity }; }
      return send(incident);
    }
    if (path.includes('/members')) {
      const member = state.members.find(m => m.id === path.split('/').at(-1));
      if (member && method === 'PATCH') { if (member.role === 'OWNER' && body.role === 'MEMBER' && state.members.filter(m => m.role === 'OWNER').length === 1) return error('The final owner cannot be demoted.', 409); member.role = body.role; return send({ userId: member.id, role: member.role }); }
      if (member && method === 'DELETE') { state.members.splice(state.members.indexOf(member), 1); return route.fulfill({ status: 204 }); }
      return send(state.members);
    }
    if (path.startsWith('/api/workspaces/') && path.includes('/invitations')) {
      if (method === 'POST') { const invitation = { ...state.invitations[0]!, id: 'created-invite', invitedGithubLogin: body.githubLogin, status: 'PENDING' as const }; state.invitations.push(invitation); return send({ ...invitation, invitationUrl: `${url.origin}/invite/test-only-invitation` }); }
      if (method === 'DELETE') { const invitation = state.invitations.find(i => i.id === path.split('/').at(-1)); if (invitation) invitation.status = 'REVOKED'; return route.fulfill({ status: 204 }); }
      return send(state.invitations);
    }
    if (path.startsWith('/api/invitations/')) {
      if (path.includes('invalid')) return error('Invitation not found or invalid.', 404);
      if (path.endsWith('/accept')) return send({ accepted: true, alreadyAccepted: false, workspace: { id: 'test-production', name: 'Platform operations' }, role: 'MEMBER' });
      return send({ invitedGithubLogin: state.mismatch ? 'another-account' : 'sentinel-owner', status: state.invitationStatus, expiresAt: new Date(Date.now() + 86400000).toISOString(), matchesCurrentUser: !state.mismatch, workspace: state.mismatch ? undefined : { id: 'test-production', name: 'Platform operations' }, invitedBy: { githubLogin: 'sam-dev', displayName: 'Sam Rivera' }, role: 'MEMBER' });
    }
    return error(`Unhandled local fixture route: ${method} ${path}`, 404);
  });
  return state;
}
