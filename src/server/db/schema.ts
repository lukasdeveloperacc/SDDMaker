export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  idea TEXT NOT NULL,
  design_md TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interviews (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  agent TEXT CHECK (agent IN ('claude','codex')),
  session_id TEXT,
  summary TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','summarized','approved','skipped'))
);

CREATE TABLE IF NOT EXISTS interview_messages (
  id INTEGER PRIMARY KEY,
  interview_id INTEGER NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('agent','user')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  previous_content TEXT,
  status TEXT NOT NULL CHECK (status IN ('empty','draft','approved')),
  upstream_changed INTEGER NOT NULL DEFAULT 0 CHECK (upstream_changed IN (0,1)),
  agent TEXT CHECK (agent IN ('claude','codex')),
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, path)
);
`;
