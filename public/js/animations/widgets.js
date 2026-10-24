// Animations interactives. Chaque widget : mount(conteneur, params, { math }) -> fonction de nettoyage.
// `math(el)` rend le LaTeX contenu dans un élément.
// Pour en ajouter une : écrire la fonction et l'enregistrer dans WIDGETS (le nom est celui du JSON).
import { stepsLatex } from '../math/expr.js';

const fr = (x, d = 2) => String(+x.toFixed(d)).replace('.', ',');
const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const slider = (id, label, min, max, step, value) =>
  `<label class="ctl"><span>${label} <output id="${id}-out">${fr(value)}</output></span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;

// ---------- Droite graduée avec zoom (6e) ----------
function numberLineZoom(el, { start = 0, end = 10, target = 3.47 }, { math }) {
  const root = h(`<div class="widget nlz">
    <svg viewBox="0 0 640 140" class="wsvg" role="img" aria-label="Droite graduée"></svg>
    <p class="w-status"></p>
    <div class="w-actions"><button type="button" class="btn ghost" data-act="out">Dézoomer</button><button type="button" class="btn ghost" data-act="reset">Revenir au début</button></div>
  </div>`);
  el.append(root);
  const svg = root.querySelector('svg');
  const status = root.querySelector('.w-status');
  const stack = [[start, end]];
  const X0 = 30;
  const X1 = 610;

  function draw() {
    const [a, b] = stack[stack.length - 1];
    const step = (b - a) / 10;
    const dec = Math.max(0, Math.round(-Math.log10(step)));
    const xOf = (v) => X0 + ((v - a) / (b - a)) * (X1 - X0);
    let s = `<line x1="${X0 - 10}" y1="70" x2="${X1 + 10}" y2="70" class="axis"/>`;
    for (let i = 0; i < 10; i++) {
      const v = a + i * step;
      const contains = target >= v - 1e-9 && target < v + step - 1e-9;
      s += `<rect x="${xOf(v)}" y="40" width="${xOf(v + step) - xOf(v)}" height="60" class="zone${contains ? ' has-target' : ''}" data-i="${i}" tabindex="0" role="button" aria-label="Zoomer entre ${fr(v, dec)} et ${fr(v + step, dec)}"/>`;
    }
    for (let i = 0; i <= 10; i++) {
      const v = a + i * step;
      const big = i === 0 || i === 10 || i === 5;
      s += `<line x1="${xOf(v)}" y1="${big ? 56 : 62}" x2="${xOf(v)}" y2="${big ? 84 : 78}" class="tick"/>`;
      if (i % (stack.length > 2 ? 5 : 1) === 0 || i === 10) s += `<text x="${xOf(v)}" y="118" class="tlabel">${fr(v, dec)}</text>`;
    }
    if (target >= a && target <= b) {
      s += `<circle cx="${xOf(target)}" cy="70" r="6" class="target"/><text x="${xOf(target)}" y="30" class="tlabel strong">${fr(target, 3)}</text>`;
    }
    svg.innerHTML = s;
    status.textContent = `Intervalle affiché : de ${fr(a, dec)} à ${fr(b, dec)}. Une graduation = ${fr(step, dec)}.${stack.length >= 4 ? ' Zoom maximal.' : ''}`;
  }

  function zoom(i) {
    if (stack.length >= 4) return;
    const [a, b] = stack[stack.length - 1];
    const step = (b - a) / 10;
    stack.push([a + i * step, a + (i + 1) * step]);
    draw();
  }

  svg.addEventListener('click', (e) => {
    const i = e.target.dataset?.i;
    if (i !== undefined) zoom(Number(i));
  });
  svg.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset?.i !== undefined) {
      e.preventDefault();
      zoom(Number(e.target.dataset.i));
    }
  });
  root.querySelector('[data-act=out]').onclick = () => {
    if (stack.length > 1) stack.pop();
    draw();
  };
  root.querySelector('[data-act=reset]').onclick = () => {
    stack.length = 1;
    draw();
  };
  draw();
  return () => root.remove();
}

// ---------- Fractions en barres (6e) ----------
function fractionBars(el, { a = [2, 3], b = [4, 6] }, { math }) {
  const state = { a: [...a], b: [...b] };
  const bar = (key) => `<div class="fb-row" data-k="${key}">
    <div class="fb-ctl">
      <div class="stepper"><button type="button" data-d="n-">−</button><span class="n"></span><button type="button" data-d="n+">+</button></div>
      <div class="fb-line"></div>
      <div class="stepper"><button type="button" data-d="d-">−</button><span class="d"></span><button type="button" data-d="d+">+</button></div>
    </div>
    <div class="fb-bar" aria-hidden="true"></div>
  </div>`;
  const root = h(`<div class="widget fbars">${bar('a')}${bar('b')}<p class="w-status fb-cmp"></p></div>`);
  el.append(root);

  function draw() {
    for (const k of ['a', 'b']) {
      const [n, d] = state[k];
      const row = root.querySelector(`[data-k=${k}]`);
      row.querySelector('.n').textContent = n;
      row.querySelector('.d').textContent = d;
      const barEl = row.querySelector('.fb-bar');
      barEl.innerHTML = '';
      const whole = Math.max(1, Math.ceil(n / d));
      for (let u = 0; u < whole; u++) {
        const unit = document.createElement('div');
        unit.className = 'fb-unit';
        for (let i = 0; i < d; i++) {
          const c = document.createElement('div');
          c.className = `fb-cell${u * d + i < n ? ' on' : ''} ${k}`;
          unit.append(c);
        }
        barEl.append(unit);
      }
    }
    const va = state.a[0] / state.a[1];
    const vb = state.b[0] / state.b[1];
    const sym = Math.abs(va - vb) < 1e-9 ? '=' : va < vb ? '<' : '>';
    const cmp = root.querySelector('.fb-cmp');
    cmp.innerHTML = `$\\dfrac{${state.a[0]}}{${state.a[1]}} ${sym} \\dfrac{${state.b[0]}}{${state.b[1]}}$ &nbsp; <span class="muted">(${fr(va, 3)} et ${fr(vb, 3)})</span>`;
    cmp.classList.toggle('equal', sym === '=');
    math(cmp);
  }

  root.addEventListener('click', (e) => {
    const d = e.target.dataset?.d;
    if (!d) return;
    const k = e.target.closest('.fb-row').dataset.k;
    const s = state[k];
    if (d === 'n+' && s[0] < s[1] * 2) s[0]++;
    if (d === 'n-' && s[0] > 0) s[0]--;
    if (d === 'd+' && s[1] < 12) s[1]++;
    if (d === 'd-' && s[1] > 1) s[1]--;
    draw();
  });
  draw();
  return () => root.remove();
}

// ---------- Additions de relatifs sur la droite (5e) ----------
function relativeMoves(el, { min = -12, max = 12 }, { math }) {
  const root = h(`<div class="widget rm">
    <svg viewBox="0 0 640 130" class="wsvg" role="img" aria-label="Droite graduée des nombres relatifs"></svg>
    <div class="w-controls">${slider('rm-a', 'Départ', min, max, 1, -3)}${slider('rm-b', 'On ajoute', min, max, 1, 7)}</div>
    <p class="w-status"></p>
  </div>`);
  el.append(root);
  const svg = root.querySelector('svg');
  const xOf = (v) => 30 + ((v - min) / (max - min)) * 580;

  function draw() {
    const a = Number(root.querySelector('#rm-a').value);
    const b = Number(root.querySelector('#rm-b').value);
    root.querySelector('#rm-a-out').textContent = a;
    root.querySelector('#rm-b-out').textContent = b > 0 ? `+${b}` : b;
    const r = a + b;
    let s = `<defs><marker id="rm-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrowhead"/></marker></defs>`;
    s += `<line x1="20" y1="90" x2="620" y2="90" class="axis"/>`;
    for (let v = min; v <= max; v++) {
      s += `<line x1="${xOf(v)}" y1="${v === 0 ? 80 : 85}" x2="${xOf(v)}" y2="${v === 0 ? 100 : 95}" class="tick"/>`;
      if (v % 2 === 0) s += `<text x="${xOf(v)}" y="118" class="tlabel${v === 0 ? ' strong' : ''}">${v}</text>`;
    }
    if (r >= min && r <= max && b !== 0) {
      const y = 55;
      s += `<path d="M ${xOf(a)} 88 Q ${(xOf(a) + xOf(r)) / 2} ${y - 25} ${xOf(r)} 88" class="move ${b > 0 ? 'pos' : 'neg'}" marker-end="url(#rm-arrow)"/>`;
      s += `<text x="${(xOf(a) + xOf(r)) / 2}" y="${y - 18}" class="tlabel strong">${b > 0 ? '+' : ''}${b}</text>`;
    }
    s += `<circle cx="${xOf(a)}" cy="90" r="6" class="pt-start"/>`;
    if (r >= min && r <= max) s += `<circle cx="${xOf(r)}" cy="90" r="6" class="target"/>`;
    svg.innerHTML = s;
    const st = root.querySelector('.w-status');
    const p = (x) => (x < 0 ? `(${x})` : `(+${x})`);
    st.innerHTML = r < min || r > max ? `$${p(a)} + ${p(b)} = ${r}$ <span class="muted">(en dehors de la droite)</span>` : `$${p(a)} + ${p(b)} = ${r}$`;
    math(st);
  }
  root.querySelectorAll('input').forEach((i) => i.addEventListener('input', draw));
  draw();
  return () => root.remove();
}

// ---------- Calcul pas à pas (5e) ----------
function prioritySteps(el, { expressions = ['5 + 3 * 4'] }, { math }) {
  const root = h(`<div class="widget ps">
    <div class="w-controls"><label class="ctl"><span>Expression</span><select></select></label></div>
    <div class="ps-lines" aria-live="polite"></div>
    <div class="w-actions"><button type="button" class="btn" data-act="next">Étape suivante</button><button type="button" class="btn ghost" data-act="reset">Recommencer</button></div>
  </div>`);
  el.append(root);
  const sel = root.querySelector('select');
  const pretty = (s) => s.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
  sel.innerHTML = expressions.map((x, i) => `<option value="${i}">${pretty(x)}</option>`).join('');
  let steps = [];
  let shown = 1;

  function draw() {
    const lines = root.querySelector('.ps-lines');
    lines.innerHTML = steps
      .slice(0, shown)
      .map((s, i) => `<div class="ps-line${i === shown - 1 ? ' current' : ''}">$${i === 0 ? '' : '= '}${i === shown - 1 ? s.latex : s.plain}$</div>`)
      .join('');
    math(lines);
    const done = shown >= steps.length;
    const btn = root.querySelector('[data-act=next]');
    btn.disabled = done;
    btn.textContent = done ? 'Calcul terminé' : 'Étape suivante';
  }
  function load() {
    steps = stepsLatex(expressions[Number(sel.value)]);
    shown = 1;
    draw();
  }
  sel.onchange = load;
  root.querySelector('[data-act=next]').onclick = () => {
    shown = Math.min(steps.length, shown + 1);
    draw();
  };
  root.querySelector('[data-act=reset]').onclick = load;
  load();
  return () => root.remove();
}

// ---------- Modèle des aires (4e) ----------
function areaModel(el, { k = 3, a = 4, b = 2 }, { math }) {
  const root = h(`<div class="widget am">
    <div class="w-controls">${slider('am-k', 'k', 1, 8, 1, k)}${slider('am-a', 'a', 1, 8, 1, a)}${slider('am-b', 'b', 1, 8, 1, b)}</div>
    <svg viewBox="0 0 640 300" class="wsvg" role="img" aria-label="Rectangle découpé en deux"></svg>
    <p class="w-status"></p>
  </div>`);
  el.append(root);
  const svg = root.querySelector('svg');
  function draw() {
    const v = (id) => Number(root.querySelector(`#am-${id}`).value);
    const [K, A, B] = [v('k'), v('a'), v('b')];
    ['k', 'a', 'b'].forEach((id) => (root.querySelector(`#am-${id}-out`).textContent = v(id)));
    const u = Math.min(520 / (A + B), 230 / K);
    const x0 = 70;
    const y0 = 30;
    let s = `<rect x="${x0}" y="${y0}" width="${A * u}" height="${K * u}" class="area-a"/>`;
    s += `<rect x="${x0 + A * u}" y="${y0}" width="${B * u}" height="${K * u}" class="area-b"/>`;
    for (let i = 1; i < A + B; i++) s += `<line x1="${x0 + i * u}" y1="${y0}" x2="${x0 + i * u}" y2="${y0 + K * u}" class="grid-in"/>`;
    for (let j = 1; j < K; j++) s += `<line x1="${x0}" y1="${y0 + j * u}" x2="${x0 + (A + B) * u}" y2="${y0 + j * u}" class="grid-in"/>`;
    s += `<rect x="${x0}" y="${y0}" width="${(A + B) * u}" height="${K * u}" class="area-outline"/>`;
    s += `<text x="${x0 + (A * u) / 2}" y="${y0 + (K * u) / 2 + 6}" class="area-label">${K}×${A} = ${K * A}</text>`;
    s += `<text x="${x0 + A * u + (B * u) / 2}" y="${y0 + (K * u) / 2 + 6}" class="area-label">${K}×${B} = ${K * B}</text>`;
    s += `<text x="${x0 - 14}" y="${y0 + (K * u) / 2 + 6}" class="tlabel strong" text-anchor="end">k = ${K}</text>`;
    s += `<text x="${x0 + (A * u) / 2}" y="${y0 + K * u + 24}" class="tlabel">a = ${A}</text>`;
    s += `<text x="${x0 + A * u + (B * u) / 2}" y="${y0 + K * u + 24}" class="tlabel">b = ${B}</text>`;
    svg.innerHTML = s;
    const st = root.querySelector('.w-status');
    st.innerHTML = `$${K} \\times (${A} + ${B}) = ${K} \\times ${A} + ${K} \\times ${B} = ${K * A} + ${K * B} = ${K * (A + B)}$`;
    math(st);
  }
  root.querySelectorAll('input').forEach((i) => i.addEventListener('input', draw));
  draw();
  return () => root.remove();
}

