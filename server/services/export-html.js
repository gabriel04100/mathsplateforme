// Export d'un chapitre en un seul fichier HTML, autonome.
//
// Le fichier produit s'ouvre d'un double-clic, sans serveur, sans connexion et
// sans compte : le cours, les animations et les exercices y sont entiers. Il
// sert à donner un chapitre à un collègue, à travailler sur un poste qui n'a
// rien d'installé, ou à garder une trace lisible dans dix ans.
//
// Le parti pris : on embarque le VRAI code — les mêmes générateurs, les mêmes
// widgets que le site — plutôt qu'une version simplifiée qui divergerait au
// premier changement. Les modules ES sont donc inclus en source et remontés
// dans le navigateur par des URL « blob » (voir templates/hors-ligne.js).
//
// Deux choses ne suivent pas, et c'est dit dans le fichier : il n'y a pas de
// progression enregistrée (aucun serveur pour la garder), et les vidéos
// YouTube demandent une connexion.
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.resolve(__dirname, '..', '..');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');

// Les modules du navigateur embarqués, repérés par leur nom de fichier seul :
// ils sont tous distincts, ce qui suffit à réécrire les imports relatifs.
const MODULES = [
  ['expr.js', ['public', 'js', 'math', 'expr.js']],
  ['random.js', ['public', 'js', 'exercises', 'random.js']],
  ['richtext.js', ['public', 'js', 'content', 'richtext.js']],
  ['generators.js', ['public', 'js', 'exercises', 'generators.js']],
  ['template.js', ['public', 'js', 'exercises', 'template.js']],
  ['angles.js', ['public', 'js', 'animations', 'angles.js']],
  ['decimaux.js', ['public', 'js', 'animations', 'decimaux.js']],
  ['widgets.js', ['public', 'js', 'animations', 'widgets.js']],
];

// Du JSON posé dans la page : on neutralise « < » pour qu'aucune chaîne ne
// puisse refermer la balise qui le contient.
const json = (valeur) => JSON.stringify(valeur).replace(/</g, '\\u003c');

// Un module ES devient un script inline autonome.
//
// Pourquoi ne pas simplement inclure les fichiers ? Parce qu'un fichier ouvert
// en double-clic est servi par « file:// », et qu'un navigateur refuse d'y
// charger un module externe. Tout doit donc tenir dans la page.
//
// Chaque module garde malgré tout sa portée : un `<script type="module">`
// inline ne fuit pas dans la page, ce qui évite les collisions de noms (deux
// modules définissent `puis`, `tronque`, `RANGS`…). Seuls les noms exportés
// passent, par un petit registre partagé.
function moduleInline(nom, source) {
  const nomsExportes = [
    ...source.matchAll(/^export\s+(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm),
  ].map((m) => m[1]);
  for (const m of source.matchAll(/^export\s*\{([^}]*)\};?\s*$/gm)) {
    nomsExportes.push(...m[1].split(',').map((n) => n.trim()).filter(Boolean));
  }

  const code = source
    // « import { a, b } from './x.js' » → on prend a et b dans le registre
    .replace(/^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm, (tout, noms, chemin) => {
      const dep = chemin.split('/').pop();
      return `const {${noms}} = window.__mp[${JSON.stringify(dep)}];`;
    })
    // « export { a, b } » : la ligne ne sert plus, le registre s'en charge
    .replace(/^export\s*\{[^}]*\};?[ \t]*$/gm, '')
    // « export function f » → « function f »
    .replace(/^export\s+(?=(?:function|const|let|class)\s)/gm, '');

  if (!nomsExportes.length) throw new Error(`Module « ${nom} » : aucun export reconnu`);
  return `${code}\nwindow.__mp[${JSON.stringify(nom)}] = { ${nomsExportes.join(', ')} };`;
}

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Nom de fichier lisible et sans surprise pour un système de fichiers.
function nomFichier(chapitre) {
  const base = String(chapitre.title)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60);
  return `${chapitre.level}-${base || 'chapitre'}.html`;
}

