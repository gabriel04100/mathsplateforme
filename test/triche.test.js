// Le score est calculé par le serveur, pas par le navigateur.
//
// Ce fichier tente ce qu'un élève ferait depuis la console de son navigateur.
// Rien de ce qu'il envoie ne doit pouvoir gonfler sa progression.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const baseConfig = require('../server/config');
const { createApp } = require('../server/app');
const { makeClient, login, jouerSerie, rejouer, reponseAttendue } = require('./helpers');

let server;
let base;
let services;
let db;
let step;
const CHAPITRE = '6e-nombres-decimaux';

before(async () => {
  const config = { ...baseConfig, dbFile: ':memory:', bcryptRounds: 4, isProd: false, loginRateLimit: { windowMs: 60000, max: 50 } };
  const built = await createApp(config, { log: { info() {}, error: console.error } });
  services = built.services;
  db = built.db;
  await services.accounts.createTeacher({ username: 'prof', password: 'motdepasse-prof', displayName: 'Gabriel Pizzo' });

  const prof = await login(makeClient(base = `http://127.0.0.1:${(server = built.app.listen(0)).address().port}/api`), 'prof', 'motdepasse-prof');
  const classId = (await prof.post('/teacher/classes', { name: '6e A', level: '6e' })).body.class.id;
  await prof.post(`/teacher/classes/${classId}/students`, {
    students: [{ pseudonym: 'Loutre curieuse', username: 'lea', password: 'soleil42' }],
  });

  const eleve = await login(makeClient(base), 'lea', 'soleil42');
  step = (await eleve.get(`/chapters/${CHAPITRE}`)).body.chapter.steps.find((s) => s.type === 'exercise');
});
after(() => server.close());

const client = () => makeClient(base);

test('annoncer un score ne sert à rien : le serveur compte lui-même', async () => {
  const eleve = await login(client(), 'lea', 'soleil42');
  const ouverture = await eleve.post('/progress/start', { chapterId: CHAPITRE, stepId: step.id });

  // L'élève répond faux partout, mais prétend avoir tout bon.
  const envoi = await eleve.post('/progress/attempt', {
    sessionId: ouverture.body.sessionId,
    score: step.count,
    total: step.count,
    passed: true,
    bestScore: step.count,
    answers: Array.from({ length: step.count }, (_, i) => ({ position: i + 1, given: 'nimporte quoi', ok: true })),
  });

  assert.equal(envoi.status, 200);
  assert.equal(envoi.body.score, 0, 'le score annoncé est ignoré');
  assert.equal(envoi.body.passed, false);

  // Et la progression enregistrée dit la même chose.
  const etat = (await eleve.get(`/chapters/${CHAPITRE}`)).body.progress;
  assert.equal(etat.steps.find((s) => s.id === step.id).bestScore, 0);
});

test('prétendre qu’une réponse fausse est juste ne change rien', async () => {
  const eleve = await login(client(), 'lea', 'soleil42');
  const ouverture = await eleve.post('/progress/start', { chapterId: CHAPITRE, stepId: step.id });
  const questions = await rejouer(step, ouverture.body.seed);

  // Moitié juste, moitié faux — mais tout est déclaré juste.
  const answers = [];
  for (const [i, q] of questions.entries()) {
    answers.push({ position: i + 1, given: i < 3 ? await reponseAttendue(q) : 'faux', ok: true });
  }
  const envoi = await eleve.post('/progress/attempt', { sessionId: ouverture.body.sessionId, answers });
  assert.equal(envoi.body.score, 3, 'seules les vraies bonnes réponses comptent');
});

test('une série ne peut être enregistrée qu’une fois', async () => {
  const eleve = await login(client(), 'lea', 'soleil42');
  const { ouverture, resultat } = await jouerSerie(eleve, { chapterId: CHAPITRE, step });
  assert.equal(resultat.status, 200);
  assert.equal(resultat.body.score, step.count);

  // Rejouer le même jeton pour empiler les bonnes séries : refusé.
  const rejeu = await eleve.post('/progress/attempt', { sessionId: ouverture.sessionId, answers: [] });
  assert.equal(rejeu.status, 409);
});

