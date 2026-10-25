// La droite des décimaux : encadrer, intercaler, arrondir.
//
// Trois gestes que les élèves de 6e confondent, et qui se jouent au même
// endroit — entre deux graduations voisines. Le dessin sert d'appui : il montre
// où tombe le nombre, mais c'est l'élève qui écrit la réponse au clavier.
// Rien ne se répond en cliquant, parce que ce qu'on veut installer, c'est
// l'écriture : « 7 < 7,4 < 8 », pas la désignation d'une zone.
//
// Un rang par animation, et deux rangs seulement — l'unité et le dixième.
// Le centième viendra plus tard : au moment où l'on apprend ces gestes, il
// ajoute de la difficulté de lecture sans rien apprendre de nouveau.
//
// Ce qui est voulu, et ce qui explique les choix :
//  · encadrer, c'est écrire les DEUX voisins, pas choisir le plus proche :
//    d'où les deux champs de part et d'autre du nombre.
//  · arrondir, c'est comparer au milieu : le milieu est tracé et nommé, et la
//    bille roule jusqu'à la graduation écrite.
//  · intercaler, c'est découvrir qu'il reste toujours de la place : chaque
//    réponse juste est posée sur la droite zoomée.

const NS = 'http://www.w3.org/2000/svg';
const X0 = 48;
const X1 = 592;
const Y = 92;

const frDec = (x, d) => x.toFixed(d).replace('.', ',');
const puis = (n) => 10 ** n;
// Troncature et arrondi calculés sur des entiers : pas de surprise flottante.
const tronque = (x, d) => Math.floor(Math.round(x * puis(d + 3)) / 1000) / puis(d);
const arrondi = (x, d) => Math.round(Math.round(x * puis(d + 3)) / 1000) / puis(d);
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

// Les deux seuls rangs travaillés ici.
const RANGS = {
  unite: { dec: 0, nom: "à l'unité", pluriel: 'entiers', unite: 'une unité' },
  dixieme: { dec: 1, nom: 'au dixième', pluriel: 'dixièmes', unite: 'un dixième' },
};

