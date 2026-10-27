import { createHash } from "node:crypto";

const OMITTED = "[redacted]";
function secretValues(): string[] {
  return Object.entries(process.env).filter(([key,value])=>/token|secret|password|cookie|session|database_url|dsn|api_?key|private_?key|connection_?string/i.test(key) && value && value.length>=6)
    .map(([,value])=>value!);
}

/** Redact before truncation. No network/file reads; attachment contents are never inspected. */
export function redactDiagnosticText(input: unknown, limit=2000, secrets: readonly string[]=secretValues()): string {
  let text=typeof input==="string" ? input.slice(0,65536) : "[non-text diagnostic omitted]";
  for(const value of [...secrets].filter(v=>v.length>=6).sort((a,b)=>b.length-a.length)) {
    for(const encoded of [value,encodeURIComponent(value),JSON.stringify(value).slice(1,-1)]) text=text.split(encoded).join(OMITTED);
  }
  text=text.replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)/gi,OMITTED)
    .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=][^\r\n]*/gi,`credential: ${OMITTED}`)
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9+/_.=-]+/gi,`credential: ${OMITTED}`)
    .replace(/\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s<>"']+/gi,"[URL removed]")
    .replace(/\b[a-z][a-z0-9+.-]{1,20}%3a%2f%2f[^\s<>"']+/gi,"[URL removed]")
    .replace(/\b(?:token|access[_-]?token|refresh[_-]?token|id[_-]?token|session(?:[_-]?id)?|api[_-]?key|client[_-]?secret|password|passwd|secret|credential|pairing[_-]?code)\b["']?\s*[:=]\s*(?:"[^"\r\n]*(?:"|$)|'[^'\r\n]*(?:'|$)|[^\s,;&}\r\n]+)/gi,`credential=${OMITTED}`)
    .replace(/\b(?:mfa\.[\w-]{20,}|[\w-]{20,}\.[\w-]{6}\.[\w-]{20,}|(?:gh[pousr]_|github_pat_|sk-)[\w-]{16,}|eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+)\b/g,OMITTED)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,"[identifier removed]")
    .replace(/(?:[A-Za-z]:\\|\\\\)[^\r\n<>"']+/g,"[local path removed]")
    .replace(/\/(?:home|Users|root|tmp|var)\/[^\s<>"']+/g,"[local path removed]")
    .replace(/\b(?:request[_-]?body|response[_-]?body|payload|body|content|private[_-]?chat|transcript|savedvariables)\b["']?\s*[:=][\s\S]*/gi,"[payload removed]")
    .replace(/data:[^\s]+/gi,"[embedded file removed]")
    .replace(/<@!?\d+>|<@&\d+>|@everyone|@here/g,"[mention removed]");
  return text.slice(0,Math.max(0,Math.min(limit,65536)));
}

/** Automatic failures never retain arbitrary exception messages, request bodies
 * or serialized objects. Class/code and basename+line frames identify the fault. */
export function automaticDiagnostic(error: unknown): {message:string;stack:string|null} {
  const value=error instanceof Error ? error : null;
  const name=value && /^[A-Za-z][A-Za-z0-9]{0,39}(?:Error|Exception)$|^Error$/.test(value.name) ? value.name : "UnknownError";
  const rawCode=value && "code" in value ? String(value.code) : "";
  const code=/^(?:P\d{4}|E[A-Z]{2,25}|\d{1,6})$/.test(rawCode) ? ` code=${rawCode}` : "";
  const frames=(value?.stack??"").split("\n").slice(1).flatMap(line=>{
    const match=/([A-Za-z0-9_.-]+\.(?:[cm]?[jt]s)):(\d+):(\d+)\)?$/.exec(line.trim());
    return match ? [`${match[1]}:${match[2]}:${match[3]}`] : [];
  }).slice(0,12);
  const stack=frames.length ? redactDiagnosticText(frames.join("\n"),2000) : null;
  const fingerprint=createHash("sha256").update(`${name}${code}\n${stack??"no-frame"}`).digest("hex").slice(0,12);
  return {message:`${name}${code} [error:${fingerprint}]`,stack};
}

export function approvedDiagnosticFields(value: unknown): Record<string,string|number> {
  if(!value || typeof value!=="object") return {};
  const input=value as Record<string,unknown>, result:Record<string,string|number>={};
  for(const name of ["addonVersion","companionVersion"] as const) if(typeof input[name]==="string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(input[name])) result[name]=input[name];
  for(const name of ["build","interface","routeId","encounterId"] as const) if(Number.isInteger(input[name]) && Number(input[name])>0 && Number(input[name])<10_000_000) result[name]=Number(input[name]);
  if(["forever","classic-era","classic-tbc","classic-mists","retail"].includes(String(input["edition"]))) result["edition"]=String(input["edition"]);
  if(["ENCOUNTER_START","ENCOUNTER_END","BOSS_KILL","PLAYER_ENTERING_WORLD","RELOAD_GAP","RESET_REQUESTED","RESET_OBSERVED","UNKNOWN"].includes(String(input["event"]))) result["event"]=String(input["event"]);
  if(["native","unavailable","restricted","unknown"].includes(String(input["capability"]))) result["capability"]=String(input["capability"]);
  if(["NATIVE_EVENT_UNAVAILABLE","PARTIAL_RUN","UNKNOWN_PRESENCE","RELOAD_GAP","ROLE_MIXED","UPLOAD_REJECTED","UNKNOWN"].includes(String(input["reason"]))) result["reason"]=String(input["reason"]);
  return result;
}

export function installDiagnosticConsole(target:Pick<Console,"error"|"warn">=console): ()=>void {
  const original={error:target.error,warn:target.warn};
  for(const method of ["error","warn"] as const) target[method]=(...args:unknown[])=>original[method].call(target,...args.map(arg=>
    arg instanceof Error ? automaticDiagnostic(arg) : typeof arg==="string" ? `[diagnostic:${createHash("sha256").update(arg).digest("hex").slice(0,12)}]` : "[value omitted]"));
  return ()=>{target.error=original.error;target.warn=original.warn;};
}
