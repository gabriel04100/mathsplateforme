// Exercices rédigés par l'enseignant depuis l'interface, sans écrire de code.
// Un exercice est un MODÈLE : des variables tirées au sort et des formules,
// pour que les questions changent à chaque série comme les générateurs intégrés.
//
// La validation s'appuie sur le même moteur que l'éditeur (public/js/exercises/
// template.js) : impossible d'enregistrer un modèle que le navigateur ne saurait
// pas jouer. Le module est en ES ; on le charge une fois, à la demande.
const { cleanQuestionDetail } = require('./question-detail');

const LEVELS = ['6e', '5e', '4e', '3e'];
const MAX_PER_TEACHER = 500;
const CUSTOM_CHAPTER_ID = 'custom'; // espace de noms dans step_progress / attempts
const stepIdOf = (exerciseId) => `ex-${exerciseId}`;

class ExerciseError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function createExercisesService({ repos, shared }) {
  const engine = shared.template;

  function ownedExercise(teacherId, id) {
    const e = repos.customExercises.findById(Number(id));
    if (!e || e.teacher_id !== teacherId) throw new ExerciseError('Exercice introuvable', 404);
    return e;
  }

  // Ligne de base de données → objet renvoyé par l'API (définition dépliée).
  const publicExercise = (row, { withDefinition = true } = {}) => ({
    id: row.id,
    level: row.level,
    title: row.title,
    instructions: row.instructions,
    count: row.count,
    pass: row.pass,
    status: row.status,
    classId: row.class_id,
    className: row.class_name ?? null,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    ...(withDefinition ? { definition: JSON.parse(row.definition) } : {}),
  });

  // Mise en forme d'un exercice pour runExercise côté navigateur : même
  // vocabulaire qu'une étape de chapitre (type, count, pass…).
  const asStep = (row) => ({
    id: stepIdOf(row.id),
    type: 'exercise',
    title: row.title,
    instructions: row.instructions || '',
    count: row.count,
    pass: row.pass,
    template: JSON.parse(row.definition),
  });

  function validatePayload(teacherId, body, { partial = false } = {}) {
    const out = {};

    if (body.title !== undefined || !partial) {
      const title = String(body.title ?? '').trim().replace(/\s+/g, ' ');
      if (title.length < 3 || title.length > 80) throw new ExerciseError('Titre : entre 3 et 80 caractères');
      out.title = title;
    }
    if (body.level !== undefined || !partial) {
      if (!LEVELS.includes(body.level)) throw new ExerciseError('Niveau invalide');
      out.level = body.level;
    }
    if (body.instructions !== undefined) {
      const ins = String(body.instructions ?? '').trim();
      if (ins.length > 300) throw new ExerciseError('Consigne : 300 caractères maximum');
      out.instructions = ins;
    }
    if (body.count !== undefined || !partial) {
      const count = Number(body.count);
      if (!Number.isInteger(count) || count < 1 || count > 20) throw new ExerciseError('Nombre de questions : entre 1 et 20');
      out.count = count;
    }
    if (body.pass !== undefined || !partial) {
      const pass = Number(body.pass);
      if (!Number.isInteger(pass) || pass < 1) throw new ExerciseError('Objectif : au moins 1 bonne réponse');
      out.pass = pass;
    }
    if (body.status !== undefined) {
      if (!['draft', 'published'].includes(body.status)) throw new ExerciseError('Statut invalide');
      out.status = body.status;
    }
    if (body.archived !== undefined) out.archived = body.archived ? 1 : 0;
    if (body.classId !== undefined) {
      if (body.classId === null || body.classId === '') out.classId = null;
      else {
        const cls = repos.classes.findById(Number(body.classId));
        if (!cls || cls.teacher_id !== teacherId) throw new ExerciseError('Classe introuvable', 404);
        out.classId = cls.id;
      }
    }
    if (body.definition !== undefined || !partial) {
      const errors = engine.validateDefinition(body.definition);
      if (errors.length) throw new ExerciseError(errors[0]);
      out.definition = JSON.stringify(body.definition);
    }
    return out;
  }

  // « pass » ne peut pas dépasser « count », qu'ils arrivent ensemble ou séparément.
  function checkPassAgainstCount(fields, existing) {
    const count = fields.count ?? existing?.count;
    const pass = fields.pass ?? existing?.pass;
    if (count !== undefined && pass !== undefined && pass > count) {
      throw new ExerciseError(`Objectif (${pass}) : il ne peut pas dépasser le nombre de questions (${count})`);
    }
  }

