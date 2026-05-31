// ========================================================
//  ACCOUNT SYSTEM -- SESSION & STORAGE INFRASTRUCTURE
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
//  AUTH OPERATIONS (register, login, logout)
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

function logoutAccount() {
  clearSession();
  userLanguages = []; WORDS = []; srsData = {}; activeLang = 'ru';
  activeFolderId = null; folders = [];
  flashcardIndex = 0; flashcardFilter = 'all'; flashcardPool = [];
  clearDailySession();
  quizWords = []; quizIndex = 0; quizAnswered = false; listSearchQuery = '';
  document.getElementById('main-content').innerHTML = '';
  document.getElementById('network-info').style.display = 'none';
  showAuthScreen();
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

// ========================================================
//  AUTH UI (screen toggle, tab switching, form handlers)
// ========================================================
function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display = 'none';
  renderAccountList();
}

function showAppScreen() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'block';
}

function showAuthTab(tab) {
  document.getElementById('auth-tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('auth-tab-register').classList.toggle('active', tab === 'register');
  document.getElementById('auth-form-login').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('auth-form-register').style.display = tab === 'register' ? '' : 'none';
  document.getElementById('login-error').textContent = '';
  document.getElementById('register-error').textContent = '';
}

function renderAccountList() {
  const accounts = loadAccounts();
  const list = document.getElementById('account-list');
  const entries = Object.entries(accounts);
  if (entries.length === 0) {
    list.innerHTML = '<div class="account-list-label">暂无账户，请注册</div>' +
      '<div style="margin-top:12px;padding:10px 12px;background:var(--primary-light);border-radius:var(--radius-sm);font-size:13px;color:var(--text-secondary);">' +
      '<i class="fa-solid fa-circle-info"></i> 从其他设备备份过数据？' +
      '<button class="btn btn-outline btn-sm" style="margin-top:8px;width:100%;" onclick="document.getElementById(\'restore-auth-input\').click()">' +
      '<i class="fa-solid fa-cloud-arrow-up"></i> 从备份文件恢复</button>' +
      '<input type="file" id="restore-auth-input" accept=".json" onchange="importFullBackup(event)" style="display:none;">' +
      '</div>';
    return;
  }
  list.innerHTML =
    '<div class="account-list-label">已有账户（点击切换）：</div>' +
    entries.map(([id, acct]) =>
      '<button class="btn btn-ghost account-item" onclick="selectAccount(\'' + id + '\')">' + escHtml(acct.username) + '</button>'
    ).join('');
}

function selectAccount(accountId) {
  const accounts = loadAccounts();
  const account = accounts[accountId];
  if (!account) return;
  document.getElementById('login-username').value = account.username;
  document.getElementById('login-password').value = '';
  document.getElementById('login-password').focus();
  document.getElementById('login-error').textContent = '';
  showAuthTab('login');
}

async function handleLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  if (!username || !password) { errorEl.textContent = '请输入用户名和密码。'; return; }
  const result = await loginAccount(username, password);
  if (!result.success) { errorEl.textContent = result.error; return; }
  saveSession(result.accountId, result.username);
  if (detectLegacyData()) {
    if (confirm('检测到浏览器中有旧数据。\n\n是否迁移到账户「' + result.username + '」？\n点击「确定」迁移，「取消」跳过。')) {
      migrateLegacyData(result.accountId);
    }
  }
  enterApp(result.username);
}

async function handleRegister() {
  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value;
  const pwConfirm = document.getElementById('register-password-confirm').value;
  const errorEl = document.getElementById('register-error');
  errorEl.textContent = '';
  if (!username || !password || !pwConfirm) { errorEl.textContent = '请填写所有字段。'; return; }
  if (username.length < 2) { errorEl.textContent = '用户名至少2个字符。'; return; }
  if (password.length < 4) { errorEl.textContent = '密码至少4个字符。'; return; }
  if (password !== pwConfirm) { errorEl.textContent = '两次密码不一致。'; return; }
  const result = await registerAccount(username, password);
  if (!result.success) { errorEl.textContent = result.error; return; }
  saveSession(result.accountId, result.username);
  if (detectLegacyData()) {
    if (window.confirm('检测到浏览器中有旧数据。\n\n是否迁移到新账户「' + result.username + '」？')) {
      migrateLegacyData(result.accountId);
    }
  }
  enterApp(result.username);
}

