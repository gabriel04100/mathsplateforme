// Modèles d'exercices écrits par l'enseignant : des variables tirées au sort
// et des formules, pour que les questions changent à chaque série — comme les
// générateurs écrits en JavaScript, mais sans écrire de code.
//
// Aucun eval() : les formules sont analysées en arbre puis évaluées pas à pas.
// Ce fichier sert au navigateur (générer les questions) ET au serveur
// (valider un modèle avant de l'enregistrer), pour que les deux appliquent
// exactement les mêmes règles.
import { parseNumber, parsePoly, polyLatex, tex } from './generators.js';
import { renderRichText } from '../content/richtext.js';

export class TemplateError extends Error {}

const MAX_VARIABLES = 12;
const MAX_CHOICES = 6;
const MAX_TEXT = 2000;
const ROLL_ATTEMPTS = 300; // garde-fou si les contraintes sont impossibles

// ---------- Analyse des formules ----------

const PUNCT = ['<=', '>=', '<>', '!=', '==', '&&', '||', '+', '-', '*', '/', '%', '^', '(', ')', ',', '<', '>', '=', '!'];

function tokenize(src) {
  const s = String(src).replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/≠/g, '<>');
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[\d.]/.test(c)) {
      let j = i;
      while (j < s.length && /[\d.]/.test(s[j])) j++;
      const raw = s.slice(i, j);
      const v = Number(raw);
      if (!Number.isFinite(v)) throw new TemplateError(`nombre invalide « ${raw} »`);
      tokens.push({ t: 'num', v });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++;
      tokens.push({ t: 'name', v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = s.indexOf(c, i + 1);
      if (end < 0) throw new TemplateError('guillemet non fermé');
      tokens.push({ t: 'str', v: s.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const op = PUNCT.find((p) => s.startsWith(p, i));
    if (!op) throw new TemplateError(`caractère inattendu « ${c} »`);
    tokens.push({ t: op });
    i += op.length;
  }
  return tokens;
}

// Fonctions utilisables dans les formules (noms français et anglais).
export const FUNCTIONS = {
  abs: (x) => Math.abs(x),
  arrondi: (x, n = 0) => Math.round(x * 10 ** n) / 10 ** n,
  round: (x, n = 0) => Math.round(x * 10 ** n) / 10 ** n,
  plancher: (x) => Math.floor(x),
  floor: (x) => Math.floor(x),
  plafond: (x) => Math.ceil(x),
  ceil: (x) => Math.ceil(x),
  racine: (x) => Math.sqrt(x),
  sqrt: (x) => Math.sqrt(x),
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  puissance: (a, b) => a ** b,
  pow: (a, b) => a ** b,
  signe: (x) => Math.sign(x),
  carre: (x) => x * x,
  pgcd: (a, b) => {
    let x = Math.abs(Math.round(a));
    let y = Math.abs(Math.round(b));
    while (y) [x, y] = [y, x % y];
    return x;
  },
  ppcm: (a, b) => {
    const g = FUNCTIONS.pgcd(a, b);
    return g ? Math.abs(Math.round(a) * Math.round(b)) / g : 0;
  },
  // « est_entier(x) » : pratique en contrainte pour n'avoir que des résultats propres.
  est_entier: (x) => (Number.isInteger(x) ? 1 : 0),
};

const BINARY = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '%': (a, b) => a % b,
  '<': (a, b) => (a < b ? 1 : 0),
  '>': (a, b) => (a > b ? 1 : 0),
  '<=': (a, b) => (a <= b ? 1 : 0),
  '>=': (a, b) => (a >= b ? 1 : 0),
};

// Grammaire, du moins prioritaire au plus prioritaire :
// ou > et > non > comparaison > ± > ×÷ > unaire > puissance > primaire
function parseTokens(tokens) {
  let p = 0;
  const peek = () => tokens[p];
  const eat = (t) => (tokens[p]?.t === t ? (p++, true) : false);
  const eatName = (...names) => {
    const tk = tokens[p];
    if (tk?.t === 'name' && names.includes(tk.v.toLowerCase())) {
      p++;
      return true;
    }
    return false;
  };

  function orExpr() {
    let left = andExpr();
    while (peek()?.t === '||' || (peek()?.t === 'name' && ['ou', 'or'].includes(peek().v.toLowerCase()))) {
      if (!eat('||')) eatName('ou', 'or');
      left = { type: 'or', left, right: andExpr() };
    }
    return left;
  }

  function andExpr() {
    let left = notExpr();
    while (peek()?.t === '&&' || (peek()?.t === 'name' && ['et', 'and'].includes(peek().v.toLowerCase()))) {
      if (!eat('&&')) eatName('et', 'and');
      left = { type: 'and', left, right: notExpr() };
    }
    return left;
  }

  function notExpr() {
    if (eat('!') || eatName('non', 'not')) return { type: 'not', arg: notExpr() };
    return comparison();
  }

  function comparison() {
    const left = sum();
    for (const op of ['<=', '>=', '<>', '!=', '==', '<', '>', '=']) {
      if (peek()?.t === op) {
        p++;
        const right = sum();
        if (op === '<>' || op === '!=') return { type: 'neq', left, right };
        if (op === '=' || op === '==') return { type: 'eq', left, right };
        return { type: 'bin', op, left, right };
      }
    }
    return left;
  }

  function sum() {
    let left = product();
    while (peek()?.t === '+' || peek()?.t === '-') {
      const op = tokens[p++].t;
      left = { type: 'bin', op, left, right: product() };
    }
    return left;
  }

  function product() {
    let left = unary();
    while (peek()?.t === '*' || peek()?.t === '/' || peek()?.t === '%') {
      const op = tokens[p++].t;
      left = op === '/' ? { type: 'div', left, right: unary() } : { type: 'bin', op, left, right: unary() };
    }
    return left;
  }

  function unary() {
    if (eat('-')) return { type: 'neg', arg: unary() };
    if (eat('+')) return unary();
    return power();
  }

  function power() {
    const base = primary();
    if (eat('^')) return { type: 'pow', left: base, right: unary() }; // associatif à droite
    return base;
  }

  function primary() {
    const tk = tokens[p++];
    if (!tk) throw new TemplateError('formule incomplète');
    if (tk.t === 'num') return { type: 'num', value: tk.v };
    if (tk.t === 'str') return { type: 'str', value: tk.v };
    if (tk.t === 'name') {
      if (eat('(')) {
        const args = [];
        if (!eat(')')) {
          do {
            args.push(orExpr());
          } while (eat(','));
          if (!eat(')')) throw new TemplateError(`parenthèse non fermée après « ${tk.v} »`);
        }
        const fn = FUNCTIONS[tk.v.toLowerCase()];
        if (!fn) throw new TemplateError(`fonction inconnue « ${tk.v} »`);
        return { type: 'call', name: tk.v.toLowerCase(), args };
      }
      return { type: 'var', name: tk.v };
    }
    if (tk.t === '(') {
      const e = orExpr();
      if (!eat(')')) throw new TemplateError('parenthèse non fermée');
      return e;
    }
    throw new TemplateError('formule invalide');
  }

  const tree = orExpr();
  if (p !== tokens.length) throw new TemplateError('formule invalide (caractères en trop)');
  return tree;
}

export function parseFormula(src) {
  if (!String(src ?? '').trim()) throw new TemplateError('formule vide');
  return parseTokens(tokenize(src));
}

// Liste les variables utilisées par une formule : permet de signaler les noms inconnus.
export function formulaVariables(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'var') out.add(node.name);
  for (const k of ['left', 'right', 'arg']) if (node[k]) formulaVariables(node[k], out);
  if (node.args) for (const a of node.args) formulaVariables(a, out);
  return out;
}

export function evaluate(node, vars) {
  switch (node.type) {
    case 'num':
    case 'str':
      return node.value;
    case 'var': {
      // hasOwn et non « in » : sinon « constructor » ou « toString » seraient
      // trouvés sur le prototype et renverraient autre chose qu'un nombre.
      if (!Object.hasOwn(vars, node.name)) throw new TemplateError(`variable inconnue « ${node.name} »`);
      return vars[node.name];
    }
    case 'neg':
      return -num(evaluate(node.arg, vars));
    case 'not':
      return truthy(evaluate(node.arg, vars)) ? 0 : 1;
    case 'and':
      return truthy(evaluate(node.left, vars)) && truthy(evaluate(node.right, vars)) ? 1 : 0;
    case 'or':
      return truthy(evaluate(node.left, vars)) || truthy(evaluate(node.right, vars)) ? 1 : 0;
    case 'eq':
      return same(evaluate(node.left, vars), evaluate(node.right, vars)) ? 1 : 0;
    case 'neq':
      return same(evaluate(node.left, vars), evaluate(node.right, vars)) ? 0 : 1;
    case 'div': {
      const b = num(evaluate(node.right, vars));
      if (b === 0) throw new TemplateError('division par zéro');
      return num(evaluate(node.left, vars)) / b;
    }
    case 'pow': {
      const r = num(evaluate(node.left, vars)) ** num(evaluate(node.right, vars));
      if (!Number.isFinite(r)) throw new TemplateError('puissance hors limites');
      return r;
    }
    case 'bin':
      return BINARY[node.op](num(evaluate(node.left, vars)), num(evaluate(node.right, vars)));
    case 'call': {
      const args = node.args.map((a) => num(evaluate(a, vars)));
      const r = FUNCTIONS[node.name](...args);
      if (typeof r !== 'number' || !Number.isFinite(r)) throw new TemplateError(`« ${node.name} » n'a pas donné de nombre`);
      return r;
    }
    default:
      throw new TemplateError('formule invalide');
  }
}

function num(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TemplateError('un nombre était attendu');
  return v;
}
const truthy = (v) => (typeof v === 'string' ? v !== '' : v !== 0);
const same = (a, b) => (typeof a === 'string' || typeof b === 'string' ? String(a) === String(b) : Math.abs(a - b) < 1e-9);

// ---------- Tirage des variables ----------

const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function rollOne(v) {
  if (v.type === 'liste') return v.values[Math.floor(Math.random() * v.values.length)];
  const min = Number(v.min);
  const max = Number(v.max);
  if (v.type === 'decimal') {
    const d = Number.isInteger(v.decimals) ? v.decimals : 1;
    const f = 10 ** d;
    return Math.round((min + Math.random() * (max - min)) * f) / f;
  }
  const step = Number.isInteger(v.step) && v.step > 0 ? v.step : 1;
  const n = Math.floor((max - min) / step);
  return min + step * randInt(0, n);
}

// Tire un jeu de valeurs qui respecte toutes les contraintes.
export function rollVariables(definition) {
  const vars = definition.variables || [];
  const constraints = (definition.constraints || []).map((c) => parseFormula(c));
  for (let attempt = 0; attempt < ROLL_ATTEMPTS; attempt++) {
    const values = Object.create(null); // pas de prototype : aucune variable « héritée »
    for (const v of vars) values[v.name] = rollOne(v);
    try {
      if (constraints.every((c) => truthy(evaluate(c, values)))) return values;
    } catch {
      /* contrainte impossible à évaluer sur ce tirage : on retente */
    }
  }
  throw new TemplateError("aucun tirage ne respecte les contraintes (vérifie les bornes et les conditions)");
}

// ---------- Rendu du texte ----------

// Nombre d'ouvertures de $ avant la position donnée : sert à savoir si un
// [[…]] se trouve dans une formule LaTeX (virgule décimale « {,} ») ou dans du
// texte courant (virgule simple).
function insideMath(text, index) {
  let count = 0;
  for (let i = 0; i < index; i++) if (text[i] === '$' && text[i - 1] !== '\\') count++;
  return count % 2 === 1;
}

export function formatValue(value, math) {
  if (typeof value === 'string') return value;
  return math ? tex(value) : String(+value.toFixed(10)).replace('.', ',');
}

// Remplace chaque [[formule]] par sa valeur, puis met en forme le texte.
// Même grammaire que les cours : listes, **gras**, *italique*, `code`, et le
// LaTeX entre $…$. Tout est échappé : aucune balise brute n'est acceptée.
export function substitute(text, vars) {
  const src = String(text ?? '');
  return src.replace(/\[\[([^\]]*)\]\]/g, (full, expr, offset) => {
    const value = evaluate(parseFormula(expr), vars);
    return formatValue(value, insideMath(src, offset));
  });
}

