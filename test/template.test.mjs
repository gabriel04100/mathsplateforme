// Moteur de modèles d'exercices : formules, tirages, validation, sécurité.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFormula,
  evaluate,
  buildQuestion,
  generateFromTemplate,
  validateDefinition,
  renderText,
  TemplateError,
} from '../public/js/exercises/template.js';

const ev = (src, vars = {}) => evaluate(parseFormula(src), vars);

test('les formules respectent les priorités et les parenthèses', () => {
  assert.equal(ev('2 + 3 * 4'), 14);
  assert.equal(ev('(2 + 3) * 4'), 20);
  assert.equal(ev('-3 + 10'), 7);
  assert.equal(ev('2 ^ 3 ^ 2'), 512); // puissance associative à droite
  assert.equal(ev('10 / 4'), 2.5);
  assert.equal(ev('7 % 3'), 1);
  assert.equal(ev('a * b + c', { a: 2, b: 3, c: 4 }), 10);
});

test('les fonctions et les comparaisons sont disponibles', () => {
  assert.equal(ev('pgcd(12, 18)'), 6);
  assert.equal(ev('ppcm(4, 6)'), 12);
  assert.equal(ev('racine(81)'), 9);
  assert.equal(ev('arrondi(3.14159, 2)'), 3.14);
  assert.equal(ev('max(3, 7, 5)'), 7);
  assert.equal(ev('est_entier(10 / 5)'), 1);
  assert.equal(ev('est_entier(10 / 4)'), 0);
  assert.equal(ev('a <> b', { a: 1, b: 2 }), 1);
  assert.equal(ev('a <> b', { a: 2, b: 2 }), 0);
  assert.equal(ev('a > 1 et a < 5', { a: 3 }), 1);
  assert.equal(ev('a > 1 et a < 5', { a: 9 }), 0);
  assert.equal(ev('non(a = 2)', { a: 2 }), 0);
});

test('les formules invalides sont refusées, sans jamais exécuter de code', () => {
  for (const bad of ['2 +', 'f(3)', '(1 + 2', 'a b', '2 @ 3', '']) {
    assert.throws(() => parseFormula(bad), TemplateError, `devrait refuser : ${bad}`);
  }
  // Une tentative d'évasion reste une simple variable inconnue, jamais du JS exécuté.
  assert.throws(() => ev('constructor'), TemplateError);
  assert.throws(() => ev('process'), TemplateError);
  assert.throws(() => ev('1 / 0'), TemplateError);
});

test('le texte de l’élève est échappé : pas d’injection possible', () => {
  const html = renderText('<img src=x onerror="alert(1)"> et **gras**', {});
  assert.ok(!html.includes('<img'), 'la balise doit être neutralisée');
  assert.ok(html.includes('&lt;img'), 'elle doit apparaître comme du texte');
  assert.ok(html.includes('<strong>gras</strong>'), 'le **gras** reste disponible');
});

test('les [[…]] sont remplacés, avec la virgule française', () => {
  assert.equal(renderText('[[a]] + [[b]] = [[a+b]]', { a: 2, b: 3 }), '2 + 3 = 5');
  // Hors formule : virgule simple. Dans une formule $…$ : virgule LaTeX.
  assert.equal(renderText('[[a/4]]', { a: 5 }), '1,25');
  assert.equal(renderText('$[[a/4]]$', { a: 5 }), '$1{,}25$');
});

const multiplication = {
  variables: [
    { name: 'a', type: 'entier', min: 2, max: 9 },
    { name: 'b', type: 'entier', min: 2, max: 9 },
  ],
  constraints: ['a <> b'],
  prompt: 'Combien font $[[a]] \\times [[b]]$ ?',
  answer: { kind: 'number', formula: 'a*b' },
  solution: '$[[a]] \\times [[b]] = [[a*b]]$',
};

test('un modèle valide produit des questions qui acceptent leur bonne réponse', () => {
  assert.deepEqual(validateDefinition(multiplication), []);
  for (let i = 0; i < 50; i++) {
    const q = buildQuestion(multiplication);
    assert.equal(q.check(String(q.check.expected)).ok, true, 'la bonne réponse doit être acceptée');
    assert.equal(q.check(String(q.check.expected + 1)).ok, false, 'une mauvaise réponse doit être refusée');
    assert.match(q.prompt, /Combien font/);
  }
});

test('les contraintes sont respectées à chaque tirage', () => {
  const def = {
    variables: [
      { name: 'a', type: 'entier', min: 1, max: 20 },
      { name: 'b', type: 'entier', min: 1, max: 20 },
    ],
    constraints: ['a > b', 'est_entier(a / b)'],
    prompt: '$[[a]] \\div [[b]]$',
    answer: { kind: 'number', formula: 'a/b' },
    solution: '',
  };
  assert.deepEqual(validateDefinition(def), []);
  for (let i = 0; i < 40; i++) {
    const q = buildQuestion(def);
    const { a, b } = JSON.parse(q.key);
    assert.ok(a > b, `${a} doit être > ${b}`);
    assert.ok(Number.isInteger(a / b), `${a}/${b} doit tomber juste`);
  }
});

test('une série évite de répéter la même question', () => {
  const set = generateFromTemplate(multiplication, 8);
  assert.equal(set.length, 8);
  assert.equal(new Set(set.map((q) => q.key)).size, 8);
});

