// Modules ES partagés entre le navigateur et le serveur.
//
// Le navigateur génère les questions et affiche les cours ; le serveur valide
// ce que l'enseignant enregistre et rend les textes en HTML sûr. Les deux
// doivent appliquer exactement les mêmes règles : ils utilisent donc le même
// code, chargé ici une fois pour toutes au démarrage.
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PUBLIC_JS = path.join(__dirname, '..', 'public', 'js');
const load = (...parts) => import(pathToFileURL(path.join(PUBLIC_JS, ...parts)).href);

async function loadSharedModules() {
  const [template, richtext, generators, widgets, random] = await Promise.all([
    load('exercises', 'template.js'),
    load('content', 'richtext.js'),
    load('exercises', 'generators.js'),
    load('animations', 'widgets.js'),
    load('exercises', 'random.js'),
  ]);
  return { template, richtext, generators, widgets, random };
}

module.exports = { loadSharedModules };
