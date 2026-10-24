// Jeu des tables de multiplication : le plus de bonnes réponses avant la fin du chrono.
// Barème (annoncé aux élèves, et vérifié par le serveur) : 10 points par bonne
// réponse, plus 1 point par bonne réponse d'affilée, bonus plafonné à 10.
import { esc } from '../ui.js';
import { createGameAudio } from './audio.js';

export const BASE_POINTS = 10;
export const MAX_STREAK_BONUS = 10;
const FACTORS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export const pointsFor = (streakBefore) => BASE_POINTS + Math.min(streakBefore, MAX_STREAK_BONUS);

// Petit décompte avant le départ : le temps de poser les doigts sur le clavier.
const COUNTDOWN_S = 5;

// `level` vient du serveur : { id, label, tables, mode }.
export function mountTablesGame(root, { level, duration }, { onFinish }) {
  const pool = [];
  for (const t of level.tables) for (const f of FACTORS) pool.push([t, f]);

  let score = 0;
  let correct = 0;
  let wrong = 0;
  let streak = 0;
  let bestStreak = 0;
  let current = null;
  let recent = [];
  let endsAt = null; // fixé seulement au top départ
  let timerId = null;
  let countdownId = null;
  let alive = true;

  const audio = createGameAudio();

  root.innerHTML = `
    <div class="game-play">
      <div class="game-hud">
        <div class="hud-item"><span class="hud-label">Temps</span><strong data-time>${duration}</strong></div>
        <div class="hud-item"><span class="hud-label">Score</span><strong data-score>0</strong></div>
        <div class="hud-item"><span class="hud-label">Série</span><strong data-streak>0</strong></div>
        <button type="button" class="soundbtn" data-sound aria-pressed="false" title="Couper le son">♪</button>
      </div>
      <div class="time-bar"><span data-bar style="width:100%"></span></div>
      <div class="countdown" data-countdown aria-live="assertive">
        <p class="cd-label">Prépare-toi…</p>
        <p class="cd-num" data-cd>${COUNTDOWN_S}</p>
        <p class="muted small">Tables de ${esc(level.tables.join(', '))}</p>
      </div>
      <form class="game-question" novalidate hidden>
        <div class="prompt-wrap">
          <p class="game-prompt" data-prompt aria-live="off"></p>
          <div class="gain-layer" data-gains aria-hidden="true"></div>
        </div>
        <input class="game-input" data-input inputmode="numeric" autocomplete="off" autocapitalize="none"
               spellcheck="false" aria-label="Ta réponse" placeholder="?">
        <p class="game-flash" data-flash aria-live="polite"></p>
      </form>
      <ul class="game-recent" data-recent aria-label="Dernières réponses"></ul>
      <p class="muted small game-rule">${BASE_POINTS} points par bonne réponse, +1 par bonne réponse d’affilée (bonus maximum +${MAX_STREAK_BONUS}).</p>
      <button type="button" class="linkbtn" data-give-up>Arrêter la partie</button>
    </div>`;

  const timeEl = root.querySelector('[data-time]');
  const scoreEl = root.querySelector('[data-score]');
  const streakEl = root.querySelector('[data-streak]');
  const barEl = root.querySelector('[data-bar]');
  const promptEl = root.querySelector('[data-prompt]');
  const inputEl = root.querySelector('[data-input]');
  const flashEl = root.querySelector('[data-flash]');
  const recentEl = root.querySelector('[data-recent]');
  const gainsEl = root.querySelector('[data-gains]');
  const soundBtn = root.querySelector('[data-sound]');
  const form = root.querySelector('form');
  const countdownEl = root.querySelector('[data-countdown]');
  const cdNumEl = root.querySelector('[data-cd]');

  function paintSoundBtn() {
    soundBtn.textContent = audio.muted ? '🔇' : '♪';
    soundBtn.setAttribute('aria-pressed', String(audio.muted));
    soundBtn.title = audio.muted ? 'Remettre le son' : 'Couper le son';
  }
  soundBtn.onclick = () => {
    audio.toggleMute();
    paintSoundBtn();
    inputEl.focus({ preventScroll: true });
  };
  paintSoundBtn();

  function nextQuestion() {
    const [a, b] = pool[Math.floor(Math.random() * pool.length)];
    // Au niveau « Maître », une question sur trois cache un facteur.
    const hole = level.mode === 'trou' && Math.random() < 0.34;
    current = hole ? { text: `${a} × ? = ${a * b}`, answer: b } : { text: `${a} × ${b}`, answer: a * b };
    promptEl.textContent = current.text;
    inputEl.value = '';
    inputEl.focus({ preventScroll: true });
  }

  // Petit « +13 » qui s'envole à chaque bonne réponse.
  function showGain(points) {
    const el = document.createElement('span');
    el.className = 'gain';
    el.textContent = `+${points}`;
    el.style.left = `${45 + Math.random() * 20}%`;
    gainsEl.append(el);
    setTimeout(() => el.remove(), 900);
  }

  function pushRecent(ok, text, answer) {
    recent.unshift({ ok, text, answer });
    recent = recent.slice(0, 5);
    recentEl.innerHTML = recent
      .map((r) => `<li class="${r.ok ? 'ok' : 'ko'}"><span>${esc(r.text)}</span><strong>${r.answer}</strong></li>`)
      .join('');
  }

  function flash(message, ok) {
    flashEl.textContent = message;
    flashEl.className = `game-flash ${ok ? 'ok' : 'ko'}`;
    setTimeout(() => {
      if (alive && flashEl.textContent === message) flashEl.className = 'game-flash';
    }, 420);
  }

  function submit() {
    const raw = inputEl.value.trim();
    if (raw === '') return;
    const value = Number(raw.replace(/\s/g, ''));
    if (!Number.isFinite(value)) return;
    if (value === current.answer) {
      const gained = pointsFor(streak);
      score += gained;
      streak++;
      correct++;
      bestStreak = Math.max(bestStreak, streak);
      showGain(gained);
      audio.blip(true);
      flash(streak >= 3 ? `Juste ! série de ${streak}` : 'Juste !', true);
      pushRecent(true, current.text, current.answer);
      scoreEl.classList.remove('bump');
      void scoreEl.offsetWidth; // relance l'animation
      scoreEl.classList.add('bump');
    } else {
      wrong++;
      streak = 0;
      audio.blip(false);
      flash(`${current.text} = ${current.answer}`, false);
      pushRecent(false, current.text, current.answer);
    }
    scoreEl.textContent = score;
    streakEl.textContent = streak;
    nextQuestion();
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    submit();
  };
  // Validation automatique dès que la réponse ne peut plus grandir utilement :
  // l'élève n'a pas à appuyer sur Entrée pour enchaîner.
  inputEl.addEventListener('input', () => {
    const raw = inputEl.value.trim();
    if (raw === '') return;
    if (Number(raw) === current.answer) submit();
    else if (raw.length >= String(current.answer).length) submit();
  });

  root.querySelector('[data-give-up]').onclick = () => finish();

  // Décompte de départ. Le chrono de la partie ne commence qu'après.
  function runCountdown() {
    let left = COUNTDOWN_S;
    cdNumEl.textContent = left;
    countdownId = setInterval(() => {
      if (!alive) return;
      left -= 1;
      if (left > 0) {
        cdNumEl.textContent = left;
        cdNumEl.classList.remove('pulse');
        void cdNumEl.offsetWidth; // relance l'animation
        cdNumEl.classList.add('pulse');
        audio.countdown(false);
      } else {
        clearInterval(countdownId);
        countdownId = null;
        cdNumEl.textContent = 'Partez !';
        cdNumEl.classList.add('go');
        audio.countdown(true);
        setTimeout(begin, 500);
      }
    }, 1000);
  }

  function begin() {
    if (!alive) return;
    countdownEl.hidden = true;
    form.hidden = false;
    endsAt = Date.now() + duration * 1000;
    nextQuestion();
    timerId = setInterval(tick, 100);
    tick();
  }

  function tick() {
    if (!alive || endsAt === null) return;
    const left = Math.max(0, endsAt - Date.now());
    const s = Math.ceil(left / 1000);
    timeEl.textContent = s;
    barEl.style.width = `${(left / (duration * 1000)) * 100}%`;
    timeEl.classList.toggle('urgent', s <= 10);
    if (left <= 0) finish();
  }

  function finish() {
    if (!alive) return;
    alive = false;
    clearInterval(timerId);
    clearInterval(countdownId);
    audio.stop();
    onFinish({ score, correct, wrong, bestStreak, durationS: duration, levelId: level.id, details: { level: level.id } });
  }

  audio.start();
  runCountdown();

  return () => {
    alive = false;
    clearInterval(timerId);
    clearInterval(countdownId);
    audio.stop();
  };
}