async function detectLocalIP() {
  const el = document.getElementById('network-info');
  const urlEl = document.getElementById('local-ip-url');
  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel('');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const ip = await new Promise((resolve) => {
      pc.onicecandidate = (ice) => {
        if (!ice || !ice.candidate) { resolve(null); return; }
        const match = ice.candidate.candidate.match(/([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/);
        if (match) resolve(match[1]);
      };
      setTimeout(() => resolve(null), 2000);
    });
    pc.close();
    if (ip) { urlEl.textContent = 'http://' + ip + ':8080'; el.style.display = ''; }
    else { urlEl.textContent = '无法检测，请查看系统网络设置'; el.style.display = ''; }
  } catch(e) { urlEl.textContent = '无法检测，请查看系统网络设置'; el.style.display = ''; }
}

function enterApp(username) {
  try {
    // Register PWA service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    document.getElementById('current-user').textContent = username;
    showAppScreen();
    applyTheme();
    soundEnabled = localStorage.getItem('flashcards_sound') !== '0';
    hapticEnabled = localStorage.getItem('flashcards_haptic') !== '0';
    flashcardAutoSpeak = localStorage.getItem('flashcards_auto_speak') !== '0';
    manualAdvance = localStorage.getItem('flashcards_manual_advance') === '1';
    listenSpeechRate = parseFloat(localStorage.getItem('flashcards_speech_rate')) || 0.85;
    listenRepeatCount = parseInt(localStorage.getItem('flashcards_repeat_count')) || 1;
    listenTimerDuration = parseInt(localStorage.getItem('flashcards_listen_timer')) || 0;
    document.getElementById('setting-sound').checked = soundEnabled;
    document.getElementById('setting-haptic').checked = hapticEnabled;
    document.getElementById('setting-auto-speak').checked = flashcardAutoSpeak;
    document.getElementById('setting-manual-advance').checked = manualAdvance;
    const streakData = loadStreak();
    dailyGoal = streakData.dailyGoal || 20;
    updateStreakUI();
    loadStarred();
    newWordsPerDay = parseInt(localStorage.getItem(getStorageKey('new_words_per_day'))) || 10;
    cleanupOldSessions();
    // Restore today's session if one exists
    if (restoreSession()) {
      // Session restored - will show resume option when entering flashcard mode
    }
    let langs = loadLangsFromStorage();
    if (!langs) {
      userLanguages = Object.entries(DEFAULT_DECKS).map(([code, meta], i) => ({
        lang: code, name: meta.name, flag: meta.flag,
        speech_lang: meta.speechLang, sort_order: i
      }));
      saveLangsToStorage(userLanguages);
      for (const [code, words] of Object.entries(DEFAULT_WORDS)) {
        const df = { id: (crypto.randomUUID ? crypto.randomUUID() : 'folder-' + Date.now() + '-' + code), name: '默认', sort_order: 0, created_at: new Date().toISOString() };
        saveFoldersToStorage(code, [df]);
        const deck = words.map(w => ({
          id: crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
          ru: w[0], tr: w[1] || '', zh: w[2], pos: w[3] || ''
        }));
        saveDeckToStorage(code, deck, df.id);
        saveSRSToStorage(code, {}, df.id);
      }
    } else { userLanguages = langs; }
    if (!userLanguages.find(l => l.lang === activeLang)) activeLang = userLanguages[0]?.lang || 'ru';
    folders = loadFolders(activeLang);
    activeFolderId = folders.length > 0 ? folders[0].id : null;
    loadDeck(activeLang, activeFolderId);
    renderAll();
    detectLocalIP();
  } catch(e) {
    console.error('enterApp error:', e);
    showToast('加载数据时出错，请尝试刷新页面', '');
  }
}

function loadDeck(lang, folderId) {
  if (!folderId) { WORDS = []; srsData = {}; return; }
  WORDS = loadDeckFromStorage(lang, folderId) || [];
  srsData = loadSRSFromStorage(lang, folderId);
  // Auto-migrate old SM-2 entries to proficiency format
  let srsMigrated = false;
  for (const [wordId, entry] of Object.entries(srsData)) {
    if (entry.proficiency === undefined) {
      srsData[wordId] = migrateSM2ToProficiency(entry);
      srsMigrated = true;
    }
  }
  if (srsMigrated) saveSRSLocal();
  activeFolderId = folderId;
}

function saveDeck() { saveDeckToStorage(activeLang, WORDS, activeFolderId); }
function saveSRSLocal() { saveSRSToStorage(activeLang, srsData, activeFolderId); }

// ========================================================
//  FOLDER MIGRATION
// ========================================================
function migrateLangToFolders(lang) {
  const existing = loadFoldersFromStorage(lang);
  if (existing) return existing;
  const oldWords = loadDeckFromStorage(lang) || [];
  const oldSRS = loadSRSFromStorage(lang);
  const defaultFolder = {
    id: (crypto.randomUUID ? crypto.randomUUID() : 'folder-' + Date.now()),
    name: '默认', sort_order: 0, created_at: new Date().toISOString()
  };
  saveFoldersToStorage(lang, [defaultFolder]);
  saveDeckToStorage(lang, oldWords, defaultFolder.id);
  saveSRSToStorage(lang, oldSRS, defaultFolder.id);
  localStorage.removeItem(getStorageKey('deck_v2_' + lang));
  localStorage.removeItem(getStorageKey('srs_v2_' + lang));
  return [defaultFolder];
}

function insertWordLocal(word, tr, zh, pos) {
  const id = (crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  WORDS.push({ id, ru: word, tr: tr || '', zh, pos: pos || '', example: '', exampleZh: '' });
  saveDeck();
  return id;
}

function updateWordLocal(wordId, word, tr, zh, pos, example, exampleZh) {
  const w = WORDS.find(x => x.id === wordId);
  if (w) { w.ru = word; w.tr = tr; w.zh = zh; w.pos = pos; w.example = example || ''; w.exampleZh = exampleZh || ''; saveDeck(); }
}

function deleteWordLocal(wordId) {
  WORDS = WORDS.filter(x => x.id !== wordId);
  delete srsData[wordId];
  saveDeck();
  saveSRSLocal();
}

function addLangLocal(code, name, flag, speechLang) {
  userLanguages.push({ lang: code, name, flag, speech_lang: speechLang, sort_order: userLanguages.length });
  saveLangsToStorage(userLanguages);
  const df = { id: (crypto.randomUUID ? crypto.randomUUID() : 'folder-' + Date.now()), name: '默认', sort_order: 0, created_at: new Date().toISOString() };
  saveFoldersToStorage(code, [df]);
  saveDeckToStorage(code, [], df.id);
  saveSRSToStorage(code, {}, df.id);
}

function deleteLangLocal(code) {
  const flds = loadFoldersFromStorage(code) || [];
  for (const f of flds) {
    localStorage.removeItem(getStorageKey('deck_v2_' + code + '_' + f.id));
    localStorage.removeItem(getStorageKey('srs_v2_' + code + '_' + f.id));
  }
  localStorage.removeItem(getStorageKey('folders_v2_' + code));
  localStorage.removeItem(getStorageKey('deck_v2_' + code));
  localStorage.removeItem(getStorageKey('srs_v2_' + code));
}

// ========================================================
//  FOLDER MANAGEMENT
// ========================================================
function loadFolders(lang) {
  let flds = loadFoldersFromStorage(lang);
  if (!flds) flds = migrateLangToFolders(lang);
  folders = flds;
  return flds;
}

function saveFolders() { saveFoldersToStorage(activeLang, folders); }

function switchFolder(folderId) {
  activeFolderId = folderId;
  flashcardIndex = 0; flashcardFilter = 'all'; flashcardPool = [];
  quizWords = []; quizIndex = 0; quizAnswered = false; listSearchQuery = '';
  listenIndex = 0; listenRepeatRemaining = listenRepeatCount;
  if (listenPlaying) { stopListening(); }
  loadDeck(activeLang, folderId);
  renderAll();
}

function createFolder(name) {
  const folderName = (name || '').trim();
  if (!folderName) { alert('请输入文件夹名称'); return; }
  if (folders.find(f => f.name === folderName)) { alert('该文件夹已存在'); return; }
  const newFolder = {
    id: (crypto.randomUUID ? crypto.randomUUID() : 'folder-' + Date.now()),
    name: folderName, sort_order: folders.length, created_at: new Date().toISOString()
  };
  folders.push(newFolder);
  saveFolders();
  saveDeckToStorage(activeLang, [], newFolder.id);
  saveSRSToStorage(activeLang, {}, newFolder.id);
  switchFolder(newFolder.id);
}

function deleteFolder(folderId) {
  if (folders.length <= 1) { alert('至少需要保留一个文件夹'); return; }
  const f = folders.find(x => x.id === folderId);
  if (!f) return;
  if (!confirm('确定删除文件夹「' + f.name + '」及其所有单词和进度吗？此操作不可恢复。')) return;
  localStorage.removeItem(getStorageKey('deck_v2_' + activeLang + '_' + folderId));
  localStorage.removeItem(getStorageKey('srs_v2_' + activeLang + '_' + folderId));
  folders = folders.filter(x => x.id !== folderId);
  saveFolders();
  if (activeFolderId === folderId) switchFolder(folders[0].id);
  else renderAll();
}

function createFolderPrompt() {
  const name = prompt('请输入文件夹名称：');
  if (name && name.trim()) createFolder(name.trim());
}

function importCreateFolder() {
  const name = prompt('新文件夹名称：');
  if (!name || !name.trim()) return;
  createFolder(name.trim());
  const sel = document.getElementById('import-folder-select');
  if (sel) {
    sel.innerHTML = folders.map(f => '<option value="' + f.id + '"' + (f.id === activeFolderId ? ' selected' : '') + '>' + escHtml(f.name) + '</option>').join('');
  }
}

function getTotalWordsForLang(lang) {
  const flds = loadFoldersFromStorage(lang);
  if (!flds) return (loadDeckFromStorage(lang) || []).length;
  let total = 0;
  for (const f of flds) total += (loadDeckFromStorage(lang, f.id) || []).length;
  return total;
}

// ========================================================
//  DEFAULT WORD DATA
// ========================================================
const DEFAULT_DECKS = {
  ru: { name: '俄语', flag: '🇷🇺', speechLang: 'ru-RU' },
  de: { name: '德语', flag: '🇩🇪', speechLang: 'de-DE' },
  en: { name: '英语', flag: '🇬🇧', speechLang: 'en-US' },
  ko: { name: '韩语', flag: '🇰🇷', speechLang: 'ko-KR' },
  ja: { name: '日语', flag: '🇯🇵', speechLang: 'ja-JP' },
};

const LANGUAGE_PRESETS = [
  { code: 'fr', name: '法语', flag: '🇫🇷', speechLang: 'fr-FR' },
  { code: 'es', name: '西班牙语', flag: '🇪🇸', speechLang: 'es-ES' },
  { code: 'it', name: '意大利语', flag: '🇮🇹', speechLang: 'it-IT' },
  { code: 'pt', name: '葡萄牙语', flag: '🇵🇹', speechLang: 'pt-PT' },
  { code: 'ar', name: '阿拉伯语', flag: '🇸🇦', speechLang: 'ar-SA' },
  { code: 'th', name: '泰语', flag: '🇹🇭', speechLang: 'th-TH' },
  { code: 'vi', name: '越南语', flag: '🇻🇳', speechLang: 'vi-VN' },
  { code: 'tr', name: '土耳其语', flag: '🇹🇷', speechLang: 'tr-TR' },
];

// Default words for each language
const DEFAULT_WORDS = {
  ru: [
    ["приве́т","[prʲɪˈvʲet]","你好","感叹词"],
    ["здра́вствуйте","[ˈzdrastvʊjtʲe]","您好","感叹词"],
    ["до́брое у́тро","[ˈdobrəjə ˈutrə]","早上好","短语"],
    ["до́брый день","[ˈdobrɨj dʲenʲ]","日安","短语"],
    ["до́брый ве́чер","[ˈdobrɨj ˈvʲetɕɪr]","晚上好","短语"],
    ["споко́йной но́чи","[spɐˈkojnəj ˈnotɕɪ]","晚安","短语"],
    ["приве́тствовать","[prʲɪˈvʲet͡stvəvətʲ]","欢迎","动词"],
    ["спаси́бо","[spɐˈsʲibə]","谢谢","感叹词"],
    ["благодарю́","[bləgədɐˈrʲu]","感谢","动词"],
    ["пожа́луйста","[pɐˈʐalʊstə]","请；不客气","语气词"],
    ["извини́те","[ɪzvʲɪˈnʲitʲe]","对不起","感叹词"],
    ["прости́те","[prɐˈsʲtʲitʲe]","请原谅","感叹词"],
    ["да","[da]","是","语气词"],
    ["нет","[nʲet]","不；没有","语气词"],
    ["до свида́ния","[də‿svʲɪˈdanʲɪjə]","再见","短语"],
    ["пока́","[pɐˈka]","拜拜","感叹词"],
    ["как дела́?","[kak‿dʲɪˈla]","你好吗？","短语"],
    ["ничего́","[nʲɪtɕɪˈvo]","还行","副词"],
    ["оди́н","[ɐˈdʲin]","一","数词"],
    ["два","[dva]","二","数词"],
    ["три","[trʲi]","三","数词"],
    ["четы́ре","[tɕɪˈtɨrʲe]","四","数词"],
    ["пять","[pʲætʲ]","五","数词"],
    ["шесть","[ʂesʲtʲ]","六","数词"],
    ["семь","[sʲemʲ]","七","数词"],
    ["во́семь","[ˈvosʲɪmʲ]","八","数词"],
    ["де́вять","[ˈdʲevʲɪtʲ]","九","数词"],
    ["де́сять","[ˈdʲesʲɪtʲ]","十","数词"],
    ["оди́ннадцать","[ɐˈdʲinətsətʲ]","十一","数词"],
    ["двена́дцать","[dvʲɪˈnatsətʲ]","十二","数词"],
    ["два́дцать","[ˈdvatsətʲ]","二十","数词"],
    ["три́дцать","[ˈtrʲitsətʲ]","三十","数词"],
    ["сто","[sto]","一百","数词"],
    ["ты́сяча","[ˈtɨsʲɪtɕə]","一千","数词"],
    ["пе́рвый","[ˈpʲervɨj]","第一","序数词"],
    ["второ́й","[ftɐˈroj]","第二","序数词"],
    ["кра́сный","[ˈkrasnɨj]","红色的","形容词"],
    ["си́ний","[ˈsʲinʲɪj]","蓝色的","形容词"],
    ["зелёный","[zʲɪˈlʲɵnɨj]","绿色的","形容词"],
    ["жёлтый","[ˈʐoltɨj]","黄色的","形容词"],
    ["чёрный","[ˈtɕɵrnɨj]","黑色的","形容词"],
    ["бе́лый","[ˈbʲelɨj]","白色的","形容词"],
    ["се́рый","[ˈsʲerɨj]","灰色的","形容词"],
    ["кори́чневый","[kɐˈrʲitɕnʲɪvɨj]","棕色的","形容词"],
    ["фиоле́товый","[fʲɪɐˈlʲetəvɨj]","紫色的","形容词"],
    ["ора́нжевый","[ɐˈranʐɨvɨj]","橙色的","形容词"],
    ["ро́зовый","[ˈrozəvɨj]","粉色的","形容词"],
    ["сего́дня","[sʲɪˈvodʲnʲə]","今天","副词"],
    ["за́втра","[ˈzaftrə]","明天","副词"],
    ["вчера́","[ftɕɪˈra]","昨天","副词"],
    ["сейча́с","[sʲɪjˈtɕas]","现在","副词"],
    ["пото́м","[pɐˈtom]","然后","副词"],
    ["всегда́","[fsʲɪɡˈda]","总是","副词"],
    ["иногда́","[ɪnɐɡˈda]","有时候","副词"],
    ["ча́сто","[ˈtɕastə]","经常","副词"],
    ["ре́дко","[ˈrʲetkə]","很少","副词"],
    ["у́тром","[ˈutrəm]","在早上","副词"],
    ["днём","[dʲnʲɵm]","在白天","副词"],
    ["ве́чером","[ˈvʲetɕɪrəm]","在晚上","副词"],
    ["но́чью","[ˈnotɕjʊ]","在夜里","副词"],
    ["вре́мя","[ˈvrʲemʲə]","时间","名词"],
    ["час","[tɕas]","小时","名词"],
    ["мину́та","[mʲɪˈnutə]","分钟","名词"],
    ["неде́ля","[nʲɪˈdʲelʲə]","星期","名词"],
    ["ме́сяц","[ˈmʲesʲɪts]","月","名词"],
    ["год","[ɡot]","年","名词"],
    ["понеде́льник","[pənʲɪˈdʲelʲnʲɪk]","星期一","名词"],
    ["вто́рник","[ˈftornʲɪk]","星期二","名词"],
    ["среда́","[srʲɪˈda]","星期三","名词"],
    ["четве́рг","[tɕɪtˈvʲerk]","星期四","名词"],
    ["пя́тница","[ˈpʲætʲnʲɪtsə]","星期五","名词"],
    ["суббо́та","[sʊˈbːotə]","星期六","名词"],
    ["воскресе́нье","[vəskrʲɪˈsʲenʲjə]","星期日","名词"],
    ["янва́рь","[jɪnˈvarʲ]","一月","名词"],
    ["февра́ль","[fʲɪˈvralʲ]","二月","名词"],
    ["март","[mart]","三月","名词"],
    ["апре́ль","[ɐˈprʲelʲ]","四月","名词"],
    ["май","[maj]","五月","名词"],
    ["ию́нь","[ɪˈjʉnʲ]","六月","名词"],
    ["ию́ль","[ɪˈjʉlʲ]","七月","名词"],
    ["а́вгуст","[ˈavɡʊst]","八月","名词"],
    ["сентя́брь","[sʲɪnˈtʲabrʲ]","九月","名词"],
    ["октя́брь","[ɐkˈtʲabrʲ]","十月","名词"],
    ["ноя́брь","[nɐˈjabrʲ]","十一月","名词"],
    ["дека́брь","[dʲɪˈkabrʲ]","十二月","名词"],
    ["челове́к","[tɕɪlɐˈvʲek]","人","名词"],
    ["мужчи́на","[mʊˈɕːinə]","男人","名词"],
    ["же́нщина","[ˈʐenʲɕːɪnə]","女人","名词"],
    ["ребёнок","[rʲɪˈbʲɵnək]","孩子","名词"],
    ["семья́","[sʲɪˈmʲja]","家庭","名词"],
    ["мать","[matʲ]","母亲","名词"],
    ["оте́ц","[ɐˈtʲets]","父亲","名词"],
    ["сын","[sɨn]","儿子","名词"],
    ["дочь","[dotɕ]","女儿","名词"],
    ["брат","[brat]","兄弟","名词"],
    ["сестра́","[sʲɪˈstra]","姐妹","名词"],
    ["муж","[muʂ]","丈夫","名词"],
    ["жена́","[ʐɨˈna]","妻子","名词"],
    ["друг","[druk]","朋友","名词"],
    ["подру́га","[pɐˈdruɡə]","女性朋友","名词"],
    ["де́душка","[ˈdʲedʊʂkə]","爷爷","名词"],
    ["ба́бушка","[ˈbabʊʂkə]","奶奶","名词"],
    ["дядя","[ˈdʲædʲə]","叔叔","名词"],
    ["тётя","[ˈtʲɵtʲə]","阿姨","名词"],
    ["сосе́д","[sɐˈsʲet]","邻居","名词"],
    ["имя","[ˈimʲə]","名字","名词"],
    ["фами́лия","[fɐˈmʲilʲɪjə]","姓氏","名词"],
    ["возраст","[ˈvozrəst]","年龄","名词"],
    ["еда́","[jɪˈda]","食物","名词"],
    ["вода́","[vɐˈda]","水","名词"],
    ["хлеб","[xlʲep]","面包","名词"],
    ["молоко́","[məlɐˈko]","牛奶","名词"],
    ["чай","[tɕaj]","茶","名词"],
    ["ко́фе","[ˈkofʲe]","咖啡","名词"],
    ["суп","[sup]","汤","名词"],
    ["мя́со","[ˈmʲasə]","肉","名词"],
    ["ры́ба","[ˈrɨbə]","鱼","名词"],
    ["ку́рица","[ˈkurʲɪtsə]","鸡肉","名词"],
    ["яйцо́","[jɪjˈtso]","鸡蛋","名词"],
    ["сыр","[sɨr]","奶酪","名词"],
    ["ма́сло","[ˈmaslə]","黄油；油","名词"],
    ["рис","[rʲis]","米饭","名词"],
    ["са́хар","[ˈsaxər]","糖","名词"],
    ["соль","[solʲ]","盐","名词"],
    ["я́блоко","[ˈjabləkə]","苹果","名词"],
    ["бана́н","[bɐˈnan]","香蕉","名词"],
    ["апельси́н","[ɐpʲɪlʲˈsʲin]","橙子","名词"],
    ["виногра́д","[vʲɪnɐˈɡrat]","葡萄","名词"],
    ["помидо́р","[pəmʲɪˈdor]","番茄","名词"],
    ["карто́фель","[kɐrˈtofʲɪlʲ]","土豆","名词"],
    ["лук","[luk]","洋葱","名词"],
    ["сок","[sok]","果汁","名词"],
    ["вино́","[vʲɪˈno]","葡萄酒","名词"],
    ["пи́во","[ˈpʲivə]","啤酒","名词"],
    ["то́рт","[tort]","蛋糕","名词"],
    ["за́втрак","[ˈzaftrək]","早餐","名词"],
    ["обе́д","[ɐˈbʲet]","午餐","名词"],
    ["у́жин","[ˈuʐɨn]","晚餐","名词"],
    ["голова́","[ɡəlɐˈva]","头","名词"],
    ["лицо́","[lʲɪˈtso]","脸","名词"],
    ["глаз","[ɡlas]","眼睛","名词"],
    ["нос","[nos]","鼻子","名词"],
    ["рот","[rot]","嘴","名词"],
    ["у́хо","[ˈuxə]","耳朵","名词"],
    ["рука́","[rʊˈka]","手；胳膊","名词"],
    ["нога́","[nɐˈɡa]","脚；腿","名词"],
    ["па́лец","[ˈpalʲɪts]","手指","名词"],
    ["спина́","[spʲɪˈna]","背","名词"],
    ["живо́т","[ʐɨˈvot]","肚子","名词"],
    ["се́рдце","[ˈsʲertsə]","心脏","名词"],
    ["кровь","[krofʲ]","血","名词"],
    ["зуб","[zup]","牙齿","名词"],
    ["во́лосы","[ˈvoləsɨ]","头发","名词"],
    ["дом","[dom]","房子；家","名词"],
    ["кварти́ра","[kvɐrˈtʲirə]","公寓","名词"],
    ["комната","[ˈkomnətə]","房间","名词"],
    ["дверь","[dvʲerʲ]","门","名词"],
    ["окно́","[ɐkˈno]","窗户","名词"],
    ["стол","[stol]","桌子","名词"],
    ["стул","[stul]","椅子","名词"],
    ["крова́ть","[krɐˈvatʲ]","床","名词"],
    ["шкаф","[ʂkaf]","柜子","名词"],
    ["ку́хня","[ˈkuxnʲə]","厨房","名词"],
    ["ва́нная","[ˈvanːəjə]","浴室","名词"],
    ["туалéт","[tʊɐˈlʲet]","厕所","名词"],
    ["зеркало","[ˈzʲerkələ]","镜子","名词"],
    ["ключ","[klʲʉtɕ]","钥匙","名词"],
    ["ла́мпа","[ˈlampə]","灯","名词"],
    ["одея́ло","[ɐdʲɪˈjalə]","毯子","名词"],
    ["шко́ла","[ˈʂkolə]","学校","名词"],
    ["университе́т","[ʊnʲɪvʲɪrsʲɪˈtʲet]","大学","名词"],
    ["магази́н","[məɡɐˈzʲin]","商店","名词"],
    ["больни́ца","[bɐlʲˈnʲitsə]","医院","名词"],
    ["апте́ка","[ɐpˈtʲekə]","药房","名词"],
    ["рестора́н","[rʲɪstɐˈran]","餐厅","名词"],
    ["гости́ница","[ɡɐˈsʲtʲinʲɪtsə]","酒店","名词"],
    ["банк","[bank]","银行","名词"],
    ["вокза́л","[vɐɡˈzal]","火车站","名词"],
    ["аэропо́рт","[əɪrɐˈport]","机场","名词"],
    ["у́лица","[ˈulʲɪtsə]","街道","名词"],
    ["доро́га","[dɐˈroɡə]","道路","名词"],
    ["го́род","[ˈɡorət]","城市","名词"],
    ["страна́","[strɐˈna]","国家","名词"],
    ["мо́ре","[ˈmorʲe]","海","名词"],
    ["река́","[rʲɪˈka]","河流","名词"],
    ["гора́","[ɡɐˈra]","山","名词"],
    ["мост","[most]","桥","名词"],
    ["па́рк","[park]","公园","名词"],
    ["церковь","[ˈtserkəfʲ]","教堂","名词"],
    ["маши́на","[mɐˈʂɨnə]","汽车","名词"],
    ["авто́бус","[ɐfˈtobʊs]","公交车","名词"],
    ["поезд","[ˈpojɪst]","火车","名词"],
    ["самолёт","[səmɐˈlʲɵt]","飞机","名词"],
    ["такси́","[tɐkˈsʲi]","出租车","名词"],
    ["велосипе́д","[vʲɪləsʲɪˈpʲet]","自行车","名词"],
    ["метро́","[mʲɪˈtro]","地铁","名词"],
    ["биле́т","[bʲɪˈlʲet]","票","名词"],
    ["остано́вка","[ɐstɐˈnofkə]","车站","名词"],
    ["пого́да","[pɐˈɡodə]","天气","名词"],
    ["со́лнце","[ˈsontsə]","太阳","名词"],
    ["дождь","[doɕː]","雨","名词"],
    ["снег","[sʲnʲek]","雪","名词"],
    ["ве́тер","[ˈvʲetʲɪr]","风","名词"],
    ["о́блако","[ˈobləkə]","云","名词"],
    ["хорошо́","[xərɐˈʂo]","好","副词"],
    ["тепло́","[tʲɪˈplo]","温暖","副词"],
    ["хо́лодно","[ˈxolədnə]","冷","副词"],
    ["жа́рко","[ˈʐarkə]","热","副词"],
    ["цвето́к","[tsvʲɪˈtok]","花朵","名词"],
    ["де́рево","[ˈdʲerʲɪvə]","树","名词"],
    ["лес","[lʲes]","森林","名词"],
    ["живо́тное","[ʐɨˈvotnəjə]","动物","名词"],
    ["соба́ка","[sɐˈbakə]","狗","名词"],
    ["ко́шка","[ˈkoʂkə]","猫","名词"],
    ["пти́ца","[ˈptʲitsə]","鸟","名词"],
    ["быть","[bɨtʲ]","是；在","动词"],
    ["де́лать","[ˈdʲelətʲ]","做","动词"],
    ["говори́ть","[ɡəvɐˈrʲitʲ]","说","动词"],
    ["идти́","[ɪˈtʲi]","走；去","动词"],
    ["е́хать","[ˈjexətʲ]","乘车去","动词"],
    ["есть","[jesʲtʲ]","吃","动词"],
    ["пить","[pʲitʲ]","喝","动词"],
    ["знать","[znatʲ]","知道","动词"],
    ["ду́мать","[ˈdumətʲ]","想；认为","动词"],
    ["люби́ть","[lʲʉˈbʲitʲ]","爱；喜欢","动词"],
    ["жить","[ʐɨtʲ]","生活；住","动词"],
    ["понима́ть","[pənʲɪˈmatʲ]","理解","动词"],
    ["ви́деть","[ˈvʲidʲɪtʲ]","看见","动词"],
    ["слы́шать","[ˈslɨʂətʲ]","听见","动词"],
    ["чита́ть","[tɕɪˈtatʲ]","读","动词"],
    ["писа́ть","[pʲɪˈsatʲ]","写","动词"],
    ["рабо́тать","[rɐˈbotətʲ]","工作","动词"],
    ["учи́ться","[ʊˈtɕitsə]","学习","动词"],
    ["спать","[spatʲ]","睡觉","动词"],
    ["встава́ть","[fstɐˈvatʲ]","起床","动词"],
    ["дава́ть","[dɐˈvatʲ]","给","动词"],
    ["брать","[bratʲ]","拿；取","动词"],
    ["покупа́ть","[pəkʊˈpatʲ]","买","动词"],
    ["продава́ть","[prədɐˈvatʲ]","卖","动词"],
    ["игра́ть","[ɪˈɡratʲ]","玩","动词"],
    ["смотре́ть","[smɐˈtrʲetʲ]","看","动词"],
    ["открыва́ть","[ɐtkrɨˈvatʲ]","打开","动词"],
    ["закрыва́ть","[zəkrɨˈvatʲ]","关闭","动词"],
    ["начина́ть","[nətɕɪˈnatʲ]","开始","动词"],
    ["зака́нчивать","[zɐˈkanʲtɕɪvətʲ]","结束","动词"],
    ["помога́ть","[pəmɐˈɡatʲ]","帮助","动词"],
    ["ждать","[ʐdatʲ]","等待","动词"],
    ["встреча́ть","[fstrʲɪˈtɕatʲ]","遇见","动词"],
    ["ходи́ть","[xɐˈdʲitʲ]","走(反复)","动词"],
    ["бежа́ть","[bʲɪˈʐatʲ]","跑","动词"],
    ["сиде́ть","[sʲɪˈdʲetʲ]","坐","动词"],
    ["стоя́ть","[stɐˈjætʲ]","站","动词"],
    ["лежа́ть","[lʲɪˈʐatʲ]","躺","动词"],
    ["большо́й","[bɐlʲˈʂoj]","大的","形容词"],
    ["ма́ленький","[ˈmalʲɪnʲkʲɪj]","小的","形容词"],
    ["хоро́ший","[xɐˈroʂɨj]","好的","形容词"],
    ["плохо́й","[plɐˈxoj]","坏的","形容词"],
    ["краси́вый","[krɐˈsʲivɨj]","漂亮的","形容词"],
    ["но́вый","[ˈnovɨj]","新的","形容词"],
    ["ста́рый","[ˈstarɨj]","旧的；老的","形容词"],
    ["молодо́й","[məlɐˈdoj]","年轻的","形容词"],
    ["дли́нный","[ˈdlʲinːɨj]","长的","形容词"],
    ["коро́ткий","[kɐˈrotkʲɪj]","短的","形容词"],
    ["высо́кий","[vɨˈsokʲɪj]","高的","形容词"],
    ["ни́зкий","[ˈnʲiskʲɪj]","矮的","形容词"],
    ["широ́кий","[ʂɨˈrokʲɪj]","宽的","形容词"],
    ["у́зкий","[ˈuskʲɪj]","窄的","形容词"],
    ["тяжёлый","[tʲɪˈʐɵlɨj]","重的；难的","形容词"],
    ["лёгкий","[ˈlʲɵxʲkʲɪj]","轻的；容易的","形容词"],
    ["бы́стрый","[ˈbɨstrɨj]","快的","形容词"],
    ["ме́дленный","[ˈmʲedlʲɪnːɨj]","慢的","形容词"],
    ["си́льный","[ˈsʲilʲnɨj]","强壮的","形容词"],
    ["сла́бый","[ˈslabɨj]","弱的","形容词"],
    ["ва́жный","[ˈvaʐnɨj]","重要的","形容词"],
    ["интере́сный","[ɪnʲtʲɪˈrʲesnɨj]","有趣的","形容词"],
    ["ску́чный","[ˈskuʂnɨj]","无聊的","形容词"],
    ["дорого́й","[dərɐˈɡoj]","贵的；亲爱的","形容词"],
    ["дешёвый","[dʲɪˈʂɵvɨj]","便宜的","形容词"],
    ["бо́льный","[ˈbolʲnɨj]","生病的","形容词"],
    ["здоро́вый","[zdɐˈrovɨj]","健康的","形容词"],
    ["гро́мкий","[ˈɡromkʲɪj]","大声的","形容词"],
    ["ти́хий","[ˈtʲixʲɪj]","安静的","形容词"],
    ["глубо́кий","[ɡlʊˈbokʲɪj]","深的","形容词"],
    ["как","[kak]","怎么","疑问词"],
    ["что","[ʂto]","什么","疑问词"],
    ["кто","[kto]","谁","疑问词"],
    ["где","[ɡdʲe]","在哪里","疑问词"],
    ["куда́","[kʊˈda]","去哪里","疑问词"],
    ["когда́","[kɐɡˈda]","什么时候","疑问词"],
    ["почему́","[pətɕɪˈmu]","为什么","疑问词"],
    ["ско́лько","[ˈskolʲkə]","多少","疑问词"],
    ["о́чень","[ˈotɕɪnʲ]","很","副词"],
    ["ещё","[jɪˈɕːɵ]","还；再","副词"],
    ["уже́","[ʊˈʐe]","已经","副词"],
    ["то́лько","[ˈtolʲkə]","只是","副词"],
    ["мно́го","[ˈmnoɡə]","很多","副词"],
    ["ма́ло","[ˈmalə]","很少","副词"],
    ["здесь","[zʲdʲesʲ]","这里","副词"],
    ["там","[tam]","那里","副词"],
    ["тут","[tut]","这里","副词"],
    ["до́ма","[ˈdomə]","在家","副词"],
    ["бы́стро","[ˈbɨstrə]","快速地","副词"],
    ["ме́дленно","[ˈmʲedlʲɪnːə]","缓慢地","副词"],
    ["вме́сте","[ˈvmʲesʲtʲe]","一起","副词"],
    ["наза́д","[nɐˈzat]","向后；以前","副词"],
    ["вперёд","[fʲpʲɪˈrʲɵt]","向前","副词"],
    ["телефо́н","[tʲɪlʲɪˈfon]","电话","名词"],
    ["компью́тер","[kɐm⁽ʲ⁾ˈp⁽ʲ⁾jutɛr]","电脑","名词"],
    ["интерне́т","[ɪntɛrˈnɛt]","互联网","名词"],
    ["де́ньги","[ˈdʲenʲɡʲɪ]","钱","名词"],
    ["рабо́та","[rɐˈbotə]","工作","名词"],
    ["вопро́с","[vɐˈpros]","问题","名词"],
    ["отве́т","[ɐtˈvʲet]","回答","名词"],
    ["сло́во","[ˈslovə]","单词","名词"],
    ["язы́к","[jɪˈzɨk]","语言；舌头","名词"],
    ["ру́чка","[ˈrutɕkə]","笔","名词"],
    ["кни́га","[ˈknʲiɡə]","书","名词"],
    ["газе́та","[ɡɐˈzʲetə]","报纸","名词"],
    ["письмо́","[pʲɪsʲˈmo]","信件","名词"],
    ["иде́я","[ɪˈdʲejə]","想法","名词"],
    ["но́вость","[ˈnovəsʲtʲ]","新闻","名词"],
    ["и́стория","[ɪˈstorʲɪjə]","故事；历史","名词"],
    ["му́зыка","[ˈmuzɨkə]","音乐","名词"],
    ["фильм","[fʲilʲm]","电影","名词"],
    ["ка́рта","[ˈkartə]","地图；卡片","名词"],
    ["фо́то","[ˈfotə]","照片","名词"]
  ],
  de: [
    ["hallo","[haˈloː]","你好","感叹词"],
    ["guten Morgen","[ˈɡuːtn̩ ˈmɔʁɡn̩]","早上好","短语"],
    ["guten Tag","[ˈɡuːtn̩ taːk]","你好(白天)","短语"],
    ["guten Abend","[ˈɡuːtn̩ ˈaːbn̩t]","晚上好","短语"],
    ["gute Nacht","[ˈɡuːtə naxt]","晚安","短语"],
    ["auf Wiedersehen","[aʊf ˈviːdɐzeːən]","再见","短语"],
    ["tschüss","[tʃʏs]","拜拜","感叹词"],
    ["danke","[ˈdaŋkə]","谢谢","感叹词"],
    ["bitte","[ˈbɪtə]","请；不客气","语气词"],
    ["ja","[jaː]","是","语气词"],
    ["nein","[naɪn]","不","语气词"],
    ["entschuldigung","[ɛntˈʃʊldɪɡʊŋ]","对不起","感叹词"],
    ["willkommen","[vɪlˈkɔmən]","欢迎","感叹词"],
    ["wie geht es?","[viː ɡeːt ɛs]","你好吗？","短语"],
    ["mir geht es gut","[miːɐ ɡeːt ɛs ɡuːt]","我很好","短语"],
    ["eins","[aɪns]","一","数词"],
    ["zwei","[tsvaɪ]","二","数词"],
    ["drei","[dʁaɪ]","三","数词"],
    ["vier","[fiːɐ]","四","数词"],
    ["fünf","[fʏnf]","五","数词"],
    ["sechs","[zɛks]","六","数词"],
    ["sieben","[ˈziːbn̩]","七","数词"],
    ["acht","[axt]","八","数词"],
    ["neun","[nɔʏn]","九","数词"],
    ["zehn","[tseːn]","十","数词"],
    ["elf","[ɛlf]","十一","数词"],
    ["zwölf","[tsvœlf]","十二","数词"],
    ["zwanzig","[ˈtsvantsɪç]","二十","数词"],
    ["dreißig","[ˈdʁaɪsɪç]","三十","数词"],
    ["hundert","[ˈhʊndɐt]","一百","数词"],
    ["tausend","[ˈtaʊzn̩t]","一千","数词"],
    ["rot","[ʁoːt]","红色的","形容词"],
    ["blau","[blaʊ]","蓝色的","形容词"],
    ["grün","[ɡʁyːn]","绿色的","形容词"],
    ["gelb","[ɡɛlp]","黄色的","形容词"],
    ["schwarz","[ʃvaʁts]","黑色的","形容词"],
    ["weiß","[vaɪs]","白色的","形容词"],
    ["grau","[ɡʁaʊ]","灰色的","形容词"],
    ["braun","[bʁaʊn]","棕色的","形容词"],
    ["lila","[ˈliːla]","紫色的","形容词"],
    ["orange","[oˈʁaŋʒə]","橙色的","形容词"],
    ["rosa","[ˈʁoːza]","粉色的","形容词"],
    ["heute","[ˈhɔʏtə]","今天","副词"],
    ["morgen","[ˈmɔʁɡn̩]","明天","副词"],
    ["gestern","[ˈɡɛstɐn]","昨天","副词"],
    ["jetzt","[jɛtst]","现在","副词"],
    ["später","[ˈʃpɛːtɐ]","以后","副词"],
    ["immer","[ˈɪmɐ]","总是","副词"],
    ["manchmal","[ˈmançmaːl]","有时","副词"],
    ["oft","[ɔft]","经常","副词"],
    ["die Zeit","[diː tsaɪt]","时间","名词"],
    ["die Stunde","[diː ˈʃtʊndə]","小时","名词"],
    ["die Minute","[diː miˈnuːtə]","分钟","名词"],
    ["die Woche","[diː ˈvɔxə]","星期","名词"],
    ["der Monat","[deːɐ ˈmoːnat]","月","名词"],
    ["das Jahr","[das jaːɐ]","年","名词"],
    ["Montag","[ˈmoːntaːk]","星期一","名词"],
    ["Dienstag","[ˈdiːnstaːk]","星期二","名词"],
    ["Mittwoch","[ˈmɪtvɔx]","星期三","名词"],
    ["Donnerstag","[ˈdɔnɐstaːk]","星期四","名词"],
    ["Freitag","[ˈfʁaɪtaːk]","星期五","名词"],
    ["Samstag","[ˈzamstaːk]","星期六","名词"],
    ["Sonntag","[ˈzɔntaːk]","星期日","名词"],
    ["der Mann","[deːɐ man]","男人","名词"],
    ["die Frau","[diː fʁaʊ]","女人；夫人","名词"],
    ["das Kind","[das kɪnt]","孩子","名词"],
    ["die Familie","[diː faˈmiːliə]","家庭","名词"],
    ["die Mutter","[diː ˈmʊtɐ]","母亲","名词"],
    ["der Vater","[deːɐ ˈfaːtɐ]","父亲","名词"],
    ["der Sohn","[deːɐ zoːn]","儿子","名词"],
    ["die Tochter","[diː ˈtɔxtɐ]","女儿","名词"],
    ["der Bruder","[deːɐ ˈbʁuːdɐ]","兄弟","名词"],
    ["die Schwester","[diː ˈʃvɛstɐ]","姐妹","名词"],
    ["der Freund","[deːɐ fʁɔʏnt]","朋友(男)","名词"],
    ["die Freundin","[diː ˈfʁɔʏndɪn]","朋友(女)","名词"],
    ["der Name","[deːɐ ˈnaːmə]","名字","名词"],
    ["das Wasser","[das ˈvasɐ]","水","名词"],
    ["das Brot","[das bʁoːt]","面包","名词"],
    ["die Milch","[diː mɪlç]","牛奶","名词"],
    ["der Kaffee","[deːɐ ˈkafe]","咖啡","名词"],
    ["der Tee","[deːɐ teː]","茶","名词"],
    ["das Fleisch","[das flaɪʃ]","肉","名词"],
    ["der Fisch","[deːɐ fɪʃ]","鱼","名词"],
    ["das Ei","[das aɪ]","鸡蛋","名词"],
    ["der Reis","[deːɐ ʁaɪs]","米饭","名词"],
    ["der Zucker","[ˈtsʊkɐ]","糖","名词"],
    ["das Salz","[das zalts]","盐","名词"],
    ["der Apfel","[deːɐ ˈapfl̩]","苹果","名词"],
    ["die Banane","[diː baˈnaːnə]","香蕉","名词"],
    ["die Kartoffel","[diː kaʁˈtɔfl̩]","土豆","名词"],
    ["der Saft","[deːɐ zaft]","果汁","名词"],
    ["das Bier","[das biːɐ]","啤酒","名词"],
    ["der Wein","[deːɐ vaɪn]","葡萄酒","名词"],
    ["der Kopf","[deːɐ kɔpf]","头","名词"],
    ["das Gesicht","[das ɡəˈzɪçt]","脸","名词"],
    ["das Auge","[das ˈaʊɡə]","眼睛","名词"],
    ["die Nase","[diː ˈnaːzə]","鼻子","名词"],
    ["der Mund","[deːɐ mʊnt]","嘴","名词"],
    ["das Ohr","[das oːɐ]","耳朵","名词"],
    ["die Hand","[diː hant]","手","名词"],
    ["der Fuß","[deːɐ fuːs]","脚","名词"],
    ["der Finger","[deːɐ ˈfɪŋɐ]","手指","名词"],
    ["das Herz","[das hɛʁts]","心脏","名词"],
    ["das Haus","[das haʊs]","房子","名词"],
    ["die Wohnung","[diː ˈvoːnʊŋ]","公寓","名词"],
    ["das Zimmer","[das ˈtsɪmɐ]","房间","名词"],
    ["die Tür","[diː tyːɐ]","门","名词"],
    ["das Fenster","[das ˈfɛnstɐ]","窗户","名词"],
    ["der Tisch","[deːɐ tɪʃ]","桌子","名词"],
    ["der Stuhl","[deːɐ ʃtuːl]","椅子","名词"],
    ["das Bett","[das bɛt]","床","名词"],
    ["die Küche","[diː ˈkʏçə]","厨房","名词"],
    ["das Badezimmer","[das ˈbaːdətsɪmɐ]","浴室","名词"],
    ["die Schule","[diː ˈʃuːlə]","学校","名词"],
    ["die Universität","[diː univɛʁziˈtɛːt]","大学","名词"],
    ["der Supermarkt","[deːɐ ˈzuːpɐmaʁkt]","超市","名词"],
    ["das Krankenhaus","[das ˈkʁaŋkn̩haʊs]","医院","名词"],
    ["das Restaurant","[das ʁɛstoˈʁɑ̃]","餐厅","名词"],
    ["das Hotel","[das hoˈtɛl]","酒店","名词"],
    ["die Bank","[diː baŋk]","银行","名词"],
    ["der Bahnhof","[deːɐ ˈbaːnhoːf]","火车站","名词"],
    ["der Flughafen","[deːɐ ˈfluːkhaːfn̩]","机场","名词"],
    ["die Straße","[diː ˈʃtʁaːsə]","街道","名词"],
    ["die Stadt","[diː ʃtat]","城市","名词"],
    ["das Land","[das lant]","国家","名词"],
    ["das Meer","[das meːɐ]","海","名词"],
    ["das Auto","[das ˈaʊto]","汽车","名词"],
    ["der Bus","[deːɐ bʊs]","公交车","名词"],
    ["der Zug","[deːɐ tsuːk]","火车","名词"],
    ["das Flugzeug","[das ˈfluːktsɔʏk]","飞机","名词"],
    ["das Taxi","[das ˈtaksi]","出租车","名词"],
    ["das Fahrrad","[das ˈfaːɐʁaːt]","自行车","名词"],
    ["das Wetter","[das ˈvɛtɐ]","天气","名词"],
    ["die Sonne","[diː ˈzɔnə]","太阳","名词"],
    ["der Regen","[deːɐ ˈʁeːɡn̩]","雨","名词"],
    ["der Schnee","[deːɐ ʃneː]","雪","名词"],
    ["der Wind","[deːɐ vɪnt]","风","名词"],
    ["die Blume","[diː ˈbluːmə]","花","名词"],
    ["der Baum","[deːɐ baʊm]","树","名词"],
    ["der Hund","[deːɐ hʊnt]","狗","名词"],
    ["die Katze","[diː ˈkatsə]","猫","名词"],
    ["der Vogel","[deːɐ ˈfoːɡl̩]","鸟","名词"],
    ["sein","[zaɪn]","是","动词"],
    ["haben","[ˈhaːbn̩]","有","动词"],
    ["machen","[ˈmaxən]","做","动词"],
    ["sagen","[ˈzaːɡən]","说","动词"],
    ["gehen","[ˈɡeːən]","走；去","动词"],
    ["kommen","[ˈkɔmən]","来","动词"],
    ["essen","[ˈɛsn̩]","吃","动词"],
    ["trinken","[ˈtʁɪŋkn̩]","喝","动词"],
    ["wissen","[ˈvɪsn̩]","知道","动词"],
    ["denken","[ˈdɛŋkn̩]","想；认为","动词"],
    ["lieben","[ˈliːbn̩]","爱；喜欢","动词"],
    ["leben","[ˈleːbn̩]","生活；住","动词"],
    ["verstehen","[fɛɐˈʃteːən]","理解","动词"],
    ["sehen","[ˈzeːən]","看见","动词"],
    ["hören","[ˈhøːʁən]","听见","动词"],
    ["lesen","[ˈleːzn̩]","读","动词"],
    ["schreiben","[ˈʃʁaɪbn̩]","写","动词"],
    ["arbeiten","[ˈaʁbaɪtn̩]","工作","动词"],
    ["lernen","[ˈlɛʁnən]","学习","动词"],
    ["schlafen","[ˈʃlaːfn̩]","睡觉","动词"],
    ["geben","[ˈɡeːbn̩]","给","动词"],
    ["nehmen","[ˈneːmən]","拿","动词"],
    ["kaufen","[ˈkaʊfn̩]","买","动词"],
    ["spielen","[ˈʃpiːlən]","玩","动词"],
    ["öffnen","[ˈœfnən]","打开","动词"],
    ["schließen","[ˈʃliːsn̩]","关闭","动词"],
    ["helfen","[ˈhɛlfn̩]","帮助","动词"],
    ["warten","[ˈvaʁtn̩]","等待","动词"],
    ["finden","[ˈfɪndn̩]","找到","动词"],
    ["bringen","[ˈbʁɪŋən]","带来","动词"],
    ["sprechen","[ˈʃpʁɛçn̩]","说话","动词"],
    ["groß","[ɡʁoːs]","大的","形容词"],
    ["klein","[klaɪn]","小的","形容词"],
    ["gut","[ɡuːt]","好的","形容词"],
    ["schlecht","[ʃlɛçt]","坏的","形容词"],
    ["schön","[ʃøːn]","漂亮的","形容词"],
    ["neu","[nɔʏ]","新的","形容词"],
    ["alt","[alt]","旧的；老的","形容词"],
    ["jung","[jʊŋ]","年轻的","形容词"],
    ["lang","[laŋ]","长的","形容词"],
    ["kurz","[kʊʁts]","短的","形容词"],
    ["hoch","[hoːx]","高的","形容词"],
    ["niedrig","[ˈniːdʁɪç]","低的","形容词"],
    ["schnell","[ʃnɛl]","快的","形容词"],
    ["langsam","[ˈlaŋzaːm]","慢的","形容词"],
    ["wichtig","[ˈvɪçtɪç]","重要的","形容词"],
    ["interessant","[ɪntəʁɛˈsant]","有趣的","形容词"],
    ["teuer","[ˈtɔʏɐ]","贵的","形容词"],
    ["billig","[ˈbɪlɪç]","便宜的","形容词"],
    ["warm","[vaʁm]","温暖的","形容词"],
    ["kalt","[kalt]","冷的","形容词"],
    ["wie","[viː]","怎么","疑问词"],
    ["was","[vas]","什么","疑问词"],
    ["wer","[veːɐ]","谁","疑问词"],
    ["wo","[voː]","在哪里","疑问词"],
    ["wohin","[voˈhɪn]","去哪里","疑问词"],
    ["wann","[van]","什么时候","疑问词"],
    ["warum","[vaˈʁʊm]","为什么","疑问词"],
    ["wie viel","[viː fiːl]","多少","疑问词"],
    ["das Geld","[das ɡɛlt]","钱","名词"],
    ["die Arbeit","[diː ˈaʁbaɪt]","工作","名词"],
    ["die Frage","[diː ˈfʁaːɡə]","问题","名词"],
    ["die Antwort","[diː ˈantvɔʁt]","回答","名词"],
    ["das Wort","[das vɔʁt]","单词","名词"],
    ["die Sprache","[diː ˈʃpʁaːxə]","语言","名词"],
    ["das Buch","[das buːx]","书","名词"],
    ["die Musik","[diː muˈziːk]","音乐","名词"],
    ["der Film","[deːɐ fɪlm]","电影","名词"],
    ["das Telefon","[das teləˈfoːn]","电话","名词"]
  ],
  en: [
    ["hello","[həˈloʊ]","你好","感叹词"],
    ["hi","[haɪ]","嗨","感叹词"],
    ["good morning","[ɡʊd ˈmɔːrnɪŋ]","早上好","短语"],
    ["good afternoon","[ɡʊd æftərˈnuːn]","下午好","短语"],
    ["good evening","[ɡʊd ˈiːvnɪŋ]","晚上好","短语"],
    ["good night","[ɡʊd naɪt]","晚安","短语"],
    ["goodbye","[ɡʊdˈbaɪ]","再见","感叹词"],
    ["bye","[baɪ]","拜拜","感叹词"],
    ["thank you","[θæŋk juː]","谢谢","短语"],
    ["thanks","[θæŋks]","谢谢","感叹词"],
    ["please","[pliːz]","请","语气词"],
    ["sorry","[ˈsɒri]","对不起","感叹词"],
    ["excuse me","[ɪkˈskjuːz miː]","劳驾","短语"],
    ["yes","[jes]","是","语气词"],
    ["no","[noʊ]","不","语气词"],
    ["welcome","[ˈwelkəm]","欢迎","感叹词"],
    ["how are you?","[haʊ ɑːr juː]","你好吗？","短语"],
    ["one","[wʌn]","一","数词"],
    ["two","[tuː]","二","数词"],
    ["three","[θriː]","三","数词"],
    ["four","[fɔːr]","四","数词"],
    ["five","[faɪv]","五","数词"],
    ["six","[sɪks]","六","数词"],
    ["seven","[ˈsevən]","七","数词"],
    ["eight","[eɪt]","八","数词"],
    ["nine","[naɪn]","九","数词"],
    ["ten","[ten]","十","数词"],
    ["eleven","[ɪˈlevən]","十一","数词"],
    ["twelve","[twelv]","十二","数词"],
    ["twenty","[ˈtwenti]","二十","数词"],
    ["thirty","[ˈθɜːrti]","三十","数词"],
    ["hundred","[ˈhʌndrəd]","一百","数词"],
    ["thousand","[ˈθaʊzənd]","一千","数词"],
    ["first","[fɜːrst]","第一","序数词"],
    ["second","[ˈsekənd]","第二","序数词"],
    ["red","[red]","红色的","形容词"],
    ["blue","[bluː]","蓝色的","形容词"],
    ["green","[ɡriːn]","绿色的","形容词"],
    ["yellow","[ˈjeloʊ]","黄色的","形容词"],
    ["black","[blæk]","黑色的","形容词"],
    ["white","[waɪt]","白色的","形容词"],
    ["gray","[ɡreɪ]","灰色的","形容词"],
    ["brown","[braʊn]","棕色的","形容词"],
    ["purple","[ˈpɜːrpəl]","紫色的","形容词"],
    ["orange","[ˈɒrɪndʒ]","橙色的","形容词"],
    ["pink","[pɪŋk]","粉色的","形容词"],
    ["today","[təˈdeɪ]","今天","副词"],
    ["tomorrow","[təˈmɒroʊ]","明天","副词"],
    ["yesterday","[ˈjestərdeɪ]","昨天","副词"],
    ["now","[naʊ]","现在","副词"],
    ["later","[ˈleɪtər]","以后","副词"],
    ["always","[ˈɔːlweɪz]","总是","副词"],
    ["sometimes","[ˈsʌmtaɪmz]","有时","副词"],
    ["often","[ˈɒfən]","经常","副词"],
    ["never","[ˈnevər]","从不","副词"],
    ["time","[taɪm]","时间","名词"],
    ["hour","[ˈaʊər]","小时","名词"],
    ["minute","[mɪˈnjuːt]","分钟","名词"],
    ["week","[wiːk]","星期","名词"],
    ["month","[mʌnθ]","月","名词"],
    ["year","[jɪər]","年","名词"],
    ["Monday","[ˈmʌndeɪ]","星期一","名词"],
    ["Tuesday","[ˈtjuːzdeɪ]","星期二","名词"],
    ["Wednesday","[ˈwenzdeɪ]","星期三","名词"],
    ["Thursday","[ˈθɜːrzdeɪ]","星期四","名词"],
    ["Friday","[ˈfraɪdeɪ]","星期五","名词"],
    ["Saturday","[ˈsætərdeɪ]","星期六","名词"],
    ["Sunday","[ˈsʌndeɪ]","星期日","名词"],
    ["January","[ˈdʒænjueri]","一月","名词"],
    ["February","[ˈfebrueri]","二月","名词"],
    ["March","[mɑːrtʃ]","三月","名词"],
    ["April","[ˈeɪprəl]","四月","名词"],
    ["May","[meɪ]","五月","名词"],
    ["June","[dʒuːn]","六月","名词"],
    ["July","[dʒuˈlaɪ]","七月","名词"],
    ["August","[ɔːˈɡʌst]","八月","名词"],
    ["September","[sepˈtembər]","九月","名词"],
    ["October","[ɒkˈtoʊbər]","十月","名词"],
    ["November","[noʊˈvembər]","十一月","名词"],
    ["December","[dɪˈsembər]","十二月","名词"],
    ["man","[mæn]","男人","名词"],
    ["woman","[ˈwʊmən]","女人","名词"],
    ["child","[tʃaɪld]","孩子","名词"],
    ["family","[ˈfæməli]","家庭","名词"],
    ["mother","[ˈmʌðər]","母亲","名词"],
    ["father","[ˈfɑːðər]","父亲","名词"],
    ["son","[sʌn]","儿子","名词"],
    ["daughter","[ˈdɔːtər]","女儿","名词"],
    ["brother","[ˈbrʌðər]","兄弟","名词"],
    ["sister","[ˈsɪstər]","姐妹","名词"],
    ["husband","[ˈhʌzbənd]","丈夫","名词"],
    ["wife","[waɪf]","妻子","名词"],
    ["friend","[frend]","朋友","名词"],
    ["name","[neɪm]","名字","名词"],
    ["water","[ˈwɔːtər]","水","名词"],
    ["bread","[bred]","面包","名词"],
    ["milk","[mɪlk]","牛奶","名词"],
    ["coffee","[ˈkɒfi]","咖啡","名词"],
    ["tea","[tiː]","茶","名词"],
    ["meat","[miːt]","肉","名词"],
    ["fish","[fɪʃ]","鱼","名词"],
    ["chicken","[ˈtʃɪkɪn]","鸡肉","名词"],
    ["egg","[eɡ]","鸡蛋","名词"],
    ["cheese","[tʃiːz]","奶酪","名词"],
    ["rice","[raɪs]","米饭","名词"],
    ["sugar","[ˈʃʊɡər]","糖","名词"],
    ["salt","[sɔːlt]","盐","名词"],
    ["apple","[ˈæpəl]","苹果","名词"],
    ["banana","[bəˈnænə]","香蕉","名词"],
    ["orange","[ˈɒrɪndʒ]","橙子","名词"],
    ["potato","[pəˈteɪtoʊ]","土豆","名词"],
    ["juice","[dʒuːs]","果汁","名词"],
    ["wine","[waɪn]","葡萄酒","名词"],
    ["beer","[bɪər]","啤酒","名词"],
    ["breakfast","[ˈbrekfəst]","早餐","名词"],
    ["lunch","[lʌntʃ]","午餐","名词"],
    ["dinner","[ˈdɪnər]","晚餐","名词"],
    ["head","[hed]","头","名词"],
    ["face","[feɪs]","脸","名词"],
    ["eye","[aɪ]","眼睛","名词"],
    ["nose","[noʊz]","鼻子","名词"],
    ["mouth","[maʊθ]","嘴","名词"],
    ["ear","[ɪər]","耳朵","名词"],
    ["hand","[hænd]","手","名词"],
    ["foot","[fʊt]","脚","名词"],
    ["finger","[ˈfɪŋɡər]","手指","名词"],
    ["heart","[hɑːrt]","心脏","名词"],
    ["blood","[blʌd]","血","名词"],
    ["hair","[heər]","头发","名词"],
    ["house","[haʊs]","房子","名词"],
    ["apartment","[əˈpɑːrtmənt]","公寓","名词"],
    ["room","[ruːm]","房间","名词"],
    ["door","[dɔːr]","门","名词"],
    ["window","[ˈwɪndoʊ]","窗户","名词"],
    ["table","[ˈteɪbəl]","桌子","名词"],
    ["chair","[tʃeər]","椅子","名词"],
    ["bed","[bed]","床","名词"],
    ["kitchen","[ˈkɪtʃɪn]","厨房","名词"],
    ["bathroom","[ˈbæθruːm]","浴室","名词"],
    ["school","[skuːl]","学校","名词"],
    ["university","[ˌjuːnɪˈvɜːrsəti]","大学","名词"],
    ["store","[stɔːr]","商店","名词"],
    ["hospital","[ˈhɒspɪtəl]","医院","名词"],
    ["restaurant","[ˈrestərɒnt]","餐厅","名词"],
    ["hotel","[hoʊˈtel]","酒店","名词"],
    ["bank","[bæŋk]","银行","名词"],
    ["station","[ˈsteɪʃən]","火车站","名词"],
    ["airport","[ˈeərpɔːrt]","机场","名词"],
    ["street","[striːt]","街道","名词"],
    ["city","[ˈsɪti]","城市","名词"],
    ["country","[ˈkʌntri]","国家","名词"],
    ["sea","[siː]","海","名词"],
    ["mountain","[ˈmaʊntɪn]","山","名词"],
    ["park","[pɑːrk]","公园","名词"],
    ["car","[kɑːr]","汽车","名词"],
    ["bus","[bʌs]","公交车","名词"],
    ["train","[treɪn]","火车","名词"],
    ["plane","[pleɪn]","飞机","名词"],
    ["taxi","[ˈtæksi]","出租车","名词"],
    ["bicycle","[ˈbaɪsɪkəl]","自行车","名词"],
    ["weather","[ˈweðər]","天气","名词"],
    ["sun","[sʌn]","太阳","名词"],
    ["rain","[reɪn]","雨","名词"],
    ["snow","[snoʊ]","雪","名词"],
    ["wind","[wɪnd]","风","名词"],
    ["cloud","[klaʊd]","云","名词"],
    ["flower","[ˈflaʊər]","花","名词"],
    ["tree","[triː]","树","名词"],
    ["dog","[dɒɡ]","狗","名词"],
    ["cat","[kæt]","猫","名词"],
    ["bird","[bɜːrd]","鸟","名词"],
    ["animal","[ˈænɪməl]","动物","名词"],
    ["be","[biː]","是","动词"],
    ["have","[hæv]","有","动词"],
    ["do","[duː]","做","动词"],
    ["say","[seɪ]","说","动词"],
    ["go","[ɡoʊ]","走；去","动词"],
    ["come","[kʌm]","来","动词"],
    ["eat","[iːt]","吃","动词"],
    ["drink","[drɪŋk]","喝","动词"],
    ["know","[noʊ]","知道","动词"],
    ["think","[θɪŋk]","想；认为","动词"],
    ["love","[lʌv]","爱；喜欢","动词"],
    ["live","[lɪv]","生活；住","动词"],
    ["understand","[ˌʌndərˈstænd]","理解","动词"],
    ["see","[siː]","看见","动词"],
    ["hear","[hɪər]","听见","动词"],
    ["read","[riːd]","读","动词"],
    ["write","[raɪt]","写","动词"],
    ["work","[wɜːrk]","工作","动词"],
    ["learn","[lɜːrn]","学习","动词"],
    ["sleep","[sliːp]","睡觉","动词"],
    ["give","[ɡɪv]","给","动词"],
    ["take","[teɪk]","拿；取","动词"],
    ["buy","[baɪ]","买","动词"],
    ["sell","[sel]","卖","动词"],
    ["play","[pleɪ]","玩","动词"],
    ["open","[ˈoʊpən]","打开","动词"],
    ["close","[kloʊz]","关闭","动词"],
    ["help","[help]","帮助","动词"],
    ["wait","[weɪt]","等待","动词"],
    ["find","[faɪnd]","找到","动词"],
    ["bring","[brɪŋ]","带来","动词"],
    ["speak","[spiːk]","说话","动词"],
    ["run","[rʌn]","跑","动词"],
    ["sit","[sɪt]","坐","动词"],
    ["stand","[stænd]","站","动词"],
    ["big","[bɪɡ]","大的","形容词"],
    ["small","[smɔːl]","小的","形容词"],
    ["good","[ɡʊd]","好的","形容词"],
    ["bad","[bæd]","坏的","形容词"],
    ["beautiful","[ˈbjuːtɪfəl]","漂亮的","形容词"],
    ["new","[njuː]","新的","形容词"],
    ["old","[oʊld]","旧的；老的","形容词"],
    ["young","[jʌŋ]","年轻的","形容词"],
    ["long","[lɒŋ]","长的","形容词"],
    ["short","[ʃɔːrt]","短的","形容词"],
    ["tall","[tɔːl]","高的","形容词"],
    ["low","[loʊ]","低的","形容词"],
    ["fast","[fæst]","快的","形容词"],
    ["slow","[sloʊ]","慢的","形容词"],
    ["important","[ɪmˈpɔːrtənt]","重要的","形容词"],
    ["interesting","[ˈɪntrəstɪŋ]","有趣的","形容词"],
    ["expensive","[ɪkˈspensɪv]","贵的","形容词"],
    ["cheap","[tʃiːp]","便宜的","形容词"],
    ["hot","[hɒt]","热的","形容词"],
    ["cold","[koʊld]","冷的","形容词"],
    ["happy","[ˈhæpi]","开心的","形容词"],
    ["sad","[sæd]","难过的","形容词"],
    ["how","[haʊ]","怎么","疑问词"],
    ["what","[wɒt]","什么","疑问词"],
    ["who","[huː]","谁","疑问词"],
    ["where","[weər]","在哪里","疑问词"],
    ["when","[wen]","什么时候","疑问词"],
    ["why","[waɪ]","为什么","疑问词"],
    ["how much","[haʊ mʌtʃ]","多少","疑问词"]
  ],
  ko: [
    ["안녕하세요","[an-nyeong-ha-se-yo]","你好","感叹词"],
    ["안녕","[an-nyeong]","嗨(非正式)","感叹词"],
    ["감사합니다","[gam-sa-ham-ni-da]","谢谢","感叹词"],
    ["고맙습니다","[go-map-seum-ni-da]","谢谢","感叹词"],
    ["네","[ne]","是","语气词"],
    ["아니요","[a-ni-yo]","不","语气词"],
    ["죄송합니다","[joe-song-ham-ni-da]","对不起","感叹词"],
    ["미안합니다","[mi-an-ham-ni-da]","抱歉","感叹词"],
    ["안녕히 가세요","[an-nyeong-hi ga-se-yo]","再见(对方走)","短语"],
    ["안녕히 계세요","[an-nyeong-hi gye-se-yo]","再见(自己走)","短语"],
    ["잘 자요","[jal ja-yo]","晚安","短语"],
    ["어서 오세요","[eo-seo o-se-yo]","欢迎","短语"],
    ["일","[il]","一","数词"],
    ["이","[i]","二","数词"],
    ["삼","[sam]","三","数词"],
    ["사","[sa]","四","数词"],
    ["오","[o]","五","数词"],
    ["육","[yuk]","六","数词"],
    ["칠","[chil]","七","数词"],
    ["팔","[pal]","八","数词"],
    ["구","[gu]","九","数词"],
    ["십","[sip]","十","数词"],
    ["백","[baek]","一百","数词"],
    ["천","[cheon]","一千","数词"],
    ["하나","[ha-na]","一(固有)","数词"],
    ["둘","[dul]","二(固有)","数词"],
    ["셋","[set]","三(固有)","数词"],
    ["넷","[net]","四(固有)","数词"],
    ["다섯","[da-seot]","五(固有)","数词"],
    ["빨간색","[ppal-gan-saek]","红色","名词"],
    ["파란색","[pa-ran-saek]","蓝色","名词"],
    ["초록색","[cho-rok-saek]","绿色","名词"],
    ["노란색","[no-ran-saek]","黄色","名词"],
    ["검정색","[geom-jeong-saek]","黑色","名词"],
    ["하얀색","[ha-yan-saek]","白色","名词"],
    ["회색","[hoe-saek]","灰色","名词"],
    ["오늘","[o-neul]","今天","副词"],
    ["내일","[nae-il]","明天","副词"],
    ["어제","[eo-je]","昨天","副词"],
    ["지금","[ji-geum]","现在","副词"],
    ["나중에","[na-jung-e]","以后","副词"],
    ["항상","[hang-sang]","总是","副词"],
    ["가끔","[ga-kkeum]","有时","副词"],
    ["자주","[ja-ju]","经常","副词"],
    ["시간","[si-gan]","时间","名词"],
    ["시","[si]","小时","名词"],
    ["분","[bun]","分钟","名词"],
    ["주","[ju]","星期","名词"],
    ["달","[dal]","月","名词"],
    ["년","[nyeon]","年","名词"],
    ["월요일","[wo-ryo-il]","星期一","名词"],
    ["화요일","[hwa-yo-il]","星期二","名词"],
    ["수요일","[su-yo-il]","星期三","名词"],
    ["목요일","[mo-gyo-il]","星期四","名词"],
    ["금요일","[geu-myo-il]","星期五","名词"],
    ["토요일","[to-yo-il]","星期六","名词"],
    ["일요일","[i-ryo-il]","星期日","名词"],
    ["가족","[ga-jok]","家庭","名词"],
    ["어머니","[eo-meo-ni]","母亲","名词"],
    ["아버지","[a-beo-ji]","父亲","名词"],
    ["아들","[a-deul]","儿子","名词"],
    ["딸","[ttal]","女儿","名词"],
    ["형","[hyeong]","哥哥(男称)","名词"],
    ["오빠","[o-ppa]","哥哥(女称)","名词"],
    ["언니","[eon-ni]","姐姐(女称)","名词"],
    ["누나","[nu-na]","姐姐(男称)","名词"],
    ["남동생","[nam-dong-saeng]","弟弟","名词"],
    ["여동생","[yeo-dong-saeng]","妹妹","名词"],
    ["친구","[chin-gu]","朋友","名词"],
    ["사람","[sa-ram]","人","名词"],
    ["이름","[i-reum]","名字","名词"],
    ["물","[mul]","水","名词"],
    ["빵","[ppang]","面包","名词"],
    ["우유","[u-yu]","牛奶","名词"],
    ["커피","[keo-pi]","咖啡","名词"],
    ["차","[cha]","茶","名词"],
    ["밥","[bap]","米饭","名词"],
    ["고기","[go-gi]","肉","名词"],
    ["생선","[saeng-seon]","鱼","名词"],
    ["계란","[gye-ran]","鸡蛋","名词"],
    ["치즈","[chi-jeu]","奶酪","名词"],
    ["설탕","[seol-tang]","糖","名词"],
    ["소금","[so-geum]","盐","名词"],
    ["사과","[sa-gwa]","苹果","名词"],
    ["바나나","[ba-na-na]","香蕉","名词"],
    ["감자","[gam-ja]","土豆","名词"],
    ["주스","[ju-seu]","果汁","名词"],
    ["맥주","[maek-ju]","啤酒","名词"],
    ["김치","[gim-chi]","泡菜","名词"],
    ["라면","[ra-myeon]","拉面","名词"],
    ["머리","[meo-ri]","头","名词"],
    ["얼굴","[eol-gul]","脸","名词"],
    ["눈","[nun]","眼睛","名词"],
    ["코","[ko]","鼻子","名词"],
    ["입","[ip]","嘴","名词"],
    ["귀","[gwi]","耳朵","名词"],
    ["손","[son]","手","名词"],
    ["발","[bal]","脚","名词"],
    ["손가락","[son-ga-rak]","手指","名词"],
    ["심장","[sim-jang]","心脏","名词"],
    ["집","[jip]","房子；家","名词"],
    ["방","[bang]","房间","名词"],
    ["문","[mun]","门","名词"],
    ["창문","[chang-mun]","窗户","名词"],
    ["책상","[chaek-sang]","桌子","名词"],
    ["의자","[ui-ja]","椅子","名词"],
    ["침대","[chim-dae]","床","名词"],
    ["부엌","[bu-eok]","厨房","名词"],
    ["화장실","[hwa-jang-sil]","卫生间","名词"],
    ["학교","[hak-gyo]","学校","名词"],
    ["대학교","[dae-hak-gyo]","大学","名词"],
    ["병원","[byeong-won]","医院","名词"],
    ["식당","[sik-dang]","餐厅","名词"],
    ["호텔","[ho-tel]","酒店","名词"],
    ["은행","[eun-haeng]","银行","名词"],
    ["공항","[gong-hang]","机场","名词"],
    ["길","[gil]","路","名词"],
    ["도시","[do-si]","城市","名词"],
    ["나라","[na-ra]","国家","名词"],
    ["산","[san]","山","名词"],
    ["바다","[ba-da]","海","名词"],
    ["자동차","[ja-dong-cha]","汽车","名词"],
    ["버스","[beo-seu]","公交车","名词"],
    ["기차","[gi-cha]","火车","名词"],
    ["비행기","[bi-haeng-gi]","飞机","名词"],
    ["택시","[taek-si]","出租车","名词"],
    ["자전거","[ja-jeon-geo]","自行车","名词"],
    ["지하철","[ji-ha-cheol]","地铁","名词"],
    ["날씨","[nal-ssi]","天气","名词"],
    ["해","[hae]","太阳","名词"],
    ["비","[bi]","雨","名词"],
    ["눈","[nun]","雪","名词"],
    ["바람","[ba-ram]","风","名词"],
    ["꽃","[kkot]","花","名词"],
    ["나무","[na-mu]","树","名词"],
    ["개","[gae]","狗","名词"],
    ["고양이","[go-yang-i]","猫","名词"],
    ["새","[sae]","鸟","名词"],
    ["하다","[ha-da]","做","动词"],
    ["가다","[ga-da]","走；去","动词"],
    ["오다","[o-da]","来","动词"],
    ["먹다","[meok-da]","吃","动词"],
    ["마시다","[ma-si-da]","喝","动词"],
    ["알다","[al-da]","知道","动词"],
    ["생각하다","[saeng-gak-ha-da]","想；认为","动词"],
    ["사랑하다","[sa-rang-ha-da]","爱","动词"],
    ["살다","[sal-da]","生活；住","动词"],
    ["이해하다","[i-hae-ha-da]","理解","动词"],
    ["보다","[bo-da]","看","动词"],
    ["듣다","[deut-da]","听","动词"],
    ["읽다","[ik-da]","读","动词"],
    ["쓰다","[sseu-da]","写","动词"],
    ["일하다","[il-ha-da]","工作","动词"],
    ["공부하다","[gong-bu-ha-da]","学习","动词"],
    ["자다","[ja-da]","睡觉","动词"],
    ["주다","[ju-da]","给","动词"],
    ["사다","[sa-da]","买","动词"],
    ["팔다","[pal-da]","卖","动词"],
    ["놀다","[nol-da]","玩","动词"],
    ["열다","[yeol-da]","打开","动词"],
    ["닫다","[dat-da]","关闭","动词"],
    ["돕다","[dop-da]","帮助","动词"],
    ["기다리다","[gi-da-ri-da]","等待","动词"],
    ["찾다","[chat-da]","找","动词"],
    ["말하다","[mal-ha-da]","说","动词"],
    ["달리다","[dal-li-da]","跑","动词"],
    ["앉다","[an-da]","坐","动词"],
    ["서다","[seo-da]","站","动词"],
    ["크다","[keu-da]","大的","形容词"],
    ["작다","[jak-da]","小的","形容词"],
    ["좋다","[jo-ta]","好的","形容词"],
    ["나쁘다","[na-ppeu-da]","坏的","形容词"],
    ["예쁘다","[ye-ppeu-da]","漂亮的","形容词"],
    ["새롭다","[sae-rop-da]","新的","形容词"],
    ["오래되다","[o-rae-doe-da]","旧的","形容词"],
    ["길다","[gil-da]","长的","形容词"],
    ["짧다","[jjal-da]","短的","形容词"],
    ["빠르다","[ppa-reu-da]","快的","形容词"],
    ["느리다","[neu-ri-da]","慢的","形容词"],
    ["중요하다","[jung-yo-ha-da]","重要的","形容词"],
    ["재미있다","[jae-mi-it-da]","有趣的","形容词"],
    ["비싸다","[bi-ssa-da]","贵的","形容词"],
    ["싸다","[ssa-da]","便宜的","形容词"],
    ["따뜻하다","[tta-tteut-ha-da]","温暖的","形容词"],
    ["춥다","[chup-da]","冷的","形容词"],
    ["행복하다","[haeng-bok-ha-da]","幸福的","形容词"],
    ["어떻게","[eo-tteo-ke]","怎么","疑问词"],
    ["무엇","[mu-eot]","什么","疑问词"],
    ["누구","[nu-gu]","谁","疑问词"],
    ["어디","[eo-di]","在哪里","疑问词"],
    ["언제","[eon-je]","什么时候","疑问词"],
    ["왜","[wae]","为什么","疑问词"],
    ["얼마","[eol-ma]","多少","疑问词"],
    ["돈","[don]","钱","名词"],
    ["일","[il]","工作","名词"],
    ["질문","[jil-mun]","问题","名词"],
    ["대답","[dae-dap]","回答","名词"],
    ["단어","[dan-eo]","单词","名词"],
    ["언어","[eon-eo]","语言","名词"],
    ["책","[chaek]","书","名词"],
    ["음악","[eu-mak]","音乐","名词"],
    ["영화","[yeong-hwa]","电影","名词"],
    ["전화","[jeon-hwa]","电话","名词"],
    ["컴퓨터","[keom-pyu-teo]","电脑","名词"]
  ],
  ja: [
    ["こんにちは","[kon-ni-chi-wa]","你好","感叹词"],
    ["おはようございます","[o-ha-you go-zai-ma-su]","早上好","短语"],
    ["おはよう","[o-ha-you]","早(非正式)","感叹词"],
    ["こんばんは","[kon-ban-wa]","晚上好","短语"],
    ["おやすみなさい","[o-ya-su-mi-na-sai]","晚安","短语"],
    ["ありがとうございます","[a-ri-ga-tou go-zai-ma-su]","谢谢(敬)","短语"],
    ["ありがとう","[a-ri-ga-tou]","谢谢","感叹词"],
    ["すみません","[su-mi-ma-sen]","对不起；劳驾","感叹词"],
    ["ごめんなさい","[go-men-na-sai]","对不起","感叹词"],
    ["はい","[hai]","是","语气词"],
    ["いいえ","[ii-e]","不","语气词"],
    ["さようなら","[sa-you-na-ra]","再见","短语"],
    ["じゃね","[ja-ne]","拜拜","感叹词"],
    ["いらっしゃいませ","[i-ra-sshai-ma-se]","欢迎","短语"],
    ["いち","[i-chi]","一","数词"],
    ["に","[ni]","二","数词"],
    ["さん","[san]","三","数词"],
    ["し/よん","[shi/yon]","四","数词"],
    ["ご","[go]","五","数词"],
    ["ろく","[ro-ku]","六","数词"],
    ["しち/なな","[shi-chi/na-na]","七","数词"],
    ["はち","[ha-chi]","八","数词"],
    ["きゅう/く","[kyuu/ku]","九","数词"],
    ["じゅう","[juu]","十","数词"],
    ["ひゃく","[hya-ku]","一百","数词"],
    ["せん","[sen]","一千","数词"],
    ["赤","[a-ka]","红色","名词"],
    ["青","[a-o]","蓝色","名词"],
    ["緑","[mi-do-ri]","绿色","名词"],
    ["黄色","[kii-ro]","黄色","名词"],
    ["黒","[ku-ro]","黑色","名词"],
    ["白","[shi-ro]","白色","名词"],
    ["灰色","[hai-i-ro]","灰色","名词"],
    ["今日","[kyou]","今天","副词"],
    ["明日","[a-shi-ta]","明天","副词"],
    ["昨日","[ki-nou]","昨天","副词"],
    ["今","[i-ma]","现在","副词"],
    ["後で","[a-to-de]","以后","副词"],
    ["いつも","[i-tsu-mo]","总是","副词"],
    ["時々","[to-ki-do-ki]","有时","副词"],
    ["よく","[yo-ku]","经常","副词"],
    ["時間","[ji-kan]","时间","名词"],
    ["時","[ji]","小时","名词"],
    ["分","[fun]","分钟","名词"],
    ["週","[shuu]","星期","名词"],
    ["月","[tsu-ki]","月","名词"],
    ["年","[nen/do-shi]","年","名词"],
    ["月曜日","[getsu-you-bi]","星期一","名词"],
    ["火曜日","[ka-you-bi]","星期二","名词"],
    ["水曜日","[sui-you-bi]","星期三","名词"],
    ["木曜日","[moku-you-bi]","星期四","名词"],
    ["金曜日","[kin-you-bi]","星期五","名词"],
    ["土曜日","[do-you-bi]","星期六","名词"],
    ["日曜日","[nichi-you-bi]","星期日","名词"],
    ["家族","[ka-zo-ku]","家庭","名词"],
    ["お母さん","[o-kaa-san]","母亲","名词"],
    ["お父さん","[o-tou-san]","父亲","名词"],
    ["息子","[mu-su-ko]","儿子","名词"],
    ["娘","[mu-su-me]","女儿","名词"],
    ["お兄さん","[o-nii-san]","哥哥","名词"],
    ["お姉さん","[o-nee-san]","姐姐","名词"],
    ["弟","[o-tou-to]","弟弟","名词"],
    ["妹","[i-mou-to]","妹妹","名词"],
    ["友達","[to-mo-da-chi]","朋友","名词"],
    ["人","[hi-to]","人","名词"],
    ["名前","[na-mae]","名字","名词"],
    ["水","[mi-zu]","水","名词"],
    ["パン","[pan]","面包","名词"],
    ["牛乳","[gyuu-nyuu]","牛奶","名词"],
    ["コーヒー","[koo-hii]","咖啡","名词"],
    ["お茶","[o-cha]","茶","名词"],
    ["ご飯","[go-han]","米饭","名词"],
    ["肉","[ni-ku]","肉","名词"],
    ["魚","[sa-ka-na]","鱼","名词"],
    ["卵","[ta-ma-go]","鸡蛋","名词"],
    ["塩","[shi-o]","盐","名词"],
    ["砂糖","[sa-tou]","糖","名词"],
    ["りんご","[rin-go]","苹果","名词"],
    ["バナナ","[ba-na-na]","香蕉","名词"],
    ["じゃがいも","[ja-gai-mo]","土豆","名词"],
    ["ジュース","[juu-su]","果汁","名词"],
    ["ビール","[bii-ru]","啤酒","名词"],
    ["お酒","[o-sa-ke]","酒","名词"],
    ["朝ご飯","[a-sa-go-han]","早餐","名词"],
    ["昼ご飯","[hi-ru-go-han]","午餐","名词"],
    ["晩ご飯","[ban-go-han]","晚餐","名词"],
    ["頭","[a-ta-ma]","头","名词"],
    ["顔","[ka-o]","脸","名词"],
    ["目","[me]","眼睛","名词"],
    ["鼻","[ha-na]","鼻子","名词"],
    ["口","[ku-chi]","嘴","名词"],
    ["耳","[mi-mi]","耳朵","名词"],
    ["手","[te]","手","名词"],
    ["足","[a-shi]","脚","名词"],
    ["指","[yu-bi]","手指","名词"],
    ["心臓","[shin-zou]","心脏","名词"],
    ["家","[i-e]","房子；家","名词"],
    ["部屋","[he-ya]","房间","名词"],
    ["ドア","[do-a]","门","名词"],
    ["窓","[ma-do]","窗户","名词"],
    ["机","[tsu-ku-e]","桌子","名词"],
    ["椅子","[i-su]","椅子","名词"],
    ["ベッド","[be-ddo]","床","名词"],
    ["台所","[dai-do-ko-ro]","厨房","名词"],
    ["お手洗い","[o-te-a-rai]","卫生间","名词"],
    ["学校","[gak-kou]","学校","名词"],
    ["大学","[dai-ga-ku]","大学","名词"],
    ["病院","[byou-in]","医院","名词"],
    ["レストラン","[re-su-to-ran]","餐厅","名词"],
    ["ホテル","[ho-te-ru]","酒店","名词"],
    ["銀行","[gin-kou]","银行","名词"],
    ["駅","[e-ki]","车站","名词"],
    ["空港","[kuu-kou]","机场","名词"],
    ["道","[mi-chi]","路","名词"],
    ["町","[ma-chi]","城市；镇","名词"],
    ["国","[ku-ni]","国家","名词"],
    ["山","[ya-ma]","山","名词"],
    ["海","[u-mi]","海","名词"],
    ["車","[ku-ru-ma]","汽车","名词"],
    ["バス","[ba-su]","公交车","名词"],
    ["電車","[den-sha]","电车","名词"],
    ["飛行機","[hi-kou-ki]","飞机","名词"],
    ["タクシー","[ta-ku-shii]","出租车","名词"],
    ["自転車","[ji-ten-sha]","自行车","名词"],
    ["地下鉄","[chi-ka-te-tsu]","地铁","名词"],
    ["天気","[ten-ki]","天气","名词"],
    ["太陽","[tai-you]","太阳","名词"],
    ["雨","[a-me]","雨","名词"],
    ["雪","[yu-ki]","雪","名词"],
    ["風","[ka-ze]","风","名词"],
    ["花","[ha-na]","花","名词"],
    ["木","[ki]","树","名词"],
    ["犬","[i-nu]","狗","名词"],
    ["猫","[ne-ko]","猫","名词"],
    ["鳥","[to-ri]","鸟","名词"],
    ["する","[su-ru]","做","动词"],
    ["行く","[i-ku]","走；去","动词"],
    ["来る","[ku-ru]","来","动词"],
    ["食べる","[ta-be-ru]","吃","动词"],
    ["飲む","[no-mu]","喝","动词"],
    ["知る","[shi-ru]","知道","动词"],
    ["思う","[o-mo-u]","想；认为","动词"],
    ["愛する","[ai-su-ru]","爱","动词"],
    ["住む","[su-mu]","生活；住","动词"],
    ["分かる","[wa-ka-ru]","理解","动词"],
    ["見る","[mi-ru]","看见","动词"],
    ["聞く","[ki-ku]","听见","动词"],
    ["読む","[yo-mu]","读","动词"],
    ["書く","[ka-ku]","写","动词"],
    ["働く","[ha-ta-ra-ku]","工作","动词"],
    ["勉強する","[ben-kyou-su-ru]","学习","动词"],
    ["寝る","[ne-ru]","睡觉","动词"],
    ["あげる","[a-ge-ru]","给","动词"],
    ["買う","[ka-u]","买","动词"],
    ["売る","[u-ru]","卖","动词"],
    ["遊ぶ","[a-so-bu]","玩","动词"],
    ["開ける","[a-ke-ru]","打开","动词"],
    ["閉める","[shi-me-ru]","关闭","动词"],
    ["助ける","[ta-su-ke-ru]","帮助","动词"],
    ["待つ","[ma-tsu]","等待","动词"],
    ["探す","[sa-ga-su]","寻找","动词"],
    ["話す","[ha-na-su]","说话","动词"],
    ["走る","[ha-shi-ru]","跑","动词"],
    ["座る","[su-wa-ru]","坐","动词"],
    ["立つ","[ta-tsu]","站","动词"],
    ["大きい","[oo-kii]","大的","形容词"],
    ["小さい","[chii-sai]","小的","形容词"],
    ["良い","[ii/yo-i]","好的","形容词"],
    ["悪い","[wa-rui]","坏的","形容词"],
    ["新しい","[a-ta-ra-shii]","新的","形容词"],
    ["古い","[fu-rui]","旧的","形容词"],
    ["長い","[na-gai]","长的","形容词"],
    ["短い","[mi-ji-kai]","短的","形容词"],
    ["高い","[ta-kai]","高的；贵的","形容词"],
    ["低い","[hi-kui]","低的","形容词"],
    ["速い","[ha-yai]","快的","形容词"],
    ["遅い","[o-soi]","慢的","形容词"],
    ["楽しい","[ta-no-shii]","快乐的","形容词"],
    ["面白い","[o-mo-shi-roi]","有趣的","形容词"],
    ["美味しい","[oi-shii]","好吃的","形容词"],
    ["暑い","[a-tsui]","热的","形容词"],
    ["寒い","[sa-mui]","冷的","形容词"],
    ["暖かい","[a-ta-ta-kai]","温暖的","形容词"],
    ["近い","[chi-kai]","近的","形容词"],
    ["遠い","[too-i]","远的","形容词"],
    ["綺麗な","[ki-rei-na]","漂亮的","形容动词"],
    ["静かな","[shi-zu-ka-na]","安静的","形容动词"],
    ["有名な","[yuu-mei-na]","有名的","形容动词"],
    ["便利な","[ben-ri-na]","方便的","形容动词"],
    ["元気な","[gen-ki-na]","健康的","形容动词"],
    ["好きな","[su-ki-na]","喜欢的","形容动词"],
    ["大切な","[tai-se-tsu-na]","重要的","形容动词"],
    ["どう","[dou]","怎么","疑问词"],
    ["何","[na-ni/nan]","什么","疑问词"],
    ["誰","[da-re]","谁","疑问词"],
    ["どこ","[do-ko]","在哪里","疑问词"],
    ["いつ","[i-tsu]","什么时候","疑问词"],
    ["なぜ","[na-ze]","为什么","疑问词"],
    ["いくら","[i-ku-ra]","多少","疑问词"],
    ["お金","[o-ka-ne]","钱","名词"],
    ["仕事","[shi-go-to]","工作","名词"],
    ["質問","[shi-tsu-mon]","问题","名词"],
    ["答え","[ko-ta-e]","回答","名词"],
    ["言葉","[ko-to-ba]","单词；语言","名词"],
    ["本","[hon]","书","名词"],
    ["音楽","[on-ga-ku]","音乐","名词"],
    ["映画","[ei-ga]","电影","名词"],
    ["電話","[den-wa]","电话","名词"],
    ["パソコン","[pa-so-kon]","电脑","名词"]
  ],

};;

// ========================================================
//  APP STATE
// ========================================================
let userLanguages = []; // { lang, name, flag, speech_lang, sort_order }
let activeLang = 'ru';
let activeFolderId = null;
let folders = []; // { id, name, sort_order, created_at }
let WORDS = [];
let srsData = {};
let currentMode = 'flashcard';
let flashcardIndex = 0, flashcardFilter = 'all', flashcardPool = [];
let quizType = 'ru-zh', quizWords = [], quizIndex = 0, quizAnswered = false;
let pendingImport = [], listSearchQuery = '', editingWordId = null, listShowDictionary = false;
let soundEnabled = true, hapticEnabled = true, dailyGoal = 20, flashcardAutoSpeak = true, manualAdvance = false;
let audioCtx = null;
let starredWords = {};
let listenIndex = 0, listenPlaying = false, listenRepeatCount = 1, listenSpeechRate = 0.85;
let listenLoopMode = 'folder'; // 'folder' | 'next'
let listenRepeatRemaining = 0, listenTimeout = null;
let listenTimerDuration = 0, listenTimerRemaining = 0, listenTimerInterval = null; // timer in seconds


// Daily Session State
let sessionActive = false;
let sessionQueue = [];             // dynamic queue: words reinsert at different positions based on performance
let sessionCompletedWords = [];    // word IDs mastered this session
let sessionCorrectFirstTry = [];   // word IDs correct on first attempt
let sessionTotalAttempts = 0;
let sessionStartedAt = null;
let sessionWordAttempts = {};      // wordId -> attempt count (across all appearances)
let sessionMode = false;           // true = session mode, false = old browse mode
const SESSION_MAX_ATTEMPTS = 5;    // force-master a word after this many attempts to prevent infinite loops

// ── Memory Game State ─────────────────────────────
let memoryCards = [];
let memoryFlippedIndices = [];
let memoryMatchedPairs = 0;
let memoryMoves = 0;
let memoryTimerSec = 0;
let memoryTimerInterval = null;
let memoryLocked = false;
let newWordsPerDay = 10;

// ========================================================
//  UTILS
// ========================================================
function todayStr() { return new Date().toISOString().slice(0, 10); }
function showLoading(on) { document.getElementById('loading-overlay').style.display = on ? 'flex' : 'none'; }
function shuffleArr(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ── Traditional → Simplified Chinese converter ─────────
const TS_MAP = {
  '個':'个','們':'们','這':'这','時':'时','會':'会','說':'说','來':'来','對':'对',
  '學':'学','開':'开','關':'关','門':'门','頭':'头','為':'为','嗎':'吗','體':'体',
  '國':'国','書':'书','長':'长','見':'见','過':'过','後':'后','車':'车','裡':'里',
  '東':'东','麼':'么','電':'电','氣':'气','動':'动','現':'现','實':'实','點':'点',
  '當':'当','發':'发','還':'还','從':'从','種':'种','沒':'没','進':'进','經':'经',
  '樣':'样','間':'间','將':'将','應':'应','給':'给','機':'机','話':'话','問':'问',
  '聽':'听','寫':'写','買':'买','賣':'卖','請':'请','讓':'让','愛':'爱','覺':'觉',
  '變':'变','聲':'声','邊':'边','馬':'马','魚':'鱼','鳥':'鸟','飯':'饭','錢':'钱',
  '語':'语','讀':'读','誰':'谁','視':'视','覺':'觉','記':'记','該':'该','場':'场',
  '員':'员','師':'师','業':'业','義':'义','樂':'乐','戲':'戏','醫':'医','藥':'药',
  '舊':'旧','處':'处','號':'号','術':'术','衛':'卫','裝':'装','觀':'观','計':'计',
  '設':'设','識':'识','許':'许','訴':'诉','試':'试','詩':'诗','誠':'诚','謝':'谢',
  '講':'讲','論':'论','議':'议','證':'证','護':'护','變':'变','爭':'争','權':'权',
  '紅':'红','綠':'绿','藍':'蓝','萬':'万','數':'数','圖':'图','團':'团','報':'报',
  '紙':'纸','線':'线','網':'网','總':'总','統':'统','結':'结','約':'约','級':'级',
  '組':'组','織':'织','終':'终','緊':'紧','續':'续','熱':'热','導':'导','難':'难',
  '風':'风','飛':'飞','飲':'饮','館':'馆','飯':'饭','飽':'饱','餓':'饿','歡':'欢',
  '歲':'岁','幾':'几','歲':'岁','歷':'历','嚴':'严','帶':'带','幫':'帮','幹':'干',
  '塊':'块','壞':'坏','遠':'远','近':'近','運':'运','連':'连','週':'周','號':'号',
  '條':'条','張':'张','陽':'阳','陰':'阴','雙':'双','隻':'只','靈':'灵','煙':'烟',
  '夠':'够','壓':'压','夠':'够','參':'参','備':'备','單':'单','傳':'传','傷':'伤',
  '優':'优','價':'价','劉':'刘','劃':'划','則':'则','剛':'刚','劇':'剧','劃':'划',
  '劍':'剑','勵':'励','勢':'势','廳':'厅','厭':'厌','縣':'县','嘆':'叹','夢':'梦',
  '夠':'够','奮':'奋','婦':'妇','孫':'孙','寧':'宁','對':'对','歲':'岁','島':'岛',
  '師':'师','幫':'帮','幹':'干','廟':'庙','廠':'厂','彈':'弹','復':'复','徵':'征',
  '態':'态','慘':'惨','慮':'虑','憑':'凭','憲':'宪','應':'应','懷':'怀','懼':'惧',
  '戰':'战','戲':'戏','戶':'户','掃':'扫','掛':'挂','採':'采','換':'换','揚':'扬',
  '揮':'挥','損':'损','搶':'抢','搖':'摇','敵':'敌','數':'数','整':'整','斷':'断',
  '時':'时','曬':'晒','書':'书','會':'会','條':'条','業':'业','極':'极','構':'构',
  '標':'标','樣':'样','樹':'树','橋':'桥','機':'机','歷':'历','殺':'杀','氣':'气',
  '沒':'没','決':'决','況':'况','滿':'满','漸':'渐','滅':'灭','準':'准','煙':'烟',
  '熱':'热','爭':'争','爾':'尔','牆':'墙','獨':'独','獲':'获','環':'环','現':'现',
  '當':'当','畫':'画','異':'异','發':'发','盡':'尽','監':'监','盤':'盘','眾':'众',
  '睜':'睁','瞭':'了','確':'确','碼':'码','礎':'础','禮':'礼','窮':'穷','節':'节',
  '範':'范','箱':'箱','範':'范','築':'筑','簽':'签','簡':'简','類':'类','糧':'粮',
  '紀':'纪','約':'约','納':'纳','純':'纯','紙':'纸','級':'级','組':'组','終':'终',
  '結':'结','絕':'绝','統':'统','絲':'丝','經':'经','綠':'绿','網':'网','緊':'紧',
  '線':'线','編':'编','緣':'缘','織':'织','績':'绩','繼':'继','續':'续','罰':'罚',
  '習':'习','聯':'联','聲':'声','膽':'胆','臉':'脸','舉':'举','舊':'旧','臺':'台',
  '與':'与','興':'兴','萬':'万','葉':'叶','處':'处','號':'号','衛':'卫','衝':'冲',
  '術':'术','複':'复','規':'规','視':'视','親':'亲','覽':'览','觀':'观','計':'计',
  '訂':'订','認':'认','記':'记','許':'许','設':'设','訴':'诉','評':'评','詞':'词',
  '試':'试','詩':'诗','話':'话','該':'该','詳':'详','語':'语','誤':'误','說':'说',
  '請':'请','論':'论','諸':'诸','謀':'谋','諷':'讽','講':'讲','證':'证','識':'识',
  '護':'护','讀':'读','變':'变','讓':'让','豐':'丰','財':'财','貨':'货','責':'责',
  '費':'费','資':'资','賓':'宾','賞':'赏','賢':'贤','賴':'赖','購':'购','賣':'卖',
  '質':'质','賞':'赏','賴':'赖','賭':'赌','贊':'赞','贏':'赢','走':'走','趙':'赵',
  '趕':'赶','起':'起','超':'超','越':'越','路':'路','跳':'跳','跟':'跟','跨':'跨',
  '較':'较','載':'载','輕':'轻','輿':'舆','轉':'转','辦':'办','農':'农','運':'运',
  '遠':'远','適':'适','遲':'迟','遷':'迁','遺':'遗','選':'选','還':'还','鄰':'邻',
  '醫':'医','釋':'释','鐵':'铁','錢':'钱','鋼':'钢','錄':'录','鏡':'镜','長':'长',
  '門':'门','間':'间','開':'开','關':'关','隊':'队','陽':'阳','陰':'阴','際':'际',
  '隨':'随','險':'险','雖':'虽','雙':'双','離':'离','難':'难','雲':'云','電':'电',
  '靈':'灵','靜':'静','頁':'页','頂':'顶','項':'项','順':'顺','須':'须','預':'预',
  '頓':'顿','領':'领','頭':'头','題':'题','額':'额','願':'愿','類':'类','風':'风',
  '飛':'飞','養':'养','馬':'马','驚':'惊','魚':'鱼','鳥':'鸟','麗':'丽','黃':'黄',
  '點':'点','齊':'齐'
};

function toSimplified(text) {
  if (!text) return text;
  let result = '';
  for (const ch of text) {
    result += TS_MAP[ch] || ch;
  }
  return result;
}

// ========================================================
//  PROFICIENCY-BASED SRS (墨墨 style)
// ========================================================
const PROFICIENCY_INTERVALS = [0, 1, 3, 7, 15, 30, 60, 120];

function migrateSM2ToProficiency(oldEntry) {
  if (!oldEntry || oldEntry.proficiency !== undefined) return oldEntry;
  let proficiency = 0;
  if (oldEntry.reps >= 5 && oldEntry.int > 21) proficiency = 7;
  else if (oldEntry.reps >= 4) proficiency = Math.min(6, Math.floor(oldEntry.int / 20) + 3);
  else if (oldEntry.reps >= 2) proficiency = Math.min(3, Math.floor(oldEntry.int / 5) + 1);
  else if (oldEntry.reps >= 1) proficiency = 1;
  const nextDate = oldEntry.next
    ? new Date(oldEntry.next + 'T00:00:00')
    : new Date();
  return { proficiency, nextReviewTime: nextDate.toISOString(), lastInterval: oldEntry.int || 0 };
}

function updateProficiency(action, entry) {
  if (!entry || entry.proficiency === undefined) entry = { proficiency: 0, nextReviewTime: null, lastInterval: 0 };
  let prof = entry.proficiency;
  let intervalDays = 0;
  if (action === 'know') {
    prof = Math.min(7, prof + 1);
    intervalDays = PROFICIENCY_INTERVALS[prof];
  } else if (action === 'vague') {
    prof = Math.max(0, prof - 1);
    intervalDays = 1;
  } else {
    prof = 0;
    intervalDays = 0;
  }
  const nextTime = new Date();
  if (intervalDays === 0) { nextTime.setHours(nextTime.getHours() + 1); }
  else { nextTime.setDate(nextTime.getDate() + intervalDays); nextTime.setHours(0, 0, 0, 0); }
  return { proficiency: prof, nextReviewTime: nextTime.toISOString(), lastInterval: intervalDays };
}

function getSRS(wordId) { return srsData[wordId] || null; }
function setSRS(wordId, entry) { srsData[wordId] = entry; saveSRSLocal(); }

function isDue(wordId) { const e = getSRS(wordId); return e && e.nextReviewTime ? new Date(e.nextReviewTime) <= new Date() : false; }
function isNew(wordId) { return !srsData[wordId]; }
function isMastered(wordId) { const e = getSRS(wordId); return e ? e.proficiency >= 7 && new Date(e.nextReviewTime) > new Date() : false; }
function isLearning(wordId) { const e = getSRS(wordId); return e ? !isMastered(wordId) : false; }

function getSRSCategory(wordId) {
  if (isNew(wordId)) return 'new';
  if (isMastered(wordId)) return 'mastered';
  if (isDue(wordId)) return 'due';
  return 'learning';
}

function getSRSLabel(wordId) {
  const e = getSRS(wordId);
  if (!e) return '新词';
  const prof = e.proficiency || 0;
  if (prof >= 7 && new Date(e.nextReviewTime) > new Date()) return '已掌握';
  if (isDue(wordId)) return '待复习';
  if (prof === 0) return '初学';
  if (prof <= 2) return '初学 Lv.' + prof;
  if (prof <= 4) return '熟练 Lv.' + prof;
  return '加强 Lv.' + prof;
}

function getSRSBadgeClass(wordId) {
  const cat = getSRSCategory(wordId);
  if (cat === 'due') return 'badge-due';
  if (cat === 'new') return 'badge-new';
  if (cat === 'mastered') return 'badge-mastered';
  return 'badge-learning';
}

function countByCategory(cat) { return WORDS.filter(w => getSRSCategory(w.id) === cat).length; }
function countDue() { return WORDS.filter(w => isDue(w.id)).length; }

function updateStats() {
  document.getElementById('stat-due').textContent = countDue();
  document.getElementById('stat-learning').textContent = countByCategory('learning');
  document.getElementById('stat-mastered').textContent = countByCategory('mastered');
  document.getElementById('stat-new').textContent = countByCategory('new');
  document.getElementById('stat-total').textContent = WORDS.length;
}

// ========================================================
// ========================================================
//  DAILY SESSION STORAGE
// ========================================================
function getSessionKey() {
  try { return getStorageKey('session_' + todayStr()); }
  catch(e) { return null; }
}
function getDailyWordsKey() {
  try { return getStorageKey('daily_words_' + todayStr()); }
  catch(e) { return null; }
}

function loadSession() {
  try {
    const key = getSessionKey();
    if (!key) return null;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}

function saveDailySession() {
  const key = getSessionKey();
  if (!key) return;
  const data = {
    date: todayStr(),
    queue: sessionQueue,
    completedWords: sessionCompletedWords,
    correctFirstTry: sessionCorrectFirstTry,
    totalAttempts: sessionTotalAttempts,
    startedAt: sessionStartedAt,
    wordAttempts: sessionWordAttempts,
    newWordsTarget: newWordsPerDay,
    status: 'active'
  };
  localStorage.setItem(key, JSON.stringify(data));
}

function clearDailySession() {
  const key = getSessionKey();
  if (key) localStorage.removeItem(key);
  sessionActive = false;
  sessionQueue = [];
  sessionCompletedWords = [];
  sessionCorrectFirstTry = [];
  sessionTotalAttempts = 0;
  sessionStartedAt = null;
  sessionWordAttempts = {};
}

function restoreSession() {
  const data = loadSession();
  if (!data || data.status === 'completed') return false;
  // Support both new format (queue) and old format (mainPool/wrongPool)
  if (data.queue) {
    sessionQueue = data.queue;
  } else if (data.mainPool) {
    // Migrate old round-based format: merge mainPool + wrongPool into single queue
    sessionQueue = [...(data.mainPool || []), ...(data.wrongPool || [])];
  } else {
    sessionQueue = [];
  }
  sessionCompletedWords = data.completedWords || [];
  sessionCorrectFirstTry = data.correctFirstTry || [];
  sessionTotalAttempts = data.totalAttempts || 0;
  sessionStartedAt = data.startedAt || new Date().toISOString();
  sessionWordAttempts = data.wordAttempts || {};
  newWordsPerDay = data.newWordsTarget || 10;
  sessionActive = true;
  sessionMode = true;
  return true;
}

// Clean up old session data (older than 7 days)
function cleanupOldSessions() {
  try {
    const session = getCurrentSession();
    if (!session || !session.accountId) return;
    const prefix = 'flashcards_' + session.accountId + '_session_';
    const keys = Object.keys(localStorage);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    for (const key of keys) {
      if (key.startsWith(prefix)) {
        const dateStr = key.replace(prefix, '');
        if (dateStr < cutoff.toISOString().slice(0, 10)) {
          localStorage.removeItem(key);
        }
      }
    }
  } catch(e) {}
}

//  SPEECH
// ========================================================
let _lastUtterance = null;
function speakWord(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  _lastUtterance = utterance;
  const currentLang = userLanguages.find(l => l.lang === activeLang);
  const speechLang = currentLang ? currentLang.speech_lang : 'en-US';
  utterance.lang = speechLang;
  utterance.rate = listenSpeechRate;
  const voices = speechSynthesis.getVoices();
  const voice = voices.find(v => v.lang.startsWith(speechLang.split('-')[0]));
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}
if ('speechSynthesis' in window) speechSynthesis.getVoices();

// ── Tatoeba Example Fetch ─────────────────────────────
async function fetchExample(wordId) {
  const w = WORDS.find(x => x.id === wordId);
  if (!w) return;

  try {
    const query = encodeURIComponent(w.ru);
    const url = 'https://api.tatoeba.org/v1/sentences?q=' + query + '&lang=rus&showtrans=all&trans:lang=cmn&sort=relevance&limit=10';
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) throw new Error('API error: ' + resp.status);
    const data = await resp.json();

    let bestRu = '', bestZh = '';
    if (data.data && data.data.length > 0) {
      for (const item of data.data) {
        if (item.text.length < 5 || item.text.length > 120) continue;
        const zhTrans = (item.translations || []).find(t => t.lang === 'cmn');
        if (zhTrans) { bestRu = item.text; bestZh = zhTrans.text; break; }
      }
      // Fallback to English translation
      if (!bestRu) {
        for (const item of data.data) {
          if (item.text.length < 5 || item.text.length > 120) continue;
          const enTrans = (item.translations || []).find(t => t.lang === 'eng');
          if (enTrans) { bestRu = item.text; bestZh = enTrans.text; break; }
        }
      }
    }

    if (bestRu) {
      bestZh = toSimplified(bestZh);
      w.example = bestRu; w.exampleZh = bestZh;
      saveDeck();
      const exampleEl = document.getElementById('word-example-' + wordId);
      if (exampleEl) {
        exampleEl.innerHTML = '<div class="example-text">' + escHtml(bestRu) + '</div>' +
          (bestZh ? '<div class="example-zh">' + escHtml(bestZh) + '</div>' : '') +
          '<button class="btn-speak-example" onclick="event.stopPropagation();speakWord(\'' + bestRu.replace(/'/g,"\\'") + '\')"><i class="fa-solid fa-volume-high"></i> 朗读</button>';
      }
    } else {
      w._exampleFetching = false;
      const exampleEl = document.getElementById('word-example-' + wordId);
      if (exampleEl) exampleEl.innerHTML = '<span class="example-none"><i class="fa-solid fa-circle-info"></i> 暂无例句</span>';
    }
  } catch(e) {
    w._exampleFetching = false;
  }
}

async function fetchExampleForQuiz(wordId) {
  const w = WORDS.find(x => x.id === wordId);
  if (!w) return;
  try {
    const query = encodeURIComponent(w.ru);
    const url = 'https://api.tatoeba.org/v1/sentences?q=' + query + '&lang=rus&showtrans=all&trans:lang=cmn&sort=relevance&limit=10';
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) throw new Error('API error: ' + resp.status);
    const data = await resp.json();

    let bestRu = '', bestZh = '';
    if (data.data && data.data.length > 0) {
      for (const item of data.data) {
        if (item.text.length < 5 || item.text.length > 120) continue;
        const zhTrans = (item.translations || []).find(t => t.lang === 'cmn');
        if (zhTrans) { bestRu = item.text; bestZh = zhTrans.text; break; }
      }
      if (!bestRu) {
        for (const item of data.data) {
          if (item.text.length < 5 || item.text.length > 120) continue;
          const enTrans = (item.translations || []).find(t => t.lang === 'eng');
          if (enTrans) { bestRu = item.text; bestZh = enTrans.text; break; }
        }
      }
    }

    if (bestRu) {
      bestZh = toSimplified(bestZh);
      w.example = bestRu; w.exampleZh = bestZh;
      saveDeck();
      // Update quiz feedback if visible
      const fb = document.getElementById('quiz-feedback');
      if (fb) {
        const exampleHtml = '<div class="example-text">' + escHtml(bestRu) + '</div>' +
          (bestZh ? '<div class="example-zh">' + escHtml(bestZh) + '</div>' : '') +
          '<button class="btn-speak-example" onclick="event.stopPropagation();speakWord(\'' + bestRu.replace(/'/g,"\\'") + '\')" style="margin-top:6px;"><i class="fa-solid fa-volume-high"></i> 朗读</button>';
        // Replace the loading spinner inside quiz-example with the example content
        const loadingEl = fb.querySelector('.quiz-example .example-loading');
        if (loadingEl && loadingEl.parentElement) {
          loadingEl.parentElement.innerHTML = exampleHtml;
        }
      }
      // Also update word-example element if present (card mode)
      const exampleEl = document.getElementById('word-example-' + wordId);
      if (exampleEl) {
        exampleEl.innerHTML = '<div class="example-text">' + escHtml(bestRu) + '</div>' +
          (bestZh ? '<div class="example-zh">' + escHtml(bestZh) + '</div>' : '') +
          '<button class="btn-speak-example" onclick="event.stopPropagation();speakWord(\'' + bestRu.replace(/'/g,"\\'") + '\')"><i class="fa-solid fa-volume-high"></i> 朗读</button>';
      }
    } else {
      w._exampleFetching = false;
      const fb2 = document.getElementById('quiz-feedback');
      if (fb2) {
        const loadingEl2 = fb2.querySelector('.quiz-example .example-loading');
        if (loadingEl2 && loadingEl2.parentElement) {
          loadingEl2.parentElement.innerHTML = '<span class="example-none"><i class="fa-solid fa-circle-info"></i> 暂无例句</span>';
        }
      }
    }
  } catch(e) {
    w._exampleFetching = false;
  }
}

function escHtml(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

// ========================================================
//  RENDER: LANGUAGE TABS
// ========================================================
function renderLangTabs() {
  const container = document.getElementById('lang-tabs');
  if (!container) return;
  container.innerHTML = userLanguages.map(l => {
    const active = l.lang === activeLang ? ' active' : '';
    const count = l.lang === activeLang ? WORDS.length : getTotalWordsForLang(l.lang);
    return `<div class="lang-tab${active}" onclick="switchLanguage('${l.lang}')">
      <span class="tab-flag">${l.flag||'<i class="fa-solid fa-globe"></i>'}</span>${l.name}
      <span class="tab-count">${count}</span>
    </div>`;
  }).join('');
}

function renderFolderTabs() {
  const container = document.getElementById('folder-tabs');
  if (!container) return;
  let html = '';
  for (const f of folders) {
    const active = f.id === activeFolderId ? ' active' : '';
    const wordCount = (loadDeckFromStorage(activeLang, f.id) || []).length;
    html += '<div class="folder-tab' + active + '" onclick="switchFolder(\'' + f.id + '\')">' +
      '<span class="tab-folder-icon"><i class="fa-solid fa-folder"></i></span>' + escHtml(f.name) +
      '<span class="tab-count">' + wordCount + '</span>' +
      (folders.length > 1 ? '<button class="folder-delete-btn" onclick="event.stopPropagation();deleteFolder(\'' + f.id + '\')" title="删除文件夹">×</button>' : '') +
      '</div>';
  }
  container.innerHTML = html;
}

function switchLanguage(lang) {
  activeLang = lang;
  flashcardIndex = 0; flashcardFilter = 'all'; flashcardPool = [];
  quizWords = []; quizIndex = 0; quizAnswered = false; listSearchQuery = '';
  folders = loadFolders(lang);
  activeFolderId = folders.length > 0 ? folders[0].id : null;
  loadDeck(lang, activeFolderId);
  renderAll();
  setTimeout(() => {
    const el = document.querySelector('.lang-tab.active');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, 100);
}

function renderAll() {
  renderLangTabs();
  renderFolderTabs();
  renderMain();
}

// ========================================================
//  NAVIGATION
// ========================================================
function setMode(mode) {
  if (memoryTimerInterval) { clearInterval(memoryTimerInterval); memoryTimerInterval = null; }
  currentMode = mode;
  document.querySelectorAll('.bottom-nav .nav-item').forEach(b => b.classList.remove('active'));
  const navEl = document.getElementById('nav-' + mode);
  if (navEl) navEl.classList.add('active');
  listSearchQuery = '';
  // If entering flashcard mode, check for active session
  if (mode === 'flashcard') {
    if (sessionActive) {
      // Session is in progress — continue, keep flashcardIndex
      sessionMode = true;
    } else if (loadSession() && loadSession().status === 'active') {
      // Restore interrupted session
      restoreSession();
      sessionMode = true;
    } else {
      // Default to session mode
      sessionMode = true;
      flashcardIndex = 0; flashcardFilter = 'all'; flashcardPool = [];
    }
  } else {
    flashcardIndex = 0; flashcardFilter = 'all'; flashcardPool = [];
  }
  renderMain();
}

// No longer needed — nav is in bottom-nav

// ========================================================
//  DAILY SESSION WORD SELECTION
// ========================================================

// Simple seed-based shuffle for daily variety
function shuffleWithSeed(arr, seed) {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 16807 + 0) % 2147483647;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getDateSeed() {
  const d = todayStr().replace(/-/g, '');
  return parseInt(d, 10);
}

function buildDailySessionPool(targetCount) {
  // Collect candidates by category
  const dueWords = WORDS.filter(w => isDue(w.id));
  const learningWords = WORDS.filter(w => isLearning(w.id) && !isDue(w.id));
  const newWords = WORDS.filter(w => isNew(w.id));
  const masteredWords = WORDS.filter(w => isMastered(w.id));

  const seed = getDateSeed();

  // Shuffle each pool with date seed
  const shuffledDue = shuffleWithSeed(dueWords, seed);
  const shuffledLearning = shuffleWithSeed(learningWords, seed + 1);
  const shuffledNew = shuffleWithSeed(newWords, seed + 2);
  const shuffledMastered = shuffleWithSeed(masteredWords, seed + 3);

  // Cap new words per day
  const newQuota = Math.min(newWordsPerDay, shuffledNew.length);

  const pool = [];

  // 1. All due words (highest priority)
  for (const w of shuffledDue) pool.push(w.id);

  // 2. Learning words up to target - newQuota
  const remainingForLearning = Math.max(0, targetCount - pool.length - newQuota);
  for (let i = 0; i < Math.min(remainingForLearning, shuffledLearning.length); i++) {
    pool.push(shuffledLearning[i].id);
  }

  // 3. New words up to newWordsPerDay
  for (let i = 0; i < newQuota; i++) {
    pool.push(shuffledNew[i].id);
  }

  // 4. Pad with mastered words if not enough
  const remaining = targetCount - pool.length;
  for (let i = 0; i < Math.min(remaining, shuffledMastered.length); i++) {
    pool.push(shuffledMastered[i].id);
  }

  // If still not enough, use all words
  if (pool.length < Math.min(targetCount, WORDS.length)) {
    const allIds = new Set(pool);
    for (const w of WORDS) {
      if (!allIds.has(w.id)) {
        pool.push(w.id);
        if (pool.length >= targetCount) break;
      }
    }
  }

  return pool;
}

function updateNewWordsPerDay(val) {
  newWordsPerDay = Math.max(5, Math.min(30, parseInt(val) || 10));
  try { localStorage.setItem(getStorageKey('new_words_per_day'), newWordsPerDay); } catch(e) {}
}

// ========================================================
//  FLASHCARD RENDER
// ========================================================
function applyFilter() {
  flashcardPool = [];
  for (let i = 0; i < WORDS.length; i++) {
    const cat = getSRSCategory(WORDS[i].id);
    if (flashcardFilter === 'all') flashcardPool.push(i);
    else if (flashcardFilter === 'due' && cat === 'due') flashcardPool.push(i);
    else if (flashcardFilter === 'learning' && (cat === 'due' || cat === 'learning')) flashcardPool.push(i);
    else if (flashcardFilter === 'new' && cat === 'new') flashcardPool.push(i);
    else if (flashcardFilter === 'mastered' && cat === 'mastered') flashcardPool.push(i);
    else if (flashcardFilter === 'starred' && isStarred(WORDS[i].id)) flashcardPool.push(i);
  }
  if (flashcardIndex >= flashcardPool.length) flashcardIndex = 0;
}

function setFlashcardFilter(f) { flashcardFilter = f; flashcardIndex = 0; applyFilter(); renderFlashcard(); }

// ========================================================
//  DAILY SESSION UI
// ========================================================

function renderSessionStart() {
  if (WORDS.length === 0) {
    document.getElementById('main-content').innerHTML = '<div class="empty-state"><div style="font-size:40px;margin-bottom:12px;"><i class="fa-solid fa-inbox"></i></div><div>还没有单词，点击「导入」添加单词</div></div>';
    return;
  }

  const targetCount = dailyGoal;
  const pool = buildDailySessionPool(targetCount);
  const newCount = pool.filter(id => isNew(id)).length;
  const dueCount = pool.filter(id => isDue(id)).length;
  const learningCount = pool.filter(id => isLearning(id) && !isDue(id)).length;
  const masteredCount = pool.filter(id => isMastered(id)).length;
  const streakData = loadStreak();

  // Cache today's pool
  try { localStorage.setItem(getDailyWordsKey(), JSON.stringify(pool)); } catch(e) {}

  document.getElementById('main-content').innerHTML = `<div class="session-start-screen">
    <div class="session-start-header">
      <div class="session-start-icon"><i class="fa-solid fa-bolt"></i></div>
      <h2>今日复习</h2>
      <p class="session-start-subtitle">${todayStr()} · ${['日','一','二','三','四','五','六'][new Date().getDay()]}</p>
    </div>

    <div class="session-start-stats">
      <div class="sss-item sss-due"><span class="sss-num">${dueCount}</span><span class="sss-label">待复习</span></div>
      <div class="sss-item sss-learning"><span class="sss-num">${learningCount}</span><span class="sss-label">学习中</span></div>
      <div class="sss-item sss-new"><span class="sss-num">${newCount}</span><span class="sss-label">新词</span></div>
      <div class="sss-item sss-mastered"><span class="sss-num">${masteredCount}</span><span class="sss-label">复习巩固</span></div>
    </div>

    <div class="session-start-streak">
      <i class="fa-solid fa-fire"></i> 连续打卡 <strong>${streakData.currentStreak || 0}</strong> 天 · 今日已学 <strong>${streakData.todayCount || 0}</strong> 词
    </div>

    <div class="session-start-actions">
      <button class="btn btn-primary btn-lg session-start-btn" onclick="startDailySession()">
        <i class="fa-solid fa-play"></i> 开始复习 (${pool.length} 词)
      </button>
      <button class="btn btn-ghost btn-sm" onclick="startBrowseMode()">
        浏览全部单词
      </button>
    </div>
  </div>`;
}

function startDailySession() {
  const targetCount = dailyGoal;
  let pool;
  try {
    const cached = localStorage.getItem(getDailyWordsKey());
    pool = cached ? JSON.parse(cached) : null;
  } catch(e) { pool = null; }
  if (!pool || pool.length === 0) {
    pool = buildDailySessionPool(targetCount);
  }

  sessionQueue = [...pool];
  sessionCompletedWords = [];
  sessionCorrectFirstTry = [];
  sessionTotalAttempts = 0;
  sessionStartedAt = new Date().toISOString();
  sessionWordAttempts = {};
  sessionActive = true;
  sessionMode = true;
  flashcardIndex = 0;
  saveDailySession();
  renderSessionCard();
  if (flashcardAutoSpeak) autoSpeakCurrent();
}

function startBrowseMode() {
  sessionMode = false;
  sessionActive = false;
  applyFilter();
  renderFlashcard();
}

function goBackToSessionStart() {
  sessionMode = false;
  sessionActive = false;
  flashcardIndex = 0;
  flashcardFilter = 'all';
  renderSessionStart();
}

function renderSessionCard() {
  if (sessionQueue.length === 0) {
    completeSession();
    return;
  }

  if (flashcardIndex >= sessionQueue.length) flashcardIndex = 0;
  cardStage = 1;
  const wordId = sessionQueue[flashcardIndex];
  const w = WORDS.find(x => x.id === wordId);
  if (!w) {
    // Word might have been deleted
    sessionQueue.splice(flashcardIndex, 1);
    if (flashcardIndex >= sessionQueue.length) flashcardIndex = 0;
    saveDailySession();
    if (sessionQueue.length === 0) { completeSession(); return; }
    renderSessionCard();
    return;
  }

  const mastered = sessionCompletedWords.length;
  const inQueue = sessionQueue.length;
  const totalUnique = mastered + inQueue;
  const progressPct = totalUnique > 0 ? Math.round(mastered / totalUnique * 100) : 0;
  const label = getSRSLabel(w.id), badge = getSRSBadgeClass(w.id);
  const starredClass = isStarred(w.id) ? 'is-starred' : '';
  const attempts = sessionWordAttempts[w.id] || 0;

  document.getElementById('main-content').innerHTML = `<div class="flashcard-container card-enter">
    <div class="session-progress">
      <div class="session-progress-top">
        <span><i class="fa-solid fa-check-circle"></i> 已掌握 <strong>${mastered}</strong> 词</span>
        <span><i class="fa-solid fa-layer-group"></i> 队列 <strong>${inQueue}</strong> 词</span>
      </div>
      <div class="session-progress-bar">
        <div class="session-progress-fill" style="width:${progressPct}%"></div>
      </div>
    </div>

    <div class="word-progress">${flashcardIndex+1} / ${inQueue} · <span class="card-srs-badge ${badge}">${label}</span>${attempts > 1 ? ' · <span class="retry-indicator">第' + attempts + '次</span>' : ''}</div>

    <div class="card-stage" id="card-stage">
      <button class="star-btn-card ${starredClass}" id="star-btn" onclick="event.stopPropagation();toggleStar('${w.id}');renderStarBtn()" title="收藏"><i class="fa-solid fa-star"></i></button>
      <button class="speak-btn-card" onclick="event.stopPropagation();speakWord('${w.ru.replace(/'/g,"\\'")}')" title="发音"><i class="fa-solid fa-volume-high"></i></button>

      <div class="russian-word">${escHtml(w.ru)}</div>
      <div class="russian-tr">${escHtml(w.tr||'')}</div>

      <div class="answer-reveal answer-hidden" id="answer-reveal">
        <div class="chinese-def">${escHtml(w.zh)}</div>
        <div class="word-pos">${escHtml(w.pos||'')}</div>
        <div class="word-example" id="word-example-${w.id}">
          ${w.example ? '<div class="example-text">' + escHtml(w.example) + '</div>' + (w.exampleZh ? '<div class="example-zh">' + escHtml(toSimplified(w.exampleZh)) + '</div>' : '') + '<button class="btn-speak-example" onclick="event.stopPropagation();speakWord(\'' + w.example.replace(/'/g,"\\'") + '\')\" style=\"margin-top:8px;\"><i class=\"fa-solid fa-volume-high\"></i> 朗读</button>' : '<button class="btn-generate-example" id="btn-gen-' + w.id + '" onclick="event.stopPropagation();fetchExample(\'' + w.id + '\')\" style=\"margin-top:6px;\"><i class=\"fa-solid fa-robot\"></i> 生成例句</button>'}
        </div>
      </div>
    </div>

    <div class="stage-actions" id="stage-actions">
      <button class="stage-btn stage-btn-dontknow" onclick="handleStage1('dontknow')">不认识</button>
      <button class="stage-btn stage-btn-unsure" onclick="handleStage1('unsure')">模糊</button>
      <button class="stage-btn stage-btn-know" onclick="handleStage1('know')">认识</button>
    </div>

    <div class="stage-nav">
      <button class="btn btn-ghost" onclick="prevCard()">←</button>
      <button class="btn btn-ghost" onclick="sessionShuffleCard()"><i class="fa-solid fa-shuffle"></i></button>
      <button class="btn btn-ghost" onclick="nextCard()">→</button>
    </div>
    <div style="text-align:center;margin-top:4px;">
      <button class="btn btn-ghost btn-sm" onclick="finishSessionEarly()" style="font-size:11px;color:var(--text-muted);">结束本次复习</button>
    </div>
  </div>`;

  // Auto-fetch example
  if (!w.example && !w._exampleFetching) {
    w._exampleFetching = true;
    fetchExample(w.id);
  }
}

function completeSession() {
  sessionActive = false;
  const duration = sessionStartedAt ? Math.round((new Date() - new Date(sessionStartedAt)) / 1000) : 0;
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  const timeStr = minutes > 0 ? minutes + '分' + seconds + '秒' : seconds + '秒';
  const mastered = sessionCompletedWords.length;
  const remaining = sessionQueue.length;
  const totalUnique = mastered + remaining;
  const correctPct = totalUnique > 0 ? Math.round(mastered / totalUnique * 100) : 0;
  const streakData = loadStreak();

  // Find hardest words (took most attempts)
  const hardestEntries = Object.entries(sessionWordAttempts)
    .filter(([, count]) => count >= 2)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([id, count]) => {
      const w = WORDS.find(x => x.id === id);
      return w ? { word: w.ru, attempts: count } : null;
    })
    .filter(Boolean);

  // Save session as completed
  const data = loadSession();
  if (data) {
    data.status = 'completed';
    data.completedAt = new Date().toISOString();
    // Include remaining queue words so they can be retried
    data.remainingQueue = sessionQueue;
    try { localStorage.setItem(getSessionKey(), JSON.stringify(data)); } catch(e) {}
  }

  document.getElementById('main-content').innerHTML = `<div class="session-complete-screen">
    <div class="session-complete-header">
      <div class="session-complete-icon"><i class="fa-solid fa-trophy"></i></div>
      <h2>今日复习完成！</h2>
      <p class="session-complete-subtitle">
        ${correctPct >= 90 ? '太棒了，几乎全对！' : correctPct >= 70 ? '做得不错，继续保持！' : '继续加油，你可以的！'}
      </p>
    </div>

    <div class="session-complete-stats">
      <div class="scs-card">
        <div class="scs-num">${totalUnique}</div>
        <div class="scs-label">已复习</div>
      </div>
      <div class="scs-card">
        <div class="scs-num">${correctPct}%</div>
        <div class="scs-label">正确率</div>
      </div>
      <div class="scs-card">
        <div class="scs-num">${sessionTotalAttempts}</div>
        <div class="scs-label">总答题</div>
      </div>
      <div class="scs-card">
        <div class="scs-num">${timeStr}</div>
        <div class="scs-label">用时</div>
      </div>
    </div>

    <div class="session-complete-streak">
      <i class="fa-solid fa-fire"></i> 连续打卡 <strong>${streakData.currentStreak || 0}</strong> 天
    </div>

    ${hardestEntries.length > 0 ? `<div class="session-complete-hardest">
      <div class="sch-title">需要多练的单词</div>
      ${hardestEntries.map(h => '<div class="sch-word"><span>' + escHtml(h.word) + '</span><span class="sch-attempts">' + h.attempts + ' 次</span></div>').join('')}
    </div>` : ''}

    <div class="session-complete-actions">
      ${remaining > 0 ? `<button class="btn btn-primary" onclick="retryRemainingWords()"><i class="fa-solid fa-arrow-rotate-right"></i> 再练未掌握 (${remaining})</button>` : ''}
      <button class="btn btn-outline" onclick="startDailySession()">开始新一轮</button>
      <button class="btn btn-ghost btn-sm" onclick="startBrowseMode()">浏览全部单词</button>
    </div>
  </div>`;

  // Launch confetti
  setTimeout(() => {
    const el = document.querySelector('.session-complete-icon');
    if (el) {
      const rect = el.getBoundingClientRect();
      launchConfetti(rect.left + rect.width/2, rect.top + rect.height/2);
    }
  }, 300);

  playSound('milestone');
  updateStats();
}

// Retry words that weren't mastered (still in the queue at session end)
function retryRemainingWords() {
  const data = loadSession();
  const remaining = data?.remainingQueue || sessionQueue;
  sessionQueue = [...remaining];
  sessionCompletedWords = [];
  sessionCorrectFirstTry = [];
  sessionTotalAttempts = 0;
  sessionStartedAt = new Date().toISOString();
  sessionWordAttempts = {};
  sessionActive = true;
  sessionMode = true;
  flashcardIndex = 0;
  saveDailySession();
  renderSessionCard();
  if (flashcardAutoSpeak) autoSpeakCurrent();
}

// Keep backward compatibility alias
function retryWrongWords() { retryRemainingWords(); }

function finishSessionEarly() {
  const remaining = sessionQueue.length;
  if (remaining > 0) {
    if (!confirm('已掌握 ' + sessionCompletedWords.length + ' 个单词，还有 ' + remaining + ' 个未完成。\n确定要结束本次复习吗？')) return;
  }
  completeSession();
}

function sessionShuffleCard() {
  if (sessionQueue.length <= 1) return;
  flashcardIndex = Math.floor(Math.random() * sessionQueue.length);
  cardStage = 1;
  renderSessionCard();
  if (flashcardAutoSpeak) autoSpeakCurrent();
}

// ── Two-Stage Card Interaction ──────────────────────
let cardStage = 1; // 1 = question, 2 = answer revealed

function renderFlashcard() {
  if (WORDS.length === 0) {
    document.getElementById('main-content').innerHTML = '<div class="empty-state"><div style="font-size:40px;margin-bottom:12px;"><i class="fa-solid fa-inbox"></i></div><div>还没有单词，点击「导入」添加单词</div></div>';
    return;
  }
  applyFilter();
  if (flashcardPool.length === 0) {
    const msgs = { due: '没有待复习的单词！', learning: '没有学习中的单词！', new: '没有新单词！', mastered: '还没有已掌握的单词！', all: '没有单词！', starred: '还没有收藏的单词！' };
    document.getElementById('main-content').innerHTML = `<div class="flashcard-container">
      <button class="btn-back-to-session" onclick="goBackToSessionStart()"><i class="fa-solid fa-arrow-left"></i> 返回今日复习</button>
      <div class="filter-bar">${['all','due','learning','new','mastered','starred'].map(f =>
        `<button onclick="setFlashcardFilter('${f}')" class="${flashcardFilter===f?'active':''}">${f==='all'?'全部':f==='due'?'<i class="fa-solid fa-hourglass-half"></i>待复习':f==='learning'?'<i class="fa-solid fa-calendar"></i>学习中':f==='new'?'<i class="fa-solid fa-pen-to-square"></i>新词':f==='mastered'?'<i class="fa-solid fa-circle-check"></i>已掌握':'<i class="fa-solid fa-star"></i>收藏'}</button>`
      ).join('')}</div>
      <div class="empty-state"><div style="font-size:40px;margin-bottom:12px;"><i class="fa-solid fa-bullseye"></i></div><div>${msgs[flashcardFilter]}</div></div></div>`;
    return;
  }
  if (flashcardIndex >= flashcardPool.length) flashcardIndex = 0;
  cardStage = 1;
  const w = WORDS[flashcardPool[flashcardIndex]];
  const label = getSRSLabel(w.id), badge = getSRSBadgeClass(w.id);
  const starredClass = isStarred(w.id) ? 'is-starred' : '';

  document.getElementById('main-content').innerHTML = `<div class="flashcard-container card-enter">
    <button class="btn-back-to-session" onclick="goBackToSessionStart()"><i class="fa-solid fa-arrow-left"></i> 返回今日复习</button>
    <div class="filter-bar">${['all','due','learning','new','mastered','starred'].map(f =>
      `<button onclick="setFlashcardFilter('${f}')" class="${flashcardFilter===f?'active':''}">${f==='all'?'全部':f==='due'?'<i class="fa-solid fa-hourglass-half"></i>'+countByCategory('due'):f==='learning'?'<i class="fa-solid fa-calendar"></i>'+countByCategory('learning'):f==='new'?'<i class="fa-solid fa-pen-to-square"></i>'+countByCategory('new'):f==='mastered'?'<i class="fa-solid fa-circle-check"></i>'+countByCategory('mastered'):'<i class="fa-solid fa-star"></i>'+starredCount()}</button>`
    ).join('')}</div>
    <div class="word-progress">${flashcardIndex+1} / ${flashcardPool.length} · <span class="card-srs-badge ${badge}">${label}</span></div>

    <div class="card-stage" id="card-stage">
      <button class="star-btn-card ${starredClass}" id="star-btn" onclick="event.stopPropagation();toggleStar('${w.id}');renderStarBtn()" title="收藏"><i class="fa-solid fa-star"></i></button>
      <button class="speak-btn-card" onclick="event.stopPropagation();speakWord('${w.ru.replace(/'/g,"\\'")}')" title="发音"><i class="fa-solid fa-volume-high"></i></button>

      <div class="russian-word">${w.ru}</div>
      <div class="russian-tr">${w.tr||''}</div>

      <div class="answer-reveal answer-hidden" id="answer-reveal">
        <div class="chinese-def">${w.zh}</div>
        <div class="word-pos">${w.pos||''}</div>
        <div class="word-example" id="word-example-${w.id}">
          ${w.example ? '<div class="example-text">' + escHtml(w.example) + '</div>' + (w.exampleZh ? '<div class="example-zh">' + escHtml(toSimplified(w.exampleZh)) + '</div>' : '') + '<button class="btn-speak-example" onclick="event.stopPropagation();speakWord(\'' + w.example.replace(/'/g,"\\'") + '\')\" style=\"margin-top:8px;\"><i class=\"fa-solid fa-volume-high\"></i> 朗读</button>' : '<button class="btn-generate-example" id="btn-gen-' + w.id + '" onclick="event.stopPropagation();fetchExample(\'' + w.id + '\')\" style=\"margin-top:6px;\"><i class=\"fa-solid fa-robot\"></i> 生成例句</button>'}
        </div>
      </div>
    </div>

    <div class="stage-actions" id="stage-actions">
      <button class="stage-btn stage-btn-dontknow" onclick="handleStage1('dontknow')">不认识</button>
      <button class="stage-btn stage-btn-unsure" onclick="handleStage1('unsure')">模糊</button>
      <button class="stage-btn stage-btn-know" onclick="handleStage1('know')">认识</button>
    </div>

    <div class="stage-nav">
      <button class="btn btn-ghost" onclick="prevCard()">←</button>
      <button class="btn btn-ghost" onclick="shuffleCard()"><i class="fa-solid fa-shuffle"></i></button>
      <button class="btn btn-ghost" onclick="nextCard()">→</button>
    </div></div>`;
  // Auto-fetch example if word does not have one yet
  if (!w.example && !w._exampleFetching) {
    w._exampleFetching = true;
    fetchExample(w.id);
  }
}

function renderStarBtn() {
  const btn = document.getElementById('star-btn');
  if (!btn) return;
  let w;
  if (sessionActive) {
    const wordId = sessionQueue[flashcardIndex];
    if (wordId === undefined) return;
    w = WORDS.find(x => x.id === wordId);
  } else {
    const idx = flashcardPool[flashcardIndex];
    if (idx === undefined) return;
    w = WORDS[idx];
  }
  if (!w) return;
  if (isStarred(w.id)) { btn.classList.add('is-starred'); }
  else { btn.classList.remove('is-starred'); }
}

function handleStage1(choice) {
  let wordId;
  if (sessionActive) {
    wordId = sessionQueue[flashcardIndex];
  } else {
    const idx = flashcardPool[flashcardIndex];
    wordId = idx !== undefined ? WORDS[idx]?.id : undefined;
  }
  if (wordId === undefined) return;
  const w = WORDS.find(x => x.id === wordId);
  if (!w) return;

  // Track attempts for hardest-words
  if (sessionActive) {
    sessionWordAttempts[wordId] = (sessionWordAttempts[wordId] || 0) + 1;
    sessionTotalAttempts++;
  }

  const reveal = document.getElementById('answer-reveal');
  const actions = document.getElementById('stage-actions');
  cardStage = 2;

  if (choice === 'know') {
    if (reveal) reveal.classList.remove('answer-hidden');
    const cardStage_el = document.getElementById('card-stage');
    if (cardStage_el) { cardStage_el.classList.add('revealed'); const cr = cardStage_el.getBoundingClientRect(); launchConfetti(cr.left + cr.width/2, cr.top + cr.height/2); }
    playSound('correct'); vibrate('correct');
    setSRS(w.id, updateProficiency('know', getSRS(w.id)));
    recordReview(); updateStats();
    if (sessionActive) {
      // Remove from queue → mastered, never comes back this session
      sessionQueue.splice(flashcardIndex, 1);
      sessionCompletedWords.push(w.id);
      if (!sessionCorrectFirstTry.includes(w.id)) {
        sessionCorrectFirstTry.push(w.id);
      }
      // flashcardIndex now points to next word in queue (after splice)
      if (sessionQueue.length === 0) {
        saveDailySession();
        if (manualAdvance) {
          if (actions) actions.innerHTML = '<div style="width:100%;text-align:center;font-size:16px;color:var(--primary);padding:12px;font-weight:600;">✓ 已掌握</div><button class="btn btn-primary" style="margin-top:8px;width:100%;" onclick="completeSession()">完成 →</button>';
        } else {
          if (actions) actions.innerHTML = '<div style="width:100%;text-align:center;font-size:16px;color:var(--primary);padding:12px;font-weight:600;">🎉 全部完成！</div>';
          setTimeout(() => completeSession(), 800);
        }
        return;
      }
      if (flashcardIndex >= sessionQueue.length) flashcardIndex = 0;
      saveDailySession();
    }
    if (manualAdvance) {
      if (actions) actions.innerHTML = '<div style="width:100%;text-align:center;font-size:16px;color:var(--primary);padding:12px;font-weight:600;">✓ 已掌握</div><button class="btn btn-primary" style="margin-top:8px;width:100%;" onclick="advanceAfterAnswer()">下一张 →</button>';
    } else {
      if (actions) actions.innerHTML = '<div style="width:100%;text-align:center;font-size:16px;color:var(--primary);padding:12px;font-weight:600;">✓ 已掌握</div>';
      setTimeout(() => advanceAfterAnswer(), 600);
    }
    return;
  }

  // ── unsure / dontknow ──
  if (reveal) reveal.classList.remove('answer-hidden');
  const action = choice === 'unsure' ? 'vague' : 'forgot';
  setSRS(w.id, updateProficiency(action, getSRS(w.id)));
  if (choice === 'dontknow') { playSound('wrong'); vibrate('wrong'); }
  else { playSound('flip'); }
  recordReview(); updateStats();

  if (sessionActive) {
    const tooManyAttempts = sessionWordAttempts[wordId] >= SESSION_MAX_ATTEMPTS;
    // Remove current word from queue
    sessionQueue.splice(flashcardIndex, 1);

    if (tooManyAttempts) {
      // Force-master: too many attempts, don't reinsert
      sessionCompletedWords.push(wordId);
    } else if (choice === 'dontknow') {
      // Reinsert after 1-3 positions → word comes back very soon
      const delay = 1 + Math.floor(Math.random() * 3);
      const insertPos = Math.min(flashcardIndex + delay, sessionQueue.length);
      sessionQueue.splice(insertPos, 0, wordId);
    } else {
      // Reinsert after 5-10 positions → word comes back after medium delay
      const delay = 5 + Math.floor(Math.random() * 6);
      const insertPos = Math.min(flashcardIndex + delay, sessionQueue.length);
      sessionQueue.splice(insertPos, 0, wordId);
    }

    // flashcardIndex now points to next word after the removed one
    if (sessionQueue.length === 0) {
      saveDailySession();
      if (manualAdvance) {
        if (actions) actions.innerHTML = '<div style="width:100%;text-align:center;font-size:14px;color:var(--text-muted);padding:8px;">' + (tooManyAttempts ? '已达最大尝试次数' : '即将回归') + '</div><button class="btn btn-primary" style="margin-top:8px;width:100%;" onclick="completeSession()">完成 →</button>';
      } else {
        if (actions) actions.innerHTML = '<div style="width:100%;text-align:center;font-size:14px;color:var(--text-muted);padding:8px;">🎉 全部完成！</div>';
        setTimeout(() => completeSession(), 800);
      }
      return;
    }
    if (flashcardIndex >= sessionQueue.length) flashcardIndex = 0;
    saveDailySession();
  } else {
    pushCurrentToEnd();
  }

  const reinsertMsg = sessionActive
    ? (choice === 'dontknow' ? '即将回归（1-3 张后）' : '稍后回归（5-10 张后）')
    : '已加入复习队列';
  if (manualAdvance) {
    if (actions) actions.innerHTML = '<div style="width:100%;text-align:center;font-size:14px;color:var(--text-muted);padding:8px;">' + reinsertMsg + '</div><button class="btn btn-primary" style="margin-top:8px;width:100%;" onclick="advanceAfterAnswer()">下一张 →</button>';
  } else {
    if (actions) actions.innerHTML = '<div style="width:100%;text-align:center;font-size:14px;color:var(--text-muted);padding:8px;">' + reinsertMsg + '</div>';
    setTimeout(() => advanceAfterAnswer(), 800);
  }
}

// Advance to next card WITHOUT incrementing index — used after answering
// (the word was already removed from queue, so index points to the next word)
function advanceAfterAnswer() {
  if (sessionActive) {
    if (sessionQueue.length === 0) {
      completeSession();
      return;
    }
    cardStage = 1;
    renderSessionCard();
    if (flashcardAutoSpeak) autoSpeakCurrent();
  } else {
    flashcardIndex = (flashcardIndex + 1) % (flashcardPool.length || 1);
    cardStage = 1;
    renderFlashcard();
    if (flashcardAutoSpeak) autoSpeakCurrent();
  }
}

function pushCurrentToEnd() {
  if (flashcardPool.length <= 1) return;
  const item = flashcardPool.splice(flashcardIndex, 1)[0];
  flashcardPool.push(item);
  if (flashcardIndex >= flashcardPool.length) flashcardIndex = 0;
}

function nextCard() {
  if (sessionActive) {
    if (sessionQueue.length === 0) {
      completeSession();
      return;
    }
    flashcardIndex = (flashcardIndex + 1) % sessionQueue.length;
    cardStage = 1;
    renderSessionCard();
    if (flashcardAutoSpeak) autoSpeakCurrent();
  } else {
    flashcardIndex = (flashcardIndex + 1) % (flashcardPool.length || 1);
    cardStage = 1;
    renderFlashcard();
    if (flashcardAutoSpeak) autoSpeakCurrent();
  }
}
function prevCard() {
  if (sessionActive) {
    if (sessionQueue.length === 0) return;
    flashcardIndex = (flashcardIndex - 1 + sessionQueue.length) % sessionQueue.length;
    cardStage = 1;
    renderSessionCard();
    if (flashcardAutoSpeak) autoSpeakCurrent();
  } else {
    flashcardIndex = (flashcardIndex - 1 + flashcardPool.length) % (flashcardPool.length || 1);
    cardStage = 1;
    renderFlashcard();
    if (flashcardAutoSpeak) autoSpeakCurrent();
  }
}
function shuffleCard() { flashcardIndex = Math.floor(Math.random() * (flashcardPool.length || 1)); cardStage = 1; renderFlashcard(); if (flashcardAutoSpeak) autoSpeakCurrent(); }
function autoSpeakCurrent() {
  if (sessionActive) {
    const wordId = sessionQueue[flashcardIndex];
    if (wordId !== undefined) {
      const w = WORDS.find(x => x.id === wordId);
      if (w) speakWord(w.ru);
    }
  } else {
    const idx = flashcardPool[flashcardIndex];
    if (idx !== undefined && WORDS[idx]) speakWord(WORDS[idx].ru);
  }
}

// ========================================================
//  QUIZ
// ========================================================
function setQuizType(t) { quizType = t; startQuiz(); }

function startQuiz() {
  const due = shuffleArr(WORDS.filter(w => isDue(w.id)));
  const learning = shuffleArr(WORDS.filter(w => isLearning(w.id) && !isDue(w.id)));
  const fresh = shuffleArr(WORDS.filter(w => isNew(w.id)));
  const mastered = shuffleArr(WORDS.filter(w => isMastered(w.id)));
  const starred = shuffleArr(WORDS.filter(w => isStarred(w.id)));
  const nonStarred = [...due, ...learning, ...fresh, ...mastered].filter(w => !isStarred(w.id));
  quizWords = [...starred, ...nonStarred].slice(0, 15);
  quizIndex = 0; quizAnswered = false; quizCombo = 0;
  renderQuiz();
}

function renderQuiz() {
  if (WORDS.length === 0) {
    document.getElementById('main-content').innerHTML = '<div class="empty-state"><div style="font-size:40px;margin-bottom:12px;"><i class="fa-solid fa-inbox"></i></div><div>还没有单词</div></div>';
    return;
  }
  if (quizWords.length === 0) { startQuiz(); return; }

  if (quizIndex >= quizWords.length) {
    const correct = quizWords.filter(w => w._correct).length;
    document.getElementById('main-content').innerHTML = `<div class="quiz-container">
      <div class="quiz-type-bar">
        <button onclick="setQuizType('ru-zh')" class="${quizType==='ru-zh'?'active':''}">外→中 选择</button>
        <button onclick="setQuizType('zh-ru')" class="${quizType==='zh-ru'?'active':''}">中→外 选择</button>
        <button onclick="setQuizType('typing')" class="${quizType==='typing'?'active':''}"><i class="fa-solid fa-keyboard"></i> 打字</button>
      </div>
      <div style="text-align:center;padding:60px 20px;">
        <div style="font-size:48px;margin-bottom:16px;"><i class="fa-solid fa-champagne-glasses"></i></div>
        <div style="font-size:22px;font-weight:600;margin-bottom:8px;">测验完成！</div>
        <div style="font-size:16px;color:#666;margin-bottom:24px;">正确 ${correct}/${quizWords.length}</div>
        <button class="btn btn-primary" onclick="startQuiz()">再来一轮</button>
      </div></div>`;
    return;
  }

  const w = quizWords[quizIndex];
  quizAnswered = false; w._correct = false;
  if (quizType === 'typing') renderTypingQuiz(w);
  else if (quizType === 'zh-ru') renderReverseQuiz(w);
  else renderNormalQuiz(w);
}

function renderNormalQuiz(w) {
  const others = shuffleArr(WORDS.filter(x => x.id !== w.id)).slice(0, 3);
  const options = shuffleArr([w, ...others]);
  document.getElementById('main-content').innerHTML = `<div class="quiz-container">
    <div class="quiz-type-bar">
      <button onclick="setQuizType('ru-zh')" class="${quizType==='ru-zh'?'active':''}">外→中 选择</button>
      <button onclick="setQuizType('zh-ru')" class="${quizType==='zh-ru'?'active':''}">中→外 选择</button>
      <button onclick="setQuizType('typing')" class="${quizType==='typing'?'active':''}"><i class="fa-solid fa-keyboard"></i> 打字</button>
    </div>
    <div style="display:flex;justify-content:center;align-items:center;gap:8px;">
      <div class="quiz-prompt">${w.ru}</div>
      <button class="btn-speak" style="position:static;" onclick="event.stopPropagation();speakWord('${w.ru.replace(/'/g,"\\'")}')"><i class="fa-solid fa-volume-high"></i></button>
    </div>
    <div class="quiz-prompt-sub">${w.tr||''}</div>
    <div class="word-counter">第 ${quizIndex+1}/${quizWords.length} 题</div>
    <div class="options">${options.map(o => `<button class="option enter" data-id="${o.id}" onclick="answerQuizChoice('${o.id}')">${o.zh}</button>`).join('')}</div>
    <div class="quiz-feedback" id="quiz-feedback"></div>
    <button class="btn btn-primary quiz-next" id="quiz-next-btn" onclick="nextQuiz()">下一题 →</button></div>`;
}

function renderReverseQuiz(w) {
  const others = shuffleArr(WORDS.filter(x => x.id !== w.id)).slice(0, 3);
  const options = shuffleArr([w, ...others]);
  document.getElementById('main-content').innerHTML = `<div class="quiz-container">
    <div class="quiz-type-bar">
      <button onclick="setQuizType('ru-zh')" class="${quizType==='ru-zh'?'active':''}">外→中 选择</button>
      <button onclick="setQuizType('zh-ru')" class="${quizType==='zh-ru'?'active':''}">中→外 选择</button>
      <button onclick="setQuizType('typing')" class="${quizType==='typing'?'active':''}"><i class="fa-solid fa-keyboard"></i> 打字</button>
    </div>
    <div class="quiz-prompt">${w.zh}</div>
    <div class="quiz-prompt-sub">${w.pos||''}</div>
    <div class="word-counter">第 ${quizIndex+1}/${quizWords.length} 题</div>
    <div class="options">${options.map(o => `<button class="option enter" data-id="${o.id}" onclick="answerQuizChoice('${o.id}')">${o.ru} <span style="font-size:13px;color:var(--text-muted);">${o.tr||''}</span></button>`).join('')}</div>
    <div class="quiz-feedback" id="quiz-feedback"></div>
    <button class="btn btn-primary quiz-next" id="quiz-next-btn" onclick="nextQuiz()">下一题 →</button></div>`;
}

function renderTypingQuiz(w) {
  document.getElementById('main-content').innerHTML = `<div class="quiz-container">
    <div class="quiz-type-bar">
      <button onclick="setQuizType('ru-zh')" class="${quizType==='ru-zh'?'active':''}">外→中 选择</button>
      <button onclick="setQuizType('zh-ru')" class="${quizType==='zh-ru'?'active':''}">中→外 选择</button>
      <button onclick="setQuizType('typing')" class="${quizType==='typing'?'active':''}"><i class="fa-solid fa-keyboard"></i> 打字</button>
    </div>
    <div class="quiz-prompt">${w.zh}</div>
    <div class="quiz-prompt-sub">${w.pos||''} · 请输入对应单词</div>
    <div class="word-counter">第 ${quizIndex+1}/${quizWords.length} 题</div>
    <input type="text" class="typing-input" id="typing-input" placeholder="输入..." autocomplete="off" onkeydown="handleTypingKey(event)">
    <div style="text-align:center;"><button class="btn btn-primary" onclick="submitTyping()">提交</button></div>
    <div class="quiz-feedback" id="quiz-feedback"></div>
    <button class="btn btn-primary quiz-next" id="quiz-next-btn" onclick="nextQuiz()">下一题 →</button></div>`;
  setTimeout(() => { const inp = document.getElementById('typing-input'); if (inp) inp.focus(); }, 100);
}

function handleTypingKey(e) { if (e.key === 'Enter') { e.preventDefault(); submitTyping(); } }

function normalizeCompare(s) { return s.replace(/[́]/g, '').replace(/[ʼ'`]/g, '').toLowerCase().trim(); }

function submitTyping() {
  if (quizAnswered) return;
  const input = document.getElementById('typing-input'); if (!input) return;
  const answer = input.value.trim(); if (!answer) return;
  quizAnswered = true; const w = quizWords[quizIndex];
  const isCorrect = normalizeCompare(answer) === normalizeCompare(w.ru);
  const fb = document.getElementById('quiz-feedback');
  if (isCorrect) {
    input.classList.add('correct-typing'); input.disabled = true;
    fb.innerHTML = '<i class="fa-solid fa-circle-check"></i> 完全正确！' + (w.example ? '<div class="quiz-example"><div class="example-text">' + escHtml(w.example) + '</div>' + (w.exampleZh ? '<div class="example-zh">' + escHtml(toSimplified(w.exampleZh)) + '</div>' : '') + '<button class="btn-speak-example" onclick="event.stopPropagation();speakWord(\'' + w.example.replace(/'/g,"\\'") + '\')" style="margin-top:6px;"><i class="fa-solid fa-volume-high"></i> 朗读</button></div>' : '<div class="quiz-example"><span class="example-loading"><i class="fa-solid fa-spinner fa-spin"></i> 例句加载中...</span></div>'); fb.className = 'quiz-feedback correct-fb';
    w._correct = true;
    setSRS(w.id, updateProficiency('know', getSRS(w.id)));
    speakWord(w.ru);
    playSound('correct'); vibrate('correct');
  } else {
    input.classList.add('wrong-typing'); input.disabled = true;
    fb.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> 正确答案是：<strong>${w.ru}</strong> ${w.tr||''}` + (w.example ? '<div class="quiz-example"><div class="example-text">' + escHtml(w.example) + '</div>' + (w.exampleZh ? '<div class="example-zh">' + escHtml(toSimplified(w.exampleZh)) + '</div>' : '') + '</div>' : '<div class="quiz-example"><span class="example-loading"><i class="fa-solid fa-spinner fa-spin"></i> 例句加载中...</span></div>');
    fb.className = 'quiz-feedback wrong-fb';
    setSRS(w.id, updateProficiency('forgot', getSRS(w.id)));
    playSound('wrong'); vibrate('wrong');
  }
  recordReview();
  updateStats();
  document.getElementById('quiz-next-btn').classList.add('show');
  // Auto-fetch example if word doesn't have one
  if (!w.example && !w._exampleFetching) {
    w._exampleFetching = true;
    fetchExampleForQuiz(w.id);
  }
}

function answerQuizChoice(selectedId) {
  if (quizAnswered) return;
  quizAnswered = true; const w = quizWords[quizIndex];
  const isCorrect = selectedId === w.id;
  document.querySelectorAll('.option').forEach(el => {
    el.disabled = true;
    if (el.dataset.id === w.id) el.classList.add('correct');
    else if (el.dataset.id === selectedId && !isCorrect) el.classList.add('wrong');
  });
  const fb = document.getElementById('quiz-feedback');
  if (isCorrect) {
    fb.innerHTML = '<i class="fa-solid fa-circle-check"></i> 正确！' + (w.example ? '<div class="quiz-example"><div class="example-text">' + escHtml(w.example) + '</div>' + (w.exampleZh ? '<div class="example-zh">' + escHtml(toSimplified(w.exampleZh)) + '</div>' : '') + '<button class="btn-speak-example" onclick="event.stopPropagation();speakWord(\'' + w.example.replace(/'/g,"\\'") + '\')" style="margin-top:6px;"><i class="fa-solid fa-volume-high"></i> 朗读</button></div>' : '<div class="quiz-example"><span class="example-loading"><i class="fa-solid fa-spinner fa-spin"></i> 例句加载中...</span></div>'); fb.className = 'quiz-feedback correct-fb';
    w._correct = true;
    setSRS(w.id, updateProficiency('know', getSRS(w.id)));
    playSound('correct'); vibrate('correct');
  } else {
    fb.innerHTML = (quizType === 'zh-ru' ? `<i class="fa-solid fa-circle-xmark"></i> 正确答案：<strong>${w.ru}</strong> ${w.tr||''} (${w.zh})` : '<i class="fa-solid fa-circle-xmark"></i> 正确答案：' + w.zh) + (w.example ? '<div class="quiz-example"><div class="example-text">' + escHtml(w.example) + '</div>' + (w.exampleZh ? '<div class="example-zh">' + escHtml(toSimplified(w.exampleZh)) + '</div>' : '') + '<button class="btn-speak-example" onclick="event.stopPropagation();speakWord(\'' + w.example.replace(/'/g,"\\'") + '\')" style="margin-top:6px;"><i class="fa-solid fa-volume-high"></i> 朗读</button></div>' : '<div class="quiz-example"><span class="example-loading"><i class="fa-solid fa-spinner fa-spin"></i> 例句加载中...</span></div>');
    fb.className = 'quiz-feedback wrong-fb';
    setSRS(w.id, updateProficiency('forgot', getSRS(w.id)));
    playSound('wrong'); vibrate('wrong');
  }
  recordReview();
  updateStats();
  document.getElementById('quiz-next-btn').classList.add('show');
  // Auto-fetch example if word doesn't have one
  if (!w.example && !w._exampleFetching) {
    w._exampleFetching = true;
    fetchExampleForQuiz(w.id);
  }
}

function nextQuiz() { quizIndex++; renderQuiz(); }

// ========================================================
//  MEMORY GAME
// ========================================================
function startMemoryGame() {
  // Cleanup any running timer
  if (memoryTimerInterval) { clearInterval(memoryTimerInterval); memoryTimerInterval = null; }

  // Guard: need at least 8 words
  if (WORDS.length < 8) {
    document.getElementById('main-content').innerHTML = `<div class="memory-empty">
      <div class="memory-empty-icon"><i class="fa-solid fa-puzzle-piece"></i></div>
      <h3>需要至少 8 个单词</h3>
      <p>当前只有 ${WORDS.length} 个单词，添加更多单词后再来玩吧！</p>
      <button class="btn btn-outline" style="margin-top:16px;width:auto;display:inline-block;" onclick="setMode('flashcard')">
        <i class="fa-solid fa-layer-group"></i> 去背单词
      </button>
    </div>`;
    return;
  }

  // Pick 8 random words
  const selected = shuffleArr([...WORDS]).slice(0, 8);

  // Build deck: 2 cards per word (ru + zh)
  memoryCards = [];
  selected.forEach((w, i) => {
    memoryCards.push({
      id: 'mc-' + (i * 2), wordId: w.id, pairId: i,
      type: 'ru', text: w.ru, sub: w.tr || '',
      isFlipped: false, isMatched: false
    });
    memoryCards.push({
      id: 'mc-' + (i * 2 + 1), wordId: w.id, pairId: i,
      type: 'zh', text: w.zh, sub: w.pos || '',
      isFlipped: false, isMatched: false
    });
  });

  // Shuffle and reset state
  memoryCards = shuffleArr(memoryCards);
  memoryFlippedIndices = [];
  memoryMatchedPairs = 0;
  memoryMoves = 0;
  memoryTimerSec = 0;
  memoryLocked = false;

  renderMemoryBoard();
  updateMemoryTimer();

  // Start timer
  memoryTimerInterval = setInterval(() => {
    memoryTimerSec++;
    updateMemoryTimer();
  }, 1000);
}

function renderMemoryBoard() {
  const min = Math.floor(memoryTimerSec / 60);
  const sec = memoryTimerSec % 60;
  const timeStr = String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');

  let html = `<div class="memory-game-container">
    <div class="memory-stats">
      <div class="memory-stat">
        <i class="fa-solid fa-clock"></i> <span class="memory-timer" id="mem-timer">${timeStr}</span>
      </div>
      <div class="memory-stat">
        <i class="fa-solid fa-shoe-prints"></i> <span class="memory-moves" id="mem-moves">${memoryMoves} 步</span>
      </div>
      <div class="memory-stat">
        <i class="fa-solid fa-check-double"></i> <span class="memory-pairs" id="mem-pairs">${memoryMatchedPairs}/8</span>
      </div>
    </div>

    <div class="memory-board">`;

  memoryCards.forEach((card, i) => {
    const flippedClass = card.isFlipped ? ' flipped' : '';
    const matchedClass = card.isMatched ? ' matched' : '';
    const typeClass = card.type;
    html += `<div class="memory-card ${typeClass}${flippedClass}${matchedClass}" id="${card.id}" onclick="flipMemoryCard(${i})">
      <div class="memory-card-inner">
        <div class="memory-card-front">
          <i class="fa-solid fa-question"></i>
        </div>
        <div class="memory-card-back">
          <div class="memory-card-text">${escHtml(card.text)}</div>
          ${card.sub ? '<div class="memory-card-sub">' + escHtml(card.sub) + '</div>' : ''}
          <div class="memory-card-type">${card.type === 'ru' ? 'RU' : 'ZH'}</div>
        </div>
      </div>
    </div>`;
  });

  html += `</div></div>`;

  document.getElementById('main-content').innerHTML = html;
}

function flipMemoryCard(index) {
  if (memoryLocked) return;
  const card = memoryCards[index];
  if (!card || card.isFlipped || card.isMatched) return;
  if (memoryFlippedIndices.length >= 2) return;

  // Flip the card
  card.isFlipped = true;
  memoryFlippedIndices.push(index);

  // Update DOM
  const el = document.getElementById(card.id);
  if (el) el.classList.add('flipped');

  playSound('flip');

  // Check match when 2 cards flipped
  if (memoryFlippedIndices.length === 2) {
    memoryMoves++;
    updateMemoryMoves();
    setTimeout(() => checkMemoryMatch(), 500);
  }
}

function checkMemoryMatch() {
  const [i1, i2] = memoryFlippedIndices;
  const card1 = memoryCards[i1];
  const card2 = memoryCards[i2];

  if (!card1 || !card2) { memoryFlippedIndices = []; return; }

  if (card1.pairId === card2.pairId) {
    // Match!
    card1.isMatched = true;
    card2.isMatched = true;
    memoryMatchedPairs++;
    memoryFlippedIndices = [];

    const el1 = document.getElementById(card1.id);
    const el2 = document.getElementById(card2.id);
    if (el1) { el1.classList.add('matched'); }
    if (el2) { el2.classList.add('matched'); }

    playSound('correct');
    updateMemoryPairs();

    if (memoryMatchedPairs === 8) {
      setTimeout(() => endMemoryGame(), 600);
    }
  } else {
    // Mismatch
    memoryLocked = true;
    const el1 = document.getElementById(card1.id);
    const el2 = document.getElementById(card2.id);
    if (el1) { el1.classList.add('mismatched'); }
    if (el2) { el2.classList.add('mismatched'); }
    playSound('wrong');

    setTimeout(() => {
      card1.isFlipped = false;
      card2.isFlipped = false;
      memoryFlippedIndices = [];
      memoryLocked = false;

      if (el1) { el1.classList.remove('flipped', 'mismatched'); }
      if (el2) { el2.classList.remove('flipped', 'mismatched'); }
    }, 1000);
  }
}

function endMemoryGame() {
  if (memoryTimerInterval) { clearInterval(memoryTimerInterval); memoryTimerInterval = null; }
  memoryLocked = true;

  const min = Math.floor(memoryTimerSec / 60);
  const sec = memoryTimerSec % 60;
  const timeStr = min > 0 ? min + '分' + sec + '秒' : sec + '秒';

  document.getElementById('main-content').innerHTML = `<div class="memory-complete">
    <div class="memory-complete-icon"><i class="fa-solid fa-trophy"></i></div>
    <h2>恭喜完成！</h2>
    <p class="memory-complete-subtitle">全部 8 对都找到了</p>

    <div class="memory-complete-stats">
      <div class="mcs-item">
        <div class="mcs-num">${timeStr}</div>
        <div class="mcs-label">用时</div>
      </div>
      <div class="mcs-item">
        <div class="mcs-num">${memoryMoves}</div>
        <div class="mcs-label">步数</div>
      </div>
      <div class="mcs-item">
        <div class="mcs-num">8/8</div>
        <div class="mcs-label">配对</div>
      </div>
    </div>

    <button class="btn btn-primary btn-lg" onclick="startMemoryGame()" style="width:auto;display:inline-block;">
      <i class="fa-solid fa-arrow-rotate-right"></i> 再玩一局
    </button>
    <button class="btn btn-ghost btn-sm" onclick="setMode('flashcard')" style="margin-top:8px;">返回闪卡</button>
  </div>`;

  // Triple confetti
  playSound('milestone');
  setTimeout(() => launchConfetti(window.innerWidth / 2, 250), 200);
  setTimeout(() => launchConfetti(window.innerWidth / 2 - 160, 200), 500);
  setTimeout(() => launchConfetti(window.innerWidth / 2 + 160, 200), 800);
}

function updateMemoryTimer() {
  const el = document.getElementById('mem-timer');
  if (!el) return;
  const min = Math.floor(memoryTimerSec / 60);
  const sec = memoryTimerSec % 60;
  el.textContent = String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}
function updateMemoryMoves() {
  const el = document.getElementById('mem-moves');
  if (el) el.textContent = memoryMoves + ' 步';
}
function updateMemoryPairs() {
  const el = document.getElementById('mem-pairs');
  if (el) el.textContent = memoryMatchedPairs + '/8';
}

// ========================================================
//  WORD LIST
// ========================================================
function toggleListDictionary() { listShowDictionary = !listShowDictionary; listSearchQuery = ''; renderList(); }

function addFromDictionary(ru, tr, zh, pos) {
  const normalize = s => s.replace(/[́]/g, '').toLowerCase();
  if (WORDS.find(w => normalize(w.ru) === normalize(ru))) {
    showToast('该词已在当前词库中', ''); return;
  }
  const id = (crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  WORDS.push({ id, ru, tr: tr || '', zh, pos: pos || '', example: '', exampleZh: '' });
  saveDeck();
  updateStats();
  refreshListResults();
  showToast('已添加：' + ru, 'success');
  vibrate('correct');
}

function renderList() {
  const currentLang = userLanguages.find(l => l.lang === activeLang);
  const dictWords = (DEFAULT_WORDS && DEFAULT_WORDS[activeLang]) ? DEFAULT_WORDS[activeLang] : [];

  if (listShowDictionary) {
    // ── Dictionary Mode ──
    document.getElementById('main-content').innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">
        <button class="btn btn-ghost btn-sm" onclick="toggleListDictionary()">← 返回词库</button>
        <span style="font-size:13px;color:var(--text-secondary);"><i class="fa-solid fa-book"></i> 内置词典 · ${(currentLang||{}).name||activeLang} · ${dictWords.length}词</span>
      </div>
      <div id="wordpacks-section"><div class="wordpacks-section">
        <div class="wordpacks-title"><i class="fa-solid fa-box-archive"></i> 词汇包 · 一键导入</div>
        <div class="wordpacks-grid"><div class="wordpack-card" style="justify-content:center;color:var(--text-muted);font-size:13px;"><i class="fa-solid fa-spinner fa-spin"></i> 加载中...</div></div>
      </div></div>
      <div class="search-wrapper">
        <i class="fa-solid fa-magnifying-glass search-icon"></i>
        <input type="text" class="search-bar has-icon" id="search-bar" placeholder="搜索词典..." value="${escHtml(listSearchQuery)}" oninput="onSearchInput(this.value)">
      </div>
      <div id="list-results" class="wordlist"></div>`;
    refreshListResults();
    // Async load word packs
    refreshWordPacksSection();
    return;
  }

  // ── Normal Word List Mode ──
  if (WORDS.length === 0) {
    document.getElementById('main-content').innerHTML = `<div class="empty-state">
      <div style="font-size:40px;margin-bottom:12px;"><i class="fa-solid fa-inbox"></i></div>
      <div>还没有单词</div>
      <div style="margin-top:8px;">
        <button class="btn btn-outline btn-sm" onclick="toggleListDictionary()"><i class="fa-solid fa-book"></i> 浏览内置词典</button>
      </div>
    </div>`;
    return;
  }
  document.getElementById('main-content').innerHTML = `<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">
    <div class="search-wrapper" style="flex:1;">
      <i class="fa-solid fa-magnifying-glass search-icon"></i>
      <input type="text" class="search-bar has-icon" id="search-bar" placeholder="搜索单词或中文..." value="${escHtml(listSearchQuery)}" oninput="onSearchInput(this.value)">
    </div>
    <button class="btn btn-ghost btn-sm" onclick="toggleListDictionary()" title="浏览内置词典"><i class="fa-solid fa-book"></i></button>
  </div><div id="list-results" class="wordlist"></div>`;
  refreshListResults();
}

function refreshListResults() {
  const resultsEl = document.getElementById('list-results');
  if (!resultsEl) return;

  if (listShowDictionary) {
    const dictWords = (DEFAULT_WORDS && DEFAULT_WORDS[activeLang]) ? DEFAULT_WORDS[activeLang] : [];
    const normalize = s => (s || '').replace(/[́]/g, '').toLowerCase();
    const existingSet = new Set(WORDS.map(w => normalize(w.ru)));
    const q = listSearchQuery.toLowerCase();
    const filtered = dictWords.filter(w => {
      if (!q) return true;
      return normalize(w[0]).includes(q) || w[2].toLowerCase().includes(q) || (w[1]||'').toLowerCase().includes(q);
    });
    resultsEl.innerHTML = filtered.map(w => {
      const isAdded = existingSet.has(normalize(w[0]));
      return `<div class="word-item" style="${isAdded ? 'opacity:.6;' : ''}">
        <div class="word-left">
          <div><span class="word-ru">${w[0]}</span></div>
          <div class="word-tr">${w[1]||''}</div>
          <div class="word-srs">${isAdded ? '<span class="stat-pill mastered">已添加</span>' : '<span class="stat-pill new">内置词典</span>'}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="word-zh">${w[2]}</span>
          <span style="font-size:12px;color:var(--text-muted);">${w[3]||''}</span>
          <div class="word-actions">
            <button class="btn-action speak-btn" onclick="speakWord('${w[0].replace(/'/g,"\\'")}')"><i class="fa-solid fa-volume-high"></i></button>
            ${isAdded
              ? '<span style="font-size:11px;color:var(--success);">✓</span>'
              : `<button class="btn btn-outline btn-sm" style="padding:3px 8px;font-size:11px;" onclick="addFromDictionary('${w[0].replace(/'/g,"\\'")}','${(w[1]||'').replace(/'/g,"\\'")}','${w[2].replace(/'/g,"\\'")}','${(w[3]||'').replace(/'/g,"\\'")}')">+ 添加</button>`
            }
          </div>
        </div>
      </div>`;
    }).join('') || '<div class="empty-state">没有匹配的单词</div>';
  } else {
    const q = listSearchQuery.toLowerCase();
    const filtered = WORDS.filter(w => !q || normalizeCompare(w.ru).includes(q) || w.zh.toLowerCase().includes(q) || (w.tr||'').toLowerCase().includes(q));
    resultsEl.innerHTML = filtered.map(w => `<div class="word-item">
      <div class="word-left"><div><span class="word-ru">${w.ru}</span></div><div class="word-tr">${w.tr||''}</div><div class="word-srs"><span class="card-srs-badge ${getSRSBadgeClass(w.id)}">${getSRSLabel(w.id)}</span></div>${w.example ? '<div class="word-example-truncated"><i class="fa-solid fa-quote-left"></i> ' + escHtml(w.example.substring(0, 40)) + (w.example.length > 40 ? '...' : '') + '</div>' : ''}</div>
      <div style="display:flex;align-items:center;gap:10px;"><span class="word-zh">${w.zh}</span><span style="font-size:12px;color:var(--text-muted);">${w.pos||''}</span>
      <div class="word-actions">
        <button class="btn-action star-btn" onclick="toggleStar('${w.id}');renderList();" style="color:${isStarred(w.id)?'#F59E0B':''};">${isStarred(w.id)?'<i class="fa-solid fa-star"></i>':'<i class="fa-regular fa-star"></i>'}</button>
        <button class="btn-action speak-btn" onclick="speakWord('${w.ru.replace(/'/g,"\\'")}')"><i class="fa-solid fa-volume-high"></i></button>
        <button class="btn-action edit-btn" onclick="openEditModal('${w.id}')"><i class="fa-solid fa-pencil"></i></button>
        <button class="btn-action delete-btn" onclick="deleteWord('${w.id}')"><i class="fa-solid fa-trash-can"></i></button>
      </div></div></div>`).join('') || '<div class="empty-state">没有匹配的单词</div>';
  }
}

function onSearchInput(v) {
  listSearchQuery = v;
  refreshListResults();
}

// ── Edit / Delete ─────────────────────────────────────
function openEditModal(wordId) {
  const w = WORDS.find(x => x.id === wordId); if (!w) return;
  editingWordId = wordId;
  document.getElementById('edit-ru').value = w.ru;
  document.getElementById('edit-tr').value = w.tr || '';
  document.getElementById('edit-zh').value = w.zh;
  document.getElementById('edit-pos').value = w.pos || '';
  document.getElementById('edit-example').value = w.example || '';
  document.getElementById('edit-exampleZh').value = w.exampleZh || '';
  document.getElementById('edit-modal').classList.add('show');
}
function closeEditModal() { editingWordId = null; document.getElementById('edit-modal').classList.remove('show'); }
function saveEdit() {
  if (!editingWordId) return;
  const w = WORDS.find(x => x.id === editingWordId); if (!w) return;
  w.ru = document.getElementById('edit-ru').value.trim() || w.ru;
  w.tr = document.getElementById('edit-tr').value.trim();
  w.zh = document.getElementById('edit-zh').value.trim() || w.zh;
  w.pos = document.getElementById('edit-pos').value.trim();
  w.example = document.getElementById('edit-example').value.trim();
  w.exampleZh = document.getElementById('edit-exampleZh').value.trim();
  updateWordLocal(editingWordId, w.ru, w.tr, w.zh, w.pos, w.example, w.exampleZh);
  closeEditModal();
  renderMain();
}
function deleteWord(wordId) {
  const w = WORDS.find(x => x.id === wordId); if (!w) return;
  if (!confirm(`确定要删除「${w.ru}」吗？`)) return;
  deleteWordLocal(wordId);
  WORDS = WORDS.filter(x => x.id !== wordId);
  delete srsData[wordId];
  saveDeck();
  saveSRSLocal();
  updateStats(); renderMain();
}

// ── Main render ───────────────────────────────────────
function renderMain() {
  updateStats();
  if (currentMode === 'flashcard') {
    if (sessionActive) renderSessionCard();
    else if (sessionMode) renderSessionStart();
    else renderFlashcard();
  }
  else if (currentMode === 'quiz') startQuiz();
  else if (currentMode === 'stats') renderStatsDashboard();
  else if (currentMode === 'listen') { stopListening(); renderListen(); }
  else if (currentMode === 'game') startMemoryGame();
  else renderList();
}

// ========================================================
//  UNIVERSAL PARSER
// ========================================================
// Clean unwanted characters from field edges (not middle)
function cleanField(s) {
  if (!s) return '';
  // Characters to strip from both ends: various separators, bullets, etc.
  const stripChars = '-｜|:：=—–·•*#→⇒\\/@&%$+~`"\'\\s\\\\';
  return s.replace(new RegExp('^[' + stripChars.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ']+'), '')
          .replace(new RegExp('[' + stripChars.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ']+$'), '')
          .trim();
}

function parseLine(line) {
  line = line.trim(); if (!line) return null;
  let ru = '', tr = '', zh = '', pos = '';

  // Helper: extract trailing parenthesized part-of-speech from a string
  const extractPos = (s) => {
    // Try Chinese parens （noun） or English parens (noun)
    const m = s.match(/^(.+?)[（(]([^)）]+)[)）]\s*$/);
    if (m) return { text: m[1].trim(), pos: m[2].trim() };
    return { text: s.trim(), pos: '' };
  };

  // ── 1. Tab-separated ──
  if (line.includes('\t')) {
    const parts = line.split('\t').map(s => cleanField(s)).filter(Boolean);
    if (parts.length >= 2) {
      ru = parts[0]; let idx = 1;
      if (parts[idx] && /^\[.*\]$/.test(parts[idx])) { tr = parts[idx]; idx++; }
      if (parts[idx]) zh = cleanField(parts[idx]);
      if (parts[idx + 1]) pos = cleanField(parts[idx + 1]);
      if (ru && zh) return { ru, tr, zh, pos };
    }
  }

  // ── 2. Full-width pipe ｜ ──
  if (line.includes('｜')) {
    const parts = line.split('｜').map(s => cleanField(s)).filter(Boolean);
    if (parts.length >= 2) {
      ru = parts[0]; let idx = 1;
      if (parts[idx] && /^\[.*\]$/.test(parts[idx])) { tr = parts[idx]; idx++; }
      if (parts[idx]) zh = cleanField(parts[idx]);
      if (parts[idx + 1]) pos = cleanField(parts[idx + 1]);
      if (ru && zh) return { ru, tr, zh, pos };
    }
  }

  // ── 3. Pipe | ──
  if (line.includes('|') && !line.includes('｜')) {
    const parts = line.split('|').map(s => cleanField(s)).filter(Boolean);
    if (parts.length >= 2) {
      ru = parts[0]; let idx = 1;
      if (parts[idx] && /^\[.*\]$/.test(parts[idx])) { tr = parts[idx]; idx++; }
      if (parts[idx]) zh = cleanField(parts[idx]);
      if (parts[idx + 1]) pos = cleanField(parts[idx + 1]);
      if (ru && zh) return { ru, tr, zh, pos };
    }
  }

  // ── 4. Equals = ──
  if (line.includes('=') && !line.match(/[｜|\t]/)) {
    const idx = line.indexOf('=');
    ru = cleanField(line.slice(0, idx));
    const right = cleanField(line.slice(idx + 1));
    if (ru && right) {
      const ep = extractPos(right);
      if (ru && ep.text) return { ru, tr, zh: ep.text, pos: ep.pos };
    }
  }

  // ── 5. Full-width colon ： (only if no other delimiter found) ──
  if (line.includes('：') && !line.match(/[｜|\t=]/)) {
    const idx = line.indexOf('：');
    ru = cleanField(line.slice(0, idx));
    const right = cleanField(line.slice(idx + 1));
    if (ru && right) {
      const ep = extractPos(right);
      if (ru && ep.text) return { ru, tr, zh: ep.text, pos: ep.pos };
    }
  }

  // ── 6. English colon : (careful — could be in time like 10:30) ──
  if (line.includes(':') && !line.match(/[｜|\t=：]/) && !line.match(/\d:\d/)) {
    const idx = line.indexOf(':');
    ru = cleanField(line.slice(0, idx));
    const right = cleanField(line.slice(idx + 1));
    if (ru && right) {
      const ep = extractPos(right);
      if (ru && ep.text) return { ru, tr, zh: ep.text, pos: ep.pos };
    }
  }

  // ── 7. Dash-separated (– — -) ──
  const dashMatch = line.match(/^(.+?)\s*[–—-]\s*(.+)$/);
  if (dashMatch) {
    ru = cleanField(dashMatch[1]);
    const ep = extractPos(cleanField(dashMatch[2]));
    if (ru && ep.text) return { ru, tr, zh: ep.text, pos: ep.pos };
  }

  // ── 8. Extract transcription bracket before main parse ──
  let lineNoTr = line;
  const trMatch = line.match(/\[([^\]]+)\]/);
  if (trMatch) {
    tr = '[' + trMatch[1] + ']';
    lineNoTr = line.replace(trMatch[0], '').replace(/\s{2,}/g, ' ').trim();
  }

  // ── 9. Foreign chars + space(s) + CJK chars (most common loose format) ──
  // Match: non-CJK sequence followed by CJK sequence (separated by whitespace)
  const foreignSeq = lineNoTr.match(/^([^一-鿿㐀-䶿]+?)\s+([一-鿿㐀-䶿].*)$/);
  if (foreignSeq) {
    ru = cleanField(foreignSeq[1]);
    const ep = extractPos(cleanField(foreignSeq[2]));
    if (ru && ep.text) return { ru, tr, zh: ep.text, pos: ep.pos };
  }

  // If we have tr from step 8 but no zh yet, try to extract what remains
  if (tr && lineNoTr !== line) {
    const parts = lineNoTr.trim().split(/\s{2,}/);
    // Just return what we have with raw parts
  }

  return null;
}

function parseText(text) {
  return text.split(/\n/).map(parseLine).filter(Boolean);
}

// ========================================================
//  IMPORT / EXPORT
// ========================================================
function showPreview(parsed) {
  pendingImport = parsed;
  const section = document.getElementById('preview-section');
  const tbody = document.getElementById('preview-tbody');
  const countEl = document.getElementById('preview-count-text');
  const confirmBtn = document.getElementById('confirm-import-btn');
  if (parsed.length === 0) { section.style.display = 'none'; confirmBtn.disabled = true; return; }

  const normalize = s => s.replace(/[́]/g, '').toLowerCase();
  const existingSet = new Set(WORDS.map(w => normalize(w.ru)));
  let newCount = 0, dupCount = 0;
  tbody.innerHTML = parsed.map(p => {
    const isDup = existingSet.has(normalize(p.ru));
    if (isDup) dupCount++; else newCount++;
    return `<tr><td class="col-ru">${p.ru} ${isDup?'<span class="tag tag-dup">重复</span>':'<span class="tag tag-new">新增</span>'}</td><td class="col-tr">${p.tr||''}</td><td class="col-zh">${p.zh}</td><td class="col-pos">${p.pos||''}</td></tr>`;
  }).join('');
  countEl.innerHTML = `识别到 <strong>${parsed.length}</strong> 个单词（<span style="color:#1565c0;">${newCount} 新增</span>，<span style="color:#e65100;">${dupCount} 重复</span>）`;
  section.style.display = 'block'; confirmBtn.disabled = (newCount === 0);
}

function clearImport() {
  pendingImport = [];
  document.getElementById('preview-section').style.display = 'none';
  document.getElementById('confirm-import-btn').disabled = true;
  document.getElementById('paste-area').value = '';
  document.getElementById('file-input').value = '';
}

function confirmImport() {
  if (pendingImport.length === 0) return;
  const sel = document.getElementById('import-folder-select');
  const targetFolderId = sel ? sel.value : activeFolderId;
  const normalize = s => s.replace(/[́]/g, '').toLowerCase();
  let targetWords;
  if (targetFolderId === activeFolderId) {
    targetWords = WORDS;
  } else {
    targetWords = loadDeckFromStorage(activeLang, targetFolderId) || [];
  }
  const existingSet = new Set(targetWords.map(w => normalize(w.ru)));
  let added = 0;
  for (const p of pendingImport) {
    if (existingSet.has(normalize(p.ru))) continue;
    const id = (crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    targetWords.push({ id, ru: p.ru, tr: p.tr || '', zh: p.zh, pos: p.pos || '', example: '', exampleZh: '' });
    existingSet.add(normalize(p.ru)); added++;
  }
  if (targetFolderId !== activeFolderId) {
    saveDeckToStorage(activeLang, targetWords, targetFolderId);
  } else {
    saveDeck();
  }
  updateStats(); clearImport(); closeImportModal(); renderMain();
  alert('已导入 ' + added + ' 个新单词！');
}

function openImportModal() {
  const currentLang = userLanguages.find(l => l.lang === activeLang);
  const currentFolder = folders.find(f => f.id === activeFolderId);
  document.getElementById('import-deck-name').textContent = (currentLang ? currentLang.name : activeLang) + (currentFolder ? ' / ' + currentFolder.name : '');
  const sel = document.getElementById('import-folder-select');
  if (sel) {
    sel.innerHTML = folders.map(f => '<option value="' + f.id + '"' + (f.id === activeFolderId ? ' selected' : '') + '>' + escHtml(f.name) + '</option>').join('');
  }
  document.getElementById('import-modal').classList.add('show');
  clearImport();
}
function closeImportModal() { document.getElementById('import-modal').classList.remove('show'); }

function handleFile(event) {
  const file = event.target.files[0]; if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'docx') {
    const reader = new FileReader();
    reader.onload = function(e) {
      if (typeof mammoth !== 'undefined') {
        mammoth.extractRawText({ arrayBuffer: e.target.result })
          .then(r => { document.getElementById('paste-area').value = r.value; showPreview(parseText(r.value)); })
          .catch(err => alert('解析失败：' + err.message));
      } else alert('mammoth.js 加载失败，请刷新重试。');
    };
    reader.readAsArrayBuffer(file);
  } else if (ext === 'txt') {
    const reader = new FileReader();
    reader.onload = function(e) { document.getElementById('paste-area').value = e.target.result; showPreview(parseText(e.target.result)); };
    reader.readAsText(file);
  }
}

function parsePastedText() {
  const text = document.getElementById('paste-area').value;
  if (!text.trim()) return;
  const parsed = parseText(text);
  if (parsed.length === 0) { alert('未能识别到有效的单词格式。'); return; }
  showPreview(parsed);
}

// ── Full Data Backup / Restore ──────────────────────
function exportFullBackup() {
  const backup = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    backup[key] = localStorage.getItem(key);
  }
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    totalKeys: Object.keys(backup).length,
    data: backup
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'flashcards_backup_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('<i class="fa-solid fa-check-circle"></i> 备份已下载', 'success');
}

function importFullBackup(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const payload = JSON.parse(e.target.result);
      if (!payload.data || typeof payload.data !== 'object') {
        throw new Error('无效的备份文件格式');
      }

      const keyCount = Object.keys(payload.data).length;
      if (!confirm('即将从备份恢复 ' + keyCount + ' 条数据。\n\n⚠️ 当前数据将被覆盖，确定继续？')) {
        event.target.value = '';
        return;
      }

      // Write all backup data to localStorage
      for (const [key, value] of Object.entries(payload.data)) {
        try { localStorage.setItem(key, value); } catch(e) {}
      }

      showToast('<i class="fa-solid fa-check-circle"></i> 数据已恢复，即将刷新...', 'success');
      setTimeout(() => location.reload(), 1500);
    } catch(err) {
      alert('备份文件无效或已损坏：' + err.message);
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

function exportWords() {
  if (WORDS.length === 0) { alert('没有单词可导出'); return; }
  const header = '单词\t音标\t中文\t词性\t例句\t例句翻译';
  const lines = WORDS.map(w => [w.ru, w.tr||'', w.zh, w.pos||'', w.example||'', w.exampleZh||''].join('\t'));
  const currentLang = userLanguages.find(l => l.lang === activeLang);
  const currentFolder = folders.find(f => f.id === activeFolderId);
  const langName = currentLang ? currentLang.name : activeLang;
  const folderName = currentFolder ? currentFolder.name : '';
  const blob = new Blob(['﻿' + [header, ...lines].join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = langName + (folderName ? '_' + folderName : '') + '_单词_' + new Date().toISOString().slice(0, 10) + '.txt'; a.click();
  URL.revokeObjectURL(url);
}

// ========================================================
//  ADD LANGUAGE MODAL
// ========================================================
function openAddLangModal() {
  const existingCodes = userLanguages.map(l => l.lang);
  document.getElementById('lang-presets').innerHTML = LANGUAGE_PRESETS.filter(p => !existingCodes.includes(p.code)).map(p =>
    `<div class="lang-preset" onclick="addPresetLanguage('${p.code}')"><span class="preset-flag">${p.flag}</span><span class="preset-name">${p.name}</span></div>`
  ).join('') || '<div style="font-size:13px;color:#999;grid-column:1/-1;">所有预设语言已添加</div>';
  document.getElementById('add-lang-modal').classList.add('show');
}
function closeAddLangModal() { document.getElementById('add-lang-modal').classList.remove('show'); }

function addPresetLanguage(code) {
  const preset = LANGUAGE_PRESETS.find(p => p.code === code); if (!preset) return;
  closeAddLangModal();
  addLangLocal(code, preset.name, preset.flag, preset.speechLang);
  switchLanguage(code);
}

function addCustomLanguage() {
  const name = document.getElementById('custom-lang-name').value.trim();
  const code = document.getElementById('custom-lang-code').value.trim() || name.toLowerCase().replace(/\s+/g,'-');
  const flag = document.getElementById('custom-lang-flag').value.trim() || '<i class="fa-solid fa-globe"></i>';
  if (!name) { alert('请输入语言名称'); return; }
  if (userLanguages.find(l => l.lang === code)) { alert('该语言代码已存在'); return; }
  closeAddLangModal();
  addLangLocal(code, name, flag, code || 'en-US');
  switchLanguage(code);
}

// ========================================================
//  DELETE DECK
// ========================================================
function deleteCurrentDeck() {
  if (userLanguages.length <= 1) { alert('至少需要保留一个语言'); return; }
  const meta = userLanguages.find(l => l.lang === activeLang);
  if (!meta) return;
  if (!confirm(`确定删除「${meta.name}」及其所有单词和进度吗？此操作不可恢复。`)) return;
  deleteLangLocal(activeLang);
  userLanguages = userLanguages.filter(l => l.lang !== activeLang);
  saveLangsToStorage(userLanguages);
  activeLang = userLanguages[0].lang;
  loadDeck(activeLang);
  flashcardIndex = 0; flashcardFilter = 'all'; flashcardPool = [];
  quizWords = []; quizIndex = 0; listSearchQuery = '';
  renderAll();
}

// ========================================================
//  DRAG & DROP
// ========================================================
(function() {
  const dz = document.getElementById('drop-zone'); if (!dz) return;
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', e => { e.preventDefault(); dz.classList.remove('dragover'); });
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      document.getElementById('file-input').files = e.dataTransfer.files;
      handleFile({ target: { files: e.dataTransfer.files } });
    }
  });
})();

// ========================================================
//  THEME
// ========================================================
function applyTheme() {
  const saved = localStorage.getItem('flashcards_theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = saved ? saved === 'dark' : prefersDark;
  document.documentElement.classList.toggle('dark', isDark);
  document.getElementById('btn-theme').innerHTML = isDark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
}
function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('flashcards_theme', isDark ? 'dark' : 'light');
  document.getElementById('btn-theme').innerHTML = isDark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
  if (currentMode === 'stats') renderStatsDashboard();
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!localStorage.getItem('flashcards_theme')) applyTheme();
});

// ========================================================
//  SETTINGS
// ========================================================
function openSettings() {
  document.getElementById('setting-daily-goal').value = dailyGoal;
  document.getElementById('setting-new-words').value = newWordsPerDay;
  document.getElementById('setting-sound').checked = soundEnabled;
  document.getElementById('setting-haptic').checked = hapticEnabled;
  document.getElementById('setting-auto-speak').checked = flashcardAutoSpeak;
  document.getElementById('setting-manual-advance').checked = manualAdvance;
  document.getElementById('setting-speech-rate').value = listenSpeechRate;
  document.getElementById('speech-rate-val').textContent = listenSpeechRate + 'x';
  document.getElementById('setting-repeat-count').value = listenRepeatCount;
  document.getElementById('settings-panel').classList.add('show');
}
function closeSettings() { document.getElementById('settings-panel').classList.remove('show'); }
document.getElementById('settings-panel').addEventListener('click', function(e) {
  if (e.target === this) closeSettings();
});
function updateDailyGoal(val) {
  dailyGoal = Math.max(5, Math.min(200, parseInt(val) || 20));
  saveStreak();
  updateStreakUI();
}
function toggleSound(on) { soundEnabled = on; localStorage.setItem('flashcards_sound', on ? '1' : '0'); }
function toggleHaptic(on) { hapticEnabled = on; localStorage.setItem('flashcards_haptic', on ? '1' : '0'); }
function toggleAutoSpeak(on) { flashcardAutoSpeak = on; localStorage.setItem('flashcards_auto_speak', on ? '1' : '0'); }
function toggleManualAdvance(on) { manualAdvance = on; localStorage.setItem('flashcards_manual_advance', on ? '1' : '0'); }
function updateSpeechRate(val) {
  listenSpeechRate = parseFloat(val) || 0.85;
  localStorage.setItem('flashcards_speech_rate', listenSpeechRate);
  document.getElementById('speech-rate-val').textContent = listenSpeechRate + 'x';
}
function updateRepeatCount(val) {
  listenRepeatCount = Math.max(1, Math.min(5, parseInt(val) || 1));
  localStorage.setItem('flashcards_repeat_count', listenRepeatCount);
}

// ========================================================
//  TOAST
// ========================================================
function showToast(msg, type) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast' + (type ? ' ' + type : '');
  toast.innerHTML = msg;
  container.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 2500);
}

// ========================================================
//  SOUND EFFECTS (Web Audio API)
// ========================================================
function initAudio() {
  if (audioCtx) return;
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
}
function playSound(type) {
  if (!soundEnabled) return;
  initAudio();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination);
  gain.gain.setValueAtTime(.12, t);
  gain.gain.exponentialRampToValueAtTime(.001, t + .4);
  if (type === 'correct') { osc.type = 'sine'; osc.frequency.setValueAtTime(523, t); osc.frequency.setValueAtTime(659, t + .08); osc.start(t); osc.stop(t + .3); }
  else if (type === 'wrong') { osc.type = 'sine'; osc.frequency.setValueAtTime(330, t); osc.frequency.setValueAtTime(262, t + .1); osc.start(t); osc.stop(t + .35); }
  else if (type === 'flip') { osc.type = 'triangle'; osc.frequency.setValueAtTime(800, t); osc.frequency.exponentialRampToValueAtTime(400, t + .06); gain.gain.setValueAtTime(.04, t); gain.gain.exponentialRampToValueAtTime(.001, t + .08); osc.start(t); osc.stop(t + .1); }
  else if (type === 'milestone') { osc.type = 'sine'; osc.frequency.setValueAtTime(523, t); osc.frequency.setValueAtTime(659, t + .1); osc.frequency.setValueAtTime(784, t + .2); gain.gain.setValueAtTime(.15, t); gain.gain.setValueAtTime(.15, t + .25); gain.gain.exponentialRampToValueAtTime(.001, t + .5); osc.start(t); osc.stop(t + .55); }
}

// ========================================================
//  HAPTIC FEEDBACK
// ========================================================
function vibrate(type) {
  if (!hapticEnabled || !navigator.vibrate) return;
  if (type === 'correct') navigator.vibrate(30);
  else if (type === 'wrong') navigator.vibrate([30, 50, 30]);
  else if (type === 'milestone') navigator.vibrate([30, 50, 30, 50, 30]);
}

// ========================================================
//  STAR / BOOKMARK WORDS
// ========================================================
function loadStarred() {
  try { const raw = localStorage.getItem(getStorageKey('starred')); starredWords = raw ? JSON.parse(raw) : {}; }
  catch(e) { starredWords = {}; }
}
function saveStarred() { localStorage.setItem(getStorageKey('starred'), JSON.stringify(starredWords)); }
function isStarred(wordId) { return !!starredWords[wordId]; }
function toggleStar(wordId) {
  if (isStarred(wordId)) delete starredWords[wordId];
  else starredWords[wordId] = true;
  saveStarred();
  if (currentMode === 'flashcard') {
    const btn = document.getElementById('card-star-btn');
    if (btn) { btn.classList.toggle('starred', isStarred(wordId)); btn.classList.add('star-pop'); setTimeout(() => btn.classList.remove('star-pop'), 350); }
  }
}
function starredCount() { return WORDS.filter(w => isStarred(w.id)).length; }
function exportStarredWords() {
  const starred = WORDS.filter(w => isStarred(w.id));
  if (starred.length === 0) { alert('还没有收藏的单词'); return; }
  const header = '单词\t音标\t中文\t词性\t例句\t例句翻译';
  const lines = starred.map(w => [w.ru, w.tr||'', w.zh, w.pos||'', w.example||'', w.exampleZh||''].join('\t'));
  const currentLang = userLanguages.find(l => l.lang === activeLang);
  const currentFolder = folders.find(f => f.id === activeFolderId);
  const langName = currentLang ? currentLang.name : activeLang;
  const folderName = currentFolder ? currentFolder.name : '';
  const blob = new Blob(['﻿' + [header, ...lines].join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = langName + (folderName ? '_' + folderName : '') + '_收藏单词_' + new Date().toISOString().slice(0, 10) + '.txt'; a.click();
  URL.revokeObjectURL(url);
  closeSettings();
}

// ========================================================
//  DAILY GOAL & STREAK
// ========================================================
function loadStreak() {
  try {
    const raw = localStorage.getItem(getStorageKey('streak'));
    return raw ? JSON.parse(raw) : { currentStreak: 0, longestStreak: 0, lastStudyDate: null, dailyGoal: 20, todayCount: 0, history: {} };
  } catch(e) { return { currentStreak: 0, longestStreak: 0, lastStudyDate: null, dailyGoal: 20, todayCount: 0, history: {} }; }
}
function saveStreak() {
  const data = loadStreak();
  data.dailyGoal = dailyGoal;
  localStorage.setItem(getStorageKey('streak'), JSON.stringify(data));
}
function recordReview() {
  const data = loadStreak();
  const today = todayStr();
  data.dailyGoal = dailyGoal;
  if (data.lastStudyDate !== today) {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    if (data.lastStudyDate === yesterdayStr) { data.currentStreak++; }
    else if (data.lastStudyDate !== today) { data.currentStreak = 1; }
    if (data.currentStreak > data.longestStreak) data.longestStreak = data.currentStreak;
    data.lastStudyDate = today;
    data.todayCount = 1;
  } else { data.todayCount++; }
  data.history[today] = data.todayCount;
  localStorage.setItem(getStorageKey('streak'), JSON.stringify(data));
  dailyGoal = data.dailyGoal;
  updateStreakUI();
  if (data.todayCount === data.dailyGoal) {
    showToast('<i class="fa-solid fa-bullseye"></i> 今日目标达成！', 'success');
    playSound('milestone'); vibrate('milestone');
  }
  if (data.currentStreak > 0 && data.todayCount === 1 && data.currentStreak % 7 === 0) {
    showToast('<i class="fa-solid fa-fire"></i> 连续 ' + data.currentStreak + ' 天打卡！', 'milestone');
  }
}
function updateStreakUI() {
  const data = loadStreak();
  dailyGoal = data.dailyGoal;
  const badge = document.getElementById('streak-badge');
  const count = document.getElementById('streak-count');
  if (data.currentStreak > 0) {
    badge.style.display = ''; count.textContent = data.currentStreak;
  } else { badge.style.display = 'none'; }
}

// ========================================================
//  SWIPE GESTURES (two-stage aware)
// ========================================================
let swipeStartX = 0, swipeStartY = 0, swipeCurrentX = 0, swipeActive = false;
function initSwipe() {
  const card = document.getElementById('card-stage');
  if (!card) return;
  card.addEventListener('touchstart', handleSwipeStart, { passive: false });
  card.addEventListener('touchmove', handleSwipeMove, { passive: false });
  card.addEventListener('touchend', handleSwipeEnd);
  card.addEventListener('mousedown', handleSwipeStart);
}
function handleSwipeStart(e) {
  if (e.type === 'mousedown' && e.button !== 0) return;
  const card = document.getElementById('card-stage');
  if (!card) { swipeActive = false; return; }
  swipeActive = true;
  const pt = e.touches ? e.touches[0] : e;
  swipeStartX = pt.clientX; swipeStartY = pt.clientY; swipeCurrentX = swipeStartX;
  card.style.transition = 'none';
  document.addEventListener('mousemove', handleSwipeMove);
  document.addEventListener('mouseup', handleSwipeEnd);
}
function handleSwipeMove(e) {
  if (!swipeActive) return;
  const card = document.getElementById('card-stage'); if (!card) return;
  const pt = e.touches ? e.touches[0] : e;
  swipeCurrentX = pt.clientX;
  const dx = swipeCurrentX - swipeStartX;
  const dy = (pt.clientY - swipeStartY);
  if (Math.abs(dy) > Math.abs(dx) * 1.2) { swipeActive = false; resetCardSwipe(); return; }
  if (e.cancelable) e.preventDefault();
  const rotation = dx * .04;
  const alpha = Math.min(Math.abs(dx) / 80, 1);
  card.style.transform = `translateX(${dx}px) rotate(${rotation}deg)`;
  if (dx > 20) card.style.boxShadow = `0 0 24px rgba(44,94,59,${alpha * .35})`;
  else if (dx < -20) card.style.boxShadow = `0 0 24px rgba(196,69,54,${alpha * .35})`;
  else card.style.boxShadow = '';
}
function handleSwipeEnd(e) {
  if (!swipeActive) return;
  swipeActive = false;
  document.removeEventListener('mousemove', handleSwipeMove);
  document.removeEventListener('mouseup', handleSwipeEnd);
  const dx = swipeCurrentX - swipeStartX;
  const card = document.getElementById('card-stage'); if (!card) return;
  if (Math.abs(dx) < 10) {
    resetCardSwipe();
    if (e.type === 'mouseup' && Math.abs(swipeCurrentX - swipeStartX) < 5 && Math.abs((e.clientY || swipeStartY) - swipeStartY) < 5) {
      // Small tap → speak word
      const idx = flashcardPool[flashcardIndex];
      if (idx !== undefined) speakWord(WORDS[idx].ru);
    }
    return;
  }
  if (dx > 80) {
    card.style.transition = 'transform .25s ease, opacity .25s ease';
    card.style.transform = 'translateX(300px) rotate(12deg)'; card.style.opacity = '0';
    setTimeout(() => { resetCardSwipe(); if (cardStage === 1) handleStage1('know'); else handleStage1('know'); }, 250);
  } else if (dx < -80) {
    card.style.transition = 'transform .25s ease, opacity .25s ease';
    card.style.transform = 'translateX(-300px) rotate(-12deg)'; card.style.opacity = '0';
    setTimeout(() => { resetCardSwipe(); if (cardStage === 1) handleStage1('dontknow'); else handleStage1('dontknow'); }, 250);
  } else { resetCardSwipe(); }
}
function resetCardSwipe() {
  const card = document.getElementById('card-stage');
  if (!card) return;
  card.style.transition = 'transform .35s cubic-bezier(.4,0,.2,1), opacity .35s ease, box-shadow .35s ease';
  card.style.transform = ''; card.style.opacity = ''; card.style.boxShadow = '';
}

// ========================================================
//  STATS DASHBOARD
// ========================================================
function renderStatsDashboard() {
  const data = loadStreak();
  dailyGoal = data.dailyGoal;
  const totalReviews = Object.values(data.history).reduce((a, b) => a + b, 0);
  const masteredCount = countByCategory('mastered');
  const masteryRate = WORDS.length > 0 ? Math.round((masteredCount / WORDS.length) * 100) : 0;

  document.getElementById('main-content').innerHTML = `
    <div class="stats-grid fade-in">
      <div class="stat-card">
        <div class="stat-value">${data.todayCount || 0}<span style="font-size:14px;color:var(--text-muted);">/${dailyGoal}</span></div>
        <div class="stat-label">今日进度</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${data.currentStreak || 0}</div>
        <div class="stat-label"><i class="fa-solid fa-fire"></i> 连续打卡</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${WORDS.length}</div>
        <div class="stat-label"><i class="fa-solid fa-book-open"></i> 总词数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${totalReviews}</div>
        <div class="stat-label"><i class="fa-solid fa-pen-to-square"></i> 总复习次数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${masteryRate}%</div>
        <div class="stat-label"><i class="fa-solid fa-circle-check"></i> 掌握率</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${data.longestStreak || 0}</div>
        <div class="stat-label"><i class="fa-solid fa-trophy"></i> 最长连续</div>
      </div>
    </div>
    <div class="chart-wrap fade-in"><h4><i class="fa-solid fa-chart-bar"></i> 每日复习 (最近30天)</h4><canvas id="bar-chart"></canvas></div>
    <div class="chart-wrap fade-in"><h4><i class="fa-solid fa-chart-pie"></i> 词汇分布</h4><canvas id="donut-chart"></canvas></div>
    <div class="chart-wrap fade-in"><h4><i class="fa-solid fa-chart-line"></i> 遗忘曲线预测 (未来7天)</h4><canvas id="forgetting-chart"></canvas></div>`;

  setTimeout(() => { drawBarChart(); drawDonutChart(); drawForgettingCurve(); animateCounters(); }, 100);
}

function drawBarChart() {
  const canvas = document.getElementById('bar-chart');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr; canvas.height = 220 * dpr;
  canvas.style.width = rect.width + 'px'; canvas.style.height = '220px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const w = rect.width, h = 220;
  const data = loadStreak();
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, label: (i % 5 === 0 || i === 29) ? (d.getMonth() + 1 + '/' + d.getDate()) : '', count: data.history[key] || 0 });
  }
  const maxCount = Math.max(dailyGoal, ...days.map(d => d.count));
  const pad = { top: 10, right: 16, bottom: 28, left: 10 };
  const chartW = w - pad.left - pad.right, chartH = h - pad.top - pad.bottom;
  const barW = Math.max(4, (chartW / days.length) * .7);
  const gap = chartW / days.length;
  const isDark = document.documentElement.classList.contains('dark');

  // Grid
  ctx.strokeStyle = isDark ? '#334155' : '#E2E8F0';
  ctx.lineWidth = .5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    ctx.fillStyle = isDark ? '#94A3B8' : '#64748B';
    ctx.font = '10px system-ui'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxCount - (maxCount / 4) * i), pad.left - 2, y + 3);
  }

  // Bars
  days.forEach((d, i) => {
    const barH = d.count > 0 ? Math.max(2, (d.count / maxCount) * chartH) : 0;
    const x = pad.left + gap * i + (gap - barW) / 2;
    const y = pad.top + chartH - barH;
    const grad = ctx.createLinearGradient(x, y, x, pad.top + chartH);
    if (d.count >= dailyGoal) { grad.addColorStop(0, '#10B981'); grad.addColorStop(1, '#34D399'); }
    else if (d.count > 0) { grad.addColorStop(0, '#4F46E5'); grad.addColorStop(1, '#818CF8'); }
    else { grad.addColorStop(0, isDark ? '#334155' : '#E2E8F0'); grad.addColorStop(1, isDark ? '#1E293B' : '#F1F5F9'); }
    ctx.fillStyle = grad;
    const radius = Math.min(3, barW / 2);
    ctx.beginPath(); ctx.moveTo(x + radius, y);
    ctx.lineTo(x + barW - radius, y);
    ctx.quadraticCurveTo(x + barW, y, x + barW, y + radius);
    ctx.lineTo(x + barW, pad.top + chartH);
    ctx.lineTo(x, pad.top + chartH);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.fill();
    // label
    if (d.label) {
      ctx.fillStyle = isDark ? '#94A3B8' : '#64748B';
      ctx.font = '10px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(d.label, pad.left + gap * i + gap / 2, pad.top + chartH + 16);
    }
  });

  // Goal line
  ctx.strokeStyle = isDark ? 'rgba(245,158,11,.5)' : 'rgba(245,158,11,.6)';
  ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
  const goalY = pad.top + chartH - (dailyGoal / maxCount) * chartH;
  ctx.beginPath(); ctx.moveTo(pad.left, goalY); ctx.lineTo(w - pad.right, goalY); ctx.stroke();
  ctx.setLineDash([]);
}

