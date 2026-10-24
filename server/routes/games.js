// Jeux : catalogue, enregistrement des parties et classement global.
// Accessible aux élèves comme aux enseignants (tous connectés).
const express = require('express');
const { requireAuth } = require('../middleware');

module.exports = function gamesRoutes({ games }) {
  const r = express.Router();
  r.use(requireAuth);

  r.get('/', (req, res) => res.json({ games: games.list() }));
  r.get('/:gameId', (req, res) => res.json({ game: games.get(req.params.gameId) }));

  r.get('/:gameId/leaderboard', (req, res) =>
    res.json(
      games.leaderboard(req.user, req.params.gameId, {
        period: req.query.periode,
        limit: req.query.limite,
        levelId: req.query.niveau,
        durationS: req.query.duree,
      })
    )
  );

  r.post('/:gameId/scores', (req, res) => res.status(201).json(games.record(req.user, req.params.gameId, req.body || {})));

  return r;
};
