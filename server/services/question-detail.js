// Détail des réponses envoyé par le navigateur en fin de série.
//
// Ces données servent au diagnostic de l'enseignant : ce que la question
// demandait, ce que l'élève a répondu. Elles viennent du client, donc on les
// borne avant de les écrire — mais une série au détail incohérent est
// simplement enregistrée sans détail, jamais rejetée : le score, lui, a déjà
// été validé, et on ne perd pas le travail d'un élève pour un champ mal formé.

const TEXT_MAX = { prompt: 300, expected: 120, given: 120 };
const MAX_DURATION_S = 7200;

const cut = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function cleanQuestionDetail(questions, { attemptId, userId, chapterId, stepId, total }) {
  if (!Array.isArray(questions)) return [];
  return questions
    .slice(0, total)
    .filter((q) => q && typeof q === 'object')
    .map((q, i) => ({
      attemptId,
      userId,
      chapterId,
      stepId,
      position: Number.isInteger(q.position) && q.position > 0 ? q.position : i + 1,
      prompt: cut(q.prompt, TEXT_MAX.prompt),
      expected: cut(q.expected, TEXT_MAX.expected),
      given: cut(q.given, TEXT_MAX.given),
      ok: !!q.ok,
      durationS: Number.isInteger(q.durationS) && q.durationS >= 0 && q.durationS < MAX_DURATION_S ? q.durationS : null,
    }))
    .filter((q) => q.prompt);
}

module.exports = { cleanQuestionDetail };
