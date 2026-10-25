// La droite des décimaux : encadrer, intercaler, arrondir.
//
// Trois gestes que les élèves confondent, et qui se jouent au même endroit —
// entre deux graduations. D'où une seule droite graduée, trois missions, et un
// zoom qui descend d'un rang à chaque fois qu'on en a besoin.
//
// Ce qui est voulu, et ce qui explique les choix :
//  · encadrer, c'est désigner un intervalle, pas choisir un nombre. L'élève
//    clique donc sur le segment, jamais sur une graduation.
//  · arrondir, c'est comparer au milieu. Le milieu est donc tracé, nommé, et
//    la bille roule vers la graduation choisie : juste, elle s'y pose ; faux,
//    elle revient. Le geste est jugé par le dessin, pas par un message.
//  · intercaler, c'est découvrir qu'il reste toujours de la place. Chaque
//    réponse juste rezoome d'un rang : on peut continuer indéfiniment.

const NS = 'http://www.w3.org/2000/svg';
const X0 = 46;
const X1 = 594;
const Y = 96;

const frDec = (x, d) => x.toFixed(d).replace('.', ',');
const puis = (n) => 10 ** n;
// Troncature et arrondi calculés sur des entiers : pas de surprise flottante.
const tronque = (x, d) => Math.floor(Math.round(x * puis(d + 3)) / 1000) / puis(d);
const arrondi = (x, d) => Math.round(Math.round(x * puis(d + 3)) / 1000) / puis(d);
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

const RANGS = [
  { dec: 0, nom: "à l'unité", pluriel: 'entiers', unite: 'une unité' },
  { dec: 1, nom: 'au dixième', pluriel: 'dixièmes', unite: 'un dixième' },
  { dec: 2, nom: 'au centième', pluriel: 'centièmes', unite: 'un centième' },
];

function h(s) {
  const t = document.createElement('template');
  t.innerHTML = s.trim();
  return t.content.firstElementChild;
}

// Un nombre à `dec + 2` décimales, avec deux contraintes :
//  · la dernière décimale n'est pas nulle, donc la décision ne tombe jamais
//    pile sur le milieu et l'arrondi n'a jamais deux réponses défendables ;
//  · le premier chiffre au-delà du rang va de 1 à 8, donc le point se place
//    entre 10 % et 89 % du segment : collé à une graduation, on ne verrait pas
//    de quel côté il tombe, et c'est justement ce qu'on demande de lire.
function tirerNombre(dec) {
  const chiffres = Array.from({ length: dec + 2 }, () => randInt(0, 9));
  chiffres[dec] = randInt(1, 8);
  if (chiffres[chiffres.length - 1] === 0) chiffres[chiffres.length - 1] = randInt(1, 9);
  return Number(`${randInt(1, 9)}.${chiffres.join('')}`);
}

// ---------- le plateau ----------
// Un cadre commun : l'énoncé, la droite, le score, et le bandeau de réussite.
function plateau(el, { titre, aide }) {
  const root = h(`<div class="widget w-dec">
    <p class="dec-quest" data-quest></p>
    <svg viewBox="0 0 640 170" class="wsvg" role="img" data-svg aria-label="${titre}"></svg>
    <p class="w-status" data-status></p>
    <div class="dec-bar">
      <span class="dec-score" data-score>0 point</span>
      <span class="dec-streak" data-streak hidden></span>
      <span class="muted small" data-aide>${aide}</span>
    </div>
    <div class="w-actions">
      <button type="button" class="btn ghost" data-next hidden>Question suivante →</button>
      <button type="button" class="btn ghost" data-replay hidden>Recommencer</button>
    </div>
    <div class="dec-pops" data-pops aria-hidden="true"></div>
  </div>`);
  el.append(root);
  const svg = root.querySelector('[data-svg]');
  const api = {
    root,
    svg,
    points: 0,
    serie: 0,
    quest: (html) => (root.querySelector('[data-quest]').innerHTML = html),
    status: (html) => (root.querySelector('[data-status]').innerHTML = html),
    // Le « +10 » qui s'envole : le point gagné doit se voir, pas se lire.
    pop(texte, bon = true) {
      const p = document.createElement('span');
      p.className = `dec-pop${bon ? '' : ' ko'}`;
      p.textContent = texte;
      p.style.left = `${20 + Math.random() * 60}%`;
      root.querySelector('[data-pops]').append(p);
      setTimeout(() => p.remove(), 1200);
    },
    gagner(n) {
      api.serie++;
      const bonus = api.serie >= 3 ? Math.min(10, (api.serie - 2) * 2) : 0;
      api.points += n + bonus;
      api.pop(`+${n + bonus}`);
      root.querySelector('[data-score]').textContent = `${api.points} point${api.points > 1 ? 's' : ''}`;
      const st = root.querySelector('[data-streak]');
      st.hidden = api.serie < 3;
      st.textContent = `🔥 ${api.serie} de suite${bonus ? ` · +${bonus} de bonus` : ''}`;
      return bonus;
    },
    rater() {
      api.serie = 0;
      root.querySelector('[data-streak]').hidden = true;
      api.pop('✗', false);
    },
  };
  return api;
}

