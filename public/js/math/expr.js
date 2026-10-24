// Mini-moteur d'expressions arithmétiques (entiers, + − × ÷, parenthèses).
// Sert aux exercices de priorités ET à l'animation « calcul pas à pas ».

export function tokenize(src) {
  const tokens = [];
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { i++; continue; }
    if (/\d/.test(c)) {
      let j = i;
      while (j < s.length && /[\d.]/.test(s[j])) j++;
      tokens.push({ t: 'num', v: Number(s.slice(i, j)) });
      i = j;
      continue;
    }
    if ('+-*/()'.includes(c)) { tokens.push({ t: c }); i++; continue; }
    throw new Error(`Caractère inattendu : ${c}`);
  }
  return tokens;
}

// Grammaire classique : expr = terme (± terme)* ; terme = facteur (×÷ facteur)* ; facteur = nombre | (expr)
export function parse(src) {
  const tk = tokenize(src);
  let p = 0;
  const peek = () => tk[p];
  function factor() {
    const t = tk[p++];
    if (!t) throw new Error('Expression incomplète');
    if (t.t === 'num') return { type: 'num', value: t.v };
    if (t.t === '(') {
      const e = expr();
      if (tk[p++]?.t !== ')') throw new Error('Parenthèse non fermée');
      return { ...e, paren: true };
    }
    if (t.t === '-') { const f = factor(); return { type: 'num', value: -f.value }; }
    throw new Error('Expression invalide');
  }
  function term() {
    let left = factor();
    while (peek() && (peek().t === '*' || peek().t === '/')) {
      const op = tk[p++].t;
      left = { type: 'op', op, left, right: factor() };
    }
    return left;
  }
  function expr() {
    let left = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = tk[p++].t;
      left = { type: 'op', op, left, right: term() };
    }
    return left;
  }
  const tree = expr();
  if (p !== tk.length) throw new Error('Expression invalide');
  return tree;
}

function apply(op, a, b) {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return a / b;
  }
}

// Évalue ; renvoie null si une division ne tombe pas juste (on veut des calculs « propres »).
export function evaluateExact(node) {
  if (node.type === 'num') return node.value;
  const a = evaluateExact(node.left);
  const b = evaluateExact(node.right);
  if (a === null || b === null) return null;
  if (node.op === '/' && (b === 0 || a % b !== 0)) return null;
  return apply(node.op, a, b);
}

// Une étape de calcul, selon les règles du collège :
// d'abord une parenthèse, puis × ÷, puis + −, toujours l'opération la plus à gauche.
export function nextStep(root) {
  const candidates = [];
  let order = 0;
  (function walk(n) {
    if (n.type !== 'op') { order++; return; }
    walk(n.left);
    const pos = order++;
    walk(n.right);
    if (n.left.type === 'num' && n.right.type === 'num') {
      const rank = n.paren ? 0 : n.op === '*' || n.op === '/' ? 1 : 2;
      candidates.push({ node: n, rank, pos });
    }
  })(root);
  if (!candidates.length) return null;
  candidates.sort((x, y) => x.rank - y.rank || x.pos - y.pos);
  return candidates[0].node;
}

export function reduce(root, target) {
  if (root === target) return { type: 'num', value: apply(root.op, root.left.value, root.right.value) };
  if (root.type === 'num') return root;
  return { ...root, left: reduce(root.left, target), right: reduce(root.right, target) };
}

const OPS = { '+': '+', '-': '-', '*': '\\times', '/': '\\div' };
const fmtNum = (v) => (v < 0 ? `(${String(v).replace('-', '-')})` : String(v)).replace('.', '{,}');

export function toLatex(node, highlight = null) {
  let s;
  if (node.type === 'num') s = fmtNum(node.value);
  else s = `${toLatex(node.left, highlight)} ${OPS[node.op]} ${toLatex(node.right, highlight)}`;
  if (node.paren) s = `\\left(${s}\\right)`;
  if (node === highlight) s = `\\underline{\\textcolor{#e8590c}{${s}}}`;
  return s;
}

// Liste des étapes successives (LaTeX), de l'expression de départ au résultat.
export function stepsLatex(src) {
  let tree = parse(src);
  const lines = [];
  for (let guard = 0; guard < 50; guard++) {
    const n = nextStep(tree);
    lines.push({ latex: toLatex(tree, n), plain: toLatex(tree) });
    if (!n) break;
    tree = reduce(tree, n);
  }
  return lines;
}
