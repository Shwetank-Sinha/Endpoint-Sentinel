PRAGMA foreign_keys = ON;

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE endpoints (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT NOT NULL,
  expected_status INTEGER NOT NULL,
  timeout_ms INTEGER NOT NULL,
  latency_threshold_ms INTEGER NOT NULL,
  check_interval_minutes INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CHECK (method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS')),
  CHECK (expected_status BETWEEN 100 AND 599),
  CHECK (timeout_ms BETWEEN 100 AND 120000),
  CHECK (latency_threshold_ms BETWEEN 1 AND 120000),
  CHECK (check_interval_minutes BETWEEN 1 AND 10080)
);

CREATE TABLE check_results (
  id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  status_code INTEGER,
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('HEALTHY', 'DEGRADED', 'CRITICAL')),
  error_type TEXT,
  error_message TEXT,
  FOREIGN KEY (endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE,
  CHECK (status_code IS NULL OR status_code BETWEEN 100 AND 599)
);

CREATE INDEX idx_endpoints_workspace_id ON endpoints(workspace_id);
CREATE INDEX idx_endpoints_workspace_updated_at ON endpoints(workspace_id, updated_at DESC);
CREATE INDEX idx_check_results_endpoint_checked_at ON check_results(endpoint_id, checked_at DESC);

INSERT INTO workspaces (id, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'Default Workspace');
