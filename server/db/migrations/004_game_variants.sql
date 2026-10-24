-- Classement par variante de jeu.
-- Un score n'a de sens que comparé à armes égales : même niveau (donc mêmes
-- tables et même type de question) et même durée. On range donc chaque partie
-- sous une « variante » = <niveau>|<durée>, et chaque classement porte dessus.
ALTER TABLE game_scores ADD COLUMN variant TEXT NOT NULL DEFAULT '';

-- Les parties enregistrées avant cette notion n'ont pas de niveau connu :
-- on les range à part pour ne pas fausser les classements.
UPDATE game_scores SET variant = 'inconnu|' || duration_s WHERE variant = '';

DROP INDEX IF EXISTS idx_game_scores_board;
CREATE INDEX idx_game_scores_board ON game_scores(game_id, variant, score DESC);
