// « Où ça coince » : enregistrement du détail des réponses et diagnostic de classe.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const baseConfig = require('../server/config');
const { createApp } = require('../server/app');
const { unlockUpTo, jouerSerie, reussirSerie } = require('./helpers');

let server;
let base;
let services;

before(async () => {
  const config = { ...baseConfig, dbFile: ':memory:', bcryptRounds: 4, isProd: false, loginRateLimit: { windowMs: 60000, max: 50 } };
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

const login = async (c, username, password) => {
  assert.equal((await c.post('/auth/login', { username, password })).status, 200);
  return c;
};

// Un chapitre livré, avec un exercice de 8 questions.
const CHAPITRE = '3e-calcul-litteral';
const ETAPE = 'ex2';
// Cinq comptes élèves : des pseudonymes, la plateforme ne connaît pas les noms.
const PSEUDOS = ['Loutre curieuse', 'Renard rusé', 'Mésange polie', 'Castor intrépide', 'Panda serein'];
let classId;

// Un élève qui se trompe sur les `fautes` premières questions. La réponse
// donnée est forcément différente de la bonne, quel que soit le type.
const seTrompe = (fautes) => (q, i, bonne) => {
  if (i >= fautes) return bonne;
  if (q.input.kind === 'choice') return String((Number(bonne) + 1) % q.input.options.length);
  if (q.input.kind === 'poly') return bonne === 'x' ? '2x' : 'x';
  return bonne === '0' ? '1' : '0';
};

test('mise en place : une classe de 3e qui travaille le calcul littéral', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  classId = (await prof.post('/teacher/classes', { name: '3e A', level: '3e' })).body.class.id;
  const created = await prof.post(`/teacher/classes/${classId}/students`, {
    students: PSEUDOS.map((pseudonym, i) => ({ pseudonym, username: `el${i + 1}`, password: 'soleil42' })),
  });
  assert.equal(created.status, 201);

  // Trois élèves sur cinq font l'erreur de signe sur la plupart des questions.
  for (const [i] of PSEUDOS.entries()) {
    const eleve = await login(client(), `el${i + 1}`, 'soleil42');
    // Le parcours est séquentiel : on termine les chapitres précédents.
    await unlockUpTo(eleve, '3e', CHAPITRE);
    const step = (await eleve.get(`/chapters/${CHAPITRE}`)).body.chapter.steps.find((x) => x.id === ETAPE);
    const { resultat } = await jouerSerie(eleve, { chapterId: CHAPITRE, step, repondre: seTrompe(i < 3 ? 5 : 1) });
    assert.equal(resultat.status, 200);
    assert.equal(resultat.body.score, step.count - (i < 3 ? 5 : 1), 'le serveur compte lui-même');
  }
});

test('le diagnostic mesure la réussite par exercice', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const d = (await prof.get(`/teacher/classes/${classId}/diagnostic/${CHAPITRE}`)).body;

  assert.equal(d.chapterTitle, 'Calcul littéral : développer');
  assert.equal(d.eleves, 5);
  assert.equal(d.assezDeDonnees, true);

  const etape = d.steps.find((s) => s.stepId === ETAPE);
  assert.equal(etape.questionsPosees, 40, '5 élèves × 8 questions');
  assert.equal(etape.elevesConcernes, 5);
  // 3 élèves à 3/8 et 2 à 7/8 → 23 bonnes réponses sur 40, soit 58 %.
  assert.equal(etape.reussite, 58);
  assert.equal(etape.tempsMoyen, 5);

  // Les étapes non travaillées sont déclarées comme telles, pas à 0 %.
  const jamaisFaite = d.steps.find((s) => s.stepId === 'ex5');
  assert.equal(jamaisFaite.questionsPosees, 0);
  assert.equal(jamaisFaite.reussite, null);
});