// ---------- Carrés de Pythagore (4e) ----------
function pythagoras(el, { a = 3, b = 4 }, { math }) {
  const root = h(`<div class="widget py">
    <div class="w-controls">${slider('py-a', 'Côté horizontal', 1, 8, 0.5, a)}${slider('py-b', 'Côté vertical', 1, 8, 0.5, b)}</div>
    <svg viewBox="0 0 640 420" class="wsvg" role="img" aria-label="Triangle rectangle et carrés construits sur ses côtés"></svg>
    <p class="w-status"></p>
  </div>`);
  el.append(root);
  const svg = root.querySelector('svg');
  function draw() {
    const A = Number(root.querySelector('#py-a').value);
    const B = Number(root.querySelector('#py-b').value);
    root.querySelector('#py-a-out').textContent = fr(A);
    root.querySelector('#py-b-out').textContent = fr(B);
    // Coordonnées en unités (y vers le bas) ; la figure est ensuite mise à l'échelle et centrée.
    const s = 1;
    const R = [0, 0]; // sommet de l'angle droit
    const P = [A, 0]; // extrémité horizontale
    const Q = [0, -B]; // extrémité verticale
    const pts = (arr) => arr.map((p) => p.join(',')).join(' ');
    // carré sous le côté horizontal, carré à gauche du côté vertical, carré extérieur sur l'hypoténuse
    const sqA = [R, P, [P[0], P[1] + A * s], [R[0], R[1] + A * s]];
    const sqB = [R, Q, [Q[0] - B * s, Q[1]], [R[0] - B * s, R[1]]];
    const dx = P[0] - Q[0];
    const dy = P[1] - Q[1];
    const sqC = [Q, P, [P[0] + dy, P[1] - dx], [Q[0] + dy, Q[1] - dx]];
    const c2 = A * A + B * B;
    const ctr = (q) => [q.reduce((t, p) => t + p[0], 0) / 4, q.reduce((t, p) => t + p[1], 0) / 4];
    const [ca, cb, cc] = [ctr(sqA), ctr(sqB), ctr(sqC)];
    // recentrage horizontal et vertical
    const all = [...sqA, ...sqB, ...sqC];
    const minX = Math.min(...all.map((p) => p[0]));
    const maxX = Math.max(...all.map((p) => p[0]));
    const minY = Math.min(...all.map((p) => p[1]));
    const maxY = Math.max(...all.map((p) => p[1]));
    const scale = Math.min(600 / (maxX - minX), 400 / (maxY - minY));
    const tx = (p) => [(p[0] - minX) * scale + (640 - (maxX - minX) * scale) / 2, (p[1] - minY) * scale + (420 - (maxY - minY) * scale) / 2];
    const T = (q) => pts(q.map(tx));
    let out = `<polygon points="${T(sqA)}" class="sq sq-a"/><polygon points="${T(sqB)}" class="sq sq-b"/><polygon points="${T(sqC)}" class="sq sq-c"/>`;
    out += `<polygon points="${T([R, P, Q])}" class="tri"/>`;
    const lab = (c, txt, cls) => {
      const [x, y] = tx(c);
      return `<text x="${x}" y="${y + 6}" class="area-label ${cls}">${txt}</text>`;
    };
    out += lab(ca, fr(A * A), 'a') + lab(cb, fr(B * B), 'b') + lab(cc, fr(c2), 'c');
    svg.innerHTML = out;
    const st = root.querySelector('.w-status');
    st.innerHTML = `$${fr(A).replace(',', '{,}')}^2 + ${fr(B).replace(',', '{,}')}^2 = ${fr(A * A).replace(',', '{,}')} + ${fr(B * B).replace(',', '{,}')} = ${fr(c2).replace(',', '{,}')}$ &nbsp; donc l'hypoténuse mesure $\\sqrt{${fr(c2).replace(',', '{,}')}} ${Number.isInteger(Math.sqrt(c2)) ? '=' : '\\approx'} ${fr(Math.sqrt(c2)).replace(',', '{,}')}$`;
    math(st);
  }
  root.querySelectorAll('input').forEach((i) => i.addEventListener('input', draw));
  draw();
  return () => root.remove();
}

