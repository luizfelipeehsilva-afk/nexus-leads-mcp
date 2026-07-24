-- Nexus Leads AI — MCP Bridge V1
-- Execute uma única vez no mesmo D1 nexus-leads-db.

CREATE TABLE IF NOT EXISTS mcp_audit_log (
  id TEXT PRIMARY KEY,
  github_login TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  input_json TEXT NOT NULL DEFAULT '{}',
  result_summary TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mcp_audit_created
ON mcp_audit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_audit_tool
ON mcp_audit_log(tool_name, status, created_at DESC);

CREATE TABLE IF NOT EXISTS mcp_test_runs (
  id TEXT PRIMARY KEY,
  github_login TEXT NOT NULL,
  lead_id TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cleaned_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_mcp_test_runs_status
ON mcp_test_runs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS app_migrations (
  migration_key TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO app_migrations(migration_key)
VALUES('0017_mcp_bridge_v1');
