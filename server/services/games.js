// Jeux et classement global.
// Les jeux sont communs à toutes les classes : le classement mélange tous les
// élèves de la plateforme, quel que soit leur professeur ou leur niveau.
//
// Les parties se jouent dans le navigateur ; le serveur ne reçoit que le
// résultat. Il le confronte donc aux limites du jeu (nombre de réponses
// possibles dans le temps imparti, points maximum par réponse) avant de
// l'enregistrer : un score envoyé à la main est rejeté s'il est hors d'atteinte.

class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Barème commun : une bonne réponse vaut 10 points, plus 1 point par bonne
// réponse d'affilée (bonus plafonné à 10). Une réponse vaut donc 10 à 20 points.
const BASE_POINTS = 10;
const MAX_STREAK_BONUS = 10;

// Les niveaux fixent les tables ET le type de question. C'est ce qui rend les
// scores comparables : on ne classe ensemble que des parties jouées au même
// niveau et sur la même durée (voir « variante » plus bas).
const TABLE_LEVELS = [
  { id: 'decouverte', label: 'Découverte', hint: 'Les tables de 2 à 5', tables: [2, 3, 4, 5], mode: 'produit' },
  { id: 'classique', label: 'Classique', hint: 'Les tables de 2 à 10', tables: [2, 3, 4, 5, 6, 7, 8, 9, 10], mode: 'produit' },
  { id: 'expert', label: 'Expert', hint: "Jusqu'à la table de 12", tables: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], mode: 'produit' },
  { id: 'maitre', label: 'Maître', hint: 'Jusqu’à 12, avec des trous : 7 × ? = 56', tables: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], mode: 'trou' },
];

const GAMES = {
  'tables-multiplication': {
    id: 'tables-multiplication',
    title: 'Les tables de multiplication',
    tagline: 'Combien de produits avant la fin du chrono ?',
    description: "Enchaîne le plus de bonnes réponses possible avant la fin du chrono. Les bonnes réponses d'affilée rapportent de plus en plus.",
    levels: TABLE_LEVELS,
    defaultLevel: 'classique',
    durations: [30, 60, 120],
    defaultDuration: 60,
    // Un élève très rapide répond environ deux fois par seconde : au-delà, c'est impossible.
    maxAnswersPerSecond: 2.5,
  },
};

// Une partie n'est comparable qu'à celles du même niveau et de la même durée.
const variantOf = (levelId, durationS) => `${levelId}|${durationS}`;

const PERIODS = {
  tout: { label: 'Depuis toujours', days: null },
  mois: { label: 'Ce mois-ci', days: 30 },
  semaine: { label: 'Cette semaine', days: 7 },
};

const EPOCH = '1970-01-01T00:00:00.000Z';
const sinceIso = (period) => {
  const days = PERIODS[period]?.days;
  return days ? new Date(Date.now() - days * 86400000).toISOString() : EPOCH;
};

