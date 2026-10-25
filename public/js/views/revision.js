// Révision flash : deux questions tirées d'un chapitre déjà terminé, proposées
// à l'élève quand il arrive sur son tableau de bord.
//
// C'est une proposition, jamais une obligation : il peut refuser d'un clic, et
// on ne la lui repropose pas avant le lendemain. Les réponses ne comptent pas
// dans sa progression — une révision ne doit pas pouvoir faire baisser un score
// déjà acquis, sinon personne n'y touche.
import { api } from '../api.js';
import { esc, renderMath, toast } from '../ui.js';
import { generateSet, expectedText } from '../exercises/generators.js';
import { generateFromTemplate } from '../exercises/template.js';

const REFUS_KEY = 'mp-revision-refusee';
const MAX_QUESTIONS = 2;

// L'élève a-t-il déjà décliné aujourd'hui ?
function declineeAujourdhui() {
  try {
    return localStorage.getItem(REFUS_KEY) === new Date().toISOString().slice(0, 10);
  } catch {
    return false;
  }
}

function retenirRefus() {
  try {
    localStorage.setItem(REFUS_KEY, new Date().toISOString().slice(0, 10));
  } catch {
    /* stockage bloqué : la proposition reviendra, sans conséquence */
  }
}

// Construit les questions à partir des étapes renvoyées par le serveur.
function tirerQuestions(revision) {
  const out = [];
  for (const etape of revision.etapes) {
    if (out.length >= MAX_QUESTIONS) break;
    try {
      out.push(etape.template ? generateFromTemplate(etape.template, 1)[0] : generateSet(etape.generator, 1, etape.params)[0]);
    } catch {
      /* un exercice devenu injouable ne doit pas casser la révision */
    }
  }
  return out;
}

// Monte la proposition dans `host`. Renvoie true si quelque chose est affiché.
export async function monterRevisionFlash(host) {
  if (!host || declineeAujourdhui()) return false;
  let revision;
  try {
    revision = (await api.get('/revision-flash')).revision;
  } catch {
    return false;
  }
  if (!revision?.etapes?.length) return false;

  const questions = tirerQuestions(revision);
  if (!questions.length) return false;

  let i = 0;
  let justes = 0;

  function proposer() {
    host.innerHTML = `
      <div class="flash">
        <div class="flash-head">
          <span class="flash-tag">Révision flash</span>
          <p class="flash-q">Deux questions sur <strong>${esc(revision.chapterTitle)}</strong>, pour voir si c'est resté ?</p>
        </div>
        <div class="w-actions">
          <button type="button" class="btn" data-go>D'accord</button>
          <button type="button" class="btn ghost" data-non>Pas maintenant</button>
        </div>
      </div>`;
    host.querySelector('[data-go]').onclick = () => poser();
    host.querySelector('[data-non]').onclick = () => {
      retenirRefus();
      host.innerHTML = '';
    };
  }

  function poser() {
    const q = questions[i];
    host.innerHTML = `
      <div class="flash en-cours">
        <div class="flash-head">
          <span class="flash-tag">Révision flash</span>
          <span class="muted small">${esc(revision.chapterTitle)} · question ${i + 1} sur ${questions.length}</span>
        </div>
        <form class="flash-form" novalidate>
          <div class="prompt">${q.prompt}</div>
          ${
            q.input.kind === 'choice'
              ? `<div class="choices">${q.input.options.map((o, k) => `<button type="button" class="choice" data-k="${k}">${o}</button>`).join('')}</div>`
              : `<div class="answer"><input class="ans" autocomplete="off" placeholder="Ta réponse" aria-label="Ta réponse"></div>
                 <button class="btn" type="submit">Valider</button>`
          }
        </form>
        <div class="flash-feedback" aria-live="polite"></div>
      </div>`;
    renderMath(host);

    const form = host.querySelector('form');
    const repondre = (brut) => {
      const res = q.check(brut);
      if (!res.ok && res.message) {
        toast(res.message);
        return;
      }
      if (res.ok) justes++;
      const fb = host.querySelector('.flash-feedback');
      fb.innerHTML = `<div class="fb ${res.ok ? 'ok' : 'ko'}">
        <p class="fb-title">${res.ok ? 'Juste !' : `Non : ${esc(expectedText(q))}`}</p>
        ${q.solution ? `<div class="fb-sol">${q.solution}</div>` : ''}
        <button type="button" class="btn" data-suite>${i + 1 < questions.length ? 'Question suivante' : 'Terminer'}</button>
      </div>`;
      renderMath(fb);
      form.querySelectorAll('button, input').forEach((x) => (x.disabled = true));
      fb.querySelector('[data-suite]').onclick = () => {
        i++;
        if (i < questions.length) poser();
        else conclure();
      };
      fb.querySelector('[data-suite]').focus();
    };

    form.onsubmit = (e) => {
      e.preventDefault();
      const champ = form.querySelector('.ans');
      if (champ && champ.value.trim()) repondre(champ.value);
    };
    form.querySelectorAll('.choice').forEach((b) => (b.onclick = () => repondre(b.dataset.k)));
    form.querySelector('.ans')?.focus({ preventScroll: true });
  }

  function conclure() {
    const tout = justes === questions.length;
    host.innerHTML = `
      <div class="flash ${tout ? 'reussi' : ''}">
        <div class="flash-head">
          <span class="flash-tag">Révision flash</span>
          <p class="flash-q">${justes} sur ${questions.length} — ${
            tout ? 'c’est resté, bravo.' : `un petit tour par <strong>${esc(revision.chapterTitle)}</strong> ne ferait pas de mal.`
          }</p>
        </div>
        <div class="w-actions">
          ${tout ? '' : `<a class="btn" href="/chapitre/${esc(revision.chapterId)}" data-link>Revoir le chapitre</a>`}
          <button type="button" class="btn ghost" data-fermer>Fermer</button>
        </div>
      </div>`;
    // Révisé pour aujourd'hui : on ne le relance pas à chaque rechargement.
    retenirRefus();
    host.querySelector('[data-fermer]').onclick = () => {
      host.innerHTML = '';
    };
  }

  proposer();
  return true;
}
