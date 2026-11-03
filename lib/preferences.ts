import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { Appearance } from "react-native";

/** How the person uses the app; picked once at first sign-in, changeable in Account. */
export type UsageMode = "inspector" | "owner";
export type ThemePreference = "dark" | "light" | "system";

interface Preferences {
  mode: UsageMode | null;
  theme: ThemePreference;
  /** Last name used to sign off, so inspectors don't retype it every time. */
  inspectorName: string;
  /** The intro pages before sign-in have been seen (or skipped) on this device. */
  introSeen: boolean;
}

const KEYS = { mode: "pref.mode", theme: "pref.theme", inspectorName: "pref.inspectorName", introSeen: "pref.introSeen" } as const;

// Read synchronously at startup so the first frame already has the right theme and route.
function load(): Preferences {
  const read = (key: string) => {
    try {
      return SecureStore.getItem(key);
    } catch {
      return null;
    }
  };
  const mode = read(KEYS.mode);
  const theme = read(KEYS.theme);
  return {
    mode: mode === "inspector" || mode === "owner" ? mode : null,
    theme: theme === "light" || theme === "system" ? theme : "dark",
    inspectorName: read(KEYS.inspectorName) ?? "",
    introSeen: read(KEYS.introSeen) === "1",
  };
}

let prefs = load();
const listeners = new Set<() => void>();

function set(patch: Partial<Preferences>) {
  prefs = { ...prefs, ...patch };
  listeners.forEach((l) => l());
}

/** Dark is the default look; the override also reaches native dialogs and the keyboard. */
export function applyTheme() {
  Appearance.setColorScheme(prefs.theme === "system" ? "auto" : prefs.theme);
}

export function setTheme(theme: ThemePreference) {
  SecureStore.setItem(KEYS.theme, theme);
  set({ theme });
  applyTheme();
}

export function setMode(mode: UsageMode) {
  SecureStore.setItem(KEYS.mode, mode);
  set({ mode });
}

export function setIntroSeen() {
  SecureStore.setItem(KEYS.introSeen, "1");
  set({ introSeen: true });
}

export function setInspectorName(inspectorName: string) {
  SecureStore.setItem(KEYS.inspectorName, inspectorName);
  set({ inspectorName });
}

/** Forgets this person's choices on the device; theme and the seen intro stay. */
export function clearPersonalPreferences() {
  for (const key of [KEYS.mode, KEYS.inspectorName]) {
    try {
      SecureStore.deleteItemAsync(key);
    } catch {}
  }
  set({ mode: null, inspectorName: "" });
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => prefs,
  );
}
