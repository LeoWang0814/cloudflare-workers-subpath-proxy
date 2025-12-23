# cf-workers-subpath-

> A stable Cloudflare Workers sub-path router that mounts multiple Vercel apps under one domain, with trailing-slash canonicalization and asset-path fixes.
> 
> 一个稳定的 Cloudflare Workers 子路径路由器，把多个 Vercel 站点挂载到同一域名的不同路径，并自动修复「末尾斜杠」与「静态资源路径」问题。  

---

## Features | 功能特性

### ✅ Stable routing table | 稳定的路由表
- **CN**：只会在命中路由表（mount）时代理到对应上游，避免“整站被某个子站覆盖”。
- **EN**: Proxies only when a request matches a configured mount. Prevents “everything becomes one app”.

### ✅ Trailing slash canonicalization | 末尾斜杠统一
- **CN**：自动把 `/mount` 规范化到 `/mount/`（仅对页面导航生效），避免相对资源路径解析错误导致“只剩纯文本”。
- **EN**: Canonicalizes `/mount` → `/mount/` (document navigation only) to prevent relative asset resolution issues.

### ✅ Asset path fixes | 静态资源路径修复
- **CN**：修复常见的：
  - `/_next/*`, `/assets/*` 等根前缀资源
  - `/style.css`, `/script.js`, `/*.png` 等“根目录单文件资源”
  通过 `Referer` 将资源请求归属到正确子站。
- **EN**: Fixes root-prefixed assets and root-level single-file assets by routing them to the correct app based on `Referer`.

### ✅ Safe fallback | 安全回退
- **CN**：未命中路由表时，先回源到主站；若主站返回 404 且为页面导航，则 302 回到首页 `/`。
- **EN**: If no match, fall back to origin (main site). If origin returns 404 for document navigation, redirect to `/`.

---

## Architecture | 架构概览

- **CN**：一个 Worker 作为“路径分发器”，把不同路径映射到不同 Vercel 站点（地址栏保持 `yourdomain.com/...` 不变）。
- **EN**: A single Worker acts as a “path dispatcher”, mapping path prefixes to different Vercel apps while keeping the address bar unchanged.

---

## Quick Start | 快速开始

### 1) Create a Worker | 创建 Worker
- **CN**：在 Cloudflare Dashboard 创建 Worker，把 `worker.js` 内容粘贴进去并部署。
- **EN**: Create a Worker in Cloudflare Dashboard, paste `worker.js`, and deploy.

### 2) Add Routes | 添加路由
- **CN**：建议添加：
  - `example.com/*`
  - `www.example.com/*`（可选）
- **EN**: Recommended routes:
  - `example.com/*`
  - `www.example.com/*` (optional)

> 注：Routes 只支持 `*` 通配符匹配（非正则）。建议让代码保持严格匹配 mount。  
> Note: Routes only support `*` wildcards (not regex). Keep strict mount matching in code.

---

## Configuration | 配置

### Edit the routing table | 修改路由表
在 `RAW_PROXIES` 中添加/修改你的映射：

```js
const RAW_PROXIES = [
  {
    name: "interactive-analysis",
    mount: "/academic/english-final",
    upstreamOrigin: "https://example-of-analysis.vercel.app",
    upstreamBase: "",
  },
  {
    name: "merry-christmas",
    mount: "/cards/christmas",
    upstreamOrigin: "https://a-merry-christmas-card.vercel.app",
    upstreamBase: "",
  },
];
````

#### Rules | 规则

* **CN**：

  * `mount` 必须以 `/` 开头，且不要用 `""` 或 `/` 作为 mount（会导致全站命中）。
  * 建议 mount 不带尾 `/`，由 Worker 自动统一加斜杠。
* **EN**:

  * `mount` must start with `/`. Never use `""` or `/` as a mount.
  * Keep mounts without trailing `/`. Worker will canonicalize automatically.

---

## Debugging | 排错指南

### 1) Check response headers | 看响应头

* **CN**：在浏览器 Network → Headers 看：

  * `X-Proxy-Name`, `X-Proxy-Mount`, `X-Proxy-Upstream`
    用于确认到底命中了哪个子站。
* **EN**: Inspect headers:

  * `X-Proxy-Name`, `X-Proxy-Mount`, `X-Proxy-Upstream`
    to confirm which app handled the request.

### 2) “Pure text only” issue | 只剩纯文本

* **CN**：99% 是 CSS/JS 404。请在 Network 里找第一个 404，看它是否是：

  * `/style.css`, `/script.js`, `/*.png`
  * `/_next/*`, `/assets/*`
    本项目会通过 `Referer` 自动归属到正确 mount。
* **EN**: Usually caused by missing CSS/JS. Check the first 404 in Network. This project fixes common root assets using `Referer`.

### 3) Trailing slash mismatch | 末尾斜杠问题

* **CN**：如果 `/mount` 正常但 `/mount/` 不正常，说明上游站点强制反向重定向（不推荐）。建议统一使用 `/mount/`。
* **EN**: If `/mount` works but `/mount/` doesn’t, your upstream is forcing the opposite canonicalization. Prefer `/mount/`.

---

## Security Notes | 安全说明

* **CN**：这是反向代理。请只代理你信任的上游；如果需要鉴权/限流，建议在 Worker 层加。
* **EN**: This is a reverse proxy. Only proxy trusted upstreams. Add auth/rate-limits at Worker level if needed.

---

## License | 开源许可

MIT

[1]: https://developers.cloudflare.com/workers/configuration/routing/routes/?utm_source=chatgpt.com "Routes - Workers"
