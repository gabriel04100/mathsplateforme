// « Où ça coince » : pour un chapitre et une classe, ce que les élèves ratent.
//
// Le tableau de suivi dit qui a réussi ; cet écran dit sur quoi ça bloque, et
// surtout ce que les élèves répondent à la place. Une classe qui écrit « -x+7 »
// pour « -(x+7) » n'a pas un problème de calcul : elle a un problème de signe,
// et c'est l'heure de cours du lendemain qui change.
import { api } from '../api.js';
import { esc } from '../ui.js';

export async function teacherDiagnosticView({ el, params: [classId, chapterId] }) {
  const [{ classes }, data] = await Promise.all([
    api.get('/teacher/classes'),
    api.get(`/teacher/classes/${classId}/diagnostic/${encodeURIComponent(chapterId)}`),
  ]);
  const classe = classes.find((c) => c.id === Number(classId));

  // Couleur de la pastille : on s'alarme en dessous de 60 %, on respire au-dessus de 80 %.
  const ton = (p) => (p === null ? '' : p >= 80 ? 'ok' : p >= 60 ? 'moyen' : 'faible');

  el.innerHTML = `
  <section class="page wide">
    <nav class="crumbs">
      <a href="/prof" data-link>Mes classes</a> <span aria-hidden="true">/</span>
      <a href="/prof/classe/${classId}" data-link>${esc(classe?.name || 'la classe')}</a>
      <span aria-hidden="true">/</span> Où ça coince
    </nav>
    <header class="page-head">
      <h1>${esc(data.chapterTitle)}</h1>
      <p class="muted">Ce que ${data.eleves} élève${data.eleves > 1 ? 's' : ''} de ${esc(classe?.name || '')} ont réellement répondu.</p>
    </header>

    ${
      data.assezDeDonnees
        ? ''
        : `<p class="notice small">Encore peu de réponses sur ce chapitre : les pourcentages ci-dessous bougeront beaucoup. Attends une dizaine de séries avant d’en tirer des conclusions.</p>`
    }

    <h2 class="section-title">Réussite par exercice</h2>
    ${
      data.steps.length
        ? `<div class="table-wrap"><table class="list">
            <thead><tr><th>Exercice</th><th>Réussite</th><th>Questions posées</th><th>Élèves</th><th>Temps moyen</th></tr></thead>
            <tbody>${data.steps
              .map(
                (s) => `<tr>
                  <td><strong>${esc(s.title)}</strong></td>
                  <td>${
                    s.reussite === null
                      ? '<span class="muted">pas encore fait</span>'
                      : `<span class="score-pill ${ton(s.reussite)}">${s.reussite} %</span>`
                  }</td>
                  <td>${s.questionsPosees || '<span class="muted">—</span>'}</td>
                  <td>${s.elevesConcernes || '<span class="muted">—</span>'}</td>
                  <td>${s.tempsMoyen ? `${s.tempsMoyen} s` : '<span class="muted">—</span>'}</td>
                </tr>`
              )
              .join('')}</tbody></table></div>`
        : '<p class="empty">Ce chapitre ne contient pas d’exercices.</p>'
    }

    <h2 class="section-title">Les erreurs qui reviennent</h2>
    ${
      data.erreurs.length
        ? `<ul class="mistakes">${data.erreurs
            .map(
              (m) => `<li class="mistake">
                <div class="mi-head">
                  <span class="mi-count">${m.eleves} élève${m.eleves > 1 ? 's' : ''}</span>
                  <span class="muted small">${esc(m.stepTitle)}${m.fois > m.eleves ? ` · ${m.fois} fois en tout` : ''}</span>
                </div>
                <p class="mi-prompt">${esc(m.prompt)}</p>
                <p class="mi-answers">
                  <span class="mi-given">a répondu <code>${esc(m.given)}</code></span>
                  <span class="mi-expected">au lieu de <code>${esc(m.expected)}</code></span>
                </p>
              </li>`
            )
            .join('')}</ul>`
        : `<p class="empty">Aucune erreur enregistrée pour l’instant${
            data.assezDeDonnees ? ' : la classe maîtrise ce chapitre.' : '. Les erreurs apparaîtront au fil des séries.'
          }</p>`
    }
    <p class="muted small">Les erreurs sont regroupées par réponse donnée, et classées par nombre d’élèves concernés : ce qui arrive en tête est l’erreur partagée par la classe, pas l’étourderie d’un seul.</p>
  </section>`;
}
