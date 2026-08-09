# 07 — UI state (observed, not asserted)

*The current visual state of the Expo app, derived from the 17 simulator screenshots committed at `ab25513`. This doc exists because `CLAUDE.md` Rule 3 makes a real simulator screenshot the only acceptable oracle for UI, and until `ab25513` there was none — every prior UI claim in this repo was an assertion. Everything below is read off a PNG or off a line of code, both cited.*

**Scope note.** This describes the app **as it renders today**, defects included. It is not a design spec — `docs/03-design-system.md` is the intent. Where the two disagree, `docs/03` says what we want and this doc says what we have.

---

## 1. Headline: the app boots and renders

Previously unknown. `docs/LAUNCH-READINESS.md` (2026-08-07 edition) stated "no screen has ever been rendered on a real device or simulator." That is now false.

What the captures establish:

- The Expo app **launches** (`app.json` + `metro.config.js` + `index.ts` → `registerRootComponent(App)`, all landed in `e51507f`).
- The **session gate resolves**: `src/App.tsx`'s `RootGate` checks `loading` first, then renders `SignInScreen` or `NavShell` (`chooseRootView` in `src/session/gate.ts`).
- `NavShell` renders **6 tabs** from `features/navigation/tabs.ts`: Closet · Today · Outfits · Laundry · Membership · Account.
- Every screen's **loading / empty / populated / error** states are real and reachable — the `Screen` / `Card` / `Text` / `Button` / `LoadingState` / `ErrorState` / `AvailabilityChip` primitives all render from `useTokens()`.
- The **two-step account deletion** arms correctly, which matters because it is the Apple 5.1.1(v) surface a reviewer must find.

The app renders against `.invalid` placeholder config, not a real backend. `src/api/config.ts` supplies `https://placeholder.supabase.invalid` + a fake anon key **only when `__DEV__`**, precisely so the tree mounts with no project provisioned; a release build still throws on a missing key. So every "populated" screenshot below is **fixture data**, not real data.

---

## 2. Screenshot inventory (17)

```
ls packages/mobile/screenshots/ | wc -l      # → 17
```

| File | What it shows | Notable |
|---|---|---|
| `signin-default.png` | `SignInScreen` — "Your closet, finally organised", the on-device privacy line, `Continue with Apple` (pink filled) + `Continue with Google` (outline), and the export/delete footnote | **The only screen with no title collision** — it has no screen title, so nothing sits under the Dynamic Island. Also the best-composed screen in the set. |
| `wardrobe-empty.png` | "Your closet is empty" + `Add clothing` | The `Add clothing` action has no destination (F1 absent). |
| `wardrobe-populated.png` | 2×2 grid, 4 fixture garments, each with a category well + name + `Ready to wear` chip | Title "Your clos⬛" clipped by the Island. Cutout wells are empty grey boxes labelled `top`/`bottom`/`dress`/`outerwear` — **there are no real cutouts** because parse has never run. |
| `wardrobe-error.png` | "Something went sideways / We couldn't load your closet." + `Try again` | The error state is calm and on-brand (`docs/03` §"Every state is designed"). Genuinely good. |
| `suggestions-populated.png` | "Today" — hero card, `Ivory silk blouse`, "This pairs beautifully with your neutrals.", pink `I wore this` | The one working mutation on this screen. **No weather anywhere** — F5's weather bias is unimplemented. |
| `suggestions-error.png` | Suggestions error state | — |
| `outfits-empty.png` | "No outfits yet" + `Build an outfit` | **The button is dead** (`OutfitsScreen.tsx:27` → `onAction={() => {}}`). A visible dead end. |
| `outfits-populated.png` | 3 fixture outfits: Monday meetings · Dinner out · Untitled look | List surface only; no builder canvas. |
| `outfits-error.png` | Outfits error state | — |
| `laundry-empty.png` | Laundry empty state | — |
| `laundry-populated.png` | 2 items `In the wash` + `Mark clean` each | F7's only wired transition. Note the copy is correctly kind ("In the wash", not "DIRTY") per `docs/03` §Tone. |
| `laundry-error.png` | Laundry error state | — |
| `paywall-offer.png` | "Go premium" + 3 value bullets + pink `Subscribe` + "Billed through the App Store." | **NO PRICE.** See §4 defect 1. |
| `paywall-member.png` | "You're a member / Thank you — every feature is unlocked." | Worst safe-area case: the card sits **under** the status bar, title half-eaten. |
| `paywall-error.png` | Membership error state | — |
| `account-default.png` | "Profile" · Signed in as `qa@example.invalid` · `Sign out` · Your data + `Export my data` · Delete my account + the store-subscription caveat + `Delete my account` | The GDPR + 5.1.1(v) surface. Copy is accurate and specific. |
| `account-delete-armed.png` | Armed delete: "Type DELETE to confirm", the field containing `DELETE`, red `Permanently delete everything`, `Keep my account` | **`Sign out` is clipped to a sliver at the top edge** — the screen is scrolled and there is no inset. |

