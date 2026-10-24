// Exercices écrits par l'enseignant + jeux et classement global, bout en bout par l'API.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const baseConfig = require('../server/config');
const { createApp } = require('../server/app');

let server;
let base;
let services;

before(async () => {
  const config = { ...baseConfig, dbFile: ':memory:', bcryptRounds: 4, isProd: false, loginRateLimit: { windowMs: 60000, max: 50 } };
  const built = await createApp(config, { log: { info() {}, error: console.error } });
  services = built.services;
  await services.accounts.createTeacher({ username: 'prof', password: 'motdepasse-prof', displayName: 'Gabriel Pizzo' });
  await services.accounts.createTeacher({ username: 'autre', password: 'motdepasse-2', displayName: 'Autre Prof' });
  server = built.app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), patch: (u, b = {}) => call('PATCH', u, b), del: (u) => call('DELETE', u, {}) };
}

const login = async (c, username, password) => {
  assert.equal((await c.post('/auth/login', { username, password })).status, 200);
  return c;
};

const MODEL = {
  variables: [
    { name: 'a', type: 'entier', min: 2, max: 9 },
    { name: 'b', type: 'entier', min: 2, max: 9 },
  ],
  constraints: ['a <> b'],
  prompt: 'Combien font $[[a]] \\times [[b]]$ ?',
  answer: { kind: 'number', formula: 'a*b' },
  solution: '$[[a]] \\times [[b]] = [[a*b]]$',
};

test("l'enseignant écrit un exercice, l'élève le joue", async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const cls = (await prof.post('/teacher/classes', { name: '5e A', level: '5e' })).body.class;
  await prof.post(`/teacher/classes/${cls.id}/students`, { students: [{ displayName: 'Zoé Dupont', username: 'zoe', password: 'soleil42' }] });

  // Création : brouillon par défaut.
  const create = await prof.post('/teacher/exercises', {
    title: 'Tables de multiplication',
    level: '5e',
    count: 4,
    pass: 3,
    definition: MODEL,
  });
  assert.equal(create.status, 201);
  const ex = create.body.exercise;
  assert.equal(ex.status, 'draft');

  // Un brouillon n'est pas visible par l'élève.
  const eleve = await login(client(), 'zoe', 'soleil42');
  assert.deepEqual((await eleve.get('/custom-exercises')).body.exercises, []);
  assert.equal((await eleve.get(`/custom-exercises/${ex.id}`)).status, 404);

  // Une fois publié, il apparaît et devient jouable.
  await prof.patch(`/teacher/exercises/${ex.id}`, { status: 'published' });
  const visible = (await eleve.get('/custom-exercises')).body.exercises;
  assert.equal(visible.length, 1);
  assert.equal(visible[0].title, 'Tables de multiplication');

  const playable = (await eleve.get(`/custom-exercises/${ex.id}`)).body;
  assert.equal(playable.exercise.count, 4);
  assert.ok(playable.exercise.template, 'le modèle doit être envoyé au navigateur');

  // Enregistrement d'une série réussie.
  const attempt = await eleve.post(`/custom-exercises/${ex.id}/attempt`, { score: 4, total: 4, durationS: 30 });
  assert.equal(attempt.status, 200);
  assert.equal(attempt.body.everPassed, true);
  assert.equal(attempt.body.saved, true);

  // Un score impossible est refusé.
  assert.equal((await eleve.post(`/custom-exercises/${ex.id}/attempt`, { score: 9, total: 4 })).status, 400);
  assert.equal((await eleve.post(`/custom-exercises/${ex.id}/attempt`, { score: 2, total: 7 })).status, 400);

  // La série apparaît dans l'historique du tableau de bord, avec un titre lisible.
  const recent = (await eleve.get('/dashboard')).body.recent;
  assert.equal(recent[0].stepTitle, 'Tables de multiplication');
  assert.equal(recent[0].chapterTitle, 'Exercice du professeur');
});

