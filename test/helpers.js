// Outils partagés par les tests d'API.
const assert = require('node:assert/strict');

// Un client HTTP qui garde son cookie de session, comme un navigateur.
function makeClient(base) {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
  };
  return {
    get: (u) => call('GET', u),
    post: (u, b = {}) => call('POST', u, b),
    patch: (u, b = {}) => call('PATCH', u, b),
    del: (u) => call('DELETE', u, {}),
    fetch: (u) => fetch(base + u, { headers: cookie ? { cookie } : {} }),
  };
}

async function login(client, username, password) {
  assert.equal((await client.post('/auth/login', { username, password })).status, 200);
  return client;
}

// Le code que le navigateur utilise pour tirer les questions. Les tests s'en
// servent pour rejouer une série à partir de la graine, comme le fait le
// serveur quand il corrige.
let modules = null;
async function moteur() {
  if (!modules) {
    const [random, generators, template] = await Promise.all([
      import('../public/js/exercises/random.js'),
      import('../public/js/exercises/generators.js'),
      import('../public/js/exercises/template.js'),
    ]);
    modules = { random, generators, template };
  }
  return modules;
}

// Rejoue la série d'une graine : mêmes questions, dans le même ordre.
async function rejouer(step, seed) {
  const { random, generators, template } = await moteur();
  return random.withSeed(seed, () =>
    step.template ? template.generateFromTemplate(step.template, step.count) : generators.generateSet(step.generator, step.count, step.params)
  );
}

// Ce qu'il faut taper pour avoir juste à une question donnée.
async function reponseAttendue(q) {
  const { generators } = await moteur();
  if (q.input.kind === 'poly') return generators.polyLatex(q.check.expected).replace(/\s/g, '');
  return String(q.check.expected);
}

// Joue une série complète. `repondre(question, index, bonneReponse)` décide de
// ce qu'on envoie — de quoi simuler un élève qui réussit comme un qui se
// trompe. Par défaut, tout juste.
async function jouerSerie(client, { chapterId, step, mode = 'parcours', repondre, start = '/progress/start', attempt = '/progress/attempt', startBody }) {
  const ouverture = await client.post(start, startBody || { chapterId, stepId: step.id, mode });
  assert.equal(ouverture.status, 200, `série refusée sur ${step.id} (${ouverture.body?.error || ouverture.status})`);

  const questions = await rejouer(step, ouverture.body.seed);
  const answers = [];
  for (const [i, q] of questions.entries()) {
    const bonne = await reponseAttendue(q);
    answers.push({ position: i + 1, given: repondre ? repondre(q, i, bonne) : bonne, durationS: 5 });
  }

  const resultat = await client.post(attempt, { sessionId: ouverture.body.sessionId, answers, durationS: 30 });
  return { ouverture: ouverture.body, questions, resultat };
}

// Réussit une série de bout en bout, en vérifiant qu'elle est bien acceptée.
async function reussirSerie(client, options) {
  const { resultat } = await jouerSerie(client, options);
  assert.equal(resultat.status, 200, `correction refusée (${resultat.body?.error || resultat.status})`);
  return resultat.body;
}

// Termine un chapitre comme le ferait un élève : il ouvre chaque étape et
// réussit chaque série. Sert à débloquer la suite du parcours, qui est
// séquentiel — on ne peut pas sauter un chapitre.
async function completeChapter(client, chapterId) {
  const res = await client.get(`/chapters/${chapterId}`);
  assert.equal(res.status, 200, `chapitre ${chapterId} inaccessible`);
  for (const step of res.body.chapter.steps) {
    await client.post('/progress/visit', { chapterId, stepId: step.id });
    if (step.type === 'exercise') await reussirSerie(client, { chapterId, step });
  }
}

// Débloque le parcours jusqu'au chapitre visé, en terminant tous ceux d'avant.
async function unlockUpTo(client, levelId, chapterId) {
  const { body } = await client.get(`/levels/${levelId}`);
  for (const ch of body.chapters) {
    if (ch.id === chapterId) return;
    if (ch.status === 'published') await completeChapter(client, ch.id);
  }
  throw new Error(`chapitre ${chapterId} absent du niveau ${levelId}`);
}

module.exports = { makeClient, login, completeChapter, unlockUpTo, jouerSerie, reussirSerie, rejouer, reponseAttendue };
