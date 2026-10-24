-- Chapitres écrits par l'enseignant depuis l'interface : cours ET parcours.
-- Jusqu'ici le programme ne venait que des fichiers JSON de content/. Ces
-- chapitres-là s'ajoutent au parcours des classes de leur auteur.
--
-- « steps » contient la suite des étapes (cours, animation, exercices) en JSON,
-- validée côté serveur avant écriture. Les textes de cours sont stockés en
-- version source (markdown léger) et rendus en HTML sûr au moment de servir.
CREATE TABLE custom_chapters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level      TEXT    NOT NULL,                 -- '6e' | '5e' | '4e' | '3e'
  title      TEXT    NOT NULL,
  summary    TEXT    NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 100,     -- place dans le parcours du niveau
  steps      TEXT    NOT NULL,                 -- JSON : les étapes du chapitre
  status     TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  archived   INTEGER NOT NULL DEFAULT 0,
  class_id   INTEGER REFERENCES classes(id) ON DELETE CASCADE, -- NULL = toutes les classes du niveau
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_custom_ch_teacher ON custom_chapters(teacher_id);
CREATE INDEX idx_custom_ch_level   ON custom_chapters(level, status, archived);
CREATE INDEX idx_custom_ch_class   ON custom_chapters(class_id);