test('un modèle impossible à jouer est refusé par le serveur', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const bad = (def, extra = {}) => prof.post('/teacher/exercises', { title: 'Essai', level: '5e', count: 4, pass: 3, definition: def, ...extra });

  assert.equal((await bad({ ...MODEL, prompt: '[[inconnue]]' })).status, 400);
  assert.equal((await bad({ ...MODEL, constraints: ['a > 1000'] })).status, 400);
  assert.equal((await bad({ ...MODEL, answer: { kind: 'number', formula: 'a / 0' } })).status, 400);
  assert.equal((await bad({ ...MODEL, answer: { kind: 'number', formula: 'constructor' } })).status, 400);
  // L'objectif ne peut pas dépasser le nombre de questions.
  assert.equal((await bad(MODEL, { count: 3, pass: 8 })).status, 400);
  assert.equal((await prof.post('/teacher/exercises', { title: 'x', level: '5e', count: 4, pass: 3, definition: MODEL })).status, 400);
});

test('un enseignant ne voit ni ne modifie les exercices d’un autre', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const mine = (await prof.post('/teacher/exercises', { title: 'À moi', level: '6e', count: 2, pass: 1, definition: MODEL })).body.exercise;

  const autre = await login(client(), 'autre', 'motdepasse-2');
  assert.equal((await autre.get(`/teacher/exercises/${mine.id}`)).status, 404);
  assert.equal((await autre.patch(`/teacher/exercises/${mine.id}`, { title: 'Volé' })).status, 404);
  assert.equal((await autre.del(`/teacher/exercises/${mine.id}`)).status, 404);
  assert.ok(!(await autre.get('/teacher/exercises')).body.exercises.some((e) => e.id === mine.id));
});

test('le jeu des tables enregistre les scores atteignables et refuse les autres', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const cls = (await prof.post('/teacher/classes', { name: '6e B', level: '6e' })).body.class;
  await prof.post(`/teacher/classes/${cls.id}/students`, {
    students: [
      { displayName: 'Alice Martin', username: 'alice', password: 'soleil42' },
      { displayName: 'Bob Leroy', username: 'bob', password: 'soleil42' },
    ],
  });

  const games = (await prof.get('/games')).body.games;
  assert.ok(games.some((g) => g.id === 'tables-multiplication'));
  const game = (await prof.get('/games/tables-multiplication')).body.game;
  assert.ok(game.levels.length >= 2, 'le jeu doit proposer plusieurs niveaux');
  assert.deepEqual(game.scoring, { basePoints: 10, maxStreakBonus: 10 }, 'le barème est annoncé au client');

  const alice = await login(client(), 'alice', 'soleil42');
  const play = (body) => alice.post('/games/tables-multiplication/scores', { levelId: 'classique', durationS: 60, ...body });

  // 20 bonnes réponses : le score doit rester entre 10 et 20 points par réponse.
  assert.equal((await play({ score: 260, correct: 20, wrong: 3, bestStreak: 12 })).status, 201);
  assert.equal((await play({ score: 9999, correct: 20, wrong: 3, bestStreak: 12 })).status, 400);
  assert.equal((await play({ score: 50, correct: 20, wrong: 0, bestStreak: 5 })).status, 400);
  // Plus de réponses que le temps ne le permet.
  assert.equal((await play({ score: 5000, correct: 500, wrong: 0, bestStreak: 500 })).status, 400);
  // Série plus longue que le nombre de bonnes réponses.
  assert.equal((await play({ score: 100, correct: 10, wrong: 0, bestStreak: 40 })).status, 400);
  // Durée non proposée par le jeu.
  assert.equal((await play({ score: 100, correct: 10, wrong: 0, bestStreak: 3, durationS: 37 })).status, 400);
  // Niveau manquant ou inventé.
  assert.equal((await alice.post('/games/tables-multiplication/scores', { score: 100, correct: 10, wrong: 0, bestStreak: 3, durationS: 60 })).status, 404);
  assert.equal((await play({ score: 100, correct: 10, wrong: 0, bestStreak: 3, levelId: 'impossible' })).status, 404);
  assert.equal((await alice.post('/games/inconnu/scores', { score: 1, correct: 1, wrong: 0, bestStreak: 1, durationS: 60, levelId: 'classique' })).status, 404);
});