test('le diagnostic fait remonter les erreurs réellement commises', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const d = (await prof.get(`/teacher/classes/${classId}/diagnostic/${CHAPITRE}`)).body;

  assert.ok(d.erreurs.length, 'des erreurs sont remontées');
  for (const e of d.erreurs) {
    // Une erreur, c'est une réponse donnée différente de celle attendue.
    assert.notEqual(e.given, e.expected);
    assert.ok(e.given, 'la réponse de l’élève est conservée');
    assert.ok(e.expected, 'la réponse attendue aussi');
    assert.equal(e.stepTitle, "Opposé d'une parenthèse");
    assert.ok(e.eleves >= 1);
  }
  // Classement par nombre d'élèves concernés, du plus partagé au plus isolé.
  const eleves = d.erreurs.map((e) => e.eleves);
  assert.deepEqual(eleves, [...eleves].sort((a, b) => b - a));
});


test('des réponses absentes ou aberrantes ne passent pas pour des bonnes', async () => {
  const eleve = await login(client(), 'el1', 'soleil42');
  const step = (await eleve.get(`/chapters/${CHAPITRE}`)).body.chapter.steps.find((x) => x.id === ETAPE);

  // Aucune réponse envoyée : la série est enregistrée, à zéro.
  const vide = await eleve.post('/progress/start', { chapterId: CHAPITRE, stepId: ETAPE });
  const sansReponses = await eleve.post('/progress/attempt', { sessionId: vide.body.sessionId, answers: [], durationS: 10 });
  assert.equal(sansReponses.status, 200);
  assert.equal(sansReponses.body.score, 0, 'ne rien répondre ne vaut pas tout juste');

  // Réponses illisibles ou en surnombre : comptées fausses, jamais acceptées.
  const bizarre = await eleve.post('/progress/start', { chapterId: CHAPITRE, stepId: ETAPE });
  const absurde = await eleve.post('/progress/attempt', {
    sessionId: bizarre.body.sessionId,
    durationS: 99999999,
    answers: [
      { position: -5, given: 'x'.repeat(5000), durationS: 999999 },
      'pas un objet',
      null,
      ...Array.from({ length: 50 }, () => ({ given: 'nimporte quoi' })),
    ],
  });
  assert.equal(absurde.status, 200);
  assert.equal(absurde.body.score, 0);

  // Et rien de démesuré n'atterrit dans le suivi de l'enseignant.
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const d = (await prof.get(`/teacher/classes/${classId}/diagnostic/${CHAPITRE}`)).body;
  assert.equal(d.erreurs.find((e) => e.prompt.length > 300 || e.given.length > 120), undefined);
});


test('remettre un élève à zéro efface aussi le détail de ses réponses', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const eleves = (await prof.get(`/teacher/classes/${classId}/students`)).body.students;
  const lea = eleves.find((s) => s.username === 'el1');

  const avant = (await prof.get(`/teacher/classes/${classId}/diagnostic/${CHAPITRE}`)).body.steps.find((s) => s.stepId === ETAPE);
  assert.ok(avant.elevesConcernes >= 5);

  assert.equal((await prof.post(`/teacher/students/${lea.id}/reset-progress`)).status, 200);

  const apres = (await prof.get(`/teacher/classes/${classId}/diagnostic/${CHAPITRE}`)).body.steps.find((s) => s.stepId === ETAPE);
  assert.equal(apres.elevesConcernes, 4, 'Léa ne compte plus dans le diagnostic');
});

test('le diagnostic reste privé à l’enseignant de la classe', async () => {
  await services.accounts.createTeacher({ username: 'autre', password: 'motdepasse-2', displayName: 'Autre' });
  const autre = await login(client(), 'autre', 'motdepasse-2');
  assert.equal((await autre.get(`/teacher/classes/${classId}/diagnostic/${CHAPITRE}`)).status, 404);

  const eleve = await login(client(), 'el2', 'soleil42');
  assert.equal((await eleve.get(`/teacher/classes/${classId}/diagnostic/${CHAPITRE}`)).status, 403);

  const prof = await login(client(), 'prof', 'motdepasse-prof');
  assert.equal((await prof.get(`/teacher/classes/${classId}/diagnostic/chapitre-invente`)).status, 404);
});
