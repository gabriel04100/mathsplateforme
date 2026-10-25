// Traduction automatique du contenu affiché, pour les élèves allophones.
//
// Trois principes :
//  1. Le navigateur de l'élève ne parle jamais au traducteur. Il demande au
//     serveur, qui appelle le fournisseur. Aucune adresse IP d'élève ne part
//     chez un tiers, et la politique de sécurité du site (CSP) reste fermée.
//  2. Rien n'est envoyé qui ne soit déjà du contenu pédagogique public : on ne
//     traduit que les textes affichés (cours, consignes, interface). Jamais un
//     pseudonyme, un identifiant, un score.
//  3. Tout est mis en cache : un paragraphe de cours est traduit une fois pour
//     toute la classe.
//
// Aucun fournisseur n'est configuré par défaut : la fonction est alors
// simplement annoncée comme indisponible. Voir le README pour l'activer, avec
// une instance LibreTranslate (auto-hébergeable) ou l'API Google Translate.
const crypto = require('node:crypto');

class TranslateError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Langues proposées : celles qu'on rencontre le plus souvent dans les classes,
// plus les langues vivantes enseignées au collège.
const LANGUES = [
  { id: 'en', label: 'English', natif: 'Anglais' },
  { id: 'es', label: 'Español', natif: 'Espagnol' },
  { id: 'pt', label: 'Português', natif: 'Portugais' },
  { id: 'it', label: 'Italiano', natif: 'Italien' },
  { id: 'de', label: 'Deutsch', natif: 'Allemand' },
  { id: 'ar', label: 'العربية', natif: 'Arabe', rtl: true },
  { id: 'tr', label: 'Türkçe', natif: 'Turc' },
  { id: 'ru', label: 'Русский', natif: 'Russe' },
  { id: 'uk', label: 'Українська', natif: 'Ukrainien' },
  { id: 'ro', label: 'Română', natif: 'Roumain' },
  { id: 'sq', label: 'Shqip', natif: 'Albanais' },
  { id: 'zh', label: '中文', natif: 'Chinois' },
  { id: 'bn', label: 'বাংলা', natif: 'Bengali' },
  { id: 'ta', label: 'தமிழ்', natif: 'Tamoul' },
  { id: 'fa', label: 'فارسی', natif: 'Persan', rtl: true },
  { id: 'pl', label: 'Polski', natif: 'Polonais' },
];
const CODES = new Set(LANGUES.map((l) => l.id));
const MAX_TEXTES = 200;
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---------- fournisseurs ----------
// Chacun reçoit la liste des textes et rend la liste des traductions, dans le
// même ordre. Pour en ajouter un : une fonction ici, un nom dans FOURNISSEURS.

async function libretranslate({ url, key }, target, textes) {
  const res = await fetch(`${url.replace(/\/$/, '')}/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ q: textes, source: 'fr', target, format: 'text', ...(key ? { api_key: key } : {}) }),
  });
  if (!res.ok) throw new TranslateError(`Le service de traduction a répondu ${res.status}`, 502);
  const data = await res.json();
  const out = Array.isArray(data.translatedText) ? data.translatedText : [data.translatedText];
  if (out.length !== textes.length) throw new TranslateError('Réponse de traduction incomplète', 502);
  return out.map(String);
}

async function google({ key }, target, textes) {
  const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ q: textes, source: 'fr', target, format: 'text' }),
  });
  if (!res.ok) throw new TranslateError(`Le service de traduction a répondu ${res.status}`, 502);
  const data = await res.json();
  const out = data?.data?.translations;
  if (!Array.isArray(out) || out.length !== textes.length) throw new TranslateError('Réponse de traduction incomplète', 502);
  return out.map((t) => String(t.translatedText));
}

const FOURNISSEURS = { libretranslate, google };

function createTranslateService({ repos, config }) {
  const reglage = config.translate || {};
  const fournisseur = FOURNISSEURS[reglage.provider];
  const actif = !!fournisseur && (reglage.provider !== 'libretranslate' || !!reglage.url) && (reglage.provider !== 'google' || !!reglage.key);

  return {
    LANGUES,

    // Ce que le navigateur demande au chargement : la liste des langues, et si
    // la fonction est utilisable ici.
    etat() {
      return { available: actif, languages: actif ? LANGUES : [], provider: actif ? reglage.provider : null };
    },

    async traduire(target, textesBruts) {
      if (!actif) throw new TranslateError('La traduction automatique n’est pas configurée sur ce serveur', 503);
      if (!CODES.has(target)) throw new TranslateError('Langue inconnue');
      if (!Array.isArray(textesBruts) || !textesBruts.length) throw new TranslateError('Rien à traduire');
      if (textesBruts.length > MAX_TEXTES) throw new TranslateError(`${MAX_TEXTES} textes au maximum par envoi`);

      const textes = textesBruts.map((t) => String(t ?? '').trim()).filter(Boolean);
      const total = textes.reduce((n, t) => n + t.length, 0);
      if (total > (reglage.maxCharsPerRequest || 8000)) throw new TranslateError('Envoi trop long : coupe en plusieurs morceaux');

      // Un seul exemplaire de chaque texte, et seulement ceux qu'on n'a pas déjà.
      const uniques = [...new Set(textes)];
      const connus = repos.translations.getMany(target, uniques.map(hash));
      const aFaire = uniques.filter((t) => !connus.has(hash(t)));
      if (aFaire.length) {
        const faites = await fournisseur(reglage, target, aFaire);
        repos.translations.saveMany(target, aFaire.map((source, i) => ({ sourceHash: hash(source), source, translated: faites[i] })));
        aFaire.forEach((source, i) => connus.set(hash(source), faites[i]));
      }

      // On rend un dictionnaire texte source → traduction : le navigateur s'en
      // sert pour remplacer en place, sans dépendre de l'ordre.
      const out = {};
      for (const t of uniques) out[t] = connus.get(hash(t)) ?? t;
      return { target, translations: out, rtl: !!LANGUES.find((l) => l.id === target)?.rtl };
    },
  };
}

module.exports = { createTranslateService, TranslateError, LANGUES };
