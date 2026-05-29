// ========================================================
//  STORAGE LAYER — Account, Languages, Words, SRS, Folders
//  russian-flashcards
// ========================================================

const ACCOUNTS_KEY = 'flashcards_accounts';
const SESSION_KEY = 'flashcards_session';

// Legacy keys (for migration of pre-account data)
const LEGACY_LANGS_KEY = 'flashcards_languages_v2';
const LEGACY_DECK_PREFIX = 'flashcards_deck_v2_';
const LEGACY_SRS_PREFIX = 'flashcards_srs_v2_';

// ── Session management ─────────────────────────────────
function getCurrentSession() {
  try { const raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) : null; }
  catch(e) { return null; }
}
function saveSession(accountId, username) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ accountId, username }));
}
function clearSession() { localStorage.removeItem(SESSION_KEY); }

// ── Account store ──────────────────────────────────────
function loadAccounts() {
  try { const raw = localStorage.getItem(ACCOUNTS_KEY); return raw ? JSON.parse(raw) : {}; }
  catch(e) { return {}; }
}
function saveAccounts(accounts) { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts)); }

// ── Password hashing (SHA-256 via Web Crypto) ──────────
function generateSalt() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + salt);
  // crypto.subtle requires secure context (HTTPS or localhost); fallback for http://ip access
  if (crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback: iterated simple hash for non-secure contexts (e.g. phone via IP)
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < data.length; i++) {
    h1 = Math.imul(h1 ^ data[i], 2654435761);
    h2 = Math.imul(h2 ^ data[i], 1597334677);
  }
  // Multiple rounds for basic stretching
  for (let r = 0; r < 1000; r++) {
    h1 = Math.imul(h1 ^ (h2 >>> 16), 2654435761);
    h2 = Math.imul(h2 ^ (h1 & 0xffff), 1597334677);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

// ── Key namespace helper ───────────────────────────────
function getStorageKey(suffix) {
  const session = getCurrentSession();
  if (!session || !session.accountId) throw new Error('No active account session');
  return 'flashcards_' + session.accountId + '_' + suffix;
}

// ── Namespaced localStorage I/O ────────────────────────
function loadLangsFromStorage() {
  try { const raw = localStorage.getItem(getStorageKey('languages_v2')); return raw ? JSON.parse(raw) : null; }
  catch(e) { return null; }
}
function saveLangsToStorage(langs) { localStorage.setItem(getStorageKey('languages_v2'), JSON.stringify(langs)); }

function loadDeckFromStorage(lang, folderId) {
  const suffix = folderId ? 'deck_v2_' + lang + '_' + folderId : 'deck_v2_' + lang;
  try { const raw = localStorage.getItem(getStorageKey(suffix)); return raw ? JSON.parse(raw) : null; }
  catch(e) { return null; }
}
function saveDeckToStorage(lang, words, folderId) {
  const suffix = folderId ? 'deck_v2_' + lang + '_' + folderId : 'deck_v2_' + lang;
  localStorage.setItem(getStorageKey(suffix), JSON.stringify(words));
}

function loadSRSFromStorage(lang, folderId) {
  const suffix = folderId ? 'srs_v2_' + lang + '_' + folderId : 'srs_v2_' + lang;
  try { const raw = localStorage.getItem(getStorageKey(suffix)); return raw ? JSON.parse(raw) : {}; }
  catch(e) { return {}; }
}
function saveSRSToStorage(lang, data, folderId) {
  const suffix = folderId ? 'srs_v2_' + lang + '_' + folderId : 'srs_v2_' + lang;
  localStorage.setItem(getStorageKey(suffix), JSON.stringify(data));
}

// Folder list I/O
function loadFoldersFromStorage(lang) {
  try { const raw = localStorage.getItem(getStorageKey('folders_v2_' + lang)); return raw ? JSON.parse(raw) : null; }
  catch(e) { return null; }
}
function saveFoldersToStorage(lang, flds) { localStorage.setItem(getStorageKey('folders_v2_' + lang), JSON.stringify(flds)); }

// ========================================================
//  AUTH OPERATIONS (register, login)
// ========================================================
async function registerAccount(username, password) {
  const accounts = loadAccounts();
  const exists = Object.values(accounts).some(a => a.username.toLowerCase() === username.toLowerCase());
  if (exists) return { success: false, error: '用户名已存在。' };

  const accountId = crypto.randomUUID ? crypto.randomUUID() : 'acct-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);

  accounts[accountId] = { username, passwordHash, salt, createdAt: new Date().toISOString() };
  saveAccounts(accounts);
  return { success: true, accountId, username };
}

async function loginAccount(username, password) {
  const accounts = loadAccounts();
  const entry = Object.entries(accounts).find(([_, a]) => a.username.toLowerCase() === username.toLowerCase());
  if (!entry) return { success: false, error: '账户不存在。' };

  const [accountId, account] = entry;
  const passwordHash = await hashPassword(password, account.salt);
  if (passwordHash !== account.passwordHash) return { success: false, error: '密码错误。' };

  return { success: true, accountId, username: account.username };
}

// ========================================================
//  DATA MIGRATION (legacy non-namespaced -> namespaced)
// ========================================================
function detectLegacyData() {
  return localStorage.getItem(LEGACY_LANGS_KEY) !== null;
}

function migrateLegacyData(accountId) {
  const langsJson = localStorage.getItem(LEGACY_LANGS_KEY);
  if (!langsJson) return { migrated: false };

  const langs = JSON.parse(langsJson);
  localStorage.setItem('flashcards_' + accountId + '_languages_v2', langsJson);

  for (const langMeta of langs) {
    const langCode = langMeta.lang;
    const oldDeckKey = LEGACY_DECK_PREFIX + langCode;
    const oldSrsKey = LEGACY_SRS_PREFIX + langCode;
    const deckJson = localStorage.getItem(oldDeckKey);
    if (deckJson !== null) {
      localStorage.setItem('flashcards_' + accountId + '_deck_v2_' + langCode, deckJson);
      localStorage.removeItem(oldDeckKey);
    }
    const srsJson = localStorage.getItem(oldSrsKey);
    if (srsJson !== null) {
      localStorage.setItem('flashcards_' + accountId + '_srs_v2_' + langCode, srsJson);
      localStorage.removeItem(oldSrsKey);
    }
  }
  localStorage.removeItem(LEGACY_LANGS_KEY);

  // Catch orphaned keys
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(LEGACY_DECK_PREFIX)) {
      const langCode = key.slice(LEGACY_DECK_PREFIX.length);
      localStorage.setItem('flashcards_' + accountId + '_deck_v2_' + langCode, localStorage.getItem(key));
      localStorage.removeItem(key);
    }
    if (key && key.startsWith(LEGACY_SRS_PREFIX)) {
      const langCode = key.slice(LEGACY_SRS_PREFIX.length);
      localStorage.setItem('flashcards_' + accountId + '_srs_v2_' + langCode, localStorage.getItem(key));
      localStorage.removeItem(key);
    }
  }
  return { migrated: true };
}
