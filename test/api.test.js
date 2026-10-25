// Parcours complet par l'API : enseignant -> classe -> comptes élèves -> progression -> suivi.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const baseConfig = require('../server/config');
const { createApp } = require('../server/app');
const { jouerSerie, reussirSerie } = require('./helpers');

let server;
let base;
let services;

before(async () => {
  const config = { ...baseConfig, dbFile: ':memory:', bcryptRounds: 4, isProd: false, loginRateLimit: { windowMs: 60000, max: 5 } };
  const built = await createApp(config, { log: { info() {}, error: console.error } });
  services = built.services;
  await services.accounts.createTeacher({ username: 'prof', password: 'motdepasse-prof', displayName: 'Gabriel Pizzo' });
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

test('parcours complet enseignant + élève', async () => {
  const prof = client();
  assert.equal((await prof.post('/auth/login', { username: 'prof', password: 'mauvais' })).status, 401);
  assert.equal((await prof.post('/auth/login', { username: 'prof', password: 'motdepasse-prof' })).status, 200);

  const cls = (await prof.post('/teacher/classes', { name: '4e A', level: '4e' })).body.class;
  assert.equal(cls.level, '4e');
  assert.equal((await prof.post('/teacher/classes', { name: '4e A', level: '4e' })).status, 409);

  const created = await prof.post(`/teacher/classes/${cls.id}/students`, {
    students: [{ displayName: 'Léa Martin' }, { displayName: 'Léa Martin' }, { displayName: 'Hugo B', username: 'hugo.b', password: 'soleil42' }],
  });
  assert.equal(created.status, 201);
  const [lea, lea2] = created.body.created;
  assert.equal(lea.username, 'lea.martin');
  assert.equal(lea2.username, 'lea.martin2');
  assert.ok(lea.password.length >= 6);
  assert.equal((await prof.post(`/teacher/classes/${cls.id}/students`, { students: [{ displayName: 'X', username: 'hugo.b' }] })).status, 409);

  // Élève : connexion, tableau de bord, parcours
  const el = client();
  assert.equal((await el.get('/dashboard')).status, 401);
  assert.equal((await el.post('/auth/login', { username: 'Hugo.B', password: 'soleil42' })).status, 200);
  let dash = (await el.get('/dashboard')).body;
  assert.equal(dash.homeLevel, '4e');
  assert.equal(dash.lastPosition, null);
  assert.equal(dash.next.chapterId, '4e-calcul-litteral');
  assert.equal((await el.get('/teacher/classes')).status, 403);

  let lvl = (await el.get('/levels/4e')).body.progress;
  assert.equal(lvl[0].unlocked, true);
  assert.equal(lvl[1].unlocked, false, 'le 2e chapitre est verrouillé au départ');

  const ch = '4e-calcul-litteral';
  await el.post('/progress/visit', { chapterId: ch, stepId: 'cours' });
  await el.post('/progress/visit', { chapterId: ch, stepId: 'anim-aires' });
  dash = (await el.get('/dashboard')).body;
  assert.equal(dash.lastPosition.stepId, 'anim-aires', 'reprise : dernière étape ouverte');

  // On ne peut pas ouvrir une série sur une étape qui n'est pas un exercice.
  assert.equal((await el.post('/progress/start', { chapterId: ch, stepId: 'cours' })).status, 400);

  const chapitre = (await el.get(`/chapters/${ch}`)).body.chapter;
  const exSimple = chapitre.steps.find((x) => x.id === 'ex-simple');
  const exDouble = chapitre.steps.find((x) => x.id === 'ex-double');

  // Une série à moitié juste ne valide pas l'étape : le serveur compte.
  let r = (await jouerSerie(el, { chapterId: ch, step: exSimple, repondre: (q, i, bonne) => (i < 3 ? bonne : 'nimporte quoi') })).resultat.body;
  assert.equal(r.score, 3);
  assert.equal(r.passed, false);

  // Tout juste : validée.
  r = await reussirSerie(el, { chapterId: ch, step: exSimple });
  assert.equal(r.score, exSimple.count);
  assert.equal(r.passed, true);

  r = await reussirSerie(el, { chapterId: ch, step: exDouble, mode: 'libre' });
  assert.equal(r.passed, true);

  lvl = (await el.get('/levels/4e')).body.progress;
  assert.equal(lvl[0].status, 'done');
  assert.equal(lvl[1].unlocked, true, 'chapitre suivant débloqué');
  dash = (await el.get('/dashboard')).body;
  assert.equal(dash.next.chapterId, '4e-pythagore');
  assert.equal(dash.lastPosition.mode, 'libre');
  assert.equal(dash.recent.length, 3);

  // Suivi enseignant
  const grid = (await prof.get(`/teacher/classes/${cls.id}/progress`)).body;
  const hugo = grid.students.find((s) => s.username === 'hugo.b');
  assert.equal(hugo.chapters[0].status, 'done');
  assert.equal(hugo.attemptsCount, 3);

  // Nouveau mot de passe : l'ancienne session est fermée
  const reset = (await prof.patch(`/teacher/students/${hugo.id}`, { resetPassword: true })).body;
  assert.ok(reset.password);
  assert.equal((await el.get('/dashboard')).status, 401);
  assert.equal((await el.post('/auth/login', { username: 'hugo.b', password: reset.password })).status, 200);

  // Désactivation
  await prof.patch(`/teacher/students/${hugo.id}`, { active: false });
  assert.equal((await client().post('/auth/login', { username: 'hugo.b', password: reset.password })).status, 401);

  // Un autre enseignant ne voit pas cette classe
  await services.accounts.createTeacher({ username: 'prof2', password: 'motdepasse-2', displayName: 'Autre' });
  const prof2 = client();
  await prof2.post('/auth/login', { username: 'prof2', password: 'motdepasse-2' });
  assert.equal((await prof2.get(`/teacher/classes/${cls.id}/students`)).status, 404);
});

test('sécurité de base', async () => {
  const c = client();
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'username=a&password=b' });
  assert.equal(res.status, 415, 'les formulaires non JSON sont refusés (CSRF)');
  for (let i = 0; i < 5; i++) await c.post('/auth/login', { username: 'cible', password: 'x' });
  assert.equal((await c.post('/auth/login', { username: 'cible', password: 'x' })).status, 429);
  const h = await fetch(`${base}/health`);
  assert.match(h.headers.get('content-security-policy'), /default-src 'self'/);
});
