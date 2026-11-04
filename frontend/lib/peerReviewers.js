// Peer Reviewer picker order (2026-11-04): people with the submitter's own
// role first (a designer's work is best reviewed by a designer), then
// everyone else - each group by name. Display only: any Developer,
// Designer or DevOps user can still be picked (the backend rule is
// unchanged). Others get their role after the name so the split is clear.
const ROLE_LABELS = { developer: 'Developer', designer: 'Designer', devops: 'DevOps' };

export function peerReviewerOptions(people = [], me = {}) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const others = people.filter((p) => p.id !== me.id);
  const same = others.filter((p) => p.role === me.role).sort(byName);
  const rest = others
    .filter((p) => p.role !== me.role)
    .sort(byName)
    .map((p) => ({ ...p, name: ROLE_LABELS[p.role] ? `${p.name} (${ROLE_LABELS[p.role]})` : p.name }));
  return [...same, ...rest];
}
