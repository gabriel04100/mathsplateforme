// Onglet Jeux : commun à toutes les classes, avec un classement global.
// Un score n'est comparé qu'à armes égales : même niveau, même durée.
import { api } from '../api.js';
import { esc, toast } from '../ui.js';
import { mountTablesGame } from '../games/tables.js';

// Chaque jeu déclare sa fonction de montage. Les niveaux et les durées viennent
// du serveur : c'est lui qui fait autorité pour valider les scores.
const GAME_UI = {
  'tables-multiplication': { mount: mountTablesGame },
};

export async function gamesHomeView({ el }) {
  const { games } = await api.get('/games');
  el.innerHTML = `
  <section class="page">
    <header class="page-head">
      <h1>Jeux</h1>
      <p class="muted">Des défis courts pour s’entraîner autrement. Les classements réunissent tous les élèves de la plateforme, toutes classes confondues.</p>
    </header>
    <div class="game-list">
      ${games
        .map(
          (g) => `<a class="game-card" href="/jeux/${g.id}" data-link>
            <span class="game-ico" aria-hidden="true">✕</span>
            <span class="game-body">
              <strong>${esc(g.title)}</strong>
              <span class="muted">${esc(g.tagline)}</span>
            </span>
            <span class="game-go" aria-hidden="true">→</span>
          </a>`
        )
        .join('')}
    </div>
  </section>`;
}

