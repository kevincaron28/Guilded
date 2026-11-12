/** One version visitors can trust. CurseForge file ids stay with CF1.
 * When the two published versions still differ, say so instead of printing both numbers.
 * @param {{ github?: string, curseforge?: string, verifiedAt?: string }} release
 */
export function releaseLine(release) {
  const version = typeof release.github === "string" ? release.github : "";
  const date = typeof release.verifiedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(release.verifiedAt) ? release.verifiedAt : "";
  const curseforge = typeof release.curseforge === "string" ? release.curseforge : "";
  return { version, date, lag: version !== "" && curseforge !== "" && curseforge !== version };
}
