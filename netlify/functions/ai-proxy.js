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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Calls Gemini, and if it comes back with a 503 ("high demand" — a transient
// overload, not a real problem), waits briefly and tries once more before
// giving up. This is the difference between one busy moment sinking an
// entire live-search attempt vs. quietly recovering from it.
async function callGeminiWithRetry(prompt) {
  const maxAttempts = 2;
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
    if (upstream.ok) {
      return { ok: true, status: upstream.status, data };
    }
    last = { ok: false, status: upstream.status, data };
    if (upstream.status === 503 && attempt < maxAttempts) {
      console.log('[ai-proxy] 503 high demand, retrying in 700ms (attempt ' + attempt + ')');
      await sleep(700);
      continue;
    }
    return last;
  }
  return last;
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
    const result = await callGeminiWithRetry(prompt);
    if (!result.ok) {
      console.error('[ai-proxy] upstream error', result.status, JSON.stringify(result.data).slice(0, 500));
      return json(result.status, {
        error: (result.data && result.data.error && result.data.error.message) || 'Gemini API request failed.',
      });
    }
    console.log('[ai-proxy] upstream ok, status', result.status);

    const candidate = (result.data.candidates || [])[0];
    const text = ((candidate && candidate.content && candidate.content.parts) || [])
      .map((p) => p.text || '')
      .join('')
      .trim();

    if (!text) {
      const reason = candidate && candidate.finishReason;
      console.error('[ai-proxy] no text in response, finishReason:', reason, JSON.stringify(result.data).slice(0, 500));
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
