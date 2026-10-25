// Page d'un chapitre : liste des étapes à gauche, étape courante à droite.
// En mode « libre », seul l'exercice est affiché, hors parcours.
import { api } from '../api.js';
import { state, markLevelTab } from '../app.js';
import { esc, renderMath, STEP_KIND, stepIcon, toast } from '../ui.js';
import { WIDGETS } from '../animations/widgets.js';
import { generateSet, expectedText } from '../exercises/generators.js';
import { generateFromTemplate } from '../exercises/template.js';
import { documentsListHtml } from './documents.js';

const BLOCK_LABEL = { definition: 'Définition', property: 'Propriété', method: 'Méthode', example: 'Exemple', remark: 'Remarque', text: '', video: '' };

// Un bloc de cours. Les vidéos sont un cas à part : rien n'est demandé à
// YouTube tant que l'élève n'a pas cliqué, pour qu'ouvrir un cours ne le fasse
// pas pister sans qu'il l'ait voulu.
function blockHtml(b) {
  if (b.type === 'video') {
    if (!b.videoId) return '';
    return `<section class="block b-video">
      ${b.title ? `<h3>${esc(b.title)}</h3>` : ''}
      <div class="video-holder" data-video="${esc(b.videoId)}">
        <button type="button" class="video-play">
          <span class="vp-icon" aria-hidden="true">▶</span>
          <span class="vp-text"><strong>Regarder la vidéo</strong>
            <span class="muted small">Elle est hébergée par YouTube : en cliquant, tu acceptes que leur site soit contacté.</span></span>
        </button>
      </div>
    </section>`;
  }
  const label = BLOCK_LABEL[b.type];
  const head = label || b.title ? `<h3>${label ? `<span class="block-kind">${label}</span>` : ''}${b.title ? esc(b.title) : ''}</h3>` : '';
  return `<section class="block b-${b.type}">${head}<div class="block-body">${b.html}</div></section>`;
}

// Le clic remplace la vignette par le lecteur, en mode sans cookie.
function bindVideos(root) {
  root.querySelectorAll('.video-holder').forEach((holder) => {
    holder.querySelector('.video-play').onclick = () => {
      const id = holder.dataset.video;
      holder.innerHTML = `<div class="video-frame"><iframe
        src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0&autoplay=1"
        title="Vidéo du cours" loading="lazy" allow="autoplay; fullscreen; picture-in-picture"
        referrerpolicy="no-referrer" allowfullscreen></iframe></div>`;
    };
  });
}