function drawDonutChart() {
  const canvas = document.getElementById('donut-chart');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const size = Math.min(rect.width, 260);
  canvas.width = size * dpr; canvas.height = size * dpr;
  canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const cx = size / 2, cy = size / 2, outerR = size * .35, innerR = size * .22;
  const segments = [
    { label: '待复习', value: countByCategory('due'), color: '#F59E0B' },
    { label: '学习中', value: countByCategory('learning'), color: '#7C3AED' },
    { label: '已掌握', value: countByCategory('mastered'), color: '#10B981' },
    { label: '新词', value: countByCategory('new'), color: '#4F46E5' },
  ].filter(s => s.value > 0);
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (total === 0) {
    ctx.fillStyle = document.documentElement.classList.contains('dark') ? '#94A3B8' : '#64748B';
    ctx.font = '14px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('暂无数据', cx, cy);
    return;
  }
  let angle = -Math.PI / 2;
  segments.forEach(s => {
    const slice = (s.value / total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outerR, angle, angle + slice);
    ctx.closePath(); ctx.fillStyle = s.color; ctx.fill();
    // label
    const midAngle = angle + slice / 2;
    const lx = cx + Math.cos(midAngle) * (outerR + 18);
    const ly = cy + Math.sin(midAngle) * (outerR + 18);
    ctx.fillStyle = document.documentElement.classList.contains('dark') ? '#F1F5F9' : '#0F172A';
    ctx.font = '11px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(s.label, lx, ly);
    angle += slice;
  });
  // Center
  ctx.beginPath(); ctx.arc(cx, cy, innerR, 0, Math.PI * 2); ctx.fillStyle = document.documentElement.classList.contains('dark') ? '#1E293B' : '#FFFFFF'; ctx.fill();
  ctx.fillStyle = document.documentElement.classList.contains('dark') ? '#F1F5F9' : '#0F172A';
  ctx.font = 'bold 20px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(total, cx, cy - 4);
  ctx.font = '11px system-ui'; ctx.fillStyle = document.documentElement.classList.contains('dark') ? '#94A3B8' : '#64748B';
  ctx.fillText('总计', cx, cy + 14);
}

