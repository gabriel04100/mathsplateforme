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

// Termine un chapitre comme le ferait un élève : il ouvre chaque étape et
// réussit chaque série. Sert à débloquer la suite du parcours, qui est
// séquentiel — on ne peut pas sauter un chapitre.
async function completeChapter(client, chapterId) {
  const res = await client.get(`/chapters/${chapterId}`);
  assert.equal(res.status, 200, `chapitre ${chapterId} inaccessible`);
  for (const step of res.body.chapter.steps) {
    await client.post('/progress/visit', { chapterId, stepId: step.id });
    if (step.type === 'exercise') {
      const r = await client.post('/progress/attempt', { chapterId, stepId: step.id, score: step.count, total: step.count, durationS: 30 });
      assert.equal(r.status, 200, `série refusée sur ${chapterId}/${step.id}`);
    }
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

module.exports = { makeClient, login, completeChapter, unlockUpTo };
