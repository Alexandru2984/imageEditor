# Audit and roadmap (2026-11)

Scope: the application source in this repository, its dependency graph, the
production delivery path (Cloudflare Tunnel -> Nginx -> static docroot) and the
build that was actually being served at the time of the audit.

Severity: **C** critical, **H** high, **M** medium, **L** low.

## 1. Production delivery

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| P1 | H | The live site served a build from 2026-07-11, about 20 commits behind `main`. Every hardening commit from 2026-07-15 (hostile file imports, dependency upgrades, worker lifecycle, project complexity limits, layer locks) was missing in production. | Fixed by redeploy |
| P2 | H | The live worker loaded `briaai/RMBG-1.4` from the mutable `main` revision and could point ONNX Runtime at jsDelivr. Model weights were not pinned to a reviewed commit. | Fixed in source, needs deploy |
| P3 | H | Docroot owned by `www-data` with group write. A compromised Nginx worker could persist by rewriting site files. | Deploy script installs root-owned, read-only releases |
| P4 | M | Live vhost lacked the reviewed policy: no COOP/COEP/CORP, `X-Frame-Options SAMEORIGIN` instead of `DENY`, CSP without `base-uri`/`form-action`/`object-src`, `connect-src` open to every Hugging Face path, any HTTP method accepted. | `deploy/nginx` is the source of truth |
| P5 | M | `immutable` caching applied by extension, including unhashed files (`favicon.ico`, `placeholder.svg`), so a changed favicon could stay stale for a week. | Only `/assets/` is immutable |
| P6 | L | Unknown paths returned the SPA with HTTP 200 (soft 404s for crawlers). | Real 404 with a static page |
| P7 | L | The application source was not present on the host after the VPS migration; only the compiled build was copied. | Source restored at `/home/micu/imageEditor` |

## 2. Dependencies (`npm audit`, 29 advisories: 11 high, 18 moderate)

Shipped to browsers:

- **zod 3.25** (H, GHSA-mrhx-c7xc-m3w5): memory exhaustion while validating
  oversized constrained collections. Zod validates untrusted project files here.
  Upgrade to 4.x.
- **react-router-dom 6.30** (M): open redirect / XSS and constructor injection
  advisories. The editor has a single route, so the router is removed entirely.

Toolchain only (dev server, tests, lint): vite, vitest, postcss, brace-expansion,
browserslist, js-yaml, nanoid, source-map-js, minimatch, glob, typescript-eslint,
`@huggingface/transformers` optional Node backends (onnxruntime-node, sharp,
adm-zip). Upgraded within their major versions.

## 3. Application defects found during review

| # | Sev | Defect | Repro |
|---|-----|--------|-------|
| A1 | C | Crossing the 768px breakpoint (tablet rotation, window resize) mounts a different layout tree, which disposes the Fabric canvas and reloads the original image: every edit and the undo history are lost. | Edit on desktop, shrink the window below 768px |
| A2 | H | PNG export and crop bake the editor backdrop `#1a1a1a` into transparent pixels, so *Remove BG -> Export PNG* produces a dark background instead of transparency. | Upload a transparent PNG, export PNG |
| A3 | H | Mobile layout overflows to ~700px on a 390px phone; export, save, layers and new-project actions are unreachable and the bottom toolbar clips its first tools (`justify-center` + overflow). | 390x844 viewport |
| A4 | M | Shapes, text and the crop frame are placed in viewport pixels instead of scene coordinates, so after zoom/pan they appear off-screen. | Zoom to 300%, pan, add a rectangle |
| A5 | M | Choosing an already-active shape tool does nothing, so a second rectangle requires switching tools. | Click Rectangle twice |
| A6 | M | `Ctrl+Shift+Z` never redoes: with Shift held `KeyboardEvent.key` is `"Z"`. | Undo, then Ctrl+Shift+Z |
| A7 | M | Colour swatches set `fill` on brush strokes and lines, filling the area enclosed by a stroke instead of recolouring it; arrows ignore colour. | Draw, select stroke, click a swatch |
| A8 | L | `h-screen` (100vh) hides the bottom toolbar behind mobile browser chrome. | Mobile Safari/Chrome |
| A9 | L | Paste only works on the upload screen; images cannot be pasted or dropped as layers inside the editor. | Ctrl+V in editor |

Security posture of the code itself is strong and was kept: magic-byte image
sniffing with dimension caps before decoding, SVG refused, project files
validated as untrusted input (inline `data:` sources only, object-type and
filter allowlists, numeric/string bounds, depth/node caps), model inference in
an isolated worker with request correlation and timeouts, no `unsafe-inline`
scripts, no network access other than the pinned model download.

## 4. Roadmap

1. Security: dependency upgrades, router removal, hardened Nginx and release
   layout, deploy script with atomic release switch.
2. Correctness: fixes A1-A9 with regression tests.
3. Responsive redesign: one layout tree for all widths, dvh units, mobile bottom
   sheets, light/dark theme, landing screen.
4. Features: export dialog (PNG/JPEG/WebP, quality, scale, share, clipboard),
   blank canvas presets, drag-to-draw shapes, clipboard and duplicate, flip and
   arrange, numeric transform, filter presets and more adjustments, auto-enhance,
   text styling (outline, shadow, fonts), meme text, emoji, brushes, eyedropper,
   redaction (pixelate/blur region), smart guides, shortcuts help, context menu.
5. SEO, PWA and CI.
