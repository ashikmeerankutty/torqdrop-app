import { getAuth, onAuthStateChanged, signOut, type User } from "@react-native-firebase/auth";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

import { subscribeProfile, type UserProfile } from "@/lib/firebase/profile";

interface Session {
  user: User | null;
  /** True until Firebase has restored (or ruled out) a persisted user, and loaded their profile. */
  initializing: boolean;
  /** Name and email from `users/{uid}`; null until the user has filled them in. */
  profile: UserProfile | null;
}

const SessionContext = createContext<Session>({ user: null, initializing: true, profile: null });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  // Keyed by uid so a stale profile never shows for a different user.
  const [profile, setProfile] = useState<{ uid: string; value: UserProfile | null } | null>(null);

  useEffect(
    () =>
      onAuthStateChanged(getAuth(), (u) => {
        setUser(u);
        setAuthReady(true);
      }),
    [],
  );
  useEffect(() => (user ? subscribeProfile(user.uid, (value) => setProfile({ uid: user.uid, value })) : undefined), [user]);

  const profileReady = !user || profile?.uid === user.uid;
  const session: Session = {
    user,
    initializing: !authReady || !profileReady,
    profile: user && profile?.uid === user.uid ? profile.value : null,
  };
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  return useContext(SessionContext);
}

export function signOutUser(): Promise<void> {
  return signOut(getAuth());
}