test('les questions à choix désignent une seule bonne proposition', () => {
  const def = {
    variables: [{ name: 'n', type: 'entier', min: 2, max: 10 }],
    constraints: [],
    prompt: 'Le nombre $[[n]]$ est-il pair ?',
    answer: {
      kind: 'choice',
      options: [
        { text: 'Oui', correct: true },
        { text: 'Non', correct: false },
      ],
    },
    solution: '',
  };
  assert.deepEqual(validateDefinition(def), []);
  const q = buildQuestion(def);
  assert.equal(q.input.options.length, 2);
  assert.equal(q.check(String(q.check.expected)).ok, true);
  assert.equal(q.check(String(1 - q.check.expected)).ok, false);
});

test('une réponse peut être une expression littérale', () => {
  const def = {
    variables: [{ name: 'a', type: 'entier', min: 2, max: 9 }],
    constraints: [],
    prompt: 'Supprime la parenthèse : $-(x + [[a]])$',
    answer: { kind: 'expression', expected: '-x-[[a]]' },
    solution: '',
  };
  assert.deepEqual(validateDefinition(def), []);
  for (let i = 0; i < 20; i++) {
    const q = buildQuestion(def);
    const a = JSON.parse(q.key).a;
    assert.equal(q.input.kind, 'poly');
    // Toutes les écritures équivalentes sont acceptées.
    for (const bonne of [`-x-${a}`, `-${a}-x`, `- x - ${a}`, `-1x-${a}`]) {
      assert.equal(q.check(bonne).ok, true, `« ${bonne} » devrait être acceptée`);
    }
    assert.equal(q.check(`x-${a}`).ok, false, 'le signe de x compte');
    assert.equal(q.check(`-x+${a}`).ok, false, 'le signe du nombre compte');
    assert.equal(q.check('bonjour').ok, false);
  }
  // Par défaut, une expression non réduite est refusée avec une explication.
  const nonReduit = buildQuestion(def);
  const a = JSON.parse(nonReduit.key).a;
  const res = nonReduit.check(`-x-${a - 1}-1`);
  assert.equal(res.ok, false);
  assert.match(res.message, /réduit/);

  // …sauf si l'enseignant ne l'exige pas.
  const souple = buildQuestion({ ...def, answer: { ...def.answer, reduire: false } });
  const b = JSON.parse(souple.key).a;
  assert.equal(souple.check(`-x-${b - 1}-1`).ok, true);
});

test('une réponse peut être écrite en toutes lettres', () => {
  const def = {
    variables: [],
    constraints: [],
    prompt: 'Comment s’appelle le résultat d’une multiplication ?',
    answer: { kind: 'texte', accepted: ['le produit', 'produit'] },
    solution: '',
  };
  assert.deepEqual(validateDefinition(def), []);
  const q = buildQuestion(def);
  assert.equal(q.input.kind, 'text');
  // Casse, accents, espaces en trop et ponctuation finale sont ignorés.
  for (const bonne of ['le produit', 'Le Produit', '  LE   PRODUIT  ', 'produit.', 'Produit']) {
    assert.equal(q.check(bonne).ok, true, `« ${bonne} » devrait être acceptée`);
  }
  assert.equal(q.check('la somme').ok, false);
  assert.equal(q.check('').ok, false);
});

test('les énoncés acceptent listes, gras et LaTeX', () => {
  const q = buildQuestion({
    variables: [{ name: 'a', type: 'entier', min: 3, max: 3 }],
    constraints: [],
    prompt: 'Méthode :\n- je développe\n- je réduis\n\nCombien font $2 \\times [[a]]$ ?',
    answer: { kind: 'number', formula: '2*a' },
    solution: 'Le résultat est **[[2*a]]**.',
  });
  assert.match(q.prompt, /<ul><li>je développe<\/li><li>je réduis<\/li><\/ul>/);
  assert.match(q.prompt, /\$2 \\times 3\$/, 'le LaTeX passe intact vers KaTeX');
  assert.match(q.solution, /<strong>6<\/strong>/);
  assert.equal(q.check('6').ok, true);
});

test('la validation attrape les modèles que l’élève ne pourrait pas jouer', () => {
  const cases = [
    [{ ...multiplication, prompt: '[[zz]]' }, /non déclarée/],
    [{ ...multiplication, constraints: ['a > 1000'] }, /aucun tirage/],
    [{ ...multiplication, answer: { kind: 'number', formula: 'a / 0' } }, /division par zéro/],
    [{ ...multiplication, prompt: 'oups [[1+1' }, /n'est pas refermé/],
    [{ ...multiplication, prompt: '' }, /à remplir/],
    [{ ...multiplication, variables: [{ name: 'min', type: 'entier', min: 1, max: 2 }] }, /nom d'une fonction/],
    [{ ...multiplication, variables: [{ name: 'a', type: 'entier', min: 9, max: 2 }] }, /dépasse le maximum/],
    [{ ...multiplication, answer: { kind: 'choice', options: [{ text: 'a' }, { text: 'b' }] } }, /exactement une bonne/],
    [{ ...multiplication, answer: { kind: 'autre' } }, /Type de réponse inconnu/],
    [{ ...multiplication, answer: { kind: 'expression', expected: '' } }, /écris l’expression attendue/],
    [{ ...multiplication, answer: { kind: 'expression', expected: 'bonjour' } }, /n’est pas une expression reconnue/],
    [{ ...multiplication, answer: { kind: 'texte', accepted: [] } }, /au moins une réponse acceptée/],
  ];
  for (const [def, pattern] of cases) {
    const errors = validateDefinition(def);
    assert.ok(errors.length, `ce modèle aurait dû être refusé : ${JSON.stringify(def).slice(0, 80)}`);
    assert.match(errors.join(' | '), pattern);
  }
});
