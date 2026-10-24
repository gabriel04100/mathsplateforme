// Chapitres écrits par l'enseignant (cours + parcours), archivage, prénom/nom.
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

const COURSE_STEPS = [
  {
    id: 'cours',
    type: 'lesson',
    title: 'Le cours',
    blocks: [
      { type: 'definition', title: 'Nombre premier', text: "Un **nombre premier** a exactement deux diviseurs : $1$ et lui-même." },
      { type: 'method', title: 'Comment tester', text: '- Je divise par 2, 3, 5, 7\n- Je m’arrête au-delà de la racine' },
    ],
  },
  { id: 'anim', type: 'animation', title: 'Le crible', widget: 'sieve', intro: 'Barre les multiples.' },
  { id: 'ex', type: 'exercise', title: 'À toi', source: 'generator', generator: 'arith-prime', count: 5, pass: 4 },
];

let classId;
let chapterId;

test('l’enseignant écrit un chapitre complet et le publie', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  classId = (await prof.post('/teacher/classes', { name: '3e A', level: '3e' })).body.class.id;

  // La palette annonce les blocs, animations et exercices disponibles.
  const palette = (await prof.get('/teacher/chapters/palette')).body;
  assert.ok(palette.blocks.some((b) => b.id === 'definition'), 'le bloc Définition est proposé');
  assert.ok(palette.generators.includes('arith-prime'));

  // Les animations arrivent avec un nom lisible : l'identifiant technique ne
  // doit jamais être ce que l'enseignant lit dans la liste déroulante.
  const crible = palette.widgets.find((w) => w.id === 'sieve');
  assert.ok(crible, 'le crible est proposé');
  assert.equal(crible.label, 'Crible d’Ératosthène');
  assert.equal(crible.level, '3e');
  assert.ok(crible.hint.length > 20, 'chaque animation explique ce que fait l’élève');
  for (const w of palette.widgets) {
    assert.notEqual(w.label, w.id, `l’animation « ${w.id} » n’a pas de nom lisible`);
    // Les libellés partent dans un <option>, où KaTeX ne rend rien.
    assert.ok(!w.label.includes('$'), `l’animation « ${w.id} » a du LaTeX dans son nom`);
  }

  const created = await prof.post('/teacher/chapters', {
    title: 'Les nombres premiers',
    level: '3e',
    summary: 'Reconnaître un nombre premier.',
    steps: COURSE_STEPS,
  });
  assert.equal(created.status, 201);
  chapterId = created.body.chapter.id;
  assert.match(chapterId, /^c-\d+$/, 'un identifiant qui ne peut pas heurter ceux des fichiers');
  assert.equal(created.body.chapter.status, 'draft');
  assert.equal(created.body.chapter.steps.length, 3);

  await prof.patch(`/teacher/chapters/${created.body.chapter.dbId}`, { status: 'published' });
});

test('le cours est rendu en HTML sûr pour l’élève', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  await prof.post(`/teacher/classes/${classId}/students`, {
    students: [{ firstName: 'Nina', lastName: 'Dubois', username: 'nina', password: 'soleil42' }],
  });

  const eleve = await login(client(), 'nina', 'soleil42');
  const data = (await eleve.get(`/chapters/${chapterId}`)).body;
  assert.equal(data.chapter.title, 'Les nombres premiers');

  const lesson = data.chapter.steps[0];
  assert.ok(lesson.blocks[0].html.includes('<strong>nombre premier</strong>'), 'le **gras** est interprété');
  assert.ok(lesson.blocks[0].html.includes('$1$'), 'le LaTeX est laissé à KaTeX');
  assert.ok(lesson.blocks[1].html.includes('<li>'), 'les listes sont interprétées');
  assert.equal(lesson.blocks[0].text, undefined, "la source n'est pas envoyée à l'élève");

  // L'animation et l'exercice arrivent prêts à jouer.
  assert.equal(data.chapter.steps[1].widget, 'sieve');
  assert.equal(data.chapter.steps[2].count, 5);
});

test('le chapitre entre dans le parcours du niveau et accepte la progression', async () => {
  const eleve = await login(client(), 'nina', 'soleil42');
  const level = (await eleve.get('/levels/3e')).body;
  const mine = level.chapters.find((c) => c.id === chapterId);
  assert.ok(mine, 'le chapitre apparaît dans le parcours de 3e');
  assert.equal(mine.custom, true);

  // Il est pris en compte comme n'importe quel chapitre du programme.
  assert.equal((await eleve.post('/progress/visit', { chapterId, stepId: 'cours' })).status, 200);
  const attempt = await eleve.post('/progress/attempt', { chapterId, stepId: 'ex', score: 5, total: 5, durationS: 40 });
  assert.equal(attempt.status, 200);
  assert.equal(attempt.body.everPassed, true);

  // Et il figure dans le suivi de la classe.
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const grid = (await prof.get(`/teacher/classes/${classId}/progress?level=3e`)).body;
  assert.ok(grid.chapters.some((c) => c.id === chapterId && c.custom === true));
});

