// Les chapitres d'un niveau, vus par l'enseignant : la seule page où l'on gère
// le contenu. Elle montre TOUS les chapitres dans l'ordre où les élèves les
// rencontreront — ceux livrés avec la plateforme comme ceux qu'il a écrits —
// et tout s'y fait : déplacer, masquer, réécrire, archiver, supprimer.
import { api } from '../api.js';
import { navigate } from '../app.js';
import { esc, relativeTime, toast } from '../ui.js';

const LEVELS = ['6e', '5e', '4e', '3e'];

export async function teacherParcoursView({ el, query }) {
  let level = query.get('niveau');
  if (!LEVELS.includes(level)) level = LEVELS[0];
  let showArchives = query.get('archives') === '1';
  let chapters = []; // tout le niveau, retirés compris
  let active = []; // ce que les élèves voient, dans l'ordre
  let hidden = []; // chapitres livrés retirés du parcours
  let archived = []; // chapitres personnels archivés

  async function load() {
    const [parcours, archives] = await Promise.all([
      api.get(`/teacher/parcours/${level}`),
      api.get('/teacher/chapters?archives=1'),
    ]);
    chapters = parcours.chapters;
    active = chapters.filter((c) => !c.hidden);
    hidden = chapters.filter((c) => c.hidden);
    archived = archives.chapters.filter((c) => c.level === level);
    draw();
  }

  // Une pastille par information utile, sans jargon.
  function badges(c) {
    const out = [];
    if (c.origin === 'perso') out.push('<span class="tag">écrit par moi</span>');
    if (c.origin === 'fichier' && c.modified) out.push('<span class="tag ok">modifié</span>');
    // « Bientôt » est l'étiquette des chapitres encore vides livrés avec la
    // plateforme ; pour les siens, on parle de brouillon.
    if (c.status === 'draft') out.push(`<span class="tag">${c.origin === 'perso' ? 'Brouillon' : 'Bientôt'}</span>`);
    return out.join('');
  }

  function rowHtml(c, i) {
    const isMine = c.origin === 'perso';
    const key = encodeURIComponent(c.id);
    return `<li class="parcours-row" data-id="${esc(c.id)}">
      <span class="pc-num">${i + 1}</span>
      <span class="pc-body">
        <span class="pc-title">${esc(c.title)}${badges(c)}</span>
        <span class="muted small">${c.stepCount} étape${c.stepCount > 1 ? 's' : ''}${c.summary ? ` · ${esc(c.summary)}` : ''}</span>
      </span>
      <span class="pc-tools">
        <button type="button" class="rowdel" data-up ${i === 0 ? 'disabled' : ''} title="Monter">↑</button>
        <button type="button" class="rowdel" data-down ${i === active.length - 1 ? 'disabled' : ''} title="Descendre">↓</button>
        <a class="linkbtn" href="/prof/chapitres/${key}" data-link>Modifier</a>
        <a class="linkbtn" href="/chapitre/${key}" data-link>Voir</a>
        ${isMine ? '<button type="button" class="linkbtn" data-archive>Archiver</button>' : ''}
        ${!isMine && c.modified ? '<button type="button" class="linkbtn" data-reset>Version d’origine</button>' : ''}
      </span>
      <button type="button" class="pc-remove" data-remove
        title="${isMine ? 'Supprimer ce chapitre' : 'Retirer du parcours'}"
        aria-label="${isMine ? `Supprimer ${esc(c.title)}` : `Retirer ${esc(c.title)} du parcours`}">✕</button>
    </li>`;
  }

  // Ce qui a été sorti du parcours : chapitres livrés retirés et chapitres
  // personnels archivés. Rangés ensemble, car pour l'enseignant c'est la même
  // idée — ce que ses élèves ne voient plus.
  function removedHtml() {
    const items = [
      ...hidden.map((c) => ({ kind: 'fichier', id: c.id, title: c.title, stepCount: c.stepCount })),
      ...archived.map((c) => ({ kind: 'perso', dbId: c.dbId, title: c.title, stepCount: c.stepCount, updatedAt: c.updatedAt })),
    ];
    if (!items.length) return '';
    return `<section class="archives-block">
      <button type="button" class="linkbtn" data-toggle-archives aria-expanded="${showArchives}">
        ${showArchives ? '▾' : '▸'} Retirés du parcours de ${esc(level)} (${items.length})
      </button>
      ${
        showArchives
          ? `<ul class="parcours archived-list">${items
              .map(
                (c) => `<li class="parcours-row is-hidden" ${c.kind === 'perso' ? `data-arch-id="${c.dbId}"` : `data-back-id="${esc(c.id)}"`}>
                  <span class="pc-num">—</span>
                  <span class="pc-body">
                    <span class="pc-title">${esc(c.title)}<span class="tag">${c.kind === 'perso' ? 'archivé' : 'retiré'}</span></span>
                    <span class="muted small">${c.stepCount} étape${c.stepCount > 1 ? 's' : ''}${
                      c.kind === 'fichier' ? ' · livré avec la plateforme' : ` · modifié ${relativeTime(c.updatedAt)}`
                    }</span>
                  </span>
                  <span class="pc-tools">
                    <button type="button" class="linkbtn" data-restore>Remettre dans le parcours</button>
                    ${c.kind === 'perso' ? '<button type="button" class="linkbtn danger" data-del>Supprimer définitivement</button>' : ''}
                  </span>
                </li>`
              )
              .join('')}</ul>`
          : ''
      }
    </section>`;
  }

  function draw() {
    el.innerHTML = `
    <section class="page wide lv-${level}">
      <nav class="crumbs"><a href="/prof" data-link>Mes classes</a> <span aria-hidden="true">/</span> Mes chapitres</nav>
      <header class="page-head row">
        <div>
          <h1>Mes chapitres</h1>
          <p class="muted">Tout le contenu d’un niveau, dans l’ordre où tes élèves le rencontreront : les chapitres livrés avec la plateforme et les tiens. Tu peux tout déplacer, masquer ou réécrire.</p>
        </div>
        <a class="btn" href="/prof/chapitres/nouveau?niveau=${level}" data-link>Nouveau chapitre</a>
      </header>

      <div class="seg" role="tablist" aria-label="Niveau">
        ${LEVELS.map((l) => `<button type="button" role="tab" class="seg-btn lv-${l}" aria-selected="${l === level}" data-level="${l}">${l}</button>`).join('')}
      </div>

      <ol class="parcours" data-list>${active.map(rowHtml).join('')}</ol>
      <p class="muted small">La croix <strong>✕</strong> retire le chapitre du parcours : tes élèves ne le voient plus. Un chapitre livré avec la plateforme peut toujours être remis ; un chapitre que tu as écrit est supprimé pour de bon — pour le ranger sans le perdre, utilise <strong>Archiver</strong>.</p>

      ${removedHtml()}
    </section>`;

    el.querySelectorAll('[data-level]').forEach((b) => (b.onclick = () => navigate(`/prof/chapitres?niveau=${b.dataset.level}`)));

    const toggle = el.querySelector('[data-toggle-archives]');
    if (toggle)
      toggle.onclick = () => {
        showArchives = !showArchives;
        draw();
      };

    const act = async (fn, message) => {
      try {
        await fn();
        if (message) toast(message, 'success');
        load();
      } catch (ex) {
        toast(ex.message, 'error');
      }
    };

    el.querySelectorAll('.parcours-row[data-id]').forEach((row) => {
      const id = row.dataset.id;
      const i = active.findIndex((c) => c.id === id);
      const c = active[i];
      const isMine = c.origin === 'perso';
      row.querySelector('[data-up]').onclick = () => move(i, -1);
      row.querySelector('[data-down]').onclick = () => move(i, 1);

      // La croix : une seule action, qui fait disparaître le chapitre pour
      // l'enseignant comme pour ses élèves. Un chapitre livré ne peut pas être
      // effacé du disque : il est retiré du parcours, et reste récupérable.
      row.querySelector('[data-remove]').onclick = () => {
        if (isMine) {
          if (!confirm(`Supprimer « ${c.title} » ?\n\nLe chapitre et la progression de tes élèves dessus seront perdus définitivement.\n\nPour le retirer du parcours sans le perdre, utilise « Archiver ».`)) return;
          act(() => api.del(`/teacher/chapters/${c.dbId}`), 'Chapitre supprimé définitivement.');
        } else {
          if (!confirm(`Retirer « ${c.title} » du parcours ?\n\nTes élèves ne le verront plus. Comme il est livré avec la plateforme, tu pourras le remettre depuis « Retirés du parcours ».`)) return;
          act(() => api.patch(`/teacher/chapters/${encodeURIComponent(id)}`, { hidden: true }), 'Chapitre retiré du parcours.');
        }
      };

      row.querySelector('[data-archive]')?.addEventListener('click', () =>
        act(() => api.patch(`/teacher/chapters/${c.dbId}`, { archived: true }), 'Chapitre archivé : tes élèves ne le voient plus.')
      );
      row.querySelector('[data-reset]')?.addEventListener('click', () => {
        if (!confirm(`Effacer tes modifications de « ${c.title} » et revenir à la version livrée ?`)) return;
        act(() => api.post(`/teacher/chapters/${encodeURIComponent(id)}/reset`), 'Chapitre revenu à sa version d’origine.');
      });
    });

    // Chapitres livrés retirés : on les remet.
    el.querySelectorAll('[data-back-id]').forEach((row) => {
      const id = row.dataset.backId;
      row.querySelector('[data-restore]').onclick = () =>
        act(() => api.patch(`/teacher/chapters/${encodeURIComponent(id)}`, { hidden: false }), 'Chapitre remis dans le parcours.');
    });

    // Chapitres personnels archivés : on les remet, ou on les efface pour de bon.
    el.querySelectorAll('[data-arch-id]').forEach((row) => {
      const dbId = Number(row.dataset.archId);
      const c = archived.find((x) => x.dbId === dbId);
      row.querySelector('[data-restore]').onclick = () =>
        act(() => api.patch(`/teacher/chapters/${dbId}`, { archived: false }), 'Chapitre remis dans le parcours.');
      row.querySelector('[data-del]').onclick = () => {
        if (!confirm(`Supprimer définitivement « ${c.title} » ?\n\nLe chapitre et la progression de tes élèves dessus seront perdus.`)) return;
        act(() => api.del(`/teacher/chapters/${dbId}`), 'Chapitre supprimé définitivement.');
      };
    });
  }

  async function move(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= active.length) return;
    const order = active.map((c) => c.id);
    [order[i], order[j]] = [order[j], order[i]];
    // On réaffiche tout de suite, puis on enregistre.
    active = order.map((id) => active.find((c) => c.id === id));
    draw();
    try {
      await api.patch(`/teacher/parcours/${level}`, { order });
    } catch (ex) {
      toast(ex.message, 'error');
      load();
    }
  }

  await load();
}
