// Espace enseignant : classes, comptes élèves (identifiants à distribuer), suivi de la progression.
import { api } from '../api.js';
import { navigate } from '../app.js';
import { esc, relativeTime, toast, downloadCsv, STEP_KIND } from '../ui.js';

const LEVELS = ['6e', '5e', '4e', '3e'];

export async function teacherHomeView({ el, query }) {
  const archived = query?.get('archives') === '1';
  const { classes, schoolYear, archivedCount } = await api.get(`/teacher/classes${archived ? '?archives=1' : ''}`);
  el.innerHTML = `
  <section class="page">
    <header class="page-head row">
      <div><h1>Mes classes</h1><p class="muted">Année scolaire ${esc(schoolYear)}</p></div>
      <div class="head-actions">
        <a class="btn ghost" href="/prof/chapitres" data-link>Mes chapitres</a>
        <a class="btn ghost" href="/prof/seances" data-link>Mes séances</a>
        <a class="btn ghost" href="/prof/exercices" data-link>Mes exercices</a>
        <a class="btn ghost" href="/prof/fiche" data-link>Fiche à imprimer</a>
        <a class="btn ghost" href="/prof/documents" data-link>Mes documents</a>
      </div>
    </header>
    ${
      archived || archivedCount
        ? `<div class="seg small" role="tablist">
            <button type="button" role="tab" class="seg-btn" aria-selected="${!archived}" data-arch="0">Mes classes</button>
            <button type="button" role="tab" class="seg-btn" aria-selected="${archived}" data-arch="1">Archives${archivedCount ? ` (${archivedCount})` : ''}</button>
          </div>`
        : ''
    }
    <div class="teacher-home">
      <ul class="class-list">
        ${
          classes.length
            ? classes
                .map(
                  (c) => `<li><a class="class-card lv-${c.level}" href="/prof/classe/${c.id}" data-link>
                    <span class="cc-level">${esc(c.level)}</span>
                    <span class="cc-body"><span class="cc-name">${esc(c.name)}</span><span class="muted">${c.student_count} élève${c.student_count > 1 ? 's' : ''}, ${esc(c.school_year)}</span></span>
                  </a></li>`
                )
                .join('')
            : `<li class="empty">${archived ? 'Aucune classe archivée.' : 'Crée ta première classe pour pouvoir y ajouter des élèves.'}</li>`
        }
      </ul>
      <form class="panel" id="new-class">
        <h2>Nouvelle classe</h2>
        <label class="field"><span>Nom</span><input name="name" placeholder="ex. 5e B" maxlength="40" required></label>
        <label class="field"><span>Niveau</span><select name="level">${LEVELS.map((l) => `<option>${l}</option>`).join('')}</select></label>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn" type="submit">Créer la classe</button>
      </form>
    </div>
  </section>`;

  el.querySelectorAll('[data-arch]').forEach(
    (b) => (b.onclick = () => navigate(`/prof${b.dataset.arch === '1' ? '?archives=1' : ''}`))
  );

  const form = el.querySelector('#new-class');
  form.name.addEventListener('input', () => {
    const m = form.name.value.match(/^\s*([3-6])/);
    if (m) form.level.value = `${m[1]}e`;
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = form.querySelector('.form-error');
    err.hidden = true;
    try {
      const { class: c } = await api.post('/teacher/classes', { name: form.name.value, level: form.level.value });
      toast(`Classe ${c.name} créée.`, 'success');
      navigate(`/prof/classe/${c.id}`);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  };
}

export async function teacherClassView({ el, params: [classId], query }) {
  // Le chapeau du tirage au sort survit aux changements d'onglet.
  let tirageChapeau = [];
  let tiragePasses = [];
  let tirageAnim = null;

  const ONGLETS = ['suivi', 'eleves', 'tirage'];
  let tab = ONGLETS.includes(query.get('onglet')) ? query.get('onglet') : 'suivi';
  let gridLevel = null;
  let lastCreated = null;

  async function draw() {
    const [{ students }, grid] = await Promise.all([
      api.get(`/teacher/classes/${classId}/students`),
      api.get(`/teacher/classes/${classId}/progress${gridLevel ? `?level=${gridLevel}` : ''}`),
    ]);
    const cls = grid.class;
    gridLevel = grid.level;

    el.innerHTML = `
    <section class="page wide lv-${cls.level}">
      <nav class="crumbs"><a href="/prof" data-link>Mes classes</a> <span aria-hidden="true">/</span> ${esc(cls.name)}</nav>
      <header class="page-head row">
        <div><h1>${esc(cls.name)}</h1><p class="muted">${esc(cls.level)}, ${students.length} élève${students.length > 1 ? 's' : ''}, ${esc(cls.school_year)}</p></div>
        <div class="head-actions">
          <button type="button" class="linkbtn" data-archive-class>${cls.archived ? 'Désarchiver' : 'Archiver la classe'}</button>
          <button type="button" class="linkbtn danger" data-del-class>Supprimer la classe</button>
        </div>
      </header>
      <div class="seg" role="tablist">
        <button type="button" role="tab" class="seg-btn" aria-selected="${tab === 'suivi'}" data-tab="suivi">Suivi de la progression</button>
        <button type="button" role="tab" class="seg-btn" aria-selected="${tab === 'eleves'}" data-tab="eleves">Élèves et identifiants</button>
        <button type="button" role="tab" class="seg-btn" aria-selected="${tab === 'tirage'}" data-tab="tirage">Tirage au sort</button>
      </div>
      <div class="tabpanel">${tab === 'suivi' ? gridHtml(grid) : tab === 'tirage' ? tirageHtml(students) : studentsHtml(students, cls)}</div>
    </section>`;

    el.querySelectorAll('[data-tab]').forEach(
      (b) =>
        (b.onclick = () => {
          tab = b.dataset.tab;
          history.replaceState(null, '', `/prof/classe/${classId}${tab === 'suivi' ? '' : `?onglet=${tab}`}`);
          draw();
        })
    );
    el.querySelector('[data-archive-class]').onclick = async () => {
      try {
        await api.patch(`/teacher/classes/${classId}`, { archived: !cls.archived });
        toast(cls.archived ? 'Classe remise en service.' : 'Classe archivée : elle quitte ta liste principale.', 'success');
        navigate('/prof');
      } catch (ex) {
        toast(ex.message, 'error');
      }
    };
    el.querySelector('[data-del-class]').onclick = async () => {
      if (!confirm(`Supprimer la classe ${cls.name} ? Les ${students.length} comptes élèves et leur progression seront supprimés définitivement.`)) return;
      await api.del(`/teacher/classes/${classId}`);
      toast('Classe supprimée.', 'success');
      navigate('/prof');
    };
    if (tab === 'suivi') bindGrid();
    else if (tab === 'tirage') bindTirage(students);
    else bindStudents(cls, students);
  }

  function gridHtml(g) {
    // L'en-tête de chaque chapitre mène à son diagnostic : c'est là que le prof
    // va quand une colonne est rouge.
    const head = g.chapters
      .map(
        (c, k) => `<th scope="col" title="Voir où ça coince dans « ${esc(c.title)} »">
          <a href="/prof/classe/${classId}/ou-ca-coince/${encodeURIComponent(c.id)}" data-link class="th-link">
            <span class="th-num">${k + 1}</span><span class="th-title">${esc(c.title)}</span>
          </a></th>`
      )
      .join('');
    const rows = g.students
      .map((s) => {
        const pos = s.lastPosition;
        return `<tr class="${s.active ? '' : 'inactive'}">
          <th scope="row">${esc(s.displayName)}<span class="muted small">${esc(s.username)}</span></th>
          ${s.chapters.map((c) => `<td class="cell s-${c.status}" title="${c.percent} %"><span>${c.status === 'done' ? '✓' : c.status === 'in_progress' ? `${c.percent} %` : ''}</span></td>`).join('')}
          <td class="pos">${pos ? `${esc(pos.chapterTitle)}<span class="muted small">${STEP_KIND[pos.stepType]} : ${esc(pos.stepTitle)}${pos.mode === 'libre' ? ' (libre)' : ''}</span>` : '<span class="muted">pas encore commencé</span>'}</td>
          <td class="when">${relativeTime(s.lastActivityAt || s.lastLoginAt)}<span class="muted small">${s.attemptsCount} série${s.attemptsCount > 1 ? 's' : ''}</span></td>
        </tr>`;
      })
      .join('');
    return `
      <div class="grid-tools">
        <label class="ctl inline"><span>Parcours affiché</span><select data-grid-level>${LEVELS.map((l) => `<option${l === g.level ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <span class="legend"><span class="cell s-done">✓</span> terminé <span class="cell s-in_progress">%</span> en cours <span class="cell s-not_started"></span> pas commencé</span>
      </div>
      ${
        g.students.length
          ? `<div class="table-wrap"><table class="grid">
              <thead><tr><th scope="col">Élève</th>${head}<th scope="col">Où il en est</th><th scope="col">Dernière activité</th></tr></thead>
              <tbody>${rows}</tbody></table></div>`
          : `<p class="empty">Aucun élève dans cette classe. Ajoute-les dans l'onglet « Élèves et identifiants ».</p>`
      }`;
  }

  function bindGrid() {
    const sel = el.querySelector('[data-grid-level]');
    if (sel)
      sel.onchange = () => {
        gridLevel = sel.value;
        draw();
      };
  }

  // ---------- Tirage au sort ----------
  // Pour interroger sans toujours tomber sur les mêmes. Les élèves déjà tirés
  // sont mis de côté jusqu'à ce que toute la classe soit passée : c'est ce qui
  // distingue un vrai tirage d'un simple hasard, qui oublie et répète.
  function tirageHtml(students) {
    const actifs = students.filter((s) => s.active);
    return `
      <div class="tirage">
        ${
          actifs.length
            ? `<div class="tirage-scene">
                <p class="tirage-nom" data-nom>—</p>
                <p class="muted" data-sous>Appuie sur « Tirer un élève ».</p>
              </div>
              <div class="tirage-actions">
                <button type="button" class="btn big" data-tirer>Tirer un élève</button>
                <label class="field inline"><span>Combien ?</span>
                  <input type="number" data-combien min="1" max="${actifs.length}" value="1"></label>
                <button type="button" class="linkbtn" data-reset>Remettre tout le monde dans le chapeau</button>
              </div>
              <div class="tirage-etat">
                <p class="muted small"><span data-restants>${actifs.length}</span> élève(s) pas encore tiré(s) sur ${actifs.length}.</p>
                <ul class="tirage-passes" data-passes></ul>
              </div>`
            : '<p class="empty">Aucun élève actif dans cette classe.</p>'
        }
      </div>`;
  }

  function bindTirage(students) {
    const actifs = students.filter((s) => s.active);
    if (!actifs.length) return;
    const nomEl = el.querySelector('[data-nom]');
    const sousEl = el.querySelector('[data-sous]');
    const restantsEl = el.querySelector('[data-restants]');
    const passesEl = el.querySelector('[data-passes]');
    const combienEl = el.querySelector('[data-combien]');

    // Le chapeau survit au changement d'onglet, pas au rechargement de la page.
    let chapeau = tirageChapeau.length ? tirageChapeau : actifs.map((s) => s.id);
    let tires = tiragePasses;

    function peindre() {
      restantsEl.textContent = chapeau.length;
      passesEl.innerHTML = tires
        .map((id) => {
          const s = actifs.find((x) => x.id === id);
          return s ? `<li>${esc(s.displayName)}</li>` : '';
        })
        .join('');
      tirageChapeau = chapeau;
      tiragePasses = tires;
    }

    function tirer() {
      const combien = Math.max(1, Math.min(actifs.length, Number(combienEl.value) || 1));
      const sortis = [];
      for (let k = 0; k < combien; k++) {
        if (!chapeau.length) {
          // Tout le monde est passé : on remplit à nouveau le chapeau, en
          // évitant de retirer tout de suite ceux qu'on vient de sortir.
          chapeau = actifs.map((s) => s.id).filter((id) => !sortis.includes(id));
          tires = [];
          if (!chapeau.length) break;
        }
        const i = Math.floor(Math.random() * chapeau.length);
        sortis.push(chapeau.splice(i, 1)[0]);
      }
      tires = [...sortis, ...tires].slice(0, actifs.length);

      // Petit roulement avant d'afficher : le suspense fait partie du jeu.
      let tours = 0;
      clearInterval(tirageAnim);
      tirageAnim = setInterval(() => {
        nomEl.textContent = actifs[Math.floor(Math.random() * actifs.length)].displayName;
        if (++tours >= 12) {
          clearInterval(tirageAnim);
          const noms = sortis.map((id) => actifs.find((s) => s.id === id)?.displayName).filter(Boolean);
          nomEl.textContent = noms.join(' · ');
          nomEl.classList.remove('pop');
          void nomEl.offsetWidth;
          nomEl.classList.add('pop');
          sousEl.textContent = chapeau.length ? `Encore ${chapeau.length} élève(s) dans le chapeau.` : 'Toute la classe est passée.';
          peindre();
        }
      }, 55);
    }

    el.querySelector('[data-tirer]').onclick = tirer;
    el.querySelector('[data-reset]').onclick = () => {
      chapeau = actifs.map((s) => s.id);
      tires = [];
      nomEl.textContent = '—';
      sousEl.textContent = 'Tout le monde est de nouveau dans le chapeau.';
      peindre();
    };
    peindre();
  }

  function studentsHtml(students, cls) {
    return `
      <div class="students-layout">
        <div>
          ${lastCreated ? createdHtml(lastCreated) : ''}
          ${
            students.length
              ? `<div class="table-wrap"><table class="list">
              <thead><tr><th>Pseudonyme</th><th>Identifiant</th><th>Dernière connexion</th><th><span class="sr">Actions</span></th></tr></thead>
              <tbody>${students
                .map(
                  (s) => `<tr data-id="${s.id}" class="${s.active ? '' : 'inactive'}">
                <td>${esc(s.displayName)}${s.active ? '' : ' <span class="tag">désactivé</span>'}</td>
                <td><code>${esc(s.username)}</code></td>
                <td>${relativeTime(s.lastLoginAt)}</td>
                <td class="actions">
                  <button type="button" class="linkbtn" data-act="pw">Nouveau mot de passe</button>
                  <button type="button" class="linkbtn" data-act="toggle">${s.active ? 'Désactiver' : 'Réactiver'}</button>
                  <button type="button" class="linkbtn" data-act="reset">Remettre à zéro</button>
                  <button type="button" class="linkbtn danger" data-act="del">Supprimer</button>
                </td></tr>`
                )
                .join('')}</tbody></table></div>`
              : '<p class="empty">Aucun élève pour le moment. Ajoute ta liste ci-dessous.</p>'
          }
        </div>
        <form class="panel wide" id="add-students" novalidate>
          <h2>Ajouter des élèves</h2>
          <p class="rgpd-note"><strong>La plateforme ne stocke aucun nom d'élève.</strong> Chaque compte porte un
            pseudonyme tiré au sort. Dis simplement combien de comptes il te faut : tu récupères ensuite la liste
            « pseudonyme + identifiant + mot de passe » à distribuer en classe, et tu notes qui est qui dans ton
            propre tableur. Le fichier CSV proposé après la création contient déjà une colonne vide pour ça.</p>
          <div class="sheet-count">
            <label class="field inline"><span>Nombre de comptes</span><input type="number" data-count min="1" max="200" step="1" value="25" inputmode="numeric"></label>
            <button type="button" class="btn ghost" data-fill>Préparer les comptes</button>
          </div>
          <div class="sheet-wrap">
            <table class="sheet">
              <thead><tr>
                <th class="num" scope="col"><span class="sr">#</span></th>
                <th scope="col">Pseudonyme</th>
                <th scope="col">Identifiant</th>
                <th scope="col">Mot de passe</th>
                <th scope="col"><span class="sr">Supprimer</span></th>
              </tr></thead>
              <tbody data-sheet-body></tbody>
            </table>
          </div>
          <div class="sheet-tools">
            <button type="button" class="linkbtn" data-add-row>+ Ajouter une ligne</button>
            <button type="button" class="linkbtn" data-gen-all>🎲 Compléter les cases vides</button>
            <button type="button" class="linkbtn" data-clear-sheet>Vider le tableau</button>
            <span class="muted small" data-row-count></span>
          </div>
          <ul class="sheet-errors" data-errors aria-live="polite" hidden></ul>
          <p class="form-error" role="alert" hidden></p>
          <button class="btn" type="submit" data-submit disabled>Créer les comptes</button>
        </form>
      </div>`;
  }

  // Tableau éditable type tableur pour préparer les nouveaux comptes : pseudonyme,
  // identifiant et mot de passe, tous tirés au sort par défaut et modifiables à la
  // main, avec validation en direct. Les mêmes règles qu'au serveur, pour que rien
  // ne soit refusé après coup.
  const SHEET_COLS = ['pseudonym', 'username', 'password'];
  // Même expression que server/services/pseudonyms.js : pas de chiffre, pour
  // qu'un pseudonyme ne puisse pas devenir un matricule déguisé.
  const PSEUDO_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ](?:[A-Za-zÀ-ÖØ-öø-ÿ'’\- ]{1,38}[A-Za-zÀ-ÖØ-öø-ÿ])$/;
  const USERNAME_RE = /^[a-z0-9._-]+$/;
  const MAX_SHEET_ROWS = 200;
  const MIN_PASSWORD = 6;
  const MAX_PASSWORD = 72;

  function slugPreview(name) {
    return (
      String(name || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/^\.+|\.+$/g, '')
        .slice(0, 30) || 'eleve'
    );
  }

  function bindStudentSheet(form, existingStudents) {
    const body = form.querySelector('[data-sheet-body]');
    const errBox = form.querySelector('[data-errors]');
    const rowCountEl = form.querySelector('[data-row-count]');
    const submitBtn = form.querySelector('[data-submit]');
    const err = form.querySelector('.form-error');
    const existingUsernames = new Set(existingStudents.map((s) => s.username));
    const existingPseudonyms = new Set(existingStudents.map((s) => (s.pseudonym || s.displayName || '').toLowerCase()));
    const countEl = form.querySelector('[data-count]');

    function rowsData() {
      return [...body.children].map((tr) => ({
        tr,
        pseudonym: tr.querySelector('[data-col="pseudonym"]').value.trim().replace(/\s+/g, ' '),
        username: tr.querySelector('[data-col="username"]').value.trim().toLowerCase(),
        password: tr.querySelector('[data-col="password"]').value.trim(),
      }));
    }

    // Aperçu de l'identifiant qui sera créé automatiquement pour cette ligne.
    function previewUsername(tr) {
      const pseudo = tr.querySelector('[data-col="pseudonym"]').value.trim();
      tr.querySelector('[data-col="username"]').placeholder = pseudo ? slugPreview(pseudo) : 'auto';
    }

    function setCellError(tr, col, message) {
      const td = tr.querySelector(`[data-col="${col}"]`).closest('td');
      td.classList.toggle('cell-err', !!message);
      td.title = message || '';
    }

    function renumber() {
      [...body.children].forEach((tr, i) => (tr.querySelector('.num').textContent = i + 1));
    }

    function validate() {
      const rows = rowsData();
      const active = rows.filter((r) => r.pseudonym || r.username || r.password);
      const errors = [];
      const usernameCounts = new Map();
      const pseudoCounts = new Map();
      active.forEach((r) => {
        if (r.username) usernameCounts.set(r.username, (usernameCounts.get(r.username) || 0) + 1);
        if (r.pseudonym) pseudoCounts.set(r.pseudonym, (pseudoCounts.get(r.pseudonym) || 0) + 1);
      });

      rows.forEach((r) => {
        const n = [...body.children].indexOf(r.tr) + 1;

        let pseudoErr = '';
        if (r.pseudonym) {
          if (!PSEUDO_RE.test(r.pseudonym)) pseudoErr = `Ligne ${n} : « ${r.pseudonym} » n'est pas un pseudonyme valable (lettres, espaces et traits d'union, pas de chiffre).`;
          else if (existingPseudonyms.has(r.pseudonym.toLowerCase())) pseudoErr = `Ligne ${n} : le pseudonyme « ${r.pseudonym} » existe déjà dans la classe.`;
          else if (pseudoCounts.get(r.pseudonym) > 1) pseudoErr = `Ligne ${n} : le pseudonyme « ${r.pseudonym} » apparaît plusieurs fois dans ce tableau.`;
        }
        setCellError(r.tr, 'pseudonym', pseudoErr);
        if (pseudoErr) errors.push(pseudoErr);

        let userErr = '';
        if (r.username) {
          if (r.username.length < 3) userErr = `Ligne ${n} : identifiant trop court (3 caractères minimum).`;
          else if (!USERNAME_RE.test(r.username)) userErr = `Ligne ${n} : identifiant « ${r.username} » invalide (minuscules, chiffres, . _ - uniquement).`;
          else if (existingUsernames.has(r.username)) userErr = `Ligne ${n} : identifiant « ${r.username} » déjà pris dans la classe.`;
          else if (usernameCounts.get(r.username) > 1) userErr = `Ligne ${n} : identifiant « ${r.username} » utilisé plusieurs fois dans ce tableau.`;
        }
        setCellError(r.tr, 'username', userErr);
        if (userErr) errors.push(userErr);

        let pwErr = '';
        if (r.password) {
          if (r.password.length < MIN_PASSWORD) pwErr = `Ligne ${n} : mot de passe trop court (${MIN_PASSWORD} caractères minimum).`;
          else if (r.password.length > MAX_PASSWORD) pwErr = `Ligne ${n} : mot de passe trop long (${MAX_PASSWORD} caractères maximum).`;
        }
        setCellError(r.tr, 'password', pwErr);
        if (pwErr) errors.push(pwErr);
      });

      if (active.length > MAX_SHEET_ROWS) errors.push(`${active.length} lignes remplies : ${MAX_SHEET_ROWS} maximum par envoi, supprime-en ${active.length - MAX_SHEET_ROWS}.`);

      errBox.innerHTML = errors.map((m) => `<li>${esc(m)}</li>`).join('');
      errBox.hidden = errors.length === 0;
      rowCountEl.textContent = active.length ? `${active.length} élève${active.length > 1 ? 's' : ''} prêt${active.length > 1 ? 's' : ''}` : '';
      submitBtn.disabled = active.length === 0 || errors.length > 0;
      return { active, errors };
    }

    function maybeGrow() {
      const last = body.lastElementChild;
      if (!last || body.children.length >= MAX_SHEET_ROWS) return;
      const filled = [...last.querySelectorAll('input')].some((i) => i.value.trim());
      if (filled) addRow();
    }

    async function generateInto(input) {
      try {
        const { password } = await api.get('/teacher/password-suggestion');
        input.value = password;
        validate();
      } catch (ex) {
        toast(ex.message, 'error');
      }
    }

    // Les pseudonymes sont tirés par le serveur, qui sait lesquels sont déjà
    // pris. Les doublons à l'intérieur du tableau sont écartés ici.
    async function tirerPseudos(combien) {
      const pris = new Set([...existingPseudonyms, ...rowsData().map((r) => r.pseudonym.toLowerCase()).filter(Boolean)]);
      const out = [];
      for (let essais = 0; out.length < combien && essais < combien * 6; essais++) {
        const { pseudonym } = await api.get('/teacher/pseudonym-suggestion');
        if (pris.has(pseudonym.toLowerCase())) continue;
        pris.add(pseudonym.toLowerCase());
        out.push(pseudonym);
      }
      return out;
    }

    async function remplirPseudo(tr) {
      try {
        const [p] = await tirerPseudos(1);
        if (p) tr.querySelector('[data-col="pseudonym"]').value = p;
        previewUsername(tr);
        validate();
      } catch (ex) {
        toast(ex.message, 'error');
      }
    }

    function handlePaste(e, tr, input) {
      const text = e.clipboardData?.getData('text');
      if (!text || !/\n|\t/.test(text)) return; // collage simple : laisser faire le navigateur
      e.preventDefault();
      const lines = text.replace(/\r/g, '').split('\n').filter((l) => l !== '');
      let startCol = SHEET_COLS.indexOf(input.dataset.col);
      if (startCol < 0) startCol = 0;
      let rows = [...body.children];
      const startRowIdx = rows.indexOf(tr);
      lines.forEach((line, li) => {
        const cells = line.includes('\t') ? line.split('\t') : line.split(';');
        let targetRow = rows[startRowIdx + li];
        if (!targetRow) {
          targetRow = addRow();
          rows = [...body.children];
        }
        cells.forEach((val, ci) => {
          const col = SHEET_COLS[startCol + ci];
          if (!col) return;
          const field = targetRow.querySelector(`[data-col="${col}"]`);
          if (field) field.value = val.trim();
        });
      });
      [...body.children].forEach(previewUsername);
      maybeGrow();
      validate();
    }

    function wireRow(tr) {
      const inputs = SHEET_COLS.map((c) => tr.querySelector(`[data-col="${c}"]`));
      inputs.forEach((input) => {
        input.addEventListener('input', () => {
          maybeGrow();
          validate();
        });
        input.addEventListener('paste', (e) => handlePaste(e, tr, input));
        input.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const colIdx = SHEET_COLS.indexOf(input.dataset.col);
          if (colIdx < SHEET_COLS.length - 1) {
            inputs[colIdx + 1].focus();
          } else {
            const rows = [...body.children];
            const next = rows[rows.indexOf(tr) + 1] || addRow();
            next.querySelector('[data-col="pseudonym"]').focus();
          }
        });
      });
      const [pseudoEl, userEl, pwEl] = inputs;
      userEl.addEventListener('blur', () => {
        if (userEl.value) userEl.value = userEl.value.trim().toLowerCase();
      });
      pseudoEl.addEventListener('input', () => previewUsername(tr));
      tr.querySelector('[data-gen-pseudo]').onclick = () => remplirPseudo(tr);
      tr.querySelector('[data-gen]').onclick = () => generateInto(pwEl);
      tr.querySelector('[data-del]').onclick = () => {
        tr.remove();
        if (!body.children.length) addRow();
        renumber();
        validate();
      };
    }

    function addRow(focus = false) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="num">1</td>
        <td class="pwcell"><input data-col="pseudonym" maxlength="40" placeholder="auto" autocomplete="off"><button type="button" class="dice" tabindex="-1" data-gen-pseudo title="Pseudonyme aléatoire">🎲</button></td>
        <td><input data-col="username" maxlength="40" placeholder="auto" autocomplete="off"></td>
        <td class="pwcell"><input data-col="password" maxlength="72" placeholder="auto" autocomplete="off"><button type="button" class="dice" tabindex="-1" data-gen title="Mot de passe aléatoire">🎲</button></td>
        <td><button type="button" class="rowdel" tabindex="-1" data-del title="Supprimer la ligne">✕</button></td>`;
      body.append(tr);
      wireRow(tr);
      renumber();
      if (focus) tr.querySelector('[data-col="pseudonym"]').focus();
      return tr;
    }

    body.innerHTML = '';
    for (let i = 0; i < 6; i++) addRow();
    validate();

    form.querySelector('[data-add-row]').onclick = () => addRow(true);
    form.querySelector('[data-clear-sheet]').onclick = () => {
      const { active } = validate();
      if (active.length && !confirm('Vider le tableau ? Les lignes non enregistrées seront perdues.')) return;
      body.innerHTML = '';
      for (let i = 0; i < 6; i++) addRow();
      validate();
    };
    // Complète ce qui manque sur les lignes déjà commencées, sans rien écraser.
    form.querySelector('[data-gen-all]').onclick = async () => {
      const lignes = rowsData().filter((r) => r.pseudonym || r.username || r.password);
      if (!lignes.length) {
        toast('Le tableau est vide : indique plutôt un nombre de comptes ci-dessus.');
        return;
      }
      try {
        const sansPseudo = lignes.filter((r) => !r.pseudonym);
        const pseudos = await tirerPseudos(sansPseudo.length);
        sansPseudo.forEach((r, i) => {
          if (pseudos[i]) r.tr.querySelector('[data-col="pseudonym"]').value = pseudos[i];
          previewUsername(r.tr);
        });
        const sansMdp = lignes.filter((r) => !r.password);
        const passwords = await Promise.all(sansMdp.map(() => api.get('/teacher/password-suggestion')));
        sansMdp.forEach((r, i) => (r.tr.querySelector('[data-col="password"]').value = passwords[i].password));
        validate();
      } catch (ex) {
        toast(ex.message, 'error');
      }
    };

    // Le chemin normal : « il me faut 28 comptes ». Tout est tiré au sort, la
    // seule chose qui reste à faire est de distribuer la liste.
    form.querySelector('[data-fill]').onclick = async () => {
      const combien = Math.max(1, Math.min(MAX_SHEET_ROWS, Math.round(Number(countEl.value) || 0)));
      countEl.value = combien;
      const btn = form.querySelector('[data-fill]');
      btn.disabled = true;
      btn.textContent = 'Préparation…';
      try {
        const [pseudos, mdps] = await Promise.all([
          tirerPseudos(combien),
          Promise.all(Array.from({ length: combien }, () => api.get('/teacher/password-suggestion'))),
        ]);
        body.innerHTML = '';
        pseudos.forEach((pseudo, i) => {
          const tr = addRow();
          tr.querySelector('[data-col="pseudonym"]').value = pseudo;
          tr.querySelector('[data-col="password"]').value = mdps[i].password;
          previewUsername(tr);
        });
        if (!body.children.length) addRow();
        validate();
      } catch (ex) {
        toast(ex.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Préparer les comptes';
      }
    };

    form.onsubmit = async (e) => {
      e.preventDefault();
      err.hidden = true;
      const { active, errors } = validate();
      if (errors.length) {
        err.textContent = 'Corrige les lignes signalées en rouge avant de continuer.';
        err.hidden = false;
        return;
      }
      if (!active.length) {
        err.textContent = 'Ajoute au moins un élève.';
        err.hidden = false;
        return;
      }
      const payload = active.map((r) => ({
        pseudonym: r.pseudonym || undefined,
        username: r.username || undefined,
        password: r.password || undefined,
      }));
      try {
        const { created } = await api.post(`/teacher/classes/${classId}/students`, { students: payload });
        lastCreated = created;
        toast(`${created.length} compte${created.length > 1 ? 's' : ''} créé${created.length > 1 ? 's' : ''}.`, 'success');
        draw();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      }
    };
  }

  function createdHtml(list) {
    return `<div class="created">
      <h2>${list.length} identifiant${list.length > 1 ? 's' : ''} à distribuer</h2>
      <p class="muted small">Les mots de passe ne seront plus affichés ensuite : télécharge ou imprime la liste maintenant.
        Le CSV contient une colonne <em>Élève</em> vide — c'est là que tu notes qui est qui, dans ton tableur, hors de la plateforme.</p>
      <table class="list creds"><thead><tr><th>Pseudonyme</th><th>Identifiant</th><th>Mot de passe</th></tr></thead>
      <tbody>${list.map((c) => `<tr><td>${esc(c.displayName)}</td><td><code>${esc(c.username)}</code></td><td><code>${esc(c.password)}</code></td></tr>`).join('')}</tbody></table>
      <div class="w-actions"><button type="button" class="btn" data-csv>Télécharger (CSV)</button><button type="button" class="btn ghost" data-print>Imprimer les fiches</button><button type="button" class="linkbtn" data-hide>Masquer</button></div>
    </div>`;
  }

  function bindStudents(cls, students) {
    const form = el.querySelector('#add-students');
    bindStudentSheet(form, students);

    const created = el.querySelector('.created');
    if (created) {
      created.querySelector('[data-csv]').onclick = () =>
        downloadCsv(`identifiants-${cls.name.replace(/\W+/g, '-')}.csv`, [
          ['Pseudonyme', 'Élève (à compléter hors plateforme)', 'Classe', 'Identifiant', 'Mot de passe'],
          ...lastCreated.map((c) => [c.pseudonym ?? c.displayName, '', cls.name, c.username, c.password]),
        ]);
      created.querySelector('[data-print]').onclick = () => printSlips(lastCreated, cls);
      created.querySelector('[data-hide]').onclick = () => {
        lastCreated = null;
        draw();
      };
    }

    el.querySelectorAll('tr[data-id]').forEach((tr) => {
      const s = students.find((x) => x.id === Number(tr.dataset.id));
      tr.querySelectorAll('[data-act]').forEach(
        (b) =>
          (b.onclick = async () => {
            const act = b.dataset.act;
            try {
              if (act === 'pw') {
                if (!confirm(`Créer un nouveau mot de passe pour ${s.displayName} ? L'ancien ne fonctionnera plus.`)) return;
                const r = await api.patch(`/teacher/students/${s.id}`, { resetPassword: true });
                lastCreated = [{ displayName: s.displayName, username: s.username, password: r.password }];
              } else if (act === 'toggle') {
                await api.patch(`/teacher/students/${s.id}`, { active: !s.active });
                toast(s.active ? `${s.displayName} ne peut plus se connecter.` : `${s.displayName} peut de nouveau se connecter.`);
              } else if (act === 'reset') {
                if (!confirm(`Effacer toute la progression de ${s.displayName} ?`)) return;
                await api.post(`/teacher/students/${s.id}/reset-progress`);
                toast('Progression remise à zéro.');
              } else if (act === 'del') {
                if (!confirm(`Supprimer définitivement le compte de ${s.displayName} et sa progression ?`)) return;
                await api.del(`/teacher/students/${s.id}`);
                toast('Compte supprimé.');
              }
              draw();
            } catch (ex) {
              toast(ex.message, 'error');
            }
          })
      );
    });
  }

  function printSlips(list, cls) {
    let sheet = document.querySelector('.print-sheet');
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.className = 'print-sheet';
      document.body.append(sheet);
    }
    const site = location.origin;
    sheet.innerHTML = list
      .map(
        (c) => `<div class="slip"><p class="slip-name">${esc(c.displayName)} <span>(${esc(cls.name)})</span></p>
        <p>Site : <strong>${esc(site)}</strong></p><p>Identifiant : <strong>${esc(c.username)}</strong></p><p>Mot de passe : <strong>${esc(c.password)}</strong></p></div>`
      )
      .join('');
    window.print();
  }

  await draw();
}
