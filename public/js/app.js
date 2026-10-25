// Coquille de l'application : session, navigation, routage.
// Plateforme Maths Collège — Gabriel Pizzo
import { api, setUnauthorizedHandler } from './api.js';
import { esc } from './ui.js';
import { loginView } from './views/login.js';
import { dashboardView } from './views/dashboard.js';
import { levelView } from './views/level.js';
import { chapterView } from './views/chapter.js';
import { freeExercisesView } from './views/free.js';
import { teacherHomeView, teacherClassView } from './views/teacher.js';
import { teacherExercisesView, teacherExerciseEditorView } from './views/exercise-editor.js';
import { teacherChapterEditorView } from './views/chapter-editor.js';
import { teacherParcoursView } from './views/parcours.js';
import { teacherDiagnosticView } from './views/diagnostic.js';
import { teacherFicheView } from './views/fiche.js';
import { teacherDocumentsView } from './views/documents.js';
import { customExerciseView } from './views/custom-exercise.js';
import { gamesHomeView, gameView } from './views/games.js';

export const state = { user: null, catalog: null };

const routes = [
  { path: /^\/connexion$/, view: loginView, public: true },
  { path: /^\/$/, view: () => navigate(state.user.role === 'teacher' ? '/prof' : '/tableau-de-bord', true) },
  { path: /^\/tableau-de-bord$/, view: dashboardView, nav: 'dashboard' },
  { path: /^\/niveau\/(6e|5e|4e|3e)$/, view: levelView, nav: (m) => `level-${m[1]}` },
  { path: /^\/chapitre\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?$/, view: chapterView, nav: 'chapter' },
  { path: /^\/libre\/([a-z0-9-]+)\/([a-z0-9-]+)$/, view: (ctx) => chapterView({ ...ctx, mode: 'libre' }), nav: 'free' },
  { path: /^\/exercices$/, view: freeExercisesView, nav: 'free' },
  { path: /^\/exercice\/(\d+)$/, view: customExerciseView, nav: 'free' },
  { path: /^\/jeux$/, view: gamesHomeView, nav: 'games' },
  { path: /^\/jeux\/([a-z0-9-]+)$/, view: gameView, nav: 'games' },
  { path: /^\/prof$/, view: teacherHomeView, nav: 'teacher', role: 'teacher' },
  { path: /^\/prof\/classe\/(\d+)$/, view: teacherClassView, nav: 'teacher', role: 'teacher' },
  { path: /^\/prof\/classe\/(\d+)\/ou-ca-coince\/([a-z0-9-]+)$/, view: teacherDiagnosticView, nav: 'teacher', role: 'teacher' },
  { path: /^\/prof\/exercices$/, view: teacherExercisesView, nav: 'teacher', role: 'teacher' },
  { path: /^\/prof\/exercices\/nouveau$/, view: teacherExerciseEditorView, nav: 'teacher', role: 'teacher' },
  { path: /^\/prof\/exercices\/(\d+)$/, view: teacherExerciseEditorView, nav: 'teacher', role: 'teacher' },
  // « Mes chapitres » est la page unique du contenu : elle montre le parcours
  // complet d'un niveau. /prof/parcours reste une porte d'entrée équivalente.
  { path: /^\/prof\/chapitres$/, view: teacherParcoursView, nav: 'teacher', role: 'teacher' },
  { path: /^\/prof\/parcours$/, view: teacherParcoursView, nav: 'teacher', role: 'teacher' },
  { path: /^\/prof\/fiche$/, view: teacherFicheView, nav: 'teacher', role: 'teacher' },
  { path: /^\/prof\/documents$/, view: teacherDocumentsView, nav: 'teacher', role: 'teacher' },
  { path: /^\/prof\/chapitres\/nouveau$/, view: teacherChapterEditorView, nav: 'teacher', role: 'teacher' },
  // L'identifiant est soit le numéro d'un chapitre écrit ici, soit le nom d'un
  // chapitre livré dans content/ (ex. « 6e-fractions »).
  { path: /^\/prof\/chapitres\/([a-z0-9-]+)$/, view: teacherChapterEditorView, nav: 'teacher', role: 'teacher' },
];

const viewEl = () => document.getElementById('view');
let cleanup = null;

export function navigate(url, replace = false) {
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  return render();
}

export async function getCatalog() {
  if (!state.catalog) state.catalog = (await api.get('/catalog')).levels;
  return state.catalog;
}

