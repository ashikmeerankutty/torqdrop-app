import { isEmailSignInUrl } from '@/lib/auth/links';

// Email sign-in links arrive as https App/Universal Links with no matching route.
// Send them to the screen that completes sign-in, carrying the full link.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (isEmailSignInUrl(path)) {
    return `/finish-sign-in?link=${encodeURIComponent(path)}`;
  }
  return path;
}
