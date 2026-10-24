// Ambiance sonore des jeux, entièrement synthétisée dans le navigateur.
// Aucun fichier audio : la politique de sécurité de la plateforme interdit les
// ressources externes, et cela évite des mégaoctets à télécharger.
//
// Une petite boucle en gamme pentatonique (jamais dissonante, quelles que soient
// les notes tirées) plus deux bruitages courts pour les réponses.

const STORAGE_KEY = 'mp-son';

// Gamme pentatonique de la mineur : agréable même en enchaînant les notes au hasard.
const SCALE = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33];
const BASS = [110.0, 130.81, 146.83, 164.81];
const STEP_MS = 260; // ~115 battements par minute

export function soundEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true; // navigation privée, stockage bloqué… : le son reste disponible
  }
}

function remember(on) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    /* sans stockage, le choix vaut pour la partie en cours */
  }
}

// Crée le moteur audio. À appeler depuis un clic : les navigateurs refusent
// de démarrer le son sans geste de l'utilisateur.
export function createGameAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  let master = null;
  let musicGain = null;
  let timer = null;
  let step = 0;
  let muted = !soundEnabled();

  function ensure() {
    if (ctx || !Ctx) return ctx;
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.16; // la musique reste en arrière-plan
    musicGain.connect(master);
    return ctx;
  }

  // Une note : oscillateur + enveloppe, puis tout est libéré.
  function note(freq, { at = 0, dur = 0.22, type = 'triangle', gain = 0.5, out = musicGain } = {}) {
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function tick() {
    if (!ctx) return;
    // Basse sur les temps forts, mélodie piochée dans la gamme.
    if (step % 4 === 0) note(BASS[(step / 4) % BASS.length], { dur: 0.5, type: 'sine', gain: 0.55 });
    if (step % 2 === 0 || Math.random() < 0.45) {
      note(SCALE[Math.floor(Math.random() * SCALE.length)], { dur: 0.26, type: 'triangle', gain: 0.32 });
    }
    step = (step + 1) % 16;
  }

  return {
    get muted() {
      return muted;
    },

    start() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume();
      if (timer) return;
      step = 0;
      tick();
      timer = setInterval(tick, STEP_MS);
    },

    stop() {
      clearInterval(timer);
      timer = null;
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
      master = null;
      musicGain = null;
    },

    toggleMute() {
      muted = !muted;
      remember(!muted);
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },

    // Décompte de départ : un bip sec à chaque seconde, puis un accord au top.
    countdown(go) {
      if (!ctx || muted) return;
      if (go) {
        note(660, { dur: 0.3, type: 'square', gain: 0.26, out: master });
        note(880, { at: 0.1, dur: 0.32, type: 'square', gain: 0.22, out: master });
        note(1320, { at: 0.2, dur: 0.34, type: 'square', gain: 0.18, out: master });
      } else {
        note(440, { dur: 0.12, type: 'square', gain: 0.18, out: master });
      }
    },

    // Bruitage de réponse : montée claire si c'est juste, note basse sinon.
    blip(ok) {
      if (!ctx || muted) return;
      if (ok) {
        note(660, { dur: 0.1, type: 'square', gain: 0.22, out: master });
        note(990, { at: 0.07, dur: 0.12, type: 'square', gain: 0.18, out: master });
      } else {
        note(150, { dur: 0.2, type: 'sawtooth', gain: 0.16, out: master });
      }
    },
  };
}
