// Traduction automatique : ce que le serveur accepte, refuse, et met en cache.
//
// Le fournisseur n'est jamais appelé pour de vrai : on en branche un faux, qui
// compte les appels. C'est précisément ce qu'on veut vérifier — qu'un texte
// déjà traduit ne reparte pas chez le traducteur.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const baseConfig = require('../server/config');
const { createApp } = require('../server/app');
const { makeClient, login } = require('./helpers');

let server;
let base;
const appels = [];

// Un faux service de traduction : une instance LibreTranslate simulée par un
// petit serveur local, pour que le chemin complet soit exercé — y compris le
// fait qu'un texte déjà connu n'y arrive jamais.
const faux = require('node:http').createServer((req, res) => {
  let corps = '';
  req.on('data', (c) => (corps += c));
  req.on('end', () => {
    const { q, target } = JSON.parse(corps);
    appels.push({ target, n: q.length });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ translatedText: q.map((t) => `[${target}] ${t}`) }));
  });
});

before(async () => {
  await new Promise((r) => faux.listen(0, r));
  const config = {
    ...baseConfig,
    dbFile: ':memory:',
    bcryptRounds: 4,
    isProd: false,
    loginRateLimit: { windowMs: 60000, max: 50 },
    translate: { provider: 'libretranslate', url: `http://127.0.0.1:${faux.address().port}`, key: '', maxCharsPerRequest: 200 },
  };
  const built = await createApp(config, { log: { info() {}, error() {} } });
  await built.services.accounts.createTeacher({ username: 'prof', password: 'motdepasse-prof', displayName: 'Gabriel Pizzo' });
  server = built.app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;

  const prof = await login(makeClient(base), 'prof', 'motdepasse-prof');
  const classId = (await prof.post('/teacher/classes', { name: '6e A', level: '6e' })).body.class.id;
  await prof.post(`/teacher/classes/${classId}/students`, {
    students: [{ pseudonym: 'Loutre curieuse', username: 'loutre', password: 'soleil42' }],
  });
});
after(() => {
  server.close();
  // Le serveur a appelé le faux traducteur par fetch, qui garde ses connexions
  // ouvertes : sans les fermer, le processus de test ne rendrait jamais la main.
  faux.closeAllConnections();
  faux.close();
});

const client = () => makeClient(base);

test('la traduction est annoncée comme disponible et traduit ce qu’on lui donne', async () => {
  const eleve = await login(client(), 'loutre', 'soleil42');
  const etat = (await eleve.get('/translate')).body;
  assert.equal(etat.available, true);
  assert.ok(etat.languages.some((l) => l.id === 'ar' && l.rtl));

  const res = await eleve.post('/translate', { target: 'en', texts: ['Un nombre décimal', 'Compare les deux nombres'] });
  assert.equal(res.status, 200);
  assert.equal(res.body.translations['Un nombre décimal'], '[en] Un nombre décimal');
  assert.equal(res.body.rtl, false);
});

test('un texte déjà traduit ne repart pas chez le traducteur', async () => {
  const eleve = await login(client(), 'loutre', 'soleil42');
  await eleve.post('/translate', { target: 'es', texts: ['Les fractions', 'Les angles'] });
  const avant = appels.length;

  // Même demande : rien ne doit sortir.
  const res = await eleve.post('/translate', { target: 'es', texts: ['Les angles', 'Les fractions'] });
  assert.equal(appels.length, avant, 'aucun appel supplémentaire');
  assert.equal(res.body.translations['Les angles'], '[es] Les angles');

  // Un seul texte nouveau : on n'envoie que celui-là.
  await eleve.post('/translate', { target: 'es', texts: ['Les angles', 'Un angle obtus'] });
  assert.equal(appels.length, avant + 1);
  assert.deepEqual(appels[appels.length - 1], { target: 'es', n: 1 });

  // Et le cache est par langue : la même phrase dans une autre langue repart.
  await eleve.post('/translate', { target: 'it', texts: ['Les angles'] });
  assert.equal(appels[appels.length - 1].target, 'it');
});

test('ce que le serveur refuse', async () => {
  const eleve = await login(client(), 'loutre', 'soleil42');
  assert.equal((await eleve.post('/translate', { target: 'klingon', texts: ['Bonjour'] })).status, 400);
  assert.equal((await eleve.post('/translate', { target: 'en', texts: [] })).status, 400);
  // La limite de taille est à 200 caractères dans cette configuration de test.
  assert.equal((await eleve.post('/translate', { target: 'en', texts: ['x'.repeat(250)] })).status, 400);
  // Et il faut être connecté.
  assert.equal((await client().get('/translate')).status, 401);
  assert.equal((await client().post('/translate', { target: 'en', texts: ['Bonjour'] })).status, 401);
});

test('sans fournisseur configuré, la fonction se déclare indisponible', async () => {
  // Le cas par défaut d'une installation : rien n'est configuré. On interroge
  // le service directement, sans ouvrir un deuxième serveur HTTP.
  const built = await createApp({ ...baseConfig, dbFile: ':memory:', bcryptRounds: 4, isProd: false, translate: {} }, { log: { info() {}, error() {} } });
  assert.deepEqual(built.services.translate.etat(), { available: false, languages: [], provider: null });
  await assert.rejects(() => built.services.translate.traduire('en', ['Bonjour']), (e) => e.status === 503);
  built.db.close();
});
