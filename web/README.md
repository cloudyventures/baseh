# baseh-web

The browser tools (capacity calculator and code designer) deployed to GitHub
Pages by `.github/workflows/pages.yml`.

- `npm test` — node:test suite (`tsx --test test/*.test.ts`)
- `npx tsc --noEmit` — typecheck (vite build alone strips types without checking)
- `npm run build` — vite production build into `dist/`

## Coupling to `js/`

`@cloudyventures/baseh` is a `file:../js` dependency so the tools track the
local source instead of the published npm package. Source-level imports still resolve through
the vite alias and tsconfig `paths` to `../js/src/index.ts`, so reorganizing
`js/src` breaks this package — update `vite.config.ts` and `tsconfig.json`
together if that layout changes.
