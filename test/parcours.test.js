// Modifier un chapitre livré dans content/ et réorganiser le parcours d'un niveau.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const baseConfig = require('../server/config');
const { createApp } = require('../server/app');
const { unlockUpTo, completeChapter } = require('./helpers');

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

// Un chapitre réellement livré dans content/.
const FILE_CHAPTER = '6e-fractions';

test('mise en place : une classe de 6e et son élève', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const classId = (await prof.post('/teacher/classes', { name: '6e A', level: '6e' })).body.class.id;
  const created = await prof.post(`/teacher/classes/${classId}/students`, {
    students: [{ firstName: 'Tom', lastName: 'Leroy', username: 'tom', password: 'soleil42' }],
  });
  assert.equal(created.status, 201);
});

test('un chapitre livré arrive dans l’éditeur avec son cours en texte modifiable', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const ch = (await prof.get(`/teacher/chapters/${FILE_CHAPTER}`)).body.chapter;

  assert.equal(ch.origin, 'fichier');
  assert.equal(ch.modified, false);
  assert.ok(ch.steps.length >= 2);

  const lesson = ch.steps.find((s) => s.type === 'lesson');
  const withBold = lesson.blocks.find((b) => b.text.includes('**'));
  assert.ok(withBold, 'le <strong> du fichier est devenu du **gras** modifiable');
  assert.ok(lesson.blocks.every((b) => typeof b.text === 'string' && b.html === undefined), 'les blocs sont fournis en source, pas en HTML');
  assert.ok(lesson.blocks.some((b) => b.text.includes('$')), 'le LaTeX est intact');
});

test('modifier un chapitre livré ne change que le parcours de ses classes', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const before = (await prof.get(`/teacher/chapters/${FILE_CHAPTER}`)).body.chapter;
  const steps = JSON.parse(JSON.stringify(before.steps));
  steps[0].blocks.unshift({ type: 'remark', title: 'Mon ajout', text: 'Attention : **relis bien** l’énoncé.' });

  const saved = await prof.patch(`/teacher/chapters/${FILE_CHAPTER}`, { title: 'Les fractions (ma version)', steps });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.chapter.modified, true);

  // L'élève voit la version de son professeur, rendue en HTML sûr.
  const eleve = await login(client(), 'tom', 'soleil42');
  await unlockUpTo(eleve, '6e', FILE_CHAPTER);
  const seen = (await eleve.get(`/chapters/${FILE_CHAPTER}`)).body.chapter;
  assert.equal(seen.title, 'Les fractions (ma version)');
  assert.ok(seen.steps[0].blocks[0].html.includes('<strong>relis bien</strong>'));
  assert.equal(seen.steps[0].blocks[0].text, undefined);

  // Un autre enseignant garde la version d'origine : les fichiers n'ont pas bougé.
  const autre = await login(client(), 'autre', 'motdepasse-2');
  const original = (await autre.get(`/teacher/chapters/${FILE_CHAPTER}`)).body.chapter;
  assert.equal(original.modified, false);
  assert.notEqual(original.title, 'Les fractions (ma version)');
  assert.equal(services.content.chapter(FILE_CHAPTER).title, original.title, 'le fichier est inchangé');
});

test('on peut revenir à la version d’origine', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const reset = await prof.post(`/teacher/chapters/${FILE_CHAPTER}/reset`);
  assert.equal(reset.status, 200);
  assert.equal(reset.body.chapter.modified, false);
  assert.equal(reset.body.chapter.title, services.content.chapter(FILE_CHAPTER).title);

  const eleve = await login(client(), 'tom', 'soleil42');
  assert.equal((await eleve.get(`/chapters/${FILE_CHAPTER}`)).body.chapter.title, services.content.chapter(FILE_CHAPTER).title);
});

test('le parcours d’un niveau se réordonne, chapitres livrés et personnels mêlés', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const mine = (
    await prof.post('/teacher/chapters', {
      title: 'Révisions de début d’année',
      level: '6e',
      status: 'published',
      steps: [{ id: 'cours', type: 'lesson', title: 'Rappels', blocks: [{ type: 'text', title: '', text: 'On revoit les bases.' }] }],
    })
  ).body.chapter;

  const parcours = (await prof.get('/teacher/parcours/6e')).body.chapters;
  assert.ok(parcours.some((c) => c.origin === 'fichier'), 'les chapitres livrés figurent au parcours');
  assert.ok(parcours.some((c) => c.id === mine.id && c.origin === 'perso'));

  // On place le chapitre personnel en tête, devant les chapitres livrés.
  const newOrder = [mine.id, ...parcours.filter((c) => c.id !== mine.id).map((c) => c.id)];
  const after = (await prof.patch('/teacher/parcours/6e', { order: newOrder })).body.chapters;
  assert.deepEqual(after.map((c) => c.id), newOrder);
  assert.equal(after[0].id, mine.id);

  // L'élève voit le même ordre.
  const eleve = await login(client(), 'tom', 'soleil42');
  const vu = (await eleve.get('/levels/6e')).body.chapters.map((c) => c.id);
  assert.equal(vu[0], mine.id, 'le chapitre personnel ouvre désormais le parcours');

  // Un identifiant étranger au niveau est refusé.
  assert.equal((await prof.patch('/teacher/parcours/6e', { order: ['3e-arithmetique'] })).status, 404);
  assert.equal((await prof.patch('/teacher/parcours/6e', { order: [] })).status, 400);
});

