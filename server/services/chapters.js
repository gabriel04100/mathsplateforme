// Chapitres écrits par l'enseignant depuis l'interface, et fusion avec le
// programme livré dans content/.
//
// Pour le reste de l'application, un chapitre est un chapitre : ce service
// renvoie les deux sources dans le même format, pour qu'aucune autre partie du
// code n'ait à savoir d'où il vient. Les identifiants des chapitres de la base
// sont préfixés (« c-12 ») pour ne jamais entrer en collision avec les fichiers.
const LEVELS = ['6e', '5e', '4e', '3e'];
const MAX_STEPS = 30;
const MAX_BLOCKS = 40;
const ID_PREFIX = 'c-';

class ChapterError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const publicId = (row) => `${ID_PREFIX}${row.id}`;

function createChaptersService({ repos, content, exercises, shared }) {
  const { richtext, generators, widgets } = shared;

  // Numéro en base d'un chapitre personnel, ou null si l'identifiant désigne un
  // chapitre de content/. On accepte « c-12 » comme « 12 », tant qu'aucun
  // chapitre livré ne porte ce nom.
  function dbIdOf(chapterId) {
    const s = String(chapterId ?? '');
    const m = new RegExp(`^${ID_PREFIX}(\\d+)$`).exec(s);
    if (m) return Number(m[1]);
    if (/^\d+$/.test(s) && !content.chapter(s)) return Number(s);
    return null;
  }

  // L'enseignant dont dépend un utilisateur : lui-même, ou celui de sa classe.
  function teacherIdOf(user) {
    if (!user) return null;
    if (user.role === 'teacher') return user.id;
    const cls = user.class_id ? repos.classes.findById(user.class_id) : null;
    return cls?.teacher_id ?? null;
  }

  function ownedChapter(teacherId, id) {
    const row = repos.customChapters.findById(Number(id));
    if (!row || row.teacher_id !== teacherId) throw new ChapterError('Chapitre introuvable', 404);
    return row;
  }

  // Ligne de base → chapitre au format attendu par le reste de l'application.
  // Les textes de cours sont rendus ici, une fois, en HTML sûr.
  // Étapes enregistrées (texte source) → étapes prêtes pour l'élève :
  // le cours devient du HTML sûr, les exercices personnels portent leur modèle.
  function renderSteps(steps) {
    return steps.map((s) => {
      if (s.type === 'lesson') {
        return {
          ...s,
          blocks: (s.blocks || []).map((b) =>
            // Une vidéo n'a pas de texte à mettre en forme : on envoie son
            // identifiant, le navigateur ne chargera YouTube que sur un clic.
            richtext.isVideoBlock(b)
              ? { type: 'video', title: b.title || '', videoId: richtext.parseYoutubeId(b.text) }
              : { type: b.type, title: b.title || '', html: richtext.renderRichText(b.text) }
          ),
        };
      }
      if (s.type === 'exercise' && s.source === 'custom') {
        // Exercice écrit dans « Mes exercices » : on en recopie le modèle.
        const ex = repos.customExercises.findById(Number(s.exerciseId));
        if (!ex) return { ...s, type: 'exercise', missing: true, count: 1, pass: 1, title: s.title || 'Exercice supprimé' };
        return {
          id: s.id,
          type: 'exercise',
          title: s.title || ex.title,
          instructions: ex.instructions || '',
          count: ex.count,
          pass: ex.pass,
          template: JSON.parse(ex.definition),
        };
      }
      return s;
    });
  }

  function expand(row, { forEditing = false } = {}) {
    const raw = JSON.parse(row.steps);
    const steps = forEditing ? raw : renderSteps(raw);
    return {
      id: publicId(row),
      dbId: row.id,
      custom: true,
      level: row.level,
      order: row.position,
      title: row.title,
      summary: row.summary || '',
      status: row.status,
      archived: !!row.archived,
      classId: row.class_id,
      className: row.class_name ?? null,
      updatedAt: row.updated_at,
      steps,
    };
  }

  // ---------- Modifications des chapitres livrés ----------

  // Étapes d'un chapitre de content/ remises au format de l'éditeur : le cours,
  // écrit en HTML à la main dans les fichiers, redevient du texte modifiable.
  function stepsForEditing(fileChapter) {
    return fileChapter.steps.map((s) => {
      if (s.type === 'lesson') {
        return {
          ...s,
          blocks: (s.blocks || []).map((b) =>
            b.type === 'video'
              ? { type: 'video', title: b.title || '', text: b.videoId || b.text || '' }
              : { type: b.type, title: b.title || '', text: richtext.htmlToRichText(b.html || '') }
          ),
        };
      }
      if (s.type === 'exercise') return { ...s, source: 'generator' };
      return { ...s };
    });
  }

  // Applique la version de l'enseignant à un chapitre de content/.
  // Une valeur absente veut dire « garder ce que dit le fichier ».
  function applyOverride(fileChapter, ov, { forEditing = false } = {}) {
    const base = {
      ...fileChapter,
      custom: false,
      modified: !!ov,
      hidden: !!ov?.hidden,
      order: ov?.position ?? fileChapter.order,
      title: ov?.title ?? fileChapter.title,
      summary: ov?.summary ?? fileChapter.summary ?? '',
      status: ov?.status ?? fileChapter.status,
    };
    if (ov?.steps) {
      const parsed = JSON.parse(ov.steps);
      base.steps = forEditing ? parsed : renderSteps(parsed);
      base.rewritten = true;
    } else if (forEditing) {
      base.steps = stepsForEditing(fileChapter);
    }
    return base;
  }

  // ---------- Lecture fusionnée ----------

  // Tous les chapitres d'un niveau pour cet utilisateur : ceux de content/ (avec
  // les modifications de son enseignant) plus ceux que l'enseignant a écrits.
  function forUser(user, levelId, { includeHidden = false } = {}) {
    const teacherId = teacherIdOf(user);
    const files = content.chaptersOfLevel(levelId);
    if (!teacherId) return files.map((c) => ({ ...c, custom: false, hidden: false, modified: false }));

    const overrides = new Map(repos.chapterOverrides.listByTeacher(teacherId).map((o) => [o.chapter_id, o]));
    const base = files
      .map((c) => applyOverride(c, overrides.get(c.id)))
      .filter((c) => includeHidden || !c.hidden);

    const rows =
      user.role === 'teacher'
        ? repos.customChapters.listByTeacherAndLevel(teacherId, levelId)
        : repos.customChapters.listForClass(user.class_id, levelId);
    const mine = rows.map((r) => expand(r));
    return [...base, ...mine].sort((a, b) => a.order - b.order || Number(a.custom) - Number(b.custom));
  }

  function byIdForUser(user, chapterId) {
    const dbId = dbIdOf(chapterId);
    if (dbId === null) {
      const file = content.chapter(chapterId);
      if (!file) return null;
      const teacherId = teacherIdOf(user);
      if (!teacherId) return { ...file, custom: false, hidden: false, modified: false };
      const ov = repos.chapterOverrides.get(teacherId, chapterId);
      const ch = applyOverride(file, ov);
      // Un chapitre retiré du parcours n'existe plus pour l'élève.
      return ch.hidden && user.role !== 'teacher' ? null : ch;
    }
    const row = repos.customChapters.findById(dbId);
    if (!row) return null;
    // L'enseignant voit les siens (même en brouillon) ; l'élève seulement ce qui
    // est publié, non archivé et destiné à sa classe.
    if (user.role === 'teacher') {
      if (row.teacher_id !== user.id) return null;
    } else {
      const visible = user.class_id && repos.customChapters.listForClass(user.class_id, row.level).some((r) => r.id === row.id);
      if (!visible) return null;
    }
    return expand(row);
  }

  // ---------- Validation ----------

  function validateSteps(teacherId, rawSteps) {
    if (!Array.isArray(rawSteps) || !rawSteps.length) throw new ChapterError('Ajoute au moins une étape au chapitre');
    if (rawSteps.length > MAX_STEPS) throw new ChapterError(`${MAX_STEPS} étapes au maximum`);

    const seen = new Set();
    const errors = [];
    const steps = rawSteps.map((s, i) => {
      const where = `Étape ${i + 1}`;
      const id = String(s.id || `e${i + 1}`).trim();
      if (!/^[a-z0-9-]{1,30}$/.test(id)) errors.push(`${where} : identifiant interne invalide.`);
      if (seen.has(id)) errors.push(`${where} : deux étapes portent le même identifiant.`);
      seen.add(id);
      const title = String(s.title || '').trim();
      if (!title) errors.push(`${where} : donne-lui un titre.`);
      if (title.length > 80) errors.push(`${where} : titre trop long (80 caractères maximum).`);

      if (s.type === 'lesson') {
        const blocks = Array.isArray(s.blocks) ? s.blocks : [];
        if (!blocks.length) errors.push(`${where} : un cours doit contenir au moins un bloc.`);
        if (blocks.length > MAX_BLOCKS) errors.push(`${where} : ${MAX_BLOCKS} blocs au maximum.`);
        blocks.forEach((b, k) => errors.push(...richtext.validateBlock(b, `${where}, bloc ${k + 1}`)));
        return {
          id,
          type: 'lesson',
          title,
          blocks: blocks.map((b) => ({ type: b.type, title: String(b.title || '').trim(), text: String(b.text || '') })),
        };
      }

      if (s.type === 'animation') {
        if (!widgets.WIDGETS[s.widget]) errors.push(`${where} : animation « ${s.widget} » introuvable.`);
        return { id, type: 'animation', title, widget: s.widget, intro: String(s.intro || '').trim() };
      }

      if (s.type === 'exercise') {
        const count = Number(s.count);
        const pass = Number(s.pass);
        if (s.source === 'custom') {
          const ex = repos.customExercises.findById(Number(s.exerciseId));
          if (!ex || ex.teacher_id !== teacherId) errors.push(`${where} : exercice introuvable dans « Mes exercices ».`);
          return { id, type: 'exercise', title, source: 'custom', exerciseId: Number(s.exerciseId) };
        }
        if (!generators.GENERATORS[s.generator]) errors.push(`${where} : type d'exercice « ${s.generator} » inconnu.`);
        if (!Number.isInteger(count) || count < 1 || count > 20) errors.push(`${where} : nombre de questions entre 1 et 20.`);
        if (!Number.isInteger(pass) || pass < 1 || pass > count) errors.push(`${where} : objectif entre 1 et ${count || 'le nombre de questions'}.`);
        return { id, type: 'exercise', title, source: 'generator', generator: s.generator, count, pass };
      }

      errors.push(`${where} : type d'étape inconnu.`);
      return null;
    });

    if (errors.length) throw new ChapterError(errors[0]);
    return steps;
  }

  function validatePayload(teacherId, body, { partial = false } = {}) {
    const out = {};
    if (body.title !== undefined || !partial) {
      const title = String(body.title ?? '').trim().replace(/\s+/g, ' ');
      if (title.length < 3 || title.length > 80) throw new ChapterError('Titre : entre 3 et 80 caractères');
      out.title = title;
    }
    if (body.level !== undefined || !partial) {
      if (!LEVELS.includes(body.level)) throw new ChapterError('Niveau invalide');
      out.level = body.level;
    }
    if (body.summary !== undefined) {
      const summary = String(body.summary ?? '').trim();
      if (summary.length > 200) throw new ChapterError('Résumé : 200 caractères maximum');
      out.summary = summary;
    }
    if (body.position !== undefined) {
      const position = Number(body.position);
      if (!Number.isInteger(position) || position < 1 || position > 999) throw new ChapterError('Position : entre 1 et 999');
      out.position = position;
    }
    if (body.status !== undefined) {
      if (!['draft', 'published'].includes(body.status)) throw new ChapterError('Statut invalide');
      out.status = body.status;
    }
    if (body.archived !== undefined) out.archived = body.archived ? 1 : 0;
    if (body.classId !== undefined) {
      if (body.classId === null || body.classId === '') out.classId = null;
      else {
        const cls = repos.classes.findById(Number(body.classId));
        if (!cls || cls.teacher_id !== teacherId) throw new ChapterError('Classe introuvable', 404);
        out.classId = cls.id;
      }
    }
    if (body.steps !== undefined || !partial) {
      out.steps = JSON.stringify(validateSteps(teacherId, body.steps));
    }
    return out;
  }

  return {
    LEVELS,
    ID_PREFIX,
    dbIdOf,
    teacherIdOf,
    forUser,
    byIdForUser,

    // Catalogue complet (tous niveaux) pour un utilisateur donné.
    catalogFor(user) {
      return content.levels().map((l) => ({
        ...l,
        chapters: forUser(user, l.id).map((c) => (c.custom ? summarizeCustom(c) : content.summarizeChapter(c))),
      }));
    },

    // ---------- Côté enseignant ----------

    listForTeacher(teacherId, { archived = false } = {}) {
      return repos.customChapters.listByTeacher(teacherId, { archived: archived ? 1 : 0 }).map((r) => {
        const ch = expand(r, { forEditing: true });
        return {
          id: ch.id,
          dbId: r.id,
          level: ch.level,
          title: ch.title,
          summary: ch.summary,
          position: ch.order,
          status: ch.status,
          archived: ch.archived,
          classId: ch.classId,
          className: ch.className,
          updatedAt: ch.updatedAt,
          stepCount: ch.steps.length,
        };
      });
    },

    // Un chapitre prêt à être modifié, qu'il vienne de content/ ou de l'enseignant.
    getForTeacher(teacherId, id) {
      const dbId = dbIdOf(id);
      if (dbId !== null) return { ...expand(ownedChapter(teacherId, dbId), { forEditing: true }), origin: 'perso' };
      const file = content.chapter(id);
      if (!file) throw new ChapterError('Chapitre introuvable', 404);
      const ov = repos.chapterOverrides.get(teacherId, id);
      const ch = applyOverride(file, ov, { forEditing: true });
      return { ...ch, origin: 'fichier', modified: !!ov, dbId: null, classId: null, className: null };
    },

    // Le parcours complet d'un niveau tel que le verront les classes de
    // l'enseignant, chapitres masqués compris (il doit pouvoir les remettre).
    parcoursForTeacher(teacherId, levelId) {
      const user = { role: 'teacher', id: teacherId, class_id: null };
      return forUser(user, levelId, { includeHidden: true }).map((c) => ({
        id: c.id,
        dbId: c.custom ? c.dbId : null,
        origin: c.custom ? 'perso' : 'fichier',
        level: c.level,
        order: c.order,
        title: c.title,
        summary: c.summary || '',
        status: c.status,
        hidden: !!c.hidden,
        modified: !!c.modified,
        rewritten: !!c.rewritten,
        stepCount: c.steps.length,
        className: c.className ?? null,
      }));
    },

    // Nouvel ordre du parcours : la liste des identifiants, dans l'ordre voulu.
    reorder(teacherId, levelId, orderedIds) {
      if (!Array.isArray(orderedIds) || !orderedIds.length) throw new ChapterError('Ordre invalide');
      const known = new Set(this.parcoursForTeacher(teacherId, levelId).map((c) => c.id));
      for (const id of orderedIds) if (!known.has(id)) throw new ChapterError(`Chapitre inconnu dans ce niveau : ${id}`, 404);
      repos.transaction(() => {
        orderedIds.forEach((id, i) => {
          const position = i + 1;
          const dbId = dbIdOf(id);
          if (dbId !== null) repos.customChapters.update(ownedChapter(teacherId, dbId).id, { position });
          else repos.chapterOverrides.upsert(teacherId, id, { position });
        });
      });
      return this.parcoursForTeacher(teacherId, levelId);
    },

    // Enregistre la version de l'enseignant pour un chapitre de content/.
    saveOverride(teacherId, chapterId, body) {
      const file = content.chapter(chapterId);
      if (!file) throw new ChapterError('Chapitre introuvable', 404);
      const fields = {};
      if (body.title !== undefined) {
        const title = String(body.title ?? '').trim().replace(/\s+/g, ' ');
        if (title.length < 3 || title.length > 80) throw new ChapterError('Titre : entre 3 et 80 caractères');
        fields.title = title;
      }
      if (body.summary !== undefined) {
        const summary = String(body.summary ?? '').trim();
        if (summary.length > 200) throw new ChapterError('Résumé : 200 caractères maximum');
        fields.summary = summary;
      }
      if (body.position !== undefined) {
        const position = Number(body.position);
        if (!Number.isInteger(position) || position < 1 || position > 999) throw new ChapterError('Position : entre 1 et 999');
        fields.position = position;
      }
      if (body.status !== undefined) {
        if (!['draft', 'published'].includes(body.status)) throw new ChapterError('Statut invalide');
        fields.status = body.status;
      }
      if (body.hidden !== undefined) fields.hidden = body.hidden ? 1 : 0;
      if (body.steps !== undefined) fields.steps = JSON.stringify(validateSteps(teacherId, body.steps));
      repos.chapterOverrides.upsert(teacherId, chapterId, fields);
      return this.getForTeacher(teacherId, chapterId);
    },

    // Oublier toutes les modifications : le chapitre redevient celui du fichier.
    resetOverride(teacherId, chapterId) {
      if (!content.chapter(chapterId)) throw new ChapterError('Chapitre introuvable', 404);
      repos.chapterOverrides.remove(teacherId, chapterId);
      return this.getForTeacher(teacherId, chapterId);
    },

    create(teacherId, body) {
      const fields = validatePayload(teacherId, body);
      // Par défaut, le chapitre se place à la suite de ceux du niveau.
      if (fields.position === undefined) {
        const existing = repos.customChapters.listByTeacherAndLevel(teacherId, fields.level);
        const builtIn = content.chaptersOfLevel(fields.level).length;
        fields.position = Math.max(builtIn, ...existing.map((e) => e.position)) + 1;
      }
      const id = repos.customChapters.create({
        teacherId,
        level: fields.level,
        title: fields.title,
        summary: fields.summary || '',
        position: fields.position,
        steps: fields.steps,
        status: fields.status || 'draft',
        classId: fields.classId ?? null,
      });
      return expand(repos.customChapters.findById(id), { forEditing: true });
    },

    // Même porte d'entrée pour les deux origines : un chapitre de content/ est
    // modifié « par-dessus », un chapitre personnel est modifié directement.
    update(teacherId, id, body) {
      const dbId = dbIdOf(id);
      if (dbId === null) return this.saveOverride(teacherId, id, body);
      const row = ownedChapter(teacherId, dbId);
      const fields = validatePayload(teacherId, body, { partial: true });
      repos.customChapters.update(row.id, fields);
      return { ...expand(repos.customChapters.findById(row.id), { forEditing: true }), origin: 'perso' };
    },

    // Supprimer un chapitre personnel ; pour un chapitre livré, on ne supprime
    // rien : on efface seulement les modifications.
    remove(teacherId, id) {
      const dbId = dbIdOf(id);
      if (dbId === null) return this.resetOverride(teacherId, id);
      repos.customChapters.remove(ownedChapter(teacherId, dbId).id);
      return null;
    },

    // Ce que l'éditeur propose : blocs, animations et types d'exercices disponibles.
    // Les animations partent avec leur nom lisible, jamais leur identifiant seul.
    palette(teacherId) {
      return {
        blocks: richtext.BLOCK_TYPES,
        widgets: Object.keys(widgets.WIDGETS).map((id) => ({
          id,
          label: widgets.WIDGET_INFO[id]?.label || id,
          level: widgets.WIDGET_INFO[id]?.level || null,
          hint: widgets.WIDGET_INFO[id]?.hint || '',
        })),
        generators: Object.keys(generators.GENERATORS),
        exercises: exercises.listForTeacher(teacherId).map((e) => ({ id: e.id, title: e.title, level: e.level, count: e.count, pass: e.pass })),
      };
    },
  };

  function summarizeCustom(ch) {
    return {
      id: ch.id,
      level: ch.level,
      order: ch.order,
      title: ch.title,
      theme: null,
      summary: ch.summary,
      status: ch.status,
      custom: true,
      steps: ch.steps.map((s) => ({ id: s.id, type: s.type, title: s.title, ...(s.type === 'exercise' ? { count: s.count, pass: s.pass } : {}) })),
    };
  }
}

module.exports = { createChaptersService, ChapterError, LEVELS };
