// Mise en forme du texte écrit par l'enseignant dans l'éditeur de cours.
//
// Règle de sécurité : tout est d'abord échappé, puis seules quelques marques
// simples sont réinterprétées. Un cours écrit depuis l'interface ne peut donc
// jamais injecter de HTML chez les élèves — contrairement aux fichiers JSON du
// dossier content/, écrits à la main et donc dignes de confiance.
//
// Ce fichier sert à l'éditeur (aperçu en direct) ET au serveur (rendu envoyé
// aux élèves), pour que les deux produisent exactement le même résultat.

export const MAX_BLOCK_TEXT = 4000;

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Les formules LaTeX sont mises de côté avant la mise en forme : sans cela, un
// $a_1 * b$ verrait ses étoiles et ses tirets transformés en gras ou en liste.
function protectMath(text, { escape = true } = {}) {
  const kept = [];
  const masked = String(text ?? '').replace(/\$\$[^$]*\$\$|\$[^$\n]*\$/g, (m) => {
    kept.push(m);
    return `\u0000${kept.length - 1}\u0000`;
  });
  // Au rendu, la formule part vers KaTeX après échappement ; à la reprise d'un
  // cours existant, on veut au contraire la retrouver telle quelle.
  const restore = (s) => s.replace(/\u0000(\d+)\u0000/g, (_, i) => (escape ? escapeHtml(kept[Number(i)]) : kept[Number(i)]));
  return { masked, restore };
}

// Marques qui s'appliquent à l'intérieur d'une ligne.
const inlineMarks = (s) =>
  s
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

// Texte simple → HTML sûr. Reconnaît : paragraphes (ligne vide), listes « - »
// ou « 1. », **gras**, *italique*, `code`, et laisse passer le LaTeX entre $…$.
// `inline` enlève le <p> quand il n'y a qu'un seul paragraphe : pratique pour
// un énoncé d'exercice, qui doit rester une ligne de texte.
export function renderRichText(text, { inline = false } = {}) {
  const { masked, restore } = protectMath(text);
  const lines = escapeHtml(masked).split('\n');
  const out = [];
  let list = null; // 'ul' | 'ol'
  let para = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inlineMarks(para.join('<br>'))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    const bullet = /^[-–•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    if (bullet || numbered) {
      flushPara();
      const want = bullet ? 'ul' : 'ol';
      if (list !== want) {
        flushList();
        out.push(`<${want}>`);
        list = want;
      }
      out.push(`<li>${inlineMarks((bullet || numbered)[1])}</li>`);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  const html = restore(out.join(''));
  if (inline && /^<p>(?:(?!<p>)[\s\S])*<\/p>$/.test(html)) return html.slice(3, -4);
  return html;
}

// Chemin inverse : reprendre un cours livré dans content/ (écrit en HTML, à la
// main) pour le rendre modifiable dans l'éditeur. Les fichiers n'utilisent qu'un
// petit jeu de balises ; tout ce qui sortirait de ce cadre est simplement
// dépouillé de ses balises, jamais recopié tel quel.
const ENTITIES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&amp;': '&' };

export function htmlToRichText(html) {
  const { masked, restore } = protectMath(html, { escape: false });
  let s = masked;

  // Structures de bloc d'abord.
  s = s
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*p\s*>/gi, '\n\n')
    .replace(/<\s*p[^>]*>/gi, '')
    .replace(/<\s*ol[^>]*>/gi, '\n\u0001ol\u0001')
    .replace(/<\s*ul[^>]*>/gi, '\n\u0001ul\u0001')
    .replace(/<\s*\/\s*(ol|ul)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\u0002')
    .replace(/<\s*\/\s*li\s*>/gi, '\n');

  // Marques en ligne.
  s = s
    .replace(/<\s*(strong|b)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/gi, '**$2**')
    .replace(/<\s*(em|i)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/gi, '*$2*')
    .replace(/<\s*code\s*>([\s\S]*?)<\s*\/\s*code\s*>/gi, '`$1`');

  // Tout ce qui reste de balisage disparaît.
  s = s.replace(/<[^>]*>/g, '');
  s = s.replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e);

  // Puces : numérotées si on venait d'un <ol>, à tirets sinon.
  const lines = [];
  let ordered = false;
  let counter = 1;
  for (const raw of s.split('\n')) {
    let line = raw;
    const marker = /\u0001(ol|ul)\u0001/.exec(line);
    if (marker) {
      ordered = marker[1] === 'ol';
      counter = 1;
      line = line.replace(/\u0001(ol|ul)\u0001/g, '');
    }
    if (line.includes('\u0002')) {
      const item = line.replace(/\u0002/g, '').trim();
      if (item) lines.push(ordered ? `${counter++}. ${item}` : `- ${item}`);
      continue;
    }
    lines.push(line.replace(/\u0002/g, '').trimEnd());
  }

  return restore(lines.join('\n'))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Blocs de cours proposés dans l'éditeur. L'ordre est celui du sélecteur.
export const BLOCK_TYPES = [
  { id: 'definition', label: 'Définition', hint: 'Ce qu’il faut retenir par cœur', placeholder: 'Un nombre premier est un entier qui a exactement deux diviseurs : $1$ et lui-même.' },
  { id: 'property', label: 'Propriété', hint: 'Un résultat admis ou démontré', placeholder: 'Si $a$ et $b$ sont pairs, alors $a + b$ est pair.' },
  { id: 'method', label: 'Méthode', hint: 'Comment faire, étape par étape', placeholder: '- Je repère l’opération prioritaire\n- Je la calcule\n- Je recopie le reste' },
  { id: 'example', label: 'Exemple', hint: 'Un cas traité en entier', placeholder: '$3 + 4 \\times 2 = 3 + 8 = 11$' },
  { id: 'remark', label: 'Remarque', hint: 'Une mise en garde, un piège courant', placeholder: 'Attention : $3 + 4 \\times 2$ ne vaut pas $14$.' },
  { id: 'text', label: 'Texte simple', hint: 'Un paragraphe sans étiquette', placeholder: 'On a vu au chapitre précédent que…' },
];

export const BLOCK_IDS = BLOCK_TYPES.map((b) => b.id);

// Valide un bloc de cours ; renvoie la liste des problèmes.
export function validateBlock(block, where) {
  const errors = [];
  if (!block || typeof block !== 'object') return [`${where} : bloc illisible.`];
  if (!BLOCK_IDS.includes(block.type)) errors.push(`${where} : type de bloc inconnu « ${block.type} ».`);
  const title = String(block.title ?? '');
  if (title.length > 120) errors.push(`${where} : titre trop long (120 caractères maximum).`);
  const text = String(block.text ?? '');
  if (!text.trim()) errors.push(`${where} : le contenu est vide.`);
  if (text.length > MAX_BLOCK_TEXT) errors.push(`${where} : texte trop long (${MAX_BLOCK_TEXT} caractères maximum).`);
  return errors;
}
