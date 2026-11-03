/**
 * True if `url` is a Firebase email sign-in link, either the Hosting wrapper
 * (`/__/auth/links?link=...`) or the bare action link (`mode=signIn&oobCode=...`).
 * Pure so `+native-intent` can route on it before Firebase is ready.
 */
export function isEmailSignInUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const inner = parsed.searchParams.get("link");
  if (parsed.pathname === "/__/auth/links" && inner) return isEmailSignInUrl(inner);
  return parsed.searchParams.get("mode") === "signIn" && parsed.searchParams.has("oobCode");
}

/** Normalise an Indian mobile number to E.164 (`+91XXXXXXXXXX`), or null if it isn't a valid 10-digit mobile. */
export function toE164India(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  let local = digits;
  if (digits.length === 12 && digits.startsWith("91")) local = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) local = digits.slice(1);
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}
