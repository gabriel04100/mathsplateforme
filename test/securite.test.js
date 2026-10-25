// Frontières de sécurité : qui a le droit de faire quoi.
//
// Ce fichier ne teste pas des fonctionnalités mais des interdits. Chaque cas
// correspond à quelque chose qu'un élève curieux, un collègue, ou un visiteur
// pourrait tenter depuis la console de son navigateur.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const baseConfig = require('../server/config');
const { createApp } = require('../server/app');
const { makeClient, login, reussirSerie } = require('./helpers');

let server;
let base;
let services;
const ids = {};

before(async () => {
  const config = { ...baseConfig, dbFile: ':memory:', bcryptRounds: 4, isProd: false, loginRateLimit: { windowMs: 60000, max: 5 } };
  const built = await createApp(config, { log: { info() {}, error() {} } });
  services = built.services;
  await services.accounts.createTeacher({ username: 'prof', password: 'motdepasse-prof', displayName: 'Gabriel Pizzo' });
  await services.accounts.createTeacher({ username: 'autre', password: 'motdepasse-2', displayName: 'Autre Prof' });
  server = built.app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;

  const prof = await login(makeClient(base), 'prof', 'motdepasse-prof');
  ids.classe = (await prof.post('/teacher/classes', { name: '6e A', level: '6e' })).body.class.id;
  const crees = (
    await prof.post(`/teacher/classes/${ids.classe}/students`, {
      students: [
        { pseudonym: 'Loutre curieuse', username: 'lea', password: 'soleil42' },
        { pseudonym: 'Renard rusé', username: 'hugo', password: 'soleil42' },
      ],
    })
  ).body.created;
  ids.lea = crees[0].id;
  ids.hugo = crees[1].id;
  ids.exercice = (
    await prof.post('/teacher/exercises', {
      title: 'Un exercice',
      level: '6e',
      count: 2,
      pass: 1,
      definition: {
        variables: [{ name: 'a', type: 'entier', min: 1, max: 9 }],
        constraints: [],
        prompt: 'Combien font $[[a]] + 1$ ?',
        answer: { kind: 'number', formula: 'a+1' },
        solution: '',
      },
    })
  ).body.exercise.id;
  ids.chapitre = (
    await prof.post('/teacher/chapters', {
      title: 'Un chapitre à moi',
      level: '6e',
      steps: [{ id: 'c', type: 'lesson', title: 'Cours', blocks: [{ type: 'text', title: '', text: 'Du texte.' }] }],
    })
  ).body.chapter.dbId;
});
after(() => server.close());

const client = () => makeClient(base);

test('sans session, toute l’API répond « connexion requise »', async () => {
  const anon = client();
  const routes = [
    '/catalog',
    '/levels/6e',
    '/chapters/6e-fractions',
    '/dashboard',
    '/revision-flash',
    '/custom-exercises',
    '/documents',
    '/games',
    '/games/tables-multiplication/leaderboard',
    '/teacher/classes',
    '/teacher/exercises',
    '/teacher/chapters',
  ];
  for (const url of routes) {
    assert.equal((await anon.get(url)).status, 401, `GET ${url} doit exiger une connexion`);
  }
  assert.equal((await anon.post('/progress/start', {})).status, 401);
  assert.equal((await anon.post('/progress/attempt', {})).status, 401);
  assert.equal((await anon.post('/progress/confiance', {})).status, 401);
  assert.equal((await anon.post('/games/tables-multiplication/scores', {})).status, 401);
});

test('un élève n’atteint aucune route de l’espace enseignant', async () => {
  const lea = await login(client(), 'lea', 'soleil42');
  const interdits = [
    ['get', '/teacher/classes'],
    ['get', `/teacher/classes/${ids.classe}/students`],
    ['get', `/teacher/classes/${ids.classe}/progress`],
    ['get', `/teacher/classes/${ids.classe}/diagnostic/6e-fractions`],
    ['get', '/teacher/exercises'],
    ['get', '/teacher/chapters'],
    ['get', '/teacher/parcours/6e'],
    ['get', '/teacher/password-suggestion'],
  ];
  for (const [methode, url] of interdits) {
    assert.equal((await lea[methode](url)).status, 403, `${methode.toUpperCase()} ${url} doit être réservé`);
  }
  // Ni création, ni modification, ni suppression.
  assert.equal((await lea.post('/teacher/classes', { name: 'Pirate', level: '6e' })).status, 403);
  assert.equal((await lea.patch(`/teacher/students/${ids.hugo}`, { active: false })).status, 403);
  assert.equal((await lea.del(`/teacher/students/${ids.hugo}`)).status, 403);
  assert.equal((await lea.post(`/teacher/students/${ids.hugo}/reset-progress`)).status, 403);
  assert.equal((await lea.post('/documents', { title: 'x', level: '6e', filename: 'x.pdf', fileBase64: '' })).status, 403);
});