// ---------- Crible d'Ératosthène (3e) ----------
function sieve(el, { max = 100 }) {
  const root = h(`<div class="widget sv">
    <div class="sv-grid"></div>
    <p class="w-status" aria-live="polite"></p>
    <div class="w-actions"><button type="button" class="btn" data-act="next">Barrer les multiples</button><button type="button" class="btn ghost" data-act="reset">Recommencer</button></div>
  </div>`);
  el.append(root);
  const grid = root.querySelector('.sv-grid');
  let state;
  function reset() {
    state = { crossed: new Set([1]), primes: [], current: null };
    grid.innerHTML = Array.from({ length: max }, (_, i) => `<span class="sv-cell" data-n="${i + 1}">${i + 1}</span>`).join('');
    paint();
    root.querySelector('.w-status').textContent = '1 est barré : ce n\'est pas un nombre premier. Clique pour commencer avec 2.';
  }
  function paint() {
    grid.querySelectorAll('.sv-cell').forEach((c) => {
      const n = Number(c.dataset.n);
      c.className = `sv-cell${state.crossed.has(n) ? ' crossed' : ''}${state.primes.includes(n) ? ' prime' : ''}${n === state.current ? ' current' : ''}`;
    });
  }
  function next() {
    let p = 2;
    while (p <= max && (state.crossed.has(p) || state.primes.includes(p))) p++;
    const btn = root.querySelector('[data-act=next]');
    if (p > max) return;
    state.primes.push(p);
    state.current = p;
    let count = 0;
    for (let m = p * p; m <= max; m += p) if (!state.crossed.has(m)) { state.crossed.add(m); count++; }
    const status = root.querySelector('.w-status');
    if (p * p > max) {
      for (let n = 2; n <= max; n++) if (!state.crossed.has(n) && !state.primes.includes(n)) state.primes.push(n);
      status.textContent = `${p} × ${p} = ${p * p} dépasse ${max} : tous les nombres restants sont premiers. Il y en a ${state.primes.length} jusqu'à ${max}.`;
      btn.disabled = true;
    } else {
      status.textContent = `${p} est premier. On barre ses multiples à partir de ${p} × ${p} = ${p * p} : ${count} nombre(s) barré(s).`;
    }
    paint();
  }
  root.querySelector('[data-act=next]').onclick = next;
  root.querySelector('[data-act=reset]').onclick = () => {
    root.querySelector('[data-act=next]').disabled = false;
    reset();
  };
  reset();
  return () => root.remove();
}

