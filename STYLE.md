# STYLE.md — Design & Accessibility Standards

This project targets international-standard UI quality, not just a modern
look. "Bold and colorful" is not the bar — WCAG 2.1 AA compliance,
i18n-readiness, a real spacing/type system, and first-class responsive
behavior are. Reference points for what "designed, not styled" looks like:
Material Design 3, IBM Carbon, Atlassian Design System — all open,
documented, and built under these same constraints.

## 1. Accessibility (WCAG 2.1 AA baseline)

- **Contrast**: text-to-background ≥ 4.5:1 (≥ 3:1 for large text /
  18px+ bold). Check every `--ds-text-*` / `--ds-bg-*` pairing introduced
  in a theme (`frontend/styles/tokens.css`) against the surface it's
  actually painted on — this is the #1 way "vibrant" redesigns fail.
  The `warm` theme already documents one such fix (`--ds-text-link` uses
  primary-700, not 600, because raw accent orange fails on white) —
  follow that pattern for new themes/colors.
- **Keyboard**: every interactive element (buttons, tabs, menu items,
  icon-only actions) must be reachable via Tab and operable via
  Enter/Space, in a sensible DOM order. No `onClick`-only `<div>`s.
- **Focus states**: must be visible, not suppressed. Use
  `--ds-shadow-focus` / `--ds-border-focus` — don't ship
  `outline: none` without a replacement.
- **Labels/ARIA**: icon-only buttons need `aria-label`; status badges
  (`components/ui/Badge.js`, `SlaBadge.js`, `StatusLight.js`) need
  either visible text or `role="status"`/`aria-label` so the state isn't
  color-only. Color must never be the sole signal — pair every
  success/warning/error tint with an icon or text label.

## 2. Internationalization readiness

Not shipped yet in this codebase — no i18n library is wired in. Until
one is, don't make the gap worse:

- Don't hardcode new user-facing strings deep inside logic in a way
  that resists later extraction — keep copy in plain JSX text/props,
  not string-concatenated or computed, so a future `next-intl` pass is
  a mechanical swap.
- Use locale-aware formatting helpers for dates/numbers instead of
  manual string building, and centralize them (see
  `frontend/lib/developerTaskStats.js` and any date-formatting helpers)
  rather than re-implementing per component.
- Leave room for text growth in layouts (buttons, nav labels, table
  headers) — don't hard-clip to the exact pixel width of the current
  English string. ~30% extra is the standard rule of thumb (German).
- If/when RTL support becomes a requirement, this depends on layouts
  using logical properties (`margin-inline-start` etc.) over
  directional ones (`margin-left`) — not required today, but avoid
  adding new directional hacks that would be expensive to reverse.

## 3. Spacing & type system

`frontend/styles/tokens.css` already defines the canonical scale — use
it, don't invent new values in component CSS.

- **Spacing**: strict 4px grid via `--ds-space-1` (4px) through
  `--ds-space-16` (64px). Themes may override the scale's values (see
  `warm` theme's roomier overrides) but every component must consume
  the token, never a literal pixel value.
- **Type**: `--ds-text-xs` (12px) through `--ds-text-3xl` (30px), paired
  with `--ds-weight-*` and `--ds-leading-*`. Pick from this scale; don't
  set one-off `font-size`/`line-height` per page.
- **Radius/elevation/motion**: same rule — `--ds-radius-*`,
  `--ds-shadow-*`, `--ds-transition-*` are the only values to reach for.
- Legacy `--space-*`/`--color-*` in `globals.css` are aliases kept for
  pre-redesign pages; new/updated components should target the `--ds-*`
  tokens directly, not the legacy names.

## 4. Responsive behavior

Define breakpoints up front per component, not by testing after the
fact. Current usage in this codebase is ad hoc (`900px` in
`appshell.module.css`, `640/660/700/860/1024px` scattered across
`issues.module.css`) — new work should converge on a shared scale
rather than adding another one-off value:

- **Mobile**: ≤ 640px
- **Tablet**: 641px–1024px
- **Desktop**: 1025px+

When a page/component needs a breakpoint, use the closest value above
instead of picking a new number, and note in a comment if a value
genuinely can't fit the scale (e.g. matching an existing sidebar
collapse width).

## Applying this

- New components: build against `--ds-*` tokens from the start; check
  contrast on every theme (`light` in `:root`, `dark`, `terminal`,
  `warm`) since this app supports theme switching.
- Existing pages being touched for other reasons: don't do a drive-by
  full migration, but don't add new hardcoded values either.
- See `PROJECT.md` for the broader technical writeup of the app; this
  file is scoped to visual/accessibility/i18n/responsive standards only.
