-- Niveau de confiance déclaré par l'élève à la fin d'un chapitre.
--
-- C'est une information que ni le score ni le temps passé ne donnent : un élève
-- peut réussir ses exercices et rester mal à l'aise, ou se croire à l'aise et
-- se tromper. L'écart entre ce qu'il déclare et ce qu'il réussit est justement
-- ce qui intéresse l'enseignant.
--
-- Une seule ligne par élève et par chapitre : la déclaration la plus récente
-- remplace la précédente.
CREATE TABLE chapter_confidence (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chapter_id TEXT    NOT NULL,
  level      INTEGER NOT NULL CHECK (level BETWEEN 1 AND 4), -- 1 = perdu, 4 = à l'aise
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, chapter_id)
);

CREATE INDEX idx_confiance_chapitre ON chapter_confidence(chapter_id, level);
