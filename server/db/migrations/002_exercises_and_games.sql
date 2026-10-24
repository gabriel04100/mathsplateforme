-- Exercices écrits par l'enseignant + jeux et classement global.
-- Même esprit que 001 : SQL portable (SQLite ⇄ PostgreSQL), dates ISO en texte.

-- Un exercice rédigé dans l'espace enseignant. « definition » contient le
-- modèle (variables, énoncé, réponse, correction) en JSON, validé côté serveur
-- avant écriture : la base ne stocke jamais de code exécutable.
CREATE TABLE custom_exercises (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level        TEXT    NOT NULL,                 -- '6e' | '5e' | '4e' | '3e'
  title        TEXT    NOT NULL,
  instructions TEXT    NOT NULL DEFAULT '',
  definition   TEXT    NOT NULL,                 -- JSON du modèle
  count        INTEGER NOT NULL DEFAULT 6,       -- questions par série
  pass         INTEGER NOT NULL DEFAULT 5,       -- bonnes réponses pour valider
  status       TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  class_id     INTEGER REFERENCES classes(id) ON DELETE CASCADE, -- NULL = toutes les classes du niveau
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Une partie jouée. Le classement se calcule à partir d'ici (meilleur score par élève).
CREATE TABLE game_scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id    TEXT    NOT NULL,                   -- ex. 'tables-multiplication'
  score      INTEGER NOT NULL,
  correct    INTEGER NOT NULL DEFAULT 0,
  wrong      INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  duration_s INTEGER NOT NULL,
  details    TEXT,                               -- JSON libre (réglages de la partie)
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_custom_ex_teacher ON custom_exercises(teacher_id);
CREATE INDEX idx_custom_ex_level   ON custom_exercises(level, status);
CREATE INDEX idx_custom_ex_class   ON custom_exercises(class_id);
CREATE INDEX idx_game_scores_board ON game_scores(game_id, score DESC);
CREATE INDEX idx_game_scores_user  ON game_scores(user_id, game_id);
