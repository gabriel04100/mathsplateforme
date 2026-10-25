-- Cache des traductions.
--
-- La traduction automatique sert aux élèves allophones : ils affichent le cours
-- dans leur langue le temps de comprendre la consigne. Un même paragraphe de
-- cours est donc demandé par toute la classe, et il ne change pas : on le
-- traduit une fois, on le garde.
--
-- Ce cache est aussi ce qui rend la fonction tenable : sans lui, chaque
-- affichage repartirait chez le fournisseur de traduction (coût, latence, et
-- un aller-retour de plus pour rien).
CREATE TABLE translations (
  target      TEXT NOT NULL,              -- langue d'arrivée ('en', 'ar'…)
  source_hash TEXT NOT NULL,              -- sha256 du texte source : clé courte et sûre
  source      TEXT NOT NULL,
  translated  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (target, source_hash)
);
