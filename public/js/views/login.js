import { api } from '../api.js';
import { navigate, setUser } from '../app.js';
import { esc } from '../ui.js';

export function loginView({ el, query }) {
  el.innerHTML = `
  <section class="login">
    <div class="login-figure" aria-hidden="true">
      <svg viewBox="0 0 320 320">
        <path class="lf-axis" d="M40 280 V30 M40 280 H300"/>
        <path class="lf-curve" d="M40 270 C 110 260, 150 200, 180 150 S 250 50, 300 40"/>
        <path class="lf-line" d="M40 250 L300 90"/>
        <circle class="lf-pt" cx="165" cy="173" r="7"/>
      </svg>
    </div>
    <form class="login-card" novalidate>
      <h1>Connexion</h1>
      <p class="muted">Ton identifiant et ton mot de passe t'ont été donnés par ton professeur.</p>
      <label class="field"><span>Identifiant</span><input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
      <label class="field"><span>Mot de passe</span>
        <span class="pw"><input name="password" type="password" autocomplete="current-password" required><button type="button" class="linkbtn" data-toggle>Afficher</button></span>
      </label>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn big" type="submit">Se connecter</button>
    </form>
  </section>`;

  const form = el.querySelector('form');
  const err = el.querySelector('.form-error');
  const pw = form.password;
  form.querySelector('[data-toggle]').onclick = (e) => {
    pw.type = pw.type === 'password' ? 'text' : 'password';
    e.target.textContent = pw.type === 'password' ? 'Afficher' : 'Masquer';
  };
  form.username.focus();

  form.onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (!form.username.value.trim() || !pw.value) {
      err.textContent = 'Remplis ton identifiant et ton mot de passe.';
      err.hidden = false;
      return;
    }
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Connexion…';
    try {
      const { user } = await api.post('/auth/login', { username: form.username.value.trim(), password: pw.value });
      setUser(user);
      const next = query.get('suite');
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', true);
    } catch (ex) {
      err.innerHTML = esc(ex.message);
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Se connecter';
      pw.select();
    }
  };
}