export async function chapterView({ el, params: [chapterId, stepParam], mode = 'parcours' }) {
  const [data, docs] = await Promise.all([
    api.get(`/chapters/${chapterId}`),
    // Les documents déposés pour ce chapitre. Leur absence ne doit jamais
    // empêcher le cours de s'afficher.
    api.get(`/documents?chapitre=${encodeURIComponent(chapterId)}`).then((r) => r.documents).catch(() => []),
  ]);
  const ch = data.chapter;
  const prog = data.progress;
  const isTeacher = state.user.role === 'teacher';
  const libre = mode === 'libre';
  const stepState = new Map(prog.steps.map((s) => [s.id, s]));
  let confiance = data.confiance ?? null;
  let cleanupStep = null;
  markLevelTab(ch.level);

  if (!libre && !prog.unlocked && !isTeacher) {
    el.innerHTML = `<section class="page narrow lv-${ch.level}">
      <h1>${esc(ch.title)}</h1>
      <div class="notice"><p>Ce chapitre se débloquera quand tu auras terminé le précédent${data.prev ? ` : <strong>${esc(data.prev.title)}</strong>` : ''}.</p>
      ${data.prev ? `<a class="btn" href="/chapitre/${data.prev.id}" data-link>Aller au chapitre précédent</a>` : ''}
      <p class="muted">Tu peux aussi t'entraîner sur ses exercices dans les <a href="/exercices" data-link>exercices libres</a>.</p></div>
    </section>`;
    return;
  }

  // Étape par défaut : la première non terminée.
  let current = ch.steps.find((s) => s.id === stepParam) || ch.steps.find((s) => !stepState.get(s.id)?.done) || ch.steps[0];
  if (libre && current.type !== 'exercise') current = ch.steps.find((s) => s.type === 'exercise');

  el.innerHTML = libre
    ? `<section class="page lv-${ch.level}">
        <nav class="crumbs"><a href="/exercices" data-link>Exercices libres</a> <span aria-hidden="true">/</span> ${esc(ch.level)} <span aria-hidden="true">/</span> ${esc(ch.title)}</nav>
        <div class="step-pane libre" id="pane"></div>
      </section>`
    : `<section class="page chapter lv-${ch.level}">
        <nav class="crumbs"><a href="/niveau/${ch.level}" data-link>${esc(ch.level)}</a> <span aria-hidden="true">/</span> Chapitre ${ch.order}</nav>
        <header class="page-head"><h1>${esc(ch.title)}</h1></header>
        <div class="chapter-grid">
          <ol class="steps" aria-label="Étapes du chapitre"></ol>
          <div class="step-pane" id="pane" tabindex="-1"></div>
        </div>
        <div id="confiance-slot"></div>
      </section>`;

  const pane = el.querySelector('#pane');
  const stepsEl = el.querySelector('.steps');

  function drawSteps() {
    if (!stepsEl) return;
    stepsEl.innerHTML = ch.steps
      .map((s) => {
        const st = stepState.get(s.id);
        const extra = s.type === 'exercise' && st?.bestScore != null ? `<span class="best">${st.bestScore}/${st.bestTotal}</span>` : '';
        return `<li><a href="/chapitre/${ch.id}/${s.id}" data-step="${s.id}" class="step-link${s.id === current.id ? ' active' : ''}${st?.done ? ' done' : ''}"${s.id === current.id ? ' aria-current="step"' : ''}>
          ${stepIcon(s.type)}<span><span class="step-kind">${STEP_KIND[s.type]}</span><span class="step-title">${esc(s.title)}</span></span>${extra}<span class="check" aria-label="${st?.done ? 'terminé' : ''}">${st?.done ? '✓' : ''}</span></a></li>`;
      })
      .join('');
  }

  if (stepsEl) {
    stepsEl.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-step]');
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      show(ch.steps.find((s) => s.id === a.dataset.step), true);
    });
  }

  // Le chapitre est-il terminé ? On le demande à l'état local, mis à jour au fil des étapes.
  const chapitreFini = () => ch.steps.every((s) => stepState.get(s.id)?.done);

  // Dernière étape franchie : on demande à l'élève comment il se sent. Ni le
  // score ni le temps ne disent s'il a compris — lui seul le sait.
  function confianceHtml() {
    if (state.user.role === 'teacher') return '';
    const niveaux = [
      [1, 'Perdu', 'Je n’ai pas compris'],
      [2, 'Fragile', 'Je sais faire avec de l’aide'],
      [3, 'Ça va', 'Je sais faire seul'],
      [4, 'À l’aise', 'Je pourrais l’expliquer'],
    ];
    return `<div class="confiance" data-confiance>
      <p class="conf-q">Chapitre terminé. Où en es-tu sur <strong>${esc(ch.title)}</strong> ?</p>
      <div class="conf-choices">
        ${niveaux
          .map(
            ([n, titre, aide]) =>
              `<button type="button" class="conf-btn${confiance === n ? ' on' : ''}" data-niveau="${n}">
                <strong>${titre}</strong><span class="muted small">${aide}</span></button>`
          )
          .join('')}
      </div>
      <p class="muted small">Ta réponse aide ton professeur à savoir quoi revoir. Tu peux la changer en revenant ici.</p>
    </div>`;
  }

  function bindConfiance() {
    const box = el.querySelector('[data-confiance]');
    if (!box) return;
    box.querySelectorAll('[data-niveau]').forEach(
      (b) =>
        (b.onclick = async () => {
          const niveau = Number(b.dataset.niveau);
          box.querySelectorAll('.conf-btn').forEach((x) => x.classList.toggle('on', x === b));
          try {
            await api.post('/progress/confiance', { chapterId: ch.id, level: niveau });
            confiance = niveau;
            toast('Merci, c’est noté.', 'success');
          } catch (e) {
            toast(e.message, 'error');
          }
        })
    );
  }

  function nextStepNav() {
    const i = ch.steps.indexOf(current);
    if (libre) return `<div class="pane-nav"><a class="btn ghost" href="/exercices" data-link>Retour aux exercices libres</a></div>`;
    const nxt = ch.steps[i + 1];
    if (nxt) return `<div class="pane-nav"><button type="button" class="btn" data-goto="${nxt.id}">Étape suivante : ${esc(nxt.title)}</button></div>`;
    const suite = data.next
      ? `<a class="btn" href="/chapitre/${data.next.id}" data-link>Chapitre suivant : ${esc(data.next.title)}</a>`
      : `<a class="btn ghost" href="/niveau/${ch.level}" data-link>Retour au parcours de ${esc(ch.level)}</a>`;
    return `<div class="pane-nav">${suite}</div>`;
  }

  function bindNav() {
    pane.querySelectorAll('[data-goto]').forEach((b) => (b.onclick = () => show(ch.steps.find((s) => s.id === b.dataset.goto), true)));
  }

  function markDone(stepId, extra = {}) {
    const st = stepState.get(stepId) || { id: stepId };
    stepState.set(stepId, { ...st, done: true, ...extra });
    drawSteps();
    peindreConfiance();
  }

  // Le chapitre est fini : on demande son ressenti à l'élève. L'encart reste
  // affiché tant qu'il est sur le chapitre, et il peut changer d'avis.
  function peindreConfiance() {
    const slot = el.querySelector('#confiance-slot');
    if (!slot) return;
    slot.innerHTML = chapitreFini() ? confianceHtml() : '';
    bindConfiance();
  }

  function show(step, push) {
    if (cleanupStep) {
      cleanupStep();
      cleanupStep = null;
    }
    current = step;
    if (push && !libre) history.pushState(null, '', `/chapitre/${ch.id}/${step.id}`);
    drawSteps();
    api.post('/progress/visit', { chapterId: ch.id, stepId: step.id, mode }).catch(() => {});
    if (step.type !== 'exercise') markDone(step.id);

    if (step.type === 'lesson') {
      // Les documents du chapitre accompagnent le cours : c'est là que l'élève
      // les cherche, pas dans un onglet à part.
      pane.innerHTML = `<article class="lesson"><h2>${esc(step.title)}</h2>${step.blocks
        .map(blockHtml)
        .join('')}${documentsListHtml(docs)}</article>${nextStepNav()}`;
      renderMath(pane);
      bindVideos(pane);
    } else if (step.type === 'animation') {
      pane.innerHTML = `<article class="anim"><h2>${esc(step.title)}</h2>${step.intro ? `<p class="intro">${step.intro}</p>` : ''}<div class="anim-stage"></div></article>${nextStepNav()}`;
      renderMath(pane.querySelector('.intro'));
      const mount = WIDGETS[step.widget];
      const stage = pane.querySelector('.anim-stage');
      if (mount) cleanupStep = mount(stage, step.params || {}, { math: renderMath });
      else stage.innerHTML = `<p class="muted">Animation « ${esc(step.widget)} » introuvable.</p>`;
    } else {
      cleanupStep = runExercise(pane, ch, step, mode, {
        onFinish: (res) => {
          if (res.everPassed) markDone(step.id, { bestScore: res.bestScore, bestTotal: step.count });
          else {
            const st = stepState.get(step.id) || {};
            stepState.set(step.id, { ...st, bestScore: res.bestScore, bestTotal: step.count });
            drawSteps();
          }
        },
        navHtml: nextStepNav,
        bindNav,
      });
    }
    bindNav();
    if (push) pane.focus({ preventScroll: false });
  }

  show(current, false);
  peindreConfiance();
  if (!libre && stepParam !== current.id) history.replaceState(null, '', `/chapitre/${ch.id}/${current.id}`);

  return () => {
    if (cleanupStep) cleanupStep();
  };
}

