// Ce fichier est embarqué tel quel dans chaque chapitre exporté en HTML.
// Il ne s'exécute jamais dans la plateforme : il vit dans le fichier téléchargé,
// sur l'ordinateur de celui qui l'ouvre, sans serveur et sans réseau.
//
// Son travail : remonter le chapitre à partir des données embarquées, et faire
// tourner les vraies animations et les vrais exercices. Pas une copie allégée —
// le code des générateurs et des widgets est le même que celui du site, inclus
// dans le fichier. Une question tirée ici est donc exactement une question du
// site, corrigée de la même façon.
(function horsLigne() {
  const CHAPITRE = JSON.parse(document.getElementById('mp-chapitre').textContent);

  // Les modules du site ont été posés dans la page avant celui-ci, chacun dans
  // sa propre portée ; ils ne partagent que ce registre.
  const generators = window.__mp['generators.js'];
  const template = window.__mp['template.js'];
  const widgets = window.__mp['widgets.js'];

  // --- outils --------------------------------------------------------------
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // Les formules sont rendues en MathML : c'est le navigateur qui dessine, donc
  // aucune police à embarquer et un rendu net à l'impression.
  const math = (el) => {
    if (!el || !window.renderMathInElement) return;
    window.renderMathInElement(el, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
      ],
      output: 'mathml',
      throwOnError: false,
    });
  };

  const ICONES = {
    lesson: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5C6.5 4 9.5 4 12 5.5v14C9.5 18 6.5 18 4 19.5zM12 5.5C14.5 4 17.5 4 20 5.5v14c-2.5-1.5-5.5-1.5-8 0"/></svg>',
    animation: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M10 8.5l5.5 3.5L10 15.5z"/></svg>',
    exercise: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 4.5l4 4L9 19l-5 1 1-5z"/><path d="M13.5 6.5l4 4"/></svg>',
  };
  const NOM_TYPE = { lesson: 'Cours', animation: 'Animation', exercise: 'Exercice' };

  // --- le cours ------------------------------------------------------------
  function blocHtml(b) {
    if (b.type === 'video') {
      // Une vidéo a besoin du réseau : on le dit, plutôt que d'afficher un cadre vide.
      return `<section class="block b-remark"><h3>${esc(b.title || 'Vidéo')}</h3><div class="block-body">
        <p class="muted">Cette vidéo n'est pas incluse dans le fichier : elle demande une connexion.
        ${b.videoId ? `Elle est visible sur <a href="https://www.youtube.com/watch?v=${esc(b.videoId)}">youtube.com</a>.` : ''}</p></div></section>`;
    }
    const nom = { definition: 'Définition', property: 'Propriété', method: 'Méthode', example: 'Exemple', remark: 'Remarque' }[b.type] || '';
    const tete = nom || b.title ? `<h3>${nom ? `<span class="block-kind">${nom}</span>` : ''}${b.title ? esc(b.title) : ''}</h3>` : '';
    return `<section class="block b-${esc(b.type)}">${tete}<div class="block-body">${b.html}</div></section>`;
  }

  // --- les exercices -------------------------------------------------------
  // Même déroulé que sur le site : une question à la fois, correction après
  // chaque réponse, score à la fin. À une différence près, assumée : ici c'est
  // le navigateur qui corrige, puisqu'il n'y a pas de serveur. Un fichier
  // hors ligne n'enregistre aucune note.
  function lancerExercice(pane, step) {
    let questions;
    try {
      questions = step.template
        ? template.generateFromTemplate(step.template, step.count)
        : generators.generateSet(step.generator, step.count, step.params || {});
    } catch (e) {
      pane.innerHTML = `<p class="empty">Cet exercice n'a pas pu être préparé (${esc(e.message)}).</p>`;
      return;
    }
    let i = 0;
    const resultats = [];

    const pastilles = () =>
      `<ol class="pips" aria-hidden="true">${questions
        .map((_, k) => `<li class="${k < resultats.length ? (resultats[k] ? 'ok' : 'ko') : k === i ? 'cur' : ''}"></li>`)
        .join('')}</ol>`;

    const champ = (q) => {
      if (q.input.kind === 'choice') {
        return `<div class="choices" role="radiogroup">${q.input.options
          .map((o, k) => `<button type="button" class="choice" data-k="${k}" role="radio" aria-checked="false">${o}</button>`)
          .join('')}</div>`;
      }
      const indice = q.input.kind === 'poly' ? 'ex. 3x+5' : 'Ta réponse';
      return `<div class="answer"><input class="ans" ${q.input.kind === 'number' ? 'inputmode="decimal"' : 'inputmode="text"'}
        autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${indice}" aria-label="Ta réponse">${
        q.input.unit ? `<span class="unit">${esc(q.input.unit)}</span>` : ''
      }</div>`;
    };

    function dessiner() {
      const q = questions[i];
      let choix = null;
      let repondu = false;
      pane.innerHTML = `<article class="exercise">
        <header class="ex-head"><h2>${esc(step.title)}</h2><span class="ex-count">Question ${i + 1} sur ${questions.length}</span></header>
        ${pastilles()}
        ${step.instructions ? `<p class="muted">${esc(step.instructions)}</p>` : ''}
        <form class="question" novalidate>
          <div class="prompt">${q.prompt}</div>
          ${q.figure || ''}
          ${champ(q)}
          <p class="hint" role="alert" hidden></p>
          <div class="q-actions"><button class="btn" type="submit">Valider</button></div>
          <div class="feedback" aria-live="polite"></div>
        </form>
      </article>`;
      math(pane.querySelector('.question'));

      pane.querySelectorAll('.choice').forEach((b) => {
        b.onclick = () => {
          if (repondu) return;
          pane.querySelectorAll('.choice').forEach((x) => x.setAttribute('aria-checked', 'false'));
          b.setAttribute('aria-checked', 'true');
          choix = b.dataset.k;
        };
      });

      const form = pane.querySelector('form');
      form.onsubmit = (e) => {
        e.preventDefault();
        const saisie = pane.querySelector('.ans');
        const brut = saisie ? saisie.value : choix;
        if (repondu) return suivant();
        const indice = pane.querySelector('.hint');
        if (brut === null || String(brut).trim() === '') {
          indice.textContent = q.input.kind === 'choice' ? 'Choisis une réponse.' : 'Écris ta réponse avant de valider.';
          indice.hidden = false;
          return;
        }
        indice.hidden = true;
        const res = q.check(brut);
        repondu = true;
        resultats.push(!!res.ok);
        if (saisie) {
          saisie.disabled = true;
          saisie.classList.add(res.ok ? 'ok' : 'ko');
        }
        pane.querySelectorAll('.choice').forEach((b) => {
          b.disabled = true;
          if (b.dataset.k === String(choix)) b.classList.add(res.ok ? 'ok' : 'ko');
        });
        const retour = pane.querySelector('.feedback');
        retour.innerHTML = `<p class="verdict ${res.ok ? 'ok' : 'ko'}">${res.ok ? '✔ Bonne réponse' : '✗ Ce n’est pas ça'}${
          res.message ? ` — ${res.message}` : ''
        }</p>${q.solution ? `<div class="solution">${q.solution}</div>` : ''}`;
        math(retour);
        pane.querySelector('.pips').outerHTML = pastilles();
        form.querySelector('button[type=submit]').textContent = i === questions.length - 1 ? 'Voir le score' : 'Question suivante';
      };
    }

    function suivant() {
      i++;
      if (i < questions.length) return dessiner();
      const bons = resultats.filter(Boolean).length;
      const atteint = bons >= (step.pass || questions.length);
      pane.innerHTML = `<article class="exercise done">
        <h2>${esc(step.title)}</h2>
        <p class="big-score"><span>${bons}</span> / ${questions.length}</p>
        <p>${atteint ? '🎉 Objectif atteint.' : `Objectif : ${step.pass} bonnes réponses. Tu peux recommencer, les questions changent.`}</p>
        <div class="w-actions"><button type="button" class="btn" data-recommencer>Recommencer</button></div>
      </article>`;
      pane.querySelector('[data-recommencer]').onclick = () => lancerExercice(pane, step);
    }

    dessiner();
  }

  // --- assemblage de la page ----------------------------------------------
  const vue = document.getElementById('vue');
  const liste = document.getElementById('etapes');
  let nettoyage = null;
  let courante = 0;

  liste.innerHTML = CHAPITRE.steps
    .map(
      (s, k) => `<li><button type="button" class="step-link" data-i="${k}">
        <span class="ico ico-${s.type}">${ICONES[s.type] || ''}</span>
        <span><span class="step-kind">${NOM_TYPE[s.type] || ''}</span><span class="step-name">${esc(s.title)}</span></span>
      </button></li>`
    )
    .join('');

  function afficher(k) {
    if (nettoyage) {
      try {
        nettoyage();
      } catch {
        /* une animation qui se ferme mal ne doit pas bloquer la page */
      }
      nettoyage = null;
    }
    courante = k;
    const step = CHAPITRE.steps[k];
    liste.querySelectorAll('.step-link').forEach((b, j) => b.classList.toggle('current', j === k));
    vue.innerHTML = '';

    if (step.type === 'lesson') {
      vue.innerHTML = `<article class="lesson"><h2>${esc(step.title)}</h2>${(step.blocks || []).map(blocHtml).join('')}</article>`;
      math(vue);
    } else if (step.type === 'animation') {
      vue.innerHTML = `<article class="anim"><h2>${esc(step.title)}</h2>${step.intro ? `<p class="muted">${esc(step.intro)}</p>` : ''}
        <div class="anim-stage"></div></article>`;
      math(vue);
      const monter = widgets.WIDGETS?.[step.widget];
      const scene = vue.querySelector('.anim-stage');
      if (monter) nettoyage = monter(scene, step.params || {}, { math });
      else scene.innerHTML = `<p class="muted">Animation « ${esc(step.widget)} » introuvable.</p>`;
    } else {
      lancerExercice(vue, step);
    }

    const suite = CHAPITRE.steps[k + 1];
    if (suite) {
      const nav = document.createElement('div');
      nav.className = 'step-nav';
      nav.innerHTML = `<button type="button" class="btn">Étape suivante : ${esc(suite.title)}</button>`;
      nav.querySelector('button').onclick = () => {
        afficher(k + 1);
        window.scrollTo(0, 0);
      };
      vue.append(nav);
    }
    vue.focus({ preventScroll: true });
  }

  liste.querySelectorAll('.step-link').forEach((b) => (b.onclick = () => afficher(Number(b.dataset.i))));
  document.getElementById('chargement')?.remove();
  afficher(0);
})();
