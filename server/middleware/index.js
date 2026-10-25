// Middlewares transverses : sécurité, session, rôles, limitation, erreurs.

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* cookie mal formé : ignoré */
    }
  }
  return out;
}

function securityHeaders(req, res, next) {
  // Tout vient du site, à une exception près : les vidéos YouTube intégrées
  // dans un cours. Elles sont chargées depuis youtube-nocookie.com, et
  // seulement si l'élève clique sur la vignette — aucune requête n'est faite
  // à Google tant qu'il ne l'a pas décidé (voir la note RGPD du README).
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
      "font-src 'self' data:; script-src 'self'; frame-src https://www.youtube-nocookie.com; " +
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
}

// Protection CSRF simple : toute requête qui modifie quelque chose doit être du JSON
// (un formulaire d'un autre site ne peut pas envoyer ce type sans pré-vérification CORS).
function requireJsonForWrites(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
    return res.status(415).json({ error: 'Requête JSON attendue' });
  }
  next();
}

function sessionMiddleware({ auth, config }) {
  return (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[config.session.cookieName];
    const row = auth.resolveSession(token);
    req.sessionToken = token || null;
    req.user = row
      ? { id: row.id, username: row.username, role: row.role, display_name: row.display_name, class_id: row.class_id }
      : null;
    next();
  };
}

const requireAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Connexion requise' }));

const requireRole = (role) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Connexion requise' });
  if (req.user.role !== role) return res.status(403).json({ error: 'Accès réservé' });
  next();
};

// Limiteur en mémoire. Suffisant sur un seul serveur ; avec plusieurs instances, le remplacer par Redis.
function rateLimiter({ windowMs, max, keyFn }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs).unref();
  return {
    check(req) {
      const key = keyFn(req);
      const now = Date.now();
      let e = hits.get(key);
      if (!e || e.reset <= now) {
        e = { count: 0, reset: now + windowMs };
        hits.set(key, e);
      }
      return { key, blocked: e.count >= max, retryAfter: Math.ceil((e.reset - now) / 1000) };
    },
    fail(key) {
      const e = hits.get(key);
      if (e) e.count++;
    },
    clear(key) {
      hits.delete(key);
    },
  };
}

function errorHandler(log) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Requête trop volumineuse' });
    const status = err.status && err.status < 500 ? err.status : 500;
    if (status === 500) log.error(err);
    res.status(status).json({ error: status === 500 ? 'Erreur interne' : err.message });
  };
}

module.exports = { parseCookies, securityHeaders, requireJsonForWrites, sessionMiddleware, requireAuth, requireRole, rateLimiter, errorHandler };
