const express = require('express');
const { rateLimiter } = require('../middleware');

module.exports = function authRoutes({ auth, config, repos }) {
  const r = express.Router();
  const limiter = rateLimiter({
    windowMs: config.loginRateLimit.windowMs,
    max: config.loginRateLimit.max,
    keyFn: (req) => `${req.ip}|${String(req.body?.username || '').toLowerCase()}`,
  });

  const cookieOpts = (expiresAt) => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path: '/',
    ...(expiresAt ? { expires: new Date(expiresAt) } : {}),
  });

  r.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    const lim = limiter.check(req);
    if (lim.blocked) {
      res.setHeader('Retry-After', lim.retryAfter);
      return res.status(429).json({ error: `Trop de tentatives. Réessaie dans ${Math.ceil(lim.retryAfter / 60)} min.` });
    }
    const user = await auth.verifyCredentials(username, password);
    if (!user) {
      limiter.fail(lim.key);
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
    }
    limiter.clear(lim.key);
    if (req.sessionToken) auth.closeSession(req.sessionToken);
    const { token, expiresAt } = auth.openSession(user.id);
    res.cookie(config.session.cookieName, token, cookieOpts(expiresAt));
    res.json({ user: publicUser(repos, user) });
  });

  r.post('/logout', (req, res) => {
    auth.closeSession(req.sessionToken);
    res.clearCookie(config.session.cookieName, cookieOpts());
    res.json({ ok: true });
  });

  r.get('/me', (req, res) => {
    // 200 dans les deux cas : « pas connecté » est un état normal au premier chargement.
    res.json({ user: req.user ? publicUser(repos, req.user) : null });
  });

  return r;
};

function publicUser(repos, u) {
  const cls = u.class_id ? repos.classes.findById(u.class_id) : null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    class: cls ? { id: cls.id, name: cls.name, level: cls.level } : null,
  };
}