// ---------- Fonction affine (3e) ----------
function affineGraph(el, { a = 1, b = 2 }, { math }) {
  const root = h(`<div class="widget ag">
    <div class="w-controls">${slider('ag-a', 'a', -3, 3, 0.5, a)}${slider('ag-b', 'b', -5, 5, 1, b)}</div>
    <svg viewBox="0 0 400 400" class="wsvg square" role="img" aria-label="Représentation graphique de la fonction affine"></svg>
    <p class="w-status"></p>
  </div>`);
  el.append(root);
  const svg = root.querySelector('svg');
  const N = 8;
  const u = 400 / (2 * N);
  const X = (x) => 200 + x * u;
  const Y = (y) => 200 - y * u;
  function draw() {
    const A = Number(root.querySelector('#ag-a').value);
    const B = Number(root.querySelector('#ag-b').value);
    root.querySelector('#ag-a-out').textContent = fr(A);
    root.querySelector('#ag-b-out').textContent = fr(B);
    let s = '';
    for (let i = -N; i <= N; i++) s += `<line x1="${X(i)}" y1="0" x2="${X(i)}" y2="400" class="grid-in"/><line x1="0" y1="${Y(i)}" x2="400" y2="${Y(i)}" class="grid-in"/>`;
    s += `<line x1="0" y1="200" x2="400" y2="200" class="axis"/><line x1="200" y1="0" x2="200" y2="400" class="axis"/>`;
    for (let i = -N + 2; i < N; i += 2) if (i) s += `<text x="${X(i)}" y="216" class="tlabel small">${i}</text><text x="190" y="${Y(i) + 4}" class="tlabel small" text-anchor="end">${i}</text>`;
    s += `<line x1="${X(-N)}" y1="${Y(A * -N + B)}" x2="${X(N)}" y2="${Y(A * N + B)}" class="fn-line"/>`;
    // triangle de pente : de x=1 à x=2
    s += `<polyline points="${X(1)},${Y(A + B)} ${X(2)},${Y(A + B)} ${X(2)},${Y(2 * A + B)}" class="slope"/>`;
    s += `<text x="${X(1.5)}" y="${Y(A + B) + (A >= 0 ? 16 : -8)}" class="tlabel small">+1</text>`;
    if (A) s += `<text x="${X(2) + 6}" y="${Y(1.5 * A + B) + 4}" class="tlabel small" text-anchor="start">${A > 0 ? '+' : ''}${fr(A)}</text>`;
    s += `<circle cx="${X(0)}" cy="${Y(B)}" r="6" class="target"/>`;
    svg.innerHTML = s;
    const st = root.querySelector('.w-status');
    const at = fr(A).replace(',', '{,}');
    const lin = A === 0 ? `${B}` : `${A === 1 ? '' : A === -1 ? '-' : at}x ${B < 0 ? '-' : '+'} ${Math.abs(B)}`;
    st.innerHTML = `$f(x) = ${lin}$ &nbsp; La droite coupe l'axe vertical en $(0\\,;\\,${B})$. ${A > 0 ? 'Elle monte.' : A < 0 ? 'Elle descend.' : 'Elle est horizontale : $f$ est constante.'}`;
    math(st);
  }
  root.querySelectorAll('input').forEach((i) => i.addEventListener('input', draw));
  draw();
  return () => root.remove();
}

export const WIDGETS = {
  'number-line-zoom': numberLineZoom,
  'fraction-bars': fractionBars,
  'relative-moves': relativeMoves,
  'priority-steps': prioritySteps,
  'area-model': areaModel,
  pythagoras,
  sieve,
  'affine-graph': affineGraph,
};
