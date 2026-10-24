// Espace enseignant : écrire ses propres exercices sans toucher au code.
// Un exercice est un MODÈLE — des variables tirées au sort et des formules —
// pour que les questions changent à chaque série, comme les exercices intégrés.
// L'aperçu à droite joue le modèle en direct, avec le même moteur que les élèves.
import { api } from '../api.js';
import { navigate } from '../app.js';
import { esc, renderMath, relativeTime, toast } from '../ui.js';
import { validateDefinition, buildQuestion } from '../exercises/template.js';

const LEVELS = ['6e', '5e', '4e', '3e'];

// Rappel de la mise en forme disponible, identique à celle des cours.
const formatHelp = () => `<details class="format-help">
  <summary>Mise en forme disponible</summary>
  <ul>
    <li><code>$...$</code> pour une formule : <code>$\\dfrac{3}{4}$</code>, <code>$x^2$</code>, <code>$-(x+1)$</code></li>
    <li><code>**gras**</code>, <code>*italique*</code>, <code>\`code\`</code></li>
    <li>une ligne qui commence par <code>- </code> fait une puce, par <code>1. </code> une liste numérotée</li>
    <li>une ligne vide sépare deux paragraphes</li>
    <li><code>[[ ]]</code> calcule : <code>[[a*b]]</code>, <code>[[a+1]]</code></li>
  </ul>
</details>`;

const emptyModel = () => ({
  title: '',
  level: '6e',
  classId: null,
  instructions: '',
  count: 6,
  pass: 5,
  status: 'draft',
  definition: {
    variables: [{ name: 'a', type: 'entier', min: 2, max: 9 }, { name: 'b', type: 'entier', min: 2, max: 9 }],
    constraints: [],
    prompt: 'Combien font $[[a]] \\times [[b]]$ ?',
    answer: { kind: 'number', formula: 'a*b', tolerance: '', unit: '' },
    solution: '$[[a]] \\times [[b]] = [[a*b]]$',
  },
});

// ---------- Liste des exercices ----------

