// Le rapporteur : mesurer un angle, construire un angle.
//
// Ces deux animations partagent presque tout — le rapporteur à deux
// graduations, le minuteur qui enchaîne les étapes, la liste des étapes
// cliquables, le mode « à toi de jouer ». Seuls diffèrent la suite d'étapes,
// ce qui se dessine à chaque instant, et la question posée à l'élève.
//
// Ce qui est pédagogiquement en jeu, et qui explique les choix de code :
//  · le rapporteur porte DEUX graduations, et l'erreur classique est de lire
//    sur la mauvaise. L'animation met donc en évidence le 0 posé sur le côté,
//    puis estompe l'autre graduation ; la correction nomme l'erreur quand
//    l'élève donne 180 − a au lieu de a.
//  · l'angle est volontairement incliné et tiré au hasard d'un côté ou de
//    l'autre : un élève qui n'a vu que des angles « posés à plat » avec le 0 à
//    droite n'a rien appris.
//  · la mesure se compte en balayant depuis le 0, chiffre qui défile : c'est
//    ce comptage, et non la lecture d'un nombre, qu'on veut faire voir.

const NS = 'http://www.w3.org/2000/svg';
const rad = (d) => (d * Math.PI) / 180;
const cl = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function svgEl(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function html(s) {
  const t = document.createElement('template');
  t.innerHTML = s.trim();
  return t.content.firstElementChild;
}

// Point à l'angle d (degrés, sens trigonométrique) et à la distance r du centre c.
const P = (c, d, r) => ({ x: c.x + r * Math.cos(rad(d)), y: c.y - r * Math.sin(rad(d)) });
const ORIGIN = { x: 0, y: 0 };
const lp = (d, r) => P(ORIGIN, d, r);

function arcPath(c, r, d1, d2) {
  if (d2 < d1) [d1, d2] = [d2, d1];
  if (d2 - d1 < 0.05) return '';
  const a = P(c, d1, r);
  const b = P(c, d2, r);
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${d2 - d1 > 180 ? 1 : 0} 0 ${b.x} ${b.y}`;
}

// ---------- dimensions communes ----------
const O = { x: 450, y: 400 }; // sommet de l'angle dans le repère du dessin
const R = 230; // rayon du rapporteur
const RAY = 330; // longueur des demi-droites
const PT = 272; // position des points nommés sur les côtés
const MARK = R + 12; // le point se marque juste au bord du rapporteur
const START = { x: 650, y: 250 }; // d'où arrive le rapporteur
const LBL_OUT = R - 31;
const LBL_IN = R - 50;
const IN_ARC = R - 62;
const NOMS = [
  ['A', 'O', 'B'],
  ['M', 'N', 'P'],
  ['E', 'F', 'G'],
  ['R', 'S', 'T'],
  ['K', 'L', 'M'],
  ['C', 'D', 'E'],
];

// ---------- le rapporteur ----------
// Dessiné une fois pour toutes dans son propre repère (centre à l'origine,
// côté plat horizontal) : on le déplace ensuite par une transformation.
function drawProtractor(parent) {
  const prot = svgEl('g', {}, parent);
  svgEl('path', { class: 'ag-body', d: `M ${-R - 8} 20 L ${-R - 8} 0 A ${R + 8} ${R + 8} 0 0 1 ${R + 8} 0 L ${R + 8} 20 Z` }, prot);
  const sweepArc = svgEl('path', { class: 'ag-sweep' }, prot);

  const ticks = svgEl('g', {}, prot);
  for (let d = 0; d <= 180; d++) {
    const len = d % 10 === 0 ? 18 : d % 5 === 0 ? 11 : 6;
    const a = lp(d, R);
    const b = lp(d, R - len);
    svgEl('line', { class: 'ag-tick' + (d % 10 === 0 ? ' big' : ''), x1: a.x, y1: a.y, x2: b.x, y2: b.y }, ticks);
  }
  svgEl('path', { class: 'ag-tick', d: arcPath(ORIGIN, IN_ARC, 0, 180) }, prot);
  for (let d = 0; d <= 180; d += 5) {
    const a = lp(d, IN_ARC);
    const b = lp(d, IN_ARC + (d % 10 ? 4 : 8));
    svgEl('line', { class: 'ag-tick', x1: a.x, y1: a.y, x2: b.x, y2: b.y }, ticks);
  }
  svgEl('line', { class: 'ag-tick faint', x1: 0, y1: -14, x2: 0, y2: -IN_ARC }, prot);

  const baseLine = svgEl('line', { class: 'ag-base', x1: -R, y1: 0, x2: R, y2: 0 }, prot);
  const gOut = svgEl('g', { class: 'ag-lbl out' }, prot);
  const gIn = svgEl('g', { class: 'ag-lbl in' }, prot);
  const zeroPos = {};
  const addLabel = (g, val, phi, r, key) => {
    const p = lp(phi, r);
    const t = svgEl(
      'text',
      { x: p.x, y: p.y, 'text-anchor': 'middle', 'dominant-baseline': 'central', transform: `rotate(${90 - phi} ${p.x} ${p.y})` },
      g
    );
    t.textContent = val;
    if (val === 0) zeroPos[key] = p;
  };
  for (let d = 0; d <= 180; d += 10) {
    // Le 0 et le 180 sont décalés d'un cheveu pour ne pas sortir du demi-disque.
    const phi = d === 0 ? 2.4 : d === 180 ? 177.6 : d;
    addLabel(gIn, d, phi, LBL_IN, 'in'); // graduation intérieure : 0 à droite
    addLabel(gOut, 180 - d, phi, LBL_OUT, 'out'); // extérieure : 0 à gauche
  }
  svgEl('line', { class: 'ag-base', x1: 0, y1: -10, x2: 0, y2: 10 }, prot);
  svgEl('circle', { class: 'ag-center', cx: 0, cy: 0, r: 3.4 }, prot);
  const centerRipple = svgEl('circle', { class: 'ag-ripple', cx: 0, cy: 0, r: 14 }, prot);
  const zeroG = svgEl('g', {}, prot);
  const zeroRing = svgEl('circle', { class: 'ag-zero blink', r: 14 }, zeroG);
  const sweepDot = svgEl('circle', { class: 'ag-sweepdot', r: 6.5 }, prot);
  return { prot, sweepArc, baseLine, gOut, gIn, zeroPos, zeroG, zeroRing, sweepDot, centerRipple };
}

function cross(c, parent, cls = '') {
  const g = svgEl('g', { class: 'ag-pt ' + cls }, parent);
  const s = 6;
  svgEl('line', { x1: c.x - s, y1: c.y - s, x2: c.x + s, y2: c.y + s }, g);
  svgEl('line', { x1: c.x - s, y1: c.y + s, x2: c.x + s, y2: c.y - s }, g);
  return g;
}
function pointLabel(c, txt, parent) {
  const t = svgEl('text', { class: 'ag-ptlbl', x: c.x, y: c.y, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, parent);
  t.textContent = txt;
  return t;
}

// L'angle noté avec son chapeau : « ABC » surmonté d'un accent.
const angleHtml = (noms) => `<span class="ag-hat">${noms.join('')}</span>`;

function typeCheck(a) {
  if (a < 90) return "On vérifie : l'angle est bien <b>aigu</b>, c'est normal pour une mesure inférieure à 90°.";
  if (a > 90) return "On vérifie : l'angle est bien <b>obtus</b>, c'est normal pour une mesure supérieure à 90°.";
  return 'On obtient un angle <b>droit</b> : 90°.';
}

// ---------- le minuteur ----------
// G est la position continue dans l'animation : la partie entière est l'étape,
// la partie décimale l'avancement dans cette étape. Tout le dessin est une
// fonction de G, ce qui rend l'animation parcourable dans les deux sens.
function createPlayer({ steps, hold = 1600, onFrame }) {
  const N = steps.length;
  const p = { G: 0, playing: false, speed: 1, stopAt: null, hold: 0, N };
  let last = null;
  let raf = null;

  function loop(ts) {
    const dt = last == null ? 0 : Math.min(64, ts - last);
    last = ts;
    if (p.playing) {
      if (p.hold > 0) p.hold -= dt * p.speed;
      else {
        const i = Math.min(N - 1, Math.floor(p.G));
        p.G += (dt * p.speed) / steps[i].dur;
        const k = Math.floor(p.G);
        if (k > i) {
          if (p.stopAt != null && k >= p.stopAt) {
            p.G = p.stopAt;
            p.playing = false;
            p.stopAt = null;
          } else if (k >= N) {
            p.G = N;
            p.playing = false;
          } else {
            p.G = k;
            p.hold = hold; // on souffle entre deux étapes
          }
        }
      }
    }
    onFrame();
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  // Toute commande redessine tout de suite, sans attendre la frame suivante :
  // un onglet en arrière-plan ne reçoit plus de frames, et un clic sur « étape
  // suivante » doit quand même afficher l'étape suivante.
  const commande = (fn) =>
    function (...args) {
      fn.apply(this, args);
      onFrame();
    };

  return {
    state: p,
    play: commande(function () {
      if (p.G >= N) p.G = 0;
      p.stopAt = null;
      p.hold = 0;
      p.playing = true;
    }),
    toggle: commande(function () {
      if (p.playing) p.playing = false;
      else {
        if (p.G >= N) p.G = 0;
        p.stopAt = null;
        p.hold = 0;
        p.playing = true;
      }
    }),
    next: commande(function () {
      if (p.G >= N) return;
      p.stopAt = Math.floor(p.G) + 1;
      p.hold = 0;
      p.playing = true;
    }),
    prev: commande(function () {
      p.playing = false;
      p.stopAt = null;
      p.G = Math.max(1, Math.ceil(p.G) - 1);
    }),
    goto: commande(function (i) {
      p.playing = false;
      p.stopAt = null;
      p.G = i;
    }),
    runTo: commande(function (from, to) {
      p.G = from;
      p.stopAt = to;
      p.hold = 0;
      p.playing = true;
    }),
    restart: commande(function () {
      p.G = 0;
      p.stopAt = null;
      p.hold = 0;
      p.playing = true;
    }),
    stop() {
      p.playing = false;
      cancelAnimationFrame(raf);
    },
  };
}

// ---------- coquille commune ----------
// Le cadre autour du dessin : le titre d'étape, les commandes, la liste des
// étapes, la méthode, et la carte d'exercice. Chaque scène y branche ses
// textes et son rendu.
function shell({ scene, methode, exoTitre }) {
  const root = html(`<div class="widget w-angle">
    <div class="ag-modes">
      <button type="button" class="chipbtn on" data-mode="anim">Animation</button>
      <button type="button" class="chipbtn" data-mode="exo">${exoTitre}</button>
    </div>
    <div class="ag-layout">
    <div class="ag-stage">
      <p class="ag-consigne" data-consigne hidden></p>
      <svg class="wsvg ag-svg" viewBox="0 0 900 545" role="img" data-scene></svg>
    </div>
    <div class="ag-side">
      <section class="ag-card" data-caption>
        <span class="ag-tag" data-captag></span>
        <h3 data-captitle></h3>
        <p data-captext></p>
        <p class="ag-readout" data-readout></p>
      </section>
      <section class="ag-card" data-controls>
        <div class="ag-cmds">
          <button type="button" class="btn ghost" data-act="restart" title="Recommencer">↺</button>
          <button type="button" class="btn ghost" data-act="prev" title="Étape précédente">◀</button>
          <button type="button" class="btn" data-act="play">▶ Lecture</button>
          <button type="button" class="btn ghost" data-act="next" title="Étape suivante">▶|</button>
        </div>
        <div class="ag-dots" data-dots></div>
        <label class="ctl inline">Vitesse
          <input type="range" data-speed min="0.4" max="2" step="0.1" value="1">
          <output data-speedval>×1</output></label>
        <div class="w-actions">
          <button type="button" class="btn ghost" data-act="rand">🎲 Un autre angle</button>
          <label class="ctl inline">ou <input type="number" data-custom min="1" max="179" placeholder="65"> °
            <button type="button" class="btn ghost" data-act="ok">OK</button></label>
        </div>
      </section>
      <section class="ag-card" data-exo hidden>
        <span class="ag-tag">Entraînement</span>
        <h3>${exoTitre}</h3>
        <div data-exo-body></div>
        <p class="ag-fb" data-fb hidden></p>
        <div class="w-actions">
          <button type="button" class="btn" data-act="check">Vérifier</button>
          <button type="button" class="btn ghost" data-act="corr" hidden>👀 Voir la correction</button>
          <button type="button" class="btn ghost" data-act="again">Angle suivant →</button>
        </div>
        <p class="muted small" data-score></p>
      </section>
      <section class="ag-card">
        <h3>La méthode</h3>
        <ol class="ag-method" data-method>${methode.map((m) => `<li>${m}</li>`).join('')}</ol>
      </section>
    </div>
    </div>
  </div>`);
  return root;
}

// =====================================================================
//  Scène 1 — mesurer un angle
// =====================================================================
function mesurerAngle(el, params = {}, { math }) {
  const root = shell({
    exoTitre: 'À toi de lire',
    methode: [
      'Je place le <b>centre</b> du rapporteur sur le <b>sommet</b> de l’angle.',
      'J’aligne la <b>ligne du 0</b> sur un côté de l’angle.',
      'Je lis la mesure sur l’<b>autre côté</b>, en partant du <b>0</b>.',
    ],
  });
  el.append(root);

  const svg = root.querySelector('[data-scene]');
  const protLayer = svgEl('g', {}, svg);
  const angleLayer = svgEl('g', {}, svg);
  const hiLayer = svgEl('g', {}, svg);
  const pr = drawProtractor(protLayer);
  const vertexRipple = svgEl('circle', { class: 'ag-ripple', cx: O.x, cy: O.y, r: 14 }, hiLayer);
  const sweepTxt = svgEl('text', { class: 'ag-sweeptxt', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, hiLayer);
  const dynLayer = svgEl('g', {}, hiLayer);

  const STEPS = [
    { dur: 1700, name: 'L’angle' },
    { dur: 900, name: 'Le rapporteur' },
    { dur: 1900, name: 'Centre sur le sommet' },
    { dur: 1600, name: 'Le 0 sur un côté' },
    { dur: 1300, name: 'La bonne graduation' },
    { dur: 2800, name: 'Lire la mesure' },
    { dur: 900, name: 'Résultat' },
  ];
  const METHOD_OF = [-1, -1, 0, 1, 2, 2, 2];

  const S = {};
  const D = {};
  const ex = { ok: 0, total: 0, counted: false };
  let mode = 'anim';
  let correcting = false;

  function caption(i) {
    const [A, V, B] = S.names;
    const ANG = angleHtml(S.names);
    const sc = S.inner ? '<span class="ag-blue">intérieure (en bleu)</span>' : '<span class="ag-red">extérieure (en rouge)</span>';
    const scS = S.inner ? '<span class="ag-blue">bleue</span>' : '<span class="ag-red">rouge</span>';
    switch (i) {
      case 0:
        return ['L’angle à mesurer', `On veut mesurer l’angle ${ANG}. Son <b>sommet</b> est le point ${V}. Ses <b>côtés</b> sont les demi-droites [${V}${A}) et [${V}${B}).`];
      case 1:
        return ['Le rapporteur', 'Le rapporteur a <b>deux graduations</b> de 0 à 180 : une <span class="ag-red">extérieure</span> et une <span class="ag-blue">intérieure</span>. Son <b>centre</b> est marqué par une petite croix, au milieu du côté plat.'];
      case 2:
        return ['Étape 1 · Le centre sur le sommet', `On fait glisser le rapporteur pour placer son <b>centre</b> exactement sur le <b>sommet</b> ${V}.`];
      case 3:
        return ['Étape 2 · Le 0 sur un côté', `On fait tourner le rapporteur autour de ${V} jusqu’à ce que la <b>ligne du 0</b> soit bien posée sur le côté [${V}${A}).`];
      case 4:
        return ['Quelle graduation utiliser ?', `Sur le côté [${V}${A}), on voit le <b>0</b> de la graduation ${sc}. C’est sur <b>cette graduation-là</b> qu’on va lire. L’autre ne sert pas !`];
      case 5:
        return ['Étape 3 · Lire la mesure', `On part du 0 et on suit la graduation ${scS} jusqu’à l’autre côté [${V}${B}). Les grands traits vont de 10 en 10, les petits de 1 en 1.`];
      default:
        return ['Résultat', `Le côté [${V}${B}) passe par la graduation <b>${S.a}</b>, donc ${ANG} = <b>${S.a}°</b>.<br><span class="ag-check">✔ ${typeCheck(S.a)}</span>`];
    }
  }

  function build() {
    const { a, r, inner } = S;
    D.ref = inner ? r : r + 180; // côté sur lequel on aligne le 0
    D.oth = inner ? r + a : r + 180 - a; // côté sur lequel on lit
    D.col = inner ? 'blue' : 'red';
    D.sr = inner ? IN_ARC - 12 : R + 18; // rayon de l'arc de lecture
    angleLayer.innerHTML = '';
    dynLayer.innerHTML = '';

    D.mark = svgEl('path', { class: 'ag-code', d: arcPath(O, 36, D.ref, D.oth) }, angleLayer);
    D.rayRef = svgEl('line', { class: 'ag-ray', x1: O.x, y1: O.y, x2: O.x, y2: O.y }, angleLayer);
    D.rayOth = svgEl('line', { class: 'ag-ray', x1: O.x, y1: O.y, x2: O.x, y2: O.y }, angleLayer);

    const pA = P(O, D.ref, PT);
    const pB = P(O, D.oth, PT);
    D.ptA = svgEl('g', {}, angleLayer);
    cross(pA, D.ptA);
    pointLabel(P(pA, D.ref + (inner ? -90 : 90), 22), S.names[0], D.ptA);
    D.ptB = svgEl('g', {}, angleLayer);
    cross(pB, D.ptB);
    pointLabel(P(pB, D.oth + (inner ? 90 : -90), 22), S.names[2], D.ptB);
    D.ptO = pointLabel(P(O, r - 90, 38), S.names[1], angleLayer);

    const z = pr.zeroPos[inner ? 'in' : 'out'];
    pr.zeroRing.setAttribute('cx', z.x);
    pr.zeroRing.setAttribute('cy', z.y);
    pr.zeroRing.setAttribute('class', 'ag-zero blink ' + D.col);
    pr.sweepArc.setAttribute('class', 'ag-sweep ' + D.col);

    const h = P(O, D.oth, R);
    D.hit = svgEl('circle', { class: 'ag-hit', cx: h.x, cy: h.y, r: 11 }, dynLayer);
    D.bubble = bubble(dynLayer, P(O, D.oth, R + 56), `${S.a}°`);
    common?.invalidate();
  }

  function render() {
    const G = player.state.G;
    const g0 = cl(G);
    const g1 = cl(G - 1);
    const g2 = ease(cl(G - 2));
    const g3 = ease(cl(G - 3));
    const g4 = cl(G - 4);
    const g5 = ease(cl(G - 5));
    const g6 = cl(G - 6);
    const hints = mode === 'anim' || correcting;

    // l'angle se dessine
    const kR = cl(g0 * 1.8);
    const kO = cl(g0 * 1.8 - 0.8);
    const eR = P(O, D.ref, RAY * kR);
    const eO = P(O, D.oth, RAY * kO);
    D.rayRef.setAttribute('x2', eR.x);
    D.rayRef.setAttribute('y2', eR.y);
    D.rayOth.setAttribute('x2', eO.x);
    D.rayOth.setAttribute('y2', eO.y);
    D.ptA.style.opacity = cl((kR - PT / RAY) * 8);
    D.ptB.style.opacity = cl((kO - PT / RAY) * 8);
    D.ptO.style.opacity = cl(g0 * 4);
    D.mark.style.opacity = cl((g0 - 0.85) * 7);
    D.rayRef.setAttribute('class', 'ag-ray' + (hints && G >= 3 ? ' ref-' + D.col : ''));
    D.rayOth.setAttribute('class', 'ag-ray' + (hints && G >= 5 ? ' oth' : ''));

    // le rapporteur arrive, glisse, tourne
    const x = lerp(START.x, O.x, g2);
    const y = lerp(START.y, O.y, g2);
    const rot = lerp(S.rot0, S.r, g3);
    pr.prot.setAttribute('transform', `translate(${x} ${y}) rotate(${-rot}) scale(${0.92 + 0.08 * g1})`);
    pr.prot.style.opacity = g1;
    const pulse = hints && G > 1.4 && G < 3.15;
    pr.centerRipple.style.display = pulse ? '' : 'none';
    vertexRipple.style.display = pulse ? '' : 'none';
    pr.baseLine.setAttribute('class', 'ag-base' + (hints && G >= 3.4 ? ' on-' + D.col : ''));

    // choisir la graduation : l'autre s'estompe
    (S.inner ? pr.gOut : pr.gIn).style.opacity = hints ? 1 - 0.72 * g4 : 1;
    (S.inner ? pr.gIn : pr.gOut).style.opacity = 1;
    pr.zeroG.style.opacity = hints ? g4 : 0;

    sweep(pr, sweepTxt, root, { actif: hints && G > 5, a: S.a, t: g5, inner: S.inner, r: S.r, sr: D.sr, fade: g6, repli: G >= 6 ? `${S.a}°` : '' });

    D.hit.style.opacity = g6;
    D.bubble.style.opacity = g6;
    paintUI();
  }

  // ---------- exercice : lire la mesure ----------
  function newExercise() {
    newAngle(randInt(15, 165));
    player.goto(4);
    correcting = false;
    root.querySelector('[data-caption]').hidden = true;
    root.querySelector('[data-exo-body]').innerHTML = `<p>Le rapporteur est déjà bien placé. Quelle est la mesure de l’angle ${angleHtml(S.names)} ?</p>
      <label class="ctl inline">Mesure <input type="number" data-rep min="0" max="180" placeholder="?"> °</label>`;
    const fb = root.querySelector('[data-fb]');
    fb.hidden = true;
    root.querySelector('[data-act="corr"]').hidden = true;
    ex.counted = false;
    const input = root.querySelector('[data-rep]');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') check();
    });
    setTimeout(() => input.focus(), 40);
  }

  function check() {
    const input = root.querySelector('[data-rep]');
    const fb = root.querySelector('[data-fb]');
    const v = parseFloat(String(input.value).replace(',', '.'));
    if (Number.isNaN(v)) return showFb(fb, 'ko', 'Écris un nombre entre 0 et 180.');
    const first = !ex.counted;
    if (first) {
      ex.counted = true;
      ex.total++;
    }
    const [A, V] = S.names;
    const indice = S.a < 90 ? 'L’angle est <b>aigu</b> : sa mesure doit être inférieure à 90°.' : S.a > 90 ? 'L’angle est <b>obtus</b> : sa mesure doit être supérieure à 90°.' : '';
    if (Math.abs(v - S.a) <= 1) {
      if (first) ex.ok++;
      showFb(fb, 'ok', `🎉 Bravo ! ${angleHtml(S.names)} = <b>${S.a}°</b>.`);
      root.querySelector('[data-act="corr"]').hidden = true;
    } else if (Math.abs(v - (180 - S.a)) <= 1 && Math.abs(S.a - 90) > 3) {
      showFb(fb, 'ko', `Oups, tu as lu sur la <b>mauvaise graduation</b> ! Cherche le <b>0</b> posé sur le côté [${V}${A}) et lis sur celle-là. ${indice}`);
      root.querySelector('[data-act="corr"]').hidden = false;
    } else if (Math.abs(v - S.a) <= 5) {
      showFb(fb, 'ko', 'Presque ! Regarde bien les petits traits : ils vont de 1 en 1.');
      root.querySelector('[data-act="corr"]').hidden = false;
    } else {
      showFb(fb, 'ko', `Ce n’est pas ça. Pars bien du 0 posé sur le côté [${V}${A}). ${indice}`);
      root.querySelector('[data-act="corr"]').hidden = false;
    }
    paintScore();
  }

  function correction() {
    correcting = true;
    root.querySelector('[data-caption]').hidden = false;
    common.invalidate();
    player.runTo(4, STEPS.length);
  }

  const common = setupCommon({ root, STEPS, METHOD_OF, caption, render, newAngle, newExercise, check, correction, ex, math, setMode });
  const { player, paintUI, paintScore } = common;

  function setMode(m) {
    mode = m;
    correcting = false;
    root.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    root.querySelector('[data-controls]').hidden = m !== 'anim';
    root.querySelector('[data-exo]').hidden = m !== 'exo';
    if (m === 'anim') {
      root.querySelector('[data-caption]').hidden = false;
      newAngle();
      player.restart();
    } else newExercise();
  }

  function newAngle(a, opts = {}) {
    S.a = a ?? params.angle ?? randInt(20, 160);
    S.r = opts.r ?? params.rotation ?? randInt(8, 22) * (Math.random() < 0.5 ? -1 : 1);
    S.inner = opts.inner ?? params.inner ?? Math.random() < 0.5;
    S.names = opts.names ?? NOMS[randInt(0, NOMS.length - 1)];
    S.rot0 = -Math.sign(S.r) * randInt(6, 12);
    build();
  }

  newAngle(params.angle ?? 52, { r: params.rotation ?? 14, inner: params.inner ?? true, names: ['A', 'O', 'B'] });
  render();
  setTimeout(() => player.play(), 400);
  return () => {
    player.stop();
    root.remove();
  };
}

// =====================================================================
//  Scène 2 — construire un angle
// =====================================================================
function construireAngle(el, params = {}, { math }) {
  const root = shell({
    exoTitre: 'À toi de construire',
    methode: [
      'Je trace un <b>premier côté</b> : une demi-droite dont l’origine est le <b>sommet</b>.',
      'Je place le <b>centre</b> du rapporteur sur le sommet et la <b>ligne du 0</b> sur ce côté.',
      'En partant du <b>0</b>, je repère la mesure voulue et je <b>marque un point</b> au bord du rapporteur.',
      'Je retire le rapporteur et je trace le <b>deuxième côté</b> à la règle, du sommet jusqu’au point.',
    ],
  });
  el.append(root);
  root.querySelector('[data-consigne]').hidden = false;

  const svg = root.querySelector('[data-scene]');
  const protLayer = svgEl('g', {}, svg);
  const angleLayer = svgEl('g', {}, svg);
  const toolLayer = svgEl('g', {}, svg);
  const hiLayer = svgEl('g', {}, svg);
  const pr = drawProtractor(protLayer);

  // la règle et le crayon, pour le tracé du deuxième côté
  const ruler = svgEl('g', {}, toolLayer);
  const pencil = svgEl('g', {}, toolLayer);
  (function drawPencil() {
    const g = svgEl('g', { transform: 'rotate(-55)' }, pencil);
    svgEl('polygon', { points: '0,0 17,-5.5 17,5.5', class: 'ag-pencil-wood' }, g);
    svgEl('polygon', { points: '0,0 6,-2 6,2', class: 'ag-pencil-lead' }, g);
    svgEl('rect', { x: 17, y: -5.5, width: 64, height: 11, class: 'ag-pencil-body' }, g);
    svgEl('rect', { x: 81, y: -5.5, width: 7, height: 11, class: 'ag-pencil-ferrule' }, g);
    svgEl('rect', { x: 88, y: -5.5, width: 10, height: 11, rx: 3, class: 'ag-pencil-eraser' }, g);
  })();

  const vertexRipple = svgEl('circle', { class: 'ag-ripple', cx: O.x, cy: O.y, r: 14 }, hiLayer);
  const sweepTxt = svgEl('text', { class: 'ag-sweeptxt', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, hiLayer);
  const dynLayer = svgEl('g', {}, hiLayer);

  // Le point que l'élève place lui-même, et son fantôme sous la souris.
  function makeStu(cls) {
    const g = svgEl('g', { class: 'ag-stu ' + cls }, hiLayer);
    const guide = svgEl('line', { class: 'guide' }, g);
    const x1 = svgEl('line', { class: 'x' }, g);
    const x2 = svgEl('line', { class: 'x' }, g);
    g.style.display = 'none';
    return { g, guide, x1, x2 };
  }
  const ghost = makeStu('ghost');
  const stu = makeStu('');
  function placeStu(s, phi) {
    const dir = S.r + phi;
    const c = P(O, dir, MARK);
    const e = P(O, dir, RAY);
    const k = 7;
    s.guide.setAttribute('x1', O.x);
    s.guide.setAttribute('y1', O.y);
    s.guide.setAttribute('x2', e.x);
    s.guide.setAttribute('y2', e.y);
    for (const [ln, sg] of [
      [s.x1, 1],
      [s.x2, -1],
    ]) {
      ln.setAttribute('x1', c.x - k);
      ln.setAttribute('y1', c.y - sg * k);
      ln.setAttribute('x2', c.x + k);
      ln.setAttribute('y2', c.y + sg * k);
    }
    s.g.style.display = '';
  }

  const STEPS = [
    { dur: 1300, name: 'Le premier côté' },
    { dur: 900, name: 'Le rapporteur' },
    { dur: 1900, name: 'Centre sur le sommet' },
    { dur: 1600, name: 'Le 0 sur le côté' },
    { dur: 1300, name: 'La bonne graduation' },
    { dur: 3000, name: 'Repérer et marquer' },
    { dur: 1300, name: 'Retirer le rapporteur' },
    { dur: 2600, name: 'Tracer à la règle' },
    { dur: 1200, name: 'Résultat' },
  ];
  const METHOD_OF = [0, -1, 1, 1, 1, 2, 3, 3, -1];

  const S = {};
  const D = {};
  const ex = { ok: 0, total: 0, counted: false, phase: 'off', phi: null, drag: false };
  let mode = 'anim';
  let correcting = false;

  function caption(i) {
    const [A, V, B] = S.names;
    const ANG = angleHtml(S.names);
    const a = S.a;
    const sc = S.inner ? '<span class="ag-blue">intérieure (en bleu)</span>' : '<span class="ag-red">extérieure (en rouge)</span>';
    const scS = S.inner ? '<span class="ag-blue">bleue</span>' : '<span class="ag-red">rouge</span>';
    switch (i) {
      case 0:
        return ['Étape 1 · Le premier côté', `On veut construire l’angle ${ANG} qui mesure <b>${a}°</b>. On commence par tracer un côté : la demi-droite [${V}${A}). Le point ${V} sera le <b>sommet</b>.`];
      case 1:
        return ['Le rapporteur', 'Le rapporteur a <b>deux graduations</b> de 0 à 180 : une <span class="ag-red">extérieure</span> et une <span class="ag-blue">intérieure</span>. Son <b>centre</b> est marqué par une petite croix, au milieu du côté plat.'];
      case 2:
        return ['Étape 2 · Le centre sur le sommet', `On fait glisser le rapporteur pour placer son <b>centre</b> exactement sur le point ${V}.`];
      case 3:
        return ['Étape 2 · Le 0 sur le côté', `On fait tourner le rapporteur autour de ${V} jusqu’à ce que la <b>ligne du 0</b> soit bien posée sur la demi-droite [${V}${A}).`];
      case 4:
        return ['Quelle graduation utiliser ?', `Sur le côté [${V}${A}), on voit le <b>0</b> de la graduation ${sc}. C’est sur <b>cette graduation-là</b> qu’on va compter. L’autre ne sert pas !`];
      case 5:
        return [`Étape 3 · Repérer ${a}° et marquer un point`, `On part du 0 et on suit la graduation ${scS} jusqu’à <b>${a}</b>. Juste au bord du rapporteur, en face de ${a}, on marque un point ${B} avec une petite croix.`];
      case 6:
        return ['On retire le rapporteur', `On enlève le rapporteur. Le point ${B} reste sur la feuille : c’est lui qui va nous guider.`];
      case 7:
        return ['Étape 4 · Tracer le deuxième côté', `On pose la règle pour qu’elle passe par ${V} et par ${B}, puis on trace la demi-droite [${V}${B}) <b>en partant du sommet</b> ${V}.`];
      default:
        return ['C’est construit !', `L’angle ${ANG} mesure bien <b>${a}°</b>. On peut le coder avec un petit arc.<br><span class="ag-check">✔ ${typeCheck(a)}</span><br><span class="muted small">💡 On aurait aussi pu le construire de l’autre côté de [${V}${A}) : il y a deux solutions !</span>`];
    }
  }

  function build() {
    const { a, r, inner } = S;
    D.ref = inner ? r : r + 180;
    D.oth = inner ? r + a : r + 180 - a;
    D.col = inner ? 'blue' : 'red';
    D.sr = inner ? IN_ARC - 12 : R + 30;
    angleLayer.innerHTML = '';
    dynLayer.innerHTML = '';
    ruler.innerHTML = '';

    D.code = svgEl('path', { class: 'ag-code' }, angleLayer);
    D.rayRef = svgEl('line', { class: 'ag-ray', x1: O.x, y1: O.y, x2: O.x, y2: O.y }, angleLayer);
    D.rayOth = svgEl('line', { class: 'ag-ray oth', x1: O.x, y1: O.y, x2: O.x, y2: O.y }, angleLayer);

    const pA = P(O, D.ref, PT);
    const pB = P(O, D.oth, MARK);
    D.ptA = svgEl('g', {}, angleLayer);
    cross(pA, D.ptA);
    pointLabel(P(pA, D.ref + (inner ? -90 : 90), 22), S.names[0], D.ptA);
    D.ptB = svgEl('g', {}, angleLayer);
    cross(pB, D.ptB, 'acc');
    pointLabel(P(pB, D.oth + (inner ? 90 : -90), 24), S.names[2], D.ptB);
    D.ptO = pointLabel(P(O, r - 90, 38), S.names[1], angleLayer);

    const z = pr.zeroPos[inner ? 'in' : 'out'];
    pr.zeroRing.setAttribute('cx', z.x);
    pr.zeroRing.setAttribute('cy', z.y);
    pr.zeroRing.setAttribute('class', 'ag-zero blink ' + D.col);
    pr.sweepArc.setAttribute('class', 'ag-sweep ' + D.col);

    // La règle : son bord passe par le sommet et le point, son corps reste à
    // l'extérieur de l'angle — comme on la pose vraiment sur la feuille.
    const sgn = inner ? -1 : 1;
    const W = 46;
    D.rulerSide = sgn;
    svgEl('rect', { class: 'ag-ruler', x: -34, y: sgn > 0 ? 0 : -W, width: 400, height: W, rx: 3 }, ruler);
    for (let x = -24, i = 0; x <= 356; x += 8, i++) {
      const len = i % 5 === 0 ? 13 : 6;
      svgEl('line', { class: 'ag-ruler-tick', x1: x, y1: 0, x2: x, y2: sgn * len }, ruler);
    }

    const bis = (D.ref + D.oth) / 2;
    D.bubble = bubble(dynLayer, P(O, bis, a < 45 ? 160 : 105), `${a}°`);

    root.querySelector('[data-consigne]').innerHTML = `<span class="ag-kicker">Consigne</span> Construire l’angle ${angleHtml(S.names)} de mesure ${a}°`;
    common?.invalidate();
  }

  function render() {
    const G = player.state.G;
    const g0 = ease(cl(G));
    const g1 = cl(G - 1);
    const g2 = ease(cl(G - 2));
    const g3 = ease(cl(G - 3));
    const g4 = cl(G - 4);
    const g5 = ease(cl((G - 5) / 0.8));
    const g6 = ease(cl(G - 6));
    const g8 = ease(cl(G - 8));
    const t7 = cl(G - 7);
    const hints = mode === 'anim' || correcting;

    const eR = P(O, D.ref, RAY * g0);
    D.rayRef.setAttribute('x2', eR.x);
    D.rayRef.setAttribute('y2', eR.y);
    D.ptA.style.opacity = cl((g0 - PT / RAY) * 8);
    D.ptO.style.opacity = cl(G * 4);
    D.rayRef.setAttribute('class', 'ag-ray' + (hints && G >= 3 && G < 6.5 ? ' ref-' + D.col : ''));

    // le rapporteur arrive, glisse, tourne, puis s'en va
    const x = lerp(START.x, O.x, g2) + 140 * g6;
    const y = lerp(START.y, O.y, g2) - 130 * g6;
    const rot = lerp(S.rot0, S.r, g3);
    pr.prot.setAttribute('transform', `translate(${x} ${y}) rotate(${-rot}) scale(${0.92 + 0.08 * g1})`);
    pr.prot.style.opacity = g1 * (1 - g6);
    pr.prot.style.display = G >= 7 ? 'none' : '';
    const pulse = hints && G > 1.4 && G < 3.15;
    pr.centerRipple.style.display = pulse ? '' : 'none';
    vertexRipple.style.display = pulse ? '' : 'none';
    pr.baseLine.setAttribute('class', 'ag-base' + (hints && G >= 3.4 ? ' on-' + D.col : ''));

    (S.inner ? pr.gOut : pr.gIn).style.opacity = hints ? 1 - 0.72 * g4 : 1;
    (S.inner ? pr.gIn : pr.gOut).style.opacity = 1;
    pr.zeroG.style.opacity = hints ? g4 : 0;

    sweep(pr, sweepTxt, root, { actif: hints && G > 5, a: S.a, t: g5, inner: S.inner, r: S.r, sr: D.sr, fade: g6, repli: G >= 6 ? `${S.a}°` : '' });

    D.ptB.style.opacity = cl((G - 5.85) * 7);

    // règle, crayon, deuxième côté
    const rIn = ease(cl(t7 / 0.25));
    const rOut = ease(cl((G - 8) / 0.5));
    ruler.style.opacity = rIn * (1 - rOut);
    ruler.style.display = G > 7 && G < 8.5 ? '' : 'none';
    const off = (1 - rIn) * 60 * D.rulerSide; // la règle arrive par l'extérieur
    const offP = P(ORIGIN, D.oth - 90, off);
    ruler.setAttribute('transform', `translate(${O.x + offP.x} ${O.y + offP.y}) rotate(${-D.oth})`);
    const kO = ease(cl((t7 - 0.3) / 0.6));
    const eO = P(O, D.oth, RAY * kO);
    D.rayOth.setAttribute('x2', eO.x);
    D.rayOth.setAttribute('y2', eO.y);
    D.rayOth.style.opacity = kO > 0 ? 1 : 0;
    D.rayOth.setAttribute('class', 'ag-ray' + (G < 8.6 ? ' oth' : ''));
    const pv = G > 7.25 && G < 7.97;
    pencil.style.display = pv ? '' : 'none';
    if (pv) pencil.setAttribute('transform', `translate(${eO.x} ${eO.y})`);

    D.code.setAttribute('d', g8 > 0 ? arcPath(O, 40, D.ref, S.inner ? D.ref + S.a * g8 : D.ref - S.a * g8) : '');
    D.bubble.style.opacity = g8;
    paintUI();
  }

  // ---------- exercice : placer le point ----------
  function newExercise() {
    newAngle(randInt(15, 165));
    player.goto(4);
    correcting = false;
    ex.phase = 'place';
    ex.phi = null;
    ex.counted = false;
    ex.drag = false;
    svg.classList.add('placing');
    ghost.g.style.display = 'none';
    stu.g.style.display = 'none';
    stu.g.setAttribute('class', 'ag-stu');
    root.querySelector('[data-caption]').hidden = true;
    const [A, V, B] = S.names;
    root.querySelector('[data-exo-body]').innerHTML =
      `<p>Le côté [${V}${A}) est tracé et le rapporteur est déjà placé. Place le point <b>${B}</b> pour que ${angleHtml(S.names)} = <b>${S.a}°</b>.</p>` +
      '<p class="muted small">👆 Clique (ou touche l’écran) au bord du rapporteur. Tu peux déplacer ton point autant que tu veux avant de valider.</p>';
    const fb = root.querySelector('[data-fb]');
    fb.hidden = true;
    root.querySelector('[data-act="corr"]').hidden = true;
  }

  function phiFromEvent(e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    let phi = (Math.atan2(O.y - p.y, p.x - O.x) * 180) / Math.PI - S.r;
    phi = ((phi + 540) % 360) - 180; // ramené entre -180 et 180
    if (phi < 0) phi = phi < -90 ? 180 : 0; // sous la ligne du 0 : on bloque aux extrémités
    return Math.round(phi);
  }
  const onMove = (e) => {
    if (ex.phase !== 'place') return;
    const phi = phiFromEvent(e);
    if (ex.drag) {
      ex.phi = phi;
      placeStu(stu, phi);
    } else if (e.pointerType === 'mouse') placeStu(ghost, phi);
  };
  const onLeave = () => {
    ghost.g.style.display = 'none';
  };
  const onDown = (e) => {
    if (ex.phase !== 'place') return;
    e.preventDefault();
    ex.drag = true;
    svg.setPointerCapture?.(e.pointerId);
    ex.phi = phiFromEvent(e);
    placeStu(stu, ex.phi);
  };
  const onUp = () => {
    ex.drag = false;
  };
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerleave', onLeave);
  svg.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);

  function check() {
    const fb = root.querySelector('[data-fb]');
    if (ex.phase !== 'place' || ex.phi == null) return showFb(fb, 'ko', 'Place d’abord ton point au bord du rapporteur.');
    const first = !ex.counted;
    if (first) {
      ex.counted = true;
      ex.total++;
    }
    const v = S.inner ? ex.phi : 180 - ex.phi; // mesure de l'angle construit
    const [A, V, B] = S.names;
    const indice = S.a < 90 ? 'Ici l’angle doit être <b>aigu</b> (moins de 90°).' : S.a > 90 ? 'Ici l’angle doit être <b>obtus</b> (plus de 90°).' : '';
    if (Math.abs(v - S.a) <= 1) {
      if (first) ex.ok++;
      showFb(fb, 'ok', `🎉 Bravo ! Le point ${B} est bien en face de la graduation ${S.a}. On retire le rapporteur et on trace [${V}${B}).`);
      ex.phase = 'done';
      svg.classList.remove('placing');
      ghost.g.style.display = 'none';
      stu.g.style.display = 'none';
      root.querySelector('[data-act="corr"]').hidden = true;
      player.runTo(6, STEPS.length); // on finit la construction devant lui
    } else if (Math.abs(v - (180 - S.a)) <= 1 && Math.abs(S.a - 90) > 3) {
      showFb(fb, 'ko', `Oups, tu as compté sur la <b>mauvaise graduation</b> : ton angle mesurerait ${180 - S.a}° ! Pars du <b>0</b> posé sur le côté [${V}${A}). ${indice}`);
      root.querySelector('[data-act="corr"]').hidden = false;
    } else if (Math.abs(v - S.a) <= 5) {
      showFb(fb, 'ko', `Presque ! Ton point est à ${Math.abs(v - S.a)}° de la bonne graduation. Regarde bien les petits traits : ils vont de 1 en 1.`);
      root.querySelector('[data-act="corr"]').hidden = false;
    } else {
      showFb(fb, 'ko', `Ce n’est pas ça. Pars du 0 posé sur le côté [${V}${A}) et compte jusqu’à ${S.a}. ${indice}`);
      root.querySelector('[data-act="corr"]').hidden = false;
    }
    paintScore();
  }

  function correction() {
    ex.phase = 'done';
    svg.classList.remove('placing');
    ghost.g.style.display = 'none';
    // On garde le point de l'élève en gris : il compare son geste au bon.
    if (ex.phi != null) stu.g.setAttribute('class', 'ag-stu grey');
    root.querySelector('[data-act="corr"]').hidden = true;
    correcting = true;
    root.querySelector('[data-caption]').hidden = false;
    common.invalidate();
    player.runTo(4, STEPS.length);
  }

  const common = setupCommon({ root, STEPS, METHOD_OF, caption, render, newAngle, newExercise, check, correction, ex, math, setMode });
  const { player, paintUI, paintScore } = common;

  function setMode(m) {
    mode = m;
    correcting = false;
    root.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    root.querySelector('[data-controls]').hidden = m !== 'anim';
    root.querySelector('[data-exo]').hidden = m !== 'exo';
    if (m === 'anim') {
      ex.phase = 'off';
      svg.classList.remove('placing');
      ghost.g.style.display = 'none';
      stu.g.style.display = 'none';
      root.querySelector('[data-caption]').hidden = false;
      newAngle();
      player.restart();
    } else newExercise();
  }

  function newAngle(a, opts = {}) {
    S.a = a ?? params.angle ?? randInt(20, 160);
    S.r = opts.r ?? params.rotation ?? randInt(8, 22) * (Math.random() < 0.5 ? -1 : 1);
    S.inner = opts.inner ?? params.inner ?? Math.random() < 0.5;
    S.names = opts.names ?? NOMS[randInt(0, NOMS.length - 1)];
    S.rot0 = -Math.sign(S.r) * randInt(6, 12);
    build();
  }

  newAngle(params.angle ?? 65, { r: params.rotation ?? 12, inner: params.inner ?? true, names: ['A', 'O', 'B'] });
  render();
  setTimeout(() => player.play(), 400);
  return () => {
    player.stop();
    svg.removeEventListener('pointermove', onMove);
    svg.removeEventListener('pointerleave', onLeave);
    svg.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointerup', onUp);
    root.remove();
  };
}

// ---------- morceaux partagés ----------

// La bulle du résultat : un rectangle ajusté au texte, pas une taille devinée.
function bubble(parent, pos, texte) {
  const g = svgEl('g', { class: 'ag-bubble' }, parent);
  const rect = svgEl('rect', { rx: 12 }, g);
  const t = svgEl('text', { x: pos.x, y: pos.y, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
  t.textContent = texte;
  const bb = t.getBBox();
  rect.setAttribute('x', bb.x - 12);
  rect.setAttribute('y', bb.y - 5);
  rect.setAttribute('width', bb.width + 24);
  rect.setAttribute('height', bb.height + 10);
  return g;
}

// Le balayage depuis le 0, avec le nombre de degrés qui défile. C'est le cœur
// de la démonstration : on compte, on ne lit pas un résultat tout fait.
function sweep(pr, sweepTxt, root, { actif, a, t, inner, r, sr, fade, repli }) {
  const readout = root.querySelector('[data-readout]');
  if (!actif) {
    pr.sweepArc.setAttribute('d', '');
    pr.sweepDot.style.display = 'none';
    sweepTxt.style.opacity = 0;
    readout.textContent = repli;
    return;
  }
  const s = a * t;
  pr.sweepArc.setAttribute('d', inner ? arcPath(ORIGIN, sr, 0, s) : arcPath(ORIGIN, sr, 180 - s, 180));
  const phi = inner ? s : 180 - s;
  const dp = lp(phi, sr);
  pr.sweepDot.setAttribute('cx', dp.x);
  pr.sweepDot.setAttribute('cy', dp.y);
  pr.sweepDot.style.display = '';
  const tp = P(O, r + phi, sr + (inner ? -26 : 24));
  sweepTxt.setAttribute('x', tp.x);
  sweepTxt.setAttribute('y', tp.y);
  sweepTxt.textContent = `${Math.round(s)}°`;
  sweepTxt.style.opacity = 1 - fade;
  readout.textContent = `${Math.round(s)}°`;
}

function showFb(el, kind, html) {
  el.className = `ag-fb ${kind}`;
  el.innerHTML = html;
  el.hidden = false;
}

// Le câblage identique des deux scènes : minuteur, boutons, pastilles
// d'étapes, légende, méthode surlignée, score.
function setupCommon({ root, STEPS, METHOD_OF, caption, render, newAngle, newExercise, check, correction, ex, math, setMode }) {
  const N = STEPS.length;
  const dots = root.querySelector('[data-dots]');
  STEPS.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ag-dot';
    b.textContent = i + 1;
    b.title = s.name;
    b.onclick = () => api.player.goto(i + 1);
    dots.append(b);
  });

  let lastKey = null;
  let lastLbl = '';
  function paintUI() {
    const G = api.player.state.G;
    const idx = Math.max(0, Math.min(N - 1, Math.ceil(G) - 1));
    const exoEnCours = !root.querySelector('[data-exo]').hidden && root.querySelector('[data-caption]').hidden;
    const mIdx = exoEnCours ? -1 : METHOD_OF[idx];
    const key = `${idx}/${mIdx}`;
    if (key !== lastKey) {
      lastKey = key;
      const [titre, texte] = caption(idx);
      root.querySelector('[data-captag]').textContent = `${idx + 1} / ${N}`;
      root.querySelector('[data-captitle]').textContent = titre;
      const p = root.querySelector('[data-captext]');
      p.innerHTML = texte;
      math?.(p);
      [...dots.children].forEach((d, i) => (d.className = 'ag-dot' + (i === idx ? ' cur' : i < idx ? ' done' : '')));
      [...root.querySelectorAll('[data-method] li')].forEach((li, i) => li.classList.toggle('on', mIdx === i));
    }
    const lbl = api.player.state.playing ? '⏸ Pause' : G >= N ? '↻ Revoir' : '▶ Lecture';
    if (lbl !== lastLbl) {
      root.querySelector('[data-act="play"]').textContent = lbl;
      lastLbl = lbl;
    }
    root.querySelector('[data-act="prev"]').disabled = G <= 1;
    root.querySelector('[data-act="next"]').disabled = G >= N;
  }

  function paintScore() {
    root.querySelector('[data-score]').textContent = ex.total ? `Réussis du premier coup : ${ex.ok} sur ${ex.total}` : '';
  }

  const player = createPlayer({ steps: STEPS, onFrame: render });
  // L'angle a changé : la légende doit être réécrite au prochain rendu, même si
  // l'étape affichée est la même.
  const invalidate = () => {
    lastKey = null;
  };
  const api = { player, paintUI, paintScore, invalidate };

  const actions = {
    play: () => player.toggle(),
    next: () => player.next(),
    prev: () => player.prev(),
    restart: () => player.restart(),
    rand: () => {
      newAngle();
      player.restart();
    },
    ok: () => {
      const input = root.querySelector('[data-custom]');
      const v = Math.round(parseFloat(String(input.value).replace(',', '.')));
      if (!(v >= 1 && v <= 179)) return input.focus();
      newAngle(v);
      player.restart();
    },
    check,
    corr: correction,
    again: newExercise,
  };
  root.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => actions[b.dataset.act]?.()));
  root.querySelector('[data-custom]').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') actions.ok();
  });
  const speed = root.querySelector('[data-speed]');
  speed.addEventListener('input', () => {
    player.state.speed = +speed.value;
    root.querySelector('[data-speedval]').textContent = `×${speed.value.replace('.', ',')}`;
  });
  root.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));

  return api;
}

export { mesurerAngle, construireAngle };
