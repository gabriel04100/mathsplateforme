// Traduction du contenu affiché. Réservée aux comptes connectés : c'est une
// aide à la lecture du cours, pas un service de traduction ouvert.
const express = require('express');
const { requireAuth } = require('../middleware');

module.exports = function translateRoutes({ translate }) {
  const r = express.Router();
  r.use(requireAuth);

  r.get('/', (req, res) => res.json(translate.etat()));

  r.post('/', async (req, res, next) => {
    try {
      res.json(await translate.traduire(req.body?.target, req.body?.texts));
    } catch (e) {
      next(e);
    }
  });

  return r;
};
