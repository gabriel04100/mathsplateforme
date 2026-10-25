// Pseudonymes des comptes élèves.
//
// La plateforme ne connaît pas l'identité civile des élèves : un compte, c'est
// un identifiant de connexion et un pseudonyme. Le lien pseudonyme ↔ élève est
// tenu par l'enseignant, en dehors de la plateforme (une feuille de calcul).
// C'est ce qui permet d'exposer sans risque un classement de jeu, une liste de
// classe ou un diagnostic : aucune donnée nominative n'y circule.
//
// Un pseudonyme se lit à voix haute sans ambiguïté (pas de chiffre, pas de
// caractère exotique) parce qu'il est distribué en classe, et il s'accorde :
// « Loutre curieuse », pas « Loutre curieux ».
const crypto = require('node:crypto');

// [nom, genre]
const ANIMAUX = [
  ['Albatros', 'm'], ['Alpaga', 'm'], ['Axolotl', 'm'], ['Bison', 'm'], ['Blaireau', 'm'], ['Caméléon', 'm'],
  ['Capybara', 'm'], ['Castor', 'm'], ['Chouette', 'f'], ['Colibri', 'm'], ['Dauphin', 'm'], ['Écureuil', 'm'],
  ['Fennec', 'm'], ['Flamant', 'm'], ['Gecko', 'm'], ['Guépard', 'm'], ['Hérisson', 'm'], ['Héron', 'm'],
  ['Ibis', 'm'], ['Koala', 'm'], ['Lama', 'm'], ['Loutre', 'f'], ['Lynx', 'm'], ['Macareux', 'm'],
  ['Marmotte', 'f'], ['Mésange', 'f'], ['Narval', 'm'], ['Okapi', 'm'], ['Panda', 'm'], ['Pangolin', 'm'],
  ['Pélican', 'm'], ['Renard', 'm'], ['Salamandre', 'f'], ['Suricate', 'm'], ['Tatou', 'm'], ['Toucan', 'm'],
];

// [masculin, féminin]
const QUALITES = [
  ['agile', 'agile'], ['astucieux', 'astucieuse'], ['attentif', 'attentive'], ['audacieux', 'audacieuse'],
  ['calme', 'calme'], ['curieux', 'curieuse'], ['discret', 'discrète'], ['élégant', 'élégante'],
  ['espiègle', 'espiègle'], ['futé', 'futée'], ['intrépide', 'intrépide'], ['jovial', 'joviale'],
  ['limpide', 'limpide'], ['lucide', 'lucide'], ['malicieux', 'malicieuse'], ['méthodique', 'méthodique'],
  ['obstiné', 'obstinée'], ['patient', 'patiente'], ['pensif', 'pensive'], ['pétillant', 'pétillante'],
  ['placide', 'placide'], ['poli', 'polie'], ['prudent', 'prudente'], ['rapide', 'rapide'],
  ['rêveur', 'rêveuse'], ['rusé', 'rusée'], ['sage', 'sage'], ['serein', 'sereine'],
  ['soigneux', 'soigneuse'], ['tenace', 'tenace'], ['tranquille', 'tranquille'], ['vaillant', 'vaillante'],
];

// Ce qu'on accepte comme pseudonyme saisi à la main : des lettres, des espaces
// et des traits d'union. Pas de chiffre — un pseudonyme n'est pas un matricule,
// et surtout rien qui ressemble à un nom de famille suivi d'une initiale.
const PSEUDO_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ](?:[A-Za-zÀ-ÖØ-öø-ÿ'’\- ]{1,38}[A-Za-zÀ-ÖØ-öø-ÿ])$/;

const COMBINAISONS = ANIMAUX.length * QUALITES.length;

// Le pseudonyme numéro n, dans un ordre fixe. Sert au tirage aléatoire comme à
// l'attribution en lot : deux parcours différents du même espace de 1 152 noms.
function pseudonymeNumero(n) {
  const [animal, genre] = ANIMAUX[n % ANIMAUX.length];
  const [m, f] = QUALITES[Math.floor(n / ANIMAUX.length) % QUALITES.length];
  return `${animal} ${genre === 'f' ? f : m}`;
}

// Un pseudonyme libre. `estPris(nom)` dit si un nom est déjà utilisé ; on tire
// au hasard, puis on balaie l'espace si le tirage tombe sur des noms occupés —
// de cette façon on finit toujours par en trouver un tant qu'il en reste.
function genererPseudonyme(estPris = () => false) {
  const depart = crypto.randomInt(COMBINAISONS);
  for (let i = 0; i < COMBINAISONS; i++) {
    const nom = pseudonymeNumero((depart + i) % COMBINAISONS);
    if (!estPris(nom)) return nom;
  }
  // Les 1 152 combinaisons sont prises : on suffixe plutôt que d'échouer.
  for (let k = 2; ; k++) {
    const nom = `${pseudonymeNumero(depart)} ${k}`;
    if (!estPris(nom)) return nom;
  }
}

// Plusieurs pseudonymes d'un coup, tous distincts entre eux.
function genererPseudonymes(combien, estPris = () => false) {
  const deja = new Set();
  return Array.from({ length: combien }, () => {
    const nom = genererPseudonyme((n) => deja.has(n) || estPris(n));
    deja.add(nom);
    return nom;
  });
}

function nettoyerPseudonyme(brut) {
  const nom = String(brut || '').trim().replace(/\s+/g, ' ');
  return PSEUDO_RE.test(nom) ? nom : null;
}

module.exports = { ANIMAUX, QUALITES, COMBINAISONS, PSEUDO_RE, pseudonymeNumero, genererPseudonyme, genererPseudonymes, nettoyerPseudonyme };
