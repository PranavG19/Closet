// Optional standalone Expo entry for the screenshot harness. The sanctioned way to
// launch the harness is `pnpm start:harness` (see package.json), which sets
// EXPO_PUBLIC_HARNESS=1 so the package's real index.ts registers HarnessApp instead of
// App — the default entry is never changed. This file exists so a tool can also point
// Expo directly at the harness root if needed.
import { registerRootComponent } from 'expo';
import { HarnessApp } from './HarnessApp.js';

registerRootComponent(HarnessApp);
