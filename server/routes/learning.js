// Routes élèves : contenu + progression. Toutes nécessitent d'être connecté.
const express = require('express');
const { requireAuth } = require('../middleware');

module.exports = function learningRoutes({ content, progress, exercises, chapters }) {
  const r = express.Router();
  r.use(requireAuth);

  // Exercices écrits par l'enseignant de la classe (hors parcours).
  r.get('/custom-exercises', (req, res) => res.json({ exercises: exercises.listForStudent(req.user) }));
  r.get('/custom-exercises/:id', (req, res) => res.json(exercises.getPlayable(req.user, req.params.id)));
  r.post('/custom-exercises/:id/attempt', (req, res) => res.json(exercises.recordAttempt(req.user, req.params.id, req.body || {})));

  // Le catalogue dépend de l'utilisateur : il mêle le programme livré et les
  // chapitres écrits par son enseignant.
  r.get('/catalog', (req, res) => {
    res.json({ levels: chapters.catalogFor(req.user) });
  });

  r.get('/levels/:levelId', (req, res) => {
    const level = content.level(req.params.levelId);
    if (!level) return res.status(404).json({ error: 'Niveau inconnu' });
    res.json({
      level,
      chapters: chapters.forUser(req.user, level.id).map((c) => summarize(c)),
      progress: progress.levelProgress(req.user, level.id),
    });
  });

  // Chapitre complet (cours, paramètres des exercices…) + progression de l'élève.
  r.get('/chapters/:chapterId', (req, res) => {
    const ch = chapters.byIdForUser(req.user, req.params.chapterId);
    if (!ch || (ch.status !== 'published' && req.user.role !== 'teacher')) {
      return res.status(404).json({ error: 'Chapitre introuvable' });
    }
    const siblings = chapters.forUser(req.user, ch.level).filter((c) => c.status === 'published');
    const i = siblings.findIndex((c) => c.id === ch.id);
    const etat = progress.chapterProgress(req.user, ch.id);

    // Un chapitre encore verrouillé ne livre que sa table des matières :
    // l'élève doit pouvoir lire « ce chapitre arrive après le précédent »
    // sans que le cours et les exercices lui soient déjà servis.
    const verrouille = req.user.role !== 'teacher' && etat && !etat.unlocked;
    const contenu = verrouille
      ? { ...ch, steps: ch.steps.map((s) => ({ id: s.id, type: s.type, title: s.title })) }
      : ch;

    res.json({
      chapter: contenu,
      progress: etat,
      confiance: progress.confidenceFor(req.user, ch.id),
      prev: i > 0 ? { id: siblings[i - 1].id, title: siblings[i - 1].title } : null,
      next: i >= 0 && i < siblings.length - 1 ? { id: siblings[i + 1].id, title: siblings[i + 1].title } : null,
    });
  });

  r.post('/progress/visit', (req, res) => {
    res.json(progress.recordVisit(req.user, req.body || {}));
  });

  r.post('/progress/attempt', (req, res) => {
    res.json(progress.recordAttempt(req.user, req.body || {}));
  });

  r.get('/dashboard', (req, res) => {
    res.json(progress.dashboard(req.user));
  });

  // Confiance déclarée par l'élève à la fin d'un chapitre.
  r.post('/progress/confiance', (req, res) => res.json(progress.setConfidence(req.user, req.body || {})));

  // Révision flash proposée à la connexion : deux questions au plus, et
  // l'élève reste libre de décliner — c'est le client qui décide d'afficher.
  r.get('/revision-flash', (req, res) => res.json({ revision: progress.revisionFlash(req.user) }));

  // Résumé commun aux chapitres des fichiers et à ceux de l'enseignant.
  function summarize(c) {
    return {
      id: c.id,
      level: c.level,
      order: c.order,
      title: c.title,
      theme: c.theme || null,
      summary: c.summary || '',
      status: c.status,
      custom: !!c.custom,
      steps: c.steps.map((s) => ({ id: s.id, type: s.type, title: s.title, ...(s.type === 'exercise' ? { count: s.count, pass: s.pass } : {}) })),
    };
  }

  return r;
};