function createGamesService({ repos }) {
  const publicGame = (g) => ({
    id: g.id,
    title: g.title,
    tagline: g.tagline,
    description: g.description,
    levels: g.levels,
    defaultLevel: g.defaultLevel,
    durations: g.durations,
    defaultDuration: g.defaultDuration,
    // Le barème est annoncé aux élèves : il doit être le même ici et dans le jeu.
    scoring: { basePoints: BASE_POINTS, maxStreakBonus: MAX_STREAK_BONUS },
  });

  function requireGame(gameId) {
    const g = GAMES[gameId];
    if (!g) throw new GameError('Jeu inconnu', 404);
    return g;
  }

  function requireLevel(game, levelId) {
    const level = (game.levels || []).find((l) => l.id === levelId);
    if (!level) throw new GameError('Niveau inconnu', 404);
    return level;
  }

  return {
    PERIODS,

    list: () => Object.values(GAMES).map(publicGame),

    get(gameId) {
      return publicGame(requireGame(gameId));
    },

    // Classement global : meilleur score par élève, toutes classes confondues,
    // mais à armes égales — même niveau et même durée.
    leaderboard(user, gameId, { period = 'tout', limit = 20, levelId, durationS } = {}) {
      const game = requireGame(gameId);
      if (!PERIODS[period]) period = 'tout';
      const level = requireLevel(game, levelId || game.defaultLevel);
      const duration = game.durations.includes(Number(durationS)) ? Number(durationS) : game.defaultDuration;
      const variant = variantOf(level.id, duration);
      const since = sinceIso(period);
      const n = Math.min(Math.max(Number(limit) || 20, 3), 100);
      const rows = repos.gameScores.leaderboard(gameId, variant, since, n);
      const entries = rows.map((r, i) => ({
        rank: i + 1,
        userId: r.user_id,
        displayName: r.display_name,
        className: r.class_name,
        classLevel: r.class_level,
        isTeacher: r.role === 'teacher',
        bestScore: r.best_score,
        bestStreak: r.best_streak,
        plays: r.plays,
        lastAt: r.last_at,
        me: r.user_id === user.id,
      }));

      // Mon meilleur score et mon rang, même si je ne suis pas dans le haut du tableau.
      const mine = repos.gameScores.bestForUser(user.id, gameId, variant, since);
      const me =
        mine && mine.best_score != null
          ? {
              bestScore: mine.best_score,
              bestStreak: mine.best_streak,
              plays: mine.plays,
              rank: repos.gameScores.rankForScore(gameId, variant, since, mine.best_score),
              inTable: entries.some((e) => e.me),
            }
          : null;

      return { gameId, period, periods: PERIODS, levelId: level.id, levelLabel: level.label, durationS: duration, entries, me };
    },

    // Enregistre une partie après avoir vérifié qu'elle est atteignable.
    record(user, gameId, body) {
      const game = requireGame(gameId);
      const int = (v, name) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0) throw new GameError(`${name} invalide`);
        return n;
      };
      const durationS = int(body?.durationS, 'Durée');
      if (!game.durations.includes(durationS)) throw new GameError('Durée de partie invalide');
      const level = requireLevel(game, body?.levelId);
      const correct = int(body?.correct, 'Nombre de bonnes réponses');
      const wrong = int(body?.wrong, 'Nombre de mauvaises réponses');
      const bestStreak = int(body?.bestStreak, 'Meilleure série');
      const score = int(body?.score, 'Score');

      const maxAnswers = Math.ceil(durationS * game.maxAnswersPerSecond);
      if (correct + wrong > maxAnswers) throw new GameError('Score impossible : trop de réponses pour la durée de la partie');
      if (bestStreak > correct) throw new GameError('Score impossible : série plus longue que le nombre de bonnes réponses');
      const minScore = correct * BASE_POINTS;
      const maxScore = correct * (BASE_POINTS + MAX_STREAK_BONUS);
      if (score < minScore || score > maxScore) throw new GameError('Score impossible : il ne correspond pas aux réponses envoyées');

      // Garde-fou anti-inondation : on ne garde pas plus de 200 parties par heure et par élève.
      if (repos.gameScores.countForUserSince(user.id, new Date(Date.now() - 3600000).toISOString()) >= 200) {
        throw new GameError('Trop de parties enregistrées, réessaie dans un moment', 429);
      }

      const variant = variantOf(level.id, durationS);
      // Le record personnel se mesure sur la même variante, avant d'enregistrer celle-ci.
      const previousBest = repos.gameScores.bestForUser(user.id, gameId, variant, EPOCH);
      const details = body?.details && typeof body.details === 'object' ? JSON.stringify(body.details).slice(0, 1000) : null;
      repos.gameScores.create({ userId: user.id, gameId, variant, score, correct, wrong, bestStreak, durationS, details });

      return {
        saved: true,
        score,
        levelId: level.id,
        levelLabel: level.label,
        durationS,
        personalBest: Math.max(score, previousBest?.best_score ?? 0),
        isPersonalBest: score > (previousBest?.best_score ?? -1),
        rank: repos.gameScores.rankForScore(gameId, variant, EPOCH, score),
      };
    },
  };
}

module.exports = { createGamesService, GameError, GAMES, BASE_POINTS, MAX_STREAK_BONUS };