  return {
    LEVELS,
    CUSTOM_CHAPTER_ID,
    stepIdOf,
    asStep,

    listForTeacher: (teacherId, { archived = false } = {}) =>
      repos.customExercises.listByTeacher(teacherId, { archived: archived ? 1 : 0 }).map((r) => publicExercise(r, { withDefinition: false })),

    getForTeacher(teacherId, id) {
      return publicExercise(ownedExercise(teacherId, id));
    },

    create(teacherId, body) {
      if (repos.customExercises.listByTeacher(teacherId).length >= MAX_PER_TEACHER) {
        throw new ExerciseError(`${MAX_PER_TEACHER} exercices maximum`);
      }
      const fields = validatePayload(teacherId, body);
      checkPassAgainstCount(fields, null);
      const id = repos.customExercises.create({
        teacherId,
        level: fields.level,
        title: fields.title,
        instructions: fields.instructions || '',
        definition: fields.definition,
        count: fields.count,
        pass: fields.pass,
        status: fields.status || 'draft',
        classId: fields.classId ?? null,
      });
      return publicExercise(repos.customExercises.findById(id));
    },

    update(teacherId, id, body) {
      const existing = ownedExercise(teacherId, id);
      const fields = validatePayload(teacherId, body, { partial: true });
      checkPassAgainstCount(fields, existing);
      repos.customExercises.update(existing.id, fields);
      return publicExercise(repos.customExercises.findById(existing.id));
    },

    remove(teacherId, id) {
      const e = ownedExercise(teacherId, id);
      repos.customExercises.remove(e.id);
    },

    // ---------- Côté élève ----------

    listForStudent(user) {
      if (!user.class_id) return [];
      return repos.customExercises.listForStudent(user.class_id).map((r) => ({
        id: r.id,
        level: r.level,
        title: r.title,
        instructions: r.instructions,
        count: r.count,
        pass: r.pass,
      }));
    },

    // Exercice jouable : l'enseignant peut ouvrir les siens même en brouillon (aperçu).
    getPlayable(user, id) {
      const row = repos.customExercises.findById(Number(id));
      if (!row) throw new ExerciseError('Exercice introuvable', 404);
      if (user.role === 'teacher') {
        if (row.teacher_id !== user.id) throw new ExerciseError('Exercice introuvable', 404);
      } else {
        const visible = user.class_id && repos.customExercises.listForStudent(user.class_id).some((r) => r.id === row.id);
        if (!visible) throw new ExerciseError('Exercice introuvable', 404);
      }
      return { exercise: asStep(row), level: row.level, draft: row.status === 'draft' };
    },

    // Enregistre une série. Les exercices de l'enseignant vivent hors parcours :
    // ils alimentent l'historique et le meilleur score, pas le déblocage des chapitres.
    recordAttempt(user, id, { score, total, durationS, questions }) {
      const { exercise } = this.getPlayable(user, id);
      if (user.role === 'teacher') return { passed: score >= exercise.pass, everPassed: false, pass: exercise.pass, bestScore: score, saved: false };
      const s = Number(score);
      const t = Number(total);
      if (!Number.isInteger(s) || !Number.isInteger(t) || t !== exercise.count || s < 0 || s > t) {
        throw new ExerciseError('Score invalide');
      }
      const stepId = exercise.id;
      let result;
      repos.transaction(() => {
        const attemptId = repos.attempts.create({ userId: user.id, chapterId: CUSTOM_CHAPTER_ID, stepId, mode: 'libre', score: s, total: t, durationS });
        repos.questionResults.createMany(
          cleanQuestionDetail(questions, { attemptId, userId: user.id, chapterId: CUSTOM_CHAPTER_ID, stepId, total: t })
        );
        const prev = repos.progress.get(user.id, CUSTOM_CHAPTER_ID, stepId);
        const better = !prev || prev.best_score == null || s > prev.best_score;
        const passed = prev?.status === 'passed' || s >= exercise.pass;
        repos.progress.upsert({
          userId: user.id,
          chapterId: CUSTOM_CHAPTER_ID,
          stepId,
          status: passed ? 'passed' : 'in_progress',
          bestScore: better ? s : prev.best_score,
          bestTotal: t,
          attempts: (prev?.attempts || 0) + 1,
        });
        result = { passed: s >= exercise.pass, everPassed: passed, pass: exercise.pass, bestScore: better ? s : prev.best_score, saved: true };
      });
      return result;
    },

    // Titre lisible d'un exercice personnalisé, pour le tableau de bord.
    titleOfStep(stepId) {
      const m = /^ex-(\d+)$/.exec(stepId);
      if (!m) return null;
      return repos.customExercises.findById(Number(m[1]))?.title || null;
    },
  };
}

module.exports = { createExercisesService, ExerciseError, LEVELS, CUSTOM_CHAPTER_ID };
