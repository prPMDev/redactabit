# Redactabit — landing page (`site/`)

The marketing page for Redactabit, hosted on Cloudflare Pages. One static page, no build step, no
framework. **Zero analytics, zero third-party trackers, zero CDN fonts — everything is
self-hosted.** A privacy tool's own site has to practice what it preaches.

```
site/
├── index.html      # the page
├── styles.css      # tokens (from the app) + layout
├── app.js          # ~20 lines: relabel the download button to the visitor's OS (local, no network)
├── favicon.svg     # the redaction-bar mark
├── models.json     # DATA, not marketing — the app's model catalog (see below); don't restyle/delete
├── .nojekyll       # serve files as-is (skip Jekyll)
└── README.md       # this file
```

## `models.json` — the app's model catalog (not part of the page)

`models.json` lives here only because Cloudflare Pages serves it for free at
`https://redactabit.com/models.json`. The **desktop app** fetches it at runtime to learn
which detection models exist and where to download their weights — editing it updates installed apps
**without a new app release** ("update the URL, not the release"). It is a data file, not landing-page
content: leave it out of any restyle, and don't delete or rename it. The schema + rationale live in
the repo's `DECISIONS.md` ("model catalog is DATA") and `ui/src/catalog.ts`.

## Preview locally

It's fully static — just open it, or serve the folder:

```bash
# either
open site/index.html            # macOS  (start site\index.html on Windows)
# or
cd site && python -m http.server 8000   # then visit http://localhost:8000
```

**The airplane-mode test:** open DevTools → Network, reload, and confirm every request is
same-origin (the HTML, CSS, JS, SVG — nothing else). Then go offline and reload; the page should
render exactly the same.

## Deploy (Cloudflare Pages)

Hosted on Cloudflare Pages, connected to this repo. One-time setup in the Cloudflare dashboard:

1. **Workers & Pages → Create → Pages → Connect to Git →** pick this repo (works with a **private** repo).
2. **Build command:** *(empty)* · **Build output directory:** `site` · **Framework preset:** none.
3. **Custom domains →** add `redactabit.com` (+ `www`); `_redirects` forwards `www` → apex.
4. **Web Analytics:** enable it on the project (cookieless, no code, no cookie banner) — this keeps the
   "zero third-party trackers" promise. Do **not** add Google Analytics here.

Pushes to `main` then auto-deploy. `models.json` is served at `https://redactabit.com/models.json`
— the desktop app's `MANIFEST_URL` (`ui/src/catalog.ts`), also allow-listed in `tauri.conf.json` CSP.

## TODOs

- **Download buttons** point at `…/redactabit/releases` for now. Once installers are published,
  point "Download for Windows" at the direct `.msi`/NSIS asset (or `…/releases/latest`). See the
  `TODO` comment in `index.html`.
- **Demo clip:** the before → after panel is a static placeholder. Record a short screen capture
  of a real redaction **with Wi-Fi visibly off** (the airplane-mode proof) and drop a
  `<video muted loop playsinline>` into the `.demo__card` — the layout already fits it.
- **Social image:** text Open Graph tags are in place; add a real PNG `og:image` (a hero or demo
  still) when there's one worth showing.
- **Docs:** the nav "Docs" link points at the repo README for now; it repoints to a real docs
  site once the app ships.
