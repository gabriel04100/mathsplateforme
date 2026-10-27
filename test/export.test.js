// Export d'un chapitre en fichier HTML autonome.
//
// Ce qu'on vérifie ici n'est pas l'apparence mais ce qui rend le fichier
// utilisable : qu'il ne dépende de rien d'extérieur, que le code embarqué soit
// syntaxiquement valide une fois transformé, et que l'export reste réservé à
// l'enseignant propriétaire.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const baseConfig = require('../server/config');
const { createApp } = require('../server/app');
const { makeClient, login } = require('./helpers');

let server;
let base;
const ids = {};

before(async () => {
  const config = { ...baseConfig, dbFile: ':memory:', bcryptRounds: 4, isProd: false, loginRateLimit: { windowMs: 60000, max: 50 } };
  const built = await createApp(config, { log: { info() {}, error() {} } });
  await built.services.accounts.createTeacher({ username: 'prof', password: 'motdepasse-prof', displayName: 'Gabriel Pizzo' });
  await built.services.accounts.createTeacher({ username: 'autre', password: 'motdepasse-2', displayName: 'Autre' });
  server = built.app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;

  const prof = await login(makeClient(base), 'prof', 'motdepasse-prof');
  const classId = (await prof.post('/teacher/classes', { name: '3e A', level: '3e' })).body.class.id;
  await prof.post(`/teacher/classes/${classId}/students`, { students: [{ pseudonym: 'Loutre curieuse', username: 'loutre', password: 'soleil42' }] });
  ids.perso = (
    await prof.post('/teacher/chapters', {
      title: 'Mon chapitre à moi',
      level: '3e',
      steps: [{ id: 'c', type: 'lesson', title: 'Cours', blocks: [{ type: 'text', title: '', text: 'Du **texte**.' }] }],
    })
  ).body.chapter.dbId;
});
after(() => server.close());

const client = () => makeClient(base);
const telecharger = async (c, id) => {
  const res = await c.fetch(`/teacher/chapters/${encodeURIComponent(id)}/export`);
  return { status: res.status, headers: res.headers, html: await res.text() };
};

test('le fichier exporté se suffit à lui-même', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const { status, headers, html } = await telecharger(prof, '3e-calcul-litteral');

  assert.equal(status, 200);
  assert.match(headers.get('content-disposition'), /attachment; filename="3e-calcul-litteral-developper\.html"/);
  assert.match(headers.get('content-type'), /text\/html/);
  assert.match(html, /<title>Calcul littéral : développer — 3e<\/title>/);

  // Rien à aller chercher ailleurs : ni script, ni feuille de style, ni police.
  const externes = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(externes, [], `le fichier référence des ressources externes : ${externes}`);

  // Le contenu du chapitre est bien dedans, et les exercices avec.
  const data = JSON.parse(html.match(/id="mp-chapitre">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<'));
  assert.equal(data.title, 'Calcul littéral : développer');
  assert.ok(data.steps.some((s) => s.type === 'animation' && s.widget === 'area-model'));
  const exos = data.steps.filter((s) => s.type === 'exercise');
  assert.equal(exos.length, 6);
  assert.ok(exos.every((s) => s.generator && s.count >= 1), 'chaque exercice part avec son générateur');

  // Aucune donnée de la plateforme n'a fui dans le fichier.
  assert.doesNotMatch(html, /classId|teacher_id|password/i);
});

test('le code embarqué est du JavaScript valide, sans import ni export résiduel', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const { html } = await telecharger(prof, '3e-calcul-litteral');

  const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 8, `8 modules attendus au moins, ${scripts.length} trouvés`);

  for (const [i, code] of scripts.entries()) {
    // Un `import`/`export` resté en place ferait planter le script au chargement.
    assert.doesNotMatch(code, /^\s*import\s/m, `module ${i} : un import n'a pas été transformé`);
    assert.doesNotMatch(code, /^\s*export\s/m, `module ${i} : un export n'a pas été transformé`);
    // Et le code doit se compiler.
    assert.doesNotThrow(() => new vm.Script(code, { filename: `module-${i}.js` }), `module ${i} : syntaxe invalide`);
  }

  // Le registre est bien alimenté par les modules dont la page a besoin.
  for (const attendu of ['generators.js', 'widgets.js', 'template.js']) {
    assert.ok(html.includes(`window.__mp[${JSON.stringify(attendu)}] =`), `${attendu} n'est pas publié dans le registre`);
  }
});

test('un chapitre personnel s’exporte, celui d’un autre non', async () => {
  const prof = await login(client(), 'prof', 'motdepasse-prof');
  const mien = await telecharger(prof, `c-${ids.perso}`);
  assert.equal(mien.status, 200);
  assert.match(mien.html, /Mon chapitre à moi/);
  // Le texte du cours part en HTML déjà rendu, pas en source à interpréter.
  const data = JSON.parse(mien.html.match(/id="mp-chapitre">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<'));
  assert.match(data.steps[0].blocks[0].html, /<strong>texte<\/strong>/);
  assert.equal(data.steps[0].blocks[0].text, undefined, 'la version source ne part pas');

  const autre = await login(client(), 'autre', 'motdepasse-2');
  assert.equal((await telecharger(autre, `c-${ids.perso}`)).status, 404);
});

test('l’export est réservé à l’enseignant', async () => {
  const eleve = await login(client(), 'loutre', 'soleil42');
  assert.equal((await telecharger(eleve, '3e-calcul-litteral')).status, 403);
  assert.equal((await telecharger(client(), '3e-calcul-litteral')).status, 401);

  const prof = await login(client(), 'prof', 'motdepasse-prof');
  assert.equal((await telecharger(prof, 'chapitre-invente')).status, 404);
});
