// Couche d'accès aux données : SEUL endroit du code qui écrit du SQL.
// Les services et les routes ne connaissent que ces fonctions, ce qui permet
// de changer de moteur (PostgreSQL, etc.) sans toucher au reste.

function createRepositories(db) {
  const users = {
    findById: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),
    findByUsername: (username) => db.prepare('SELECT * FROM users WHERE username = ?').get(username),
    countTeachers: () => db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'teacher'").get().n,
    create: ({ username, passwordHash, role, displayName, classId = null, firstName = null, lastName = null }) => {
      const r = db
        .prepare('INSERT INTO users (username, password_hash, role, display_name, class_id, first_name, last_name) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(username, passwordHash, role, displayName, classId, firstName, lastName);
      return Number(r.lastInsertRowid);
    },
    update: (id, fields) => {
      const map = {
        displayName: 'display_name', passwordHash: 'password_hash', classId: 'class_id',
        active: 'active', username: 'username', firstName: 'first_name', lastName: 'last_name',
      };
      const sets = [];
      const vals = [];
      for (const [k, col] of Object.entries(map)) {
        if (fields[k] !== undefined) {
          sets.push(`${col} = ?`);
          vals.push(fields[k]);
        }
      }
      if (!sets.length) return;
      db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    },
    touchLogin: (id) => db.prepare("UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(id),
    remove: (id) => db.prepare('DELETE FROM users WHERE id = ?').run(id),
    // Tri par nom de famille puis prénom, comme une liste d'appel.
    listByClass: (classId) =>
      db
        .prepare(
          `SELECT * FROM users WHERE class_id = ? AND role = 'student'
           ORDER BY COALESCE(NULLIF(last_name, ''), display_name) COLLATE NOCASE, first_name COLLATE NOCASE`
        )
        .all(classId),
  };

  const classes = {
    findById: (id) => db.prepare('SELECT * FROM classes WHERE id = ?').get(id),
    listByTeacher: (teacherId, { archived = 0 } = {}) =>
      db
        .prepare(
          `SELECT c.*, (SELECT COUNT(*) FROM users u WHERE u.class_id = c.id AND u.role = 'student') AS student_count
           FROM classes c WHERE teacher_id = ? AND archived = ? ORDER BY school_year DESC, level, name`
        )
        .all(teacherId, archived ? 1 : 0),
    create: ({ name, level, teacherId, schoolYear }) =>
      Number(
        db.prepare('INSERT INTO classes (name, level, teacher_id, school_year) VALUES (?, ?, ?, ?)').run(name, level, teacherId, schoolYear)
          .lastInsertRowid
      ),
    update: (id, { name, level, archived }) =>
      db
        .prepare('UPDATE classes SET name = COALESCE(?, name), level = COALESCE(?, level), archived = COALESCE(?, archived) WHERE id = ?')
        .run(name ?? null, level ?? null, archived ?? null, id),
    remove: (id) => db.prepare('DELETE FROM classes WHERE id = ?').run(id),
  };

  const sessions = {
    create: (tokenHash, userId, expiresAt) =>
      db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash, userId, expiresAt),
    findValid: (tokenHash, nowIso) =>
      db
        .prepare(
          `SELECT s.token_hash, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`
        )
        .get(tokenHash, nowIso),
    remove: (tokenHash) => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash),
    removeForUser: (userId) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId),
    purgeExpired: (nowIso) => db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso).changes,
  };

  const progress = {
    listForUser: (userId) => db.prepare('SELECT * FROM step_progress WHERE user_id = ?').all(userId),
    listForUsers: (userIds) => {
      if (!userIds.length) return [];
      const ph = userIds.map(() => '?').join(',');
      return db.prepare(`SELECT * FROM step_progress WHERE user_id IN (${ph})`).all(...userIds);
    },
    get: (userId, chapterId, stepId) =>
      db.prepare('SELECT * FROM step_progress WHERE user_id = ? AND chapter_id = ? AND step_id = ?').get(userId, chapterId, stepId),
    upsert: ({ userId, chapterId, stepId, status, bestScore = null, bestTotal = null, attempts = 0 }) =>
      db
        .prepare(
          `INSERT INTO step_progress (user_id, chapter_id, step_id, status, best_score, best_total, attempts, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           ON CONFLICT (user_id, chapter_id, step_id) DO UPDATE SET
             status = excluded.status, best_score = excluded.best_score, best_total = excluded.best_total,
             attempts = excluded.attempts, updated_at = excluded.updated_at`
        )
        .run(userId, chapterId, stepId, status, bestScore, bestTotal, attempts),
    resetForUser: (userId) => db.prepare('DELETE FROM step_progress WHERE user_id = ?').run(userId),
  };

  const attempts = {
    create: ({ userId, chapterId, stepId, mode, score, total, durationS }) =>
      Number(
        db
          .prepare('INSERT INTO attempts (user_id, chapter_id, step_id, mode, score, total, duration_s) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(userId, chapterId, stepId, mode, score, total, durationS ?? null).lastInsertRowid
      ),
    recentForUser: (userId, limit = 10) =>
      db.prepare('SELECT * FROM attempts WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(userId, limit),
    lastActivityForUsers: (userIds) => {
      if (!userIds.length) return [];
      const ph = userIds.map(() => '?').join(',');
      return db.prepare(`SELECT user_id, MAX(created_at) AS last_at, COUNT(*) AS n FROM attempts WHERE user_id IN (${ph}) GROUP BY user_id`).all(...userIds);
    },
  };

  // Détail question par question : la matière première du diagnostic.
  const questionResults = {
    createMany: (rows) => {
      if (!rows.length) return;
      const stmt = db.prepare(
        `INSERT INTO question_results (attempt_id, user_id, chapter_id, step_id, position, prompt, expected, given, ok, duration_s)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const r of rows) {
        stmt.run(r.attemptId, r.userId, r.chapterId, r.stepId, r.position, r.prompt, r.expected, r.given, r.ok ? 1 : 0, r.durationS ?? null);
      }
    },

    // Taux de réussite par étape, pour une classe.
    statsByStep: (userIds, chapterId) => {
      if (!userIds.length) return [];
      const ph = userIds.map(() => '?').join(',');
      return db
        .prepare(
          `SELECT step_id, COUNT(*) AS posees, SUM(ok) AS justes,
                  COUNT(DISTINCT user_id) AS eleves, AVG(duration_s) AS temps_moyen
           FROM question_results
           WHERE chapter_id = ? AND user_id IN (${ph})
           GROUP BY step_id`
        )
        .all(chapterId, ...userIds);
    },

    // Les réponses fausses les plus fréquentes : c'est là que se lit l'erreur
    // commune à toute la classe (un signe oublié, une règle inversée…).
    commonMistakes: (userIds, chapterId, limit = 12) => {
      if (!userIds.length) return [];
      const ph = userIds.map(() => '?').join(',');
      return db
        .prepare(
          `SELECT step_id, prompt, expected, given, COUNT(*) AS n, COUNT(DISTINCT user_id) AS eleves
           FROM question_results
           WHERE chapter_id = ? AND ok = 0 AND given <> '' AND user_id IN (${ph})
           GROUP BY step_id, expected, given
           ORDER BY eleves DESC, n DESC
           LIMIT ?`
        )
        .all(chapterId, ...userIds, limit);
    },

    // Les dernières erreurs d'un élève, pour la remédiation individuelle.
    recentMistakesForUser: (userId, limit = 20) =>
      db
        .prepare(
          `SELECT chapter_id, step_id, prompt, expected, given, created_at
           FROM question_results WHERE user_id = ? AND ok = 0
           ORDER BY created_at DESC, id DESC LIMIT ?`
        )
        .all(userId, limit),

    resetForUser: (userId) => db.prepare('DELETE FROM question_results WHERE user_id = ?').run(userId),
  };

  const positions = {
    get: (userId) => db.prepare('SELECT * FROM last_position WHERE user_id = ?').get(userId),
    set: (userId, chapterId, stepId, mode) =>
      db
        .prepare(
          `INSERT INTO last_position (user_id, chapter_id, step_id, mode, updated_at)
           VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           ON CONFLICT (user_id) DO UPDATE SET chapter_id = excluded.chapter_id, step_id = excluded.step_id,
             mode = excluded.mode, updated_at = excluded.updated_at`
        )
        .run(userId, chapterId, stepId, mode),
    listForUsers: (userIds) => {
      if (!userIds.length) return [];
      const ph = userIds.map(() => '?').join(',');
      return db.prepare(`SELECT * FROM last_position WHERE user_id IN (${ph})`).all(...userIds);
    },
  };

  // Exercices rédigés par les enseignants (modèles à variables aléatoires).
  const customExercises = {
    findById: (id) => db.prepare('SELECT * FROM custom_exercises WHERE id = ?').get(id),
    listByTeacher: (teacherId, { archived = 0 } = {}) =>
      db
        .prepare(
          `SELECT e.*, c.name AS class_name
           FROM custom_exercises e LEFT JOIN classes c ON c.id = e.class_id
           WHERE e.teacher_id = ? AND e.archived = ? ORDER BY e.level, e.updated_at DESC`
        )
        .all(teacherId, archived ? 1 : 0),
    // Ce qu'un élève peut voir : publiés, écrits par l'enseignant de sa classe,
    // et soit destinés à toutes ses classes, soit à la sienne.
    listForStudent: (classId) =>
      db
        .prepare(
          `SELECT e.* FROM custom_exercises e
           JOIN classes c ON c.id = ?
           WHERE e.status = 'published' AND e.archived = 0 AND e.teacher_id = c.teacher_id
             AND (e.class_id IS NULL OR e.class_id = c.id)
           ORDER BY e.level, e.title COLLATE NOCASE`
        )
        .all(classId),
    create: ({ teacherId, level, title, instructions, definition, count, pass, status, classId }) =>
      Number(
        db
          .prepare(
            `INSERT INTO custom_exercises (teacher_id, level, title, instructions, definition, count, pass, status, class_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(teacherId, level, title, instructions, definition, count, pass, status, classId ?? null).lastInsertRowid
      ),
    update: (id, fields) => {
      const map = {
        level: 'level', title: 'title', instructions: 'instructions', definition: 'definition',
        count: 'count', pass: 'pass', status: 'status', classId: 'class_id', archived: 'archived',
      };
      const sets = [];
      const vals = [];
      for (const [k, col] of Object.entries(map)) {
        if (fields[k] !== undefined) {
          sets.push(`${col} = ?`);
          vals.push(fields[k]);
        }
      }
      if (!sets.length) return;
      sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      db.prepare(`UPDATE custom_exercises SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    },
    remove: (id) => db.prepare('DELETE FROM custom_exercises WHERE id = ?').run(id),
  };

  // Chapitres écrits par l'enseignant : ils s'ajoutent au parcours de ses classes.
  const customChapters = {
    findById: (id) => db.prepare('SELECT * FROM custom_chapters WHERE id = ?').get(id),
    listByTeacher: (teacherId, { archived = 0 } = {}) =>
      db
        .prepare(
          `SELECT ch.*, c.name AS class_name
           FROM custom_chapters ch LEFT JOIN classes c ON c.id = ch.class_id
           WHERE ch.teacher_id = ? AND ch.archived = ?
           ORDER BY ch.level, ch.position, ch.updated_at DESC`
        )
        .all(teacherId, archived ? 1 : 0),
    // Ce qu'une classe voit : publiés, non archivés, de son enseignant,
    // et destinés soit à toutes ses classes, soit à la sienne.
    listForClass: (classId, level) =>
      db
        .prepare(
          `SELECT ch.* FROM custom_chapters ch
           JOIN classes c ON c.id = ?
           WHERE ch.status = 'published' AND ch.archived = 0 AND ch.teacher_id = c.teacher_id
             AND ch.level = ? AND (ch.class_id IS NULL OR ch.class_id = c.id)
           ORDER BY ch.position, ch.id`
        )
        .all(classId, level),
    listByTeacherAndLevel: (teacherId, level) =>
      db
        .prepare(
          `SELECT * FROM custom_chapters WHERE teacher_id = ? AND level = ? AND archived = 0
           ORDER BY position, id`
        )
        .all(teacherId, level),
    create: ({ teacherId, level, title, summary, position, steps, status, classId }) =>
      Number(
        db
          .prepare(
            `INSERT INTO custom_chapters (teacher_id, level, title, summary, position, steps, status, class_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(teacherId, level, title, summary, position, steps, status, classId ?? null).lastInsertRowid
      ),
    update: (id, fields) => {
      const map = {
        level: 'level', title: 'title', summary: 'summary', position: 'position',
        steps: 'steps', status: 'status', archived: 'archived', classId: 'class_id',
      };
      const sets = [];
      const vals = [];
      for (const [k, col] of Object.entries(map)) {
        if (fields[k] !== undefined) {
          sets.push(`${col} = ?`);
          vals.push(fields[k]);
        }
      }
      if (!sets.length) return;
      sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      db.prepare(`UPDATE custom_chapters SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    },
    remove: (id) => db.prepare('DELETE FROM custom_chapters WHERE id = ?').run(id),
  };

  // « Ma version » d'un chapitre livré dans content/ : déplacé, masqué ou réécrit.
  const chapterOverrides = {
    listByTeacher: (teacherId) => db.prepare('SELECT * FROM chapter_overrides WHERE teacher_id = ?').all(teacherId),
    get: (teacherId, chapterId) => db.prepare('SELECT * FROM chapter_overrides WHERE teacher_id = ? AND chapter_id = ?').get(teacherId, chapterId),
    upsert: (teacherId, chapterId, fields) => {
      const map = { position: 'position', hidden: 'hidden', title: 'title', summary: 'summary', status: 'status', steps: 'steps' };
      const cols = [];
      const vals = [];
      for (const [k, col] of Object.entries(map)) {
        if (fields[k] !== undefined) {
          cols.push(col);
          vals.push(fields[k]);
        }
      }
      if (!cols.length) return;
      // Insertion ou mise à jour des seules colonnes fournies : les autres
      // restent à NULL, c'est-à-dire « comme dans le fichier ».
      db.prepare(
        `INSERT INTO chapter_overrides (teacher_id, chapter_id, ${cols.join(', ')})
         VALUES (?, ?, ${cols.map(() => '?').join(', ')})
         ON CONFLICT (teacher_id, chapter_id) DO UPDATE SET
           ${cols.map((c) => `${c} = excluded.${c}`).join(', ')},
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
      ).run(teacherId, chapterId, ...vals);
    },
    remove: (teacherId, chapterId) => db.prepare('DELETE FROM chapter_overrides WHERE teacher_id = ? AND chapter_id = ?').run(teacherId, chapterId),
  };

  // Documents PDF déposés par l'enseignant. Seule la fiche signalétique est en
  // base ; le fichier vit sur le disque.
  const documents = {
    findById: (id) => db.prepare('SELECT * FROM documents WHERE id = ?').get(id),
    listByTeacher: (teacherId) =>
      db
        .prepare(
          `SELECT d.*, c.name AS class_name FROM documents d
           LEFT JOIN classes c ON c.id = d.class_id
           WHERE d.teacher_id = ? ORDER BY d.level, d.created_at DESC`
        )
        .all(teacherId),
    listForClass: (classId, level) =>
      db
        .prepare(
          `SELECT d.* FROM documents d
           JOIN classes c ON c.id = ?
           WHERE d.teacher_id = c.teacher_id AND d.level = ?
             AND (d.class_id IS NULL OR d.class_id = c.id)
           ORDER BY d.created_at DESC`
        )
        .all(classId, level),
    create: ({ teacherId, level, chapterId, classId, title, filename, storedName, sizeBytes }) =>
      Number(
        db
          .prepare(
            `INSERT INTO documents (teacher_id, level, chapter_id, class_id, title, filename, stored_name, size_bytes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(teacherId, level, chapterId ?? null, classId ?? null, title, filename, storedName, sizeBytes).lastInsertRowid
      ),
    update: (id, fields) => {
      const map = { title: 'title', chapterId: 'chapter_id', classId: 'class_id' };
      const sets = [];
      const vals = [];
      for (const [k, col] of Object.entries(map)) {
        if (fields[k] !== undefined) {
          sets.push(`${col} = ?`);
          vals.push(fields[k]);
        }
      }
      if (!sets.length) return;
      db.prepare(`UPDATE documents SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    },
    countDownload: (id) => db.prepare('UPDATE documents SET downloads = downloads + 1 WHERE id = ?').run(id),
    remove: (id) => db.prepare('DELETE FROM documents WHERE id = ?').run(id),
  };

  // Parties jouées : base du classement global (toutes classes confondues).
  const gameScores = {
    create: ({ userId, gameId, variant, score, correct, wrong, bestStreak, durationS, details }) =>
      Number(
        db
          .prepare(
            `INSERT INTO game_scores (user_id, game_id, variant, score, correct, wrong, best_streak, duration_s, details)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(userId, gameId, variant, score, correct, wrong, bestStreak, durationS, details ?? null).lastInsertRowid
      ),
    // Meilleur score par élève, sur une variante donnée (même niveau, même durée).
    // En cas d'égalité, celui qui l'a atteint en premier passe devant.
    leaderboard: (gameId, variant, sinceIso, limit) =>
      db
        .prepare(
          `SELECT u.id AS user_id, u.display_name, u.role, c.name AS class_name, c.level AS class_level,
                  MAX(g.score) AS best_score, MAX(g.best_streak) AS best_streak,
                  COUNT(*) AS plays, MIN(g.created_at) AS first_at, MAX(g.created_at) AS last_at
           FROM game_scores g
           JOIN users u ON u.id = g.user_id
           LEFT JOIN classes c ON c.id = u.class_id
           WHERE g.game_id = ? AND g.variant = ? AND g.created_at >= ? AND u.active = 1
           GROUP BY u.id
           ORDER BY best_score DESC, last_at ASC
           LIMIT ?`
        )
        .all(gameId, variant, sinceIso, limit),
    bestForUser: (userId, gameId, variant, sinceIso) =>
      db
        .prepare(
          `SELECT MAX(score) AS best_score, MAX(best_streak) AS best_streak, COUNT(*) AS plays
           FROM game_scores WHERE user_id = ? AND game_id = ? AND variant = ? AND created_at >= ?`
        )
        .get(userId, gameId, variant, sinceIso),
    // Rang = nombre d'élèves ayant fait strictement mieux sur la même variante, + 1.
    rankForScore: (gameId, variant, sinceIso, score) =>
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM (
             SELECT g.user_id, MAX(g.score) AS best FROM game_scores g
             JOIN users u ON u.id = g.user_id
             WHERE g.game_id = ? AND g.variant = ? AND g.created_at >= ? AND u.active = 1
             GROUP BY g.user_id HAVING best > ?
           )`
        )
        .get(gameId, variant, sinceIso, score).n + 1,
    recentForUser: (userId, gameId, limit = 5) =>
      db.prepare('SELECT * FROM game_scores WHERE user_id = ? AND game_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(userId, gameId, limit),
    countForUserSince: (userId, sinceIso) =>
      db.prepare('SELECT COUNT(*) AS n FROM game_scores WHERE user_id = ? AND created_at >= ?').get(userId, sinceIso).n,
    removeForUser: (userId) => db.prepare('DELETE FROM game_scores WHERE user_id = ?').run(userId),
  };

  return {
    users, classes, sessions, progress, attempts, questionResults, positions,
    customExercises, customChapters, chapterOverrides, documents, gameScores,
    transaction: (fn) => db.transaction(fn)(),
  };
}

module.exports = { createRepositories };
