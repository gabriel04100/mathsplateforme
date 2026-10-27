// Documents PDF : dépôt par l'enseignant, téléchargement par ses élèves,
// et surtout ce qui doit être refusé.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const baseConfig = require('../server/config');
const { createApp } = require('../server/app');

let server;
let base;
let services;
let dataDir;

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const b64 = (buf) => buf.toString('base64');

before(async () => {
  // Les fichiers déposés atterrissent à côté de la base : en test, dans un
  // dossier temporaire qu'on efface à la fin.
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-docs-'));
  const config = {
    ...baseConfig,
    dbFile: path.join(dataDir, 'test.sqlite'),
    bcryptRounds: 4,
    isProd: false,
    loginRateLimit: { windowMs: 60000, max: 50 },
  };
  const built = await createApp(config, { log: { info() {}, error: console.error } });
  services = built.services;
  await services.accounts.createTeacher({ username: 'prof', password: 'motdepasse-prof', displayName: 'Gabriel Pizzo' });
  await services.accounts.createTeacher({ username: 'autre', password: 'motdepasse-2', displayName: 'Autre' });
  server = built.app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

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
    return { status: res.status, body: await res.json().catch(() => null), headers: res.headers, raw: res };
  };
  return {
    get: (u) => call('GET', u),
    post: (u, b = {}) => call('POST', u, b),
    patch: (u, b = {}) => call('PATCH', u, b),
    del: (u) => call('DELETE', u, {}),
    fetch: (u) => fetch(base + u, { headers: cookie ? { cookie } : {} }),
  };
}

const login = async (c, username, password) => {
  assert.equal((await c.post('/auth/login', { username, password })).status, 200);
  return c;
};

let classId;
let docId;

test('mise en place : une classe de 3e avec une élève', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  classId = (await prof.post('/teacher/classes', { name: '3e A', level: '3e' })).body.class.id;
  assert.equal(
    (await prof.post(`/teacher/classes/${classId}/students`, { students: [{ pseudonym: 'Mésange polie', username: 'nina', password: 'soleil42' }] }))
      .status,
    201
  );
});

test('l’enseignant dépose un PDF, l’élève le télécharge', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const dep = await prof.post('/documents', {
    title: 'Le cours en PDF',
    level: '3e',
    chapterId: '3e-calcul-litteral',
    filename: 'cours chapitre 3.pdf',
    fileBase64: b64(PDF),
  });
  assert.equal(dep.status, 201);
  docId = dep.body.document.id;
  assert.equal(dep.body.document.chapterTitle, 'Calcul littéral : développer');
  assert.equal(dep.body.document.downloads, 0);

  const eleve = await login(client(), 'nina', 'soleil42');
  const liste = (await eleve.get('/documents?niveau=3e')).body.documents;
  assert.equal(liste.length, 1);
  assert.equal(liste[0].title, 'Le cours en PDF');

  // Le filtre par chapitre fonctionne.
  assert.equal((await eleve.get('/documents?niveau=3e&chapitre=3e-calcul-litteral')).body.documents.length, 1);
  assert.equal((await eleve.get('/documents?niveau=3e&chapitre=3e-arithmetique')).body.documents.length, 0);

  // Le fichier arrive intact, en pièce jointe, et jamais affiché dans la page.
  const res = await eleve.fetch(`/documents/${docId}/fichier`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /^attachment;/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), PDF.toString());

  // Le téléchargement d'un élève est compté.
  const prof2 = await login(client(), 'prof', 'motdepasse-prof');
  assert.equal((await prof2.get('/documents')).body.documents.find((d) => d.id === docId).downloads, 1);
});

