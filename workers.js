/**
 * Stable multi-app router for Vercel apps under one domain (Cloudflare Workers)
 *
 * Minimal changes in this version:
 * A) Force trailing slash for ALL browser navigations (document requests) when missing,
 *    while NOT touching assets/files (css/js/png/robots.txt/_next/etc).
 * B) If final response is 404 for a browser navigation, serve a placeholder page by
 *    PROXYING https://example.com/ (address bar stays blueberryowo.me).
 *
 * IMPORTANT:
 * - Do NOT use mount "" or "/" in the table.
 */

const NOT_FOUND_PLACEHOLDER = "https://example.com/"; // TODO: replace later

const RAW_PROXIES = [
  {
    name: "interactive-analysis",
    mount: "/academic/english-final",
    upstreamOrigin: "https://interactive-analysis.vercel.app",
    upstreamBase: "",
  },
  {
    name: "merry-christmas",
    mount: "/cards/christmas",
    upstreamOrigin: "https://wish-you-a-merry-christmas.vercel.app",
    upstreamBase: "",
  },
];

// Root-level asset prefixes commonly requested by frameworks
const ROOT_ASSET_PREFIXES = [
  "/_next/",
  "/assets/",
  "/favicon",
  "/robots.txt",
  "/sitemap",
  "/manifest",
];

// Root-level single-file extensions (e.g. /style.css /script.js /image.png)
const ROOT_FILE_EXTS = new Set([
  "css", "js", "mjs", "map",
  "png", "jpg", "jpeg", "gif", "svg", "webp", "ico",
  "woff", "woff2", "ttf", "otf",
  "json", "txt", "xml",
]);

const PROXIES = normalizeAndValidate(RAW_PROXIES);

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 0) ✅ Force trailing slash for ALL browser navigations when missing
    //    Example: /cards/christmas/zh-cn  -> /cards/christmas/zh-cn/
    const slashRedirect = maybeRedirectToTrailingSlash(request, url);
    if (slashRedirect) return slashRedirect;

    // 1) Mount match (longest mount wins)
    const mountHit = matchByMount(url.pathname);
    if (mountHit) {
      const resp = await proxyToUpstreamStripMount(request, url, mountHit.proxy, mountHit.mountUsed);
      return await maybeServePlaceholder404(request, url, resp);
    }

    // 2) Root asset prefixes: route by Referer
    const prefixHit = matchRootAssetByReferer(request, url.pathname);
    if (prefixHit) {
      const resp = await proxyToUpstreamKeepPath(request, url, prefixHit.proxy, prefixHit.mountUsed);
      return resp;
    }

    // 3) Root single-file assets (your style.css/script.js/*.png case): route by Referer
    const rootFileHit = matchRootFileByReferer(request, url.pathname);
    if (rootFileHit) {
      const resp = await proxyToUpstreamKeepPath(request, url, rootFileHit.proxy, rootFileHit.mountUsed);
      return resp;
    }

    // 4) Not in table: let origin (your main site) handle it
    const originResp = await fetch(request);
    return await maybeServePlaceholder404(request, url, originResp);
  },
};

// ---------------- trailing slash canonicalization ----------------

function maybeRedirectToTrailingSlash(request, url) {
  // Only for browser navigations (document), and only GET/HEAD
  if (!isDocumentNavigation(request, url)) return null;

  const p = url.pathname;

  // Already OK
  if (p === "/" || p.endsWith("/")) return null;

  // Do NOT touch obvious assets/files/special paths
  if (isAssetLikePath(p)) return null;

  // ✅ Add slash (same domain)
  const to = new URL(url.toString());
  to.pathname = p + "/";
  // 308 = permanent redirect, preserves method
  return Response.redirect(to.toString(), 308);
}

function isAssetLikePath(pathname) {
  // 1) has file extension like .css/.js/.png...
  const last = pathname.split("/").pop() || "";
  const m = last.match(/\.([a-z0-9]+)$/i);
  if (m && ROOT_FILE_EXTS.has(m[1].toLowerCase())) return true;

  // 2) matches known asset prefixes (including ones without dot, e.g. /favicon, /sitemap)
  for (const pref of ROOT_ASSET_PREFIXES) {
    if (pathname === pref || pathname.startsWith(pref)) return true;
    // also treat "/favicon" as a prefix for "/favicon.ico"
    if (pref.endsWith("/") === false && pathname.startsWith(pref)) return true;
  }

  // 3) .well-known should not be modified
  if (pathname === "/.well-known" || pathname.startsWith("/.well-known/")) return true;

  return false;
}

// ---------------- placeholder 404 (proxy example.com) ----------------

