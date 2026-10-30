// Netlify Function: fetches a public page server-side so the SEO checker and AI Visibility Checker can read it.
// URL: /.netlify/functions/fetch-page?url=https://example.com
// Optional: &ua=gptbot|oai-searchbot|claudebot|perplexitybot  (request the page identifying as that crawler)
//           &probe=1  (return the status code and headers only, without the page body)
import { lookup } from "node:dns/promises";

const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^::1$/, /^f[cd]/i, /^fe80/i];
const KEEP = ["content-type", "content-encoding", "x-robots-tag", "strict-transport-security", "x-frame-options",
  "x-content-type-options", "referrer-policy", "content-security-policy", "permissions-policy", "cache-control", "server", "last-modified"];
const DEFAULT_UA = "Mozilla/5.0 (compatible; SalmanSEOChecker/3.0; +https://theseospecialist.netlify.app/seo-checker/)";
const BOT_UA = {
  "gptbot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)",
  "oai-searchbot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
  "claudebot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  "perplexitybot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" },
  });

export default async (req) => {
  const params = new URL(req.url).searchParams;
  const raw = params.get("url");
  const uaKey = (params.get("ua") || "").toLowerCase();
  const probe = params.get("probe") === "1";
  let target;
  try { target = new URL(raw); } catch { return json({ error: "Invalid URL" }, 400); }
  if (!/^https?:$/.test(target.protocol)) return json({ error: "Only http and https addresses can be checked" }, 400);
  try {
    const { address } = await lookup(target.hostname);
    if (PRIVATE.some((r) => r.test(address))) return json({ error: "That address can't be checked" }, 400);
  } catch {
    return json({ error: "Domain not found" }, 400);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8500);
  const started = Date.now();
  try {
    const res = await fetch(target, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent": BOT_UA[uaKey] || DEFAULT_UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        "accept-encoding": "gzip, deflate, br",
      },
    });
    const ms = Date.now() - started;
    const headers = {};
    for (const k of KEEP) { const v = res.headers.get(k); if (v) headers[k] = v; }
    if (probe) {
      try { await res.body?.cancel(); } catch {}
      return json({ ok: res.ok, status: res.status, finalUrl: res.url, redirected: res.redirected, ms, headers, ua: uaKey || "default" });
    }
    let body = await res.text();
    const bytes = body.length;
    if (body.length > 3000000) body = body.slice(0, 3000000);
    return json({ ok: res.ok, status: res.status, finalUrl: res.url, redirected: res.redirected, ms, bytes, headers, xRobotsTag: headers["x-robots-tag"] || "", body });
  } catch (e) {
    return json({ error: e.name === "AbortError" ? "The site took too long to respond" : "Could not reach the site" }, 502);
  } finally {
    clearTimeout(timer);
  }
};
