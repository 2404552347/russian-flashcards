/* ==========================================================================
   core.js — Auth module (~12KB, parses in <100ms on mobile)
   Loads first; handles login/register instantly.
   On successful login, dynamically loads js/app.js for the full app.
   ========================================================================== */

// ── Global state (shared with app.js) ──────────────────
let userLanguages = [];
let activeLang = 'ru';
let activeFolderId = null;
let folders = [];
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
let listenLoopMode = 'folder';
let listenRepeatRemaining = 0, listenTimeout = null;
let listenTimerDuration = 0, listenTimerRemaining = 0, listenTimerInterval = null;
let sessionActive = false;
let sessionQueue = [];
let sessionCompletedWords = [];
let sessionCorrectFirstTry = [];
let sessionTotalAttempts = 0;
let sessionStartedAt = null;
let sessionWordAttempts = {};
let sessionMode = false;
let memoryCards = [];
let memoryFlippedIndices = [];
let memoryMatchedPairs = 0;
let memoryMoves = 0;
let memoryTimerSec = 0;
let memoryTimerInterval = null;
let memoryLocked = false;
let newWordsPerDay = 10;
let _lastUtterance = null;
let cardStage = 1;
let swipeStartX = 0, swipeStartY = 0, swipeCurrentX = 0, swipeActive = false;
let confettiParticles = [];
let confettiRAF = null;
let quizCombo = 0;
let quizComboEl = null;
let readAloudOcrLang = 'eng+rus';
let readAloudSpeechLang = 'ru-RU';
let readAloudRate = 0.85;
let readAloudCameraOn = false;
let readAloudStream = null;
let readAloudTesseractWorker = null;
let readAloudPlaying = false;
let readAloudSentences = [];
let readAloudSentenceIdx = 0;

// ── Constants ──────────────────────────────────────────
const ACCOUNTS_KEY = 'flashcards_accounts';
const SESSION_KEY = 'flashcards_session';
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
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Utilities ──────────────────────────────────────────
function getStorageKey(suffix) {
  const session = getCurrentSession();
  const ns = session ? 'flashcards_' + session.accountId + '_' : 'flashcards_shared_';
  return ns + suffix;
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ── Auth operations ────────────────────────────────────
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
  // Clean up readaloud
  if (readAloudPlaying) { readAloudStop?.(); }
  if (readAloudStream) { readAloudStream.getTracks().forEach(t => t.stop()); readAloudStream = null; readAloudCameraOn = false; }
  if (readAloudTesseractWorker) { readAloudTesseractWorker.terminate?.().catch(() => {}); readAloudTesseractWorker = null; }
  userLanguages = []; WORDS = []; srsData = {}; activeLang = 'ru';
  activeFolderId = null; folders = [];
  flashcardIndex = 0; flashcardFilter = 'all'; flashcardPool = [];
  clearDailySession();
  quizWords = []; quizIndex = 0; quizAnswered = false; listSearchQuery = '';
  document.getElementById('main-content').innerHTML = '';
  document.getElementById('network-info').style.display = 'none';
  showAuthScreen();
}

// ── Data migration ─────────────────────────────────────
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

// ── Theme ───────────────────────────────────────────────
function applyTheme() {
  const saved = localStorage.getItem('flashcards_theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = saved ? saved === 'dark' : prefersDark;
  document.documentElement.classList.toggle('dark', isDark);
  const btn = document.getElementById('btn-theme');
  if (btn) btn.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
}
function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('flashcards_theme', isDark ? 'dark' : 'light');
  const btn = document.getElementById('btn-theme');
  if (btn) btn.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
}

// ── Toast ───────────────────────────────────────────────
function showToast(msg, type) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast' + (type ? ' ' + type : '');
  toast.innerHTML = msg;
  container.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 2500);
}

// ── Session helpers ─────────────────────────────────────
function getSessionKey() {
  try { return getStorageKey('session_' + todayStr()); }
  catch(e) { return null; }
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

// ── Auth UI ─────────────────────────────────────────────
function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display = 'none';
  renderAccountList();
}

function showAppScreen() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = '';
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
  loadFullApp(result.username);
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
  loadFullApp(result.username);
}

// ── Dynamic app loader ──────────────────────────────────
let _appLoaded = false;

function loadFullApp(username) {
  if (_appLoaded) return;
  document.getElementById('current-user').textContent = username;
  showAppScreen();
  applyTheme();
  // Show brief loading indicator
  document.getElementById('main-content').innerHTML =
    '<div style="display:flex;align-items:center;justify-content:center;height:200px;color:var(--text-secondary);font-size:var(--text-base);">' +
    '<i class="fa-solid fa-spinner fa-spin"></i> 加载中...</div>';
  // Dynamically load the full app
  const script = document.createElement('script');
  script.src = 'js/app.js?v=16';
  script.onload = () => { _appLoaded = true; };
  script.onerror = () => {
    document.getElementById('main-content').innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:200px;flex-direction:column;gap:16px;color:var(--text-secondary);font-size:var(--text-base);text-align:center;padding:20px;">' +
      '<div style="font-size:48px;">📵</div>' +
      '<div>应用加载失败，请检查网络连接后刷新页面</div>' +
      '<button class="btn btn-primary" onclick="location.reload()" style="width:auto;margin-top:8px;">刷新页面</button></div>';
  };
  document.head.appendChild(script);
  // app.js init() runs automatically → enterApp() renders the real UI
}

// ── PWA Install Prompt ──────────────────────────────────
let _deferredInstallPrompt = null;
let _isStandalone = window.matchMedia('(display-mode: standalone)').matches
  || navigator.standalone
  || document.referrer.includes('android-app://');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  // Show install button after a short delay (once user is engaged)
  setTimeout(() => {
    if (_deferredInstallPrompt && !_isStandalone) {
      const bar = document.getElementById('install-bar');
      if (bar) bar.style.display = 'flex';
    }
  }, 5000);
});

window.addEventListener('appinstalled', () => {
  _deferredInstallPrompt = null;
  _isStandalone = true;
  const bar = document.getElementById('install-bar');
  if (bar) bar.style.display = 'none';
});

function promptInstall() {
  if (_deferredInstallPrompt) {
    _deferredInstallPrompt.prompt();
    _deferredInstallPrompt.userChoice.then((result) => {
      if (result.outcome === 'accepted') {
        _isStandalone = true;
      }
      _deferredInstallPrompt = null;
      const bar = document.getElementById('install-bar');
      if (bar) bar.style.display = 'none';
    });
  } else {
    // Fallback: show instructions
    showInstallGuide();
  }
}

function isInstalled() { return _isStandalone; }

function showInstallGuide() {
  const isIOS = /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase());
  const msg = isIOS
    ? '点击下方 <b>分享</b> 按钮 → <b>添加到主屏幕</b>'
    : '点击浏览器菜单 → <b>添加到主屏幕</b> 或 <b>安装应用</b>';
  showToast(msg, 'install-toast');
}

// ── Init ────────────────────────────────────────────────
function init() {
  applyTheme();
  try {
    const session = getCurrentSession();
    if (session && session.accountId) {
      const accounts = loadAccounts();
      if (accounts[session.accountId]) {
        loadFullApp(session.username);
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