**These are diagnostic captures, not store assets** (see defect 6). `content/store/screenshot-plan.md` must be shot fresh after the §4 fixes.

---

## 3. What the screenshots do NOT show

Stated explicitly so their absence is not read as coverage:

- **F1 — nothing.** No scan screen, no processing animation, no reveal, no cutouts. `docs/03` calls the reveal "the emotional peak — design it as the hero moment"; it has no code, so it has no pixels. There is no `features/onboarding/` directory.
- **B1 — nothing.** No swatch quiz; no `features/palette/`.
- **Real cutouts** — every garment well is an empty labelled box. Parse has never produced an image.
- **Real data** — fixture only, against `.invalid` config.
- **Android** — iOS only. `CLAUDE.md` §Simulators: never both at once, iOS first.
- **"Does it feel premium"** — that is owner taste and is not capturable here.
- **Dynamic type / reduced motion** — never exercised; both are structurally absent (`git grep -n 'allowFontScaling\|AccessibilityInfo' -- packages/mobile` → 0 hits).

---

## 4. Confirmed defects

Ordered by consequence. Each is visible in a named PNG **and** traced to a line of code.

### 1. The paywall shows no price — App Store Guideline 3.1.2 rejection

`paywall-offer.png`: three bullets, a `Subscribe` button, "Billed through the App Store. No hidden charges." No number anywhere.

`features/monetization/PaywallScreen.tsx` has no price string, and `:71` is `onPress={() => {}}`. There is no `react-native-purchases` dependency (`git grep -n react-native-purchases` → 0 hits). The screen's own header comment (`:3-6`) is honest that the purchase call is "intentionally NOT wired."

Apple requires price, duration, and renewal terms on the purchase surface. **A reviewer rejects this build.** The price is an owner decision (needs a real App Store product); the *display* is agent work once the number exists.

### 2. No safe-area inset — every screen title collides with the Dynamic Island

Visible in 11 of 17: "Your clos⬛" · "Go prem⬛" · "Profi⬛e" · "Tod⬛y" · "Lau⬛dry" · "Out⬛its". Worst in `paywall-member.png` (card under the status bar) and `account-delete-armed.png` (`Sign out` clipped to a sliver).

Root cause, and the code says it outright — `src/ui/Screen.tsx:4-6`:

> *"Safe-area insets are intentionally deferred: they arrive with the real navigation library (see features/navigation), which owns the inset context; this primitive stays dependency-light for the scaffold."*

`git grep -n SafeArea -- packages/mobile` → **0 hits.** The deferral was a defensible scaffold decision; the screenshots are the evidence that it can no longer be deferred. Fix on `Screen` (or with the nav library, whichever lands first) — and **re-capture to confirm**, since this is exactly the class of defect that reasoning misses and a photograph catches.

### 3. The "Membership" tab label wraps mid-word

