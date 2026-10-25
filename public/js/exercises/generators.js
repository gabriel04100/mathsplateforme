// Générateurs d'exercices : chaque appel produit une NOUVELLE question aléatoire.
// Contrat d'un générateur : (params) => {
//   prompt:   HTML de l'énoncé (LaTeX entre $…$),
//   input:    { kind: 'number' | 'choice' | 'poly', options?, unit? },
//   check:    (réponse) => { ok: boolean, message?: string },
//   solution: HTML de la correction détaillée,
//   figure?:  SVG optionnel
// }
// Pour ajouter un type d'exercice : écrire une fonction ici et l'enregistrer dans GENERATORS.
import { parse, evaluateExact, stepsLatex } from '../math/expr.js';
import { random } from './random.js';

// ---------- outils ----------
export const rand = (a, b) => a + Math.floor(random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(random() * arr.length)];
const sign = () => (random() < 0.5 ? -1 : 1);
const nz = (a, b) => { let v = 0; while (v === 0) v = rand(a, b); return v; };

// Nombre → LaTeX à la française (virgule décimale).
export const tex = (x) => String(+x.toFixed(10)).replace('.', '{,}');
const texRel = (x) => (x < 0 ? `(${tex(x)})` : tex(x));
const texSigned = (x) => (x < 0 ? `(${tex(x)})` : `(+${tex(x)})`);

// Lit un nombre tapé par un élève : « 3,5 », « 3.5 », « -4 », « − 4 ».
export function parseNumber(str) {
  const s = String(str).trim().replace(/\s/g, '').replace(/−/g, '-').replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  return Number(s);
}

// Chaque fonction de vérification garde la réponse attendue dans `.expected` (tests, future vue enseignant).
const withExpected = (fn, expected) => Object.assign(fn, { expected });
const numberCheck = (expected, tol = 1e-9) =>
  withExpected((ans) => {
    const v = parseNumber(ans);
    if (v === null) return { ok: false, message: 'Écris un nombre (avec une virgule si besoin).' };
    return { ok: Math.abs(v - expected) <= tol };
  }, expected);
const choiceCheck = (expectedIndex) => withExpected((ans) => ({ ok: Number(ans) === expectedIndex }), expectedIndex);

// Écrit a·x² + b·x + c proprement : « 2x^2 - x + 3 ».
export function polyLatex(coefs, v = 'x', { order = 'desc' } = {}) {
  const terms = [];
  const deg = coefs.length - 1;
  for (let d = deg; d >= 0; d--) {
    const c = coefs[d];
    if (!c) continue;
    const abs = Math.abs(c);
    const body = d === 0 ? tex(abs) : `${abs === 1 ? '' : tex(abs)}${v}${d === 2 ? '^2' : ''}`;
    terms.push({ neg: c < 0, body });
  }
  if (order === 'asc') terms.reverse();
  if (!terms.length) return '0';
  return terms.map((t, i) => (i === 0 ? (t.neg ? '-' : '') + t.body : `${t.neg ? '-' : '+'} ${t.body}`)).join(' ');
}

// Lit une expression polynomiale tapée par l'élève (degré ≤ 2) : « x^2+5x+6 », « -2x+8 », « 6x + 15 ».
export function parsePoly(str) {
  let s = String(str).toLowerCase().replace(/\s/g, '').replace(/²/g, '^2').replace(/−/g, '-').replace(/[×*]/g, '').replace(/,/g, '.');
  if (!s) return null;
  if (!/^[+-]/.test(s)) s = `+${s}`;
  const re = /([+-])(\d+(?:\.\d+)?)?(x(?:\^([12]))?)?/gy;
  const coefs = [0, 0, 0];
  const seen = [0, 0, 0];
  let m;
  let consumed = 0;
  while (consumed < s.length && (m = re.exec(s))) {
    if (m[0].length <= 1) return null;
    const hasNum = m[2] !== undefined;
    const hasX = m[3] !== undefined;
    if (!hasNum && !hasX) return null;
    const deg = hasX ? (m[4] === '2' ? 2 : 1) : 0;
    const c = (m[1] === '-' ? -1 : 1) * (hasNum ? Number(m[2]) : 1);
    coefs[deg] += c;
    seen[deg]++;
    consumed = re.lastIndex;
  }
  if (consumed !== s.length) return null;
  return { coefs, reduced: seen.every((n) => n <= 1) };
}

