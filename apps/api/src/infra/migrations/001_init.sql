CREATE TABLE elders (
  id          TEXT PRIMARY KEY,
  phone       TEXT NOT NULL UNIQUE,
  name        TEXT,
  language    TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE family_members (
  id          TEXT PRIMARY KEY,
  elder_id    TEXT NOT NULL REFERENCES elders(id),
  name        TEXT,
  phone       TEXT NOT NULL,
  auth0_sub   TEXT UNIQUE,
  created_at  TEXT NOT NULL,
  UNIQUE (elder_id, phone)
);

CREATE TABLE messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  elder_id     TEXT NOT NULL REFERENCES elders(id),
  external_id  TEXT UNIQUE,
  payload      TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX messages_elder ON messages (elder_id, id);

CREATE TABLE events (
  id           TEXT PRIMARY KEY,
  elder_id     TEXT NOT NULL REFERENCES elders(id),
  type         TEXT NOT NULL,
  severity     TEXT NOT NULL,
  summary      TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'new',
  created_at   TEXT NOT NULL,
  resolved_at  TEXT,
  resolved_by  TEXT REFERENCES family_members(id)
);
CREATE INDEX events_feed ON events (elder_id, status, created_at);

CREATE TABLE reminders (
  id          TEXT PRIMARY KEY,
  elder_id    TEXT NOT NULL REFERENCES elders(id),
  what        TEXT NOT NULL,
  due_text    TEXT NOT NULL,
  due_at      TEXT,
  status      TEXT NOT NULL DEFAULT 'scheduled',
  job_id      TEXT,
  created_at  TEXT NOT NULL
);
