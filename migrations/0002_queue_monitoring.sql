PRAGMA foreign_keys = ON;

CREATE TABLE monitoring_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  deduplication_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('SCHEDULED', 'MANUAL')),
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')),
  scheduled_for TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE
);

CREATE INDEX idx_monitoring_jobs_status_scheduled_for
  ON monitoring_jobs(status, scheduled_for);
CREATE INDEX idx_monitoring_jobs_endpoint_created_at
  ON monitoring_jobs(endpoint_id, created_at DESC);
CREATE INDEX idx_monitoring_jobs_workspace_status
  ON monitoring_jobs(workspace_id, status);

ALTER TABLE check_results
  ADD COLUMN job_id TEXT REFERENCES monitoring_jobs(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX idx_check_results_unique_job
  ON check_results(job_id) WHERE job_id IS NOT NULL;
