-- Modifier les chapitres livrés dans content/, et réordonner le parcours.
--
-- Les fichiers de content/ restent la version d'origine, commune à tous. Quand
-- un enseignant modifie, déplace ou masque un de ces chapitres, on enregistre
-- ici *sa* version : ses classes la voient, les fichiers ne bougent pas, et un
-- retour à l'origine est toujours possible (il suffit d'effacer la ligne).
--
-- Une colonne à NULL veut dire « garder ce que dit le fichier ». Une ligne où
-- seule « position » est remplie ne fait donc que déplacer le chapitre.
CREATE TABLE chapter_overrides (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chapter_id TEXT    NOT NULL,              -- identifiant du chapitre de content/
  position   INTEGER,                       -- NULL = ordre du fichier
  hidden     INTEGER NOT NULL DEFAULT 0,    -- retiré du parcours de ses classes
  title      TEXT,                          -- NULL = titre du fichier
  summary    TEXT,
  status     TEXT CHECK (status IS NULL OR status IN ('draft', 'published')),
  steps      TEXT,                          -- NULL = contenu du fichier
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (teacher_id, chapter_id)
);

CREATE INDEX idx_ch_override_teacher ON chapter_overrides(teacher_id);