// La droite graduée : axe, graduations, étiquettes, et les segments cliquables.
// `interactif` dit si l'élève peut cliquer un segment ou une graduation.
function dessinerDroite(svg, { a, b, dec, zones = 0, marques = false }) {
  const pas = (b - a) / 10;
  const decAff = Math.max(dec, 0);
  const xOf = (v) => X0 + ((v - a) / (b - a)) * (X1 - X0);
  let s = `<line x1="${X0 - 14}" y1="${Y}" x2="${X1 + 14}" y2="${Y}" class="axis"/>
    <path d="M ${X1 + 14} ${Y} l -12 -5 l 0 10 Z" class="arrowhead"/>`;
  for (let i = 0; i < zones; i++) {
    const v = a + i * pas;
    s += `<rect class="zone dec-zone" x="${xOf(v)}" y="${Y - 34}" width="${xOf(v + pas) - xOf(v)}" height="68" data-i="${i}"
      tabindex="0" role="button" aria-label="Entre ${frDec(v, decAff)} et ${frDec(v + pas, decAff)}"/>`;
  }
  for (let i = 0; i <= 10; i++) {
    const v = a + i * pas;
    const gros = i % 5 === 0;
    s += `<line x1="${xOf(v)}" y1="${Y - (gros ? 15 : 9)}" x2="${xOf(v)}" y2="${Y + (gros ? 15 : 9)}" class="tick${gros ? ' big' : ''}"/>`;
    if (gros || dec <= 1) s += `<text x="${xOf(v)}" y="${Y + 38}" class="tlabel${gros ? ' strong' : ' small'}">${frDec(v, decAff)}</text>`;
    if (marques) {
      s += `<circle class="dec-cible" cx="${xOf(v)}" cy="${Y}" r="13" data-g="${i}" tabindex="0" role="button" aria-label="${frDec(v, decAff)}"/>`;
    }
  }
  svg.innerHTML = s;
  return { xOf, pas };
}

function ajouter(svg, tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  svg.append(e);
  return e;
}

// ---------- mission : encadrer ----------
function missionEncadrer(jeu, fini) {
  const rang = RANGS[randInt(0, 2)];
  const x = tirerNombre(rang.dec);
  const bas = tronque(x, rang.dec);
  const a = rang.dec === 0 ? Math.floor(x / 10) * 10 : tronque(x, rang.dec - 1);
  const b = +(a + 10 / puis(rang.dec)).toFixed(rang.dec + 1);
  const bonne = Math.round((bas - a) * puis(rang.dec));

  jeu.quest(`Entre quels <b>${rang.pluriel} consécutifs</b> se trouve <strong class="dec-num">${frDec(x, rang.dec + 2)}</strong> ?
    <span class="muted small">Clique sur le bon <b>segment</b> — pas sur une graduation.</span>`);
  const { xOf } = dessinerDroite(jeu.svg, { a, b, dec: rang.dec, zones: 10 });
  const bille = ajouter(jeu.svg, 'circle', { class: 'target dec-bille', cx: xOf(x), cy: Y, r: 8 });
  ajouter(jeu.svg, 'text', { x: xOf(x), y: Y - 46, class: 'tlabel strong dec-flot' }).textContent = frDec(x, rang.dec + 2);
  jeu.status(`La droite est graduée ${rang.nom} : d’une graduation à la suivante, il y a ${rang.unite}.`);

  const choisir = (i) => {
    const d1 = +(a + i / puis(rang.dec)).toFixed(rang.dec);
    const d2 = +(d1 + 1 / puis(rang.dec)).toFixed(rang.dec);
    if (i === bonne) {
      jeu.gagner(10);
      jeu.svg.querySelector(`.dec-zone[data-i="${i}"]`).classList.add('juste');
      bille.classList.add('pose');
      jeu.status(`✔ Oui : $${frDec(d1, rang.dec)} < ${frDec(x, rang.dec + 2)} < ${frDec(d2, rang.dec)}$. Encadrer, c’est donner les <b>deux voisins</b>, pas le plus proche.`);
      fini(true);
    } else {
      jeu.rater();
      const z = jeu.svg.querySelector(`.dec-zone[data-i="${i}"]`);
      z.classList.add('faux');
      setTimeout(() => z.classList.remove('faux'), 700);
      jeu.status(`✗ Dans ce segment on a $${frDec(d1, rang.dec)} < \\ldots < ${frDec(d2, rang.dec)}$, et ${frDec(x, rang.dec + 2)} n’y est pas. Regarde où est la bille.`);
    }
  };
  return { choisir, type: 'zone' };
}