function drawForgettingCurve() {
  const canvas = document.getElementById('forgetting-chart');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr; canvas.height = 220 * dpr;
  canvas.style.width = rect.width + 'px'; canvas.style.height = '220px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const w = rect.width, h = 220;
  const isDark = document.documentElement.classList.contains('dark');

  // Count words due each of the next 7 days
  const now = new Date();
  const days = [];
  for (let i = 0; i < 7; i++) {
    const dayStart = new Date(now);
    dayStart.setDate(dayStart.getDate() + i);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    let count = 0;
    for (const w of WORDS) {
      const e = getSRS(w.id);
      if (!e || !e.nextReviewTime) continue;
      const reviewTime = new Date(e.nextReviewTime);
      if (reviewTime >= dayStart && reviewTime < dayEnd) count++;
    }
    const dowLabels = ['周日','周一','周二','周三','周四','周五','周六'];
    days.push({ label: i === 0 ? '今天' : dowLabels[dayStart.getDay()], count });
  }

  const maxCount = Math.max(1, ...days.map(d => d.count));
  const pad = { top: 10, right: 16, bottom: 28, left: 36 };
  const chartW = w - pad.left - pad.right, chartH = h - pad.top - pad.bottom;
  const barW = Math.max(20, chartW / 7 * .55);
  const gap = chartW / 7;

  // Y-axis grid
  ctx.strokeStyle = isDark ? '#334155' : '#E2E8F0';
  ctx.lineWidth = .5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    ctx.fillStyle = isDark ? '#94A3B8' : '#64748B';
    ctx.font = '10px system-ui'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxCount - (maxCount / 4) * i), pad.left - 4, y + 3);
  }

  // Bars
  days.forEach((d, i) => {
    const barH = d.count > 0 ? Math.max(2, (d.count / maxCount) * chartH) : 0;
    const x = pad.left + gap * i + (gap - barW) / 2;
    const y = pad.top + chartH - barH;
    const grad = ctx.createLinearGradient(x, y, x, pad.top + chartH);
    grad.addColorStop(0, '#00BC71');
    grad.addColorStop(1, '#34D399');
    ctx.fillStyle = grad;
    const radius = Math.min(4, barW / 2);
    ctx.beginPath(); ctx.moveTo(x + radius, y);
    ctx.lineTo(x + barW - radius, y);
    ctx.quadraticCurveTo(x + barW, y, x + barW, y + radius);
    ctx.lineTo(x + barW, pad.top + chartH);
    ctx.lineTo(x, pad.top + chartH);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.fill();
    // Day label
    ctx.fillStyle = isDark ? '#94A3B8' : '#64748B';
    ctx.font = '11px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(d.label, pad.left + gap * i + gap / 2, pad.top + chartH + 16);
    // Count on top
    if (d.count > 0) {
      ctx.fillStyle = isDark ? '#F1F5F9' : '#0F172A';
      ctx.font = 'bold 10px system-ui';
      ctx.fillText(d.count, pad.left + gap * i + gap / 2, y - 4);
    }
  });
}

