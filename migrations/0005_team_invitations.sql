PRAGMA foreign_keys = ON;

CREATE TABLE workspace_invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  invited_github_login TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role = 'MEMBER'),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
  invited_by_user_id TEXT NOT NULL,
  accepted_by_user_id TEXT,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (accepted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CHECK ((status = 'ACCEPTED') = (accepted_by_user_id IS NOT NULL AND accepted_at IS NOT NULL)),
  CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX idx_workspace_invitations_pending_login
  ON workspace_invitations(workspace_id, invited_github_login COLLATE NOCASE)
  WHERE status = 'PENDING';
CREATE INDEX idx_workspace_invitations_workspace_status
  ON workspace_invitations(workspace_id, status, created_at DESC);
CREATE INDEX idx_workspace_invitations_expiry
  ON workspace_invitations(status, expires_at) WHERE status = 'PENDING';

CREATE TRIGGER trg_workspace_invitations_active_limit
BEFORE INSERT ON workspace_invitations
WHEN NEW.status = 'PENDING' AND (
  SELECT COUNT(*) FROM workspace_invitations
  WHERE workspace_id = NEW.workspace_id AND status = 'PENDING'
) >= 50
BEGIN
  SELECT RAISE(ABORT, 'active invitation limit');
END;

CREATE TABLE workspace_audit_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INVITATION_CREATED', 'INVITATION_REVOKED', 'INVITATION_ACCEPTED', 'MEMBER_REMOVED', 'MEMBER_ROLE_CHANGED')),
  target_user_id TEXT,
  invitation_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (invitation_id) REFERENCES workspace_invitations(id) ON DELETE SET NULL,
  CHECK (json_valid(metadata))
);

CREATE UNIQUE INDEX idx_workspace_audit_invitation_action
  ON workspace_audit_events(invitation_id, action)
  WHERE invitation_id IS NOT NULL;
CREATE INDEX idx_workspace_audit_workspace_created
  ON workspace_audit_events(workspace_id, created_at DESC);
