// Rejects secure hooks on Blizzard *Mixin tables (used by both addon validators).
// hooksecurefunc(SomeMixin, "Method", ...) writes an insecure wrapper into the mixin; every frame
// later built from it copies that tainted method, and Blizzard UI code then hits
// ADDON_ACTION_FORBIDDEN (9.0.4: CommunitiesMemberListEntryMixin.OnEnter blocked the guild roster
// on every login). Hook the frames themselves instead: frame:HookScript("OnEnter", fn), for
// ScrollBox lists through ScrollUtil.AddInitializedFrameCallback. Secure hooks on plain global
// functions (hooksecurefunc("GuildRosterButton_OnEnter", fn)) stay allowed.
const PATTERNS = [
  // hooksecurefunc(CommunitiesMemberListEntryMixin, "OnEnter", fn), Some.Thing.FooMixin, and a
  // local wrapper such as hook(SomeMixin, "OnEnter") (how 9.0.3 did it)
  /\b\w*[Hh]ook\w*\s*\(\s*[A-Za-z_][\w.]*Mixin\b/,
  // pcall(hooksecurefunc, SomeMixin, ...)
  /\bpcall\s*\(\s*hooksecurefunc\s*,\s*[A-Za-z_][\w.]*Mixin\b/,
];

// The 1-based line numbers of offending calls (comments ignored).
export function mixinHookLines(source) {
  const lines = String(source).replaceAll("\r\n", "\n").split("\n");
  const bad = [];
  lines.forEach((line, index) => {
    const code = line.replace(/--.*$/, "");
    if (PATTERNS.some((pattern) => pattern.test(code))) bad.push(index + 1);
  });
  return bad;
}

export function validateMixinHooks(source, file) {
  const bad = mixinHookLines(source);
  if (bad.length) {
    throw new Error(`${file}:${bad.join(",")}: hooksecurefunc on a Blizzard *Mixin table taints every frame made from it (ADDON_ACTION_FORBIDDEN). Hook the frame instead: frame:HookScript("OnEnter", fn), via ScrollUtil.AddInitializedFrameCallback for ScrollBox lists.`);
  }
}
