// netlify/functions/ai-proxy.js
//
// Server-side proxy for the Google Gemini API (generativelanguage.googleapis.com).
// Gemini's free tier needs no credit card — just a Google account — so this
// keeps the whole site free to run. The browser never sees GEMINI_API_KEY —
// only this function does, read from a Netlify environment variable.
//
// Called by index.html's claudeSample(...) / claudeSample.json(...)
// fallback with:
//   POST body: { input: string, json: boolean, modelTier?: string }
//
// json:false -> returns { text }
// json:true  -> returns { result: <parsed> }

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3.6-flash';

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Use POST.' });
  }

  if (!GEMINI_API_KEY) {
    console.error('[ai-proxy] GEMINI_API_KEY is missing from process.env');
    return json(500, { error: 'GEMINI_API_KEY is not set in this site\'s Netlify environment variables.' });
  }
  console.log('[ai-proxy] key present, length:', GEMINI_API_KEY.length);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Invalid JSON body.' });
  }

  const { input, json: wantJson } = body || {};
  if (!input || typeof input !== 'string') {
    return json(400, { error: 'Missing input.' });
  }

  const prompt = wantJson
    ? input + '\n\nRespond with ONLY valid JSON — no prose, no markdown code fences, nothing before or after it.'
    : input;

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error('[ai-proxy] upstream error', upstream.status, JSON.stringify(data).slice(0, 500));
      return json(upstream.status, {
        error: (data && data.error && data.error.message) || 'Gemini API request failed.',
      });
    }
    console.log('[ai-proxy] upstream ok, status', upstream.status);

    const candidate = (data.candidates || [])[0];
    const text = ((candidate && candidate.content && candidate.content.parts) || [])
      .map((p) => p.text || '')
      .join('')
      .trim();

    if (!text) {
      const reason = candidate && candidate.finishReason;
      console.error('[ai-proxy] no text in response, finishReason:', reason, JSON.stringify(data).slice(0, 500));
      return json(502, { error: 'Gemini returned no text' + (reason ? ' (' + reason + ').' : '.') });
    }

    if (wantJson) {
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (e) {
        console.error('[ai-proxy] JSON.parse failed on model output:', cleaned.slice(0, 500));
        return json(502, { error: 'Model did not return valid JSON.' });
      }
      return json(200, { result: parsed });
    }

    return json(200, { text });
  } catch (e) {
    console.error('[ai-proxy] threw:', e && e.stack || e);
    return json(502, { error: String((e && e.message) || e) });
  }
};
