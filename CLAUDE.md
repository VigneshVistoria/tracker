# Deploying on this server

This box runs the live app directly (`tracker-backend` / `tracker-frontend` under pm2, proxied by nginx at tracker.vistoriasystems.com) - there is no separate CI/deploy pipeline. Code is edited in place here.

After changing backend and/or frontend code, deploy with:

```
./deploy.sh
```

Do not run `npm run build` by itself and stop there - a build with no matching `pm2 restart` leaves the running process serving stale chunk/route manifests while the new build's files are on disk, which 404s the frontend into a blank page (this happened on 2026-09-02). `deploy.sh` builds both apps and restarts both pm2 processes together so a build can never land without its restart.
