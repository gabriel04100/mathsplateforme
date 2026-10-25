// Traduction de l'affichage, pour les élèves allophones.
//
// Le principe : on ne retraduit pas la page, on remplace le texte à l'intérieur
// du HTML déjà construit. Les nœuds de texte sont relevés, envoyés au serveur
// (qui seul parle au traducteur), et réécrits en place. La structure, les
// figures et les formules ne sont pas touchées.
//
// Ce qu'on ne traduit jamais : les formules rendues par KaTeX (ce sont des
// mathématiques, pas de la langue), le code et les identifiants, et le
// pseudonyme de l'élève. D'où la liste IGNORE et l'attribut
// `data-no-translate`, à poser sur tout ce qui doit rester tel quel.
import { api } from './api.js';

const CLE = 'mp_langue';
const MAX_PAR_ENVOI = 180;
const IGNORE = '.katex, .katex-display, code, pre, kbd, samp, script, style, svg, [data-no-translate]';

let etat = null; // { available, languages }
let langue = null;
let rtl = false;
const cache = new Map(); // `${langue}\n${texte}` → traduction

const lireChoix = () => {
  try {
    return localStorage.getItem(CLE);
  } catch {
    return null;
  }
};
const ecrireChoix = (v) => {
  try {
    v ? localStorage.setItem(CLE, v) : localStorage.removeItem(CLE);
  } catch {
    /* navigation privée : le choix ne survivra pas, ce n'est pas grave */
  }
};

export async function chargerEtat() {
  if (etat) return etat;
  try {
    etat = await api.get('/translate');
  } catch {
    etat = { available: false, languages: [] };
  }
  const choix = lireChoix();
  if (choix && etat.languages.some((l) => l.id === choix)) {
    langue = choix;
    rtl = !!etat.languages.find((l) => l.id === choix)?.rtl;
  }
  return etat;
}

export const langueActive = () => langue;

// Un nœud de texte vaut-il la peine d'être traduit ? On laisse de côté les
// espaces, la ponctuation seule et les nombres — « 7,384 » n'a pas de langue.
function traduisible(texte) {
  const t = texte.trim();
  return t.length >= 2 && /\p{L}{2}/u.test(t);
}

function releverTextes(racine) {
  const nœuds = [];
  const walker = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!traduisible(n.nodeValue)) return NodeFilter.FILTER_REJECT;
      if (n.parentElement?.closest(IGNORE)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nœuds.push(n);
  return nœuds;
}

const tranches = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// Traduit ce qui est affiché dans `racine`. Appelée après chaque rendu de vue :
// si aucune langue n'est choisie, elle ne fait rien et ne coûte rien.
export async function traduireAffichage(racine) {
  if (!langue || !racine) return;
  const nœuds = releverTextes(racine);
  if (!nœuds.length) return;

  const inconnus = [...new Set(nœuds.map((n) => n.nodeValue.trim()))].filter((t) => !cache.has(`${langue}\n${t}`));
  for (const lot of tranches(inconnus, MAX_PAR_ENVOI)) {
    try {
      const { translations } = await api.post('/translate', { target: langue, texts: lot });
      for (const [src, out] of Object.entries(translations)) cache.set(`${langue}\n${src}`, out);
    } catch {
      // Traduction indisponible : on laisse le français, c'est lisible.
      return;
    }
  }

  for (const n of nœuds) {
    const brut = n.nodeValue;
    const t = cache.get(`${langue}\n${brut.trim()}`);
    if (!t) continue;
    // On recolle les espaces d'origine : sans eux, « mot<b>gras</b> » se collerait.
    const avant = brut.match(/^\s*/)[0];
    const apres = brut.match(/\s*$/)[0];
    n.nodeValue = avant + t + apres;
  }
  racine.classList.toggle('lang-rtl', rtl);
  document.documentElement.lang = langue;
}

// Le sélecteur de langue dans la barre du haut. `onChange` redessine la vue :
// revenir au français se fait en réaffichant, pas en détraduisant.
export function monterSelecteur(conteneur, onChange) {
  if (!conteneur || !etat) return;
  if (!etat.available) {
    conteneur.innerHTML = `<button type="button" class="langbtn" data-off title="Traduction automatique non configurée sur ce serveur" aria-label="Traduction indisponible">🌐</button>`;
    conteneur.querySelector('[data-off]').onclick = () =>
      alert("La traduction automatique n'est pas activée sur ce serveur.\n\nUn enseignant peut l'activer : voir la section « Traduction » du README du projet.");
    return;
  }
  const courante = etat.languages.find((l) => l.id === langue);
  conteneur.innerHTML = `
    <details class="langbox" data-no-translate>
      <summary class="langbtn" title="Afficher la page dans une autre langue">🌐 <span>${courante ? courante.label : 'FR'}</span></summary>
      <div class="langmenu">
        <p class="muted small">Afficher le cours et l’interface dans une autre langue. Les formules ne sont pas traduites.</p>
        <button type="button" class="langpick${langue ? '' : ' on'}" data-lang="">Français (original)</button>
        ${etat.languages.map((l) => `<button type="button" class="langpick${l.id === langue ? ' on' : ''}" data-lang="${l.id}">${l.label} <span class="muted small">${l.natif}</span></button>`).join('')}
      </div>
    </details>`;
  conteneur.querySelectorAll('[data-lang]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.lang || null;
      langue = id;
      rtl = !!etat.languages.find((l) => l.id === id)?.rtl;
      ecrireChoix(id);
      if (!id) document.documentElement.lang = 'fr';
      conteneur.querySelector('details')?.removeAttribute('open');
      onChange();
    };
  });
}
