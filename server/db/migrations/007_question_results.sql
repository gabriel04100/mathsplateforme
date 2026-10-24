-- Détail des réponses, question par question.
--
-- « attempts » dit combien l'élève a eu de bonnes réponses ; il ne dit pas
-- lesquelles, ni ce qu'il a répondu à la place. C'est pourtant là qu'est
-- l'information utile à l'enseignant : une classe qui répond « -x+7 » à
-- « -(x+7) » n'a pas un problème de calcul, elle a un problème de signe.
--
-- Une ligne par question posée. Volume attendu : une classe de 25 élèves qui
-- fait 5 séries de 8 questions sur 40 chapitres produit environ 40 000 lignes,
-- ce que SQLite encaisse sans broncher.
CREATE TABLE question_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id  INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chapter_id  TEXT    NOT NULL,
  step_id     TEXT    NOT NULL,
  position    INTEGER NOT NULL,            -- rang de la question dans la série
  prompt      TEXT    NOT NULL,            -- énoncé tel que l'élève l'a lu
  expected    TEXT    NOT NULL DEFAULT '', -- réponse attendue
  given       TEXT    NOT NULL DEFAULT '', -- ce que l'élève a répondu
  ok          INTEGER NOT NULL,
  duration_s  INTEGER,                     -- temps passé sur cette question
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Les deux lectures prévues : « où ça coince dans ce chapitre » et
-- « qu'est-ce que cet élève rate ».
CREATE INDEX idx_qresults_step ON question_results(chapter_id, step_id, ok);
CREATE INDEX idx_qresults_user ON question_results(user_id, created_at);