// ========================================================
//  LISTENING MODE
// ========================================================
function renderListen() {
  if (WORDS.length === 0) {
    document.getElementById('main-content').innerHTML = '<div class="empty-state"><div style="font-size:40px;margin-bottom:12px;"><i class="fa-solid fa-headphones"></i></div><div>还没有单词，请先导入单词</div></div>';
    return;
  }
  if (listenIndex >= WORDS.length) listenIndex = 0;
  const w = WORDS[listenIndex];
  const currentFolder = folders.find(f => f.id === activeFolderId);
  document.getElementById('main-content').innerHTML = `<div class="listen-container fade-in">
    <div class="listen-status">
      <span><i class="fa-solid fa-folder"></i> ${(currentFolder||{}).name||'默认'}</span>
      <span style="color:var(--text-muted);">·</span>
      <span>${listenIndex+1}/${WORDS.length}</span>
      ${listenLoopMode === 'next' ? '<span style="color:var(--primary);font-size:11px;">→ 自动切换</span>' : '<span style="color:var(--text-muted);font-size:11px;"><i class="fa-solid fa-repeat"></i> 本文件夹</span>'}
    </div>
    <div class="listen-mode-toggle">
      <button class="${listenLoopMode==='folder'?'active':''}" onclick="setListenLoopMode('folder')"><i class="fa-solid fa-repeat"></i> 本文件夹循环</button>
      <button class="${listenLoopMode==='next'?'active':''}" onclick="setListenLoopMode('next')">→ 切换下一文件夹</button>
    </div>
    <div class="listen-card">
      <div class="listen-word">${w.ru}</div>
      <div class="listen-transcription">${w.tr||''}</div>
      <div class="listen-meaning">${w.zh}</div>
      <div class="listen-pos">${w.pos||''}</div>
      <div style="margin-top:8px;">
        <span class="card-srs-badge ${getSRSBadgeClass(w.id)}">${getSRSLabel(w.id)}</span>
      </div>
    </div>
    <div class="listen-progress">剩余重复 ${listenRepeatRemaining} 次 · 语速 ${listenSpeechRate}x</div>
    <div class="listen-timer-section">
      <span><i class="fa-solid fa-clock"></i> 定时关闭</span>
      <select class="listen-timer-select" id="listen-timer-select" onchange="setListenTimerDuration(this.value)" value="${listenTimerDuration}">
        <option value="0" ${listenTimerDuration===0?'selected':''}>关闭</option>
        <option value="300" ${listenTimerDuration===300?'selected':''}>5 分钟</option>
        <option value="600" ${listenTimerDuration===600?'selected':''}>10 分钟</option>
        <option value="900" ${listenTimerDuration===900?'selected':''}>15 分钟</option>
        <option value="1200" ${listenTimerDuration===1200?'selected':''}>20 分钟</option>
        <option value="1800" ${listenTimerDuration===1800?'selected':''}>30 分钟</option>
        <option value="3600" ${listenTimerDuration===3600?'selected':''}>60 分钟</option>
      </select>
      <span class="listen-timer-display" id="listen-timer-display">--:--</span>
    </div>
    <div class="listen-controls">
      <button class="btn-listen-sm" onclick="listenPrev()" title="上一个">⏮</button>
      <button class="btn-listen ${listenPlaying?'':'paused'}" id="btn-listen-play" onclick="toggleListening()">
        ${listenPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>'}
      </button>
      <button class="btn-listen-sm" onclick="listenNext()" title="下一个">⏭</button>
    </div>
    <button class="btn btn-ghost btn-sm" onclick="speakWord('${w.ru.replace(/'/g,"\\'")}')"><i class="fa-solid fa-volume-high"></i> 手动朗读</button>
  </div>`;
  setTimeout(updateTimerDisplay, 50);
}