// Lit un nombre tapé par un élève : « 3,5 », « 3.5 », « 7 ».
function lireNombre(txt) {
  const s = String(txt).trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

function h(s) {
  const t = document.createElement('template');
  t.innerHTML = s.trim();
  return t.content.firstElementChild;
}
function ajouter(svg, tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  svg.append(e);
  return e;
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
// Le cadre commun : l'énoncé, la droite, la zone de réponse, le score.
function plateau(el, { titre, aide }) {
  const root = h(`<div class="widget w-dec">
    <p class="dec-quest" data-quest></p>
    <svg viewBox="0 0 640 150" class="wsvg" role="img" data-svg aria-label="${titre}"></svg>
    <form class="dec-form" data-form><div class="dec-champs" data-champs></div>
      <button type="submit" class="btn" data-check>Vérifier</button>
      <button type="button" class="btn ghost" data-next hidden>Question suivante →</button>
      <button type="button" class="btn ghost" data-replay hidden>Recommencer</button>
    </form>
    <p class="w-status" data-status></p>
    <div class="dec-bar">
      <span class="dec-score" data-score>0 point</span>
      <span class="dec-streak" data-streak hidden></span>
      <span class="muted small" data-aide>${aide}</span>
    </div>
    <div class="dec-pops" data-pops aria-hidden="true"></div>
  </div>`);
  el.append(root);
  const api = {
    root,
    svg: root.querySelector('[data-svg]'),
    points: 0,
    serie: 0,
    quest: (html) => (root.querySelector('[data-quest]').innerHTML = html),
    status: (html) => (root.querySelector('[data-status]').innerHTML = html),
    champs: (html) => (root.querySelector('[data-champs]').innerHTML = html),
    // Le « +10 » qui s'envole : le point gagné doit se voir, pas se lire.
    pop(texte, bon = true) {
      const p = document.createElement('span');
      p.className = `dec-pop${bon ? '' : ' ko'}`;
      p.textContent = texte;
      p.style.left = `${20 + Math.random() * 60}%`;
      root.querySelector('[data-pops]').append(p);
      setTimeout(() => p.remove(), 1200);
    },
    gagner(n = 10) {
      api.serie++;
      const bonus = api.serie >= 3 ? Math.min(10, (api.serie - 2) * 2) : 0;
      api.points += n + bonus;
      api.pop(`+${n + bonus}`);
      root.querySelector('[data-score]').textContent = `${api.points} point${api.points > 1 ? 's' : ''}`;
      const st = root.querySelector('[data-streak]');
      st.hidden = api.serie < 3;
      st.textContent = `🔥 ${api.serie} de suite${bonus ? ` · +${bonus} de bonus` : ''}`;
    },
    rater() {
      api.serie = 0;
      root.querySelector('[data-streak]').hidden = true;
      api.pop('✗', false);
    },
  };
  return api;
}

// La droite graduée : axe, graduations, étiquettes. Rien n'y est cliquable.
//
// `decBornes` sert quand on a zoomé : les deux extrémités portent alors
// l'écriture de l'énoncé (« 4,0 » et « 4,1 ») et non celle des graduations
// intermédiaires (« 4,00 »), qui ferait douter qu'on parle du même nombre.
function dessinerDroite(svg, { a, b, dec, pasLabel = 1, decBornes = dec }) {
  const pas = (b - a) / 10;
  const xOf = (v) => X0 + ((v - a) / (b - a)) * (X1 - X0);
  let s = `<line x1="${X0 - 14}" y1="${Y}" x2="${X1 + 14}" y2="${Y}" class="axis"/>
    <path d="M ${X1 + 14} ${Y} l -12 -5 l 0 10 Z" class="arrowhead"/>`;
  for (let i = 0; i <= 10; i++) {
    const v = a + i * pas;
    const gros = i % 5 === 0;
    const borne = i === 0 || i === 10;
    s += `<line x1="${xOf(v)}" y1="${Y - (gros ? 15 : 9)}" x2="${xOf(v)}" y2="${Y + (gros ? 15 : 9)}" class="tick${gros ? ' big' : ''}"/>`;
    if (i % pasLabel === 0 || gros) {
      s += `<text x="${xOf(v)}" y="${Y + 36}" class="tlabel${gros ? ' strong' : ' small'}">${frDec(v, borne ? decBornes : dec)}</text>`;
    }
  }
  svg.innerHTML = s;
  return { xOf, pas };
}

// Le nombre posé sur la droite, avec son étiquette.
function poserBille(svg, xOf, valeur, dec, classe = '') {
  const bille = ajouter(svg, 'circle', { class: `target dec-bille ${classe}`, cx: xOf(valeur), cy: Y, r: 8 });
  const etiq = ajouter(svg, 'text', { x: xOf(valeur), y: Y - 34, class: 'tlabel strong dec-flot' });
  etiq.textContent = frDec(valeur, dec);
  return { bille, etiq };
}

// ---------- mission : encadrer ----------
// Deux champs de part et d'autre du nombre : c'est exactement ce qu'on écrit
// dans le cahier, et cela interdit de ne donner qu'une seule borne.
function missionEncadrer(jeu, rang) {
  const { dec } = rang;
  const x = tirerNombre(dec);
  const bas = tronque(x, dec);
  const haut = +(bas + 1 / puis(dec)).toFixed(dec);
  const a = dec === 0 ? Math.floor(x / 10) * 10 : tronque(x, 0);
  const b = +(a + 10 / puis(dec)).toFixed(dec + 1);

  jeu.quest(`Encadre <strong class="dec-num">${frDec(x, dec + 2)}</strong> par deux <b>${rang.pluriel} consécutifs</b>.`);
  const { xOf } = dessinerDroite(jeu.svg, { a, b, dec, pasLabel: dec === 0 ? 1 : 5 });
  poserBille(jeu.svg, xOf, x, dec + 2);
  jeu.champs(`<label class="sr" for="dec-bas">Nombre de gauche</label>
    <input id="dec-bas" data-rep="bas" inputmode="decimal" autocomplete="off" size="5">
    <span class="dec-cmp">&lt;</span><strong class="dec-num">${frDec(x, dec + 2)}</strong><span class="dec-cmp">&lt;</span>
    <label class="sr" for="dec-haut">Nombre de droite</label>
    <input id="dec-haut" data-rep="haut" inputmode="decimal" autocomplete="off" size="5">`);
  jeu.status(`La droite est graduée ${rang.nom} : d’une graduation à la suivante, il y a ${rang.unite}.`);

  return {
    verifier(lire) {
      const g = lireNombre(lire('bas'));
      const d = lireNombre(lire('haut'));
      if (g === null || d === null) return { ok: false, message: 'Écris un nombre dans chaque case.' };
      if (g === bas && d === haut) {
        jeu.svg.querySelector('.dec-bille').classList.add('pose');
        return { ok: true, message: `Oui : $${frDec(bas, dec)} < ${frDec(x, dec + 2)} < ${frDec(haut, dec)}$. Encadrer, c’est donner les <b>deux voisins</b> — pas le plus proche.` };
      }
      if (g === haut && d === bas) return { ok: false, message: 'Les deux nombres sont les bons, mais dans le mauvais sens : le plus petit est à gauche.' };
      if (g > x || d < x) return { ok: false, message: `Ton encadrement ne contient pas ${frDec(x, dec + 2)}. Regarde où est la bille sur la droite.` };
      if (+(d - g).toFixed(dec + 2) !== +(1 / puis(dec)).toFixed(dec + 2)) {
        return { ok: false, message: `C’est vrai, mais ce ne sont pas deux ${rang.pluriel} <b>consécutifs</b> : il doit y avoir ${rang.unite} d’écart entre tes deux nombres.` };
      }
      return { ok: false, message: `Pas tout à fait. Garde les chiffres jusqu’au rang demandé, puis ajoute ${rang.unite}.` };
    },
  };
}

// ---------- mission : arrondir ----------
function missionArrondir(jeu, rang) {
  const { dec } = rang;
  const x = tirerNombre(dec);
  const bas = tronque(x, dec);
  const haut = +(bas + 1 / puis(dec)).toFixed(dec);
  const milieu = (bas + haut) / 2;
  const bonne = arrondi(x, dec);

  // On zoome sur le seul intervalle qui compte : les deux voisins et le milieu.
  const marge = (haut - bas) * 0.18;
  const a = bas - marge;
  const b = haut + marge;
  const xOf = (v) => X0 + ((v - a) / (b - a)) * (X1 - X0);

  jeu.quest(`Arrondis <strong class="dec-num">${frDec(x, dec + 2)}</strong> <b>${rang.nom}</b>.`);
  jeu.svg.innerHTML = `<line x1="${X0 - 14}" y1="${Y}" x2="${X1 + 14}" y2="${Y}" class="axis"/>
    <line x1="${xOf(milieu)}" y1="${Y - 40}" x2="${xOf(milieu)}" y2="${Y + 28}" class="dec-milieu"/>
    <text x="${xOf(milieu)}" y="${Y + 46}" class="tlabel small">milieu ${frDec(milieu, dec + 1)}</text>
    ${[bas, haut]
      .map(
        (v) => `<line x1="${xOf(v)}" y1="${Y - 17}" x2="${xOf(v)}" y2="${Y + 17}" class="tick big"/>
        <text x="${xOf(v)}" y="${Y + 38}" class="tlabel strong">${frDec(v, dec)}</text>`
      )
      .join('')}`;
  const { bille, etiq } = poserBille(jeu.svg, xOf, x, dec + 2);
  jeu.champs(`<label for="dec-rep">Arrondi ${rang.nom}</label>
    <input id="dec-rep" data-rep="v" inputmode="decimal" autocomplete="off" size="6">`);
  jeu.status(`${frDec(x, dec + 2)} est entre ${frDec(bas, dec)} et ${frDec(haut, dec)}. De quel côté du milieu se trouve-t-il ?`);

  return {
    verifier(lire) {
      const v = lireNombre(lire('v'));
      if (v === null) return { ok: false, message: 'Écris un nombre.' };
      if (Math.abs(v - bonne) < 1e-9) {
        // La bille roule jusqu'à la graduation écrite : le geste se voit.
        bille.style.transition = 'transform .55s cubic-bezier(.3,1.4,.5,1)';
        bille.style.transform = `translate(${xOf(bonne) - xOf(x)}px, 0)`;
        bille.classList.add('pose');
        etiq.style.transition = 'opacity .3s';
        etiq.style.opacity = 0.3;
        return { ok: true, message: `${frDec(x, dec + 2)} est ${x < milieu ? 'avant' : 'après'} le milieu ${frDec(milieu, dec + 1)}, donc l’arrondi ${rang.nom} est <b>${frDec(bonne, dec)}</b>.` };
      }
      bille.classList.add('rate');
      setTimeout(() => bille.classList.remove('rate'), 600);
      if (Math.abs(v - (bonne === bas ? haut : bas)) < 1e-9) {
        return { ok: false, message: `C’est l’autre voisin. Compare au <b>milieu</b> : ${frDec(x, dec + 2)} est ${x < milieu ? 'avant' : 'après'} ${frDec(milieu, dec + 1)}.` };
      }
      if (Math.abs(v - tronque(x, dec)) < 1e-9) {
        return { ok: false, message: 'Là tu as <b>tronqué</b> : tu as effacé les chiffres qui dépassent. Arrondir, c’est garder le plus proche.' };
      }
      return { ok: false, message: `Ta réponse doit être ${frDec(bas, dec)} ou ${frDec(haut, dec)} : ce sont les deux ${rang.pluriel} qui encadrent ${frDec(x, dec + 2)}.` };
    },
  };
}

// ---------- mission : intercaler ----------
function missionIntercaler(jeu, rang) {
  const { dec } = rang;
  const bas = dec === 0 ? randInt(1, 20) : +(randInt(10, 90) / 10).toFixed(1);
  const haut = +(bas + 1 / puis(dec)).toFixed(dec);

  jeu.quest(`Trouve un nombre décimal <b>strictement entre</b> <strong class="dec-num">${frDec(bas, dec)}</strong> et <strong class="dec-num">${frDec(haut, dec)}</strong>.`);
  const { xOf } = dessinerDroite(jeu.svg, { a: bas, b: haut, dec: dec + 1, decBornes: dec, pasLabel: dec === 0 ? 1 : 5 });
  jeu.champs(`<label for="dec-rep">Mon nombre</label>
    <input id="dec-rep" data-rep="v" inputmode="decimal" autocomplete="off" size="7">`);
  jeu.status(`On a zoomé : entre ${frDec(bas, dec)} et ${frDec(haut, dec)}, on a découpé en dix. Chaque graduation vaut ${dec === 0 ? 'un dixième' : 'un centième'}.`);

  return {
    verifier(lire) {
      const v = lireNombre(lire('v'));
      if (v === null) return { ok: false, message: 'Écris un nombre, avec une virgule si besoin.' };
      if (v === bas || v === haut) return { ok: false, message: `${frDec(v, dec + 1)} est une des deux <b>bornes</b>. « Strictement entre » veut dire qu’on ne les prend pas.` };
      if (v < bas || v > haut) return { ok: false, message: `${frDec(v, dec + 1)} est en dehors. Il faut rester entre ${frDec(bas, dec)} et ${frDec(haut, dec)}.` };
      poserBille(jeu.svg, xOf, v, dec + 1, 'pose');
      return {
        ok: true,
        message: `$${frDec(bas, dec)} < ${frDec(v, dec + 1)} < ${frDec(haut, dec)}$. Et on pourrait rezoomer entre ${frDec(bas, dec)} et ${frDec(v, dec + 1)} : il y a <b>toujours</b> de la place.`,
      };
    },
  };
}

// ---------- assemblage ----------
const MISSIONS = { encadrer: missionEncadrer, arrondir: missionArrondir, intercaler: missionIntercaler };

function faireWidget(mission, rangId, { titre, aide, total = 0 }) {
  return function monter(el, params = {}, { math } = {}) {
    const jeu = plateau(el, { titre, aide });
    const suite = params.questions ?? total;
    const choix = mission === 'melange' ? ['encadrer', 'arrondir', 'intercaler'] : [mission];
    const rangs = rangId === 'melange' ? ['unite', 'dixieme'] : [rangId];
    let n = 0;
    let courant = null;
    const form = jeu.root.querySelector('[data-form]');
    const checkBtn = jeu.root.querySelector('[data-check]');
    const nextBtn = jeu.root.querySelector('[data-next]');
    const replayBtn = jeu.root.querySelector('[data-replay]');

    const rendreMath = () => {
      math?.(jeu.root.querySelector('[data-quest]'));
      math?.(jeu.root.querySelector('[data-status]'));
    };
    const lire = (nom) => jeu.root.querySelector(`[data-rep="${nom}"]`)?.value ?? '';

    function question() {
      n++;
      checkBtn.hidden = false;
      nextBtn.hidden = true;
      replayBtn.hidden = true;
      const quoi = choix[Math.floor(Math.random() * choix.length)];
      const rang = RANGS[rangs[Math.floor(Math.random() * rangs.length)]];
      courant = MISSIONS[quoi](jeu, rang);
      if (suite) jeu.root.querySelector('[data-aide]').textContent = `Question ${n} sur ${suite}`;
      rendreMath();
      jeu.root.querySelector('[data-rep]')?.focus();
    }

    function verifier() {
      if (!courant) return;
      const r = courant.verifier(lire);
      jeu.status(`${r.ok ? '✔' : '✗'} ${r.message}`);
      rendreMath();
      if (!r.ok) return jeu.rater();
      jeu.gagner();
      courant = null;
      checkBtn.hidden = true;
      jeu.root.querySelectorAll('[data-rep]').forEach((i) => (i.disabled = true));
      if (suite && n >= suite) {
        jeu.status(`${jeu.root.querySelector('[data-status]').innerHTML}<br><b>Défi terminé : ${jeu.points} points en ${suite} questions.</b>`);
        replayBtn.hidden = false;
      } else {
        nextBtn.hidden = false;
        nextBtn.focus();
      }
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      verifier();
    });
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

const AIDE = {
  encadrer: 'Écris les deux voisins, le plus petit à gauche.',
  arrondir: 'Écris la graduation la plus proche : la bille roule jusqu’à elle.',
  intercaler: 'Il y a toujours de la place entre deux décimaux.',
};

export const encadrerUnite = faireWidget('encadrer', 'unite', { titre: 'Encadrer un décimal par deux entiers', aide: AIDE.encadrer });
export const encadrerDixieme = faireWidget('encadrer', 'dixieme', { titre: 'Encadrer un décimal par deux dixièmes', aide: AIDE.encadrer });
export const arrondirUnite = faireWidget('arrondir', 'unite', { titre: "Arrondir un décimal à l'unité", aide: AIDE.arrondir });
export const arrondirDixieme = faireWidget('arrondir', 'dixieme', { titre: 'Arrondir un décimal au dixième', aide: AIDE.arrondir });
export const intercalerUnite = faireWidget('intercaler', 'unite', { titre: 'Intercaler entre deux entiers', aide: AIDE.intercaler });
export const intercalerDixieme = faireWidget('intercaler', 'dixieme', { titre: 'Intercaler entre deux dixièmes', aide: AIDE.intercaler });
export const defiDecimaux = faireWidget('melange', 'melange', {
  titre: 'Défi : encadrer, arrondir, intercaler',
  aide: 'Dix questions mélangées. Trois bonnes réponses de suite : bonus.',
  total: 10,
});
