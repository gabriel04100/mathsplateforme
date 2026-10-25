// Séances : activités et feuilles d'exercices posées à côté du parcours.
//
// Un chapitre s'inscrit dans une progression — il attend le précédent et
// débloque le suivant. Une séance, non : elle correspond à une heure de cours
// qu'on donne et qu'on retire. D'où une liste plate, sans numéro ni verrou.
import { api } from '../api.js';
import { esc, relativeTime, stepIcon, progressBar, toast } from '../ui.js';

const ICONE = { activite: '🧪', exercices: '✏️' };

function carte(s) {
  const p = s.progress || {};
  const etapes = s.steps
    .map((e) => {
      const fait = p.steps?.find((x) => x.id === e.id)?.done;
      return `<span class="dot${fait ? ' done' : ''}" title="${esc(e.title)}">${stepIcon(e.type)}</span>`;
    })
    .join('');
  const exos = s.steps.filter((e) => e.type === 'exercise').length;
  return `<li class="seance-card s-${p.status || 'not_started'}">
    <a href="/chapitre/${s.id}" data-link>
      <span class="seance-kind" aria-hidden="true">${ICONE[s.kind] || '📄'}</span>
      <span class="seance-body">
        <span class="seance-top"><span class="tag">${esc(s.kindLabel || '')}</span><span class="tag lv">${esc(s.level)}</span></span>
        <strong>${esc(s.title)}</strong>
        ${s.summary ? `<span class="seance-summary">${esc(s.summary)}</span>` : ''}
        <span class="seance-meta">${etapes}${exos ? `<span class="muted small">${exos} exercice${exos > 1 ? 's' : ''}</span>` : ''}${progressBar(p.percent || 0, s.level)}</span>
      </span>
    </a>
  </li>`;
}

export async function seancesView({ el }) {
  const { seances } = await api.get('/seances');
  el.innerHTML = `
  <section class="page">
    <header class="page-head">
      <h1>Séances</h1>
      <p class="muted">Les activités et les feuilles d’exercices données par ton professeur. Elles ne sont jamais verrouillées : tu peux les ouvrir dans l’ordre que tu veux.</p>
    </header>
    ${
      seances.length
        ? `<ul class="seance-list">${seances.map(carte).join('')}</ul>`
        : '<p class="empty">Aucune séance pour le moment. Ton professeur en déposera ici quand il y en aura.</p>'
    }
  </section>`;
}

// ---------- Côté enseignant ----------

export async function teacherSeancesView({ el }) {
  await draw();

  async function draw() {
    const { chapters } = await api.get('/teacher/chapters?type=seance');
    const { chapters: archivees } = await api.get('/teacher/chapters?type=seance&archives=1');
    el.innerHTML = `
    <section class="page">
      <nav class="crumbs"><a href="/prof" data-link>Mes classes</a> <span aria-hidden="true">/</span> Mes séances</nav>
      <header class="page-head row">
        <div><h1>Mes séances</h1>
          <p class="muted">Une activité ou une feuille d’exercices pour une heure de cours. Hors parcours : rien n’est verrouillé,
            ni avant, ni après. Pour une progression numérotée, passe par <a href="/prof/chapitres" data-link>Mes chapitres</a>.</p></div>
        <div class="head-actions">
          <a class="btn" href="/prof/chapitres/nouveau?type=activite" data-link>+ Activité</a>
          <a class="btn ghost" href="/prof/chapitres/nouveau?type=exercices" data-link>+ Feuille d’exercices</a>
        </div>
      </header>
      ${
        chapters.length
          ? `<div class="table-wrap"><table class="list">
          <thead><tr><th>Titre</th><th>Type</th><th>Niveau</th><th>Pour</th><th>Étapes</th><th>État</th><th>Modifiée</th><th><span class="sr">Actions</span></th></tr></thead>
          <tbody>${chapters
            .map(
              (c) => `<tr>
            <th scope="row"><a href="/prof/chapitres/${c.dbId}" data-link>${esc(c.title)}</a></th>
            <td>${esc(c.kindLabel)}</td>
            <td>${esc(c.level)}</td>
            <td>${c.className ? esc(c.className) : '<span class="muted">toutes mes classes</span>'}</td>
            <td>${c.stepCount}</td>
            <td><span class="tag ${c.status === 'published' ? 'ok' : ''}">${c.status === 'published' ? 'Publiée' : 'Brouillon'}</span></td>
            <td>${relativeTime(c.updatedAt)}</td>
            <td class="actions">
              <button type="button" class="linkbtn" data-arch="${c.dbId}">Archiver</button>
              <button type="button" class="linkbtn danger" data-del="${c.dbId}" data-title="${esc(c.title)}">Supprimer</button>
            </td></tr>`
            )
            .join('')}</tbody></table></div>`
          : '<p class="empty">Aucune séance. Commence par une activité ou une feuille d’exercices.</p>'
      }
      ${
        archivees.length
          ? `<details class="archives"><summary>${archivees.length} séance${archivees.length > 1 ? 's' : ''} archivée${archivees.length > 1 ? 's' : ''}</summary>
          <ul class="plain">${archivees
            .map((c) => `<li>${esc(c.title)} <span class="muted small">${esc(c.level)}</span> <button type="button" class="linkbtn" data-unarch="${c.dbId}">Désarchiver</button></li>`)
            .join('')}</ul></details>`
          : ''
      }
    </section>`;

    const agir = async (fn, message) => {
      try {
        await fn();
        toast(message);
        await draw();
      } catch (e) {
        toast(e.message, 'error');
      }
    };
    el.querySelectorAll('[data-arch]').forEach((b) => {
      b.onclick = () => agir(() => api.patch(`/teacher/chapters/${b.dataset.arch}`, { archived: true }), 'Séance archivée.');
    });
    el.querySelectorAll('[data-unarch]').forEach((b) => {
      b.onclick = () => agir(() => api.patch(`/teacher/chapters/${b.dataset.unarch}`, { archived: false }), 'Séance remise en place.');
    });
    el.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => {
        if (!confirm(`Supprimer définitivement la séance « ${b.dataset.title} » ? La progression des élèves sur cette séance sera perdue.`)) return;
        return agir(() => api.del(`/teacher/chapters/${b.dataset.del}`), 'Séance supprimée.');
      };
    });
  }
}