function setListenLoopMode(mode) {
  listenLoopMode = mode;
  renderListen();
}

function toggleListening() {
  if (listenPlaying) { stopListening(); }
  else { startListening(); }
}

function startListening() {
  listenPlaying = true;
  if (listenRepeatRemaining <= 0) listenRepeatRemaining = listenRepeatCount;
  const btn = document.getElementById('btn-listen-play');
  if (btn) { btn.innerHTML = '<i class="fa-solid fa-pause"></i>'; btn.classList.remove('paused'); }
  if (listenTimerDuration > 0) startListenTimer();
  playCurrentWord();
}

function stopListening() {
  listenPlaying = false;
  listenRepeatRemaining = 0;
  if (listenTimeout) { clearTimeout(listenTimeout); listenTimeout = null; }
  window.speechSynthesis.cancel();
  stopListenTimer();
  const btn = document.getElementById('btn-listen-play');
  if (btn) { btn.innerHTML = '<i class="fa-solid fa-play"></i>'; btn.classList.add('paused'); }
}

function startListenTimer() {
  if (listenTimerDuration <= 0) return;
  listenTimerRemaining = listenTimerDuration;
  updateTimerDisplay();
  if (listenTimerInterval) clearInterval(listenTimerInterval);
  listenTimerInterval = setInterval(() => {
    listenTimerRemaining--;
    updateTimerDisplay();
    if (listenTimerRemaining <= 0) {
      stopListening();
      showToast('<i class="fa-solid fa-clock"></i> 定时关闭，听力已停止', '');
    }
  }, 1000);
}