test('masquer un chapitre livré le retire du parcours des élèves', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const eleve = await login(client(), 'tom', 'soleil42');
  const visible = async () => (await eleve.get('/levels/6e')).body.chapters.some((c) => c.id === FILE_CHAPTER);

  assert.equal(await visible(), true);
  await prof.patch(`/teacher/chapters/${FILE_CHAPTER}`, { hidden: true });
  assert.equal(await visible(), false);
  assert.equal((await eleve.get(`/chapters/${FILE_CHAPTER}`)).status, 404);

  // L'enseignant, lui, le garde sous les yeux pour pouvoir le remettre.
  const parcours = (await prof.get('/teacher/parcours/6e')).body.chapters;
  assert.equal(parcours.find((c) => c.id === FILE_CHAPTER).hidden, true);

  await prof.patch(`/teacher/chapters/${FILE_CHAPTER}`, { hidden: false });
  assert.equal(await visible(), true);
});

test('un chapitre « Bientôt » peut être rempli et publié par l’enseignant', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const draft = services.content.chaptersOfLevel('6e').find((c) => c.status === 'draft');
  assert.ok(draft, 'le programme livré contient des chapitres à venir');

  const eleve = await login(client(), 'tom', 'soleil42');
  const seenBefore = (await eleve.get('/levels/6e')).body.chapters.find((c) => c.id === draft.id);
  assert.equal(seenBefore.status, 'draft');

  await prof.patch(`/teacher/chapters/${draft.id}`, {
    status: 'published',
    steps: [{ id: 'cours', type: 'lesson', title: 'Le cours', blocks: [{ type: 'definition', title: '', text: 'À retenir : $a+b=b+a$.' }] }],
  });

  const seenAfter = (await eleve.get('/levels/6e')).body.chapters.find((c) => c.id === draft.id);
  assert.equal(seenAfter.status, 'published', 'il entre dans le parcours');
  await unlockUpTo(eleve, '6e', draft.id);
  const full = (await eleve.get(`/chapters/${draft.id}`)).body.chapter;
  assert.ok(full.steps[0].blocks[0].html.includes('$a+b=b+a$'));
});

test('le parcours séquentiel ne se contourne pas par l’API', async () => {
  const eleve = await login(client(), 'tom', 'soleil42');
  // Tom n'a encore rien fait en 4e : le premier chapitre est ouvert, le second non.
  const chapitres = (await eleve.get('/levels/4e')).body.chapters.filter((c) => c.status === 'published');
  const [premier, second] = chapitres;
  assert.ok(second, 'il faut au moins deux chapitres publiés pour ce test');

  // Le contenu d'un chapitre verrouillé n'est pas servi.
  const vu = (await eleve.get(`/chapters/${second.id}`)).body;
  assert.equal(vu.progress.unlocked, false);
  const cours = vu.chapter.steps.find((s) => s.type === 'lesson');
  assert.equal(cours.blocks, undefined, 'le cours d’un chapitre verrouillé ne doit pas être envoyé');
  const exo = vu.chapter.steps.find((s) => s.type === 'exercise');
  assert.equal(exo.generator, undefined, 'les paramètres d’exercice non plus');

  // Et on ne peut pas y enregistrer de travail.
  const triche = await eleve.post('/progress/attempt', { chapterId: second.id, stepId: exo.id, score: 1, total: 1, durationS: 5 });
  assert.equal(triche.status, 403);
  assert.match(triche.body.error, /se débloquera/);
  assert.equal((await eleve.post('/progress/visit', { chapterId: second.id, stepId: exo.id })).status, 403);

  // Le premier chapitre, lui, est bien ouvert.
  assert.equal((await eleve.get(`/chapters/${premier.id}`)).body.progress.unlocked, true);
  await completeChapter(eleve, premier.id);

  // Une fois le premier terminé, le second s'ouvre.
  const apres = (await eleve.get(`/chapters/${second.id}`)).body;
  assert.equal(apres.progress.unlocked, true);
  assert.ok(apres.chapter.steps.find((s) => s.type === 'lesson').blocks, 'le cours est désormais servi');
});

test('les exercices libres restent accessibles hors parcours', async () => {
  const eleve = await login(client(), 'tom', 'soleil42');
  // Un chapitre encore verrouillé en 5e : ses exercices restent jouables en
  // mode libre, c'est toute la raison d'être des exercices libres.
  const chapitres = (await eleve.get('/levels/5e')).body.chapters.filter((c) => c.status === 'published');
  const verrouille = chapitres[1];
  assert.equal((await eleve.get(`/chapters/${verrouille.id}`)).body.progress.unlocked, false);

  const exo = verrouille.steps.find((s) => s.type === 'exercise');
  const libre = await eleve.post('/progress/attempt', {
    chapterId: verrouille.id,
    stepId: exo.id,
    score: exo.count,
    total: exo.count,
    durationS: 30,
    mode: 'libre',
  });
  assert.equal(libre.status, 200, 'le mode libre échappe au verrou');
});

test('on ne modifie pas un chapitre qui n’existe pas', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  assert.equal((await prof.get('/teacher/chapters/chapitre-invente')).status, 404);
  assert.equal((await prof.patch('/teacher/chapters/chapitre-invente', { title: 'Essai' })).status, 404);
  assert.equal((await prof.post('/teacher/chapters/chapitre-invente/reset')).status, 404);
  // Et un élève ne peut rien modifier.
  const eleve = await login(client(), 'tom', 'soleil42');
  assert.equal((await eleve.patch(`/teacher/chapters/${FILE_CHAPTER}`, { title: 'Pirate' })).status, 403);
  assert.equal((await eleve.patch('/teacher/parcours/6e', { order: [] })).status, 403);
});