async function maybeServePlaceholder404(request, url, resp) {
  // Only replace 404 for browser navigations
  if (resp.status !== 404) return resp;
  if (!isDocumentNavigation(request, url)) return resp;

  // Proxy the placeholder page (address bar stays blueberryowo.me)
  const ph = await fetch(NOT_FOUND_PLACEHOLDER, { redirect: "follow" });

  const h = new Headers(ph.headers);
  h.set("cache-control", "no-store");
  h.set("X-NotFound-Placeholder", "1");

  return new Response(ph.body, { status: 404, headers: h });
}

// ---------------- matching ----------------

function normalizeMount(m) {
  if (typeof m !== "string") return null;
  if (!m.startsWith("/")) m = "/" + m;
  if (m.length > 1 && m.endsWith("/")) m = m.slice(0, -1);
  return m;
}

function normalizeAndValidate(list) {
  const out = list.map((p) => ({
    ...p,
    mount: normalizeMount(p.mount),
    upstreamBase: p.upstreamBase || "",
  }));

  // Disallow empty or "/" mounts (these cause "everything becomes one app")
  for (const p of out) {
    if (!p.mount || p.mount === "/") {
      throw new Error(`Invalid mount "${p.mount}". Do NOT use "" or "/".`);
    }
  }

  // Unique mounts
  const seen = new Set();
  for (const p of out) {
    if (seen.has(p.mount)) throw new Error(`Duplicate mount: ${p.mount}`);
    seen.add(p.mount);
  }

  // Sort by mount length desc so longest wins
  out.sort((a, b) => b.mount.length - a.mount.length);
  return out;
}

function matchByMount(pathname) {
  for (const proxy of PROXIES) {
    const m = proxy.mount;
    if (pathname === m || pathname.startsWith(m + "/")) {
      return { proxy, mountUsed: m };
    }
  }
  return null;
}

function matchRootAssetByReferer(request, pathname) {
  if (!ROOT_ASSET_PREFIXES.some((p) => pathname === p.slice(0, -1) || pathname.startsWith(p))) {
    return null;
  }
  return matchByReferer(request);
}

function matchRootFileByReferer(request, pathname) {
  if (pathname === "/") return null;
  if (pathname.indexOf("/", 1) !== -1) return null; // not root-level single file
  const m = pathname.match(/\.([a-z0-9]+)$/i);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  if (!ROOT_FILE_EXTS.has(ext)) return null;
  return matchByReferer(request);
}

function matchByReferer(request) {
  const ref = request.headers.get("Referer") || request.headers.get("Referrer");
  if (!ref) return null;

  let refUrl;
  try { refUrl = new URL(ref); } catch { return null; }

  for (const proxy of PROXIES) {
    const m = proxy.mount;
    if (refUrl.pathname === m || refUrl.pathname.startsWith(m + "/")) {
      return { proxy, mountUsed: m };
    }
  }
  return null;
}

// ---------------- proxy core ----------------

// A) /mount/xxx -> upstream /xxx
async function proxyToUpstreamStripMount(request, siteUrl, proxy, mountUsed) {
  let rest = siteUrl.pathname.slice(mountUsed.length);
  if (rest === "") rest = "/";

  const upstream = new URL(proxy.upstreamOrigin);
  upstream.pathname = joinPath(proxy.upstreamBase, rest);
  upstream.search = siteUrl.search;

  return proxyFetch(request, siteUrl, proxy, mountUsed, upstream);
}

// B) /style.css -> upstream /style.css (keep path)
async function proxyToUpstreamKeepPath(request, siteUrl, proxy, mountUsed) {
  const upstream = new URL(proxy.upstreamOrigin);
  upstream.pathname = joinPath(proxy.upstreamBase, siteUrl.pathname);
  upstream.search = siteUrl.search;

  return proxyFetch(request, siteUrl, proxy, mountUsed, upstream);
}

async function proxyFetch(request, siteUrl, proxy, mountUsed, upstream) {
  const headers = new Headers(request.headers);
  headers.delete("host");

  headers.set("X-Forwarded-Host", siteUrl.host);
  headers.set("X-Forwarded-Proto", siteUrl.protocol.replace(":", ""));
  headers.set("X-Original-URL", siteUrl.toString());

  const init = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;

  // manual redirect so we can rewrite Location and keep address bar on blueberryowo.me
  const upstreamResp = await fetch(new Request(upstream.toString(), init), { redirect: "manual" });

  // rewrite upstream redirects back under mount
  if (upstreamResp.status >= 300 && upstreamResp.status < 400) {
    return rewriteRedirect(upstreamResp, proxy, siteUrl.origin, mountUsed);
  }

  // rewrite HTML links so assets/routes stay under mount
  const ct = upstreamResp.headers.get("content-type") || "";
  let finalResp = upstreamResp;
  if (ct.includes("text/html")) {
    finalResp = rewriteHtml(upstreamResp, proxy, siteUrl.origin, mountUsed);
  }

  // debug headers (optional)
  return withDebugHeaders(finalResp, proxy, mountUsed, upstream);
}

