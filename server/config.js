// Configuration centralisée — tout ce qui change entre dev / prod passe par ici.
// Auteur : Gabriel Pizzo
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const env = process.env.NODE_ENV || 'development';

function int(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : fallback;
}

module.exports = {
  env,
  isProd: env === 'production',
  port: int('PORT', 3000),
  root,
  // Base SQLite (fichier). Pour passer à PostgreSQL, seul server/db/ et les repositories changent.
  dbFile: process.env.DB_FILE || path.join(root, 'data', 'plateforme.sqlite'),
  contentDir: process.env.CONTENT_DIR || path.join(root, 'content'),
  publicDir: path.join(root, 'public'),
  session: {
    cookieName: 'mp_session',
    ttlDays: int('SESSION_TTL_DAYS', 30),
  },
  bcryptRounds: int('BCRYPT_ROUNDS', 10),
  loginRateLimit: {
    windowMs: 15 * 60 * 1000,
    max: int('LOGIN_MAX_ATTEMPTS', 10),
  },
  // Compte enseignant créé automatiquement au premier démarrage s'il n'en existe aucun.
  bootstrapTeacher: {
    username: process.env.TEACHER_USERNAME || '',
    password: process.env.TEACHER_PASSWORD || '',
    displayName: process.env.TEACHER_NAME || 'Gabriel Pizzo',
  },
};
