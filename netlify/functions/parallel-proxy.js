// netlify/functions/parallel-proxy.js
//
// Server-side proxy for Parallel Search (https://parallel.ai).
// The browser never sees PARALLEL_API_KEY — only this function does,
// read from a Netlify environment variable at request time.
//
// Called by index.html's mcpCap.callTool(server, tool, args) fallback with:
//   POST body: { tool: "web_search" | "web_fetch", args: {...} }
// matching techmatch's existing liveWebSearch()/liveWebFetch() argument
// shapes exactly, so no other app code had to change.
//
// tool "web_search"  -> Parallel's POST /v1/search
// tool "web_fetch"   -> Parallel's POST /v1/extract
//
// On success: returns Parallel's JSON response body as-is (status 200).
// On failure: returns { error: { code, message } } with a matching HTTP
// status, which the frontend turns into the app's existing honest
// "showing sample data instead" fallback.

const PARALLEL_API_KEY = process.env.PARALLEL_API_KEY;

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: { code: 'method_not_allowed', message: 'Use POST.' } });
  }

  if (!PARALLEL_API_KEY) {
    return json(500, {
      error: {
        code: 'missing_api_key',
        message: 'PARALLEL_API_KEY is not set in this site\'s Netlify environment variables.',
      },
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: { code: 'bad_request', message: 'Invalid JSON body.' } });
  }

  const { tool, args } = body || {};
  if (!args || typeof args !== 'object') {
    return json(400, { error: { code: 'bad_request', message: 'Missing args.' } });
  }

  try {
    if (tool === 'web_search') {
      const payload = {
        objective: args.objective || undefined,
        search_queries: Array.isArray(args.search_queries) ? args.search_queries.slice(0, 5) : [],
        max_chars_total: 8000,
      };
      if (!payload.search_queries.length) {
        return json(400, { error: { code: 'bad_request', message: 'search_queries is required.' } });
      }

      const upstream = await fetch('https://api.parallel.ai/v1/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': PARALLEL_API_KEY },
        body: JSON.stringify(payload),
      });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        return json(upstream.status, {
          error: {
            code: upstream.status === 401 || upstream.status === 403 ? 'needs_reauth'
              : upstream.status === 429 ? 'rate_limited' : 'upstream_error',
            message: (data && data.error && (data.error.message || data.error)) || 'Parallel Search request failed.',
          },
        });
      }
      return json(200, data);
    }

    if (tool === 'web_fetch') {
      const urls = Array.isArray(args.urls) ? args.urls.slice(0, 20) : [];
      if (!urls.length) {
        return json(400, { error: { code: 'bad_request', message: 'urls is required.' } });
      }
      const payload = {
        urls,
        objective: args.objective || null,
        search_queries: Array.isArray(args.search_queries) ? args.search_queries.slice(0, 5) : null,
      };

      const upstream = await fetch('https://api.parallel.ai/v1/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': PARALLEL_API_KEY },
        body: JSON.stringify(payload),
      });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        return json(upstream.status, {
          error: {
            code: upstream.status === 401 || upstream.status === 403 ? 'needs_reauth'
              : upstream.status === 429 ? 'rate_limited' : 'upstream_error',
            message: (data && data.error && (data.error.message || data.error)) || 'Parallel Extract request failed.',
          },
        });
      }
      return json(200, data);
    }

    return json(400, { error: { code: 'bad_request', message: 'Unknown tool: ' + tool } });
  } catch (e) {
    return json(502, { error: { code: 'server_unavailable', message: String((e && e.message) || e) } });
  }
};
