# GB Tool Suite development

The editor repository is a standalone Svelte 5/Vite multi-page application. Its
only deployment artifact is the checked-in `docs/` directory, so GitHub Pages
can publish it directly with no server runtime.

## Prerequisites and setup

Use Node.js 20.19 or newer and npm. The current devcontainer supplies Node LTS,
installs the locked dependencies, and installs Playwright Chromium.

```bash
npm ci
npx playwright install --with-deps chromium  # once outside the devcontainer
```

When this repository is checked out as `dmg-wispbound/editor`, the parent image
already contains Node/npm and Playwright browser libraries. Run commands from
the parent with `npm --prefix editor <command>`.

## Commands

- `npm run dev` starts Vite with hot reload.
- `npm run check` checks the Svelte/component layer and project configuration.
- `npm run test` runs fast unit tests.
- `npm run build` replaces `docs/` with a GitHub Pages-ready production build.
- `npm run test:e2e` runs browser workflows against the built `docs/` output.
- `npm run test:all` runs the complete validation sequence.

## Architecture

Vite has nine HTML inputs at the repository root, one for the landing page and
one for each historical tool URL. Each input mounts `LegacyToolPage.svelte`,
which owns the common page shell and initializes its tool engine after the DOM is
ready. `ToolHeader.svelte` and `ToolMenu.svelte` are shared by every page, and
`src/config/tools.js` is the sole navigation registry.

The mature editor/generator engines live in `src/legacy/`. They were extracted
without algorithm changes so project formats, deterministic audio generation,
canvas rendering, and image output remain compatible. New shared browser helpers
belong in `src/lib/`; reusable UI belongs in `src/components/`. Page-specific
styles live in `src/styles/pages/`, while `src/styles/theme.css` owns tokens and
generic controls.

The legacy modules are intentionally excluded from JavaScript inference in
`svelte-check`; they use dynamic DOM shapes that TypeScript cannot infer. They
are still parsed and bundled by Vite and covered through the browser suite. New
framework and shared code should remain check-clean.

## Editing and deployment

Never hand-edit generated `docs/*.html` or `docs/assets/*`. Make source changes,
run `npm run test:all`, and commit both source changes and rebuilt `docs/`. The
Vite base is relative, so the result works at a GitHub project subpath as well as
at an origin root. Static files belong in `public/`; Vite copies them into
`docs/` during each clean build.

Preserve the public filenames and JSON schemas. Image handoff uses same-origin
`sessionStorage`, so cross-tool links must remain relative and all pages must be
served from one origin.