test('un élève ne voit ni ne modifie le travail d’un autre', async () => {
  const hugo = await login(client(), 'hugo', 'soleil42');
  // Hugo travaille.
  const ch = (await hugo.get('/levels/6e')).body.chapters.find((c) => c.status === 'published');
  const exo = ch.steps.find((s) => s.type === 'exercise');
  const complet = (await hugo.get(`/chapters/${ch.id}`)).body.chapter;
  await reussirSerie(hugo, { chapterId: ch.id, step: complet.steps.find((s) => s.id === exo.id) });

  // Léa ne voit que le sien : son tableau de bord ne parle que d'elle.
  const lea = await login(client(), 'lea', 'soleil42');
  const tableau = (await lea.get('/dashboard')).body;
  assert.deepEqual(tableau.recent, [], 'Léa n’a rien fait : son historique est vide');
  assert.equal((await lea.get(`/chapters/${ch.id}`)).body.progress.status, 'not_started');

  // Et le classement des jeux ne révèle que ce qui est voulu : un nom, une
  // classe, un score — jamais un identifiant de connexion.
  await hugo.post('/games/tables-multiplication/scores', { levelId: 'classique', durationS: 60, score: 100, correct: 10, wrong: 0, bestStreak: 3 });
  const board = (await lea.get('/games/tables-multiplication/leaderboard?niveau=classique&duree=60')).body;
  const entree = board.entries[0];
  assert.ok(entree.displayName);
  assert.equal(entree.username, undefined, 'le classement ne publie pas les identifiants de connexion');
  assert.equal(entree.password, undefined);
});

test('un enseignant ne touche pas à ce qui appartient à un autre', async () => {
  const autre = await login(client(), 'autre', 'motdepasse-2');

  // Classe et élèves.
  assert.equal((await autre.get(`/teacher/classes/${ids.classe}/students`)).status, 404);
  assert.equal((await autre.get(`/teacher/classes/${ids.classe}/progress`)).status, 404);
  assert.equal((await autre.get(`/teacher/classes/${ids.classe}/diagnostic/6e-fractions`)).status, 404);
  assert.equal((await autre.patch(`/teacher/classes/${ids.classe}`, { name: 'Volée' })).status, 404);
  assert.equal((await autre.del(`/teacher/classes/${ids.classe}`)).status, 404);
  assert.equal((await autre.patch(`/teacher/students/${ids.lea}`, { active: false })).status, 404);
  assert.equal((await autre.del(`/teacher/students/${ids.lea}`)).status, 404);
  assert.equal((await autre.post(`/teacher/students/${ids.lea}/reset-progress`)).status, 404);

  // Exercices et chapitres.
  assert.equal((await autre.get(`/teacher/exercises/${ids.exercice}`)).status, 404);
  assert.equal((await autre.patch(`/teacher/exercises/${ids.exercice}`, { title: 'Volé' })).status, 404);
  assert.equal((await autre.del(`/teacher/exercises/${ids.exercice}`)).status, 404);
  assert.equal((await autre.get(`/teacher/chapters/c-${ids.chapitre}`)).status, 404);
  assert.equal((await autre.del(`/teacher/chapters/c-${ids.chapitre}`)).status, 404);

  // Et ses propres listes restent vides.
  assert.deepEqual((await autre.get('/teacher/exercises')).body.exercises, []);
  assert.deepEqual((await autre.get('/teacher/classes')).body.classes, []);
});

test('les écritures exigent du JSON, et la session est protégée', async () => {
  // Un formulaire envoyé depuis un autre site ne peut pas poster du JSON sans
  // déclencher une vérification préalable du navigateur : on refuse le reste.
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'username=lea&password=soleil42',
  });
  assert.equal(res.status, 415);

  // Le cookie de session n'est pas lisible par du script, et ne part pas
  // vers un autre site.
  const connexion = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'lea', password: 'soleil42' }),
  });
  const cookie = connexion.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);

  // Les en-têtes de sécurité sont posés sur toutes les réponses.
  assert.match(connexion.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(connexion.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(connexion.headers.get('x-frame-options'), 'DENY');
});

test('le mot de passe ne circule jamais et les sessions tombent avec lui', async () => {
  const lea = await login(client(), 'lea', 'soleil42');
  const moi = (await lea.get('/auth/me')).body.user;
  assert.equal(moi.password, undefined);
  assert.equal(moi.passwordHash, undefined);
  assert.equal(moi.password_hash, undefined);

  // L'enseignant change le mot de passe : la session en cours doit tomber.
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  await prof.patch(`/teacher/students/${ids.lea}`, { resetPassword: true });
  assert.equal((await lea.get('/dashboard')).status, 401, 'l’ancienne session ne doit plus marcher');

  // Désactiver un compte ferme aussi ses sessions.
  const hugo = await login(client(), 'hugo', 'soleil42');
  assert.equal((await hugo.get('/dashboard')).status, 200);
  await prof.patch(`/teacher/students/${ids.hugo}`, { active: false });
  assert.equal((await hugo.get('/dashboard')).status, 401);
  assert.equal((await client().post('/auth/login', { username: 'hugo', password: 'soleil42' })).status, 401);
});

test('les tentatives de connexion sont limitées', async () => {
  const c = client();
  // La limite est fixée à 5 dans la configuration de ce fichier.
  for (let i = 0; i < 5; i++) {
    assert.equal((await c.post('/auth/login', { username: 'cible', password: 'faux' })).status, 401);
  }
  assert.equal((await c.post('/auth/login', { username: 'cible', password: 'faux' })).status, 429);
});