const polyCheck = (expected) =>
  withExpected((ans) => {
    const p = parsePoly(ans);
    if (!p) return { ok: false, message: 'Écriture non reconnue. Exemple : 3x+5 ou x^2-2x+1.' };
    const same = [0, 1, 2].every((d) => Math.abs((p.coefs[d] || 0) - (expected[d] || 0)) < 1e-9);
    if (same && !p.reduced) return { ok: false, message: 'Le résultat est juste mais pas réduit : regroupe les termes de même nature.' };
    return { ok: same };
  }, expected);

const LETTERS = ['ABC', 'DEF', 'EFG', 'MNP', 'RST', 'IJK', 'KLM', 'UVW'];

// ---------- 6e : décimaux ----------
const PLACES = [
  { name: 'des milliers', pow: 3 },
  { name: 'des centaines', pow: 2 },
  { name: 'des dizaines', pow: 1 },
  { name: 'des unités', pow: 0 },
  { name: 'des dixièmes', pow: -1 },
  { name: 'des centièmes', pow: -2 },
  { name: 'des millièmes', pow: -3 },
];

function decPlaceValue() {
  const digits = [];
  for (let i = 0; i < 7; i++) digits.push(i === 0 ? rand(1, 9) : rand(0, 9));
  const nbInt = rand(2, 4);
  const nbDec = rand(2, 3);
  const intPart = digits.slice(0, nbInt);
  const decPart = digits.slice(4, 4 + nbDec);
  if (decPart[decPart.length - 1] === 0) decPart[decPart.length - 1] = rand(1, 9);
  const places = PLACES.filter((p) => (p.pow >= 0 ? p.pow < nbInt : -p.pow <= nbDec));
  const place = pick(places);
  const answer = place.pow >= 0 ? intPart[nbInt - 1 - place.pow] : decPart[-place.pow - 1];
  const numberTex = `${intPart.join('')}{,}${decPart.join('')}`;
  return {
    prompt: `Dans le nombre $${numberTex}$, quel est le chiffre ${place.name} ?`,
    input: { kind: 'number' },
    check: numberCheck(answer),
    solution: `Le chiffre ${place.name} de $${numberTex}$ est $${answer}$.`,
  };
}

function decCompare() {
  const kind = rand(1, 4);
  const whole = rand(0, 30);
  let a;
  let b;
  if (kind === 1) {
    // piège « plus de chiffres = plus grand »
    const d1 = rand(1, 8);
    a = whole + d1 / 10 + rand(1, 9) / 100;
    b = whole + (d1 + rand(1, 9 - d1)) / 10;
  } else if (kind === 2) {
    a = whole + rand(1, 9) / 10;
    b = a; // égalité avec un zéro ajouté
  } else if (kind === 3) {
    a = whole + rand(1, 99) / 100;
    b = whole + rand(1, 99) / 100;
  } else {
    a = rand(0, 20) + rand(1, 999) / 1000;
    b = rand(0, 20) + rand(1, 99) / 100;
  }
  a = +a.toFixed(3);
  b = +b.toFixed(3);
  if (random() < 0.5) [a, b] = [b, a];
  let ta = tex(a);
  let tb = tex(b);
  if (kind === 2) tb = tb.includes('{,}') ? `${tb}0` : `${tb}{,}0`;
  const idx = a < b ? 0 : a > b ? 1 : 2;
  const sym = ['<', '>', '='][idx];
  return {
    prompt: `Compare : $${ta} \\;\\ldots\\; ${tb}$`,
    input: { kind: 'choice', options: ['$<$', '$>$', '$=$'] },
    check: choiceCheck(idx),
    solution:
      idx === 2
        ? `Ajouter un zéro à la fin de la partie décimale ne change pas le nombre : $${ta} = ${tb}$.`
        : `On compare les parties entières, puis les dixièmes, les centièmes… : $${ta} ${sym} ${tb}$.`,
  };
}

