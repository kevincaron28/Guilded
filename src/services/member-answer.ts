// Explicit member-facing validation. Message length and localization must not
// turn an expected rejection into an automatic operational incident.
export class MemberAnswerError extends Error {}