function rewriteRedirect(resp, proxy, siteOrigin, mountUsed) {
  const h = new Headers(resp.headers);
  const loc = h.get("Location");
  if (!loc) return resp;

  const upstreamOrigin = new URL(proxy.upstreamOrigin).origin;

  let u;
  try { u = new URL(loc); } catch { u = new URL(loc, proxy.upstreamOrigin + "/"); }

  if (u.origin === upstreamOrigin) {
    u.origin = siteOrigin;
    u.pathname = mountUsed + u.pathname;
    h.set("Location", u.toString());
    return new Response(null, { status: resp.status, headers: h });
  }

  return new Response(null, { status: resp.status, headers: h });
}

function rewriteHtml(resp, proxy, siteOrigin, mountUsed) {
  const upstreamOrigin = new URL(proxy.upstreamOrigin).origin;

  const rewriter = new HTMLRewriter()
    .on("base", {
      element(el) {
        // Force base to mount (helps relative links)
        el.setAttribute("href", mountUsed + "/");
      }
    })
    .on("a", new AttrRewriter("href", mountUsed, siteOrigin, upstreamOrigin))
    .on("link", new AttrRewriter("href", mountUsed, siteOrigin, upstreamOrigin))
    .on("script", new AttrRewriter("src", mountUsed, siteOrigin, upstreamOrigin))
    .on("img", new AttrRewriter("src", mountUsed, siteOrigin, upstreamOrigin))
    .on("source", new AttrRewriter("src", mountUsed, siteOrigin, upstreamOrigin))
    .on("iframe", new AttrRewriter("src", mountUsed, siteOrigin, upstreamOrigin))
    .on("form", new AttrRewriter("action", mountUsed, siteOrigin, upstreamOrigin));

  return rewriter.transform(resp);
}

class AttrRewriter {
  constructor(attr, mountUsed, siteOrigin, upstreamOrigin) {
    this.attr = attr;
    this.mountUsed = mountUsed;
    this.siteOrigin = siteOrigin;
    this.upstreamOrigin = upstreamOrigin;
  }
  element(el) {
    const v = el.getAttribute(this.attr);
    if (!v) return;

    const nv = rewriteAttr(v, this.mountUsed, this.siteOrigin, this.upstreamOrigin);
    if (nv !== v) el.setAttribute(this.attr, nv);
  }
}

function rewriteAttr(v, mountUsed, siteOrigin, upstreamOrigin) {
  if (
    v.startsWith("#") ||
    v.startsWith("mailto:") ||
    v.startsWith("tel:") ||
    v.startsWith("javascript:") ||
    v.startsWith("data:")
  ) return v;

  // Absolute URL to upstream -> under mount on current site
  try {
    const u = new URL(v);
    if (u.origin === upstreamOrigin) {
      u.origin = siteOrigin;
      u.pathname = mountUsed + u.pathname;
      return u.toString();
    }
  } catch {}

  // Root asset prefixes -> under mount
  for (const p of ROOT_ASSET_PREFIXES) {
    if (v === p.slice(0, -1) || v.startsWith(p)) return mountUsed + v;
  }

  // Internal absolute paths -> under mount
  if (v.startsWith("/")) return mountUsed + v;

  return v;
}

function joinPath(base, rest) {
  const b = (base || "/").replace(/\/+$/, "");
  const r = (rest || "/").replace(/^\/+/, "");
  return b + "/" + r;
}

function isDocumentNavigation(request, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;

  const accept = request.headers.get("Accept") || "";
  const secDest = request.headers.get("Sec-Fetch-Dest") || "";
  const secMode = request.headers.get("Sec-Fetch-Mode") || "";
  const looksLikeDoc = accept.includes("text/html") || secDest === "document" || secMode === "navigate";

  // Don't treat obvious assets as doc navigations
  if (/\.(css|js|mjs|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|map)$/i.test(url.pathname)) {
    return false;
  }
  return looksLikeDoc;
}

function withDebugHeaders(resp, proxy, mountUsed, upstreamUrl) {
  const h = new Headers(resp.headers);
  h.set("X-Proxy-Name", proxy.name || "proxy");
  h.set("X-Proxy-Mount", mountUsed);
  h.set("X-Proxy-Upstream", upstreamUrl.origin);
  return new Response(resp.body, { status: resp.status, headers: h });
}
