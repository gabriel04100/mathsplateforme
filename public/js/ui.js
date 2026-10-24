// Petits outils d'interface partagés par toutes les vues.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Rend le LaTeX ($…$) contenu dans un élément, via KaTeX servi localement.
export function renderMath(el) {
  if (!el || !window.renderMathInElement) return;
  window.renderMathInElement(el, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
    ],
    throwOnError: false,
  });
}

export function relativeTime(iso) {
  if (!iso) return 'jamais';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  return `le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
}

export const STEP_KIND = { lesson: 'Cours', animation: 'Animation', exercise: 'Exercice' };

export const STATUS_LABEL = {
  done: 'Terminé',
  in_progress: 'En cours',
  not_started: 'À faire',
  locked: 'Verrouillé',
  draft: 'Bientôt',
};

export function stepIcon(type) {
  const icons = {
    lesson: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5C6.5 4 9.5 4 12 5.5v14C9.5 18 6.5 18 4 19.5zM12 5.5C14.5 4 17.5 4 20 5.5v14c-2.5-1.5-5.5-1.5-8 0"/></svg>',
    animation: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M10 8.5l5.5 3.5L10 15.5z"/></svg>',
    exercise: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 4.5l4 4L9 19l-5 1 1-5z"/><path d="M13.5 6.5l4 4"/></svg>',
  };
  return `<span class="ico ico-${type}">${icons[type] || ''}</span>`;
}

export function toast(message, kind = 'info') {
  let box = document.querySelector('.toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'toasts';
    box.setAttribute('role', 'status');
    document.body.append(box);
  }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = message;
  box.append(t);
  setTimeout(() => t.remove(), 4200);
}

export const progressBar = (pct, levelId = '') =>
  `<span class="bar${levelId ? ` lv-${levelId}` : ''}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></span>`;

export function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}
