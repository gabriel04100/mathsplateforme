// RGPD : la plateforme n'héberge plus l'identité des élèves.
//
// Jusqu'ici un compte élève portait son prénom, son nom, et les deux réunis
// dans display_name. Désormais il ne porte qu'un pseudonyme — c'est ce que
// display_name contient pour un élève. Le lien pseudonyme ↔ élève reste chez
// l'enseignant, hors de la plateforme.
//
// Comme cette migration détruit des données qu'on ne peut pas reconstruire, elle
// commence par les écrire dans un fichier CSV à côté de la base : c'est la
// première colonne de la feuille de correspondance de l'enseignant. Sans ce
// fichier, la mise à jour rendrait les comptes existants inattribuables.
const fs = require('node:fs');
const path = require('node:path');
const { genererPseudonymes } = require('../../services/pseudonyms');

// Point-virgule et BOM : un tableur français ouvre le fichier sans réglage.
const csv = (lignes) =>
  '﻿' + lignes.map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n') + '\r\n';

function up(db, log = () => {}) {
  const eleves = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.first_name, u.last_name, c.name AS class_name
         FROM users u LEFT JOIN classes c ON c.id = u.class_id
        WHERE u.role = 'student'
        ORDER BY c.name COLLATE NOCASE, u.last_name COLLATE NOCASE, u.first_name COLLATE NOCASE`
    )
    .all();

  if (eleves.length) {
    const pris = new Set(db.prepare('SELECT display_name FROM users').all().map((r) => r.display_name));
    const pseudos = genererPseudonymes(eleves.length, (n) => pris.has(n));
    const maj = db.prepare('UPDATE users SET display_name = ? WHERE id = ?');
    eleves.forEach((e, i) => maj.run(pseudos[i], e.id));

    // Le fichier n'a de sens que pour une base sur disque ; en mémoire (tests)
    // il n'y a rien à sauvegarder.
    if (db.name && db.name !== ':memory:') {
      const dossier = path.dirname(path.resolve(db.name));
      const fichier = path.join(dossier, `correspondance-pseudonymes-${new Date().toISOString().slice(0, 10)}.csv`);
      fs.writeFileSync(
        fichier,
        csv([
          ['Pseudonyme', 'Prénom', 'Nom', 'Identifiant', 'Classe'],
          ...eleves.map((e, i) => [pseudos[i], e.first_name || e.display_name || '', e.last_name || '', e.username, e.class_name || '']),
        ]),
        'utf8'
      );
      log(`identités exportées avant effacement : ${fichier}`);
      log('→ range ce fichier hors de la plateforme : c’est la seule copie du lien pseudonyme ↔ élève.');
    }
  }

  // L'index porte sur une colonne qui disparaît : il part d'abord.
  db.exec(`
    DROP INDEX IF EXISTS idx_users_last_name;
    ALTER TABLE users DROP COLUMN first_name;
    ALTER TABLE users DROP COLUMN last_name;
  `);
}

module.exports = { up };
