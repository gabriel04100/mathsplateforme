// Tableau de bord élève : reprendre là où on s'était arrêté, avancement par niveau, activité récente.
import { api } from '../api.js';
import { state } from '../app.js';
import { esc, relativeTime, STEP_KIND, stepIcon, progressBar } from '../ui.js';
import { monterRevisionFlash } from './revision.js';

const stepUrl = (p) => (p.mode === 'libre' ? `/libre/${p.chapterId}/${p.stepId}` : `/chapitre/${p.chapterId}/${p.stepId}`);

export async function dashboardView({ el }) {
  const d = await api.get('/dashboard');
  const firstName = esc(state.user.displayName.split(' ')[0]);
  const last = d.lastPosition;
  const next = d.next;

  let resume;
  if (last) {
    resume = `
      <div class="resume lv-${last.levelId}">
        <p class="resume-kicker">Tu t'étais arrêté ${relativeTime(last.updatedAt)} ici :</p>
        <h2><span class="hl">${esc(last.chapterTitle)}</span></h2>
        <p class="resume-step">${stepIcon(last.stepType)} ${STEP_KIND[last.stepType]} : ${esc(last.stepTitle)}${last.mode === 'libre' ? ' <span class="tag">exercice libre</span>' : ''}</p>
        <a class="btn big" href="${stepUrl(last)}" data-link>Reprendre</a>
      </div>`;
  } else if (next) {
    resume = `
      <div class="resume lv-${next.levelId}">
        <p class="resume-kicker">Ton parcours commence ici :</p>
        <h2><span class="hl">${esc(next.chapterTitle)}</span></h2>
        <p class="resume-step">${stepIcon(next.stepType)} ${STEP_KIND[next.stepType]} : ${esc(next.stepTitle)}</p>
        <a class="btn big" href="/chapitre/${next.chapterId}/${next.stepId}" data-link>Commencer</a>
      </div>`;
  } else {
    resume = `<div class="resume"><h2>Bravo, tout le parcours de ${esc(d.homeLevel)} est terminé !</h2><p>Entraîne-toi avec les <a href="/exercices" data-link>exercices libres</a>.</p></div>`;
  }

  const showNext = next && last && !(next.chapterId === last.chapterId && next.stepId === last.stepId);

  el.innerHTML = `
  <section class="page">
    <header class="page-head">
      <h1>Bonjour ${firstName}</h1>
      <p class="muted">${d.className ? `Classe ${esc(d.className)}` : ''}</p>
    </header>
    <div id="revision-flash"></div>
    <div class="dash-grid">
      <div class="dash-main">
        ${resume}
        ${showNext ? `
        <div class="next-up">
          <p>Prochaine étape de ton parcours de ${esc(d.homeLevel)} :</p>
          <a href="/chapitre/${next.chapterId}/${next.stepId}" data-link class="next-link">${stepIcon(next.stepType)}<span><strong>${esc(next.chapterTitle)}</strong><br>${STEP_KIND[next.stepType]} : ${esc(next.stepTitle)}</span></a>
        </div>` : ''}
        <h2 class="section-title">Mon avancement</h2>
        <ul class="level-progress">
          ${d.levels
            .map((l) => {
              const pct = l.chaptersTotal ? Math.round((100 * l.chaptersDone) / l.chaptersTotal) : 0;
              return `<li class="lv-${l.id}${l.id === d.homeLevel ? ' home' : ''}">
                <a href="/niveau/${l.id}" data-link class="lp-tab">${l.label}</a>
                <div class="lp-body">
                  ${progressBar(pct, l.id)}
                  <span class="lp-txt">${l.chaptersDone} chapitre${l.chaptersDone > 1 ? 's' : ''} terminé${l.chaptersDone > 1 ? 's' : ''} sur ${l.chaptersTotal}${l.chaptersStarted ? `, ${l.chaptersStarted} en cours` : ''}</span>
                </div>
              </li>`;
            })
            .join('')}
        </ul>
      </div>
      <aside class="dash-side">
        <h2 class="section-title">Dernières réponses</h2>
        ${
          d.recent.length
            ? `<ol class="recent">${d.recent
                .map(
                  (r) => `<li>
                    <span class="score ${r.score / r.total >= 0.75 ? 'good' : r.score / r.total >= 0.5 ? 'mid' : 'low'}">${r.score}/${r.total}</span>
                    <span><strong>${esc(r.stepTitle)}</strong><br><span class="muted">${esc(r.chapterTitle)}, ${relativeTime(r.at)}</span></span>
                  </li>`
                )
                .join('')}</ol>`
            : '<p class="muted">Tes scores apparaîtront ici après ton premier exercice.</p>'
        }
      </aside>
    </div>
  </section>`;

  // Proposition de révision, après l'affichage : elle ne doit jamais retarder
  // le tableau de bord, et son absence ne change rien à la page.
  monterRevisionFlash(el.querySelector('#revision-flash')).catch(() => {});
}
