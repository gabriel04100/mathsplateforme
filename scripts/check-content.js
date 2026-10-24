// Vérifie tous les fichiers de /content avant une mise en ligne : npm run check-content
const config = require('../server/config');
const { loadContent } = require('../server/services/content');

try {
  const { levels, byLevel } = loadContent(config.contentDir);
  for (const l of levels) {
    const list = byLevel.get(l.id);
    const pub = list.filter((c) => c.status === 'published').length;
    console.info(`${l.label.padEnd(4)} ${pub} publié(s) / ${list.length} chapitre(s)`);
    for (const c of list) console.info(`   ${String(c.order).padStart(2)}. ${c.status === 'draft' ? '·' : '✓'} ${c.title}`);
  }
  console.info('Contenu valide.');
} catch (e) {
  console.error(`Contenu invalide : ${e.message}`);
  process.exit(1);
}
