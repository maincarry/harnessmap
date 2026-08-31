-- harnessmap store: the two layers (DESIGN.md §2).
-- History layer: turns (append-only log). Goal layer: containers, items, links.
-- Bridge provenance: rounds + item_events.

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS containers (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  parent_id TEXT REFERENCES containers(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'live',       -- live | provisional | cut
  author TEXT NOT NULL DEFAULT 'user',       -- user | agent
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL,                        -- claim|question|option|decision|constraint|evidence|task
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  author TEXT NOT NULL,                      -- user | agent
  home_container_id TEXT NOT NULL REFERENCES containers(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  from_item_id TEXT NOT NULL REFERENCES items(id),
  to_id TEXT NOT NULL,                       -- item or container id
  to_kind TEXT NOT NULL DEFAULT 'item'       -- item | container
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  focus_container_id TEXT NOT NULL REFERENCES containers(id),
  sdk_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',     -- active | archived
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Lit set: which containers are illuminated into a chat's context (binary sight).
CREATE TABLE IF NOT EXISTS lit (
  chat_id TEXT NOT NULL REFERENCES chats(id),
  container_id TEXT NOT NULL REFERENCES containers(id),
  PRIMARY KEY (chat_id, container_id)
);

-- Append-only history layer. Never updated, never deleted.
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id),
  idx INTEGER NOT NULL,
  role TEXT NOT NULL,                        -- user | assistant | system
  content TEXT NOT NULL,
  raw TEXT,                                  -- raw SDK message JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (chat_id, idx)
);

-- The bridge: one row per translation round. summary is the debuggable middle layer.
CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id),
  turn_id TEXT NOT NULL REFERENCES turns(id),
  summary TEXT NOT NULL,
  alterations TEXT NOT NULL,                 -- JSON array of Alteration
  model TEXT NOT NULL,                       -- provenance: which model translated
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- EVENT SOURCE OF TRUTH (TD review 2026-08-12, finding 3): every map change —
-- whether from a translation round or a direct user edit — is one append-only
-- event here. containers/items/links are a rebuildable projection of this log.
CREATE TABLE IF NOT EXISTS map_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id),
  alteration TEXT NOT NULL,                  -- JSON: one Alteration
  source_kind TEXT NOT NULL,                 -- round | user_edit | system
  round_id TEXT REFERENCES rounds(id),       -- set when source_kind = round
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Save points: fork-at-save-point handles for exact rewind (DESIGN.md §8).
CREATE TABLE IF NOT EXISTS save_points (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id),
  name TEXT NOT NULL,
  fork_session_id TEXT,
  turn_idx INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_items_home ON items(home_container_id);
CREATE INDEX IF NOT EXISTS idx_containers_parent ON containers(parent_id);
CREATE INDEX IF NOT EXISTS idx_turns_chat ON turns(chat_id, idx);
CREATE INDEX IF NOT EXISTS idx_map_events_project ON map_events(project_id, seq);

-- v0.3.5: red-dot restructure suggestions (Jacob). The per-round filer never
-- restructures on its own; when it senses the need it files a suggestion here.
CREATE TABLE IF NOT EXISTS suggestions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  -- deliberately NO foreign key to containers: rebuildProjection deletes and
  -- replays that table; a suggestion whose container vanished is just ignored.
  container_id TEXT NOT NULL,
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',   -- open | dismissed | done
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_suggestions_project ON suggestions(project_id, status);

-- v0.3.7 migrations (idempotent). Models sometimes said 'removed' (item
-- vocabulary) for dead containers; everything filters on 'cut'. Normalize,
-- then clean up orphans left under dead parents: empty orphans die too,
-- non-empty ones pop to the root so nothing is silently hidden.
UPDATE containers SET status = 'cut' WHERE status = 'removed';
UPDATE containers SET status = 'cut'
  WHERE status != 'cut'
    AND parent_id IN (SELECT id FROM containers WHERE status = 'cut')
    AND NOT EXISTS (SELECT 1 FROM items i WHERE i.home_container_id = containers.id AND i.status != 'removed')
    AND NOT EXISTS (SELECT 1 FROM containers k WHERE k.parent_id = containers.id AND k.status != 'cut');
