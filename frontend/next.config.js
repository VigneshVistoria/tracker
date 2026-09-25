// distDir defaults to '.next' for local dev (npm run dev/build) - only
// deploy.sh ever sets NEXT_DIST_DIR, to build into a fresh, disposable
// directory instead of the one the live pm2 process is serving from.
// See scripts/build-frontend-atomic.sh and CLAUDE.md for why: writing a
// build in place, into the same directory a running process reads
// static assets from, is what caused the 2026-09 stale-chunk 404s - not
// just a missing restart, but the build itself mutating live files.
/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The Tracker SOP page briefly lived at /guides/developer (2026-09-25) -
  // keep old bookmarks working.
  async redirects() {
    return [{ source: '/guides/developer', destination: '/sop', permanent: true }];
  },
};

module.exports = nextConfig;
