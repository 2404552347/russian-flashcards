// Vercel serverless function: AI example sentence generator
// Uses Anthropic API (Claude)

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '例句生成服务未配置，请设置 ANTHROPIC_API_KEY' });
  }

  const { word, translation, pos } = req.body || {};
  if (!word || !translation) {
    return res.status(400).json({ error: 'Missing required fields: word, translation' });
  }

  const posHint = pos ? ` (part of speech: ${pos})` : '';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-latest',
        max_tokens: 200,
        system: 'You are a Russian language tutor. Generate natural, simple example sentences. Always respond with ONLY valid JSON, no other text.',
        messages: [{
          role: 'user',
          content: `Generate one natural Russian example sentence using the word "${word}" (meaning: "${translation}"${posHint}). Return ONLY a JSON object with keys "ru" (the Russian sentence) and "zh" (Chinese translation). Keep it simple and natural.`,
        }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error('Anthropic API error:', resp.status, errText);
      if (resp.status === 401 || resp.status === 403) {
        return res.status(502).json({ error: 'Anthropic API Key 无效' });
      }
      if (resp.status === 429) {
        return res.status(429).json({ error: '请求太频繁，请稍后再试' });
      }
      return res.status(502).json({ error: 'AI 服务暂时不可用，请稍后重试' });
    }

    const data = await resp.json();
    const text = data?.content?.[0]?.text || '';

    let parsed;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {}

    if (parsed?.ru) {
      return res.status(200).json({ example_ru: parsed.ru, example_zh: parsed.zh || '' });
    }

    if (text.trim()) {
      return res.status(200).json({ example_ru: text.trim(), example_zh: '' });
    }

    return res.status(500).json({ error: '生成例句失败，请重试' });

  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: '请求超时' });
    }
    console.error('Function error:', err);
    return res.status(500).json({ error: '服务器内部错误' });
  }
}
