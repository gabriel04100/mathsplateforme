// Espace enseignant : classes, comptes élèves, exercices, chapitres, suivi.
const express = require('express');
const { requireRole } = require('../middleware');

module.exports = function teacherRoutes({ accounts, progress, exercises, chapters }) {
  const r = express.Router();
  r.use(requireRole('teacher'));
  const tid = (req) => req.user.id;
  const wantsArchived = (req) => req.query.archives === '1';

  r.get('/password-suggestion', (req, res) => res.json({ password: accounts.generatePassword() }));

  r.get('/classes', (req, res) =>
    res.json({
      classes: accounts.listClasses(tid(req), { archived: wantsArchived(req) }),
      archivedCount: accounts.countArchivedClasses(tid(req)),
      schoolYear: accounts.currentSchoolYear(),
    })
  );
  r.post('/classes', (req, res) => res.status(201).json({ class: accounts.createClass(tid(req), req.body || {}) }));
  r.patch('/classes/:id', (req, res) => res.json({ class: accounts.updateClass(tid(req), req.params.id, req.body || {}) }));
  r.delete('/classes/:id', (req, res) => {
    accounts.deleteClass(tid(req), req.params.id);
    res.json({ ok: true });
  });

  r.get('/classes/:id/students', (req, res) => res.json({ students: accounts.listStudents(tid(req), req.params.id) }));
  r.post('/classes/:id/students', async (req, res) => {
    const created = await accounts.createStudents(tid(req), req.params.id, req.body?.students);
    res.status(201).json({ created });
  });

  r.get('/classes/:id/progress', (req, res) => {
    const cls = accounts.getClass(tid(req), req.params.id);
    const level = req.query.level || cls.level;
    res.json({ class: cls, level, ...progress.classGrid(cls.id, level) });
  });

  r.patch('/students/:id', async (req, res) => res.json(await accounts.updateStudent(tid(req), req.params.id, req.body || {})));
  r.delete('/students/:id', (req, res) => {
    accounts.deleteStudent(tid(req), req.params.id);
    res.json({ ok: true });
  });
  r.post('/students/:id/reset-progress', (req, res) => {
    accounts.resetProgress(tid(req), req.params.id);
    res.json({ ok: true });
  });

  // Exercices rédigés par l'enseignant.
  r.get('/exercises', (req, res) => res.json({ exercises: exercises.listForTeacher(tid(req), { archived: wantsArchived(req) }) }));
  r.get('/exercises/:id', (req, res) => res.json({ exercise: exercises.getForTeacher(tid(req), req.params.id) }));
  r.post('/exercises', (req, res) => res.status(201).json({ exercise: exercises.create(tid(req), req.body || {}) }));
  r.patch('/exercises/:id', (req, res) => res.json({ exercise: exercises.update(tid(req), req.params.id, req.body || {}) }));
  r.delete('/exercises/:id', (req, res) => {
    exercises.remove(tid(req), req.params.id);
    res.json({ ok: true });
  });

  // Le parcours d'un niveau : tous les chapitres, livrés comme personnels.
  r.get('/parcours/:level', (req, res) => res.json({ level: req.params.level, chapters: chapters.parcoursForTeacher(tid(req), req.params.level) }));
  r.patch('/parcours/:level', (req, res) =>
    res.json({ chapters: chapters.reorder(tid(req), req.params.level, req.body?.order) })
  );

  // Chapitres (cours + parcours) rédigés ou modifiés par l'enseignant.
  r.get('/chapters', (req, res) => res.json({ chapters: chapters.listForTeacher(tid(req), { archived: wantsArchived(req) }) }));
  r.get('/chapters/palette', (req, res) => res.json(chapters.palette(tid(req))));
  r.get('/chapters/:id', (req, res) => res.json({ chapter: chapters.getForTeacher(tid(req), req.params.id) }));
  r.post('/chapters', (req, res) => res.status(201).json({ chapter: chapters.create(tid(req), req.body || {}) }));
  r.patch('/chapters/:id', (req, res) => res.json({ chapter: chapters.update(tid(req), req.params.id, req.body || {}) }));
  // Oublier les modifications d'un chapitre livré : il redevient celui du fichier.
  r.post('/chapters/:id/reset', (req, res) => res.json({ chapter: chapters.resetOverride(tid(req), req.params.id) }));
  r.delete('/chapters/:id', (req, res) => {
    chapters.remove(tid(req), req.params.id);
    res.json({ ok: true });
  });

  return r;
};
