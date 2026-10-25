// Documents PDF : dépôt côté enseignant, téléchargement côté élève.
import { api } from '../api.js';
import { getCatalog } from '../app.js';
import { esc, relativeTime, toast } from '../ui.js';

const LEVELS = ['6e', '5e', '4e', '3e'];
const MAX_MO = 20;

// Lit un fichier choisi par l'enseignant et le transforme en base64.
const toBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]*;base64,/, ''));
    reader.onerror = () => reject(new Error('Le fichier n’a pas pu être lu.'));
    reader.readAsDataURL(file);
  });

export async function teacherDocumentsView({ el, query }) {
  const [levels, { classes }, { documents }] = await Promise.all([
    getCatalog(),
    api.get('/teacher/classes'),
    api.get('/documents'),
  ]);
  let level = LEVELS.includes(query.get('niveau')) ? query.get('niveau') : LEVELS[0];
  let fichier = null;

  function chapitresDe(l) {
    return (levels.find((x) => x.id === l)?.chapters || []).filter((c) => c.status === 'published');
  }

  function draw() {
    const mes = documents.filter((d) => d.level === level);
    el.innerHTML = `
    <section class="page wide lv-${level}">
      <nav class="crumbs"><a href="/prof" data-link>Mes classes</a> <span aria-hidden="true">/</span> Mes documents</nav>
      <header class="page-head">
        <h1>Mes documents</h1>
        <p class="muted">Dépose des PDF — un cours scanné, une fiche de révision, un sujet corrigé. Tes élèves les retrouvent dans leur niveau, et dans le chapitre si tu en choisis un.</p>
      </header>

      <div class="seg" role="tablist" aria-label="Niveau">
        ${LEVELS.map((l) => `<button type="button" role="tab" class="seg-btn lv-${l}" aria-selected="${l === level}" data-level="${l}">${l}</button>`).join('')}
      </div>

      <div class="docs-layout">
        <div>
          ${
            mes.length
              ? `<div class="table-wrap"><table class="list">
                  <thead><tr><th>Document</th><th>Chapitre</th><th>Pour</th><th>Taille</th><th>Téléchargé</th><th><span class="sr">Actions</span></th></tr></thead>
                  <tbody>${mes
                    .map(
                      (d) => `<tr data-id="${d.id}">
                        <td><strong>${esc(d.title)}</strong><span class="muted small">${esc(d.filename)} · déposé ${relativeTime(d.createdAt)}</span></td>
                        <td>${d.chapterTitle ? esc(d.chapterTitle) : '<span class="muted">tout le niveau</span>'}</td>
                        <td>${d.className ? esc(d.className) : '<span class="muted">toutes mes classes</span>'}</td>
                        <td>${d.sizeKo} Ko</td>
                        <td>${d.downloads} fois</td>
                        <td class="actions">
                          <a class="linkbtn" href="/api/documents/${d.id}/fichier">Ouvrir</a>
                          <button type="button" class="linkbtn danger" data-del>Supprimer</button>
                        </td>
                      </tr>`
                    )
                    .join('')}</tbody></table></div>`
              : `<p class="empty">Aucun document pour la ${esc(level)}. Dépose ton premier PDF à droite.</p>`
          }
        </div>

        <form class="panel" id="doc-form" novalidate>
          <h2>Déposer un PDF</h2>
          <label class="field"><span>Fichier</span>
            <input type="file" name="fichier" accept="application/pdf,.pdf"></label>
          <p class="muted small" data-file-info>Format PDF, ${MAX_MO} Mo maximum.</p>

          <label class="field"><span>Titre vu par les élèves</span>
            <input name="title" maxlength="100" placeholder="ex. Le cours en PDF"></label>

          <label class="field"><span>Chapitre <span class="muted">(facultatif)</span></span>
            <select name="chapterId">
              <option value="">Tout le niveau ${esc(level)}</option>
              ${chapitresDe(level).map((c) => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('')}
            </select></label>

          <label class="field"><span>Pour</span>
            <select name="classId">
              <option value="">Toutes mes classes de ce niveau</option>
              ${classes.filter((c) => c.level === level).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
            </select></label>

          <p class="form-error" role="alert" hidden></p>
          <button class="btn" type="submit">Déposer</button>
        </form>
      </div>
    </section>`;

    el.querySelectorAll('[data-level]').forEach(
      (b) =>
        (b.onclick = () => {
          level = b.dataset.level;
          fichier = null;
          history.replaceState(null, '', `/prof/documents?niveau=${level}`);
          draw();
        })
    );

    const form = el.querySelector('#doc-form');
    const info = form.querySelector('[data-file-info]');
    form.fichier.onchange = () => {
      fichier = form.fichier.files[0] || null;
      if (!fichier) {
        info.textContent = `Format PDF, ${MAX_MO} Mo maximum.`;
        return;
      }
      const mo = fichier.size / 1024 / 1024;
      info.textContent = `${fichier.name} — ${mo < 1 ? `${Math.round(fichier.size / 1024)} Ko` : `${mo.toFixed(1)} Mo`}`;
      // Le titre se pré-remplit avec le nom du fichier, sans l'extension.
      if (!form.title.value) form.title.value = fichier.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').slice(0, 100);
    };

    form.onsubmit = async (e) => {
      e.preventDefault();
      const err = form.querySelector('.form-error');
      err.hidden = true;
      const fail = (m) => {
        err.textContent = m;
        err.hidden = false;
      };
      if (!fichier) return fail('Choisis un fichier PDF.');
      if (fichier.size > MAX_MO * 1024 * 1024) return fail(`Fichier trop lourd (${MAX_MO} Mo maximum).`);
      if (!form.title.value.trim()) return fail('Donne un titre à ce document.');

      const bouton = form.querySelector('button[type=submit]');
      bouton.disabled = true;
      bouton.textContent = 'Envoi…';
      try {
        const { document: cree } = await api.post('/documents', {
          title: form.title.value,
          level,
          chapterId: form.chapterId.value || null,
          classId: form.classId.value || null,
          filename: fichier.name,
          fileBase64: await toBase64(fichier),
        });
        documents.unshift(cree);
        toast('Document déposé : tes élèves peuvent le télécharger.', 'success');
        fichier = null;
        draw();
      } catch (ex) {
        fail(ex.message);
        bouton.disabled = false;
        bouton.textContent = 'Déposer';
      }
    };

    el.querySelectorAll('tr[data-id]').forEach((tr) => {
      const d = documents.find((x) => x.id === Number(tr.dataset.id));
      tr.querySelector('[data-del]').onclick = async () => {
        if (!confirm(`Supprimer « ${d.title} » ? Le fichier sera effacé du serveur.`)) return;
        try {
          await api.del(`/documents/${d.id}`);
          documents.splice(documents.indexOf(d), 1);
          toast('Document supprimé.');
          draw();
        } catch (ex) {
          toast(ex.message, 'error');
        }
      };
    });
  }

  draw();
}

// Liste des documents d'un chapitre, insérée dans la page de l'élève.
export function documentsListHtml(docs) {
  if (!docs.length) return '';
  return `<section class="doc-block">
    <h2>Documents à télécharger</h2>
    <ul class="doc-list">
      ${docs
        .map(
          (d) => `<li><a class="doc-item" href="/api/documents/${d.id}/fichier">
            <span class="doc-ico" aria-hidden="true">PDF</span>
            <span class="doc-body"><strong>${esc(d.title)}</strong><span class="muted small">${d.sizeKo} Ko</span></span>
            <span class="doc-go" aria-hidden="true">↓</span>
          </a></li>`
        )
        .join('')}
    </ul>
  </section>`;
}
