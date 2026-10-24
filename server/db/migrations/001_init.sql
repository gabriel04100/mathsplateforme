-- Schéma initial — Plateforme Maths Collège (Gabriel Pizzo)
-- SQL volontairement portable (SQLite ⇄ PostgreSQL) : types simples, dates ISO en texte.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('teacher', 'student')),
  display_name  TEXT    NOT NULL,
  class_id      INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at TEXT
);

CREATE TABLE classes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  level       TEXT    NOT NULL,              -- '6e' | '5e' | '4e' | '3e'
  teacher_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_year TEXT    NOT NULL,              -- ex. '2026-2027'
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (teacher_id, name, school_year)
);

CREATE TABLE sessions (
  token_hash TEXT    PRIMARY KEY,            -- sha256 du jeton : le jeton brut n'est jamais stocké
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT    NOT NULL
);

-- État de chaque étape (cours lu, animation vue, exercice réussi…) par élève.
CREATE TABLE step_progress (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chapter_id  TEXT    NOT NULL,
  step_id     TEXT    NOT NULL,
  status      TEXT    NOT NULL CHECK (status IN ('seen', 'in_progress', 'passed')),
  best_score  INTEGER,
  best_total  INTEGER,
  attempts    INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, chapter_id, step_id)
);

-- Historique brut de chaque tentative : base des futures statistiques.
CREATE TABLE attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chapter_id  TEXT    NOT NULL,
  step_id     TEXT    NOT NULL,
  mode        TEXT    NOT NULL DEFAULT 'parcours' CHECK (mode IN ('parcours', 'libre')),
  score       INTEGER NOT NULL,
  total       INTEGER NOT NULL,
  duration_s  INTEGER,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- « Où je me suis arrêté » : une ligne par élève.
CREATE TABLE last_position (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  chapter_id TEXT    NOT NULL,
  step_id    TEXT    NOT NULL,
  mode       TEXT    NOT NULL DEFAULT 'parcours',
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_users_class        ON users(class_id);
CREATE INDEX idx_classes_teacher    ON classes(teacher_id);
CREATE INDEX idx_sessions_user      ON sessions(user_id);
CREATE INDEX idx_sessions_expires   ON sessions(expires_at);
CREATE INDEX idx_attempts_user_time ON attempts(user_id, created_at);
CREATE INDEX idx_attempts_chapter   ON attempts(chapter_id, step_id);