// ---------- 6e : fractions ----------
function fracOfQuantity() {
  const d = rand(2, 10);
  const n = rand(1, d - 1);
  const k = rand(2, 12);
  const q = d * k;
  const ctx = pick([
    { before: '', after: '', unit: '' },
    { before: 'Un sac contient ', after: ' billes. Combien font', unit: ' billes' },
    { before: 'Une randonnée mesure ', after: ' km. Quelle distance représentent', unit: ' km' },
    { before: 'Une classe a une cagnotte de ', after: ' €. Combien font', unit: ' €' },
  ]);
  const prompt = ctx.before
    ? `${ctx.before}$${q}$${ctx.after} les $\\dfrac{${n}}{${d}}$ ?`
    : `Calcule $\\dfrac{${n}}{${d}}$ de $${q}$.`;
  return {
    prompt,
    input: { kind: 'number', unit: ctx.unit.trim() },
    check: numberCheck(n * k),
    solution: `$${q} \\div ${d} = ${k}$ puis $${k} \\times ${n} = ${n * k}$. Donc $\\dfrac{${n}}{${d}}$ de $${q}$ vaut $${n * k}$${ctx.unit}.`,
  };
}

function fracEquivalent() {
  const b = rand(2, 9);
  const a = rand(1, b * 2);
  const m = rand(2, 9);
  const mode = rand(1, 3);
  let left;
  let right;
  let answer;
  let sol;
  if (mode === 1) {
    left = `\\dfrac{${a}}{${b}}`;
    right = `\\dfrac{\\boxed{\\phantom{0}}}{${b * m}}`;
    answer = a * m;
    sol = `$${b} \\times ${m} = ${b * m}$, donc on multiplie aussi le numérateur par $${m}$ : $${a} \\times ${m} = ${answer}$.`;
  } else if (mode === 2) {
    left = `\\dfrac{${a}}{${b}}`;
    right = `\\dfrac{${a * m}}{\\boxed{\\phantom{0}}}`;
    answer = b * m;
    sol = `$${a} \\times ${m} = ${a * m}$, donc on multiplie aussi le dénominateur par $${m}$ : $${b} \\times ${m} = ${answer}$.`;
  } else {
    left = `\\dfrac{${a * m}}{${b * m}}`;
    right = `\\dfrac{\\boxed{\\phantom{0}}}{${b}}`;
    answer = a;
    sol = `$${b * m} \\div ${m} = ${b}$, donc on divise aussi le numérateur par $${m}$ : $${a * m} \\div ${m} = ${answer}$.`;
  }
  return {
    prompt: `Complète : $${left} = ${right}$`,
    input: { kind: 'number' },
    check: numberCheck(answer),
    solution: sol,
  };
}

// ---------- 5e : priorités ----------
const PRIO_PLAIN = ['a + b * c', 'a * b - c', 'a - b * c', 'a + b * c - d', 'A / b + c', 'a * b + c * d', 'a - A / b', 'a + b * c + d * e', 'A / b * c'];
const PRIO_PAREN = ['(a + b) * c', 'a * (b - c)', '(A + b) / c', 'a - (b + c)', '(a + b) * (c - d)', 'a + (b - c) * d', '(a * b - c) / d', 'a * (b + c) - d'];