// Ce qui part dans le fichier : le chapitre, débarrassé de ce qui n'a de sens
// que sur la plateforme (identifiants de classe, statut de publication…).
function alleger(chapitre) {
  return {
    title: chapitre.title,
    level: chapitre.level,
    summary: chapitre.summary || '',
    steps: chapitre.steps.map((s) => {
      if (s.type === 'lesson') return { id: s.id, type: s.type, title: s.title, blocks: s.blocks || [] };
      if (s.type === 'animation') return { id: s.id, type: s.type, title: s.title, intro: s.intro || '', widget: s.widget, params: s.params || {} };
      return {
        id: s.id,
        type: 'exercise',
        title: s.title,
        instructions: s.instructions || '',
        count: s.count,
        pass: s.pass,
        ...(s.template ? { template: s.template } : { generator: s.generator, params: s.params || {} }),
      };
    }),
  };
}

function createExportService({ chapters }) {
  // Lus une fois : ces fichiers ne changent pas d'un export à l'autre.
  const sources = Object.fromEntries(MODULES.map(([nom, chemin]) => [nom, lire(...chemin)]));
  const appCss = lire('public', 'css', 'app.css');
  const horsLigneCss = lire('server', 'templates', 'hors-ligne.css');
  const horsLigneJs = lire('server', 'templates', 'hors-ligne.js');
  const katexJs = lire('node_modules', 'katex', 'dist', 'katex.min.js');
  const autoRenderJs = lire('node_modules', 'katex', 'dist', 'contrib', 'auto-render.min.js');

  // Transformés une fois pour toutes, dans l'ordre des dépendances.
  const scriptsModules = MODULES.map(([nom]) => `<script type="module">${moduleInline(nom, sources[nom])}</script>`).join('\n');

  return {
    nomFichier,

    // `teacherId` sert au contrôle d'appartenance fait par le service chapitres :
    // on n'exporte que ce qu'on a le droit de voir.
    construire(teacher, chapterId) {
      const chapitre = chapters.byIdForUser(teacher, chapterId);
      if (!chapitre) {
        const e = new Error('Chapitre introuvable');
        e.status = 404;
        throw e;
      }
      const data = alleger(chapitre);
      const titre = escapeHtml(`${data.title} — ${data.level}`);
      const nbExos = data.steps.filter((s) => s.type === 'exercise').length;

      return {
        filename: nomFichier(data),
        html: `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titre}</title>
<meta name="description" content="${escapeHtml(data.summary)}">
<meta name="generator" content="Maths Collège — chapitre exporté hors ligne">
<style>${appCss}</style>
<style>${horsLigneCss}</style>
</head>
<body>
<header class="hl-entete">
  <h1>${escapeHtml(data.title)}</h1>
  <span class="tag">${escapeHtml(data.level)}</span>
  <p class="hl-sous">${escapeHtml(data.summary)}</p>
</header>

<div class="hl-corps">
  <nav aria-label="Étapes du chapitre"><ul class="hl-etapes" id="etapes"></ul></nav>
  <main id="vue" tabindex="-1"><p id="chargement">Préparation du chapitre…</p></main>
</div>

<footer class="hl-pied">
  <p><strong>Chapitre hors ligne</strong> — ce fichier contient le cours, ${
    data.steps.filter((s) => s.type === 'animation').length
  } animation(s) et ${nbExos} exercice(s). Il fonctionne sans connexion et sans compte.
  Les questions sont tirées au hasard à chaque ouverture, et corrigées dans la page :
  <strong>aucune progression n'est enregistrée</strong> et rien n'est envoyé nulle part.</p>
  <p>Maths Collège, plateforme conçue par <strong>Gabriel Pizzo</strong>, professeur de mathématiques.
  © Gabriel Pizzo, tous droits réservés.</p>
</footer>

<script type="application/json" id="mp-chapitre">${json(data)}</script>
<script>${katexJs}</script>
<script>${autoRenderJs}</script>
<script>window.__mp = {};</script>
${scriptsModules}
<script type="module">${horsLigneJs}</script>
</body>
</html>
`,
      };
    },
  };
}

module.exports = { createExportService };