export async function gameView({ el, params: [gameId] }) {
  const ui = GAME_UI[gameId];
  if (!ui) throw new Error('Ce jeu n’existe pas.');
  const { game } = await api.get(`/games/${gameId}`);

  let screen = 'reglages'; // reglages | partie | resultat
  let levelId = game.defaultLevel;
  let duration = game.defaultDuration;
  let lastResult = null;
  let period = 'tout';
  let cleanupGame = null;

  const levelOf = (id) => game.levels.find((l) => l.id === id) || game.levels[0];

  function stopGame() {
    if (cleanupGame) {
      cleanupGame();
      cleanupGame = null;
    }
  }

  function draw() {
    stopGame();
    el.innerHTML = `
    <section class="page game-page">
      <nav class="crumbs"><a href="/jeux" data-link>Jeux</a> <span aria-hidden="true">/</span> ${esc(game.title)}</nav>
      <div class="game-layout">
        <div class="game-main" id="game-main"></div>
        <aside class="game-board" id="board"><p class="muted">Chargement du classement…</p></aside>
      </div>
    </section>`;
    const main = el.querySelector('#game-main');

    if (screen === 'reglages') drawSettings(main);
    else if (screen === 'partie') drawPlay(main);
    else drawResult(main);

    drawBoard();
  }

  function rulesHtml() {
    const { basePoints, maxStreakBonus } = game.scoring;
    return `<div class="rules">
      <h2>Comment on marque des points</h2>
      <ul>
        <li><strong>${basePoints} points</strong> par bonne réponse.</li>
        <li><strong>+1 point</strong> par bonne réponse d’affilée : la 2<sup>e</sup> vaut ${basePoints + 1}, la 3<sup>e</sup> ${basePoints + 2}… jusqu’à <strong>${basePoints + maxStreakBonus} points</strong>.</li>
        <li>Une erreur ne retire aucun point, mais <strong>remet la série à zéro</strong>.</li>
      </ul>
      <p class="muted small">Chaque niveau et chaque durée ont leur propre classement : on ne compare que des parties jouées dans les mêmes conditions.</p>
    </div>`;
  }

  function drawSettings(main) {
    main.innerHTML = `
      <header class="page-head"><h1>${esc(game.title)}</h1><p class="muted">${esc(game.description)}</p></header>
      <form class="panel game-settings" novalidate>
        <fieldset class="field">
          <legend>Choisis ton niveau</legend>
          <div class="levels">
            ${game.levels
              .map(
                (l) => `<label class="level-opt">
                  <input type="radio" name="level" value="${l.id}"${l.id === levelId ? ' checked' : ''}>
                  <span class="level-card">
                    <strong>${esc(l.label)}</strong>
                    <span class="muted small">${esc(l.hint)}</span>
                    <span class="level-tables">${l.tables.map((t) => `<em>${t}</em>`).join('')}</span>
                  </span>
                </label>`
              )
              .join('')}
          </div>
        </fieldset>
        <fieldset class="field">
          <legend>Durée de la partie</legend>
          <div class="chips">
            ${game.durations
              .map(
                (d) => `<label class="chip"><input type="radio" name="duration" value="${d}"${d === duration ? ' checked' : ''}><span>${d} s</span></label>`
              )
              .join('')}
          </div>
        </fieldset>
        <button class="btn big" type="submit">Commencer</button>
      </form>
      ${rulesHtml()}`;

    const form = main.querySelector('form');
    // Le classement affiché suit le niveau et la durée sélectionnés, avant même de jouer.
    form.addEventListener('change', () => {
      levelId = form.level.value;
      duration = Number(form.duration.value);
      drawBoard();
    });
    form.onsubmit = (e) => {
      e.preventDefault();
      levelId = form.level.value;
      duration = Number(form.duration.value);
      screen = 'partie';
      draw();
    };
  }

  function drawPlay(main) {
    const level = levelOf(levelId);
    main.innerHTML = `
      <header class="page-head row">
        <div><h1>${esc(game.title)}</h1><p class="muted">Niveau ${esc(level.label)} · ${duration} secondes</p></div>
      </header>
      <div id="stage"></div>`;
    cleanupGame = ui.mount(main.querySelector('#stage'), { level, duration }, {
      onFinish: async (result) => {
        lastResult = { ...result, saving: true };
        screen = 'resultat';
        draw();
        try {
          const saved = await api.post(`/games/${gameId}/scores`, result);
          lastResult = { ...result, ...saved, saving: false };
        } catch (e) {
          lastResult = { ...result, saving: false, error: e.message };
          toast(e.message, 'error');
        }
        if (screen === 'resultat') draw();
      },
    });
  }

  function drawResult(main) {
    const r = lastResult || {};
    const level = levelOf(r.levelId || levelId);
    const total = (r.correct || 0) + (r.wrong || 0);
    const accuracy = total ? Math.round((100 * r.correct) / total) : 0;
    main.innerHTML = `
      <header class="page-head"><h1>Partie terminée</h1>
        <p class="muted">Niveau ${esc(level.label)} · ${r.durationS ?? duration} secondes</p></header>
      <div class="panel result-card ${r.isPersonalBest && !r.saving && !r.error ? 'record' : ''}">
        ${r.isPersonalBest && !r.saving && !r.error ? '<p class="record-flag">Nouveau record personnel !</p>' : ''}
        <p class="big-score"><span>${r.score ?? 0}</span> points</p>
        <ul class="result-stats">
          <li><strong>${r.correct ?? 0}</strong><span>bonnes réponses</span></li>
          <li><strong>${r.wrong ?? 0}</strong><span>erreurs</span></li>
          <li><strong>${accuracy} %</strong><span>de réussite</span></li>
          <li><strong>${r.bestStreak ?? 0}</strong><span>meilleure série</span></li>
        </ul>
        <p class="muted save-state">${
          r.saving
            ? 'Enregistrement du score…'
            : r.error
              ? esc(r.error)
              : r.rank
                ? `Score enregistré. Tu es <strong>${r.rank}<sup>${r.rank === 1 ? 'er' : 'e'}</sup></strong> en ${esc(level.label)} sur ${r.durationS} secondes.`
                : 'Score enregistré.'
        }</p>
        <div class="w-actions">
          <button type="button" class="btn" data-again>Rejouer</button>
          <button type="button" class="btn ghost" data-settings>Changer de niveau</button>
        </div>
      </div>
      ${rulesHtml()}`;
    main.querySelector('[data-again]').onclick = () => {
      screen = 'partie';
      draw();
    };
    main.querySelector('[data-settings]').onclick = () => {
      screen = 'reglages';
      draw();
    };
  }

  async function drawBoard() {
    const board = el.querySelector('#board');
    if (!board) return;
    const shownLevel = levelOf(screen === 'resultat' && lastResult?.levelId ? lastResult.levelId : levelId);
    const shownDuration = screen === 'resultat' && lastResult?.durationS ? lastResult.durationS : duration;
    let data;
    try {
      data = await api.get(`/games/${gameId}/leaderboard?periode=${period}&niveau=${shownLevel.id}&duree=${shownDuration}`);
    } catch (e) {
      board.innerHTML = `<p class="form-error">${esc(e.message)}</p>`;
      return;
    }
    const me = data.me;
    board.innerHTML = `
      <div class="board-head">
        <h2>Classement</h2>
        <p class="muted small">Niveau <strong>${esc(data.levelLabel)}</strong> · ${data.durationS} secondes · tous les élèves de la plateforme.</p>
      </div>
      <div class="seg small" role="tablist" aria-label="Période">
        ${Object.entries(data.periods)
          .map(([key, p]) => `<button type="button" role="tab" class="seg-btn" aria-selected="${key === period}" data-period="${key}">${esc(p.label)}</button>`)
          .join('')}
      </div>
      ${
        data.entries.length
          ? `<ol class="board">${data.entries
              .map(
                (e) => `<li class="${e.me ? 'me' : ''}${e.rank <= 3 ? ` podium p${e.rank}` : ''}">
                  <span class="b-rank">${e.rank}</span>
                  <span class="b-who"><strong>${esc(e.displayName)}</strong><span class="muted small">${
                    e.isTeacher ? 'professeur' : e.className ? esc(e.className) : 'sans classe'
                  }</span></span>
                  <span class="b-score">${e.bestScore}<span class="muted small">série ${e.bestStreak}</span></span>
                </li>`
              )
              .join('')}</ol>`
          : '<p class="muted">Personne n’a encore joué à ce niveau sur cette durée. À toi de lancer le classement !</p>'
      }
      ${
        me && !me.inTable
          ? `<div class="board-me"><p class="muted small">Ton meilleur score</p>
              <div class="board-me-row"><span class="b-rank">${me.rank}</span><span class="b-who"><strong>Toi</strong></span><span class="b-score">${me.bestScore}</span></div></div>`
          : ''
      }
      ${me ? `<p class="muted small">${me.plays} partie${me.plays > 1 ? 's' : ''} jouée${me.plays > 1 ? 's' : ''} dans ces conditions.</p>` : ''}`;

    board.querySelectorAll('[data-period]').forEach(
      (b) =>
        (b.onclick = () => {
          period = b.dataset.period;
          drawBoard();
        })
    );
  }

  draw();
  return stopGame;
}