export async function teacherExercisesView({ el, query }) {
  const archived = query?.get('archives') === '1';
  const { exercises } = await api.get(`/teacher/exercises${archived ? '?archives=1' : ''}`);

  el.innerHTML = `
  <section class="page wide">
    <nav class="crumbs"><a href="/prof" data-link>Mes classes</a> <span aria-hidden="true">/</span> Mes exercices</nav>
    <header class="page-head row">
      <div>
        <h1>Mes exercices</h1>
        <p class="muted">Écris tes propres exercices : tu décris les nombres qui changent, la plateforme génère des questions différentes à chaque série.</p>
      </div>
      <a class="btn" href="/prof/exercices/nouveau" data-link>Nouvel exercice</a>
    </header>
    <div class="seg small" role="tablist">
      <button type="button" role="tab" class="seg-btn" aria-selected="${!archived}" data-arch="0">En cours</button>
      <button type="button" role="tab" class="seg-btn" aria-selected="${archived}" data-arch="1">Archives</button>
    </div>
    ${
      exercises.length
        ? `<div class="table-wrap"><table class="list">
            <thead><tr><th>Exercice</th><th>Niveau</th><th>Pour</th><th>Série</th><th>État</th><th>Modifié</th><th><span class="sr">Actions</span></th></tr></thead>
            <tbody>${exercises
              .map(
                (e) => `<tr data-id="${e.id}">
                  <td><strong>${esc(e.title)}</strong>${e.instructions ? `<span class="muted small">${esc(e.instructions)}</span>` : ''}</td>
                  <td><span class="lvtag lv-${e.level}">${esc(e.level)}</span></td>
                  <td>${e.className ? esc(e.className) : '<span class="muted">toutes mes classes</span>'}</td>
                  <td>${e.count} questions<span class="muted small">${e.pass} pour valider</span></td>
                  <td><span class="tag ${e.status === 'published' ? 'ok' : ''}">${e.status === 'published' ? 'Publié' : 'Brouillon'}</span></td>
                  <td>${relativeTime(e.updatedAt)}</td>
                  <td class="actions">
                    <a class="linkbtn" href="/prof/exercices/${e.id}" data-link>Modifier</a>
                    <a class="linkbtn" href="/exercice/${e.id}" data-link>Essayer</a>
                    <button type="button" class="linkbtn" data-act="toggle">${e.status === 'published' ? 'Dépublier' : 'Publier'}</button>
                    <button type="button" class="linkbtn" data-act="archive">${archived ? 'Désarchiver' : 'Archiver'}</button>
                    <button type="button" class="linkbtn danger" data-act="del">Supprimer</button>
                  </td>
                </tr>`
              )
              .join('')}</tbody></table></div>`
        : `<div class="empty-cta">
            <p>${archived ? 'Aucun exercice archivé.' : "Tu n'as pas encore écrit d'exercice."}</p>
            ${archived ? '' : '<a class="btn" href="/prof/exercices/nouveau" data-link>Écrire mon premier exercice</a>'}
          </div>`
    }
  </section>`;

  el.querySelectorAll('[data-arch]').forEach(
    (b) => (b.onclick = () => navigate(`/prof/exercices${b.dataset.arch === '1' ? '?archives=1' : ''}`))
  );

  el.querySelectorAll('tr[data-id]').forEach((tr) => {
    const e = exercises.find((x) => x.id === Number(tr.dataset.id));
    tr.querySelectorAll('[data-act]').forEach(
      (b) =>
        (b.onclick = async () => {
          try {
            if (b.dataset.act === 'toggle') {
              await api.patch(`/teacher/exercises/${e.id}`, { status: e.status === 'published' ? 'draft' : 'published' });
              toast(e.status === 'published' ? 'Exercice repassé en brouillon.' : 'Exercice publié : tes élèves le voient.', 'success');
            } else if (b.dataset.act === 'archive') {
              await api.patch(`/teacher/exercises/${e.id}`, { archived: !archived });
              toast(archived ? 'Exercice remis en service.' : 'Exercice archivé : tes élèves ne le voient plus.', 'success');
            } else {
              if (!confirm(`Supprimer « ${e.title} » ? Les scores déjà enregistrés par les élèves seront conservés mais l'exercice disparaîtra.`)) return;
              await api.del(`/teacher/exercises/${e.id}`);
              toast('Exercice supprimé.');
            }
            teacherExercisesView({ el, query });
          } catch (ex) {
            toast(ex.message, 'error');
          }
        })
    );
  });
}

// ---------- Éditeur ----------

