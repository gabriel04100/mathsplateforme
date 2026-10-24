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
        <a class="btn ghost" href="/prof/exercices" data-link>Mes exercices</a>
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
  let tab = query.get('onglet') === 'eleves' ? 'eleves' : 'suivi';
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
      </div>
      <div class="tabpanel">${tab === 'suivi' ? gridHtml(grid) : studentsHtml(students, cls)}</div>
    </section>`;

    el.querySelectorAll('[data-tab]').forEach(
      (b) =>
        (b.onclick = () => {
          tab = b.dataset.tab;
          history.replaceState(null, '', `/prof/classe/${classId}${tab === 'eleves' ? '?onglet=eleves' : ''}`);
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
    else bindStudents(cls, students);
  }

  function gridHtml(g) {
    const head = g.chapters.map((c, k) => `<th scope="col" title="${esc(c.title)}"><span class="th-num">${k + 1}</span><span class="th-title">${esc(c.title)}</span></th>`).join('');
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

  function studentsHtml(students, cls) {
    return `
      <div class="students-layout">
        <div>
          ${lastCreated ? createdHtml(lastCreated) : ''}
          ${
            students.length
              ? `<div class="table-wrap"><table class="list">
              <thead><tr><th>Élève</th><th>Identifiant</th><th>Dernière connexion</th><th><span class="sr">Actions</span></th></tr></thead>
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
          <p class="muted small">Tape les noms directement dans le tableau, ou colle une sélection depuis Excel / Google Sheets (plusieurs lignes et colonnes à la fois). Si tu colles une seule colonne de « Prénom Nom », elle est séparée automatiquement. Identifiant et mot de passe sont facultatifs : laisse-les vides pour une génération automatique, ou clique sur 🎲.</p>
          <div class="sheet-wrap">
            <table class="sheet">
              <thead><tr>
                <th class="num" scope="col"><span class="sr">#</span></th>
                <th scope="col">Prénom</th>
                <th scope="col">Nom</th>
                <th scope="col">Identifiant</th>
                <th scope="col">Mot de passe</th>
                <th scope="col"><span class="sr">Supprimer</span></th>
              </tr></thead>
              <tbody data-sheet-body></tbody>
            </table>
          </div>
          <div class="sheet-tools">
            <button type="button" class="linkbtn" data-add-row>+ Ajouter une ligne</button>
            <button type="button" class="linkbtn" data-gen-all>🎲 Générer tous les mots de passe</button>
            <button type="button" class="linkbtn" data-clear-sheet>Vider le tableau</button>
            <span class="muted small" data-row-count></span>
          </div>
          <ul class="sheet-errors" data-errors aria-live="polite" hidden></ul>
          <p class="form-error" role="alert" hidden></p>
          <button class="btn" type="submit" data-submit disabled>Créer les comptes</button>
        </form>
      </div>`;
  }

  // Tableau éditable type tableur pour saisir les nouveaux élèves : lignes qui se créent
  // au fil de la frappe, collage multi-colonnes depuis Excel/Sheets, validation en direct
  // (nom, identifiant, mot de passe) et génération de mots de passe aléatoires.
  const SHEET_COLS = ['firstName', 'lastName', 'username', 'password'];
  const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ](?:[A-Za-zÀ-ÖØ-öø-ÿ'’.\- ]{0,58}[A-Za-zÀ-ÖØ-öø-ÿ])?$/;
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

    function rowsData() {
      return [...body.children].map((tr) => {
        const firstName = tr.querySelector('[data-col="firstName"]').value.trim().replace(/\s+/g, ' ');
        const lastName = tr.querySelector('[data-col="lastName"]').value.trim().replace(/\s+/g, ' ');
        return {
          tr,
          firstName,
          lastName,
          displayName: [firstName, lastName].filter(Boolean).join(' '),
          username: tr.querySelector('[data-col="username"]').value.trim().toLowerCase(),
          password: tr.querySelector('[data-col="password"]').value.trim(),
        };
      });
    }

    // Aperçu de l'identifiant qui sera créé automatiquement pour cette ligne.
    function previewUsername(tr) {
      const full = [tr.querySelector('[data-col="firstName"]').value.trim(), tr.querySelector('[data-col="lastName"]').value.trim()]
        .filter(Boolean)
        .join(' ');
      tr.querySelector('[data-col="username"]').placeholder = full ? slugPreview(full) : 'auto';
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
      const active = rows.filter((r) => r.displayName || r.username || r.password);
      const errors = [];
      const usernameCounts = new Map();
      active.forEach((r) => {
        if (r.username) usernameCounts.set(r.username, (usernameCounts.get(r.username) || 0) + 1);
      });

      rows.forEach((r) => {
        const n = [...body.children].indexOf(r.tr) + 1;
        const isActive = !!(r.firstName || r.lastName || r.username || r.password);

        let firstErr = '';
        if (r.firstName && !NAME_RE.test(r.firstName)) firstErr = `Ligne ${n} : prénom « ${r.firstName} » invalide (lettres, espaces, apostrophes et traits d'union uniquement).`;
        else if (!r.firstName && isActive) firstErr = `Ligne ${n} : il manque le prénom de l'élève.`;
        setCellError(r.tr, 'firstName', firstErr);
        if (firstErr) errors.push(firstErr);

        let lastErr = '';
        if (r.lastName && !NAME_RE.test(r.lastName)) lastErr = `Ligne ${n} : nom « ${r.lastName} » invalide (lettres, espaces, apostrophes et traits d'union uniquement).`;
        setCellError(r.tr, 'lastName', lastErr);
        if (lastErr) errors.push(lastErr);

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
        let cells = line.includes('\t') ? line.split('\t') : line.split(';');
        // Une seule colonne collée dans « Prénom » : on coupe au premier espace,
        // pour qu'une liste de « Prénom Nom » se range dans les deux colonnes.
        if (cells.length === 1 && startCol === 0) {
          const cut = cells[0].trim().indexOf(' ');
          if (cut > 0) cells = [cells[0].trim().slice(0, cut), cells[0].trim().slice(cut + 1)];
        }
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
            next.querySelector('[data-col="firstName"]').focus();
          }
        });
      });
      const [firstEl, lastEl, userEl, pwEl] = inputs;
      userEl.addEventListener('blur', () => {
        if (userEl.value) userEl.value = userEl.value.trim().toLowerCase();
      });
      firstEl.addEventListener('input', () => previewUsername(tr));
      lastEl.addEventListener('input', () => previewUsername(tr));
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
        <td><input data-col="firstName" maxlength="60" placeholder="Léa" autocomplete="off"></td>
        <td><input data-col="lastName" maxlength="60" placeholder="Martin" autocomplete="off"></td>
        <td><input data-col="username" maxlength="40" placeholder="auto" autocomplete="off"></td>
        <td class="pwcell"><input data-col="password" maxlength="72" placeholder="auto" autocomplete="off"><button type="button" class="dice" tabindex="-1" data-gen title="Mot de passe aléatoire">🎲</button></td>
        <td><button type="button" class="rowdel" tabindex="-1" data-del title="Supprimer la ligne">✕</button></td>`;
      body.append(tr);
      wireRow(tr);
      renumber();
      if (focus) tr.querySelector('[data-col="firstName"]').focus();
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
    form.querySelector('[data-gen-all]').onclick = async () => {
      const targets = rowsData().filter((r) => r.displayName && !r.password);
      if (!targets.length) {
        toast('Aucune ligne avec un nom et sans mot de passe.');
        return;
      }
      try {
        const passwords = await Promise.all(targets.map(() => api.get('/teacher/password-suggestion')));
        targets.forEach((r, i) => (r.tr.querySelector('[data-col="password"]').value = passwords[i].password));
        validate();
      } catch (ex) {
        toast(ex.message, 'error');
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
        firstName: r.firstName,
        lastName: r.lastName,
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
      <p class="muted small">Les mots de passe ne seront plus affichés ensuite : télécharge ou imprime la liste maintenant.</p>
      <table class="list creds"><thead><tr><th>Élève</th><th>Identifiant</th><th>Mot de passe</th></tr></thead>
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
          ['Prénom', 'Nom', 'Classe', 'Identifiant', 'Mot de passe'],
          ...lastCreated.map((c) => [c.firstName ?? c.displayName, c.lastName ?? '', cls.name, c.username, c.password]),
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