// ---------- mission : arrondir ----------
function missionArrondir(jeu, fini) {
  const rang = RANGS[randInt(0, 2)];
  const x = tirerNombre(rang.dec);
  const bas = tronque(x, rang.dec);
  const haut = +(bas + 1 / puis(rang.dec)).toFixed(rang.dec);
  const milieu = (bas + haut) / 2;
  const bonne = arrondi(x, rang.dec);

  // On zoome sur le seul intervalle qui compte : les deux voisins et le milieu.
  const marge = (haut - bas) * 0.18;
  const a = bas - marge;
  const b = haut + marge;
  const xOf = (v) => X0 + ((v - a) / (b - a)) * (X1 - X0);

  jeu.quest(`Arrondis <strong class="dec-num">${frDec(x, rang.dec + 2)}</strong> <b>${rang.nom}</b>.
    <span class="muted small">Clique sur la graduation la plus proche.</span>`);
  jeu.svg.innerHTML = `<line x1="${X0 - 14}" y1="${Y}" x2="${X1 + 14}" y2="${Y}" class="axis"/>
    <line x1="${xOf(milieu)}" y1="${Y - 42}" x2="${xOf(milieu)}" y2="${Y + 30}" class="dec-milieu"/>
    <text x="${xOf(milieu)}" y="${Y + 48}" class="tlabel small">milieu ${frDec(milieu, rang.dec + 1)}</text>
    ${[bas, haut]
      .map(
        (v) => `<line x1="${xOf(v)}" y1="${Y - 17}" x2="${xOf(v)}" y2="${Y + 17}" class="tick big"/>
        <text x="${xOf(v)}" y="${Y + 40}" class="tlabel strong">${frDec(v, rang.dec)}</text>
        <circle class="dec-cible" cx="${xOf(v)}" cy="${Y}" r="17" data-v="${v}" tabindex="0" role="button" aria-label="${frDec(v, rang.dec)}"/>`
      )
      .join('')}`;
  const bille = ajouter(jeu.svg, 'circle', { class: 'target dec-bille', cx: xOf(x), cy: Y, r: 9 });
  const etiq = ajouter(jeu.svg, 'text', { x: xOf(x), y: Y - 52, class: 'tlabel strong dec-flot' });
  etiq.textContent = frDec(x, rang.dec + 2);
  jeu.status(`${frDec(x, rang.dec + 2)} est entre ${frDec(bas, rang.dec)} et ${frDec(haut, rang.dec)}. De quel côté du milieu se trouve-t-il ?`);

  const choisir = (v) => {
    if (Math.abs(v - bonne) < 1e-9) {
      jeu.gagner(10);
      // La bille roule jusqu'à la graduation choisie : le geste se voit.
      // On déplace par transform, animable partout, plutôt que par cx.
      bille.style.transition = 'transform .55s cubic-bezier(.3,1.4,.5,1)';
      bille.style.transform = `translate(${xOf(v) - xOf(x)}px, 0)`;
      etiq.style.transition = 'opacity .3s';
      etiq.style.opacity = 0.25;
      bille.classList.add('pose');
      jeu.status(`✔ ${frDec(x, rang.dec + 2)} est ${x < milieu ? 'avant' : 'après'} le milieu ${frDec(milieu, rang.dec + 1)}, donc l’arrondi ${rang.nom} est <b>${frDec(bonne, rang.dec)}</b>.`);
      fini(true);
    } else {
      jeu.rater();
      bille.classList.add('rate');
      setTimeout(() => bille.classList.remove('rate'), 600);
      jeu.status(`✗ Compare au <b>milieu</b> : ${frDec(x, rang.dec + 2)} est ${x < milieu ? 'avant' : 'après'} ${frDec(milieu, rang.dec + 1)}. L’arrondi, c’est le plus proche — pas celui qu’on obtient en effaçant les chiffres.`);
    }
  };
  return { choisir, type: 'cible' };
}

