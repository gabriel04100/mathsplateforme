// Authentification : mots de passe hachés (bcrypt) + sessions par jeton aléatoire.
// Le jeton brut ne vit que dans le cookie de l'élève ; la base n'en garde que l'empreinte SHA-256.
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function createAuthService({ repos, config }) {
  const ttlMs = config.session.ttlDays * 24 * 3600 * 1000;
  // Hash factice : on compare toujours quelque chose pour ne pas révéler si un identifiant existe.
  const dummyHash = bcrypt.hashSync('pas-un-vrai-mot-de-passe', config.bcryptRounds);

  return {
    hashPassword: (plain) => bcrypt.hash(plain, config.bcryptRounds),

    async verifyCredentials(username, password) {
      const user = repos.users.findByUsername(String(username || '').trim());
      const ok = await bcrypt.compare(String(password || ''), user ? user.password_hash : dummyHash);
      if (!user || !ok || !user.active) return null;
      return user;
    },

    openSession(userId) {
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();
      repos.sessions.create(sha256(token), userId, expiresAt);
      repos.users.touchLogin(userId);
      return { token, expiresAt };
    },

    resolveSession(token) {
      if (!token) return null;
      return repos.sessions.findValid(sha256(token), new Date().toISOString()) || null;
    },

    closeSession(token) {
      if (token) repos.sessions.remove(sha256(token));
    },

    closeAllSessionsOf(userId) {
      repos.sessions.removeForUser(userId);
    },

    purgeExpired: () => repos.sessions.purgeExpired(new Date().toISOString()),
  };
}

module.exports = { createAuthService };
