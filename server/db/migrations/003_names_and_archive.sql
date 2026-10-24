-- Prénom et nom séparés pour les élèves, et possibilité d'archiver.

-- Jusqu'ici un seul champ « Prénom Nom ». On garde display_name (utilisé partout
-- pour l'affichage) et on ajoute les deux parties, utiles pour trier par nom de
-- famille et pour remplir les listes de classe.
ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN last_name  TEXT;

-- Reprise de l'existant : on coupe au premier espace, comme le faisait la saisie.
UPDATE users SET
  first_name = CASE WHEN instr(display_name, ' ') > 0 THEN substr(display_name, 1, instr(display_name, ' ') - 1) ELSE display_name END,
  last_name  = CASE WHEN instr(display_name, ' ') > 0 THEN substr(display_name, instr(display_name, ' ') + 1) ELSE '' END
WHERE role = 'student';

-- Archivage : on range sans supprimer (fin d'année, exercice mis de côté…).
-- Un indicateur à part plutôt qu'un statut supplémentaire, pour que « publié »
-- ou « brouillon » soit retrouvé intact au désarchivage.
ALTER TABLE classes           ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE custom_exercises  ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_users_last_name ON users(last_name);