function renderShell(activeNav) {
  const header = document.getElementById('topbar');
  if (!state.user) {
    header.innerHTML = `<a class="brand" href="/connexion" data-link>${brandMark()}<span>Maths Collège</span></a>`;
    return;
  }
  const levelTabs = ['6e', '5e', '4e', '3e']
    .map((l) => `<a href="/niveau/${l}" data-link class="divider lv-${l}${activeNav === `level-${l}` ? ' active' : ''}"${activeNav === `level-${l}` ? ' aria-current="page"' : ''}>${l}</a>`)
    .join('');
  const isTeacher = state.user.role === 'teacher';
  const link = (href, key, label) => `<a href="${href}" data-link class="navlink${activeNav === key ? ' active' : ''}"${activeNav === key ? ' aria-current="page"' : ''}>${label}</a>`;
  // Trois blocs : la marque, la navigation (intercalaires + liens), le bloc utilisateur.
  // En dessous de 1080px, « topnav » bascule seul sur une deuxième rangée.
  header.innerHTML = `
    <a class="brand" href="/" data-link>${brandMark()}<span>Maths Collège</span></a>
    <div class="topnav">
      <nav class="dividers" aria-label="Niveaux">${levelTabs}</nav>
      <nav class="navrow" aria-label="Menu">
        ${isTeacher ? link('/prof', 'teacher', 'Mes classes') : link('/tableau-de-bord', 'dashboard', 'Tableau de bord')}
        ${link('/exercices', 'free', 'Exercices libres')}
        ${link('/jeux', 'games', 'Jeux')}
      </nav>
    </div>
    <div class="userbox">
      <span class="nav-sep" aria-hidden="true"></span>
      <span class="who" title="${esc(state.user.username)}">${esc(state.user.displayName)}</span>
      <button type="button" id="logout">Déconnexion</button>
    </div>`;
  header.querySelector('#logout').onclick = async () => {
    await api.post('/auth/logout').catch(() => {});
    state.user = null;
    state.catalog = null;
    navigate('/connexion');
  };
}

// Met en avant l'intercalaire du niveau quand on est dans un de ses chapitres.
export function markLevelTab(levelId) {
  document.querySelectorAll('.dividers .divider').forEach((a) => a.classList.toggle('active', a.classList.contains(`lv-${levelId}`)));
}

function brandMark() {
  // Petit repère orthonormé : le logo de la plateforme.
  return `<svg class="brandmark" viewBox="0 0 32 32" aria-hidden="true"><path d="M6 4v22h22" /><path d="M6 26L26 8" class="bm-line"/><circle cx="16" cy="17" r="2.4" class="bm-dot"/></svg>`;
}

export async function render() {
  if (cleanup) {
    try {
      cleanup();
    } catch {
      /* ignoré */
    }
    cleanup = null;
  }
  const path = location.pathname.replace(/\/+$/, '') || '/';
  let match;
  const route = routes.find((r) => (match = path.match(r.path))) || null;

  if (!route) {
    renderShell(null);
    viewEl().innerHTML = `<section class="page narrow"><h1>Page introuvable</h1><p>Cette adresse ne correspond à aucune page.</p><a class="btn" href="/" data-link>Retour à l'accueil</a></section>`;
    return;
  }
  if (!route.public && !state.user) return navigate(`/connexion?suite=${encodeURIComponent(location.pathname)}`, true);
  if (route.public && state.user) return navigate('/', true);
  if (route.role && state.user.role !== route.role) return navigate('/', true);

  const nav = typeof route.nav === 'function' ? route.nav(match) : route.nav;
  renderShell(nav);
  const el = viewEl();
  el.innerHTML = '<div class="loading" aria-busy="true">Chargement…</div>';
  try {
    const out = await route.view({ el, params: match.slice(1), query: new URLSearchParams(location.search) });
    if (typeof out === 'function') cleanup = out;
  } catch (e) {
    console.error(e);
    el.innerHTML = `<section class="page narrow"><h1>Impossible d'afficher la page</h1><p>${esc(e.message)}</p><a class="btn" href="/" data-link>Retour à l'accueil</a></section>`;
  }
  el.focus({ preventScroll: true });
}

// Liens internes : navigation sans rechargement.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
  e.preventDefault();
  if (a.getAttribute('href') !== location.pathname + location.search) {
    navigate(a.getAttribute('href'));
    window.scrollTo(0, 0);
  }
});
window.addEventListener('popstate', render);

setUnauthorizedHandler(() => {
  state.user = null;
  navigate('/connexion', true);
});

export function setUser(u) {
  state.user = u;
  state.catalog = null;
}

(async function boot() {
  try {
    state.user = (await api.get('/auth/me')).user;
  } catch {
    state.user = null;
  }
  render();
})();