// ---------- Déroulé d'une série d'exercices ----------
// `step` vient d'un chapitre (clé `generator`) ou d'un exercice écrit par
// l'enseignant (clé `template`) : le déroulé est exactement le même.
// `submit` dit où envoyer le score ; par défaut, la progression du parcours.
export function runExercise(pane, ch, step, mode, { onFinish, navHtml, bindNav, submit }) {
  const sendScore =
    submit || ((payload) => api.post('/progress/attempt', { chapterId: ch.id, stepId: step.id, mode, ...payload }));
  let questions;
  let i;
  let score;
  let answered;
  let started;
  let questionStarted;
  let results;
  let detail; // une entrée par question : ce qui a été demandé, ce qui a été répondu
  let alive = true;

  function start() {
    questions = step.template ? generateFromTemplate(step.template, step.count) : generateSet(step.generator, step.count, step.params);
    i = 0;
    score = 0;
    answered = false;
    results = [];
    detail = [];
    started = Date.now();
    questionStarted = Date.now();
    drawQuestion();
  }

  // Texte lisible d'une question et d'une réponse, pour le suivi de l'enseignant.
  // On retire le balisage : ce qui est enregistré doit rester court et lisible.
  const plain = (html) =>
    String(html ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);

  // Ce que l'élève a répondu, dit en clair même pour un QCM.
  function answerText(q, raw) {
    if (q.input.kind === 'choice') return plain(q.input.options?.[Number(raw)] ?? raw);
    return String(raw ?? '').trim().slice(0, 120);
  }

  // Réponse attendue, lisible : « -x + 3 » plutôt que le tableau de coefficients.
  const expectedFor = (q) => plain(expectedText(q)).slice(0, 120);

  const pips = () =>
    `<ol class="pips" aria-hidden="true">${questions.map((_, k) => `<li class="${k < results.length ? (results[k] ? 'ok' : 'ko') : k === i ? 'cur' : ''}"></li>`).join('')}</ol>`;

  function inputHtml(q) {
    if (q.input.kind === 'choice') {
      return `<div class="choices" role="radiogroup">${q.input.options.map((o, k) => `<button type="button" class="choice" data-k="${k}" role="radio" aria-checked="false">${o}</button>`).join('')}</div>`;
    }
    const placeholder = q.input.kind === 'poly' ? 'ex. 3x+5' : 'Ta réponse';
    return `<div class="answer"><input class="ans" ${q.input.kind === 'number' ? 'inputmode="decimal"' : 'inputmode="text"'} autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${placeholder}" aria-label="Ta réponse">${q.input.unit ? `<span class="unit">${esc(q.input.unit)}</span>` : ''}</div>`;
  }

  function drawQuestion() {
    const q = questions[i];
    answered = false;
    pane.innerHTML = `
      <article class="exercise">
        <header class="ex-head"><h2>${esc(step.title)}</h2><span class="ex-count">Question ${i + 1} sur ${questions.length}</span></header>
        ${pips()}
        ${step.instructions ? `<p class="muted">${esc(step.instructions)}</p>` : ''}
        <form class="question" novalidate>
          <div class="prompt">${q.prompt}</div>
          ${q.figure || ''}
          ${inputHtml(q)}
          <p class="hint" role="alert" hidden></p>
          <div class="q-actions"><button class="btn" type="submit">Valider</button></div>
          <div class="feedback" aria-live="polite"></div>
        </form>
      </article>`;
    renderMath(pane.querySelector('.question'));
    const form = pane.querySelector('form');
    let choice = null;
    pane.querySelectorAll('.choice').forEach((b) =>
      (b.onclick = () => {
        if (answered) return;
        pane.querySelectorAll('.choice').forEach((x) => x.setAttribute('aria-checked', 'false'));
        b.setAttribute('aria-checked', 'true');
        choice = b.dataset.k;
        submit();
      })
    );
    const input = pane.querySelector('.ans');
    if (input) input.focus({ preventScroll: true });
    form.onsubmit = (e) => {
      e.preventDefault();
      if (answered) return next();
      submit();
    };

    function submit() {
      const raw = input ? input.value : choice;
      const hint = pane.querySelector('.hint');
      if (raw === null || raw === undefined || String(raw).trim() === '') {
        hint.textContent = q.input.kind === 'choice' ? 'Choisis une réponse.' : 'Écris ta réponse avant de valider.';
        hint.hidden = false;
        return;
      }
      const res = q.check(raw);
      if (!res.ok && res.message) {
        // Erreur d'écriture : on laisse une nouvelle chance, sans compter la question.
        hint.textContent = res.message;
        hint.hidden = false;
        return;
      }
      hint.hidden = true;
      answered = true;
      results.push(res.ok);
      detail.push({
        position: i + 1,
        prompt: plain(q.prompt),
        expected: expectedFor(q),
        given: answerText(q, raw),
        ok: res.ok,
        durationS: Math.max(0, Math.round((Date.now() - questionStarted) / 1000)),
      });
      if (res.ok) score++;
      if (input) {
        input.readOnly = true;
        input.classList.add(res.ok ? 'ok' : 'ko');
      }
      pane.querySelectorAll('.choice').forEach((b) => {
        b.disabled = true;
        if (b.dataset.k === String(choice)) b.classList.add(res.ok ? 'ok' : 'ko');
      });
      const fb = pane.querySelector('.feedback');
      fb.innerHTML = `<div class="fb ${res.ok ? 'ok' : 'ko'}"><p class="fb-title">${res.ok ? 'Juste !' : 'Pas tout à fait.'}</p><div class="fb-sol">${q.solution}</div></div>`;
      renderMath(fb);
      pane.querySelector('.pips').outerHTML = pips();
      const btn = pane.querySelector('.q-actions .btn');
      btn.textContent = i + 1 < questions.length ? 'Question suivante' : 'Voir mon score';
      btn.focus();
    }
  }

  function next() {
    if (i + 1 < questions.length) {
      i++;
      questionStarted = Date.now();
      drawQuestion();
    } else finish();
  }

  async function finish() {
    const durationS = Math.round((Date.now() - started) / 1000);
    const passed = score >= step.pass;
    pane.innerHTML = `
      <article class="exercise result ${passed ? 'passed' : ''}">
        <header class="ex-head"><h2>${esc(step.title)}</h2></header>
        ${pips()}
        <p class="big-score"><span>${score}</span> / ${questions.length}</p>
        <p class="result-msg">${passed ? `Objectif atteint (${step.pass} bonnes réponses demandées). Étape validée.` : `Il faut au moins ${step.pass} bonnes réponses pour valider cette étape. Relis les corrections et retente une série : les questions changent à chaque fois.`}</p>
        <p class="save-state muted">Enregistrement…</p>
        <div class="q-actions"><button type="button" class="btn ${passed ? 'ghost' : ''}" data-again>Nouvelle série</button></div>
      </article>${passed ? navHtml() : ''}`;
    pane.querySelector('[data-again]').onclick = start;
    bindNav();
    try {
      const res = await sendScore({ score, total: questions.length, durationS, questions: detail });
      if (!alive) return;
      pane.querySelector('.save-state').textContent = res?.saved === false ? 'Aperçu : le score n’est pas enregistré.' : 'Score enregistré.';
      onFinish(res);
    } catch (e) {
      if (!alive) return;
      pane.querySelector('.save-state').textContent = "Le score n'a pas pu être enregistré.";
      toast(e.message, 'error');
    }
  }

  start();
  return () => {
    alive = false;
  };
}
