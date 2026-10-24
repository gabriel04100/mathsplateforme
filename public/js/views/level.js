// Onglet d'un niveau : le parcours, chapitre après chapitre.
import { api } from '../api.js';
import { state } from '../app.js';
import { esc, STATUS_LABEL, stepIcon, progressBar } from '../ui.js';

export async function levelView({ el, params: [levelId] }) {
  const { level, chapters, progress } = await api.get(`/levels/${levelId}`);
  const byId = new Map(progress.map((p) => [p.chapterId, p]));
  const isTeacher = state.user.role === 'teacher';
  let n = 0;

  const items = chapters
    .map((ch) => {
      const p = byId.get(ch.id) || {};
      const draft = ch.status === 'draft';
      const locked = !draft && !p.unlocked && !isTeacher;
      const status = draft ? 'draft' : locked ? 'locked' : p.status;
      const num = draft ? '' : ++n;
      const stepDots = ch.steps
        .map((s) => {
          const ps = p.steps?.find((x) => x.id === s.id);
          return `<span class="dot${ps?.done ? ' done' : ''}" title="${esc(s.title)}">${stepIcon(s.type)}</span>`;
        })
        .join('');
      const inner = `
        <span class="node" aria-hidden="true">${status === 'done' ? '✓' : num}</span>
        <span class="ch-body">
          <span class="ch-title">${esc(ch.title)}</span>
          ${ch.summary ? `<span class="ch-summary">${esc(ch.summary)}</span>` : ''}
          ${!draft ? `<span class="ch-meta">${stepDots}${!locked ? progressBar(p.percent || 0, levelId) : ''}</span>` : ''}
        </span>
        <span class="status s-${status}">${STATUS_LABEL[status]}</span>`;
      return `<li class="ch s-${status}">${draft || locked ? `<div class="ch-row" aria-disabled="true">${inner}</div>` : `<a class="ch-row" href="/chapitre/${ch.id}" data-link>${inner}</a>`}</li>`;
    })
    .join('');

  const published = chapters.filter((c) => c.status === 'published').length;
  el.innerHTML = `
  <section class="page lv-${level.id}">
    <header class="page-head level-head">
      <h1>${esc(level.title)}</h1>
      <p class="muted">${esc(level.cycle)}. ${published} chapitre${published > 1 ? 's' : ''} disponible${published > 1 ? 's' : ''} sur ${chapters.length}. ${level.sequential !== false && !isTeacher ? 'Termine un chapitre pour débloquer le suivant.' : ''}</p>
    </header>
    <ol class="path">${items}</ol>
  </section>`;
}
