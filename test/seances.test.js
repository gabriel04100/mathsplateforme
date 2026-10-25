// Séances : activités et feuilles d'exercices hors parcours.
//
// Tout l'intérêt de cette typologie est de ne PAS participer au parcours
// séquentiel. Ces tests vérifient les deux sens : une séance n'apparaît pas
// dans le parcours, et le verrou du parcours ne s'applique pas à elle.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const baseConfig = require('../server/config');
const { createApp } = require('../server/app');
const { makeClient, login, reussirSerie } = require('./helpers');

let server;
let base;
let classId;
const ids = {};

const ETAPES = [
  { id: 'intro', type: 'lesson', title: 'La consigne', blocks: [{ type: 'text', title: '', text: 'On cherche ensemble.' }] },
  { id: 'exo', type: 'exercise', title: 'À toi', source: 'generator', generator: 'dec-place-value', count: 3, pass: 2 },
];

before(async () => {
  const config = { ...baseConfig, dbFile: ':memory:', bcryptRounds: 4, isProd: false, loginRateLimit: { windowMs: 60000, max: 50 } };
  const built = await createApp(config, { log: { info() {}, error: console.error } });
  await built.services.accounts.createTeacher({ username: 'prof', password: 'motdepasse-prof', displayName: 'Gabriel Pizzo' });
  server = built.app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;

  const prof = await login(makeClient(base), 'prof', 'motdepasse-prof');
  classId = (await prof.post('/teacher/classes', { name: '6e A', level: '6e' })).body.class.id;
  await prof.post(`/teacher/classes/${classId}/students`, {
    students: [{ pseudonym: 'Loutre curieuse', username: 'loutre', password: 'soleil42' }],
  });
  ids.activite = (
    await prof.post('/teacher/chapters', { title: 'Activité : la monnaie', level: '6e', kind: 'activite', steps: ETAPES, status: 'published' })
  ).body.chapter.dbId;
  ids.feuille = (
    await prof.post('/teacher/chapters', { title: 'Exercices du 12 janvier', level: '6e', kind: 'exercices', steps: ETAPES, status: 'published' })
  ).body.chapter.dbId;
  ids.chapitre = (await prof.post('/teacher/chapters', { title: 'Un vrai chapitre', level: '6e', steps: ETAPES, status: 'published' })).body.chapter.dbId;
});
after(() => server.close());

const client = () => makeClient(base);

test('une séance reste en dehors du parcours', async () => {
  const eleve = await login(client(), 'loutre', 'soleil42');
  const niveau = (await eleve.get('/levels/6e')).body;
  const titres = niveau.chapters.map((c) => c.title);
  assert.ok(titres.includes('Un vrai chapitre'), 'un chapitre entre bien dans le parcours');
  assert.ok(!titres.includes('Activité : la monnaie'), 'une activité n’y entre pas');
  assert.ok(!titres.includes('Exercices du 12 janvier'), 'une feuille d’exercices non plus');

  // Et elles ne décalent pas la numérotation : le parcours ne compte que les chapitres.
  assert.equal(niveau.progress.length, niveau.chapters.length);
});

test('les séances ont leur propre liste, avec leur type', async () => {
  const eleve = await login(client(), 'loutre', 'soleil42');
  const { seances } = (await eleve.get('/seances')).body;
  assert.deepEqual(
    seances.map((s) => [s.title, s.kind, s.kindLabel]),
    [
      ['Activité : la monnaie', 'activite', 'Activité'],
      ['Exercices du 12 janvier', 'exercices', 'Feuille d’exercices'],
    ]
  );
  assert.equal(seances[0].level, '6e');
  assert.equal(seances[0].progress.status, 'not_started');
});

test('une séance n’est jamais verrouillée, même parcours à peine commencé', async () => {
  const eleve = await login(client(), 'loutre', 'soleil42');

  // Vérification du contraste : le chapitre ajouté est, lui, verrouillé, parce
  // que les chapitres livrés avant lui ne sont pas terminés.
  const etat = (await eleve.get('/levels/6e')).body.progress;
  assert.equal(etat.find((p) => p.chapterId === `c-${ids.chapitre}`).unlocked, false);
  const exoChapitre = (await eleve.get(`/chapitres/c-${ids.chapitre}`)).status;
  assert.equal(exoChapitre, 404, 'cette adresse-là n’existe pas côté API');
  assert.equal((await eleve.post('/progress/start', { chapterId: `c-${ids.chapitre}`, stepId: 'exo' })).status, 403);

  // La séance, elle, s'ouvre et se travaille tout de suite.
  const vue = await eleve.get(`/chapters/c-${ids.activite}`);
  assert.equal(vue.status, 200);
  assert.equal(vue.body.progress.unlocked, true);
  assert.ok(vue.body.chapter.steps[0].blocks, 'le cours de la séance est livré, pas masqué');

  const res = await reussirSerie(eleve, { chapterId: `c-${ids.activite}`, step: vue.body.chapter.steps[1] });
  assert.equal(res.score, 3);
  assert.equal(res.passed, true);

  // Le cours lu et l'exercice réussi : la séance est terminée.
  await eleve.post('/progress/visit', { chapterId: `c-${ids.activite}`, stepId: 'intro' });
  const { seances } = (await eleve.get('/seances')).body;
  assert.equal(seances[0].progress.status, 'done');
  assert.equal(seances[0].progress.percent, 100);
});

test('terminer une séance ne débloque aucun chapitre', async () => {
  const eleve = await login(client(), 'loutre', 'soleil42');
  const progression = (await eleve.get('/levels/6e')).body.progress;
  // Seul le premier chapitre du niveau est ouvert : la séance terminée n'a rien changé.
  assert.deepEqual(
    progression.filter((p) => p.status !== 'draft').map((p) => p.unlocked),
    progression.filter((p) => p.status !== 'draft').map((_, i) => i === 0)
  );
});

test('l’enseignant retrouve ses séances à part de ses chapitres', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const seances = (await prof.get('/teacher/chapters?type=seance')).body.chapters;
  assert.deepEqual(seances.map((c) => c.kind).sort(), ['activite', 'exercices']);
  const chapitres = (await prof.get('/teacher/chapters?type=chapitre')).body.chapters;
  assert.deepEqual(chapitres.map((c) => c.title), ['Un vrai chapitre']);
  assert.equal((await prof.get('/teacher/chapters')).body.chapters.length, 3, 'sans filtre, les deux typologies');

  // Le parcours d'un niveau ne propose pas les séances au réordonnancement.
  const parcours = (await prof.get('/teacher/parcours/6e')).body.chapters;
  assert.ok(!parcours.some((c) => c.id === `c-${ids.activite}`));

  // Et une typologie inventée est refusée.
  assert.equal((await prof.post('/teacher/chapters', { title: 'Essai raté', level: '6e', kind: 'devoir', steps: ETAPES })).status, 400);
});
