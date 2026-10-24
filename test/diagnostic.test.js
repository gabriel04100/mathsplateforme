// « Où ça coince » : enregistrement du détail des réponses et diagnostic de classe.
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
const NOMS = [
  ['Léa', 'Martin'],
  ['Hugo', 'Bernard'],
  ['Inès', 'Petit'],
  ['Tom', 'Leroy'],
  ['Zoé', 'Garcia'],
];
let classId;

// Une série où `fautes` questions portent l'erreur de signe classique.
function serie(fautes) {
  const questions = [];
  for (let q = 0; q < 8; q++) {
    const a = 3 + q;
    const faux = q < fautes;
    questions.push({
      position: q + 1,
      prompt: `Supprime la parenthèse : -(x + ${a})`,
      expected: `-x - ${a}`,
      given: faux ? `-x + ${a}` : `-x - ${a}`,
      ok: !faux,
      durationS: 10,
    });
  }
  return { chapterId: CHAPITRE, stepId: ETAPE, score: 8 - fautes, total: 8, durationS: 80, questions };
}

test('mise en place : une classe de 3e qui travaille le calcul littéral', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  classId = (await prof.post('/teacher/classes', { name: '3e A', level: '3e' })).body.class.id;
  const created = await prof.post(`/teacher/classes/${classId}/students`, {
    students: NOMS.map(([f, l], i) => ({ firstName: f, lastName: l, username: `el${i + 1}`, password: 'soleil42' })),
  });
  assert.equal(created.status, 201);

  // Trois élèves sur cinq font l'erreur de signe sur la plupart des questions.
  for (const [i] of NOMS.entries()) {
    const eleve = await login(client(), `el${i + 1}`, 'soleil42');
    assert.equal((await eleve.post('/progress/attempt', serie(i < 3 ? 5 : 1))).status, 200);
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
  assert.equal(etape.tempsMoyen, 10);

  // Les étapes non travaillées sont déclarées comme telles, pas à 0 %.
  const jamaisFaite = d.steps.find((s) => s.stepId === 'ex5');
  assert.equal(jamaisFaite.questionsPosees, 0);
  assert.equal(jamaisFaite.reussite, null);
});

test('le diagnostic fait remonter l’erreur commune à la classe', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const d = (await prof.get(`/teacher/classes/${classId}/diagnostic/${CHAPITRE}`)).body;

  assert.ok(d.erreurs.length, 'des erreurs sont remontées');
  const premiere = d.erreurs[0];
  // La question ratée par tout le monde arrive en tête, avec ce qui a été répondu.
  assert.equal(premiere.eleves, 5);
  assert.equal(premiere.given, '-x + 3');
  assert.equal(premiere.expected, '-x - 3');
  assert.match(premiere.prompt, /Supprime la parenthèse/);
  assert.equal(premiere.stepTitle, "Opposé d'une parenthèse");

  // Classement par nombre d'élèves concernés : l'erreur partagée passe devant.
  const eleves = d.erreurs.map((e) => e.eleves);
  assert.deepEqual(eleves, [...eleves].sort((a, b) => b - a));
  // Une bonne réponse n'apparaît jamais comme erreur.
  assert.ok(d.erreurs.every((e) => e.given !== e.expected));
});

test('le détail envoyé par le navigateur est borné et ne bloque jamais la série', async () => {
  const eleve = await login(client(), 'el1', 'soleil42');

  // Détail absent : la série est tout de même enregistrée.
  const sansDetail = await eleve.post('/progress/attempt', { chapterId: CHAPITRE, stepId: ETAPE, score: 8, total: 8, durationS: 60 });
  assert.equal(sansDetail.status, 200);

  // Détail aberrant : accepté sans faire échouer l'enregistrement du score.
  const absurde = await eleve.post('/progress/attempt', {
    chapterId: CHAPITRE,
    stepId: ETAPE,
    score: 8,
    total: 8,
    durationS: 60,
    questions: [
      { position: -5, prompt: 'x'.repeat(5000), expected: 'y'.repeat(5000), given: 'z'.repeat(5000), ok: 'oui', durationS: 999999 },
      'pas un objet',
      null,
      ...Array.from({ length: 50 }, (_, i) => ({ position: i, prompt: 'en trop', ok: true })),
    ],
  });
  assert.equal(absurde.status, 200);

  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const d = (await prof.get(`/teacher/classes/${classId}/diagnostic/${CHAPITRE}`)).body;
  const trop = d.erreurs.find((e) => e.prompt.length > 300 || e.given.length > 120);
  assert.equal(trop, undefined, 'aucun texte ne dépasse les bornes');
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