UPDATE containers SET parent_id = NULL
  WHERE status != 'cut'
    AND parent_id IN (SELECT id FROM containers WHERE status = 'cut');

-- v0.4 NODES UNIFICATION (Jacob, 2026-08-14): one kind of thing. containers +
-- items collapse into nodes; the old tables stay behind as a frozen backup
-- (nothing writes to them after migration). status 'removed' is the ONE dead
-- word. The migration is event-sourced: nodes are rebuilt from map_events.
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  parent_id TEXT,                            -- NULL = top level
  content TEXT NOT NULL,
  type TEXT,                                 -- claim/question/… NULL = plain topic
  status TEXT NOT NULL DEFAULT 'live',
  author TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project_id, parent_id);

-- v0.4.3 (M38): lazy relational descriptions, keyed by a neighborhood hash
-- (ids+updatedAt, 2 up / 2 down). Regenerated on read when the hash drifts.
CREATE TABLE IF NOT EXISTS relations (
  node_id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  nb_hash TEXT NOT NULL
);

-- v0.4.6 (M41): per-node chat memory — a running digest of conversation that
-- happened while the node was the focus. Derived data (like relations):
-- separate table so rebuildProjection never wipes it.
CREATE TABLE IF NOT EXISTS node_memory (
  node_id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- v0.4.7 (M42): second-place conversational memory — rolling summary of turns
-- that scrolled out of the verbatim window. Survives clean-chat (clean is a
-- view function). Derived data; rebuildProjection never touches it.
CREATE TABLE IF NOT EXISTS conversation_summary (
  chat_id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  folded_through INTEGER NOT NULL DEFAULT -1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- M58: harness adapter — node↔session index + per-round provenance.
CREATE TABLE IF NOT EXISTS harness_sessions (
  session_id TEXT PRIMARY KEY,
  node_id TEXT,                              -- focus node at session start
  transcript_path TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active TEXT,
  last_uuid TEXT,                            -- last observed message uuid
  injected_seq INTEGER,                      -- map-event seq at last full/delta injection
  full_seq INTEGER,                          -- map-event seq at last FULL injection
  cwd TEXT                                   -- host project dir (MAP.md target)
);
CREATE TABLE IF NOT EXISTS provenance (
  round_id TEXT PRIMARY KEY,
  session_id TEXT,
  message_uuids TEXT NOT NULL DEFAULT '[]',  -- JSON array
  tool_refs TEXT NOT NULL DEFAULT '[]',      -- JSON [{id,name,summary}]
  file_paths TEXT NOT NULL DEFAULT '[]',     -- JSON array
  urls TEXT NOT NULL DEFAULT '[]'            -- JSON array
);

-- M63: audit log — every harness decision, model call, and guard action,
-- for spot checks (Mark's D4: log now, dashboards later).
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}'
);

-- M84 (Jacob): node search — history like any dominant search function, and
-- favorites pinned when searching.
CREATE TABLE IF NOT EXISTS search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS favorites (
  node_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- M88 (Mark): multi-project MVP — each project is its own map. Sessions bind
-- to projects by working directory; the UI's active pair is persisted.
CREATE TABLE IF NOT EXISTS project_dirs (
  cwd TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- M107 (Jacob): fresh marks persist until the user interacts (or clears all).
CREATE TABLE IF NOT EXISTS fresh_marks (
  node_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                        -- new | changed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- M113: dev-mode traces — full prompts/responses (ring-capped in code).
CREATE TABLE IF NOT EXISTS dev_traces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL,          -- call | inject
  task TEXT NOT NULL,
  model TEXT, backend TEXT, ms INTEGER, ok INTEGER,
  system TEXT, user TEXT, response TEXT
);

-- M136: undo — inverse operations with pre-images (ring-capped in code).
CREATE TABLE IF NOT EXISTS undo_stack (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  label TEXT NOT NULL,
  inverse TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- M159b: feedback the user chose to report (local record only).
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- M184 (Mark): local metrics — user interactions, memory storage, map cost.
-- Local-only like everything else; the user can read every row.
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  project_id TEXT,
  kind TEXT NOT NULL,
  n REAL NOT NULL DEFAULT 1,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_metrics_kind ON metrics(kind);
