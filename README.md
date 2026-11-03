# TorqDrop

> Know more about the car before you buy it.

TorqDrop is an Android app for used-car inspection and everyday car diagnostics. It combines a guided inspection checklist, live OBD-II data over Bluetooth, and AI that looks at photos and listens to the engine. Every AI result is a suggestion with its evidence attached; safety warnings come from fixed rules, never from AI.

## Features

**Engine sound check.** Record a 20-second guided video of the engine: idle, one gentle rev, back to idle. A multimodal model listens for knocks, ticks, squeals, whines and misfires, and watches for smoke and leaks. When an OBD adapter is connected, the app records rpm, load, throttle and fuel trims alongside the clip, so each sound is matched to what the engine was doing. Results show on a timeline over the rpm trace. The clip is deleted from the server right after analysis.

**Pre-purchase inspection.** A guided 200-point checklist, section by section, with a map of where each check is on the car. AI reviews photos for repaints, dents, leaks and flood signs; the inspector confirms or dismisses every suggestion. It reads RC and insurance documents, works offline, and ends in a signed report shared as a link or PDF.

**OBD-II diagnostics.** Connects to Bluetooth LE ELM327-compatible adapters. Live gauges, trouble codes in plain language, freeze frame and Mode 06 data, readiness monitors, automatic trip logging with fuel economy, and a garage with service reminders. Cars are matched by VIN, or by ECU fingerprint when the car doesn't report a VIN.

**No adapter?** A built-in simulated car runs every OBD feature with clearly labelled demo data.

## How it works

```
Expo / React Native app ──► Firebase Auth + App Check
  ├─ OBD stack (BLE → ELM327 → PID/DTC decoders)          ──► local SQLite (trips, garage, engine checks)
  ├─ Inspection checklist + photo upload queue            ──► Firestore + Cloud Storage (offline-first)
  └─ AI features ─► Cloud Functions (asia-south1) ─► Meta Model API (muse-spark)
                     · Zod-validated structured output
                     · deterministic safety floor applied after the model
                     · per-user daily quotas, usage and cost logged
```

- **App:** Expo SDK 58, React Native 0.88, Expo Router, TypeScript, `react-native-ble-plx`, `expo-camera`, `expo-sqlite`.
- **Backend:** Firebase (Auth, Firestore, Storage, Cloud Functions 2nd gen, App Check, Hosting).
- **AI:** Meta's OpenAI-compatible Model API, called only from Cloud Functions. Model output is validated with Zod; anything malformed is dropped, and drive-safety advice can only be raised by the model, never lowered below what the rules say.

| Folder | What's there |
| --- | --- |
| `app/` | Screens (Expo Router) |
| `components/` | UI components |
| `lib/obd/` | BLE transport, ELM327 session, PID and DTC decoding, simulated car, trip recorder |
| `lib/diagnostics/` | Rule-based safety checks |
| `lib/schemas/` | Zod schemas shared by the app and the functions |
| `functions/src/` | Cloud Functions: photo, document, live-data and engine-sound analysis, reports, billing |
| `tests/` | Unit tests (decoders, safety rules, schemas) and Firestore/Storage rules tests |

## Running it yourself

You need Node 22, an Android phone (BLE needs a development build, not Expo Go), and your own Firebase project on the Blaze plan.

1. `npm install` and `npm --prefix functions install`.
2. Create a Firebase project. Enable Phone and Email-link sign-in, Firestore and Storage in `asia-south1`, and App Check with Play Integrity. Add an Android app with package `com.torqdrop.connect` (or change it in `app.json`) and save its `google-services.json` in the project root.
3. Copy `.firebaserc.example` to `.firebaserc` and set your project ID.
4. Set the AI key and deploy the backend:
   ```bash
   npx firebase functions:secrets:set META_API_KEY
   npx firebase deploy --only functions,firestore,storage,hosting
   ```
5. Register an App Check debug token for development and put it in `.env` (see `.env.example`).
6. Build and run on a phone: `npx expo run:android`, or `npx eas-cli@latest init` then `npx eas-cli@latest build --profile development --platform android`.

### Tests

```bash
npm test            # unit tests
npm run test:rules  # Firestore and Storage rules, in the Firebase emulator
npx tsc --noEmit && npx expo lint
```

## Disclaimer

TorqDrop is an inspection assistant, not a mechanic. AI findings are suggestions to help decide what to check, and the app never claims a car is safe or free of defects.