function prioCalc(params = {}) {
  const templates = params.parentheses ? PRIO_PAREN : PRIO_PLAIN;
  for (let tries = 0; tries < 500; tries++) {
    const t = pick(templates);
    const src = t.replace(/[a-eA]/g, (ch) => (ch === 'A' ? rand(2, 9) * rand(2, 9) : rand(2, 12)));
    const tree = parse(src);
    const value = evaluateExact(tree);
    if (value === null || value < 0 || value > 300) continue;
    const steps = stepsLatex(src);
    return {
      prompt: `Calcule : $${steps[0].plain}$`,
      input: { kind: 'number' },
      check: numberCheck(value),
      solution: steps.map((s, i) => `$${i === 0 ? '' : '= '}${s.latex}$`).join('<br>'),
      key: src,
    };
  }
  throw new Error('Impossible de générer un calcul');
}

// ---------- 5e : relatifs ----------
function relAdd() {
  const a = nz(-15, 15);
  const b = nz(-15, 15);
  const r = a + b;
  const same = Math.sign(a) === Math.sign(b);
  return {
    prompt: `Calcule : $${texSigned(a)} + ${texSigned(b)}$`,
    input: { kind: 'number' },
    check: numberCheck(r),
    solution: same
      ? `Même signe : on garde le signe et on additionne les distances à zéro. $${texSigned(a)} + ${texSigned(b)} = ${tex(r)}$.`
      : `Signes contraires : on soustrait les distances à zéro ($${Math.max(Math.abs(a), Math.abs(b))} - ${Math.min(Math.abs(a), Math.abs(b))}$) et on prend le signe de celui qui a la plus grande. $${texSigned(a)} + ${texSigned(b)} = ${tex(r)}$.`,
  };
}

function relSub() {
  const a = nz(-15, 15);
  const b = nz(-15, 15);
  const r = a - b;
  return {
    prompt: `Calcule : $${texSigned(a)} - ${texSigned(b)}$`,
    input: { kind: 'number' },
    check: numberCheck(r),
    solution: `Soustraire, c'est ajouter l'opposé : $${texSigned(a)} - ${texSigned(b)} = ${texSigned(a)} + ${texSigned(-b)} = ${tex(r)}$.`,
  };
}

// ---------- 3e : calcul littéral ----------

// Opposé d'une parenthèse : $-(ax + b)$. Le piège classique est d'oublier de
// changer le signe du second terme.
function litOppose() {
  const a = random() < 0.45 ? 1 : nz(-7, 9);
  const b = nz(-12, 12);
  const inner = polyLatex([b, a]);
  const exp = [-b, -a];
  return {
    prompt: `Supprime la parenthèse : $-\\left(${inner}\\right)$`,
    input: { kind: 'poly' },
    check: polyCheck(exp),
    solution: `Le signe $-$ change le signe de <strong>chaque</strong> terme de la parenthèse :
      $${a === 1 ? 'x' : polyLatex([0, a])}$ devient $${polyLatex([0, -a])}$, et $${tex(b)}$ devient $${tex(-b)}$.<br>
      $-\\left(${inner}\\right) = ${polyLatex(exp)}$`,
  };
}

// Soustraction d'une parenthèse : $A - (ax + b)$, l'erreur la plus fréquente du chapitre.
function litSoustraireParenthese() {
  const c = nz(-9, 12);
  const a = random() < 0.4 ? 1 : nz(-6, 8);
  const b = nz(-10, 10);
  const inner = polyLatex([b, a]);
  const exp = [c - b, -a];
  return {
    prompt: `Développe et réduis : $${tex(c)} - \\left(${inner}\\right)$`,
    input: { kind: 'poly' },
    check: polyCheck(exp),
    solution: `Le signe $-$ devant la parenthèse change le signe de chaque terme :<br>
      $${tex(c)} - \\left(${inner}\\right) = ${tex(c)} ${-a < 0 ? '-' : '+'} ${Math.abs(a) === 1 ? '' : tex(Math.abs(a))}x ${-b < 0 ? '-' : '+'} ${tex(Math.abs(b))} = ${polyLatex(exp)}$`,
  };
}