"Membersh / ip" in all 16 shots showing the tab bar. `features/navigation/tabs.ts:19` sets `label: 'Membership'` (deliberately relabelled from "Profile" so it is not confused with the identity tab). `NavShell.tsx:34` gives each tab `flex: 1`, and `Text` is rendered with no `numberOfLines` — 6 equal-width tabs cannot fit 11 characters at `caption` size (13pt, `tokens.ts:187`).

Either shorten the label (e.g. "Premium", "Plan") or set `numberOfLines={1}` + `adjustsFontSizeToFit`. Shortening is simpler and reads better.

### 4. Seven of ten foreground colour tokens fail WCAG AA

`docs/03` §Accessibility: *"WCAG AA contrast for text and meaningful UI"* — listed under "baseline, non-negotiable." Computed from `src/tokens/tokens.ts:131-152`:

| Foreground | on `bg.canvas` #FBFAF9 | on `bg.surface` #FFFFFF | on `bg.sunken` #F3F1EF | Verdict |
|---|---|---|---|---|
| `text.primary` #1A1A1A | 16.69 | 17.40 | 15.45 | pass |
| `text.secondary` #5C5A57 | 6.59 | 6.87 | 6.10 | pass |
| **`text.tertiary` #9A9793** | **2.79** | **2.91** | **2.58** | **FAIL** (needs 4.5; fails 3.0 too) |
| **`accent.pink` #E8709A** | **2.79** | **2.91** | **2.58** | **FAIL** — the primary brand accent |
| **`accent.red` #D8483F** | **4.10** | **4.27** | **3.79** | **FAIL** as text (passes 3.0 large only) |
| **`accent.blue` #5A8FC7** | **3.26** | **3.39** | **3.01** | **FAIL** as text |
| **`state.clean` #6FA98A** | **2.61** | 2.72 | 2.42 | **FAIL** — sub-3.0 even as a non-text indicator |
| **`state.dirty` #C9A96A** | **2.15** | 2.24 | 1.99 | **FAIL** |
| **`state.unavailable` #B7B4B0** | **1.98** | 2.07 | 1.83 | **FAIL** |

Plus **`text.onAccent` #FFFFFF on `accent.pink` = 2.91** — the filled `Button`'s own label. That is the `Subscribe` label in `paywall-offer.png` and the `I wore this` label in `suggestions-populated.png`.

**This is a real accessibility defect in the palette, not a doc error.** `docs/03` is only "wrong" because the code is. The `docs/03` mitigation for the *state* colours — "never encode meaning in hue alone… icon + label" — is real and **is** honored (`src/ui/AvailabilityChip.tsx` renders a dot + text label), but that addresses colour-blindness, not contrast.

`docs/03` §Open does disclose that exact hex values are provisional, so the intent was always to revise. The revision now has a numeric target.

**Recompute after any palette change** (this is the exact snippet used above — sRGB relative luminance, WCAG 2.x):

```js
const lum = (hex) => {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
```

### 5. No typeface is set at all

**FIXED IN CODE (not re-captured).** Was `family: undefined`, with `Text.tsx` spreading `fontFamily` conditionally — so the app shipped with no typeface set and nothing could tell. `typography.family` is now REQUIRED (`string`, not `string | undefined`) and set to `'System'` (SF Pro on iOS, Roboto on Android). The screenshots still show the same rendering, because the platform default IS what `'System'` resolves to — the change is that the absence is no longer representable.

`docs/03` §Typography asks for "a modern humanist/geometric sans; one family, a small weight range" and §Open lists the typeface as unfinalized — so this is a *disclosed* gap, not a lie. The real problem is that **nothing fails when `family` is still `undefined` at ship.** Related and undisclosed: `docs/03` also requires tabular-aligned numbers, and there is no `fontVariant` anywhere in `tokens.ts` or `src/ui/Text.tsx`.

### 6. A blue gear button floats over every screen — and it is NOT our app

