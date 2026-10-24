// Documents PDF déposés par l'enseignant, téléchargés par ses élèves.
//
// Le fichier arrive encodé en base64 dans du JSON plutôt qu'en multipart :
// cela évite une dépendance de plus pour une fonction simple, et la plateforme
// n'a pas vocation à recevoir des fichiers de 500 Mo. Le contenu est vérifié
// (c'est bien un PDF), le nom est réécrit, et rien de ce que l'enseignant
// envoie ne sert à construire un chemin sur le disque.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LEVELS = ['6e', '5e', '4e', '3e'];
const MAX_BYTES = 20 * 1024 * 1024; // 20 Mo : large pour un cours scanné
const MAX_PER_TEACHER = 500;
const PDF_MAGIC = '%PDF-';

class DocumentError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function createDocumentsService({ repos, config, content }) {
  const dir = path.join(path.dirname(config.dbFile), 'documents');

  function ensureDir() {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Le chemin ne se construit qu'à partir du nom tiré au sort en base :
  // jamais à partir de quoi que ce soit venu de la requête.
  function fileOf(row) {
    if (!/^[a-f0-9]{32}\.pdf$/.test(row.stored_name)) throw new DocumentError('Document illisible', 500);
    return path.join(dir, row.stored_name);
  }

  function owned(teacherId, id) {
    const d = repos.documents.findById(Number(id));
    if (!d || d.teacher_id !== teacherId) throw new DocumentError('Document introuvable', 404);
    return d;
  }

  // Nom affiché à l'élève. On garde un nom lisible, sans chemin ni caractère
  // susceptible de poser problème au téléchargement.
  function cleanFilename(raw) {
    const base = path.basename(String(raw || 'document.pdf')).replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    const withoutExt = base.replace(/\.pdf$/i, '').slice(0, 80) || 'document';
    return `${withoutExt}.pdf`;
  }

  const publicDoc = (d) => ({
    id: d.id,
    level: d.level,
    chapterId: d.chapter_id,
    chapterTitle: d.chapter_id ? content.chapter(d.chapter_id)?.title || null : null,
    classId: d.class_id,
    className: d.class_name ?? null,
    title: d.title,
    filename: d.filename,
    sizeKo: Math.max(1, Math.round(d.size_bytes / 1024)),
    downloads: d.downloads,
    createdAt: d.created_at,
  });

  return {
    LEVELS,
    MAX_BYTES,

    listForTeacher: (teacherId) => repos.documents.listByTeacher(teacherId).map(publicDoc),

    // Ce qu'un élève peut voir : les documents de son enseignant, pour son
    // niveau, destinés soit à toutes ses classes soit à la sienne.
    listForStudent(user, { level, chapterId } = {}) {
      if (!user.class_id) return [];
      const cls = repos.classes.findById(user.class_id);
      if (!cls) return [];
      return repos.documents
        .listForClass(cls.id, level || cls.level)
        .filter((d) => (chapterId ? d.chapter_id === chapterId : true))
        .map(publicDoc);
    },

    create(teacherId, body) {
      ensureDir();
      if (repos.documents.listByTeacher(teacherId).length >= MAX_PER_TEACHER) {
        throw new DocumentError(`${MAX_PER_TEACHER} documents au maximum`);
      }

      const title = String(body.title ?? '').trim().replace(/\s+/g, ' ');
      if (title.length < 2 || title.length > 100) throw new DocumentError('Titre : entre 2 et 100 caractères');
      if (!LEVELS.includes(body.level)) throw new DocumentError('Niveau invalide');

      let chapterId = null;
      if (body.chapterId) {
        chapterId = String(body.chapterId);
        if (!content.chapter(chapterId) && !/^c-\d+$/.test(chapterId)) throw new DocumentError('Chapitre introuvable', 404);
      }
      let classId = null;
      if (body.classId) {
        const cls = repos.classes.findById(Number(body.classId));
        if (!cls || cls.teacher_id !== teacherId) throw new DocumentError('Classe introuvable', 404);
        classId = cls.id;
      }

      // Le fichier : base64 nu, ou préfixé « data:application/pdf;base64, ».
      const raw = String(body.fileBase64 ?? '').replace(/^data:[^;]*;base64,/, '');
      if (!raw) throw new DocumentError('Aucun fichier reçu');
      let buf;
      try {
        buf = Buffer.from(raw, 'base64');
      } catch {
        throw new DocumentError('Fichier illisible');
      }
      if (!buf.length) throw new DocumentError('Fichier vide');
      if (buf.length > MAX_BYTES) throw new DocumentError(`Fichier trop lourd (${Math.round(MAX_BYTES / 1024 / 1024)} Mo maximum)`);
      // On vérifie le contenu, pas l'extension : un .pdf qui n'en est pas un est refusé.
      if (buf.subarray(0, PDF_MAGIC.length).toString('latin1') !== PDF_MAGIC) {
        throw new DocumentError('Seuls les fichiers PDF sont acceptés');
      }

      const storedName = `${crypto.randomBytes(16).toString('hex')}.pdf`;
      fs.writeFileSync(path.join(dir, storedName), buf);
      try {
        const id = repos.documents.create({
          teacherId,
          level: body.level,
          chapterId,
          classId,
          title,
          filename: cleanFilename(body.filename),
          storedName,
          sizeBytes: buf.length,
        });
        return publicDoc(repos.documents.findById(id));
      } catch (e) {
        // La base a refusé : on ne laisse pas un fichier orphelin sur le disque.
        fs.rmSync(path.join(dir, storedName), { force: true });
        throw e;
      }
    },

    // Prépare un téléchargement : vérifie le droit d'accès et rend le chemin.
    open(user, id) {
      const d = repos.documents.findById(Number(id));
      if (!d) throw new DocumentError('Document introuvable', 404);
      if (user.role === 'teacher') {
        if (d.teacher_id !== user.id) throw new DocumentError('Document introuvable', 404);
      } else {
        const visible = user.class_id && repos.documents.listForClass(user.class_id, d.level).some((x) => x.id === d.id);
        if (!visible) throw new DocumentError('Document introuvable', 404);
      }
      const file = fileOf(d);
      if (!fs.existsSync(file)) throw new DocumentError('Fichier introuvable sur le serveur', 410);
      if (user.role === 'student') repos.documents.countDownload(d.id);
      return { file, filename: d.filename, sizeBytes: d.size_bytes };
    },

    update(teacherId, id, body) {
      const d = owned(teacherId, id);
      const fields = {};
      if (body.title !== undefined) {
        const title = String(body.title ?? '').trim().replace(/\s+/g, ' ');
        if (title.length < 2 || title.length > 100) throw new DocumentError('Titre : entre 2 et 100 caractères');
        fields.title = title;
      }
      if (body.chapterId !== undefined) fields.chapterId = body.chapterId || null;
      if (body.classId !== undefined) {
        if (!body.classId) fields.classId = null;
        else {
          const cls = repos.classes.findById(Number(body.classId));
          if (!cls || cls.teacher_id !== teacherId) throw new DocumentError('Classe introuvable', 404);
          fields.classId = cls.id;
        }
      }
      repos.documents.update(d.id, fields);
      return publicDoc(repos.documents.findById(d.id));
    },

    remove(teacherId, id) {
      const d = owned(teacherId, id);
      // La ligne d'abord : si l'effacement du fichier échoue, l'élève ne voit
      // déjà plus un document qu'on n'a pas pu supprimer.
      repos.documents.remove(d.id);
      fs.rmSync(fileOf(d), { force: true });
    },
  };
}

module.exports = { createDocumentsService, DocumentError, LEVELS, MAX_BYTES };