// Simple distributivité avec un facteur qui peut être négatif : $k(ax + b)$.
function litDistributiviteSimple() {
  const k = random() < 0.45 ? -rand(2, 9) : rand(2, 9);
  const a = random() < 0.4 ? 1 : nz(-6, 8);
  const b = nz(-10, 10);
  const inner = polyLatex([b, a]);
  const exp = [k * b, k * a];
  const kTex = k === -1 ? '-' : tex(k);
  return {
    prompt: `Développe et réduis : $${kTex}\\left(${inner}\\right)$`,
    input: { kind: 'poly' },
    check: polyCheck(exp),
    solution: `On multiplie le facteur par <strong>chaque</strong> terme de la parenthèse :<br>
      $${kTex}\\left(${inner}\\right) = ${texRel(k)} \\times ${a === 1 ? '' : texRel(a)}x + ${texRel(k)} \\times ${texRel(b)} = ${polyLatex(exp)}$`,
  };
}

// Double distributivité : $(ax + b)(cx + d)$, avec les quatre produits détaillés.
function litDistributiviteDouble() {
  const a = random() < 0.5 ? 1 : rand(2, 5);
  const c = random() < 0.5 ? 1 : rand(2, 4);
  const b = nz(-9, 9);
  const d = nz(-9, 9);
  const exp = [b * d, a * d + b * c, a * c];
  const f1 = polyLatex([b, a]);
  const f2 = polyLatex([d, c]);
  const t = (coef, deg) => polyLatex(deg === 2 ? [0, 0, coef] : deg === 1 ? [0, coef] : [coef]);
  const expanded = [t(a * c, 2), t(a * d, 1), t(b * c, 1), t(b * d, 0)]
    .map((s, i) => (i === 0 ? s : s.startsWith('-') ? `- ${s.slice(1)}` : `+ ${s}`))
    .join(' ');
  return {
    prompt: `Développe et réduis : $\\left(${f1}\\right)\\left(${f2}\\right)$`,
    input: { kind: 'poly' },
    check: polyCheck(exp),
    solution: `Chaque terme de la première parenthèse multiplie chaque terme de la seconde — <strong>quatre</strong> produits :<br>
      $\\left(${f1}\\right)\\left(${f2}\\right) = ${expanded}$<br>
      On regroupe les termes en $x$ : $${polyLatex(exp)}$`,
  };
}

// Reconnaître la forme d'une expression : entraîne à choisir la bonne méthode.
function litFormeExpression() {
  const a = rand(2, 6);
  const b = nz(-8, 8);
  const c = rand(2, 5);
  const d = nz(-8, 8);
  const cas = [
    { tex: `-\\left(${polyLatex([b, a])}\\right)`, bonne: "L'opposé d'une parenthèse" },
    { tex: `${tex(c)}\\left(${polyLatex([b, a])}\\right)`, bonne: 'Une simple distributivité' },
    { tex: `\\left(${polyLatex([b, a])}\\right)\\left(${polyLatex([d, c])}\\right)`, bonne: 'Une double distributivité' },
  ];
  const choisi = pick(cas);
  const options = ["L'opposé d'une parenthèse", 'Une simple distributivité', 'Une double distributivité'];
  return {
    key: `forme-${choisi.tex}`,
    prompt: `De quelle forme est l'expression $${choisi.tex}$ ?`,
    input: { kind: 'choice', options },
    check: choiceCheck(options.indexOf(choisi.bonne)),
    solution: `$${choisi.tex}$ : ${choisi.bonne.toLowerCase()}.`,
  };
}

// Révision du chapitre : une des quatre situations, tirée au hasard.
function litMelange() {
  return pick([litOppose, litSoustraireParenthese, litDistributiviteSimple, litDistributiviteDouble])();
}