function stopListenTimer() {
  if (listenTimerInterval) { clearInterval(listenTimerInterval); listenTimerInterval = null; }
  listenTimerRemaining = 0;
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const el = document.getElementById('listen-timer-display');
  if (!el) return;
  if (listenTimerRemaining > 0) {
    const m = Math.floor(listenTimerRemaining / 60);
    const s = listenTimerRemaining % 60;
    el.textContent = m + ':' + String(s).padStart(2, '0');
    el.className = 'listen-timer-display' + (listenTimerRemaining <= 60 ? ' warning' : '');
  } else {
    el.textContent = '--:--';
    el.className = 'listen-timer-display';
  }
}

function setListenTimerDuration(val) {
  listenTimerDuration = parseInt(val) || 0;
  localStorage.setItem('flashcards_listen_timer', listenTimerDuration);
  if (listenPlaying) {
    stopListenTimer();
    if (listenTimerDuration > 0) startListenTimer();
  }
  updateTimerDisplay();
}

function playCurrentWord() {
  if (!listenPlaying || WORDS.length === 0) { stopListening(); return; }
  if (listenIndex >= WORDS.length) listenIndex = 0;
  if (listenRepeatRemaining <= 0) {
    listenRepeatRemaining = listenRepeatCount;
    listenIndex++;
    // Check if we should advance to next folder
    if (listenIndex >= WORDS.length) {
      if (listenLoopMode === 'next') {
        const currentIdx = folders.findIndex(f => f.id === activeFolderId);
        if (currentIdx >= 0 && currentIdx < folders.length - 1) {
          switchFolder(folders[currentIdx + 1].id);
          listenIndex = 0;
          listenRepeatRemaining = listenRepeatCount;
          setTimeout(() => { renderListen(); startListening(); }, 300);
          return;
        }
      }
      listenIndex = 0;
    }
    renderListen();
    // Small delay to let UI update
    listenTimeout = setTimeout(() => {
      if (listenPlaying) speakAndContinue();
    }, 400);
    return;
  }
  const w = WORDS[listenIndex];
  speakWord(w.ru);
  listenRepeatRemaining--;
  document.getElementById('btn-listen-play').innerHTML = '<i class="fa-solid fa-pause"></i>';
  // Wait for speech to finish, then continue
  const checkSpeechEnd = setInterval(() => {
    if (!listenPlaying || !window.speechSynthesis.speaking) {
      clearInterval(checkSpeechEnd);
      if (listenPlaying) {
        listenTimeout = setTimeout(() => playCurrentWord(), 600);
      }
    }
  }, 200);
}

