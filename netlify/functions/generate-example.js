// Netlify serverless function: AI example sentence generator
// Uses Anthropic API (Claude) or Google Gemini API

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!anthropicKey && !geminiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: '例句生成服务未配置，请设置 ANTHROPIC_API_KEY 或 GEMINI_API_KEY' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { word, translation, pos } = body;
  if (!word || !translation) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: word, translation' }) };
  }

  const posHint = pos ? ` (part of speech: ${pos})` : '';

  // Prefer Anthropic if available, fall back to Gemini
  if (anthropicKey) {
    const result = await callAnthropic(anthropicKey, word, translation, posHint, headers);
    if (result) return result;
  }

  if (geminiKey) {
    const result = await callGemini(geminiKey, word, translation, posHint, headers);
    if (result) return result;
  }

  return { statusCode: 500, headers, body: JSON.stringify({ error: '生成例句失败，请重试' }) };
};

async function callAnthropic(apiKey, word, translation, posHint, headers) {
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
        return { statusCode: 502, headers, body: JSON.stringify({ error: 'Anthropic API Key 无效' }) };
      }
      if (resp.status === 429) {
        return { statusCode: 429, headers, body: JSON.stringify({ error: '请求太频繁，请稍后再试' }) };
      }
      return null; // Fall through to Gemini
    }

    const data = await resp.json();
    const text = data?.content?.[0]?.text || '';

    let parsed;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {}

    if (parsed?.ru) {
      return { statusCode: 200, headers, body: JSON.stringify({ example_ru: parsed.ru, example_zh: parsed.zh || '' }) };
    }

    if (text.trim()) {
      return { statusCode: 200, headers, body: JSON.stringify({ example_ru: text.trim(), example_zh: '' }) };
    }

    return null;
  } catch (err) {
    if (err.name === 'AbortError') {
      return { statusCode: 504, headers, body: JSON.stringify({ error: '请求超时' }) };
    }
    console.error('Anthropic call error:', err);
    return null;
  }
}

async function callGemini(apiKey, word, translation, posHint, headers) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: 'You are a Russian language tutor. Generate natural, simple example sentences. Always respond with ONLY valid JSON, no other text.' }]
          },
          contents: [{
            parts: [{
              text: `Generate one natural Russian example sentence using the word "${word}" (meaning: "${translation}"${posHint}). Return ONLY a JSON object with keys "ru" (the Russian sentence) and "zh" (Chinese translation of the sentence). Keep it simple and natural.`
            }]
          }],
          generationConfig: { maxOutputTokens: 200, temperature: 0.7 }
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error('Gemini API error:', resp.status, errText);
      if (resp.status === 429) {
        return { statusCode: 429, headers, body: JSON.stringify({ error: '请求太频繁，请稍后再试' }) };
      }
      return null;
    }

    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let parsed;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {}

    if (parsed?.ru) {
      return { statusCode: 200, headers, body: JSON.stringify({ example_ru: parsed.ru, example_zh: parsed.zh || '' }) };
    }

    if (text.trim()) {
      return { statusCode: 200, headers, body: JSON.stringify({ example_ru: text.trim(), example_zh: '' }) };
    }

    return null;
  } catch (err) {
    if (err.name === 'AbortError') {
      return { statusCode: 504, headers, body: JSON.stringify({ error: '请求超时' }) };
    }
    console.error('Gemini call error:', err);
    return null;
  }
}
