// Assemblage de l'application. Exporte une fabrique pour pouvoir lancer
// plusieurs instances (tests, futurs workers) avec leurs propres dépendances.
const path = require('node:path');
const express = require('express');
const { openDatabase, migrate } = require('./db');
const { createRepositories } = require('./repositories');
const { createContentService } = require('./services/content');
const { createAuthService } = require('./services/auth');
const { createProgressService } = require('./services/progress');
const { createAccountsService } = require('./services/accounts');
const { createExercisesService } = require('./services/exercises');
const { createChaptersService } = require('./services/chapters');
const { createGamesService } = require('./services/games');
const { createDocumentsService } = require('./services/documents');
const { createSeriesService } = require('./services/series');
const { loadSharedModules } = require('./shared-modules');
const mw = require('./middleware');

// Asynchrone parce que le code partagé avec le navigateur (rendu des cours,
// moteur des modèles d'exercices) est chargé une fois ici, au démarrage.
async function createApp(config, { log = console } = {}) {
  const db = openDatabase(config.dbFile);
  migrate(db, (m) => log.info?.(m));

  const shared = await loadSharedModules();
  const repos = createRepositories(db);
  const content = createContentService(config.contentDir);
  const auth = createAuthService({ repos, config });
  const series = createSeriesService({ repos, shared });
  const exercises = createExercisesService({ repos, shared, content, series });
  const chapters = createChaptersService({ repos, content, exercises, shared });
  const progress = createProgressService({ repos, content, chapters, exercises, series });
  const accounts = createAccountsService({ repos, auth, content });
  const games = createGamesService({ repos });
  const documents = createDocumentsService({ repos, config, content });
  const services = { repos, content, auth, progress, accounts, exercises, chapters, games, documents, series, config };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy); // voir TRUST_PROXY dans config.js
  app.use(mw.securityHeaders);

  // Fichiers statiques : l'application web + KaTeX servi localement (aucun CDN externe).
  const vendor = (url, dir) => app.use(url, express.static(path.join(config.root, 'node_modules', ...dir), { maxAge: '30d', immutable: true }));
  vendor('/vendor/katex', ['katex', 'dist']);
  vendor('/vendor/fonts/bricolage', ['@fontsource-variable', 'bricolage-grotesque']);
  vendor('/vendor/fonts/lexend', ['@fontsource-variable', 'lexend']);
  app.use(express.static(config.publicDir, { maxAge: config.isProd ? '1h' : 0 }));

  const api = express.Router();
  api.use(express.json({ limit: '200kb' }));
  api.use(mw.requireJsonForWrites);
  api.use(mw.sessionMiddleware({ auth, config }));
  api.get('/health', (req, res) => res.json({ ok: true, content: content.stats() }));
  api.use('/auth', require('./routes/auth')(services));
  api.use('/teacher', require('./routes/teacher')(services));
  api.use('/games', require('./routes/games')(services));
  api.use('/documents', require('./routes/documents')(services));
  api.use('/', require('./routes/learning')(services));
  api.use((req, res) => res.status(404).json({ error: 'Route inconnue' }));
  app.use('/api', api);

  // Application monopage : toute autre URL renvoie index.html.
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(config.publicDir, 'index.html')));
  app.use(mw.errorHandler(log));

  return { app, db, services };
}

module.exports = { createApp };
