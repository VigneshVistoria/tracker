// Phase 1 of the visual redesign (see ~/tracker/design-reference) is gated to
// these three roles only - Developer/QA/Designer/DevOps/Client must keep
// seeing the exact current design, unchanged, until that's revisited.
// To roll the new design out to everyone later, change this array (or
// delete the .includes() check at each call site) - nothing else in the
// app needs to change.
export const NEW_DESIGN_ROLES = ['admin', 'executive', 'program_manager'];

// Allowlist check, not a denylist - a missing/unrecognized role always
// falls through to `false` (old design), never the other way around.
export function isNewDesignRole(role) {
  return NEW_DESIGN_ROLES.includes(role);
}
