// Vérifie le contenu et TOUS les générateurs d'exercices :
// chaque question générée doit s'afficher sans erreur LaTeX et accepter sa propre bonne réponse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { GENERATORS, generateSet, parsePoly, polyLatex, tex } from '../public/js/exercises/generators.js';
import { WIDGETS } from '../public/js/animations/widgets.js';
import { stepsLatex } from '../public/js/math/expr.js';

const require = createRequire(import.meta.url);
const katex = require('katex');
const { loadContent } = require('../server/services/content.js');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const content = loadContent(path.join(root, 'content'));

function assertLatexOk(html, where) {
  const decoded = html.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  for (const m of decoded.matchAll(/\$([^$]+)\$/g)) {
    assert.doesNotThrow(() => katex.renderToString(m[1], { throwOnError: true }), `${where} : LaTeX invalide « ${m[1]} »`);
  }
  assert.ok(!/undefined|NaN|\[object/.test(html), `${where} : valeur manquante dans « ${html} »`);
}

test('le contenu est valide et chaque étape pointe vers un générateur / widget existant', () => {
  for (const ch of content.chapters.values()) {
    for (const s of ch.steps) {
      if (s.type === 'exercise') assert.ok(GENERATORS[s.generator], `${ch.id}/${s.id} : générateur ${s.generator} inconnu`);
      if (s.type === 'animation') assert.ok(WIDGETS[s.widget], `${ch.id}/${s.id} : widget ${s.widget} inconnu`);
      if (s.type === 'lesson') s.blocks.forEach((b, i) => assertLatexOk(b.html, `${ch.id}/${s.id}#${i}`));
    }
  }
});

test('chaque série générée accepte ses propres bonnes réponses et rend du LaTeX valide', () => {
  for (const ch of content.chapters.values()) {
    for (const s of ch.steps.filter((x) => x.type === 'exercise')) {
      for (let round = 0; round < 40; round++) {
        const set = generateSet(s.generator, s.count, s.params);
        assert.equal(set.length, s.count, `${s.generator} : série incomplète`);
        for (const q of set) {
          const where = `${s.generator}`;
          assertLatexOk(q.prompt, `${where} énoncé`);
          assertLatexOk(q.solution, `${where} correction`);
          const exp = q.check.expected;
          let good;
          if (q.input.kind === 'poly') good = polyLatex(exp).replace(/\s/g, '');
          else if (q.input.kind === 'choice') good = String(exp);
          else good = String(exp).replace('.', ',');
          assert.equal(q.check(good).ok, true, `${where} : la bonne réponse « ${good} » est refusée (${q.prompt})`);
          if (q.input.kind !== 'choice') assert.equal(q.check('123456').ok, false, `${where} : une mauvaise réponse est acceptée`);
        }
      }
    }
  }
});

// Le test précédent ne voit que les générateurs effectivement utilisés par un
// chapitre. Celui-ci couvre tout le registre, y compris ceux écrits en avance.
test('tout générateur enregistré produit des questions jouables', () => {
  for (const id of Object.keys(GENERATORS)) {
    for (let round = 0; round < 20; round++) {
      const set = generateSet(id, 4);
      assert.equal(set.length, 4, `${id} : série incomplète`);
      for (const q of set) {
        assertLatexOk(q.prompt, `${id} énoncé`);
        assertLatexOk(q.solution, `${id} correction`);
        assert.ok(['number', 'poly', 'choice', 'text'].includes(q.input.kind), `${id} : type de réponse inconnu`);
        const exp = q.check.expected;
        const good = q.input.kind === 'poly' ? polyLatex(exp).replace(/\s/g, '') : String(exp).replace('.', ',');
        assert.equal(q.check(good).ok, true, `${id} : la bonne réponse « ${good} » est refusée (${q.prompt})`);
        if (q.input.kind !== 'choice') assert.equal(q.check('123456').ok, false, `${id} : une mauvaise réponse est acceptée`);
      }
    }
  }
});

// La réponse attendue n'a pas la même forme selon le type de question : indice
// pour un QCM, tableau de coefficients pour une expression. Le corrigé papier et
// le suivi de classe ont besoin d'un texte lisible dans tous les cas.
test('la réponse attendue se lit en clair quel que soit le type de question', async () => {
  const { expectedText, expectedMath } = await import('../public/js/exercises/generators.js');
  for (const id of Object.keys(GENERATORS)) {
    const q = generateSet(id, 1)[0];
    const texte = expectedText(q);
    assert.ok(texte, `${id} : réponse attendue vide`);
    assert.ok(!/^\s*[\d.,-]+\s*,\s*[\d.,-]+/.test(texte), `${id} : « ${texte} » ressemble à un tableau de coefficients`);
    assert.ok(!texte.includes('[object'), `${id} : « ${texte} » n'est pas lisible`);
    if (q.input.kind === 'choice') {
      assert.equal(texte, q.input.options[q.check.expected], `${id} : le QCM doit rendre le texte de la bonne proposition`);
    }
    if (q.input.kind === 'poly') {
      assert.equal(expectedMath(q), `$${texte}$`, `${id} : une expression part vers KaTeX`);
      assert.match(texte, /x|^-?\d/, `${id} : « ${texte} » n'est pas une expression`);
    }
  }
});

test('lecture des expressions tapées par les élèves', () => {
  assert.deepEqual(parsePoly('6x+15').coefs, [15, 6, 0]);
  assert.deepEqual(parsePoly(' 15 + 6x ').coefs, [15, 6, 0]);
  assert.deepEqual(parsePoly('x²+5x+6').coefs, [6, 5, 1]);
  assert.deepEqual(parsePoly('-x^2-2x').coefs, [0, -2, -1]);
  assert.deepEqual(parsePoly('−2x+8').coefs, [8, -2, 0]);
  assert.equal(parsePoly('3x+2x+1').reduced, false);
  assert.equal(parsePoly('3y+1'), null);
  assert.equal(parsePoly('x+'), null);
  assert.equal(tex(3.5), '3{,}5');
});

test('calcul pas à pas selon les priorités', () => {
  const plain = (src) => stepsLatex(src).map((s) => s.plain);
  assert.deepEqual(plain('5 + 3 * 4'), ['5 + 3 \\times 4', '5 + 12', '17']);
  assert.deepEqual(plain('20 - 12 / 4 + 1'), ['20 - 12 \\div 4 + 1', '20 - 3 + 1', '17 + 1', '18']);
  assert.equal(plain('(18 - (4 + 2)) / 3').at(-1), '4');
  assert.equal(plain('2 * (7 - 3) + 6 / 2')[1], '2 \\times 4 + 6 \\div 2');
});
