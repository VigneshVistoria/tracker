# Deploying on this server

This box runs the live app directly (`tracker-backend` / `tracker-frontend` under pm2, proxied by nginx at tracker.vistoriasystems.com) - there is no separate CI/deploy pipeline. Code is edited in place here.

After changing backend and/or frontend code, deploy with:

```
./deploy.sh
```

Do not run `npm run build` by itself and stop there - a build with no matching `pm2 restart` leaves the running process serving stale chunk/route manifests while the new build's files are on disk, which 404s the frontend into a blank page (this happened on 2026-09-02). `deploy.sh` builds both apps and restarts both pm2 processes together so a build can never land without its restart.

**Never run a bare `npm run build` inside `frontend/`, even by hand for a quick check.** The 2026-09-02 fix above wasn't the whole story - the same class of stale-chunk 404 (`buildManifest.js`/`_ssgManifest.js` 404s, "Loading failed for script") recurred afterward even with the restart-pairing rule in place. Root cause: a plain `next build` writes its output **in place**, directly into `frontend/.next` - the exact directory the *currently running* `tracker-frontend` process is serving `/_next/static/...` requests from, live, for the entire build. Any real request landing mid-build could 404 or get a half-written file, and an interrupted build (dropped SSH session, crashed terminal) could leave `.next` permanently half-written.

Fixed by making the frontend build atomic (`scripts/build-frontend-atomic.sh`, called from `scripts/build-and-restart.sh`): every build writes into a fresh `frontend/.next-builds/<timestamp>/` directory - the live `.next` symlink's target is never touched while a build is running - and only swaps `.next` to point at the new build via a single atomic rename once the build has fully succeeded. If a build fails or gets killed partway, the live site keeps serving the last good build untouched; verified by hammering the live site with requests during a real build (zero errors) and by killing a build mid-run (symlink and site completely unaffected). Old build directories are pruned automatically, keeping the last 3.

**This is exactly why a bare `npm run build` is now more dangerous, not less:** once `.next` is a symlink (which it is after the first atomic build), a manual build with no `NEXT_DIST_DIR` set writes straight through that symlink into whatever it currently points at - i.e. the live build - recreating this exact bug. Always go through `./deploy.sh`.

Separately, `pages/_app.js` installs a client-side chunk-load-error handler (`lib/chunkErrorRecovery.js`) that auto-reloads a tab if it fails to load a stale asset reference - this covers a *different*, unavoidable case atomic builds can't fix: a browser tab left open from before a deploy still has old HTML referencing the old build's buildId, and that old buildId's files stop existing the moment a newer build goes live. Not a deploy-process bug, just how Next.js versions its output.

See `PROJECT.md` §4 for the full technical writeup.
