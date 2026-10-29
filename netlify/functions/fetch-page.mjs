// Netlify Function: fetches a public web page server-side so the SEO checker
// can read its HTML (browsers block reading other sites directly).
// URL: /.netlify/functions/fetch-page?url=https://example.com
import { lookup } from "node:dns/promises";

const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^::1$/, /^f[cd]/i, /^fe80/i];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" },
  });

export default async (req) => {
  const raw = new URL(req.url).searchParams.get("url");
  let target;
  try { target = new URL(raw); } catch { return json({ error: "Invalid URL" }, 400); }
  if (!/^https?:$/.test(target.protocol)) return json({ error: "Only http and https addresses can be checked" }, 400);

  // Refuse private or internal addresses
  try {
    const { address } = await lookup(target.hostname);
    if (PRIVATE.some((r) => r.test(address))) return json({ error: "That address can't be checked" }, 400);
  } catch {
    return json({ error: "Domain not found" }, 400);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(target, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; SalmanSEOChecker/1.0; +https://theseospecialist.netlify.app/seo-checker/)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      },
    });
    let body = await res.text();
    if (body.length > 3000000) body = body.slice(0, 3000000);
    return json({
      ok: res.ok,
      status: res.status,
      finalUrl: res.url,
      contentType: res.headers.get("content-type") || "",
      xRobotsTag: res.headers.get("x-robots-tag") || "",
      body,
    });
  } catch (e) {
    return json({ error: e.name === "AbortError" ? "The site took too long to respond" : "Could not reach the site" }, 502);
  } finally {
    clearTimeout(timer);
  }
};
