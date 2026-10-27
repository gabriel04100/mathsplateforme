// Progression : règles du parcours (déblocage, réussite) et tableau de bord.
// Toute la logique métier est ici, indépendante d'Express et de la base.

class ProgressError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const { cleanQuestionDetail } = require('./question-detail');
const { trierParPseudonyme } = require('./pseudonyms');

// `chapters` fusionne le programme des fichiers et les chapitres écrits par
// l'enseignant : la progression ne fait donc aucune différence entre les deux.
function createProgressService({ repos, content, chapters, exercises = null, series }) {
  // Un élève sans classe, ou un utilisateur absent, ne voit que les fichiers.
  const chaptersOf = (user, levelId) => chapters.forUser(user, levelId);
  const chapterOf = (user, chapterId) => chapters.byIdForUser(user, chapterId);
  // Pour les écrans d'une classe, on raisonne comme un de ses élèves.
  const asStudentOf = (classId) => ({ role: 'student', class_id: classId, id: null });

  function indexProgress(rows) {
    const idx = new Map(); // chapterId -> Map(stepId -> row)
    for (const r of rows) {
      if (!idx.has(r.chapter_id)) idx.set(r.chapter_id, new Map());
      idx.get(r.chapter_id).set(r.step_id, r);
    }
    return idx;
  }

  const stepDone = (step, row) => (step.type === 'exercise' ? row?.status === 'passed' : !!row);

  function chapterState(ch, rowsOfChapter) {
    const rows = rowsOfChapter || new Map();
    const steps = ch.steps.map((s) => {
      const r = rows.get(s.id);
      return {
        id: s.id,
        status: r ? r.status : 'todo',
        done: stepDone(s, r),
        bestScore: r?.best_score ?? null,
        bestTotal: r?.best_total ?? null,
        attempts: r?.attempts ?? 0,
      };
    });
    const doneCount = steps.filter((s) => s.done).length;
    const exercises = ch.steps.filter((s) => s.type === 'exercise');
    const passedEx = exercises.filter((s) => rows.get(s.id)?.status === 'passed').length;
    let status = 'not_started';
    if (rows.size) status = 'in_progress';
    if (ch.steps.length && doneCount === ch.steps.length) status = 'done';
    return {
      chapterId: ch.id,
      status,
      percent: ch.steps.length ? Math.round((100 * doneCount) / ch.steps.length) : 0,
      exercisesPassed: passedEx,
      exercisesTotal: exercises.length,
      steps,
    };
  }

  // État de tous les chapitres d'un niveau, avec la règle de déblocage séquentiel du parcours.
  function levelState(user, levelId, idx) {
    const level = content.level(levelId);
    if (!level) throw new ProgressError('Niveau inconnu', 404);
    const sequential = level.sequential !== false;
    let previousDone = true;
    return chaptersOf(user, levelId).map((ch) => {
      if (ch.status !== 'published') return { chapterId: ch.id, status: 'draft', unlocked: false, percent: 0, steps: [] };
      const st = chapterState(ch, idx.get(ch.id));
      st.unlocked = !sequential || previousDone;
      previousDone = st.status === 'done';
      return st;
    });
  }

  function nextStepIn(user, levelId, idx) {
    for (const st of levelState(user, levelId, idx)) {
      if (!st.unlocked || st.status === 'done' || st.status === 'draft') continue;
      const ch = chapterOf(user, st.chapterId);
      if (!ch) continue;
      const next = st.steps.find((s) => !s.done) || st.steps[0];
      const step = ch.steps.find((s) => s.id === next.id);
      if (!step) continue;
      return { levelId, chapterId: ch.id, chapterTitle: ch.title, stepId: step.id, stepTitle: step.title, stepType: step.type };
    }
    return null;
  }

  function describePosition(user, pos) {
    if (!pos) return null;
    const ch = chapterOf(user, pos.chapter_id);
    const step = ch?.steps.find((s) => s.id === pos.step_id);
    if (!ch || !step) return null; // contenu supprimé depuis
    return {
      levelId: ch.level,
      chapterId: ch.id,
      chapterTitle: ch.title,
      stepId: step.id,
      stepTitle: step.title,
      stepType: step.type,
      mode: pos.mode,
      updatedAt: pos.updated_at,
    };
  }

  function requireStep(user, chapterId, stepId, { mode = 'parcours' } = {}) {
    const ch = chapterOf(user, chapterId);
    // Un enseignant peut parcourir ses propres brouillons ; un élève, non.
    if (!ch || (ch.status !== 'published' && user.role !== 'teacher')) throw new ProgressError('Chapitre introuvable', 404);
    const step = ch.steps.find((s) => s.id === stepId);
    if (!step) throw new ProgressError('Étape introuvable', 404);

    // Le déblocage séquentiel est une règle, pas une décoration : on la vérifie
    // ici aussi, sans quoi un élève pourrait valider le chapitre 5 en janvier
    // en appelant l'API directement. Les exercices libres y échappent — c'est
    // précisément leur raison d'être.
    if (user.role !== 'teacher' && mode !== 'libre' && !chapters.estSeance?.(ch.kind)) {
      const etat = levelState(user, ch.level, indexProgress(repos.progress.listForUser(user.id))).find((s) => s.chapterId === ch.id);
      if (etat && !etat.unlocked) {
        throw new ProgressError('Ce chapitre se débloquera quand tu auras terminé le précédent', 403);
      }
    }
    return { ch, step };
  }

  // Écrit une série déjà corrigée. Aucun score ne vient du dehors : les
  // appelants l'obtiennent de services/series.js, qui rejoue les questions.
  function enregistrer(user, { chapterId, stepId, mode, step, score, total, durationS, detail }) {
    const userId = user.id;
    const m = mode === 'libre' ? 'libre' : 'parcours';
    let result;
    repos.transaction(() => {
      const attemptId = repos.attempts.create({ userId, chapterId, stepId, mode: m, score, total, durationS });
      repos.questionResults.createMany(cleanQuestionDetail(detail, { attemptId, userId, chapterId, stepId, total }));
      const prev = repos.progress.get(userId, chapterId, stepId);
      const better = !prev || prev.best_score == null || score > prev.best_score;
      const passed = prev?.status === 'passed' || score >= step.pass;
      repos.progress.upsert({
        userId,
        chapterId,
        stepId,
        status: passed ? 'passed' : 'in_progress',
        bestScore: better ? score : prev.best_score,
        bestTotal: total,
        attempts: (prev?.attempts || 0) + 1,
      });
      repos.positions.set(userId, chapterId, stepId, m);
      result = {
        score,
        total,
        passed: score >= step.pass,
        everPassed: passed,
        pass: step.pass,
        bestScore: better ? score : prev.best_score,
        detail: detail.map((d) => ({ position: d.position, ok: d.ok, expected: d.expected })),
      };
    });
    return result;
  }

  return {
    levelProgress(user, levelId) {
      return levelState(user, levelId, indexProgress(repos.progress.listForUser(user.id)));
    },

    chapterProgress(user, chapterId) {
      const ch = chapterOf(user, chapterId);
      if (!ch) throw new ProgressError('Chapitre introuvable', 404);
      const idx = indexProgress(repos.progress.listForUser(user.id));
      // Une séance n'appartient pas au parcours : elle n'a pas de rang, donc
      // pas de verrou, et son avancement se lit seul.
      if (chapters.estSeance?.(ch.kind)) {
        const st = chapterState(ch, idx.get(ch.id));
        st.unlocked = true;
        return st;
      }
      return levelState(user, ch.level, idx).find((s) => s.chapterId === chapterId);
    },

    // Ouverture d'une étape (cours, animation ou exercice) : met à jour « où j'en suis ».
    recordVisit(user, { chapterId, stepId, mode = 'parcours' }) {
      const { step } = requireStep(user, chapterId, stepId, { mode });
      const userId = user.id;
      repos.transaction(() => {
        const existing = repos.progress.get(userId, chapterId, stepId);
        if (!existing) {
          repos.progress.upsert({ userId, chapterId, stepId, status: step.type === 'exercise' ? 'in_progress' : 'seen' });
        }
        repos.positions.set(userId, chapterId, stepId, mode === 'libre' ? 'libre' : 'parcours');
      });
      return { ok: true };
    },

    // Ouvre une série : le serveur choisit les questions (par une graine) et
    // les retient, pour pouvoir corriger lui-même ensuite.
    startSeries(user, { chapterId, stepId, mode = 'parcours' }) {
      const { step } = requireStep(user, chapterId, stepId, { mode });
      if (step.type !== 'exercise') throw new ProgressError("Cette étape n'est pas un exercice");
      return series.open(user, { chapterId, stepId, step, mode });
    },

    // Enregistre une série en la corrigeant. Le navigateur n'envoie que les
    // réponses tapées : le score est calculé ici, à partir des mêmes questions.
    recordSeries(user, body) {
      const { session, step, score, total, durationS, detail } = series.grade(user, body, (s) => {
        const { step: etape } = requireStep(user, s.chapter_id, s.step_id, { mode: s.mode });
        if (etape.type !== 'exercise') throw new ProgressError("Cette étape n'est pas un exercice");
        return etape;
      });
      return enregistrer(user, {
        chapterId: session.chapter_id,
        stepId: session.step_id,
        mode: session.mode,
        step,
        score,
        total,
        durationS,
        detail,
      });
    },

    recordSeriesResult: enregistrer,

    dashboard(user) {
      const idx = indexProgress(repos.progress.listForUser(user.id));
      const cls = user.class_id ? repos.classes.findById(user.class_id) : null;
      const homeLevel = cls?.level || content.levels()[0].id;
      const levels = content.levels().map((l) => {
        const states = levelState(user, l.id, idx).filter((s) => s.status !== 'draft');
        return {
          id: l.id,
          label: l.label,
          chaptersTotal: states.length,
          chaptersDone: states.filter((s) => s.status === 'done').length,
          chaptersStarted: states.filter((s) => s.status === 'in_progress').length,
        };
      });
      const recent = repos.attempts.recentForUser(user.id, 8).map((a) => {
        // Les exercices écrits par l'enseignant vivent hors des chapitres.
        if (exercises && a.chapter_id === exercises.CUSTOM_CHAPTER_ID) {
          return {
            chapterId: a.chapter_id,
            chapterTitle: 'Exercice du professeur',
            stepTitle: exercises.titleOfStep(a.step_id) || 'Exercice supprimé',
            score: a.score,
            total: a.total,
            mode: a.mode,
            at: a.created_at,
          };
        }
        const ch = chapterOf(user, a.chapter_id);
        return {
          chapterId: a.chapter_id,
          chapterTitle: ch?.title || a.chapter_id,
          stepTitle: ch?.steps.find((s) => s.id === a.step_id)?.title || a.step_id,
          score: a.score,
          total: a.total,
          mode: a.mode,
          at: a.created_at,
        };
      });
      return {
        homeLevel,
        className: cls?.name || null,
        lastPosition: describePosition(user, repos.positions.get(user.id)),
        next: nextStepIn(user, homeLevel, idx),
        levels,
        recent,
      };
    },

    // Vue enseignant : une ligne par élève, une colonne par chapitre du niveau.
    // ---------- Confiance déclarée ----------

    // L'élève dit, en fin de chapitre, s'il se sent à l'aise. De 1 (perdu) à 4.
    setConfidence(user, { chapterId, level }) {
      const ch = chapterOf(user, chapterId);
      if (!ch) throw new ProgressError('Chapitre introuvable', 404);
      const n = Number(level);
      if (!Number.isInteger(n) || n < 1 || n > 4) throw new ProgressError('Niveau de confiance invalide');
      repos.confidence.set(user.id, ch.id, n);
      return { chapterId: ch.id, level: n };
    },

    confidenceFor: (user, chapterId) => repos.confidence.get(user.id, chapterId)?.level ?? null,

    // ---------- Révision flash ----------

    // Deux questions, pas plus, tirées d'un chapitre déjà terminé. On choisit
    // en priorité ce que l'élève dit mal maîtriser, puis ce qu'il a réussi le
    // moins bien — et jamais un chapitre vu dans la journée.
    revisionFlash(user) {
      if (user.role === 'teacher' || !user.class_id) return null;
      const rows = repos.progress.listForUser(user.id);
      const idx = indexProgress(rows);
      const cls = repos.classes.findById(user.class_id);
      if (!cls) return null;

      const termines = levelState(user, cls.level, idx)
        .filter((s) => s.status === 'done')
        .map((s) => s.chapterId);
      if (!termines.length) return null;

      const confiance = new Map(repos.confidence.listForUser(user.id).map((c) => [c.chapter_id, c.level]));
      const hier = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
      const recents = new Set(
        rows.filter((r) => r.updated_at > hier).map((r) => r.chapter_id)
      );

      const candidats = termines
        .filter((id) => !recents.has(id))
        .map((id) => {
          const ch = chapterOf(user, id);
          const exos = (ch?.steps || []).filter((s) => s.type === 'exercise');
          const scores = exos.map((s) => {
            const r = idx.get(id)?.get(s.id);
            return r?.best_total ? r.best_score / r.best_total : 1;
          });
          return {
            chapterId: id,
            titre: ch?.title || id,
            exercices: exos,
            // Plus la confiance est basse et le score faible, plus c'est prioritaire.
            priorite: (confiance.get(id) ?? 3) + (scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) * 4 : 4),
          };
        })
        .filter((c) => c.exercices.length)
        .sort((a, b) => a.priorite - b.priorite);

      if (!candidats.length) return null;
      const choisi = candidats[0];
      // Deux exercices au plus : une révision flash doit rester flash.
      const etapes = choisi.exercices.slice(0, 2).map((s) => ({
        stepId: s.id,
        title: s.title,
        ...(s.template ? { template: s.template } : { generator: s.generator, params: s.params || {} }),
      }));
      return {
        chapterId: choisi.chapterId,
        chapterTitle: choisi.titre,
        confiance: confiance.get(choisi.chapterId) ?? null,
        etapes,
      };
    },

    // « Où ça coince » : pour un chapitre et une classe, le taux de réussite
    // étape par étape et les réponses fausses qui reviennent le plus souvent.
    chapterDiagnostic(classId, chapterId) {
      const viewer = asStudentOf(classId);
      const ch = chapterOf(viewer, chapterId);
      if (!ch) throw new ProgressError('Chapitre introuvable', 404);
      const students = trierParPseudonyme(repos.users.listByClass(classId));
      const ids = students.map((s) => s.id);
      const byStep = new Map(repos.questionResults.statsByStep(ids, chapterId).map((r) => [r.step_id, r]));
      const names = new Map(students.map((s) => [s.id, s.display_name]));

      const steps = ch.steps
        .filter((s) => s.type === 'exercise')
        .map((s) => {
          const r = byStep.get(s.id);
          const posees = r?.posees || 0;
          return {
            stepId: s.id,
            title: s.title,
            questionsPosees: posees,
            reussite: posees ? Math.round((100 * (r.justes || 0)) / posees) : null,
            elevesConcernes: r?.eleves || 0,
            tempsMoyen: r?.temps_moyen ? Math.round(r.temps_moyen) : null,
          };
        });

      const stepTitle = new Map(ch.steps.map((s) => [s.id, s.title]));
      const erreurs = repos.questionResults.commonMistakes(ids, chapterId).map((m) => ({
        stepId: m.step_id,
        stepTitle: stepTitle.get(m.step_id) || m.step_id,
        prompt: m.prompt,
        expected: m.expected,
        given: m.given,
        fois: m.n,
        eleves: m.eleves,
      }));

      return {
        chapterId: ch.id,
        chapterTitle: ch.title,
        eleves: students.length,
        steps,
        erreurs,
        // Un diagnostic n'a de sens qu'avec assez de réponses derrière.
        assezDeDonnees: steps.some((s) => s.questionsPosees >= 10),
        noms: Object.fromEntries(names),
      };
    },

    classGrid(classId, levelId) {
      const students = trierParPseudonyme(repos.users.listByClass(classId));
      const ids = students.map((s) => s.id);
      const rowsByUser = new Map(ids.map((id) => [id, []]));
      for (const r of repos.progress.listForUsers(ids)) rowsByUser.get(r.user_id).push(r);
      const lastPos = new Map(repos.positions.listForUsers(ids).map((p) => [p.user_id, p]));
      const activity = new Map(repos.attempts.lastActivityForUsers(ids).map((a) => [a.user_id, a]));
      // Le tableau liste les chapitres tels que les voit un élève de la classe,
      // chapitres écrits par l'enseignant compris.
      const viewer = asStudentOf(classId);
      const visible = chaptersOf(viewer, levelId).filter((c) => c.status === 'published');
      return {
        chapters: visible.map((c) => ({ id: c.id, title: c.title, order: c.order, custom: !!c.custom })),
        students: students.map((s) => {
          const states = levelState(viewer, levelId, indexProgress(rowsByUser.get(s.id))).filter((x) => x.status !== 'draft');
          return {
            id: s.id,
            displayName: s.display_name,
            pseudonym: s.display_name,
            username: s.username,
            active: !!s.active,
            lastLoginAt: s.last_login_at,
            lastActivityAt: activity.get(s.id)?.last_at || null,
            attemptsCount: activity.get(s.id)?.n || 0,
            lastPosition: describePosition({ ...viewer, id: s.id }, lastPos.get(s.id)),
            chapters: states.map((x) => ({ chapterId: x.chapterId, status: x.status, percent: x.percent })),
          };
        }),
      };
    },
  };
}

module.exports = { createProgressService, ProgressError };