test('chaque niveau et chaque durée ont leur propre classement', async () => {
  const alice = await login(client(), 'alice', 'soleil42');
  const board = (q) => alice.get(`/games/tables-multiplication/leaderboard?${q}`).then((r) => r.body);

  // Alice a déjà 260 en « classique / 60 s » (test précédent).
  assert.equal((await board('niveau=classique&duree=60')).me.bestScore, 260);

  // Le même score ne compte pas dans une autre durée ni dans un autre niveau.
  assert.equal((await board('niveau=classique&duree=120')).me, null);
  assert.equal((await board('niveau=expert&duree=60')).me, null);

  // Un score modeste en « expert » y est premier, sans toucher au classement « classique ».
  assert.equal(
    (await alice.post('/games/tables-multiplication/scores', { levelId: 'expert', durationS: 60, score: 100, correct: 10, wrong: 0, bestStreak: 4 })).status,
    201
  );
  const expert = await board('niveau=expert&duree=60');
  assert.equal(expert.me.bestScore, 100);
  assert.equal(expert.me.rank, 1);
  assert.equal(expert.levelLabel, 'Expert');
  assert.equal(expert.durationS, 60);
  assert.equal((await board('niveau=classique&duree=60')).me.bestScore, 260, 'le classement classique est inchangé');
});

test('le classement est global et situe chaque élève', async () => {
  const bob = await login(client(), 'bob', 'soleil42');
  const send = (c, body) => c.post('/games/tables-multiplication/scores', { levelId: 'classique', durationS: 60, ...body });
  assert.equal((await send(bob, { score: 150, correct: 12, wrong: 1, bestStreak: 6 })).status, 201);

  const board = (await bob.get('/games/tables-multiplication/leaderboard?niveau=classique&duree=60')).body;
  assert.ok(board.entries.length >= 2, 'les deux élèves doivent apparaître');
  // Classement décroissant : Alice (260) devant Bob (150).
  assert.deepEqual(
    board.entries.map((e) => e.bestScore),
    [...board.entries.map((e) => e.bestScore)].sort((a, b) => b - a)
  );
  assert.equal(board.entries[0].displayName, 'Alice Martin');
  assert.equal(board.entries[0].rank, 1);
  assert.equal(board.entries[0].className, '6e B');

  const me = board.entries.find((e) => e.me);
  assert.equal(me.displayName, 'Bob Leroy');
  assert.equal(board.me.bestScore, 150);
  assert.equal(board.me.rank, 2);

  // Le classement traverse les classes : un élève d'une autre classe y entre aussi.
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const autreCls = (await prof.post('/teacher/classes', { name: '3e C', level: '3e' })).body.class;
  await prof.post(`/teacher/classes/${autreCls.id}/students`, { students: [{ displayName: 'Chloé Blanc', username: 'chloe', password: 'soleil42' }] });
  const chloe = await login(client(), 'chloe', 'soleil42');
  await send(chloe, { score: 400, correct: 20, wrong: 0, bestStreak: 20 });

  const after = (await bob.get('/games/tables-multiplication/leaderboard?niveau=classique&duree=60')).body;
  assert.equal(after.entries[0].displayName, 'Chloé Blanc');
  assert.equal(after.entries[0].className, '3e C');
  assert.equal(after.me.rank, 3, 'Bob recule d’une place');
});

test('les jeux et les exercices exigent une connexion', async () => {
  const anon = client();
  assert.equal((await anon.get('/games')).status, 401);
  assert.equal((await anon.get('/games/tables-multiplication/leaderboard')).status, 401);
  assert.equal((await anon.get('/custom-exercises')).status, 401);
  // Un élève ne peut pas écrire d'exercices.
  const alice = await login(client(), 'alice', 'soleil42');
  assert.equal((await alice.get('/teacher/exercises')).status, 403);
  assert.equal((await alice.post('/teacher/exercises', { title: 'Pirate', level: '6e', count: 2, pass: 1, definition: MODEL })).status, 403);
});
