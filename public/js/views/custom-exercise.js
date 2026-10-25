// Un exercice écrit par le professeur, joué par l'élève.
// Le déroulé est celui des exercices de chapitre (runExercise) ; seules
// l'adresse d'enregistrement du score et la navigation de retour changent.
import { api } from '../api.js';
import { state, markLevelTab } from '../app.js';
import { esc } from '../ui.js';
import { runExercise } from './chapter.js';

export async function customExerciseView({ el, params: [id] }) {
  const { exercise, level, draft } = await api.get(`/custom-exercises/${id}`);
  const isTeacher = state.user.role === 'teacher';
  markLevelTab(level);

  el.innerHTML = `
    <section class="page lv-${level}">
      <nav class="crumbs">
        ${isTeacher ? '<a href="/prof/exercices" data-link>Mes exercices</a>' : '<a href="/exercices" data-link>Exercices libres</a>'}
        <span aria-hidden="true">/</span> ${esc(exercise.title)}
      </nav>
      ${draft ? '<p class="notice small">Brouillon : seul toi peux l’ouvrir, et les scores ne sont pas enregistrés.</p>' : ''}
      <div class="step-pane libre" id="pane"></div>
    </section>`;

  const pane = el.querySelector('#pane');
  const backHtml = () =>
    `<div class="pane-nav">${
      isTeacher
        ? `<a class="btn ghost" href="/prof/exercices/${id}" data-link>Modifier cet exercice</a>`
        : '<a class="btn ghost" href="/exercices" data-link>Retour aux exercices libres</a>'
    }</div>`;

  const cleanup = runExercise(pane, null, exercise, 'libre', {
    onFinish: () => {},
    navHtml: backHtml,
    bindNav: () => {},
    openSeries: () => api.post(`/custom-exercises/${id}/start`, {}),
    sendAnswers: (payload) => api.post('/custom-exercises/attempt', payload),
  });

  return cleanup;
}
