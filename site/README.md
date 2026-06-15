# Frisket — landing page (`site/`)

The marketing page for Frisket, hosted on GitHub Pages. One static page, no build step, no
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

`models.json` lives here only because GitHub Pages serves it for free at
`https://prpmdev.github.io/frisket/models.json`. The **desktop app** fetches it at runtime to learn
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

## Deploy (GitHub Pages)

Publishing is handled by [`.github/workflows/pages.yml`](../.github/workflows/pages.yml), which
uploads `site/` as the Pages artifact on every push to `main` that touches `site/`.

One-time setup: **repo → Settings → Pages → Build and deployment → Source → "GitHub Actions."**
After that, pushes auto-publish to `https://prpmdev.github.io/frisket/`.

### Moving to Cloudflare Pages later

Every path on the page is relative, so nothing needs editing. In Cloudflare Pages: connect the
repo, set **build command** empty and **output directory** to `site`. Done.

## TODOs

- **Download buttons** point at `…/frisket/releases` for now. Once installers are published,
  point "Download for Windows" at the direct `.msi`/NSIS asset (or `…/releases/latest`). See the
  `TODO` comment in `index.html`.
- **Demo clip:** the before → after panel is a static placeholder. Record a short screen capture
  of a real redaction **with Wi-Fi visibly off** (the airplane-mode proof) and drop a
  `<video muted loop playsinline>` into the `.demo__card` — the layout already fits it.
- **Social image:** text Open Graph tags are in place; add a real PNG `og:image` (a hero or demo
  still) when there's one worth showing.
- **Docs:** the nav "Docs" link points at the repo README for now; it repoints to a real docs
  site once the app ships.
