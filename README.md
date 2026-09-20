# TechMatch AI — Netlify live-search setup

This is the same site as before (`index.html` — a copy is also kept at
`techmatch.html` in case anything links to that name directly), plus two
small serverless functions that make the live web search actually work
when the site is deployed on Netlify:

```
index.html                          <- unchanged except for two small blocks (see below)
techmatch.html                      <- identical copy of index.html
netlify.toml                        <- tells Netlify where the functions live
netlify/functions/parallel-proxy.js <- calls Parallel Search (web_search / web_fetch)
netlify/functions/ai-proxy.js       <- calls Claude to extract structured specs from search results
```

## Why this was needed

The original page called `window.claude.use('mcp')` and `window.claude.use('sample')`
directly. Those only exist when a page is opened as a **published Claude
Artifact**. On a normal site (Netlify, or anywhere else), `window.claude` is
`undefined`, so live search could never turn on — no matter what connector
was added anywhere, because the browser had nowhere to send the request and
no safe place to hold an API key.

The fix moves the two external calls behind Netlify Functions:

- The browser calls `/.netlify/functions/parallel-proxy` and
  `/.netlify/functions/ai-proxy` (same origin, no CORS issues).
- Those functions hold `PARALLEL_API_KEY` and `GEMINI_API_KEY` as
  **server-side environment variables** — never sent to the browser, never
  present in the page's HTML/JS. Both are genuinely free: Parallel's Search
  API has a free tier, and Google's Gemini API (via Google AI Studio) has a
  permanent free tier that needs no credit card at all — so this whole setup
  costs nothing to run at personal-project scale.
- `index.html` still calls the same `claudeSample(...)`, `claudeSample.json(...)`
  and `mcpCap.callTool(...)` functions it always did — only *what's behind*
  those functions changed (native Claude Artifact capability if present,
  otherwise these two Netlify Functions). All wizard, scoring, and rendering
  code is untouched.
- If either call fails or a key isn't set yet, the app falls back to the
  sample catalog exactly as it already did, with an honest on-screen note —
  nothing is hidden or invented.

## What you need to add in Netlify (see chat for the full walkthrough)

Two environment variables, under **Site settings → Environment variables**:

- `PARALLEL_API_KEY` — from https://platform.parallel.ai (free tier)
- `GEMINI_API_KEY` — from https://aistudio.google.com/apikey (free, no credit card)

Then deploy with the Netlify CLI (drag-and-drop deploys do **not** run
serverless functions) — see the deploy steps in chat.