export async function teacherExerciseEditorView({ el, params: [id] }) {
  const isNew = !id;
  const [{ classes }, loaded] = await Promise.all([
    api.get('/teacher/classes'),
    isNew ? Promise.resolve(null) : api.get(`/teacher/exercises/${id}`),
  ]);
  const model = loaded ? { ...loaded.exercise } : emptyModel();
  // Les champs facultatifs peuvent manquer sur un exercice ancien : on complète.
  model.definition = { constraints: [], ...model.definition };
  model.definition.answer = { tolerance: '', unit: '', ...model.definition.answer };
  let dirty = false;

  el.innerHTML = `
  <section class="page wide">
    <nav class="crumbs"><a href="/prof" data-link>Mes classes</a> <span aria-hidden="true">/</span> <a href="/prof/exercices" data-link>Mes exercices</a> <span aria-hidden="true">/</span> ${isNew ? 'Nouvel exercice' : esc(model.title)}</nav>
    <header class="page-head row">
      <div><h1>${isNew ? 'Nouvel exercice' : 'Modifier l’exercice'}</h1>
      <p class="muted">Les valeurs entre <code>[[ ]]</code> sont calculées à chaque question. Les formules s’écrivent entre <code>$…$</code>.</p></div>
      <span class="tag ${model.status === 'published' ? 'ok' : ''}" data-status-tag>${model.status === 'published' ? 'Publié' : 'Brouillon'}</span>
    </header>

    <div class="editor-layout">
      <form class="editor-form" id="ex-form" novalidate>

        <fieldset class="panel">
          <legend>L’exercice</legend>
          <label class="field"><span>Titre</span><input name="title" maxlength="80" placeholder="ex. Tables de multiplication" value="${esc(model.title)}"></label>
          <div class="field-row">
            <label class="field"><span>Niveau</span><select name="level">${LEVELS.map((l) => `<option${l === model.level ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="field"><span>Pour</span><select name="classId">
              <option value="">Toutes mes classes de ce niveau</option>
              ${classes.map((c) => `<option value="${c.id}"${model.classId === c.id ? ' selected' : ''}>${esc(c.name)} (${esc(c.level)})</option>`).join('')}
            </select></label>
          </div>
          <label class="field"><span>Consigne <span class="muted">(facultatif)</span></span><input name="instructions" maxlength="300" placeholder="ex. Réponds sans calculatrice." value="${esc(model.instructions || '')}"></label>
          <div class="field-row">
            <label class="field"><span>Questions par série</span><input name="count" type="number" min="1" max="20" value="${model.count}"></label>
            <label class="field"><span>Bonnes réponses pour valider</span><input name="pass" type="number" min="1" max="20" value="${model.pass}"></label>
          </div>
        </fieldset>

        <fieldset class="panel">
          <legend>Les nombres qui changent</legend>
          <p class="muted small">Chaque variable est tirée au sort à chaque question. Utilise son nom entre <code>[[ ]]</code> dans l’énoncé.</p>
          <div class="table-wrap"><table class="sheet vars">
            <thead><tr><th>Nom</th><th>Type</th><th colspan="2">Valeurs possibles</th><th><span class="sr">Supprimer</span></th></tr></thead>
            <tbody data-vars></tbody>
          </table></div>
          <button type="button" class="linkbtn" data-add-var>+ Ajouter une variable</button>
        </fieldset>

        <fieldset class="panel">
          <legend>Conditions <span class="muted">(facultatif)</span></legend>
          <p class="muted small">Pour écarter les tirages qui ne conviennent pas. Exemples : <code>a &lt;&gt; b</code> (différents), <code>a &gt; b</code>, <code>est_entier(a/b)</code> (division juste).</p>
          <div data-constraints></div>
          <button type="button" class="linkbtn" data-add-constraint>+ Ajouter une condition</button>
        </fieldset>

        <fieldset class="panel">
          <legend>L’énoncé</legend>
          <label class="field"><span>Question posée à l’élève</span>
            <textarea name="prompt" rows="3" placeholder="Combien font $[[a]] \\times [[b]]$ ?">${esc(model.definition.prompt || '')}</textarea></label>
          ${formatHelp()}
        </fieldset>

        <fieldset class="panel">
          <legend>La réponse attendue</legend>
          <div class="seg small" role="tablist">
            ${[
              ['number', 'Un nombre'],
              ['expression', 'Une expression'],
              ['texte', 'Une réponse écrite'],
              ['choice', 'Un choix à cliquer'],
            ]
              .map(
                ([k, label]) =>
                  `<button type="button" role="tab" class="seg-btn" data-kind="${k}" aria-selected="${(model.definition.answer.kind || 'number') === k}">${label}</button>`
              )
              .join('')}
          </div>
          <div data-answer></div>
        </fieldset>

        <fieldset class="panel">
          <legend>La correction</legend>
          <p class="muted small">Montrée à l’élève après sa réponse. Les <code>[[ ]]</code> et la mise en forme y fonctionnent aussi.</p>
          <label class="field"><span>Explication</span>
            <textarea name="solution" rows="4" placeholder="$[[a]] \\times [[b]] = [[a*b]]$">${esc(model.definition.solution || '')}</textarea></label>
          ${formatHelp()}
        </fieldset>
      </form>

      <aside class="editor-preview">
        <div class="preview-sticky">
          <div class="prev-head">
            <h2>Aperçu</h2>
            <button type="button" class="linkbtn" data-reroll title="Tirer d’autres nombres">🎲 Autre tirage</button>
          </div>
          <ul class="sheet-errors" data-errors aria-live="polite" hidden></ul>
          <div class="prev-card" data-preview></div>
          <div class="prev-actions">
            <button type="button" class="btn" data-save>${model.status === 'published' ? 'Enregistrer' : 'Enregistrer le brouillon'}</button>
            <button type="button" class="btn ghost" data-publish>${model.status === 'published' ? 'Repasser en brouillon' : 'Publier aux élèves'}</button>
          </div>
          <p class="muted small" data-save-state></p>
        </div>
      </aside>
    </div>
  </section>`;

  const form = el.querySelector('#ex-form');
  const varsBody = el.querySelector('[data-vars]');
  const constraintsBox = el.querySelector('[data-constraints]');
  const answerBox = el.querySelector('[data-answer]');
  const errorsBox = el.querySelector('[data-errors]');
  const previewBox = el.querySelector('[data-preview]');
  const saveState = el.querySelector('[data-save-state]');

  // ---------- Variables ----------

  function varRowHtml(v, i) {
    const type = v.type || 'entier';
    const valueCells =
      type === 'liste'
        ? `<td colspan="2"><input data-v="${i}" data-f="values" placeholder="2 ; 5 ; 10 ; pomme" value="${esc((v.values || []).join(' ; '))}"></td>`
        : `<td><input data-v="${i}" data-f="min" type="number" placeholder="min" value="${v.min ?? ''}"></td>
           <td><input data-v="${i}" data-f="max" type="number" placeholder="max" value="${v.max ?? ''}"></td>`;
    return `<tr>
      <td><input data-v="${i}" data-f="name" maxlength="16" placeholder="a" value="${esc(v.name || '')}"></td>
      <td><select data-v="${i}" data-f="type">
        <option value="entier"${type === 'entier' ? ' selected' : ''}>Entier</option>
        <option value="decimal"${type === 'decimal' ? ' selected' : ''}>Décimal</option>
        <option value="liste"${type === 'liste' ? ' selected' : ''}>Liste</option>
      </select></td>
      ${valueCells}
      <td><button type="button" class="rowdel" data-del-var="${i}" title="Supprimer">✕</button></td>
    </tr>`;
  }

  function drawVars() {
    varsBody.innerHTML = model.definition.variables.map(varRowHtml).join('');
    varsBody.querySelectorAll('[data-v]').forEach((input) => {
      const i = Number(input.dataset.v);
      const f = input.dataset.f;
      const handler = () => {
        const v = model.definition.variables[i];
        if (f === 'values') v.values = input.value.split(/[;\n]/).map((s) => s.trim()).filter(Boolean).map((s) => (s !== '' && !Number.isNaN(Number(s)) ? Number(s) : s));
        else if (f === 'min' || f === 'max') v[f] = input.value === '' ? '' : Number(input.value);
        else v[f] = input.value;
        if (f === 'type') drawVars(); // les colonnes de valeurs changent
        touch();
      };
      input.addEventListener(f === 'type' ? 'change' : 'input', handler);
    });
    varsBody.querySelectorAll('[data-del-var]').forEach(
      (b) =>
        (b.onclick = () => {
          model.definition.variables.splice(Number(b.dataset.delVar), 1);
          drawVars();
          touch();
        })
    );
  }

  el.querySelector('[data-add-var]').onclick = () => {
    const used = new Set(model.definition.variables.map((v) => v.name));
    const name = 'abcdefghijkmnp'.split('').find((c) => !used.has(c)) || `v${model.definition.variables.length + 1}`;
    model.definition.variables.push({ name, type: 'entier', min: 1, max: 10 });
    drawVars();
    touch();
  };

  // ---------- Conditions ----------

  function drawConstraints() {
    const list = model.definition.constraints;
    constraintsBox.innerHTML = list.length
      ? list
          .map(
            (c, i) => `<div class="constraint-row">
              <input data-c="${i}" placeholder="a <> b" value="${esc(c)}">
              <button type="button" class="rowdel" data-del-c="${i}" title="Supprimer">✕</button>
            </div>`
          )
          .join('')
      : '<p class="muted small">Aucune condition : tous les tirages sont acceptés.</p>';
    constraintsBox.querySelectorAll('[data-c]').forEach((input) =>
      input.addEventListener('input', () => {
        model.definition.constraints[Number(input.dataset.c)] = input.value;
        touch();
      })
    );
    constraintsBox.querySelectorAll('[data-del-c]').forEach(
      (b) =>
        (b.onclick = () => {
          model.definition.constraints.splice(Number(b.dataset.delC), 1);
          drawConstraints();
          touch();
        })
    );
  }

  el.querySelector('[data-add-constraint]').onclick = () => {
    model.definition.constraints.push('');
    drawConstraints();
    touch();
  };

  // ---------- Réponse ----------

  function drawAnswer() {
    const a = model.definition.answer;
    if (a.kind === 'choice') {
      const options = a.options || (a.options = [{ text: '', correct: true }, { text: '', correct: false }]);
      answerBox.innerHTML = `
        <p class="muted small">Coche la bonne proposition. Les <code>[[ ]]</code> fonctionnent dans chaque proposition.</p>
        <div class="choice-rows">${options
          .map(
            (o, i) => `<div class="choice-row">
              <input type="radio" name="correct" data-correct="${i}" ${o.correct ? 'checked' : ''} aria-label="Bonne réponse ${i + 1}">
              <input data-opt="${i}" placeholder="Proposition ${i + 1}" value="${esc(o.text || '')}">
              <button type="button" class="rowdel" data-del-opt="${i}" title="Supprimer">✕</button>
            </div>`
          )
          .join('')}</div>
        <button type="button" class="linkbtn" data-add-opt>+ Ajouter une proposition</button>`;
      answerBox.querySelectorAll('[data-opt]').forEach((input) =>
        input.addEventListener('input', () => {
          options[Number(input.dataset.opt)].text = input.value;
          touch();
        })
      );
      answerBox.querySelectorAll('[data-correct]').forEach(
        (radio) =>
          (radio.onchange = () => {
            options.forEach((o, k) => (o.correct = k === Number(radio.dataset.correct)));
            touch();
          })
      );
      answerBox.querySelectorAll('[data-del-opt]').forEach(
        (b) =>
          (b.onclick = () => {
            if (options.length <= 2) return toast('Il faut au moins deux propositions.');
            const removed = options.splice(Number(b.dataset.delOpt), 1)[0];
            if (removed.correct && options.length) options[0].correct = true;
            drawAnswer();
            touch();
          })
      );
      answerBox.querySelector('[data-add-opt]').onclick = () => {
        if (options.length >= 6) return toast('Six propositions au maximum.');
        options.push({ text: '', correct: false });
        drawAnswer();
        touch();
      };
    } else if (a.kind === 'expression') {
      answerBox.innerHTML = `
        <label class="field"><span>Expression attendue</span>
          <input data-f="expected" placeholder="-x-[[a]]" value="${esc(a.expected || '')}"></label>
        <label class="check"><input type="checkbox" data-f="reduire" ${a.reduire === false ? '' : 'checked'}>
          <span>Exiger une expression réduite</span></label>
        <p class="muted small">Pour les réponses en $x$ : l’élève peut écrire <code>-x-1</code>, <code>-1-x</code> ou <code>- x - 1</code>, c’est la même chose. Degré 2 maximum (<code>x^2</code>).</p>`;
      answerBox.querySelector('[data-f="expected"]').addEventListener('input', (e) => {
        a.expected = e.target.value;
        touch();
      });
      answerBox.querySelector('[data-f="reduire"]').onchange = (e) => {
        a.reduire = e.target.checked;
        touch();
      };
    } else if (a.kind === 'texte') {
      const accepted = a.accepted || (a.accepted = ['']);
      answerBox.innerHTML = `
        <p class="muted small">Les majuscules, les accents et la ponctuation finale sont ignorés. Ajoute une ligne par formulation acceptée.</p>
        <div class="choice-rows">${accepted
          .map(
            (t, i) => `<div class="choice-row">
              <input data-acc="${i}" placeholder="Réponse acceptée" value="${esc(t)}">
              <button type="button" class="rowdel" data-del-acc="${i}" title="Supprimer">✕</button>
            </div>`
          )
          .join('')}</div>
        <button type="button" class="linkbtn" data-add-acc>+ Autre formulation acceptée</button>`;
      answerBox.querySelectorAll('[data-acc]').forEach((input) =>
        input.addEventListener('input', () => {
          accepted[Number(input.dataset.acc)] = input.value;
          touch();
        })
      );
      answerBox.querySelectorAll('[data-del-acc]').forEach(
        (b) =>
          (b.onclick = () => {
            if (accepted.length <= 1) return toast('Il faut au moins une réponse acceptée.');
            accepted.splice(Number(b.dataset.delAcc), 1);
            drawAnswer();
            touch();
          })
      );
      answerBox.querySelector('[data-add-acc]').onclick = () => {
        if (accepted.length >= 10) return toast('Dix formulations au maximum.');
        accepted.push('');
        drawAnswer();
        touch();
      };
    } else {
      answerBox.innerHTML = `
        <label class="field"><span>Formule de la bonne réponse</span>
          <input data-f="formula" placeholder="a*b" value="${esc(a.formula || '')}"></label>
        <div class="field-row">
          <label class="field"><span>Tolérance <span class="muted">(facultatif)</span></span>
            <input data-f="tolerance" placeholder="ex. 0,01" value="${esc(a.tolerance ?? '')}"></label>
          <label class="field"><span>Unité <span class="muted">(facultatif)</span></span>
            <input data-f="unit" maxlength="20" placeholder="cm" value="${esc(a.unit || '')}"></label>
        </div>
        <p class="muted small">Opérations : <code>+ - * / ^</code>. Fonctions : <code>racine, abs, arrondi, min, max, pgcd, ppcm</code>.</p>`;
      answerBox.querySelectorAll('[data-f]').forEach((input) =>
        input.addEventListener('input', () => {
          a[input.dataset.f] = input.dataset.f === 'tolerance' ? input.value.replace(',', '.') : input.value;
          touch();
        })
      );
    }
  }

  el.querySelectorAll('[data-kind]').forEach(
    (b) =>
      (b.onclick = () => {
        el.querySelectorAll('[data-kind]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
        model.definition.answer.kind = b.dataset.kind;
        drawAnswer();
        touch();
      })
  );

  // ---------- Champs simples ----------

  form.querySelectorAll('input[name], select[name], textarea[name]').forEach((input) => {
    const key = input.name;
    input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
      if (key === 'prompt' || key === 'solution') model.definition[key] = input.value;
      else if (key === 'count' || key === 'pass') model[key] = input.value === '' ? '' : Number(input.value);
      else if (key === 'classId') model.classId = input.value ? Number(input.value) : null;
      else model[key] = input.value;
      touch();
    });
  });

  // ---------- Aperçu en direct ----------

  let timer = null;
  let lastRoll = null;

  function touch() {
    dirty = true;
    saveState.textContent = 'Modifications non enregistrées.';
    clearTimeout(timer);
    timer = setTimeout(() => refreshPreview(true), 180);
  }

  function refreshPreview(reroll) {
    const errors = validateDefinition(model.definition);
    errorsBox.innerHTML = errors.map((m) => `<li>${esc(m)}</li>`).join('');
    errorsBox.hidden = errors.length === 0;
    if (errors.length) {
      previewBox.innerHTML = '<p class="muted">Corrige les points ci-dessus pour voir l’aperçu.</p>';
      return;
    }
    try {
      if (reroll || !lastRoll) lastRoll = buildQuestion(model.definition);
      const q = lastRoll;
      const inputHtml =
        q.input.kind === 'choice'
          ? `<div class="choices">${q.input.options.map((o) => `<button type="button" class="choice" disabled>${o}</button>`).join('')}</div>`
          : `<div class="answer"><input class="ans" disabled placeholder="Ta réponse">${q.input.unit ? `<span class="unit">${esc(q.input.unit)}</span>` : ''}</div>`;
      previewBox.innerHTML = `
        <p class="prev-kicker">Ce que voit l’élève</p>
        ${model.instructions ? `<p class="muted">${esc(model.instructions)}</p>` : ''}
        <div class="prompt">${q.prompt}</div>
        ${inputHtml}
        <div class="prev-answer"><span>Bonne réponse</span><code>${esc(
          q.input.kind === 'choice' ? q.input.options[q.check.expected].replace(/<[^>]*>/g, '') : q.check.expected
        )}</code></div>
        ${q.solution ? `<div class="prev-sol"><p class="prev-kicker">Correction</p><div>${q.solution}</div></div>` : ''}
        <p class="muted small">Série de ${model.count} questions, ${model.pass} bonnes réponses pour valider.</p>`;
      renderMath(previewBox);
    } catch (e) {
      previewBox.innerHTML = `<p class="form-error">${esc(e.message)}</p>`;
    }
  }

  el.querySelector('[data-reroll]').onclick = () => refreshPreview(true);

  // ---------- Enregistrement ----------

  async function save(status) {
    const errors = validateDefinition(model.definition);
    if (errors.length) {
      toast('Corrige les points signalés dans l’aperçu.', 'error');
      return null;
    }
    const payload = {
      title: model.title,
      level: model.level,
      classId: model.classId,
      instructions: model.instructions,
      count: model.count,
      pass: model.pass,
      definition: model.definition,
      ...(status ? { status } : {}),
    };
    saveState.textContent = 'Enregistrement…';
    try {
      const res = model.id
        ? await api.patch(`/teacher/exercises/${model.id}`, payload)
        : await api.post('/teacher/exercises', payload);
      Object.assign(model, { id: res.exercise.id, status: res.exercise.status });
      dirty = false;
      saveState.textContent = 'Enregistré.';
      const tag = el.querySelector('[data-status-tag]');
      tag.textContent = model.status === 'published' ? 'Publié' : 'Brouillon';
      tag.classList.toggle('ok', model.status === 'published');
      el.querySelector('[data-publish]').textContent = model.status === 'published' ? 'Repasser en brouillon' : 'Publier aux élèves';
      if (!id) history.replaceState(null, '', `/prof/exercices/${model.id}`);
      return res.exercise;
    } catch (e) {
      saveState.textContent = '';
      toast(e.message, 'error');
      return null;
    }
  }

  el.querySelector('[data-save]').onclick = async () => {
    if (await save()) toast('Exercice enregistré.', 'success');
  };
  el.querySelector('[data-publish]').onclick = async () => {
    const next = model.status === 'published' ? 'draft' : 'published';
    const saved = await save(next);
    if (saved) toast(next === 'published' ? 'Publié : tes élèves le voient dans les exercices libres.' : 'Repassé en brouillon.', 'success');
  };

  drawVars();
  drawConstraints();
  drawAnswer();
  refreshPreview(true);
  saveState.textContent = isNew ? 'Pas encore enregistré.' : '';

  // Prévient avant de quitter la page avec des modifications en cours.
  const guard = (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', guard);
  return () => {
    clearTimeout(timer);
    window.removeEventListener('beforeunload', guard);
  };
}