export function renderText(text, vars, { inline = true } = {}) {
  return renderRichText(substitute(text, vars), { inline });
}

// Formules citées dans un texte : sert à la validation (noms de variables inconnus).
export function textFormulas(text) {
  return [...String(text ?? '').matchAll(/\[\[([^\]]*)\]\]/g)].map((m) => m[1]);
}

// ---------- Modèle → question ----------

// Produit une question au format attendu par runExercise :
// { prompt, input, check, solution, key }
// Comparaison souple d'une réponse écrite en toutes lettres : on ignore la
// casse, les accents, la ponctuation finale et les espaces en trop.
const normalizeText = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.;:!?]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

export function buildQuestion(definition) {
  const vars = rollVariables(definition);
  const prompt = renderText(definition.prompt, vars);
  const solution = renderText(definition.solution || '', vars, { inline: false });
  const answer = definition.answer || {};
  const key = JSON.stringify(vars);

  // Expression littérale : « -(x+1) » attend « -x-1 », quelle que soit
  // l'écriture choisie par l'élève. On réutilise le lecteur de polynômes
  // des exercices intégrés.
  if (answer.kind === 'expression') {
    const wanted = parsePoly(substitute(answer.expected, vars));
    if (!wanted) throw new TemplateError(`réponse attendue illisible : « ${substitute(answer.expected, vars)} »`);
    const mustReduce = answer.reduire !== false;
    return {
      prompt,
      input: { kind: 'poly' },
      check: Object.assign(
        (ans) => {
          const p = parsePoly(ans);
          if (!p) return { ok: false, message: 'Écriture non reconnue. Exemple : 3x+5 ou x^2-2x+1.' };
          const same = [0, 1, 2].every((d) => Math.abs((p.coefs[d] || 0) - (wanted.coefs[d] || 0)) < 1e-9);
          if (same && mustReduce && !p.reduced) {
            return { ok: false, message: 'Le résultat est juste mais pas réduit : regroupe les termes de même nature.' };
          }
          return { ok: same };
        },
        { expected: polyLatex(wanted.coefs) }
      ),
      solution,
      key,
    };
  }

  // Réponse en toutes lettres : une ou plusieurs formulations acceptées.
  if (answer.kind === 'texte') {
    const accepted = (answer.accepted || []).map((a) => normalizeText(substitute(a, vars))).filter(Boolean);
    return {
      prompt,
      input: { kind: 'text' },
      check: Object.assign(
        (ans) => {
          const v = normalizeText(ans);
          if (!v) return { ok: false, message: 'Écris ta réponse.' };
          return { ok: accepted.includes(v) };
        },
        { expected: substitute(answer.accepted?.[0] ?? '', vars) }
      ),
      solution,
      key,
    };
  }

  if (answer.kind === 'choice') {
    const options = (answer.options || []).map((o) => renderText(o.text, vars));
    const correct = (answer.options || []).findIndex((o) => o.correct);
    return {
      prompt,
      input: { kind: 'choice', options },
      check: Object.assign((ans) => ({ ok: Number(ans) === correct }), { expected: correct }),
      solution,
      key,
    };
  }

  const expected = num(evaluate(parseFormula(answer.formula), vars));
  const tol = Number.isFinite(Number(answer.tolerance)) ? Math.abs(Number(answer.tolerance)) : 1e-9;
  return {
    prompt,
    input: { kind: 'number', unit: answer.unit || undefined },
    check: Object.assign(
      (ans) => {
        const v = parseNumber(ans);
        if (v === null) return { ok: false, message: 'Écris un nombre (avec une virgule si besoin).' };
        return { ok: Math.abs(v - expected) <= tol };
      },
      { expected }
    ),
    solution,
    key,
  };
}

