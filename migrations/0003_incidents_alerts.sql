PRAGMA foreign_keys = ON;

CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  severity TEXT NOT NULL CHECK (severity IN ('DEGRADED', 'CRITICAL')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  first_result_id TEXT,
  latest_result_id TEXT,
  consecutive_failure_count INTEGER NOT NULL CHECK (consecutive_failure_count >= 0),
  started_at TEXT NOT NULL,
  acknowledged_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE,
  FOREIGN KEY (first_result_id) REFERENCES check_results(id) ON DELETE SET NULL,
  FOREIGN KEY (latest_result_id) REFERENCES check_results(id) ON DELETE SET NULL
);

CREATE TABLE incident_events (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('OPENED', 'SEVERITY_CHANGED', 'ACKNOWLEDGED', 'RESOLVED', 'REOPENED')),
  from_severity TEXT CHECK (from_severity IS NULL OR from_severity IN ('DEGRADED', 'CRITICAL')),
  to_severity TEXT CHECK (to_severity IS NULL OR to_severity IN ('DEGRADED', 'CRITICAL')),
  result_id TEXT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  FOREIGN KEY (result_id) REFERENCES check_results(id) ON DELETE SET NULL
);

CREATE TABLE alert_deliveries (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  incident_event_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  deduplication_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'DELIVERED', 'FAILED', 'SKIPPED')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  response_status INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  FOREIGN KEY (incident_event_id) REFERENCES incident_events(id) ON DELETE CASCADE,
  CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599)
);

ALTER TABLE check_results ADD COLUMN incident_evaluated_at TEXT;

-- Do not generate incidents or alerts retroactively for results that predate
-- this migration. Newly inserted results leave this column NULL.
UPDATE check_results
  SET incident_evaluated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE incident_evaluated_at IS NULL;

CREATE UNIQUE INDEX idx_incidents_one_active_endpoint
  ON incidents(endpoint_id) WHERE status IN ('OPEN', 'ACKNOWLEDGED');
CREATE INDEX idx_incidents_workspace_status_updated
  ON incidents(workspace_id, status, updated_at DESC);
CREATE INDEX idx_incidents_endpoint_started
  ON incidents(endpoint_id, started_at DESC);
CREATE INDEX idx_incidents_workspace_severity
  ON incidents(workspace_id, severity);
CREATE INDEX idx_incident_events_incident_created
  ON incident_events(incident_id, created_at ASC);
CREATE UNIQUE INDEX idx_incident_events_result_transition
  ON incident_events(incident_id, event_type, result_id) WHERE result_id IS NOT NULL;
CREATE UNIQUE INDEX idx_incident_events_single_terminal_transition
  ON incident_events(incident_id, event_type)
  WHERE event_type IN ('ACKNOWLEDGED', 'RESOLVED');
CREATE INDEX idx_alert_deliveries_status_updated
  ON alert_deliveries(status, updated_at);
CREATE INDEX idx_alert_deliveries_incident_created
  ON alert_deliveries(incident_id, created_at DESC);
CREATE INDEX idx_check_results_incident_evaluation
  ON check_results(incident_evaluated_at, checked_at) WHERE incident_evaluated_at IS NULL;
