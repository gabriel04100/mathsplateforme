-- Séries d'exercices vérifiées par le serveur.
--
-- Jusqu'ici le navigateur calculait le score et l'envoyait : rien n'empêchait
-- un élève d'en poster un faux depuis sa console, et le tableau de suivi de
-- l'enseignant mentait en silence.
--
-- Désormais le serveur donne une graine au début d'une série, la retient ici,
-- puis rejoue exactement la même suite de questions pour corriger lui-même les
-- réponses reçues. Le navigateur n'envoie plus que ce que l'élève a tapé.
CREATE TABLE exercise_sessions (
  id         TEXT    PRIMARY KEY,              -- jeton aléatoire remis au navigateur
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chapter_id TEXT    NOT NULL,
  step_id    TEXT    NOT NULL,
  seed       TEXT    NOT NULL,                 -- de quoi rejouer la série à l'identique
  count      INTEGER NOT NULL,
  mode       TEXT    NOT NULL DEFAULT 'parcours',
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  used_at    TEXT                              -- corrigée une fois, pas deux
);

CREATE INDEX idx_series_user ON exercise_sessions(user_id, created_at);
