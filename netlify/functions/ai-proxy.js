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
// This is the extraction/explanation layer used by extractProductsFromWeb(),
// aiReason() and aiParseNL() in index.html — it only ever rephrases or
// extracts facts it's given, never invents new ones (the instruction to do
// that lives in index.html's prompts, unchanged).
//
// json:false -> returns { text }              (matches sample(input) -> {text})
// json:true  -> returns { result: <parsed> }  (matches sample.json(input) -> JSON)

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Free-tier model as of writing. If Google renames/retires it, swap this for
// whatever AI Studio's free-tier page currently lists (aistudio.google.com).
const MODEL = 'gemini-2.5-flash';

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
    return json(500, { error: 'GEMINI_API_KEY is not set in this site\'s Netlify environment variables.' });
  }

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
      return json(upstream.status, {
        error: (data && data.error && data.error.message) || 'Gemini API request failed.',
      });
    }

    const candidate = (data.candidates || [])[0];
    const text = ((candidate && candidate.content && candidate.content.parts) || [])
      .map((p) => p.text || '')
      .join('')
      .trim();

    if (!text) {
      // e.g. the response was blocked by a safety filter (finishReason: "SAFETY")
      const reason = candidate && candidate.finishReason;
      return json(502, { error: 'Gemini returned no text' + (reason ? ' (' + reason + ').' : '.') });
    }

    if (wantJson) {
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (e) {
        return json(502, { error: 'Model did not return valid JSON.' });
      }
      return json(200, { result: parsed });
    }

    return json(200, { text });
  } catch (e) {
    return json(502, { error: String((e && e.message) || e) });
  }
};