// ---------- 4e : développer ----------
function devSimple() {
  const k = random() < 0.3 ? -rand(2, 9) : rand(2, 9);
  const a = nz(-6, 9);
  const b = nz(-9, 9);
  const exp = [k * b, k * a];
  const inner = random() < 0.8 ? polyLatex([b, a]) : polyLatex([b, a], 'x', { order: 'asc' });
  const kTex = k === -1 ? '-' : tex(k);
  return {
    prompt: `Développe et réduis : $${kTex}\\left(${inner}\\right)$`,
    input: { kind: 'poly' },
    check: polyCheck(exp),
    solution: `$${kTex}\\left(${inner}\\right) = ${texRel(k)} \\times ${a === 1 ? '' : texRel(a)}x + ${texRel(k)} \\times ${texRel(b)} = ${polyLatex(exp)}$`,
  };
}

function devDouble() {
  const simple = random() < 0.6;
  const a = simple ? 1 : rand(1, 4);
  const c = simple ? 1 : rand(1, 3);
  const b = nz(-7, 7);
  const d = nz(-7, 7);
  const exp = [b * d, a * d + b * c, a * c];
  const f1 = polyLatex([b, a]);
  const f2 = polyLatex([d, c]);
  const t = (coef, deg) => polyLatex(deg === 2 ? [0, 0, coef] : deg === 1 ? [0, coef] : [coef]);
  const expanded = [t(a * c, 2), t(a * d, 1), t(b * c, 1), t(b * d, 0)]
    .map((s, i) => (i === 0 ? s : s.startsWith('-') ? `- ${s.slice(1)}` : `+ ${s}`))
    .join(' ');
  return {
    prompt: `Développe et réduis : $\\left(${f1}\\right)\\left(${f2}\\right)$`,
    input: { kind: 'poly' },
    check: polyCheck(exp),
    solution: `$\\left(${f1}\\right)\\left(${f2}\\right) = ${expanded} = ${polyLatex(exp)}$`,
  };
}

