// Espace enseignant : écrire un chapitre complet — le cours ET le parcours.
// À gauche la suite des étapes, à droite l'étape en cours d'écriture, avec
// un aperçu permanent de ce que verra l'élève.
import { api } from '../api.js';
import { navigate } from '../app.js';
import { esc, renderMath, relativeTime, toast } from '../ui.js';
import { renderRichText, BLOCK_TYPES } from '../content/richtext.js';

const LEVELS = ['6e', '5e', '4e', '3e'];
const BLOCK_LABEL = Object.fromEntries(BLOCK_TYPES.map((b) => [b.id, b.label]));
const STEP_LABEL = { lesson: 'Cours', animation: 'Animation', exercise: 'Exercice' };

let seq = 0;
const newId = (prefix) => `${prefix}${Date.now().toString(36).slice(-4)}${seq++}`;

// ---------- Éditeur ----------

const emptyChapter = (level = '6e') => ({
  title: '',
  level: LEVELS.includes(level) ? level : '6e',
  summary: '',
  position: undefined,
  classId: null,
  status: 'draft',
  steps: [
    {
      id: newId('cours'),
      type: 'lesson',
      title: 'Le cours',
      blocks: [{ type: 'definition', title: '', text: '' }],
    },
  ],
});

export async function teacherChapterEditorView({ el, params: [id], query }) {
  const isNew = !id;
  const [{ classes }, palette, loaded] = await Promise.all([
    api.get('/teacher/classes'),
    api.get('/teacher/chapters/palette'),
    isNew ? Promise.resolve(null) : api.get(`/teacher/chapters/${id}`),
  ]);

  const model = loaded ? { ...loaded.chapter, position: loaded.chapter.order } : emptyChapter(query?.get('niveau'));
  model.steps = model.steps.map((s) => ({ ...s }));
  // Un chapitre livré dans content/ se modifie « par-dessus » : l'original ne
  // bouge pas et on peut y revenir à tout moment.
  const fromFile = model.origin === 'fichier';
  const chapterKey = () => (fromFile ? encodeURIComponent(model.id) : model.dbId);
  let selected = 0;
  let dirty = false;
  let saveTimer = null;

  el.innerHTML = `
  <section class="page wide">
    <nav class="crumbs"><a href="/prof" data-link>Mes classes</a> <span aria-hidden="true">/</span>
      <a href="/prof/chapitres" data-link>Mes chapitres</a> <span aria-hidden="true">/</span> ${isNew ? 'Nouveau chapitre' : esc(model.title)}</nav>
    <header class="page-head row">
      <div><h1>${isNew ? 'Nouveau chapitre' : 'Modifier le chapitre'}</h1>
        <p class="muted">Le cours, les animations et les exercices, dans l’ordre où tes élèves les verront.</p></div>
      <div class="head-actions">
        <span class="tag ${model.status === 'published' ? 'ok' : ''}" data-status-tag>${model.status === 'published' ? 'Publié' : 'Brouillon'}</span>
        <button type="button" class="btn" data-save>Enregistrer</button>
        <button type="button" class="btn ghost" data-publish>${model.status === 'published' ? 'Repasser en brouillon' : 'Publier'}</button>
      </div>
    </header>
    ${
      fromFile
        ? `<p class="notice small origin-note">Ce chapitre est livré avec la plateforme. Tes modifications ne valent que pour <strong>tes classes</strong> : la version d’origine reste intacte${
            model.modified ? ' et tu peux y revenir à tout moment' : ''
          }.${model.modified ? ' <button type="button" class="linkbtn danger" data-reset>Revenir à la version d’origine</button>' : ''}</p>`
        : ''
    }
    <p class="muted small" data-save-state></p>

    <fieldset class="panel chapter-meta">
      <legend>Le chapitre</legend>
      <div class="meta-grid">
        <label class="field"><span>Titre</span><input name="title" maxlength="80" placeholder="ex. Les fractions" value="${esc(model.title)}"></label>
        <label class="field"><span>Niveau</span><select name="level">${LEVELS.map((l) => `<option${l === model.level ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Place dans le parcours</span><input name="position" type="number" min="1" max="999" placeholder="à la suite" value="${model.position ?? ''}"></label>
        <label class="field"><span>Pour</span><select name="classId">
          <option value="">Toutes mes classes de ce niveau</option>
          ${classes.map((c) => `<option value="${c.id}"${model.classId === c.id ? ' selected' : ''}>${esc(c.name)} (${esc(c.level)})</option>`).join('')}
        </select></label>
      </div>
      <label class="field"><span>Résumé <span class="muted">(facultatif)</span></span>
        <input name="summary" maxlength="200" placeholder="En une phrase, ce que l’élève va apprendre" value="${esc(model.summary || '')}"></label>
    </fieldset>

    <div class="chapter-editor">
      <aside class="steps-pane">
        <h2>Le parcours</h2>
        <ol class="step-list" data-steps></ol>
        <div class="add-step">
          <p class="muted small">Ajouter une étape</p>
          <div class="add-row">
            <button type="button" class="chipbtn" data-add="lesson">+ Cours</button>
            <button type="button" class="chipbtn" data-add="animation">+ Animation</button>
            <button type="button" class="chipbtn" data-add="exercise">+ Exercice</button>
          </div>
        </div>
      </aside>
      <div class="step-editor" data-step-editor></div>
    </div>
  </section>`;

  const metaEl = el.querySelector('.chapter-meta');
  const stepsEl = el.querySelector('[data-steps]');
  const editorEl = el.querySelector('[data-step-editor]');
  const saveState = el.querySelector('[data-save-state]');

  metaEl.querySelectorAll('[name]').forEach((input) =>
    input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
      const k = input.name;
      if (k === 'position') model.position = input.value === '' ? undefined : Number(input.value);
      else if (k === 'classId') model.classId = input.value ? Number(input.value) : null;
      else model[k] = input.value;
      touch();
    })
  );

  function touch() {
    dirty = true;
    saveState.textContent = 'Modifications non enregistrées.';
  }

  // ---------- Colonne de gauche : les étapes ----------

  function drawSteps() {
    stepsEl.innerHTML = model.steps
      .map(
        (s, i) => `<li class="${i === selected ? 'active' : ''}">
          <button type="button" class="step-pick" data-pick="${i}">
            <span class="step-kind">${STEP_LABEL[s.type]}</span>
            <span class="step-name">${esc(s.title || 'Sans titre')}</span>
            <span class="muted small">${describeStep(s)}</span>
          </button>
          <span class="step-tools">
            <button type="button" class="rowdel" data-up="${i}" ${i === 0 ? 'disabled' : ''} title="Monter">↑</button>
            <button type="button" class="rowdel" data-down="${i}" ${i === model.steps.length - 1 ? 'disabled' : ''} title="Descendre">↓</button>
            <button type="button" class="rowdel" data-remove="${i}" title="Supprimer l’étape">✕</button>
          </span>
        </li>`
      )
      .join('');

    stepsEl.querySelectorAll('[data-pick]').forEach(
      (b) =>
        (b.onclick = () => {
          selected = Number(b.dataset.pick);
          drawSteps();
          drawStepEditor();
        })
    );
    stepsEl.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => moveStep(Number(b.dataset.up), -1)));
    stepsEl.querySelectorAll('[data-down]').forEach((b) => (b.onclick = () => moveStep(Number(b.dataset.down), 1)));
    stepsEl.querySelectorAll('[data-remove]').forEach(
      (b) =>
        (b.onclick = () => {
          const i = Number(b.dataset.remove);
          if (model.steps.length === 1) return toast('Un chapitre a besoin d’au moins une étape.');
          if (!confirm(`Supprimer l’étape « ${model.steps[i].title || 'sans titre'} » ?`)) return;
          model.steps.splice(i, 1);
          selected = Math.max(0, Math.min(selected, model.steps.length - 1));
          touch();
          drawSteps();
          drawStepEditor();
        })
    );
  }

  function describeStep(s) {
    if (s.type === 'lesson') return `${(s.blocks || []).length} bloc${(s.blocks || []).length > 1 ? 's' : ''}`;
    if (s.type === 'animation') return s.widget || 'à choisir';
    if (s.source === 'custom') {
      const ex = palette.exercises.find((e) => e.id === Number(s.exerciseId));
      return ex ? ex.title : 'exercice à choisir';
    }
    return s.generator ? `${s.count} questions` : 'à choisir';
  }

  function moveStep(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= model.steps.length) return;
    [model.steps[i], model.steps[j]] = [model.steps[j], model.steps[i]];
    if (selected === i) selected = j;
    else if (selected === j) selected = i;
    touch();
    drawSteps();
    drawStepEditor();
  }

  el.querySelectorAll('[data-add]').forEach(
    (b) =>
      (b.onclick = () => {
        const type = b.dataset.add;
        const step =
          type === 'lesson'
            ? { id: newId('cours'), type, title: 'Le cours', blocks: [{ type: 'definition', title: '', text: '' }] }
            : type === 'animation'
              ? { id: newId('anim'), type, title: 'Animation', widget: palette.widgets[0], intro: '' }
              : { id: newId('ex'), type, title: 'Exercices', source: 'generator', generator: palette.generators[0], count: 6, pass: 5 };
        model.steps.push(step);
        selected = model.steps.length - 1;
        touch();
        drawSteps();
        drawStepEditor();
      })
  );

  // ---------- Colonne de droite : l'étape sélectionnée ----------

  function drawStepEditor() {
    const s = model.steps[selected];
    if (!s) {
      editorEl.innerHTML = '';
      return;
    }
    editorEl.innerHTML = `
      <div class="step-head">
        <span class="step-kind big">${STEP_LABEL[s.type]}</span>
        <label class="field grow"><span class="sr">Titre de l’étape</span>
          <input data-step-title maxlength="80" placeholder="Titre vu par l’élève" value="${esc(s.title || '')}"></label>
      </div>
      <div data-step-body></div>`;
    editorEl.querySelector('[data-step-title]').addEventListener('input', (e) => {
      s.title = e.target.value;
      touch();
      drawSteps();
    });
    const body = editorEl.querySelector('[data-step-body]');
    if (s.type === 'lesson') drawLesson(s, body);
    else if (s.type === 'animation') drawAnimation(s, body);
    else drawExercise(s, body);
  }

  // --- Cours : des blocs pré-définis ---

  function drawLesson(step, body) {
    body.innerHTML = `
      <div class="block-palette">
        <p class="muted small">Ajouter un bloc</p>
        <div class="add-row">
          ${BLOCK_TYPES.map((b) => `<button type="button" class="chipbtn b-${b.id}" data-addblock="${b.id}" title="${esc(b.hint)}">+ ${esc(b.label)}</button>`).join('')}
        </div>
      </div>
      <div class="blocks" data-blocks></div>
      <details class="format-help">
        <summary>Mise en forme disponible</summary>
        <ul>
          <li><code>$...$</code> pour une formule : <code>$\\dfrac{3}{4}$</code>, <code>$x^2$</code>, <code>$-(a+b)$</code></li>
          <li><code>**gras**</code>, <code>*italique*</code>, <code>\`code\`</code></li>
          <li>une ligne qui commence par <code>- </code> fait une puce, par <code>1. </code> une liste numérotée</li>
          <li>une ligne vide sépare deux paragraphes</li>
        </ul>
      </details>
      <div class="lesson-preview">
        <p class="prev-kicker">Aperçu du cours</p>
        <article class="lesson" data-preview></article>
      </div>`;

    const blocksEl = body.querySelector('[data-blocks]');

    function drawBlocks() {
      blocksEl.innerHTML = step.blocks
        .map(
          (b, i) => `<div class="block-edit b-${b.type}">
            <div class="be-head">
              <span class="be-kind">${esc(BLOCK_LABEL[b.type] || b.type)}</span>
              <input data-btitle="${i}" maxlength="120" placeholder="Titre du bloc (facultatif)" value="${esc(b.title || '')}">
              <span class="step-tools">
                <button type="button" class="rowdel" data-bup="${i}" ${i === 0 ? 'disabled' : ''} title="Monter">↑</button>
                <button type="button" class="rowdel" data-bdown="${i}" ${i === step.blocks.length - 1 ? 'disabled' : ''} title="Descendre">↓</button>
                <button type="button" class="rowdel" data-bdel="${i}" title="Supprimer le bloc">✕</button>
              </span>
            </div>
            <textarea data-btext="${i}" rows="4" placeholder="${esc(BLOCK_TYPES.find((t) => t.id === b.type)?.placeholder || '')}">${esc(b.text || '')}</textarea>
          </div>`
        )
        .join('');

      blocksEl.querySelectorAll('[data-btitle]').forEach((inp) =>
        inp.addEventListener('input', () => {
          step.blocks[Number(inp.dataset.btitle)].title = inp.value;
          touch();
          refreshPreview();
        })
      );
      blocksEl.querySelectorAll('[data-btext]').forEach((ta) =>
        ta.addEventListener('input', () => {
          step.blocks[Number(ta.dataset.btext)].text = ta.value;
          touch();
          refreshPreview();
        })
      );
      blocksEl.querySelectorAll('[data-bdel]').forEach(
        (b) =>
          (b.onclick = () => {
            step.blocks.splice(Number(b.dataset.bdel), 1);
            if (!step.blocks.length) step.blocks.push({ type: 'text', title: '', text: '' });
            touch();
            drawBlocks();
            drawSteps();
          })
      );
      const swap = (i, j) => {
        if (j < 0 || j >= step.blocks.length) return;
        [step.blocks[i], step.blocks[j]] = [step.blocks[j], step.blocks[i]];
        touch();
        drawBlocks();
      };
      blocksEl.querySelectorAll('[data-bup]').forEach((b) => (b.onclick = () => swap(Number(b.dataset.bup), Number(b.dataset.bup) - 1)));
      blocksEl.querySelectorAll('[data-bdown]').forEach((b) => (b.onclick = () => swap(Number(b.dataset.bdown), Number(b.dataset.bdown) + 1)));
      refreshPreview();
    }

    function refreshPreview() {
      const prev = body.querySelector('[data-preview]');
      prev.innerHTML = step.blocks
        .map((b) => {
          const label = BLOCK_LABEL[b.type];
          const head =
            b.type === 'text' && !b.title
              ? ''
              : `<h3>${label && b.type !== 'text' ? `<span class="block-kind">${esc(label)}</span>` : ''}${b.title ? esc(b.title) : ''}</h3>`;
          return `<section class="block b-${b.type}">${head}<div class="block-body">${renderRichText(b.text)}</div></section>`;
        })
        .join('');
      renderMath(prev);
    }

    body.querySelectorAll('[data-addblock]').forEach(
      (b) =>
        (b.onclick = () => {
          step.blocks.push({ type: b.dataset.addblock, title: '', text: '' });
          touch();
          drawBlocks();
          drawSteps();
        })
    );

    drawBlocks();
  }

  // --- Animation : choisir parmi celles de la plateforme ---

  function drawAnimation(step, body) {
    body.innerHTML = `
      <label class="field"><span>Animation</span>
        <select data-widget>${palette.widgets.map((w) => `<option${w === step.widget ? ' selected' : ''}>${esc(w)}</option>`).join('')}</select></label>
      <label class="field"><span>Introduction <span class="muted">(facultatif)</span></span>
        <textarea data-intro rows="2" placeholder="Une phrase pour présenter l’animation">${esc(step.intro || '')}</textarea></label>
      <p class="muted small">Les animations sont fournies avec la plateforme. Pour en ajouter une nouvelle, il faut passer par le code (voir le README).</p>`;
    body.querySelector('[data-widget]').onchange = (e) => {
      step.widget = e.target.value;
      touch();
      drawSteps();
    };
    body.querySelector('[data-intro]').addEventListener('input', (e) => {
      step.intro = e.target.value;
      touch();
    });
  }

  // --- Exercice : un générateur intégré ou un exercice écrit par l'enseignant ---

  function drawExercise(step, body) {
    const isCustom = step.source === 'custom';
    body.innerHTML = `
      <div class="seg small" role="tablist">
        <button type="button" role="tab" class="seg-btn" aria-selected="${!isCustom}" data-src="generator">Exercice de la plateforme</button>
        <button type="button" role="tab" class="seg-btn" aria-selected="${isCustom}" data-src="custom">Un de mes exercices</button>
      </div>
      <div data-ex-body></div>`;

    const exBody = body.querySelector('[data-ex-body]');

    function drawBody() {
      if (step.source === 'custom') {
        exBody.innerHTML = palette.exercises.length
          ? `<label class="field"><span>Lequel ?</span>
              <select data-exid>${palette.exercises
                .map((e) => `<option value="${e.id}"${Number(step.exerciseId) === e.id ? ' selected' : ''}>${esc(e.title)} (${esc(e.level)}, ${e.count} questions)</option>`)
                .join('')}</select></label>
             <p class="muted small">Le nombre de questions et l’objectif sont ceux définis dans « Mes exercices ».</p>`
          : `<p class="notice small">Tu n’as pas encore écrit d’exercice. <a href="/prof/exercices/nouveau" data-link>En créer un</a>, puis reviens ici.</p>`;
        const sel = exBody.querySelector('[data-exid]');
        if (sel) {
          if (!step.exerciseId) {
            step.exerciseId = palette.exercises[0].id;
            touch();
          }
          sel.onchange = () => {
            step.exerciseId = Number(sel.value);
            touch();
            drawSteps();
          };
        }
      } else {
        exBody.innerHTML = `
          <label class="field"><span>Type d’exercice</span>
            <select data-gen>${palette.generators.map((g) => `<option${g === step.generator ? ' selected' : ''}>${esc(g)}</option>`).join('')}</select></label>
          <div class="field-row">
            <label class="field"><span>Questions par série</span><input data-count type="number" min="1" max="20" value="${step.count ?? 6}"></label>
            <label class="field"><span>Bonnes réponses pour valider</span><input data-pass type="number" min="1" max="20" value="${step.pass ?? 5}"></label>
          </div>`;
        exBody.querySelector('[data-gen]').onchange = (e) => {
          step.generator = e.target.value;
          touch();
          drawSteps();
        };
        exBody.querySelector('[data-count]').addEventListener('input', (e) => {
          step.count = Number(e.target.value);
          touch();
          drawSteps();
        });
        exBody.querySelector('[data-pass]').addEventListener('input', (e) => {
          step.pass = Number(e.target.value);
          touch();
        });
      }
    }

    body.querySelectorAll('[data-src]').forEach(
      (b) =>
        (b.onclick = () => {
          body.querySelectorAll('[data-src]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
          step.source = b.dataset.src;
          if (step.source === 'generator' && !step.generator) {
            step.generator = palette.generators[0];
            step.count = step.count ?? 6;
            step.pass = step.pass ?? 5;
          }
          touch();
          drawBody();
          drawSteps();
        })
    );
    drawBody();
  }

  // ---------- Enregistrement ----------

  async function save(status) {
    const payload = {
      title: model.title,
      level: model.level,
      summary: model.summary,
      classId: model.classId,
      steps: model.steps,
      ...(model.position ? { position: model.position } : {}),
      ...(status ? { status } : {}),
    };
    saveState.textContent = 'Enregistrement…';
    try {
      const res = fromFile || model.dbId
        ? await api.patch(`/teacher/chapters/${chapterKey()}`, payload)
        : await api.post('/teacher/chapters', payload);
      Object.assign(model, { dbId: res.chapter.dbId, status: res.chapter.status, position: res.chapter.order, modified: res.chapter.modified });
      dirty = false;
      saveState.textContent = `Enregistré ${relativeTime(new Date().toISOString())}.`;
      const tag = el.querySelector('[data-status-tag]');
      tag.textContent = model.status === 'published' ? 'Publié' : 'Brouillon';
      tag.classList.toggle('ok', model.status === 'published');
      el.querySelector('[data-publish]').textContent = model.status === 'published' ? 'Repasser en brouillon' : 'Publier';
      const posInput = metaEl.querySelector('[name="position"]');
      if (posInput && !posInput.value) posInput.value = model.position;
      if (!id) history.replaceState(null, '', `/prof/chapitres/${model.dbId}`);
      if (fromFile) el.querySelector('.origin-note')?.classList.add('modified');
      return res.chapter;
    } catch (e) {
      saveState.textContent = '';
      toast(e.message, 'error');
      return null;
    }
  }

  el.querySelector('[data-save]').onclick = async () => {
    if (await save()) toast('Chapitre enregistré.', 'success');
  };
  el.querySelector('[data-reset]')?.addEventListener('click', async () => {
    if (!confirm('Effacer tes modifications et revenir au chapitre tel qu’il est livré ?')) return;
    try {
      await api.post(`/teacher/chapters/${chapterKey()}/reset`);
      dirty = false;
      toast('Chapitre revenu à sa version d’origine.', 'success');
      navigate(`/prof/chapitres/${chapterKey()}`);
    } catch (e) {
      toast(e.message, 'error');
    }
  });
  el.querySelector('[data-publish]').onclick = async () => {
    const next = model.status === 'published' ? 'draft' : 'published';
    if (await save(next)) {
      toast(next === 'published' ? 'Publié : tes élèves le voient dans leur parcours.' : 'Repassé en brouillon.', 'success');
    }
  };

  drawSteps();
  drawStepEditor();
  saveState.textContent = isNew ? 'Pas encore enregistré.' : '';

  const guard = (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', guard);
  return () => {
    clearTimeout(saveTimer);
    window.removeEventListener('beforeunload', guard);
  };
}
