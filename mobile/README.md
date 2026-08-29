# Tracker Mobile (V1)

Native app covering one flow: log in, take/choose a photo, run on-device
OCR to pre-fill the ticket description, pick an assignee, submit. Talks
directly to the existing production API at
`https://tracker.vistoriasystems.com/api` - no backend changes were
needed for this flow (see the investigation notes for why).

## Stack

- Expo (managed workflow) + React Native + TypeScript
- `expo-image-picker` for camera/photo library access
- `@react-native-ml-kit/text-recognition` for on-device OCR (offline, free)
- `expo-secure-store` for the JWT (Keychain/Keystore-backed, not
  `localStorage`/`AsyncStorage`)

Because `@react-native-ml-kit/text-recognition` is a native module, this
app **cannot run inside the plain Expo Go app** from the app store - it
needs a custom dev client (or a full build). That's expected and is why
building via EAS is the path, not `expo start` + Expo Go alone.

## Before testing

The account you log in with must have a role allowed to create tickets
(Admin, Program Manager, QA, Executive, or Client) - the backend
rejects ticket creation from a Developer account with a 403, by design
(see `IssuesService.ROLES_ALLOWED_TO_CREATE_TICKETS`).

## Building an installable APK (EAS Build)

Run from any machine with Node.js - the actual native build happens on
Expo's servers, not locally, so this doesn't need Android Studio/SDK
anywhere:

```bash
cd mobile
npx eas-cli login              # or: export EXPO_TOKEN=<personal access token>
npx eas-cli build:configure    # links this project to your Expo account, fills in app.json's projectId
npx eas-cli build --platform android --profile preview
```

That prints a build page URL; once it finishes (a few minutes, queued
on Expo's infrastructure) it gives a QR code and a direct APK download
link. Scan it on the Android phone you want to test with, or download
the APK and install it directly (enable "install from unknown sources"
once, Android will prompt for this automatically on first install).

## Known V1 limitations (see the investigation report for full detail)

- OCR output is a starting point, not final - the description field is
  editable before submit, since phone-photo OCR is never perfect.
- Session expires after 1 day (same JWT lifetime as the web app) with
  no refresh-token flow yet - re-login is required after that, by design
  for V1.
- Android only for now - iOS build/testing needs a paid Apple Developer
  account, deliberately deferred.
- The photo itself is not uploaded/stored anywhere - only the OCR'd
  text reaches the ticket, matching the spec as written. Attaching the
  original photo to the ticket would need a new backend upload endpoint
  and storage backend - out of scope unless requested.
