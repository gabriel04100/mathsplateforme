// Exercices libres : tous les exercices, accessibles à tout moment, hors de l'ordre du parcours.
// On y trouve aussi les exercices écrits par le professeur de la classe.
import { api } from '../api.js';
import { getCatalog } from '../app.js';
import { esc } from '../ui.js';

export async function freeExercisesView({ el, query }) {
  const [levels, custom] = await Promise.all([
    getCatalog(),
    api.get('/custom-exercises').then((r) => r.exercises).catch(() => []),
  ]);
  let active = query.get('niveau') || levels[0].id;
  if (!levels.some((l) => l.id === active)) active = levels[0].id;

  function draw() {
    const level = levels.find((l) => l.id === active);
    const chapters = level.chapters.filter((c) => c.status === 'published' && c.steps.some((s) => s.type === 'exercise'));
    const mine = custom.filter((e) => e.level === active);
    el.innerHTML = `
    <section class="page lv-${active}">
      <header class="page-head">
        <h1>Exercices libres</h1>
        <p class="muted">Entraîne-toi sur n'importe quel exercice, dans l'ordre que tu veux. Les questions changent à chaque série.</p>
      </header>
      <div class="seg" role="tablist" aria-label="Niveau">
        ${levels.map((l) => `<button type="button" role="tab" class="seg-btn lv-${l.id}" aria-selected="${l.id === active}" data-l="${l.id}">${l.label}</button>`).join('')}
      </div>
      ${
        mine.length
          ? `<div class="free-list from-teacher">
              <section class="free-ch teacher-ch">
                <h2>Les exercices de ton professeur</h2>
                <ul>${mine
                  .map(
                    (e) => `<li><a href="/exercice/${e.id}" data-link class="free-ex">
                      <span>${esc(e.title)}</span><span class="muted">${e.count} questions</span></a></li>`
                  )
                  .join('')}</ul>
              </section>
            </div>`
          : ''
      }
      <div class="free-list">
        ${
          chapters.length
            ? chapters
                .map(
                  (c) => `<section class="free-ch">
              <h2>${esc(c.title)}</h2>
              <ul>${c.steps
                .filter((s) => s.type === 'exercise')
                .map((s) => `<li><a href="/libre/${c.id}/${s.id}" data-link class="free-ex"><span>${esc(s.title)}</span><span class="muted">${s.count} questions</span></a></li>`)
                .join('')}</ul>
            </section>`
                )
                .join('')
            : mine.length
              ? ''
              : '<p class="muted">Aucun exercice disponible pour ce niveau pour le moment.</p>'
        }
      </div>
    </section>`;
    el.querySelectorAll('[data-l]').forEach(
      (b) =>
        (b.onclick = () => {
          active = b.dataset.l;
          history.replaceState(null, '', `/exercices?niveau=${active}`);
          draw();
        })
    );
  }
  draw();
}