test('un chapitre en brouillon ou archivé disparaît pour l’élève', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const dbId = (await prof.get('/teacher/chapters')).body.chapters.find((c) => c.id === chapterId).dbId;
  const eleve = await login(client(), 'nina', 'soleil42');
  const visible = async () => (await eleve.get('/levels/3e')).body.chapters.some((c) => c.id === chapterId);

  assert.equal(await visible(), true);
  await prof.patch(`/teacher/chapters/${dbId}`, { status: 'draft' });
  assert.equal(await visible(), false, 'un brouillon reste chez son auteur');
  assert.equal((await eleve.get(`/chapters/${chapterId}`)).status, 404);

  await prof.patch(`/teacher/chapters/${dbId}`, { status: 'published', archived: true });
  assert.equal(await visible(), false, 'un chapitre archivé sort du parcours');
  // Mais l'enseignant le retrouve dans ses archives.
  assert.equal((await prof.get('/teacher/chapters')).body.chapters.length, 0);
  assert.equal((await prof.get('/teacher/chapters?archives=1')).body.chapters.length, 1);

  await prof.patch(`/teacher/chapters/${dbId}`, { archived: false });
  assert.equal(await visible(), true, 'le désarchivage le remet en place');
});

test('un chapitre que l’élève ne pourrait pas suivre est refusé', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const bad = (steps, extra = {}) => prof.post('/teacher/chapters', { title: 'Essai', level: '3e', steps, ...extra });

  assert.equal((await bad([])).status, 400, 'un chapitre sans étape');
  assert.equal((await bad([{ id: 'a', type: 'lesson', title: 'x', blocks: [] }])).status, 400, 'un cours sans bloc');
  assert.equal((await bad([{ id: 'a', type: 'lesson', title: 'x', blocks: [{ type: 'inventé', text: 'y' }] }])).status, 400, 'un type de bloc inconnu');
  assert.equal((await bad([{ id: 'a', type: 'lesson', title: 'x', blocks: [{ type: 'text', text: '' }] }])).status, 400, 'un bloc vide');
  assert.equal((await bad([{ id: 'a', type: 'animation', title: 'x', widget: 'inexistante' }])).status, 400, 'une animation inconnue');
  assert.equal((await bad([{ id: 'a', type: 'exercise', title: 'x', source: 'generator', generator: 'inexistant', count: 5, pass: 4 }])).status, 400);
  assert.equal((await bad([{ id: 'a', type: 'exercise', title: 'x', source: 'generator', generator: 'arith-prime', count: 3, pass: 9 }])).status, 400, 'objectif > questions');
  assert.equal((await bad([{ id: 'a', type: 'exercise', title: 'x', source: 'custom', exerciseId: 9999 }])).status, 400, 'un exercice qui ne lui appartient pas');
  assert.equal((await bad(COURSE_STEPS, { title: 'x' })).status, 400, 'un titre trop court');
  assert.equal((await bad(COURSE_STEPS, { level: '7e' })).status, 400, 'un niveau inexistant');
});

test('les élèves sont créés avec prénom et nom séparés', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const created = (
    await prof.post(`/teacher/classes/${classId}/students`, {
      students: [
        { firstName: 'Léa', lastName: 'Martin' },
        { firstName: 'Jean-Paul', lastName: "D'Artagnan" },
        { displayName: 'Hugo Bernard' }, // ancienne forme : toujours acceptée
      ],
    })
  ).body.created;

  assert.deepEqual(
    created.map((c) => [c.firstName, c.lastName, c.displayName]),
    [
      ['Léa', 'Martin', 'Léa Martin'],
      ['Jean-Paul', "D'Artagnan", "Jean-Paul D'Artagnan"],
      ['Hugo', 'Bernard', 'Hugo Bernard'],
    ]
  );
  assert.equal(created[0].username, 'lea.martin');

  const students = (await prof.get(`/teacher/classes/${classId}/students`)).body.students;
  const lea = students.find((s) => s.username === 'lea.martin');
  assert.equal(lea.firstName, 'Léa');
  assert.equal(lea.lastName, 'Martin');
  // Liste triée par nom de famille, comme une liste d'appel.
  const noms = students.map((s) => s.lastName);
  assert.deepEqual(noms, [...noms].sort((a, b) => a.localeCompare(b, 'fr')));

  // Un prénom invalide est refusé, et le nom seul ne suffit pas.
  assert.equal((await prof.post(`/teacher/classes/${classId}/students`, { students: [{ firstName: 'Léa42', lastName: 'Martin' }] })).status, 400);
  assert.equal((await prof.post(`/teacher/classes/${classId}/students`, { students: [{ firstName: '', lastName: 'Martin' }] })).status, 400);
});

test('une classe archivée quitte la liste principale sans perdre ses élèves', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const before = (await prof.get('/teacher/classes')).body;
  assert.ok(before.classes.some((c) => c.id === classId));

  await prof.patch(`/teacher/classes/${classId}`, { archived: true });
  const after = (await prof.get('/teacher/classes')).body;
  assert.ok(!after.classes.some((c) => c.id === classId), 'elle sort de la liste');
  assert.equal(after.archivedCount, 1);
  assert.ok((await prof.get('/teacher/classes?archives=1')).body.classes.some((c) => c.id === classId));

  // Les élèves et leur travail sont intacts : Nina se connecte encore et
  // retrouve son parcours, archivage ou non.
  assert.ok((await prof.get(`/teacher/classes/${classId}/students`)).body.students.length >= 1);
  const nina = await login(client(), 'nina', 'soleil42');
  assert.equal((await nina.get('/levels/3e')).status, 200);
  assert.equal((await nina.get('/dashboard')).body.className, '3e A');

  await prof.patch(`/teacher/classes/${classId}`, { archived: false });
  assert.ok((await prof.get('/teacher/classes')).body.classes.some((c) => c.id === classId));
});
