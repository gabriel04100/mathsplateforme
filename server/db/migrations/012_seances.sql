-- Une deuxième typologie de publication : les séances.
--
-- Un chapitre a vocation à entrer dans le parcours du niveau : il se place dans
-- un ordre, et il verrouille le suivant tant qu'il n'est pas terminé. Une
-- séance, non : c'est une activité ou une feuille d'exercices posée pour une
-- heure de cours, qu'on donne à une classe et qu'on retire la semaine suivante.
-- Elle est donc hors parcours, jamais verrouillée, et n'en verrouille rien.
--
-- Même table, parce que c'est exactement la même matière (des étapes : cours,
-- animation, exercices) et le même éditeur. Seule la place dans l'application
-- change, et c'est ce que dit cette colonne.
ALTER TABLE custom_chapters ADD COLUMN kind TEXT NOT NULL DEFAULT 'chapitre'
  CHECK (kind IN ('chapitre', 'activite', 'exercices'));

CREATE INDEX idx_custom_ch_kind ON custom_chapters(kind, level, status, archived);
