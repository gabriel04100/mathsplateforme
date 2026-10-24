-- Documents PDF déposés par l'enseignant et téléchargeables par ses élèves.
--
-- Le fichier lui-même vit sur le disque, dans data/documents/ (déjà hors du
-- dépôt git). La base ne garde que la fiche signalétique : la table reste
-- légère et une sauvegarde SQL ne traîne pas des mégaoctets de pièces jointes.
--
-- « chapter_id » à NULL = document de niveau, visible dans tout le niveau ;
-- sinon il s'affiche dans le chapitre concerné.
CREATE TABLE documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level       TEXT    NOT NULL,                 -- '6e' | '5e' | '4e' | '3e'
  chapter_id  TEXT,                             -- NULL = tout le niveau
  class_id    INTEGER REFERENCES classes(id) ON DELETE CASCADE, -- NULL = toutes ses classes
  title       TEXT    NOT NULL,
  filename    TEXT    NOT NULL,                 -- nom d'origine, montré à l'élève
  stored_name TEXT    NOT NULL UNIQUE,          -- nom sur le disque, tiré au sort
  size_bytes  INTEGER NOT NULL,
  downloads   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_documents_teacher ON documents(teacher_id);
CREATE INDEX idx_documents_level   ON documents(level, chapter_id);
