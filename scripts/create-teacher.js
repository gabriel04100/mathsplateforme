// Usage : npm run create-teacher -- <identifiant> <mot-de-passe> "Nom affiché"
const config = require('../server/config');
const { openDatabase, migrate } = require('../server/db');
const { createRepositories } = require('../server/repositories');
const { createAuthService } = require('../server/services/auth');
const { createAccountsService } = require('../server/services/accounts');

(async () => {
  const [username, password, displayName] = process.argv.slice(2);
  if (!username || !password) {
    console.error('Usage : npm run create-teacher -- <identifiant> <mot-de-passe> "Nom affiché"');
    process.exit(1);
  }
  const db = openDatabase(config.dbFile);
  migrate(db, console.info);
  const repos = createRepositories(db);
  const accounts = createAccountsService({ repos, auth: createAuthService({ repos, config }) });
  try {
    const t = await accounts.createTeacher({ username, password, displayName });
    console.info(`Compte enseignant créé : ${t.username} (${t.display_name})`);
  } catch (e) {
    console.error(`Erreur : ${e.message}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})();
