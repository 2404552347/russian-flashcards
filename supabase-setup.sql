-- ========================================================
-- 多语言闪卡 App — Supabase 数据库建表脚本
-- 在 Supabase SQL Editor 中运行此文件
-- ========================================================

-- 1. 用户语言配置表
CREATE TABLE IF NOT EXISTS user_languages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  lang TEXT NOT NULL,
  name TEXT NOT NULL,
  flag TEXT DEFAULT '🌐',
  speech_lang TEXT DEFAULT 'en-US',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, lang)
);

CREATE INDEX idx_user_languages_user ON user_languages(user_id);

-- 2. 单词表
CREATE TABLE IF NOT EXISTS words (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  lang TEXT NOT NULL,
  word TEXT NOT NULL,
  transcription TEXT DEFAULT '',
  chinese TEXT NOT NULL,
  part_of_speech TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_words_user_lang ON words(user_id, lang);

-- 3. SRS 间隔重复进度表
CREATE TABLE IF NOT EXISTS srs_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  word_id UUID REFERENCES words(id) ON DELETE CASCADE NOT NULL,
  ease_factor REAL DEFAULT 2.5,
  interval INT DEFAULT 0,
  repetitions INT DEFAULT 0,
  next_review DATE DEFAULT CURRENT_DATE,
  last_review DATE DEFAULT CURRENT_DATE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, word_id)
);

CREATE INDEX idx_srs_user ON srs_progress(user_id);
CREATE INDEX idx_srs_word ON srs_progress(word_id);

-- ========================================================
-- ROW LEVEL SECURITY (RLS)
-- 每个用户只能访问自己的数据
-- ========================================================

-- user_languages
ALTER TABLE user_languages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own languages"
  ON user_languages FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own languages"
  ON user_languages FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own languages"
  ON user_languages FOR UPDATE
  USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own languages"
  ON user_languages FOR DELETE
  USING (auth.uid() = user_id);

-- words
ALTER TABLE words ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own words"
  ON words FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own words"
  ON words FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own words"
  ON words FOR UPDATE
  USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own words"
  ON words FOR DELETE
  USING (auth.uid() = user_id);

-- srs_progress
ALTER TABLE srs_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own srs"
  ON srs_progress FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own srs"
  ON srs_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own srs"
  ON srs_progress FOR UPDATE
  USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own srs"
  ON srs_progress FOR DELETE
  USING (auth.uid() = user_id);
