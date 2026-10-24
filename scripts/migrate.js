const config = require('../server/config');
const { openDatabase, migrate } = require('../server/db');

const db = openDatabase(config.dbFile);
migrate(db, console.info);
console.info('Base à jour.');
db.close();
