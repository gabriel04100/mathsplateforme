// Gestion des classes et des comptes élèves par l'enseignant.
//
// Un compte élève = un identifiant de connexion + un pseudonyme. Aucune donnée
// nominative : le lien pseudonyme ↔ élève est tenu par l'enseignant en dehors
// de la plateforme (voir server/services/pseudonyms.js et la migration 011).
const crypto = require('node:crypto');
const { genererPseudonyme, nettoyerPseudonyme } = require('./pseudonyms');

class AccountError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Mots faciles à lire et à taper pour des collégiens (pas d'accents, pas de lettres ambiguës).
const WORDS = [
  'pomme', 'tigre', 'lune', 'cactus', 'volcan', 'rivage', 'zebre', 'nuage', 'piano', 'fusee', 'citron', 'castor',
  'comete', 'dragon', 'orage', 'panda', 'radis', 'sabre', 'tulipe', 'vague', 'kiwi', 'menthe', 'robot', 'soleil',
  'banane', 'koala', 'cerise', 'galet', 'hibou', 'jungle', 'loutre', 'mangue', 'navire', 'olive', 'phare', 'renard',
];
const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;
const MAX_PASSWORD_LENGTH = 72; // bcrypt tronque silencieusement au-delà

function generatePassword() {
  const w = WORDS[crypto.randomInt(WORDS.length)];
  return `${w}${crypto.randomInt(10, 100)}`;
}

function slug(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 30);
}

