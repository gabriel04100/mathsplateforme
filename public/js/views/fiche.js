// Fiche d'exercices à imprimer, avec son corrigé.
//
// Les générateurs produisent des questions différentes à chaque tirage : une
// fiche par élève, ou un sujet A et un sujet B, ne coûtent donc rien de plus
// qu'un clic. Tout se fait dans le navigateur — le serveur ne voit rien passer.
import { api } from '../api.js';
import { getCatalog } from '../app.js';
import { esc, renderMath, toast } from '../ui.js';
import { generateSet, expectedMath } from '../exercises/generators.js';
import { generateFromTemplate } from '../exercises/template.js';

const LEVELS = ['6e', '5e', '4e', '3e'];

export async function teacherFicheView({ el, query }) {
  const [levels, mesExercices] = await Promise.all([
    getCatalog(),
    api.get('/teacher/exercises').then((r) => r.exercises).catch(() => []),
  ]);

  let level = LEVELS.includes(query.get('niveau')) ? query.get('niveau') : LEVELS[0];
  let choix = []; // les exercices cochés
  let nbQuestions = 10;
  let nbFiches = 1;
  let corrige = true;
  let titre = '';

  // Tous les exercices disponibles pour le niveau : ceux des chapitres, puis
  // ceux que l'enseignant a écrits lui-même.
  function sources() {
    const out = [];
    for (const ch of levels.find((l) => l.id === level)?.chapters || []) {
      if (ch.status !== 'published') continue;
      for (const s of ch.steps.filter((x) => x.type === 'exercise')) {
        out.push({ key: `ch:${ch.id}:${s.id}`, groupe: ch.title, titre: s.title });
      }
    }
    for (const e of mesExercices.filter((x) => x.level === level)) {
      out.push({ key: `ex:${e.id}`, groupe: 'Mes exercices', titre: e.title });
    }
    return out;
  }

  // Produit les questions d'une fiche, en piochant dans les exercices cochés.
  async function tirer(nb) {
    const choisis = sources().filter((s) => choix.includes(s.key));
    if (!choisis.length) throw new Error('Coche au moins un exercice.');
    const paquets = [];
    for (const s of choisis) {
      if (s.key.startsWith('ex:')) {
        const id = s.key.slice(3);
        const { exercise } = await api.get(`/custom-exercises/${id}`);
        paquets.push(() => generateFromTemplate(exercise.template, 1)[0]);
      } else {
        const [, chapterId, stepId] = s.key.split(':');
        const { chapter } = await api.get(`/chapters/${chapterId}`);
        const step = chapter.steps.find((x) => x.id === stepId);
        paquets.push(() => (step.template ? generateFromTemplate(step.template, 1)[0] : generateSet(step.generator, 1, step.params)[0]));
      }
    }
    // On alterne entre les exercices cochés pour mélanger les types.
    const questions = [];
    const vues = new Set();
    for (let i = 0; questions.length < nb && i < nb * 30; i++) {
      const q = paquets[i % paquets.length]();
      const cle = q.key || q.prompt;
      if (vues.has(cle)) continue;
      vues.add(cle);
      questions.push(q);
    }
    return questions;
  }

  function draw() {
    const dispo = sources();
    const parGroupe = dispo.reduce((m, s) => ((m[s.groupe] ||= []).push(s), m), {});

    el.innerHTML = `
    <section class="page wide lv-${level}">
      <nav class="crumbs"><a href="/prof" data-link>Mes classes</a> <span aria-hidden="true">/</span> Fiche d’exercices</nav>
      <header class="page-head">
        <h1>Fiche d’exercices</h1>
        <p class="muted">Choisis des exercices, la plateforme tire les questions au sort et prépare une feuille à imprimer, corrigé compris. Chaque fiche est différente : de quoi faire un devoir par élève.</p>
      </header>

      <div class="seg" role="tablist" aria-label="Niveau">
        ${LEVELS.map((l) => `<button type="button" role="tab" class="seg-btn lv-${l}" aria-selected="${l === level}" data-level="${l}">${l}</button>`).join('')}
      </div>

      <div class="fiche-layout">
        <form class="panel" id="fiche-form" novalidate>
          <fieldset class="field">
            <legend>Exercices à tirer</legend>
            ${
              dispo.length
                ? Object.entries(parGroupe)
                    .map(
                      ([groupe, items]) => `<div class="src-group">
                        <p class="src-title">${esc(groupe)}</p>
                        ${items
                          .map(
                            (s) => `<label class="check"><input type="checkbox" value="${esc(s.key)}"${choix.includes(s.key) ? ' checked' : ''}>
                              <span>${esc(s.titre)}</span></label>`
                          )
                          .join('')}
                      </div>`
                    )
                    .join('')
                : '<p class="muted">Aucun exercice publié pour ce niveau.</p>'
            }
          </fieldset>

          <label class="field"><span>Titre de la fiche <span class="muted">(facultatif)</span></span>
            <input name="titre" maxlength="80" placeholder="ex. Devoir maison n°3" value="${esc(titre)}"></label>

          <div class="field-row">
            <label class="field"><span>Questions par fiche</span>
              <input name="nb" type="number" min="1" max="40" value="${nbQuestions}"></label>
            <label class="field"><span>Nombre de fiches</span>
              <input name="fiches" type="number" min="1" max="40" value="${nbFiches}"></label>
          </div>
          <p class="muted small">Plusieurs fiches = autant de sujets différents, numérotés. Pratique pour éviter les copies entre voisins.</p>

          <label class="check"><input type="checkbox" name="corrige" ${corrige ? 'checked' : ''}><span>Imprimer le corrigé à la suite</span></label>

          <p class="form-error" role="alert" hidden></p>
          <div class="w-actions">
            <button class="btn" type="submit">Prévisualiser</button>
            <button class="btn ghost" type="button" data-print disabled>Imprimer</button>
          </div>
        </form>

        <div class="fiche-preview" id="apercu">
          <p class="muted">L’aperçu apparaîtra ici.</p>
        </div>
      </div>
    </section>`;

    const form = el.querySelector('#fiche-form');
    el.querySelectorAll('[data-level]').forEach(
      (b) =>
        (b.onclick = () => {
          level = b.dataset.level;
          choix = [];
          history.replaceState(null, '', `/prof/fiche?niveau=${level}`);
          draw();
        })
    );
    form.querySelectorAll('input[type="checkbox"][value]').forEach((c) =>
      c.addEventListener('change', () => {
        choix = [...form.querySelectorAll('input[type="checkbox"][value]:checked')].map((x) => x.value);
      })
    );

    form.onsubmit = async (e) => {
      e.preventDefault();
      const err = form.querySelector('.form-error');
      err.hidden = true;
      titre = form.titre.value.trim();
      nbQuestions = Math.min(40, Math.max(1, Number(form.nb.value) || 10));
      nbFiches = Math.min(40, Math.max(1, Number(form.fiches.value) || 1));
      corrige = form.corrige.checked;
      try {
        const fiches = [];
        for (let i = 0; i < nbFiches; i++) fiches.push(await tirer(nbQuestions));
        rendre(fiches);
        el.querySelector('[data-print]').disabled = false;
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        toast(ex.message, 'error');
      }
    };

    el.querySelector('[data-print]').onclick = () => window.print();
  }

  // Construit l'aperçu à l'écran ET la feuille destinée à l'imprimante.
  function rendre(fiches) {
    const entete = (i) =>
      `<header class="fi-head">
        <p class="fi-title">${esc(titre || 'Fiche d’exercices')}${fiches.length > 1 ? ` — sujet ${String.fromCharCode(65 + i)}` : ''}</p>
        <p class="fi-meta">Nom : <span class="fi-line"></span> Classe : <span class="fi-line short"></span></p>
      </header>`;

    const questionsHtml = (qs) =>
      `<ol class="fi-questions">${qs
        .map(
          (q) => `<li>
            <div class="fi-prompt">${q.prompt}</div>
            ${
              q.input.kind === 'choice'
                ? `<ul class="fi-choices">${q.input.options.map((o) => `<li>${o}</li>`).join('')}</ul>`
                : '<div class="fi-answer"></div>'
            }
          </li>`
        )
        .join('')}</ol>`;

    const corrigeHtml = (qs, i) =>
      `<section class="fi-sheet fi-corrige">
        <header class="fi-head"><p class="fi-title">Corrigé${fiches.length > 1 ? ` — sujet ${String.fromCharCode(65 + i)}` : ''}</p></header>
        <ol class="fi-questions">${qs
          .map(
            (q) => `<li>
              <div class="fi-prompt">${q.prompt}</div>
              <p class="fi-sol"><strong>Réponse :</strong> ${
                q.input.kind === 'choice' ? q.input.options[q.check.expected] : expectedMath(q)
              }</p>
              ${q.solution ? `<div class="fi-detail">${q.solution}</div>` : ''}
            </li>`
          )
          .join('')}</ol>
      </section>`;

    const html = fiches
      .map((qs, i) => `<section class="fi-sheet">${entete(i)}${questionsHtml(qs)}</section>${corrige ? corrigeHtml(qs, i) : ''}`)
      .join('');

    const apercu = el.querySelector('#apercu');
    apercu.innerHTML = `<p class="muted small">${fiches.length} fiche${fiches.length > 1 ? 's' : ''} · ${fiches[0].length} questions${
      corrige ? ' · corrigé inclus' : ''
    }</p>${html}`;
    renderMath(apercu);

    // La feuille d'impression vit hors de la page : seule elle est imprimée.
    let sheet = document.querySelector('.print-sheet');
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.className = 'print-sheet';
      document.body.append(sheet);
    }
    sheet.className = 'print-sheet fiches';
    sheet.innerHTML = html;
    renderMath(sheet);
  }

  draw();

  // La feuille d'impression est partagée avec les fiches d'identifiants :
  // on la vide en quittant pour ne pas imprimer une fiche périmée.
  return () => {
    const sheet = document.querySelector('.print-sheet');
    if (sheet) {
      sheet.innerHTML = '';
      sheet.className = 'print-sheet';
    }
  };
}