// ---------- mission : intercaler ----------
function missionIntercaler(jeu, fini) {
  const dec = randInt(0, 1);
  const bas = dec === 0 ? randInt(1, 20) : +(randInt(10, 90) / 10).toFixed(1);
  const haut = +(bas + 1 / puis(dec)).toFixed(dec);

  jeu.quest(`Trouve un nombre décimal <b>strictement entre</b> <strong class="dec-num">${frDec(bas, dec)}</strong> et <strong class="dec-num">${frDec(haut, dec)}</strong>.
    <span class="muted small">On a zoomé : il y a dix fois plus de graduations qu’avant. Clique sur l’une d’elles.</span>`);
  const { xOf } = dessinerDroite(jeu.svg, { a: bas, b: haut, dec: dec + 1, marques: true });
  jeu.status(`Entre ${frDec(bas, dec)} et ${frDec(haut, dec)}, on a découpé en dix : chaque graduation vaut ${dec === 0 ? 'un dixième' : 'un centième'}.`);

  const choisir = (i) => {
    const v = +(bas + i / puis(dec + 1)).toFixed(dec + 1);
    if (i === 0 || i === 10) {
      jeu.rater();
      jeu.status(`✗ ${frDec(v, dec + 1)} est une des deux <b>bornes</b>. « Strictement entre » veut dire qu’on ne les prend pas.`);
      return;
    }
    jeu.gagner(10);
    ajouter(jeu.svg, 'circle', { class: 'target dec-bille pose', cx: xOf(v), cy: Y, r: 9 });
    ajouter(jeu.svg, 'text', { x: xOf(v), y: Y - 46, class: 'tlabel strong dec-flot' }).textContent = frDec(v, dec + 1);
    jeu.status(`✔ $${frDec(bas, dec)} < ${frDec(v, dec + 1)} < ${frDec(haut, dec)}$. Et on pourrait rezoomer entre ${frDec(bas, dec)} et ${frDec(v, dec + 1)} : il y a <b>toujours</b> de la place.`);
    fini(true);
  };
  return { choisir, type: 'cible-index' };
}

// ---------- assemblage ----------
const MISSIONS = { encadrer: missionEncadrer, arrondir: missionArrondir, intercaler: missionIntercaler };

function faireWidget(mission, { titre, aide, total = 0 }) {
  return function monter(el, params = {}, { math } = {}) {
    const jeu = plateau(el, { titre, aide });
    const suite = params.questions ?? total;
    const choix = params.mission === 'melange' || mission === 'melange' ? ['encadrer', 'arrondir', 'intercaler'] : [mission];
    let n = 0;
    let courant = null;
    const nextBtn = jeu.root.querySelector('[data-next]');
    const replayBtn = jeu.root.querySelector('[data-replay]');

    const rendreMath = () => {
      math?.(jeu.root.querySelector('[data-quest]'));
      math?.(jeu.root.querySelector('[data-status]'));
    };

    function question() {
      n++;
      nextBtn.hidden = true;
      replayBtn.hidden = true;
      const nom = choix[Math.floor(Math.random() * choix.length)];
      courant = MISSIONS[nom](jeu, (ok) => {
        if (!ok) return;
        courant = null;
        if (suite && n >= suite) {
          jeu.status(`${jeu.root.querySelector('[data-status]').innerHTML}<br><b>Défi terminé : ${jeu.points} points en ${suite} questions.</b>`);
          replayBtn.hidden = false;
        } else nextBtn.hidden = false;
        rendreMath();
      });
      if (suite) jeu.root.querySelector('[data-aide]').textContent = `Question ${n} sur ${suite}`;
      rendreMath();
    }

    // Un seul écouteur, posé sur le dessin : les cibles changent à chaque question.
    const onClick = (e) => {
      if (!courant) return;
      const z = e.target.closest?.('.dec-zone, .dec-cible');
      if (!z) return;
      if (courant.type === 'zone' && z.dataset.i !== undefined) courant.choisir(Number(z.dataset.i));
      else if (courant.type === 'cible' && z.dataset.v !== undefined) courant.choisir(Number(z.dataset.v));
      else if (courant.type === 'cible-index' && z.dataset.g !== undefined) courant.choisir(Number(z.dataset.g));
    };
    const onKey = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (!e.target.closest?.('.dec-zone, .dec-cible')) return;
      e.preventDefault();
      onClick(e);
    };
    jeu.svg.addEventListener('click', onClick);
    jeu.svg.addEventListener('keydown', onKey);
    nextBtn.onclick = question;
    replayBtn.onclick = () => {
      n = 0;
      jeu.points = 0;
      jeu.serie = 0;
      jeu.root.querySelector('[data-score]').textContent = '0 point';
      question();
    };

    question();
    return () => jeu.root.remove();
  };
}

export const encadrerDecimal = faireWidget('encadrer', {
  titre: 'Encadrer un décimal sur la droite graduée',
  aide: 'Clique sur le segment qui contient le nombre.',
});
export const arrondirDecimal = faireWidget('arrondir', {
  titre: 'Arrondir un décimal',
  aide: 'La bille roule vers la graduation que tu choisis.',
});
export const intercalerDecimal = faireWidget('intercaler', {
  titre: 'Intercaler un décimal',
  aide: 'Il y a toujours de la place entre deux décimaux.',
});
export const defiDecimaux = faireWidget('melange', {
  titre: 'Défi : encadrer, arrondir, intercaler',
  aide: 'Dix questions mélangées. Trois bonnes réponses de suite : bonus.',
  total: 10,
});
