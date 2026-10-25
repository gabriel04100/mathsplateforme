// Confiance déclarée en fin de chapitre, et révision flash à la connexion.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const baseConfig = require('../server/config');
const { createApp } = require('../server/app');
const { makeClient, login, completeChapter } = require('./helpers');

let server;
let base;
let services;
let db;
let classId;
let premier;

// Le temps qui passe : la révision flash écarte ce qui vient d'être travaillé,
// on recule donc les dates comme l'auraient fait quelques jours.
function vieillirProgression(username) {
  const u = services.repos.users.findByUsername(username);
  db.prepare("UPDATE step_progress SET updated_at = datetime('now','-3 days') WHERE user_id = ?").run(u.id);
}

before(async () => {
  const config = { ...baseConfig, dbFile: ':memory:', bcryptRounds: 4, isProd: false, loginRateLimit: { windowMs: 60000, max: 50 } };
  const built = await createApp(config, { log: { info() {}, error: console.error } });
  services = built.services;
  db = built.db;
  await services.accounts.createTeacher({ username: 'prof', password: 'motdepasse-prof', displayName: 'Gabriel Pizzo' });
  server = built.app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

const client = () => makeClient(base);

test('mise en place : une élève de 6e qui termine son premier chapitre', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  classId = (await prof.post('/teacher/classes', { name: '6e A', level: '6e' })).body.class.id;
  await prof.post(`/teacher/classes/${classId}/students`, {
    students: [{ pseudonym: 'Loutre curieuse', username: 'lea', password: 'soleil42' }],
  });

  const eleve = await login(client(), 'lea', 'soleil42');
  premier = (await eleve.get('/levels/6e')).body.chapters.find((c) => c.status === 'published').id;
  await completeChapter(eleve, premier);
  assert.equal((await eleve.get(`/chapters/${premier}`)).body.progress.status, 'done');
});

test('l’élève déclare son niveau de confiance, et peut le changer', async () => {
  const eleve = await login(client(), 'lea', 'soleil42');
  assert.equal((await eleve.get(`/chapters/${premier}`)).body.confiance, null);

  assert.equal((await eleve.post('/progress/confiance', { chapterId: premier, level: 2 })).status, 200);
  assert.equal((await eleve.get(`/chapters/${premier}`)).body.confiance, 2);

  // Un avis se révise : la dernière déclaration remplace la précédente.
  await eleve.post('/progress/confiance', { chapterId: premier, level: 4 });
  assert.equal((await eleve.get(`/chapters/${premier}`)).body.confiance, 4);

  // Hors de l'échelle 1–4, c'est refusé.
  for (const level of [0, 5, 2.5, 'beaucoup', null]) {
    assert.equal((await eleve.post('/progress/confiance', { chapterId: premier, level })).status, 400, `niveau ${level}`);
  }
  assert.equal((await eleve.post('/progress/confiance', { chapterId: 'chapitre-invente', level: 3 })).status, 404);
});

test('la révision flash ne propose rien tant que le chapitre vient d’être travaillé', async () => {
  const eleve = await login(client(), 'lea', 'soleil42');
  // Le chapitre a été terminé à l'instant : inutile de le faire réviser.
  assert.equal((await eleve.get('/revision-flash')).body.revision, null);
});

test('la révision flash propose deux questions d’un chapitre plus ancien', async () => {
  vieillirProgression('lea');

  const eleve = await login(client(), 'lea', 'soleil42');
  const revision = (await eleve.get('/revision-flash')).body.revision;
  assert.ok(revision, 'une révision doit être proposée');
  assert.equal(revision.chapterId, premier);
  assert.ok(revision.etapes.length >= 1);
  assert.ok(revision.etapes.length <= 2, 'une révision flash ne dépasse jamais deux questions');
  for (const e of revision.etapes) {
    assert.ok(e.generator || e.template, 'chaque étape doit pouvoir produire une question');
  }
});

test('la révision flash ne concerne que les élèves, jamais l’enseignant', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  assert.equal((await prof.get('/revision-flash')).body.revision, null);

  // Et un visiteur sans session n'y accède pas du tout.
  assert.equal((await client().get('/revision-flash')).status, 401);
  assert.equal((await client().post('/progress/confiance', { chapterId: premier, level: 3 })).status, 401);
});

test('remettre un élève à zéro efface aussi sa confiance déclarée', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const lea = (await prof.get(`/teacher/classes/${classId}/students`)).body.students[0];
  assert.equal((await prof.post(`/teacher/students/${lea.id}/reset-progress`)).status, 200);

  const eleve = await login(client(), 'lea', 'soleil42');
  assert.equal((await eleve.get(`/chapters/${premier}`)).body.confiance, null);
});
