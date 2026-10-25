// Source de hasard des exercices, qu'on peut rendre reproductible.
//
// Les questions sont tirées dans le navigateur — c'est ce qui rend la
// plateforme instantanée. Mais le score ne peut pas être calculé là : rien
// n'empêcherait un élève d'en envoyer un faux. La solution est que les deux
// côtés tirent *les mêmes* questions : le serveur donne une graine, le
// navigateur joue, et le serveur rejoue la même série pour corriger lui-même.
//
// Tout le hasard des générateurs passe donc par `random()` plutôt que par
// Math.random, afin qu'une graine suffise à reproduire une série entière.

let source = Math.random;

export const random = () => source();

// Générateur congruentiel « mulberry32 » : court, rapide, et de qualité
// largement suffisante pour tirer des énoncés.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Une graine est une chaîne (hexadécimale en pratique) : on la replie sur 32 bits.
function hash(seed) {
  let h = 2166136261;
  for (const c of String(seed)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Joue `fn` avec une suite de tirages reproductible, puis rend le hasard
// ordinaire. Le try/finally compte : si un générateur échoue, le hasard figé
// ne doit pas contaminer la suite de la page — ni les requêtes suivantes du
// serveur, où l'exécution est synchrone, donc ce bloc est atomique.
export function withSeed(seed, fn) {
  const avant = source;
  source = mulberry32(hash(seed));
  try {
    return fn();
  } finally {
    source = avant;
  }
}
