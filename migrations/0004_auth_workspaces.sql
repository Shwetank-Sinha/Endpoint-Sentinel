PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  github_id INTEGER NOT NULL UNIQUE,
  github_login TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE workspaces ADD COLUMN slug TEXT;
ALTER TABLE workspaces ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE SET NULL;

UPDATE workspaces
SET slug = CASE
  WHEN id = '00000000-0000-4000-8000-000000000001' THEN 'default-workspace'
  ELSE 'workspace-' || lower(replace(id, '-', ''))
END
WHERE slug IS NULL;

CREATE UNIQUE INDEX idx_workspaces_slug ON workspaces(slug);

CREATE TABLE workspace_memberships (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'MEMBER')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  return_to TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_memberships_user ON workspace_memberships(user_id, created_at);
CREATE INDEX idx_memberships_workspace_role ON workspace_memberships(workspace_id, role);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX idx_oauth_states_expiry ON oauth_states(expires_at);
