import { ApiError } from "./api";
import { t, type Lang } from "./i18n";

/**
 * The sentence to show for a failed request. The client's own messages ("Guilded could not be reached…", "The request
 * timed out…") and a server's 5xx are English, so in French they are replaced by a French sentence. A 4xx answer carries
 * the server's own explanation (a wishlist refusal, a bad pairing code): kept as written, the member needs the detail.
 * Anything that is not an ApiError shows `fallback`, never an engine message such as "Network request failed".
 */
export function errorText(error: unknown, lang: Lang, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return t(lang, "errOffline");
    if (error.status >= 500) return t(lang, "errServer");
    return lang === "fr" && error.status === 429 ? t(lang, "errBusy") : error.message || fallback;
  }
  return fallback;
}