function currentSchoolYear(d = new Date()) {
  const y = d.getFullYear();
  return d.getMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`; // bascule en août
}

// Pseudonyme d'une entrée : celui que l'enseignant a saisi, ou un tirage.
// `pris` contient les pseudonymes déjà en base et ceux du lot en cours.
function readPseudonym(entry, label, pris) {
  const brut = entry.pseudonym ?? entry.displayName;
  if (brut === undefined || String(brut).trim() === '') return genererPseudonyme((n) => pris.has(n));
  const nom = nettoyerPseudonyme(brut);
  if (!nom) {
    throw new AccountError(
      `${label} : « ${String(brut).trim()} » n'est pas un pseudonyme valable (lettres, espaces et traits d'union, 2 à 40 caractères, pas de chiffre)`
    );
  }
  if (pris.has(nom)) throw new AccountError(`${label} : le pseudonyme « ${nom} » est déjà utilisé`, 409);
  return nom;
}

function checkPasswordLength(password, label) {
  if (password.length < 6) throw new AccountError(`${label} : mot de passe trop court (6 caractères minimum)`);
  if (password.length > MAX_PASSWORD_LENGTH) throw new AccountError(`${label} : mot de passe trop long (${MAX_PASSWORD_LENGTH} caractères maximum)`);
}

function createAccountsService({ repos, auth, content }) {
  // Les niveaux existants viennent du programme (content/levels.json) :
  // une seule source de vérité, pas une copie à tenir à jour.
  const estNiveau = (id) => content.levels().some((l) => l.id === id);
  function ownedClass(teacherId, classId) {
    const c = repos.classes.findById(Number(classId));
    if (!c || c.teacher_id !== teacherId) throw new AccountError('Classe introuvable', 404);
    return c;
  }

  function ownedStudent(teacherId, studentId) {
    const u = repos.users.findById(Number(studentId));
    if (!u || u.role !== 'student') throw new AccountError('Élève introuvable', 404);
    const c = u.class_id ? repos.classes.findById(u.class_id) : null;
    if (!c || c.teacher_id !== teacherId) throw new AccountError('Élève introuvable', 404);
    return u;
  }

  // Identifiant libre, en tenant compte de la base ET des identifiants du lot en cours.
  function uniqueUsername(base, taken = new Set()) {
    let name = base || 'eleve';
    if (name.length < 3) name = `${name}.eleve`;
    let candidate = name;
    let i = 2;
    while (taken.has(candidate) || repos.users.findByUsername(candidate)) candidate = `${name}${i++}`;
    return candidate;
  }

  // Ce qu'un élève expose : un pseudonyme, jamais un nom. `displayName` est
  // conservé parce que tout l'affichage s'appuie dessus — c'est le pseudonyme.
  const publicStudent = (u) => ({
    id: u.id,
    username: u.username,
    pseudonym: u.display_name,
    displayName: u.display_name,
    classId: u.class_id,
    active: !!u.active,
    lastLoginAt: u.last_login_at,
    createdAt: u.created_at,
  });

  return {
    currentSchoolYear,
    publicStudent,
    generatePassword,

    listClasses: (teacherId, { archived = false } = {}) => repos.classes.listByTeacher(teacherId, { archived: archived ? 1 : 0 }),
    countArchivedClasses: (teacherId) => repos.classes.listByTeacher(teacherId, { archived: 1 }).length,

    createClass(teacherId, { name, level, schoolYear }) {
      name = String(name || '').trim();
      if (!name || name.length > 40) throw new AccountError('Nom de classe requis (40 caractères max)');
      if (!estNiveau(level)) throw new AccountError('Niveau invalide');
      try {
        const id = repos.classes.create({ name, level, teacherId, schoolYear: schoolYear || currentSchoolYear() });
        return repos.classes.findById(id);
      } catch (e) {
        if (String(e.message).includes('UNIQUE')) throw new AccountError('Une classe porte déjà ce nom cette année', 409);
        throw e;
      }
    },

    updateClass(teacherId, classId, { name, level, archived }) {
      ownedClass(teacherId, classId);
      if (level !== undefined && !estNiveau(level)) throw new AccountError('Niveau invalide');
      repos.classes.update(Number(classId), {
        name: name?.trim() || undefined,
        level,
        archived: archived === undefined ? undefined : archived ? 1 : 0,
      });
      return repos.classes.findById(Number(classId));
    },

    deleteClass(teacherId, classId) {
      ownedClass(teacherId, classId);
      // Les comptes élèves de la classe sont supprimés avec elle (et leur progression).
      repos.transaction(() => {
        for (const s of repos.users.listByClass(Number(classId))) repos.users.remove(s.id);
        repos.classes.remove(Number(classId));
      });
    },

    getClass: ownedClass,

    listStudents(teacherId, classId) {
      ownedClass(teacherId, classId);
      return repos.users.listByClass(Number(classId)).map(publicStudent);
    },

    // Un pseudonyme libre, à proposer dans l'interface.
    suggestPseudonym: () => genererPseudonyme((n) => repos.users.displayNamesTaken().has(n)),

    // Création en lot. Chaque entrée : { pseudonym?, username?, password? }.
    // Tout est facultatif : une entrée vide donne un compte entièrement tiré au
    // sort. Les mots de passe en clair ne sont renvoyés QU'UNE fois.
    async createStudents(teacherId, classId, entries) {
      const cls = ownedClass(teacherId, classId);
      if (!Array.isArray(entries) || !entries.length) throw new AccountError('Aucun élève à créer');
      if (entries.length > 200) throw new AccountError('200 élèves maximum par envoi');

      const prepared = [];
      const taken = new Set();
      const pseudosPris = repos.users.displayNamesTaken();
      for (const [i, e] of entries.entries()) {
        const label = `Ligne ${i + 1}`;
        const pseudonym = readPseudonym(e, label, pseudosPris);
        pseudosPris.add(pseudonym);
        let username = String(e.username || '').trim().toLowerCase();
        if (username) {
          if (!USERNAME_RE.test(username)) throw new AccountError(`${label} : identifiant « ${username} » invalide (3 à 40 caractères : lettres, chiffres, . _ -)`);
          if (repos.users.findByUsername(username) || taken.has(username)) throw new AccountError(`${label} : identifiant « ${username} » déjà utilisé`, 409);
        } else {
          username = uniqueUsername(slug(pseudonym), taken);
        }
        taken.add(username);
        const password = String(e.password || '').trim() || generatePassword();
        checkPasswordLength(password, label);
        prepared.push({ pseudonym, username, password });
      }

      const hashes = await Promise.all(prepared.map((p) => auth.hashPassword(p.password)));
      const created = [];
      repos.transaction(() => {
        prepared.forEach((p, i) => {
          const id = repos.users.create({
            username: p.username,
            passwordHash: hashes[i],
            role: 'student',
            displayName: p.pseudonym,
            classId: cls.id,
          });
          created.push({ id, pseudonym: p.pseudonym, displayName: p.pseudonym, username: p.username, password: p.password, className: cls.name });
        });
      });
      return created;
    },

    async updateStudent(teacherId, studentId, { pseudonym, displayName, password, classId, active, resetPassword, username }) {
      const u = ownedStudent(teacherId, studentId);
      const fields = {};
      let newPassword = null;
      const nouveauPseudo = pseudonym ?? displayName;
      if (nouveauPseudo !== undefined) {
        const pris = repos.users.displayNamesTaken();
        pris.delete(u.display_name); // garder le sien n'est pas un conflit
        fields.displayName = readPseudonym({ pseudonym: nouveauPseudo }, 'Élève', pris);
      }
      if (username !== undefined) {
        const un = String(username).trim().toLowerCase();
        if (!USERNAME_RE.test(un)) throw new AccountError('Identifiant invalide');
        const other = repos.users.findByUsername(un);
        if (other && other.id !== u.id) throw new AccountError('Identifiant déjà utilisé', 409);
        fields.username = un;
      }
      if (classId !== undefined) fields.classId = ownedClass(teacherId, classId).id;
      if (active !== undefined) fields.active = active ? 1 : 0;
      if (resetPassword || password) {
        newPassword = password ? String(password) : generatePassword();
        checkPasswordLength(newPassword, 'Élève');
        fields.passwordHash = await auth.hashPassword(newPassword);
      }
      repos.users.update(u.id, fields);
      if (fields.passwordHash || fields.active === 0) auth.closeAllSessionsOf(u.id);
      return { student: publicStudent(repos.users.findById(u.id)), ...(newPassword ? { password: newPassword } : {}) };
    },

    deleteStudent(teacherId, studentId) {
      const u = ownedStudent(teacherId, studentId);
      repos.users.remove(u.id);
    },

    resetProgress(teacherId, studentId) {
      const u = ownedStudent(teacherId, studentId);
      repos.transaction(() => {
        repos.progress.resetForUser(u.id);
        // Le détail des réponses part avec : remettre à zéro doit tout effacer,
        // sinon le diagnostic continuerait de compter d'anciennes erreurs.
        repos.questionResults.resetForUser(u.id);
        repos.confidence.resetForUser(u.id);
      });
    },

    async createTeacher({ username, password, displayName }) {
      username = String(username || '').trim().toLowerCase();
      if (!USERNAME_RE.test(username)) throw new AccountError('Identifiant enseignant invalide');
      if (String(password || '').length < 8) throw new AccountError('Mot de passe enseignant : 8 caractères minimum');
      if (repos.users.findByUsername(username)) throw new AccountError('Identifiant déjà utilisé', 409);
      const id = repos.users.create({ username, passwordHash: await auth.hashPassword(password), role: 'teacher', displayName: displayName || username });
      return repos.users.findById(id);
    },
  };
}

module.exports = { createAccountsService, AccountError, generatePassword, currentSchoolYear };