Top-right in all 17 shots. `git grep -niE 'gear|settings|FloatingAction' -- packages/mobile` → **0 hits.** It is a simulator-level overlay (accessibility / QuickAction), not closet-app UI.

Harmless as a rendering matter, load-bearing as an *evidence* matter: **these 17 PNGs contain a foreign UI element and therefore cannot be used as App Store assets.** Disable the overlay before shooting `content/store/screenshot-plan.md`.

---

## 5. How to reproduce a capture

**Read the warning in §5.2 first. It has already cost one wrong-app capture.**

### 5.1 The simulator

The 17 captures came from the already-booted iOS 18.6 device:

```
xcrun simctl list devices booted
# → iPhone 16 Pro (DC1E0F32-9DD5-4E6D-A679-5396CF2AAFE0) (Booted)   ← closet-app
# → fitapp-ios   (2177FE79-B36D-46DD-8A1F-2AFEE24C87AC) (Booted)    ← SIBLING PROJECT
```

`DC1E0F32-9DD5-4E6D-A679-5396CF2AAFE0` is the closet-app simulator. **Use the sim skills to drive it — never raw `simctl`/`adb`** (`CLAUDE.md` §Simulators), and **ask the owner before booting anything new**: two simulators are already resident and they compete for RAM. iOS first, Android parity second, never both at once.

### 5.2 ⚠️ PORT 8081 BELONGS TO A DIFFERENT PROJECT — fitapp

**This already happened once: a capture taken from port 8081 photographed the WRONG APP.**

Verify before you attach, every time:

```
lsof -nP -iTCP:8081 -sTCP:LISTEN
ps -p <PID> -o command=
# observed: node …/temp1/fitapp/packages/mobile/…/expo/bin/cli start --port 8081 --no-dev --clear
```

At the time of writing, **fitapp's Metro server owns 8081.** A simulator pointed at `localhost:8081` loads *fitapp's bundle*, renders fitapp's UI, and produces a screenshot that looks like a working app and is evidence of nothing about this repo.

**The trap is in our own config:** `packages/mobile/package.json` hardcodes `--port 8081` in all three scripts (`start`, `ios`, `start:clear`). So the naive `pnpm --filter @closet/mobile start` either collides with fitapp's server or silently attaches to it.

**Procedure:**
1. `lsof -nP -iTCP:8081 -sTCP:LISTEN` → if anything is listening, resolve the ambiguity before proceeding.
2. Start Metro on an explicitly free port and confirm it is *this* repo's: `npx expo start --port <free-port>` from `packages/mobile`, then `ps` the PID and check its cwd is `…/closet-app/packages/mobile`.
3. Point the simulator at that port and confirm the first frame is `SignInScreen` ("Your closet, finally organised") — fitapp's first frame is different, so this is a cheap identity check on the bundle.
4. Capture, then **look at every PNG** before committing it. A screenshot you did not open is not evidence.

### 5.3 Reaching each state

There is no nav-to-onboarding and no real backend, so states are reached by:
- **tab taps** for the 6 main surfaces (`NavShell` holds `active` in local state);
- **fixture/mocked query results** for populated vs empty vs error (the screens branch on `query.isPending` / `isError` / `data.length`);
- the **delete-armed** state by typing `DELETE` into `AccountScreen`'s confirmation field (`src/account/deleteConfirmation.ts` holds the comparison; `DELETE_CONFIRMATION_WORD` is its constant).

`signin-default` requires *no* session; everything else requires one, because `RootGate` renders `SignInScreen` whenever `session === null`.

### 5.4 The bar for a capture to count as evidence

- It is **this** app (bundle identity checked per §5.2).
- The PNG is **committed**, so a later reader can re-examine it rather than trust a summary.
- Someone **looked at it** and wrote down what it shows — including what is wrong. The 17 committed shots contain 6 defects that no test caught and no reasoning surfaced; that is the entire value of the oracle. A screenshot cited but not examined is a `[x]` in a doc.
