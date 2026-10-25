// Correction des séries d'exercices, côté serveur.
//
// Le navigateur tire les questions — c'est ce qui rend la plateforme
// instantanée — mais il ne décide pas du score. Le serveur donne une graine au
// début de la série, la retient, puis rejoue exactement les mêmes questions
// pour corriger lui-même les réponses reçues.
//
// Conséquence : un élève peut envoyer ce qu'il veut, le score enregistré est
// celui de ses vraies réponses. Et le détail que lit l'enseignant dans « Où ça
// coince » devient fiable, puisque c'est le serveur qui le remplit.
const crypto = require('node:crypto');

// Au-delà, on considère la série abandonnée : on ne corrige plus.
const EXPIRATION_MS = 6 * 3600 * 1000;
const MAX_REPONSE = 200;

class SeriesError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function createSeriesService({ repos, shared }) {
  const { random, generators, template } = {
    random: shared.random,
    generators: shared.generators,
    template: shared.template,
  };

  // Rejoue la série d'une graine donnée. Même code que le navigateur, même
  // graine : mêmes questions, dans le même ordre.
  function rejouer({ step, seed }) {
    return random.withSeed(seed, () =>
      step.template ? template.generateFromTemplate(step.template, step.count) : generators.generateSet(step.generator, step.count, step.params)
    );
  }

  return {
    EXPIRATION_MS,

    // Ouvre une série : le serveur choisit la graine et la retient.
    open(user, { chapterId, stepId, step, mode = 'parcours' }) {
      const id = crypto.randomBytes(16).toString('hex');
      const seed = crypto.randomBytes(12).toString('hex');
      repos.exerciseSessions.create({ id, userId: user.id, chapterId, stepId, seed, count: step.count, mode });
      return { sessionId: id, seed, count: step.count };
    },

    // Corrige les réponses reçues. `resolveStep` rend l'étape correspondant à
    // la série, et refait au passage les contrôles d'accès — une série ouverte
    // hier ne doit pas donner un droit d'entrée aujourd'hui.
    grade(user, { sessionId, answers, durationS }, resolveStep) {
      const s = repos.exerciseSessions.find(String(sessionId || ''));
      if (!s || s.user_id !== user.id) throw new SeriesError('Série introuvable', 404);
      if (s.used_at) throw new SeriesError('Cette série a déjà été enregistrée', 409);
      if (Date.now() - Date.parse(s.created_at) > EXPIRATION_MS) throw new SeriesError('Série trop ancienne, recommence-la', 410);

      const step = resolveStep(s);
      const questions = rejouer({ step, seed: s.seed });
      if (questions.length !== s.count) throw new SeriesError('La série n’a pas pu être rejouée', 500);

      // Les réponses arrivent dans l'ordre des questions. Tout ce qui manque
      // compte comme non répondu — donc faux, jamais juste par défaut.
      const donnees = Array.isArray(answers) ? answers : [];
      const detail = questions.map((q, i) => {
        const brut = donnees[i];
        const donnee = String(brut?.given ?? '').slice(0, MAX_REPONSE);
        let ok = false;
        if (donnee !== '') {
          try {
            ok = q.check(donnee).ok === true;
          } catch {
            ok = false; // une réponse illisible n'est pas une bonne réponse
          }
        }
        return {
          position: i + 1,
          prompt: q.prompt,
          expected: generators.expectedText(q),
          given: q.input.kind === 'choice' ? String(q.input.options?.[Number(donnee)] ?? donnee) : donnee,
          ok,
          durationS: Number.isInteger(brut?.durationS) && brut.durationS >= 0 && brut.durationS < 7200 ? brut.durationS : null,
        };
      });

      if (!repos.exerciseSessions.consume(s.id)) throw new SeriesError('Cette série a déjà été enregistrée', 409);

      const score = detail.filter((d) => d.ok).length;
      const duree = Number.isInteger(durationS) && durationS >= 0 && durationS < 86400 ? durationS : null;
      return { session: s, step, score, total: questions.length, durationS: duree, detail };
    },

    // Les séries abandonnées ne servent plus à rien passé le délai.
    purgeExpirees: () => repos.exerciseSessions.purge(new Date(Date.now() - EXPIRATION_MS).toISOString()),
  };
}

module.exports = { createSeriesService, SeriesError };
