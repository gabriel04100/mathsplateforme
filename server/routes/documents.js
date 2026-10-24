// Documents PDF : dépôt par l'enseignant, téléchargement par ses élèves.
const fs = require('node:fs');
const express = require('express');
const { requireAuth, requireRole } = require('../middleware');
const { MAX_BYTES } = require('../services/documents');

module.exports = function documentRoutes({ documents }) {
  const r = express.Router();
  r.use(requireAuth);

  // Ce que l'élève (ou l'enseignant) peut consulter pour un niveau.
  r.get('/', (req, res) =>
    res.json({
      documents:
        req.user.role === 'teacher'
          ? documents.listForTeacher(req.user.id)
          : documents.listForStudent(req.user, { level: req.query.niveau, chapterId: req.query.chapitre }),
    })
  );

  // Téléchargement. Le fichier est servi en pièce jointe, jamais affiché en
  // ligne : un PDF ouvert dans la page partagerait l'origine du site.
  r.get('/:id/fichier', (req, res, next) => {
    let doc;
    try {
      doc = documents.open(req.user, req.params.id);
    } catch (e) {
      return next(e);
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', doc.sizeBytes);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(doc.filename)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(doc.file).on('error', next).pipe(res);
  });

  // Le dépôt arrive en base64 : il lui faut sa propre limite de corps, bien
  // au-delà des 200 ko du reste de l'API (base64 pèse un tiers de plus).
  const uploadBody = express.json({ limit: Math.ceil((MAX_BYTES * 4) / 3) + 100000 });

  r.post('/', requireRole('teacher'), uploadBody, (req, res) =>
    res.status(201).json({ document: documents.create(req.user.id, req.body || {}) })
  );
  r.patch('/:id', requireRole('teacher'), (req, res) =>
    res.json({ document: documents.update(req.user.id, req.params.id, req.body || {}) })
  );
  r.delete('/:id', requireRole('teacher'), (req, res) => {
    documents.remove(req.user.id, req.params.id);
    res.json({ ok: true });
  });

  return r;
};
