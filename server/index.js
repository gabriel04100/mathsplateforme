// Point d'entrée — Plateforme Maths Collège · Gabriel Pizzo
const config = require('./config');
const { createApp } = require('./app');

async function main() {
  const { app, db, services } = await createApp(config);

  // Premier démarrage : création du compte enseignant à partir des variables d'environnement.
  if (services.repos.users.countTeachers() === 0) {
    const t = config.bootstrapTeacher;
    if (t.username && t.password) {
      await services.accounts.createTeacher(t);
      console.info(`Compte enseignant « ${t.username} » créé.`);
    } else {
      console.warn('Aucun compte enseignant. Lance : npm run create-teacher -- <identifiant> <mot-de-passe> "Nom affiché"');
    }
  }

  setInterval(() => {
    services.auth.purgeExpired();
    // Les séries d'exercices abandonnées ne servent plus à rien.
    services.series.purgeExpirees();
  }, 6 * 3600 * 1000).unref();

  const server = app.listen(config.port, () => {
    const s = services.content.stats();
    console.info(`Plateforme prête sur http://localhost:${config.port}  (${s.published}/${s.chapters} chapitres publiés)`);
  });

  const shutdown = () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
