// Delta uploads (9.4 T1.6). A bot from 9.4 answers an upload with `knownRunRefs`: the runs of THAT upload it already held
// (a repeat, a confirmation, history only), so the companion records them as accepted and never sends them again. Only refs
// of the upload are listed, so the field is as small as the upload. An older bot never sends it (nothing changes), and an
// older companion ignores it.

const MAX_KNOWN = 1200;

/** The refs a run answer lists as already held (strings only, at most MAX_KNOWN). */
export function knownRunRefs(answer) {
  const list = Array.isArray(answer?.knownRunRefs) ? answer.knownRunRefs : [];
  return [...new Set(list.filter((ref) => typeof ref === "string" && ref.length > 0 && ref.length <= 200))].slice(0, MAX_KNOWN);
}

/** acceptedRunRefs of an answer plus its knownRunRefs, as one list (the accepted refs first). */
export function acceptedWithKnown(answer) {
  const accepted = Array.isArray(answer?.acceptedRunRefs) ? answer.acceptedRunRefs : [];
  const known = knownRunRefs(answer);
  if (!known.length) return accepted;
  return [...new Set([...accepted, ...known])];
}

/** The answer with knownRunRefs folded into acceptedRunRefs (the same object when it lists none). */
export function foldKnownRefs(answer) {
  if (!answer || typeof answer !== "object" || !knownRunRefs(answer).length) return answer;
  return { ...answer, acceptedRunRefs: acceptedWithKnown(answer) };
}
