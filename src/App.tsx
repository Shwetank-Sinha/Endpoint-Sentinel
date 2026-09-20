import { useEffect, useState, type ReactNode } from 'react';
import DashboardApp from './DashboardApp';
import InvitationPage from './components/InvitationPage';
import TeamModal from './components/TeamModal';
import ThemeToggle from './components/ThemeToggle';
import Icon from './components/Icon';
import Avatar from './components/Avatar';
import { ApiClientError, authApi, setActiveWorkspace, type AuthSession } from './services/endpointsApi';

function invitationToken(pathname: string): string | null { const match = /^\/invite\/([^/]+)$/.exec(pathname); if (!match?.[1]) return null; try { return decodeURIComponent(match[1]); } catch { return null; } }
function Brand() { return <a href="#overview" className="es-brand"><span className="es-brand-mark"><Icon name="pulse" /></span><span>Endpoint<span className="es-brand-secondary">Sentinel</span></span></a>; }
function AuthFrame({ children }: { children: ReactNode }) { return <div className="es-auth-frame"><header className="es-auth-header"><Brand /><ThemeToggle /></header>{children}<footer className="es-auth-footer">ENDPOINT SENTINEL <span>Observe. Diagnose. Recover.</span></footer></div>; }

export default function App() {
  const [section, setSection] = useState(window.location.hash || '#overview');
  useEffect(() => { const changed = () => setSection(window.location.hash || '#overview'); window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed); }, []);
  const oauthFailure = new URLSearchParams(window.location.search).get('authError');
  const inviteToken = invitationToken(window.location.pathname);
  const [session, setSession] = useState<AuthSession | null>(null), [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(oauthFailure ? 'GitHub sign-in was cancelled or could not be completed.' : null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null), [workspaceName, setWorkspaceName] = useState('');
  const [creating, setCreating] = useState(false), [teamOpen, setTeamOpen] = useState(false), [loggingOut, setLoggingOut] = useState(false);
  async function loadSession(preferredWorkspaceId?: string, background = false) {
    if (!background) setLoading(true);
    if (!oauthFailure) setError(null);
    try {
      const current = await authApi.session();
      const selected = current.workspaces.find(w => w.id === preferredWorkspaceId)?.id ?? current.workspaces.find(w => w.id === workspaceId)?.id ?? current.workspaces[0]?.id ?? null;
      setSession(current); setWorkspaceId(selected); setActiveWorkspace(selected);
    } catch (cause) {
      if (!(cause instanceof ApiClientError && cause.status === 401)) setError(cause instanceof Error ? cause.message : 'Authentication could not be checked.');
      if (!background || cause instanceof ApiClientError && cause.status === 401) { setSession(null); setActiveWorkspace(null); }
    } finally { setLoading(false); }
  }
  useEffect(() => {
    if (oauthFailure) window.history.replaceState({}, '', window.location.pathname);
    void loadSession();
    const expired = () => { setSession(null); setWorkspaceId(null); setActiveWorkspace(null); setTeamOpen(false); setError('Your session expired. Sign in again to continue.'); };
    window.addEventListener('endpoint-sentinel:unauthorized', expired);
    return () => window.removeEventListener('endpoint-sentinel:unauthorized', expired);
  }, []);
  async function logout() {
    if (loggingOut) return; setLoggingOut(true);
    try { await authApi.logout(); setSession(null); setWorkspaceId(null); setActiveWorkspace(null); setTeamOpen(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign out failed. Please retry.'); }
    finally { setLoggingOut(false); }
  }
  async function createWorkspace() {
    if (creating || workspaceName.trim().length < 2) return; setCreating(true); setError(null);
    try { const workspace = await authApi.createWorkspace(workspaceName); setSession(current => current ? { ...current, workspaces: [...current.workspaces, workspace] } : current); setWorkspaceId(workspace.id); setActiveWorkspace(workspace.id); setWorkspaceName(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Workspace could not be created.'); } finally { setCreating(false); }
  }
  if (loading) return <AuthFrame><main className="es-auth"><div className="es-auth-card"><p className="es-eyebrow">Secure access</p><h1>Endpoint Sentinel</h1><p role="status"><span className="es-spinner" /> Checking your secure session…</p></div></main></AuthFrame>;
  if (!session) return <AuthFrame><main className="es-auth"><div className="es-auth-intro"><p className="es-eyebrow">Reliability starts with visibility</p><h2>Your endpoints.<br />Under observation.</h2><p>A clear view of endpoint health, incidents, and recovery. Built for the people keeping systems running.</p><div className="es-auth-principles"><span>01 / Monitor</span><span>02 / Investigate</span><span>03 / Recover</span></div></div><div className="es-auth-card"><span className="es-auth-mark"><Icon name="pulse" /></span><p className="es-eyebrow">Workspace access</p><h1>{inviteToken ? 'Sign in to view your invitation' : 'Welcome to Sentinel'}</h1><p>Sign in to your monitoring workspace with your GitHub account.</p>{error ? <p className="es-form__error" role="alert">{error}</p> : null}<a className="es-btn es-btn--primary es-auth-login" href={'/api/auth/github?returnTo=' + encodeURIComponent(inviteToken ? window.location.pathname : '/')}>Continue with GitHub <Icon name="arrow" /></a><small>Authentication is handled by GitHub. Endpoint Sentinel never stores your GitHub access token.</small></div></main></AuthFrame>;
  if (inviteToken) return <AuthFrame><InvitationPage token={inviteToken} session={session} onAccepted={id => { window.history.replaceState({}, '', '/'); void loadSession(id); }} onCancel={() => { window.history.replaceState({}, '', '/'); void loadSession(); }} /></AuthFrame>;
  if (!workspaceId) return <AuthFrame><main className="es-auth"><div className="es-auth-card"><p className="es-eyebrow">Get started</p><h1>Create a workspace</h1><p>Signed in as <strong>@{session.user.githubLogin}</strong>. You do not have access to the existing workspace.</p><form className="es-form" onSubmit={e => { e.preventDefault(); void createWorkspace(); }}><label className="es-form__field"><span className="es-form__label">Workspace name</span><input className="es-form__input" required minLength={2} value={workspaceName} maxLength={80} onChange={e => setWorkspaceName(e.target.value)} /></label><button className="es-btn es-btn--primary" disabled={creating || workspaceName.trim().length < 2}>{creating ? 'Creating…' : 'Create workspace'}</button></form><button className="es-btn" disabled={loggingOut} onClick={() => void logout()}>Sign out</button>{error ? <p className="es-form__error" role="alert">{error}</p> : null}</div></main></AuthFrame>;
  const workspace = session.workspaces.find(w => w.id === workspaceId)!;
  return <div className="es-shell">
    <a className="es-skip" href="#overview">Skip to dashboard</a>
    <aside className="es-sidebar"><Brand /><p className="es-nav-label">Workspace</p><nav aria-label="Main navigation">
      <a href="#overview" aria-current={section === '#overview' ? 'location' : undefined}><Icon name="grid" />Overview</a><a href="#endpoints" aria-current={section === '#endpoints' ? 'location' : undefined}><Icon name="endpoint" />Endpoints</a><a href="#incidents" aria-current={section === '#incidents' ? 'location' : undefined}><Icon name="incident" />Incidents</a>
      {workspace.role === 'OWNER' ? <button type="button" onClick={() => setTeamOpen(true)}><Icon name="team" />Team</button> : null}
    </nav><div className="es-sidebar-foot"><span className="es-eyebrow">Endpoint Sentinel</span><p>Observe. Diagnose.<br />Recover.</p></div></aside>
    <div className="es-workspace"><header className="es-account-bar">
      <label className="es-workspace-select"><span className="es-nav-label">Workspace</span><select aria-label="Workspace" value={workspaceId} onChange={e => { setWorkspaceId(e.target.value); setActiveWorkspace(e.target.value); setTeamOpen(false); }}>{session.workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select><span className="es-role">{workspace.role.toLowerCase()}</span></label>
      <div className="es-account-actions"><ThemeToggle /><div className="es-account-user"><Avatar name={session.user.githubLogin} url={session.user.avatarUrl} /><span title={session.user.displayName ?? session.user.githubLogin}>@{session.user.githubLogin}</span></div><button className="es-btn es-btn--quiet" disabled={loggingOut} onClick={() => void logout()}>{loggingOut ? 'Signing out…' : 'Sign out'}</button></div>
    </header>{error ? <p className="es-shell-error es-form__error" role="alert">{error}</p> : null}<DashboardApp key={workspaceId} />
    {teamOpen && workspace.role === 'OWNER' ? <TeamModal workspace={workspace} currentUserId={session.user.id} onClose={() => setTeamOpen(false)} onMembershipChanged={() => void loadSession(workspaceId, true)} /> : null}</div>
  </div>;
}
