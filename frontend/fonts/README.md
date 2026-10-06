# Self-hosted fonts

Loaded by `pages/_app.js` via `next/font/local`, so production builds never
need to reach Google Fonts.

| File | Family | Weights | Licence |
|---|---|---|---|
| `Inter-Variable-latin.woff2` | Inter (body text) | 100–900 variable | SIL OFL 1.1 (`OFL-Inter.txt`) |
| `PlusJakartaSans-Variable-latin.woff2` | Plus Jakarta Sans (headings, big numbers) | 200–800 variable | SIL OFL 1.1 (`OFL-PlusJakartaSans.txt`) |

Both are the Latin-subset files Google Fonts serves (fetched 2026-10-06:
Inter v20, Plus Jakarta Sans v12). To update, download the current Latin
`.woff2` from the Google Fonts CSS for each family and replace the file.
