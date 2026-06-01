#!/usr/bin/env python3
"""
Dictionary Tool for Russian Flashcards App
============================================
Pulls REAL dictionary data from free sources — zero AI token cost.

Sources:
  EN: ECDICT (skywind3000) — 770K English words, Chinese translations, IPA, POS, frequency
  RU: OpenRussian (Badestrand) — Russian words with verified stress marks
  DE: Wiktionary XML dump — German words with gender, IPA, translations

Usage:
  python3 tools/dict_tool.py download en          # Download English dict (~200MB SQLite)
  python3 tools/dict_tool.py download ru          # Download Russian dict (~50MB SQLite)
  python3 tools/dict_tool.py download de          # Download German dict

  python3 tools/dict_tool.py add en <level> <n>   # Add N words to English level from dict
  python3 tools/dict_tool.py add ru <level> <n>   # Add N words to Russian level
  python3 tools/dict_tool.py add de <level> <n>   # Add N words to German level

  python3 tools/dict_tool.py stats                # Show all levels + word counts
  python3 tools/dict_tool.py validate             # Check JSON integrity
"""

import json
import os
import re
import sqlite3
import sys
import urllib.request
import zipfile
import gzip
import xml.etree.ElementTree as ET
from pathlib import Path
from io import BytesIO

# ── Config ──────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
WORDLISTS_DIR = BASE_DIR / "wordlists"
DICT_DIR = BASE_DIR / "tools" / "dicts"
DICT_DIR.mkdir(parents=True, exist_ok=True)

EN_DB = DICT_DIR / "ecdict.db"
RU_DB = DICT_DIR / "openrussian.db"
DE_WIKTIONARY = DICT_DIR / "dewiktionary.xml"

ECDICT_URL = "https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip"
OPENRUSSIAN_URL = "https://github.com/Badestrand/russian-dictionary/releases/download/v1.0.0/ru.db"

# ── Normalization ───────────────────────────────────────────
def normalize_ru(s):
    """Strip stress marks and ё→е for dedup."""
    return s.lower().replace("́","").replace("ё","е")

def normalize_en(s):
    return s.lower()

def normalize_de(s):
    return s.lower()

# ── JSON Helpers ────────────────────────────────────────────
def load_json(lang):
    with open(WORDLISTS_DIR / f"{lang}.json", encoding="utf-8") as f:
        return json.load(f)