function speakAndContinue() {
  const w = WORDS[listenIndex];
  speakWord(w.ru);
  listenRepeatRemaining--;
  const checkSpeechEnd = setInterval(() => {
    if (!listenPlaying || !window.speechSynthesis.speaking) {
      clearInterval(checkSpeechEnd);
      if (listenPlaying) {
        listenTimeout = setTimeout(() => playCurrentWord(), 600);
      }
    }
  }, 200);
}

function listenNext() {
  const wasPlaying = listenPlaying;
  stopListening();
  listenIndex = (listenIndex + 1) % WORDS.length;
  listenRepeatRemaining = listenRepeatCount;
  renderListen();
  if (wasPlaying) setTimeout(() => startListening(), 200);
}

function listenPrev() {
  const wasPlaying = listenPlaying;
  stopListening();
  listenIndex = (listenIndex - 1 + WORDS.length) % WORDS.length;
  listenRepeatRemaining = listenRepeatCount;
  renderListen();
  if (wasPlaying) setTimeout(() => startListening(), 200);
}

// ========================================================
//  INIT
// ========================================================
function init() {
  applyTheme();
  try {
    const session = getCurrentSession();
    if (session && session.accountId) {
      const accounts = loadAccounts();
      if (accounts[session.accountId]) {
        enterApp(session.username);
        return;
      }
      clearSession();
    }
  } catch(e) {
    console.error('Init error:', e);
    clearSession();
  }
  document.getElementById('app-screen').style.display = 'none';
  showAuthScreen();
}

init();

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (document.getElementById('auth-screen').style.display !== 'none') return;
  if (document.getElementById('import-modal').classList.contains('show')) return;
  if (document.getElementById('edit-modal').classList.contains('show')) return;
  if (document.getElementById('add-lang-modal').classList.contains('show')) return;

  if (currentMode === 'flashcard') {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (cardStage === 1) handleStage1('know');
      else handleStage1('know');
    }
    else if (e.key === 'ArrowRight') { e.preventDefault(); nextCard(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prevCard(); }
    else if (e.key === 's' && !e.ctrlKey && !e.metaKey) {
      if (sessionActive) {
        const wordId = sessionQueue[flashcardIndex];
        if (wordId !== undefined) {
          const w = WORDS.find(x => x.id === wordId);
          if (w) speakWord(w.ru);
        }
      } else {
        const idx = flashcardPool[flashcardIndex];
        if (idx !== undefined) speakWord(WORDS[idx].ru);
      }
    }
  }
});
// ========================================================
//  CONFETTI SYSTEM
// ========================================================
const confettiCanvas = document.getElementById('confetti-canvas');
const confettiCtx = confettiCanvas.getContext('2d');
let confettiParticles = [];
let confettiRAF = null;

function resizeConfetti() {
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeConfetti);
resizeConfetti();

function launchConfetti(x, y) {
  const colors = ['#00BC71','#34D399','#F59E0B','#8B5CF6','#EF4444','#3B82F6','#EC4899','#10B981'];
  const now = Date.now();
  for (let i = 0; i < 50; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 8;
    confettiParticles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 4 - Math.random() * 6,
      size: 5 + Math.random() * 8,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - .5) * .3,
      opacity: 1,
      life: 1,
      decay: .008 + Math.random() * .015,
      shape: Math.random() > .5 ? 'rect' : 'circle',
      createdAt: now
    });
  }
  if (!confettiRAF) {
    confettiRAF = requestAnimationFrame(animateConfetti);
  }
}

function animateConfetti(timestamp) {
  confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  let alive = false;
  for (let i = confettiParticles.length - 1; i >= 0; i--) {
    const p = confettiParticles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += .12;
    p.rotation += p.rotSpeed;
    p.life -= p.decay;
    if (p.life <= 0) { confettiParticles.splice(i, 1); continue; }
    alive = true;
    confettiCtx.save();
    confettiCtx.globalAlpha = p.life;
    confettiCtx.translate(p.x, p.y);
    confettiCtx.rotate(p.rotation);
    confettiCtx.fillStyle = p.color;
    if (p.shape === 'rect') {
      confettiCtx.fillRect(-p.size * .4, -p.size * .2, p.size * .8, p.size * .4);
    } else {
      confettiCtx.beginPath();
      confettiCtx.arc(0, 0, p.size * .35, 0, Math.PI * 2);
      confettiCtx.fill();
    }
    confettiCtx.restore();
  }
  if (alive) {
    confettiRAF = requestAnimationFrame(animateConfetti);
  } else {
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    confettiRAF = null;
    confettiParticles = [];
  }
}

// ========================================================
//  RIPPLE EFFECT
// ========================================================
function addRipple(e) {
  const btn = e.currentTarget;
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const ripple = document.createElement('span');
  ripple.className = 'ripple-effect';
  ripple.style.width = ripple.style.height = size + 'px';
  ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
  ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
  btn.style.position = 'relative';
  btn.style.overflow = 'hidden';
  btn.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
}

function initRipples() {
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('.btn, .stage-btn, .btn-outline, .btn-ghost, .btn-danger, .nav-item, .option, .btn-icon, .btn-listen, .btn-listen-sm');
    if (btn && !e.target.closest('#confetti-canvas')) {
      addRipple({ currentTarget: btn, clientX: e.clientX, clientY: e.clientY });
    }
  });
}

// ========================================================
//  QUIZ COMBO
// ========================================================
let quizCombo = 0;
let quizComboEl = null;

function quizHitCombo() {
  quizCombo++;
  if (!quizComboEl) return;
  quizComboEl.style.animation = 'none';
  quizComboEl.offsetHeight;
  let text = '';
  if (quizCombo >= 10) { text = '<i class="fa-solid fa-fire"></i> ' + quizCombo + ' 连击！太强了！'; quizComboEl.className = 'quiz-combo fire'; quizComboEl.style.animation = 'comboShake .4s ease'; }
  else if (quizCombo >= 5) { text = '<i class="fa-solid fa-bolt"></i> ' + quizCombo + ' 连击！'; quizComboEl.className = 'quiz-combo fire'; }
  else if (quizCombo >= 3) { text = '<i class="fa-solid fa-sparkles"></i> ' + quizCombo + ' 连击'; quizComboEl.className = 'quiz-combo'; }
  else { text = '<i class="fa-solid fa-thumbs-up"></i> 连续正确 ×' + quizCombo; quizComboEl.className = 'quiz-combo'; }
  quizComboEl.innerHTML = text;
  quizComboEl.style.animation = 'comboIn .3s ease';
}

function quizResetCombo() {
  quizCombo = 0;
  if (quizComboEl) { quizComboEl.textContent = ''; quizComboEl.className = 'quiz-combo'; }
}

// ========================================================
//  ANIMATED COUNTERS
// ========================================================
function animateCounters() {
  document.querySelectorAll('.stat-value[data-target]').forEach(el => {
    const target = parseInt(el.getAttribute('data-target'));
    const current = parseInt(el.textContent) || 0;
    if (current === target) return;
    const duration = 800;
    const start = performance.now();
    function step(ts) {
      const progress = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(current + (target - current) * eased);
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = target;
    }
    requestAnimationFrame(step);
  });
}