test('ce qui n’est pas un PDF est refusé, quel que soit le nom du fichier', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const depose = (body) => prof.post('/documents', { title: 'Essai', level: '3e', filename: 'x.pdf', ...body });

  // Le contenu fait foi, pas l'extension.
  assert.equal((await depose({ fileBase64: b64(Buffer.from('MZ\x90\x00 un exécutable')) })).status, 400);
  assert.equal((await depose({ fileBase64: b64(Buffer.from('<html>hop</html>')) })).status, 400);
  assert.equal((await depose({ fileBase64: '' })).status, 400);
  assert.equal((await depose({ fileBase64: b64(Buffer.alloc(0)) })).status, 400);
  // Niveau et titre sont contrôlés.
  assert.equal((await depose({ level: '7e', fileBase64: b64(PDF) })).status, 400);
  assert.equal((await prof.post('/documents', { title: 'x', level: '3e', filename: 'a.pdf', fileBase64: b64(PDF) })).status, 400);
});

test('un PDF plus lourd que la limite générale de l’API passe quand même', async () => {
  // Le reste de l'API est plafonné à 200 ko ; un cours scanné pèse beaucoup
  // plus. Le dépôt a donc son propre analyseur de corps — encore faut-il que
  // l'analyseur général le laisse passer, ce qu'il ne faisait pas.
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const gros = Buffer.concat([PDF, Buffer.alloc(400 * 1024, 0x20)]);
  const res = await prof.post('/documents', { title: 'Cours scanné', level: '3e', filename: 'cours.pdf', fileBase64: b64(gros) });
  assert.equal(res.status, 201, 'un PDF de 400 ko doit être accepté');
  assert.ok(res.body.document.sizeKo > 200);

  // Et les autres routes restent bien plafonnées : la brèche ne s'ouvre que là.
  const enorme = await prof.post('/teacher/classes', { name: 'x'.repeat(300000), level: '3e' });
  assert.equal(enorme.status, 413);
});

test('un nom de fichier piégé ne sort pas du dossier des documents', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const dep = await prof.post('/documents', {
    title: 'Nom piégé',
    level: '3e',
    filename: '../../../etc/passwd.pdf',
    fileBase64: b64(PDF),
  });
  assert.equal(dep.status, 201);
  // Le nom montré à l'élève est nettoyé…
  assert.equal(dep.body.document.filename, 'passwd.pdf');

  // …et le nom sur le disque est tiré au sort, jamais celui fourni.
  const row = services.repos.documents.findById(dep.body.document.id);
  assert.match(row.stored_name, /^[a-f0-9]{32}\.pdf$/);
  const fichiers = fs.readdirSync(path.join(dataDir, 'documents'));
  assert.ok(fichiers.every((f) => /^[a-f0-9]{32}\.pdf$/.test(f)), 'aucun nom de fichier étranger sur le disque');
});

test('les documents restent entre l’enseignant et ses élèves', async () => {
  const eleve = await login(client(), 'nina', 'soleil42');
  // Un élève ne dépose ni ne supprime.
  assert.equal((await eleve.post('/documents', { title: 'Pirate', level: '3e', filename: 'x.pdf', fileBase64: b64(PDF) })).status, 403);
  assert.equal((await eleve.del(`/documents/${docId}`)).status, 403);

  // Un autre enseignant ne voit ni ne touche ceux-ci.
  const autre = await login(client(), 'autre', 'motdepasse-2');
  assert.deepEqual((await autre.get('/documents')).body.documents, []);
  assert.equal((await autre.del(`/documents/${docId}`)).status, 404);
  assert.equal((await autre.patch(`/documents/${docId}`, { title: 'Volé' })).status, 404);
  assert.equal((await autre.fetch(`/documents/${docId}/fichier`)).status, 404);

  // Sans connexion, rien.
  const anon = client();
  assert.equal((await anon.get('/documents')).status, 401);
  assert.equal((await anon.fetch(`/documents/${docId}/fichier`)).status, 401);
});

test('supprimer un document efface aussi le fichier du disque', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const row = services.repos.documents.findById(docId);
  const file = path.join(dataDir, 'documents', row.stored_name);
  assert.ok(fs.existsSync(file));

  assert.equal((await prof.del(`/documents/${docId}`)).status, 200);
  assert.equal(fs.existsSync(file), false, 'le fichier ne doit pas rester orphelin');

  const eleve = await login(client(), 'nina', 'soleil42');
  assert.equal((await eleve.fetch(`/documents/${docId}/fichier`)).status, 404);
});