// ---------- 4e : Pythagore ----------
const TRIPLES = [[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [6, 8, 10], [9, 12, 15], [20, 21, 29], [12, 16, 20], [9, 40, 41]];

function triangleFigure(names, labels) {
  // Schéma (non à l'échelle) d'un triangle rectangle en names[0].
  const [A, B, C] = names;
  return `<svg class="figure" viewBox="0 0 260 150" role="img" aria-label="Triangle ${A}${B}${C} rectangle en ${A}">
    <polygon points="80,120 240,120 80,25" fill="var(--fig-fill)" stroke="var(--ink)" stroke-width="2"/>
    <polyline points="80,108 92,108 92,120" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
    <text x="66" y="138" class="fig-pt">${A}</text><text x="244" y="138" class="fig-pt">${B}</text><text x="66" y="22" class="fig-pt">${C}</text>
    <text x="160" y="142" text-anchor="middle" class="fig-len">${labels.AB}</text>
    <text x="72" y="77" text-anchor="end" class="fig-len">${labels.AC}</text>
    <text x="168" y="64" class="fig-len">${labels.BC}</text>
  </svg>`;
}

const round1 = (x) => Math.round(x * 10) / 10;

function pythHypotenuse() {
  const names = pick(LETTERS).split('');
  const [A, B, C] = names;
  let p;
  let q;
  if (random() < 0.6) [p, q] = pick(TRIPLES);
  else [p, q] = [rand(2, 12), rand(2, 12)];
  const sq = p * p + q * q;
  const exact = Math.sqrt(sq);
  const isInt = Number.isInteger(exact);
  const ans = isInt ? exact : round1(exact);
  return {
    prompt: `Le triangle $${A}${B}${C}$ est rectangle en $${A}$, avec $${A}${B} = ${p}$ cm et $${A}${C} = ${q}$ cm. Calcule $${B}${C}$${isInt ? '' : ' (arrondi au dixième)'}.`,
    figure: triangleFigure(names, { AB: `${p} cm`, AC: `${q} cm`, BC: '?' }),
    input: { kind: 'number', unit: 'cm' },
    check: numberCheck(ans, 1e-6),
    solution: `$${A}${B}${C}$ est rectangle en $${A}$, donc d'après le théorème de Pythagore :<br>$${B}${C}^2 = ${A}${B}^2 + ${A}${C}^2 = ${p}^2 + ${q}^2 = ${p * p} + ${q * q} = ${sq}$<br>$${B}${C} = \\sqrt{${sq}} ${isInt ? `= ${exact}` : `\\approx ${tex(ans)}`}$ cm.`,
  };
}

function pythSide() {
  const names = pick(LETTERS).split('');
  const [A, B, C] = names;
  let p;
  let r;
  if (random() < 0.6) {
    const t = pick(TRIPLES);
    p = t[0];
    r = t[2];
  } else {
    r = rand(6, 15);
    p = rand(2, r - 1);
  }
  const sq = r * r - p * p;
  const exact = Math.sqrt(sq);
  const isInt = Number.isInteger(exact);
  const ans = isInt ? exact : round1(exact);
  return {
    prompt: `Le triangle $${A}${B}${C}$ est rectangle en $${A}$, avec $${B}${C} = ${r}$ cm et $${A}${B} = ${p}$ cm. Calcule $${A}${C}$${isInt ? '' : ' (arrondi au dixième)'}.`,
    figure: triangleFigure(names, { AB: `${p} cm`, AC: '?', BC: `${r} cm` }),
    input: { kind: 'number', unit: 'cm' },
    check: numberCheck(ans, 1e-6),
    solution: `D'après le théorème de Pythagore : $${B}${C}^2 = ${A}${B}^2 + ${A}${C}^2$, donc<br>$${A}${C}^2 = ${B}${C}^2 - ${A}${B}^2 = ${r * r} - ${p * p} = ${sq}$<br>$${A}${C} = \\sqrt{${sq}} ${isInt ? `= ${exact}` : `\\approx ${tex(ans)}`}$ cm.`,
  };
}

// ---------- 3e : arithmétique ----------
const isPrime = (n) => {
  if (n < 2) return false;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return true;
};
const smallestFactor = (n) => {
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return d;
  return n;
};
const TRICKY = [51, 57, 87, 91, 119, 121, 133, 143, 161, 169, 187, 203, 209, 221];

function arithPrime() {
  let n;
  const r = random();
  if (r < 0.45) {
    do n = rand(11, 230); while (!isPrime(n));
  } else if (r < 0.75) n = pick(TRICKY);
  else {
    do n = rand(20, 230); while (isPrime(n));
  }
  const prime = isPrime(n);
  const d = smallestFactor(n);
  return {
    prompt: `Le nombre $${n}$ est-il premier ?`,
    input: { kind: 'choice', options: ['Oui', 'Non'] },
    check: choiceCheck(prime ? 0 : 1),
    solution: prime
      ? `$${n}$ n'est divisible par aucun nombre premier jusqu'à $${Math.floor(Math.sqrt(n))}$ (car $${Math.floor(Math.sqrt(n)) + 1}^2 > ${n}$) : il est premier.`
      : `$${n} = ${d} \\times ${n / d}$ : il a d'autres diviseurs que $1$ et lui-même, il n'est pas premier.`,
  };
}

function arithSmallestPrimeDivisor() {
  let n;
  do {
    const p = pick([2, 3, 3, 5, 7, 7, 11, 13]);
    n = p * rand(p, Math.floor(400 / p));
  } while (n < 15 || isPrime(n));
  const d = smallestFactor(n);
  return {
    prompt: `Quel est le plus petit nombre premier qui divise $${n}$ ?`,
    input: { kind: 'number' },
    check: numberCheck(d),
    solution: `${d > 2 ? `$${n}$ est impair. ` : ''}${d > 3 ? `La somme de ses chiffres n'est pas divisible par 3. ` : ''}${d > 5 ? `Il ne se termine ni par 0 ni par 5. ` : ''}$${n} = ${d} \\times ${n / d}$, donc le plus petit diviseur premier est $${d}$.`,
  };
}

// ---------- 3e : fonctions affines ----------
function affImage() {
  const a = nz(-6, 6);
  const b = rand(-9, 9);
  const x = rand(-5, 6);
  const fn = pick(['f', 'g', 'h']);
  const r = a * x + b;
  return {
    prompt: `On considère la fonction $${fn} : x \\mapsto ${polyLatex([b, a])}$. Calcule $${fn}(${tex(x)})$.`,
    input: { kind: 'number' },
    check: numberCheck(r),
    solution: `$${fn}(${tex(x)}) = ${texRel(a)} \\times ${texRel(x)} ${b < 0 ? '-' : '+'} ${tex(Math.abs(b))} = ${tex(r)}$`,
  };
}

function affCoeff() {
  const special = rand(1, 6);
  const a = special === 1 ? 0 : nz(-7, 7);
  const b = special === 2 ? 0 : nz(-9, 9);
  const order = random() < 0.35 ? 'asc' : 'desc';
  const fx = polyLatex([b, a], 'x', { order });
  const askA = random() < 0.5;
  return {
    prompt: `$f(x) = ${fx}$. Quel est ${askA ? 'le <strong>coefficient directeur</strong> $a$' : "l'<strong>ordonnée à l'origine</strong> $b$"} ?`,
    input: { kind: 'number' },
    check: numberCheck(askA ? a : b),
    solution: `On écrit $f(x)$ sous la forme $ax + b$ : $f(x) = ${a === 0 ? '0x' : polyLatex([0, a])} ${b < 0 ? '-' : '+'} ${tex(Math.abs(b))}$. Donc $${askA ? 'a' : 'b'} = ${tex(askA ? a : b)}$.`,
  };
}

export const GENERATORS = {
  'dec-place-value': decPlaceValue,
  'dec-compare': decCompare,
  'frac-of-quantity': fracOfQuantity,
  'frac-equivalent': fracEquivalent,
  'prio-calc': prioCalc,
  'rel-add': relAdd,
  'rel-sub': relSub,
  'dev-simple': devSimple,
  'dev-double': devDouble,
  'lit-oppose': litOppose,
  'lit-soustraire-parenthese': litSoustraireParenthese,
  'lit-distrib-simple': litDistributiviteSimple,
  'lit-distrib-double': litDistributiviteDouble,
  'lit-forme': litFormeExpression,
  'lit-melange': litMelange,
  'pyth-hypotenuse': pythHypotenuse,
  'pyth-side': pythSide,
  'arith-prime': arithPrime,
  'arith-smallest-prime-divisor': arithSmallestPrimeDivisor,
  'aff-image': affImage,
  'aff-coeff': affCoeff,
};

// Réponse attendue d'une question, en texte lisible par un humain.
// Nécessaire parce que `check.expected` n'a pas la même forme selon le type :
// un indice pour un QCM, un tableau de coefficients pour une expression
// littérale, un nombre sinon. Sert au corrigé papier et au suivi de classe.
export function expectedText(q) {
  const e = q?.check?.expected;
  if (e === undefined || e === null) return '';
  if (q.input?.kind === 'choice') return String(q.input.options?.[Number(e)] ?? e);
  if (q.input?.kind === 'poly') return Array.isArray(e) ? polyLatex(e) : String(e);
  return String(e);
}

// La même, prête à être rendue par KaTeX quand c'est une expression.
export const expectedMath = (q) => (q?.input?.kind === 'poly' ? `$${expectedText(q)}$` : expectedText(q));

// Génère une série de questions toutes différentes.
export function generateSet(generatorId, count, params) {
  const gen = GENERATORS[generatorId];
  if (!gen) throw new Error(`Générateur inconnu : ${generatorId}`);
  const out = [];
  const seen = new Set();
  for (let guard = 0; out.length < count && guard < count * 50; guard++) {
    const q = gen(params || {});
    const key = q.key || q.prompt;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}