test('un jeton inventé, volé ou périmé est refusé', async () => {
  const eleve = await login(client(), 'lea', 'soleil42');

  // Inventé.
  assert.equal((await eleve.post('/progress/attempt', { sessionId: 'aaaaaaaaaaaaaaaa', answers: [] })).status, 404);
  assert.equal((await eleve.post('/progress/attempt', { answers: [] })).status, 404);

  // Volé : celui d'un autre élève ne marche pas.
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const classes = (await prof.get('/teacher/classes')).body.classes;
  await prof.post(`/teacher/classes/${classes[0].id}/students`, {
    students: [{ pseudonym: 'Castor intrépide', username: 'tom', password: 'soleil42' }],
  });
  const tom = await login(client(), 'tom', 'soleil42');
  const sien = await tom.post('/progress/start', { chapterId: CHAPITRE, stepId: step.id });
  assert.equal((await eleve.post('/progress/attempt', { sessionId: sien.body.sessionId, answers: [] })).status, 404);

  // Périmé : au-delà du délai, on ne corrige plus.
  const vieille = await eleve.post('/progress/start', { chapterId: CHAPITRE, stepId: step.id });
  db.prepare("UPDATE exercise_sessions SET created_at = datetime('now','-2 days') WHERE id = ?").run(vieille.body.sessionId);
  const perime = await eleve.post('/progress/attempt', { sessionId: vieille.body.sessionId, answers: [] });
  assert.equal(perime.status, 410);
});

test('la graine donnée produit bien les questions que le serveur corrigera', async () => {
  const eleve = await login(client(), 'lea', 'soleil42');
  const ouverture = await eleve.post('/progress/start', { chapterId: CHAPITRE, stepId: step.id });
  assert.ok(ouverture.body.seed, 'une graine est remise au navigateur');
  assert.equal(ouverture.body.count, step.count);

  // Le navigateur tire les questions de la graine ; en répondant juste à
  // celles-là, le serveur doit compter le maximum. C'est la preuve que les
  // deux côtés jouent la même série.
  const questions = await rejouer(step, ouverture.body.seed);
  const answers = [];
  for (const [i, q] of questions.entries()) answers.push({ position: i + 1, given: await reponseAttendue(q) });
  const envoi = await eleve.post('/progress/attempt', { sessionId: ouverture.body.sessionId, answers });
  assert.equal(envoi.body.score, step.count);

  // Une autre graine donnerait d'autres questions : les mêmes réponses échouent.
  const autre = await eleve.post('/progress/start', { chapterId: CHAPITRE, stepId: step.id });
  assert.notEqual(autre.body.seed, ouverture.body.seed, 'chaque série a sa propre graine');
  const rate = await eleve.post('/progress/attempt', { sessionId: autre.body.sessionId, answers });
  assert.ok(rate.body.score < step.count, 'des réponses d’une autre série ne passent pas');
});

test('on n’ouvre pas de série sur ce à quoi on n’a pas droit', async () => {
  const eleve = await login(client(), 'lea', 'soleil42');
  // Étape qui n'est pas un exercice.
  assert.equal((await eleve.post('/progress/start', { chapterId: CHAPITRE, stepId: 'cours' })).status, 400);
  // Chapitre inexistant.
  assert.equal((await eleve.post('/progress/start', { chapterId: 'invente', stepId: 'x' })).status, 404);
  // Chapitre verrouillé, en parcours.
  const suivant = (await eleve.get('/levels/6e')).body.chapters.filter((c) => c.status === 'published')[1];
  assert.equal((await eleve.post('/progress/start', { chapterId: suivant.id, stepId: suivant.steps.find((s) => s.type === 'exercise').id })).status, 403);
});