def save_json(lang, data):
    with open(WORDLISTS_DIR / f"{lang}.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def build_all_set(data, normalize_fn):
    """Build a set of normalized keys from all levels."""
    all_set = set()
    for level_key in data:
        for w in data[level_key]["words"]:
            all_set.add(normalize_fn(w[0]))
    return all_set

# ── Download ────────────────────────────────────────────────
def download_en():
    """Download ECDICT SQLite database (~80MB zip, ~340MB db)."""
    if EN_DB.exists():
        print(f"✅ EN dict already exists: {EN_DB} ({EN_DB.stat().st_size//1024//1024}MB)")
        return
    print(f"📥 Downloading ECDICT from {ECDICT_URL} ...")
    print("   (This is ~80MB, may take a minute...)")
    with urllib.request.urlopen(ECDICT_URL) as resp:
        data = resp.read()
    print(f"   Downloaded {len(data)//1024//1024}MB")

    with zipfile.ZipFile(BytesIO(data)) as zf:
        # Find the .db file in the zip
        for name in zf.namelist():
            if name.endswith('.db'):
                print(f"   Extracting {name} ...")
                zf.extract(name, DICT_DIR)
                # Rename to standard name
                extracted = DICT_DIR / name
                if extracted != EN_DB:
                    extracted.rename(EN_DB)
                break
    print(f"✅ EN dict ready: {EN_DB} ({EN_DB.stat().st_size//1024//1024}MB)")

def download_ru():
    """Download OpenRussian dictionary (CSV/JSON from GitHub)."""
    repo_dir = DICT_DIR / "russian-dictionary"

    # Already has CSV files?
    if repo_dir.exists():
        csvs = list(repo_dir.glob("*.csv"))
        if csvs:
            total = sum(f.stat().st_size for f in csvs)
            print(f"✅ RU dict ready: {len(csvs)} CSV files ({total//1024//1024}MB total)")
            for c in csvs:
                print(f"   {c.name}: {c.stat().st_size//1024//1024}MB")
            return

    # First try: release SQLite
    if not RU_DB.exists():
        try:
            print(f"📥 Trying OpenRussian release download...")
            with urllib.request.urlopen(OPENRUSSIAN_URL) as resp:
                RU_DB.write_bytes(resp.read())
            print(f"✅ RU dict ready (SQLite): {RU_DB}")
            return
        except Exception:
            pass

    # Second try: git clone CSV files
    print("   Cloning OpenRussian repo (~23MB CSV files)...")
    if not repo_dir.exists():
        os.system(f"git clone --depth 1 https://github.com/Badestrand/russian-dictionary.git {repo_dir}")

    csvs = list(repo_dir.glob("*.csv"))
    if csvs:
        total = sum(f.stat().st_size for f in csvs)
        print(f"✅ RU dict ready: {len(csvs)} CSV files ({total//1024//1024}MB total)")
    else:
        print("⚠️  No dictionary files found. Check: https://github.com/Badestrand/russian-dictionary")

# ── English: Query ECDICT ───────────────────────────────────
def get_en_words(limit=500, priority='collins', min_collins=0, max_collins=5):
    """
    Query ECDICT for high-quality English words.
    priority='collins' sorts by Collins stars + BNC/COCA frequency.

    Level mapping:
      Level 1 (foundation): Collins 4-5 (~1,600 words)
      Level 2 (advance): Collins 3 (~1,400 words)
      Level 3 (ielts): Collins 2 + high BNC (~2,800 words)
      Level 4 (gre): Collins 1 + BNC>0 (~6,500 words)

    Returns list of [word, ipa, chinese, pos]
    """
    if not EN_DB.exists():
        print("❌ EN dict not found. Run: python3 tools/dict_tool.py download en")
        return []

    conn = sqlite3.connect(str(EN_DB))
    cursor = conn.cursor()

    query = """
        SELECT word, phonetic, translation, pos, collins, bnc, frq
        FROM stardict
        WHERE translation IS NOT NULL AND translation != ''
          AND word NOT LIKE '%% %%'
          AND word NOT LIKE '%%-%%'
          AND word NOT LIKE '%%.%%'
          AND word == lower(word)
          AND length(word) >= 2 AND length(word) <= 20
          AND collins >= ? AND collins <= ?
        ORDER BY collins DESC, bnc DESC, frq DESC
        LIMIT ?
    """
    cursor.execute(query, (min_collins, max_collins, limit * 5))
    rows = cursor.fetchall()
    conn.close()

    # Format and deduplicate
    seen = set()
    result = []
    for row in rows:
        word, phonetic, translation, pos, collins, bnc, frq = row

        # Clean translation: take first Chinese part, strip prefixes and [domain] tags
        trans = ""
        if translation:
            for p in re.split(r'[\n；]', translation):
                p = p.strip()
                if p and re.search(r'[一-鿿]', p):
                    # Remove [domain] tags like [计] [化] [法] [经] [机] [医]
                    p = re.sub(r'\[[^\]]{1,8}\]', '', p).strip()
                    # Strip English POS prefixes: n. v. a. adj. adv. prep. vt. vi. num. etc.
                    p = re.sub(
                        r'^(n\.|v\.|a\.|adj\.|adv\.|prep\.|pron\.|num\.|conj\.|'
                        r'int\.|art\.|vt\.|vi\.|vt\.vi\.|aux\.|abbr\.|pref\.|suf\.)'
                        r'\s*', '', p
                    ).strip()
                    if p:
                        trans = p
                        break

        # Clean phonetic
        pho = ""
        if phonetic:
            pho = phonetic.strip()
            if not pho.startswith('['):
                pho = f"[{pho}]"

        # Map POS to Chinese
        pos_cn = map_pos_en(pos)

        # Skip abbreviations and noise
        if not word or len(word) < 2:
            continue
        if any(c.isdigit() for c in word):
            continue
        # Skip words that are > 50% uppercase (abbreviations like MS, CD)
        if sum(1 for c in word if c.isupper()) / len(word) > 0.5:
            continue

        key = word.lower()
        if key not in seen and trans:
            seen.add(key)
            result.append([word, pho, trans, pos_cn])

        if len(result) >= limit:
            break

    print(f"   Got {len(result)} words from ECDICT (filtered from {len(rows)} rows)")
    return result

def map_pos_en(pos_tag):
    """Map ECDICT POS tags to Chinese part-of-speech labels.
    Format: 'n:95/v:5' meaning 95% noun, 5% verb.
    We take the primary (highest percentage) POS."""
    if not pos_tag:
        return ""

    # Parse POS:value pairs like 'n:100' or 'a:99/t:1'
    pairs = re.findall(r'([a-z]+):(\d+)', pos_tag.lower())
    if not pairs:
        return ""

    # Find the one with highest percentage
    best = max(pairs, key=lambda x: int(x[1]))
    tag = best[0]

    # ECDICT uses compact POS codes:
    pos_map = {
        'n': '名词',    # noun
        'v': '动词',    # verb
        'j': '形容词',  # adjective (also 'a', 's')
        'a': '形容词',  # adjective
        's': '形容词',  # satellite adjective
        'r': '副词',    # adverb
        'i': '介词',    # preposition
        'c': '连词',    # conjunction
        'u': '连词',    # conjunction
        'p': '代词',    # pronoun
        'd': '限定词',  # determiner
        't': '冠词',    # article
        'm': '数词',    # numeral
        'x': '助词',    # particle/auxiliary
        'e': '叹词',    # interjection
        'o': '叹词',    # interjection
    }
    return pos_map.get(tag, pos_tag.strip())

# ── Russian: OpenRussian CSV Handler ─────────────────────────
RUSSIAN_VOWELS = 'аеёиоуыэюяАЕЁИОУЫЭЮЯ'

def convert_stress(word):
    """Convert OpenRussian apostrophe stress to combining acute accent.
    Example: 'челове\\'к' → 'челове́к'"""
    result = []
    i = 0
    while i < len(word):
        ch = word[i]
        if ch == "'":
            # Apostrophe marks stress on the PREVIOUS vowel
            if result and result[-1].lower() in 'аеёиоуыэюя':
                result[-1] = result[-1] + '́'  # Combining acute accent
            # Skip the apostrophe itself
        else:
            result.append(ch)
        i += 1
    return ''.join(result)

def get_ru_words(limit=500):
    """Fetch Russian words from OpenRussian CSV files.
    Returns list of [word_with_stress, ipa, english_translation, pos]"""
    repo_dir = DICT_DIR / "russian-dictionary"
    if not repo_dir.exists():
        print("❌ RU dict not found. Run: python3 tools/dict_tool.py download ru")
        return []

    csv_files = sorted(repo_dir.glob("*.csv"))
    if not csv_files:
        # Check for SQLite
        if RU_DB.exists():
            return _get_ru_words_from_db(limit)
        print("❌ No Russian dictionary data found.")
        return []

    print(f"   Parsing {len(csv_files)} CSV files...")

    # POS mapping by file
    POS_MAP = {
        'nouns': '名词',
        'verbs': '动词',
        'adjectives': '形容词',
        'others': '',  # Mixed
    }

    result = []
    seen = set()

    for csv_path in csv_files:
        if len(result) >= limit:
            break

        stem = csv_path.stem  # e.g., 'nouns', 'verbs'
        pos_cn = POS_MAP.get(stem, '')

        with open(csv_path, encoding='utf-8') as f:
            header = f.readline().strip().split('\t')

            # Find column indices
            try:
                accented_idx = header.index('accented')
                bare_idx = header.index('bare')
                trans_idx = header.index('translations_en') if 'translations_en' in header else -1
            except ValueError:
                continue

            for line in f:
                if len(result) >= limit:
                    break
                # Break early if we've read enough from this file
                if len(result) % 5000 == 0 and len(result) > 0:
                    pass  # Continue reading

                cols = line.strip().split('\t')
                if len(cols) < max(accented_idx, bare_idx) + 1:
                    continue

                accented_raw = cols[accented_idx].strip()
                bare = cols[bare_idx].strip()

                if not accented_raw or not bare:
                    continue
                if len(bare) < 2:
                    continue
                if ' ' in accented_raw or ' ' in bare:
                    continue  # Skip multi-word

                # Convert stress format
                accented = convert_stress(accented_raw)

                # Get English translation (first one)
                trans = ""
                if trans_idx >= 0 and trans_idx < len(cols):
                    trans_raw = cols[trans_idx].strip()
                    if trans_raw:
                        trans = trans_raw.split(';')[0].split(',')[0].strip()

                # Detect POS for 'others' category or refine existing
                if stem == 'others':
                    # Russian POS detection from word characteristics
                    lower_bare = bare.lower()
                    if any(lower_bare.endswith(suf) for suf in ('ость','ство','ение','ание','ота','ина','ист','тель','ник','щик','чик')):
                        pos_cn = '名词'
                    elif any(lower_bare.endswith(suf) for suf in ('ать','ять','еть','ить','оть','уть','ыть')):
                        pos_cn = '动词'
                    elif any(lower_bare.endswith(suf) for suf in ('ый','ий','ой','ский','овой','евый')):
                        pos_cn = '形容词'
                    elif lower_bare.endswith('о'):
                        pos_cn = '副词'
                    elif lower_bare in ('и','а','но','или','если','пока','когда','чтобы','если','хотя','либо','то','же','ли','будто','словно','точно','раз','ведь','даже'):
                        pos_cn = '连词'
                    elif lower_bare in ('в','на','с','к','по','из','от','до','у','за','над','под','при','про','без','для','через','перед','около','между','ради'):
                        pos_cn = '介词'
                    elif lower_bare in ('я','ты','он','она','оно','мы','вы','они','себя','кто','что','чей','который','какой','такой','этот','тот','весь','каждый','сам','мой','твой','свой','наш','ваш','его','её','их'):
                        pos_cn = '代词'
                    elif lower_bare in ('один','два','три','четыре','пять','шесть','семь','восемь','девять','десять','сто','тысяча','первый','второй','третий'):
                        pos_cn = '数词'
                    else:
                        pos_cn = ''

                key = normalize_ru(accented)
                if key not in seen:
                    seen.add(key)
                    result.append([accented, "", trans, pos_cn])

    print(f"   Got {len(result)} words from OpenRussian ({len(csv_files)} files)")
    return result

def _get_ru_words_from_db(limit=500):
    """Fallback: query SQLite if available."""
    conn = sqlite3.connect(str(RU_DB))
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [r[0] for r in cursor.fetchall()]
    print(f"   OpenRussian tables: {tables}")

    result = []
    seen = set()
    if 'words' in tables:
        cursor.execute("PRAGMA table_info(words)")
        cols = [c[1] for c in cursor.fetchall()]
        has_accented = 'accented' in cols
        word_col = 'accented' if has_accented else 'word'
        cursor.execute(f"SELECT {word_col} FROM words WHERE length({word_col}) > 1 LIMIT ?", (limit * 3,))
        for row in cursor.fetchall():
            key = normalize_ru(row[0])
            if key not in seen:
                seen.add(key)
                result.append([row[0], "", "", ""])
            if len(result) >= limit:
                break
    conn.close()
    print(f"   Got {len(result)} words from OpenRussian SQLite")
    return result

# ── German: Frequency List + Dictionary ──────────────────────
DE_FREQ_FILE = DICT_DIR / "de_freq.txt"
DE_FREQ_URL = "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/de/de_50k.txt"

def download_de():
    """Download German frequency word list (50K words, ~500KB)."""
    if DE_FREQ_FILE.exists():
        print(f"✅ DE frequency list ready: {DE_FREQ_FILE} ({DE_FREQ_FILE.stat().st_size//1024}KB)")
        return

    print(f"📥 Downloading German frequency list (50K words, ~500KB)...")
    try:
        with urllib.request.urlopen(DE_FREQ_URL, timeout=30) as resp:
            data = resp.read().decode('utf-8')
        DE_FREQ_FILE.write_text(data, encoding='utf-8')
        lines = data.strip().split('\n')
        print(f"✅ DE dict ready: {len(lines):,} words ({DE_FREQ_FILE.stat().st_size//1024}KB)")
    except Exception as e:
        print(f"⚠️  Download failed: {e}")
        print("   Alternative: download manually from")
        print(f"   {DE_FREQ_URL}")
        print(f"   Save as: {DE_FREQ_FILE}")

def get_de_words(limit=500):
    """Get German words from frequency list.
    Format: 'word frequency' per line (tab-separated).
    Returns list of [word, '', '', ''] — basic form without translations.
    For best results, use with a separate translation source."""
    if not DE_FREQ_FILE.exists():
        print("❌ DE dict not found. Run: python3 tools/dict_tool.py download de")
        return []

    result = []
    seen = set()

    with open(DE_FREQ_FILE, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            # Format: "word frequency" (tab or space separated)
            parts = line.split()
            if len(parts) >= 1:
                word = parts[0]
                # Basic filtering
                if len(word) < 2:
                    continue
                if ' ' in word or '-' in word or '.' in word:
                    continue
                if any(c.isdigit() for c in word):
                    continue

                # Detect if it's a German noun (capitalized) or other
                key = word.lower()
                if key not in seen:
                    seen.add(key)
                    # Add article prefix for capitalized nouns
                    display_word = word
                    pos_cn = ""
                    if word[0].isupper() and word == word[0] + word[1:].lower():
                        # Likely a noun — but we don't know the gender
                        # Common patterns: most nouns need article, but we skip if unknown
                        pos_cn = "名词" if len(word) > 3 else ""
                        # We don't add fake articles — user can verify

                    result.append([display_word, "", "", pos_cn])

            if len(result) >= limit:
                break

    print(f"   Got {len(result)} German words from frequency list")
    return result

# ── Add words to JSON ───────────────────────────────────────
# English: Collins-star → level mapping
EN_LEVEL_COLLINS = {
    'level1_foundation': (4, 5),   # Most common ~1,600 words
    'level2_advance': (3, 3),      # Common ~1,400 words
    'level3_ielts_toefl': (2, 2),  # Mid-frequency ~2,800 words
    'level4_gre': (1, 1),          # Advanced ~6,500 words
}

def add_words(lang, level, n):
    """Add N words from dictionary to a specific level."""
    data = load_json(lang)

    if lang == 'en':
        normalize_fn = normalize_en
        # Use Collins-based filtering for English
        if level in EN_LEVEL_COLLINS:
            min_c, max_c = EN_LEVEL_COLLINS[level]
            print(f"   Using Collins {min_c}-{max_c} for '{level}'")
            getter = lambda limit=n*3: get_en_words(limit=limit, min_collins=min_c, max_collins=max_c)
        else:
            getter = lambda limit=n*3: get_en_words(limit=limit)
    elif lang == 'ru':
        normalize_fn = normalize_ru
        getter = lambda limit=n*3: get_ru_words(limit=limit)
    elif lang == 'de':
        normalize_fn = normalize_de
        getter = lambda limit=n*3: get_de_words(limit=limit)
    else:
        print(f"❌ Unknown language: {lang}")
        return

    if level not in data:
        print(f"❌ Unknown level '{level}' for {lang}. Available: {list(data.keys())}")
        return

    # Build dedup set from ALL levels
    all_set = build_all_set(data, normalize_fn)
    print(f"   Existing keys in all levels: {len(all_set):,}")

    # Get words from dictionary
    dict_words = getter()  # Get extra for dedup
    if not dict_words:
        print("❌ No words from dictionary.")
        return

    # Filter and add
    wlist = list(data[level]["words"])
    added = 0
    skipped = 0
    for w in dict_words:
        key = normalize_fn(w[0])
        if key not in all_set:
            wlist.append(list(w))
            all_set.add(key)
            added += 1
            if added >= n:
                break
        else:
            skipped += 1

    data[level]["words"] = wlist
    save_json(lang, data)

    print(f"✅ Added {added} new words to {lang}/{level}")
    print(f"   (skipped {skipped} duplicates, total now: {len(wlist):,})")
    return added

# ── Stats ────────────────────────────────────────────────────
def show_stats():
    print("\n📊 Word List Statistics\n" + "=" * 50)
    grand_total = 0
    for lang in ['en', 'ru', 'de']:
        d = load_json(lang)
        total = sum(len(d[k]['words']) for k in d)
        grand_total += total
        print(f"\n  {lang.upper()}: {total:,} words")
        for k in d:
            print(f"    {k}: {len(d[k]['words']):,} words — {d[k]['name']}")
    print(f"\n  TOTAL: {grand_total:,} words")

# ── Validate ─────────────────────────────────────────────────
def validate_json():
    print("\n🔍 Validating JSON files...\n" + "=" * 50)
    errors = 0
    for lang in ['en', 'ru', 'de']:
        filepath = WORDLISTS_DIR / f"{lang}.json"
        try:
            data = json.load(open(filepath, encoding='utf-8'))
            for level_key, level_data in data.items():
                for i, w in enumerate(level_data['words']):
                    if len(w) != 4:
                        print(f"  ❌ {lang}/{level_key}[{i}]: expected 4 elements, got {len(w)}: {w[:2]}...")
                        errors += 1
            print(f"  ✅ {lang}.json — {sum(len(data[k]['words']) for k in data):,} words, {len(data)} levels")
        except Exception as e:
            print(f"  ❌ {lang}.json — {e}")
            errors += 1
    if errors:
        print(f"\n❌ {errors} errors found")
    else:
        print(f"\n✅ All files valid (0 errors)")

# ── Fix Russian Stress Marks ──────────────────────────────────
def fix_stress():
    """Add correct stress marks to existing Russian words using OpenRussian dict.
    0 AI token cost — pure dictionary lookup."""
    repo_dir = DICT_DIR / "russian-dictionary"
    csv_files = list(repo_dir.glob("*.csv"))
    if not csv_files:
        print("❌ OpenRussian CSV files not found. Run: python3 tools/dict_tool.py download ru")
        return

    # Build bare→accented lookup from all CSVs
    print("📖 Building stress dictionary from OpenRussian CSVs...")
    stress_map = {}  # bare_word → accented_with_combining_acute
    for csv_path in csv_files:
        with open(csv_path, encoding='utf-8') as f:
            header = f.readline().strip().split('\t')
            try:
                accented_idx = header.index('accented')
                bare_idx = header.index('bare')
            except ValueError:
                continue
            for line in f:
                cols = line.strip().split('\t')
                if len(cols) < max(accented_idx, bare_idx) + 1:
                    continue
                bare = cols[bare_idx].strip()
                accented_raw = cols[accented_idx].strip()
                if bare and accented_raw and len(bare) >= 2 and ' ' not in bare:
                    # Only store if accented form has stress info (apostrophe)
                    if "'" in accented_raw and bare not in stress_map:
                        stress_map[bare] = convert_stress(accented_raw)

    print(f"   Loaded {len(stress_map):,} stressed words")

    # Load Russian JSON
    data = load_json('ru')
    total = 0
    fixed = 0
    skipped_stress = 0
    not_found = 0

    for level_key, level_data in data.items():
        words = level_data['words']
        for i, w in enumerate(words):
            total += 1
            word = w[0]

            # Already has combining acute accent?
            if '́' in word:
                skipped_stress += 1
                continue

            # Normalize (remove any other stress marks) and look up
            bare = word.replace("'", "").replace("́", "").replace("̀", "")
            if bare in stress_map:
                accented = stress_map[bare]
                # Also copy English translation from dict if current is empty
                # (skip — we only fix stress, don't overwrite translations)
                if accented != word:
                    w[0] = accented
                    fixed += 1
            else:
                not_found += 1

    save_json('ru', data)

    print(f"\n📊 Results:")
    print(f"   Total words: {total:,}")
    print(f"   Already had stress: {skipped_stress:,}")
    print(f"   ✅ Fixed (added stress): {fixed:,}")
    print(f"   ⚠️  Not in dictionary: {not_found:,}")

# ── CLI ──────────────────────────────────────────────────────
def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return

    cmd = sys.argv[1]

    if cmd == "download":
        lang = sys.argv[2] if len(sys.argv) > 2 else None
        downloaders = {'en': download_en, 'ru': download_ru, 'de': download_de}
        if lang and lang in downloaders:
            downloaders[lang]()
        elif lang == 'all':
            download_en()
            download_ru()
            download_de()
        else:
            print(f"Usage: python3 tools/dict_tool.py download <en|ru|de|all>")

    elif cmd == "add":
        if len(sys.argv) < 5:
            print("Usage: python3 tools/dict_tool.py add <en|ru|de> <level> <count>")
            return
        lang = sys.argv[2]
        level = sys.argv[3]
        n = int(sys.argv[4])
        add_words(lang, level, n)

    elif cmd == "stats":
        show_stats()

    elif cmd == "fix-stress":
        fix_stress()

    elif cmd == "validate":
        validate_json()

    elif cmd == "info":
        print("""
📚 Dictionary Sources:
  EN: ECDICT by skywind3000 — 770K English-Chinese words with IPA, Collins/BNC/COCA frequency
      GitHub: https://github.com/skywind3000/ECDICT
      Format: SQLite, ~340MB extracted

  RU: OpenRussian by Badestrand — Russian words with native-verified stress marks
      GitHub: https://github.com/Badestrand/russian-dictionary
      Format: SQLite, ~50MB

  DE: German Wiktionary (de.wiktionary.org) — Words with gender, IPA, declensions
      Dump:  https://dumps.wikimedia.org/dewiktionary/
      Format: XML, ~900MB
""")
    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)

if __name__ == "__main__":
    main()
