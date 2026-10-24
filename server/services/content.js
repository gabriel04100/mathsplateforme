// Contenu pédagogique : chargé depuis /content (JSON), validé et mis en cache au démarrage.
// Le contenu est séparé du code : ajouter un chapitre = ajouter un fichier JSON.
// Plus tard, ce module pourra lire une base ou un CMS sans changer son interface.
const fs = require('node:fs');
const path = require('node:path');

const STEP_TYPES = new Set(['lesson', 'animation', 'exercise']);

class ContentError extends Error {}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new ContentError(`${path.basename(file)} : JSON invalide (${e.message})`);
  }
}

function validateChapter(ch, file, levelIds) {
  const where = path.relative(process.cwd(), file);
  const fail = (msg) => {
    throw new ContentError(`${where} : ${msg}`);
  };
  if (!ch.id || !/^[a-z0-9-]+$/.test(ch.id)) fail('"id" manquant ou invalide (minuscules, chiffres, tirets)');
  if (!levelIds.has(ch.level)) fail(`niveau inconnu "${ch.level}"`);
  if (!Number.isInteger(ch.order)) fail('"order" doit être un entier');
  if (!ch.title) fail('"title" manquant');
  if (!['published', 'draft'].includes(ch.status || 'published')) fail('"status" doit valoir published ou draft');
  if (!Array.isArray(ch.steps)) fail('"steps" doit être un tableau');
  const seen = new Set();
  for (const s of ch.steps) {
    if (!s.id || seen.has(s.id)) fail(`étape sans id ou id en double (${s.id})`);
    seen.add(s.id);
    if (!STEP_TYPES.has(s.type)) fail(`étape ${s.id} : type "${s.type}" inconnu`);
    if (s.type === 'exercise') {
      if (!s.generator) fail(`étape ${s.id} : "generator" manquant`);
      if (!Number.isInteger(s.count) || s.count < 1) fail(`étape ${s.id} : "count" invalide`);
      if (!Number.isInteger(s.pass) || s.pass < 1 || s.pass > s.count) fail(`étape ${s.id} : "pass" doit être entre 1 et count`);
    }
    if (s.type === 'animation' && !s.widget) fail(`étape ${s.id} : "widget" manquant`);
    if (s.type === 'lesson' && !Array.isArray(s.blocks)) fail(`étape ${s.id} : "blocks" manquant`);
  }
  if ((ch.status || 'published') === 'published' && !ch.steps.length) fail('un chapitre publié doit avoir au moins une étape');
}

function loadContent(contentDir) {
  const levels = readJson(path.join(contentDir, 'levels.json'));
  const levelIds = new Set(levels.map((l) => l.id));
  const chapters = new Map();
  const byLevel = new Map(levels.map((l) => [l.id, []]));

  for (const level of levels) {
    const dir = path.join(contentDir, 'chapters', level.id);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      const file = path.join(dir, f);
      const data = readJson(file);
      // Un fichier contient un chapitre, ou un tableau de chapitres (pratique pour les brouillons à venir).
      for (const ch of Array.isArray(data) ? data : [data]) {
        validateChapter(ch, file, levelIds);
        if (ch.level !== level.id) throw new ContentError(`${f} : rangé dans ${level.id} mais déclare "${ch.level}"`);
        if (chapters.has(ch.id)) throw new ContentError(`id de chapitre en double : ${ch.id}`);
        ch.status = ch.status || 'published';
        chapters.set(ch.id, ch);
        byLevel.get(level.id).push(ch);
      }
    }
  }
  for (const list of byLevel.values()) list.sort((a, b) => a.order - b.order);
  return { levels, chapters, byLevel };
}

function createContentService(contentDir) {
  let store = loadContent(contentDir);

  const summarizeStep = (s) => ({ id: s.id, type: s.type, title: s.title, ...(s.type === 'exercise' ? { count: s.count, pass: s.pass } : {}) });
  const summarizeChapter = (ch) => ({
    id: ch.id,
    level: ch.level,
    order: ch.order,
    title: ch.title,
    theme: ch.theme || null,
    summary: ch.summary || '',
    status: ch.status,
    steps: ch.steps.map(summarizeStep),
  });

  return {
    reload() {
      store = loadContent(contentDir);
    },
    levels: () => store.levels,
    level: (id) => store.levels.find((l) => l.id === id),
    chaptersOfLevel: (levelId) => store.byLevel.get(levelId) || [],
    publishedChaptersOfLevel: (levelId) => (store.byLevel.get(levelId) || []).filter((c) => c.status === 'published'),
    chapter: (id) => store.chapters.get(id),
    step: (chapterId, stepId) => store.chapters.get(chapterId)?.steps.find((s) => s.id === stepId),
    summarizeChapter,
    catalog: () =>
      store.levels.map((l) => ({ ...l, chapters: (store.byLevel.get(l.id) || []).map(summarizeChapter) })),
    stats: () => ({
      levels: store.levels.length,
      chapters: store.chapters.size,
      published: [...store.chapters.values()].filter((c) => c.status === 'published').length,
    }),
  };
}

module.exports = { createContentService, loadContent, ContentError };