// Série de questions toutes différentes à partir d'un modèle.
export function generateFromTemplate(definition, count) {
  const out = [];
  const seen = new Set();
  for (let guard = 0; out.length < count && guard < count * 60; guard++) {
    const q = buildQuestion(definition);
    if (seen.has(q.key)) continue;
    seen.add(q.key);
    out.push(q);
  }
  // Peu de tirages possibles (ex. une seule variable sur 3 valeurs) : on complète en autorisant les répétitions.
  while (out.length < count) out.push(buildQuestion(definition));
  return out;
}

// ---------- Validation d'un modèle ----------

const NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,15}$/;

// Renvoie la liste des problèmes (vide = modèle valide).
// Utilisée en direct dans l'éditeur ET par le serveur avant enregistrement.
export function validateDefinition(def) {
  const errors = [];
  const add = (m) => errors.push(m);
  if (!def || typeof def !== 'object') return ['Modèle illisible.'];

  const variables = Array.isArray(def.variables) ? def.variables : [];
  if (variables.length > MAX_VARIABLES) add(`${MAX_VARIABLES} variables au maximum.`);
  const names = new Set();
  for (const [i, v] of variables.entries()) {
    const where = `Variable ${i + 1}`;
    if (!v || !NAME_RE.test(String(v.name || ''))) {
      add(`${where} : nom invalide (une lettre puis lettres, chiffres ou _, 16 caractères max).`);
      continue;
    }
    if (names.has(v.name)) add(`${where} : le nom « ${v.name} » est utilisé deux fois.`);
    names.add(v.name);
    if (FUNCTIONS[v.name.toLowerCase()]) add(`${where} : « ${v.name} » est déjà le nom d'une fonction.`);
    if (v.type === 'liste') {
      const values = Array.isArray(v.values) ? v.values : [];
      if (!values.length) add(`${where} : ajoute au moins une valeur à la liste.`);
      if (values.length > 50) add(`${where} : 50 valeurs au maximum.`);
    } else if (v.type === 'entier' || v.type === 'decimal') {
      const min = Number(v.min);
      const max = Number(v.max);
      if (!Number.isFinite(min) || !Number.isFinite(max)) add(`${where} : bornes manquantes ou illisibles.`);
      else if (min > max) add(`${where} : le minimum (${min}) dépasse le maximum (${max}).`);
      else if (Math.abs(min) > 1e6 || Math.abs(max) > 1e6) add(`${where} : bornes trop grandes (1 000 000 maximum).`);
      if (v.type === 'decimal' && v.decimals !== undefined && !(Number.isInteger(v.decimals) && v.decimals >= 0 && v.decimals <= 6)) {
        add(`${where} : nombre de décimales invalide (0 à 6).`);
      }
    } else {
      add(`${where} : type inconnu « ${v.type} ».`);
    }
  }

  // Toute formule doit n'utiliser que des variables déclarées.
  const checkFormula = (src, where) => {
    try {
      const ast = parseFormula(src);
      for (const name of formulaVariables(ast)) {
        if (!names.has(name)) add(`${where} : variable « ${name} » non déclarée.`);
      }
      return ast;
    } catch (e) {
      add(`${where} : ${e.message}`);
      return null;
    }
  };

  const checkText = (text, where, { required = false } = {}) => {
    const s = String(text ?? '');
    if (required && !s.trim()) add(`${where} : à remplir.`);
    if (s.length > MAX_TEXT) add(`${where} : texte trop long (${MAX_TEXT} caractères maximum).`);
    if ((s.match(/\[\[/g) || []).length !== (s.match(/\]\]/g) || []).length) add(`${where} : un [[ ou un ]] n'est pas refermé.`);
    for (const f of textFormulas(s)) checkFormula(f, `${where}, [[${f}]]`);
  };

  checkText(def.prompt, "L'énoncé", { required: true });
  checkText(def.solution, 'La correction');
  for (const [i, c] of (def.constraints || []).entries()) {
    if (String(c ?? '').trim()) checkFormula(c, `Condition ${i + 1}`);
  }

  const answer = def.answer || {};
  if (answer.kind === 'choice') {
    const options = Array.isArray(answer.options) ? answer.options : [];
    if (options.length < 2) add('Réponse à choix : il faut au moins deux propositions.');
    if (options.length > MAX_CHOICES) add(`Réponse à choix : ${MAX_CHOICES} propositions au maximum.`);
    const correct = options.filter((o) => o?.correct).length;
    if (correct !== 1) add('Réponse à choix : coche exactement une bonne proposition.');
    options.forEach((o, i) => checkText(o?.text, `Proposition ${i + 1}`, { required: true }));
  } else if (answer.kind === 'number') {
    checkFormula(answer.formula, 'La bonne réponse');
    if (answer.tolerance !== undefined && answer.tolerance !== '' && !Number.isFinite(Number(answer.tolerance))) {
      add('La tolérance doit être un nombre.');
    }
    if (String(answer.unit || '').length > 20) add('Unité trop longue (20 caractères maximum).');
  } else if (answer.kind === 'expression') {
    const src = String(answer.expected ?? '');
    if (!src.trim()) add('La bonne réponse : écris l’expression attendue (ex. -x-1).');
    else {
      checkText(src, 'La bonne réponse');
      // Elle doit rester lisible une fois les variables remplacées : on teste
      // sur un tirage réel, ce qui attrape aussi les [[ ]] mal placés.
      try {
        if (!parsePoly(substitute(src, rollVariables(def)))) add(`La bonne réponse : « ${src} » n’est pas une expression reconnue (ex. -x-1, 2x^2+3x-5).`);
      } catch (e) {
        add(`La bonne réponse : ${e.message}`);
      }
    }
  } else if (answer.kind === 'texte') {
    const accepted = Array.isArray(answer.accepted) ? answer.accepted.filter((a) => String(a ?? '').trim()) : [];
    if (!accepted.length) add('Réponse en toutes lettres : indique au moins une réponse acceptée.');
    if (accepted.length > 10) add('Réponse en toutes lettres : 10 formulations acceptées au maximum.');
    accepted.forEach((a, i) => checkText(a, `Réponse acceptée ${i + 1}`));
  } else {
    add('Type de réponse inconnu (nombre, expression, texte ou choix).');
  }

  // Dernier filet : on tire réellement quelques questions. Cela attrape les
  // contraintes impossibles et les divisions par zéro qu'aucune règle ne voit.
  if (!errors.length) {
    try {
      for (let i = 0; i < 5; i++) buildQuestion(def);
    } catch (e) {
      add(`Essai de génération : ${e.message}`);
    }
  }
  return errors;
}
