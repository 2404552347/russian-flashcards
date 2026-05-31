// ========================================================
//  WORD PACKS — 词汇包管理器（按需加载 JSON）
// ========================================================

// In-memory cache for loaded word packs
const _wordPackCache = {};

// Load word packs for a language (fetches JSON on first access)
async function loadWordPacks(lang) {
  if (_wordPackCache[lang]) return _wordPackCache[lang];
  try {
    const resp = await fetch(`wordlists/${lang}.json`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    _wordPackCache[lang] = data;
    return data;
  } catch(e) {
    console.warn(`Failed to load word packs for ${lang}:`, e.message);
    return null;
  }
}

// Import a word pack into current deck
async function importWordPack(packKey) {
  const packs = await loadWordPacks(activeLang);
  if (!packs) { showToast('词表加载失败，请检查网络', ''); return; }
  const pack = packs[packKey];
  if (!pack) { showToast('词汇包未找到', ''); return; }

  const normalize = s => (s || '').replace(/[́]/g, '').toLowerCase();
  const existingSet = new Set(WORDS.map(w => normalize(w.ru)));
  let imported = 0, skipped = 0;

  const btn = document.getElementById(`import-btn-${packKey}`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 导入中...'; }

  // Use small delays to keep UI responsive for large packs
  for (let i = 0; i < pack.words.length; i++) {
    const [ru, tr, zh, pos] = pack.words[i];
    if (existingSet.has(normalize(ru))) { skipped++; continue; }
    const id = (crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    WORDS.push({ id, ru, tr: tr || '', zh, pos: pos || '', example: '', exampleZh: '' });
    existingSet.add(normalize(ru));
    imported++;
    // Yield every 100 words to keep UI responsive
    if (i % 100 === 0) await new Promise(r => setTimeout(r, 0));
  }

  saveDeck();
  updateStats();
  refreshListResultsAfterImport();
  showToast(`已导入 ${imported} 词${skipped > 0 ? '，跳过 ' + skipped + ' 个重复' : ''}`, 'success');
  vibrate('correct');
  if (imported >= 10) { launchConfetti(); playSound('milestone'); }
}

// Reload the list-results only (without re-rendering the whole dictionary page)
function refreshListResultsAfterImport() {
  refreshListResults();
  // Re-render the word pack section to update "已导N" counts
  refreshWordPacksSection();
}

async function refreshWordPacksSection() {
  const section = document.getElementById('wordpacks-section');
  if (!section) return;
  const packs = await loadWordPacks(activeLang);
  if (!packs) return;
  const packKeys = Object.keys(packs);
  const grid = section.querySelector('.wordpacks-grid');
  if (!grid) return;

  grid.innerHTML = packKeys.map(key => {
    const pack = packs[key];
    const alreadyCount = WORDS.filter(w => pack.words.some(pw => pw[0].replace(/[́]/g,'').toLowerCase() === w.ru.replace(/[́]/g,'').toLowerCase())).length;
    return `<div class="wordpack-card">
      <div class="wordpack-info">
        <div class="wordpack-name">${pack.name}</div>
        <div class="wordpack-desc">${pack.desc}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:11px;color:var(--text-muted);white-space:nowrap;">${pack.words.length}词${alreadyCount > 0 ? ' · 已导'+alreadyCount : ''}</span>
        <button class="btn btn-outline btn-sm" id="import-btn-${key}" onclick="importWordPack('${key}')" style="white-space:nowrap;"><i class="fa-solid fa-download"></i> 导入</button>
      </div>
    </div>`;
  }).join('');
}
