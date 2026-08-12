// The public legal URLs the App Store requires reachable from inside the binary:
// a Privacy Policy and Terms of Use (EULA), plus the App Store's own manage-subscription
// deep link. App Store Review Guidelines 3.1.2 (subscription apps must link functional
// Privacy Policy + Terms of Use) and 5.1.1 make these a HARD submission requirement — a
// subscription app without them is rejected on sight.
//
// The URLs themselves are HUMAN-REQUIRED: someone must host docs/legal/privacy-policy.md
// and docs/legal/terms-of-service.md at a public https URL and set the env vars below.
// The UI that surfaces them (AccountScreen, PaywallScreen) is fully built; only the
// hosted destinations are outstanding. Read through EXPO_PUBLIC_* like every other public
// client value (see src/api/config.ts) so Metro inlines them at bundle time.
//
// manageSubscriptionsUrl is the Apple-fixed deep link, not a project value — it always
// opens the signed-in user's own subscription management, so it is a constant, not env.

export interface LegalLinks {
  // Public Privacy Policy URL. null when unset — the UI hides the row rather than linking
  // to a dead placeholder (a broken legal link is worse at review than an absent one).
  readonly privacyPolicyUrl: string | null;
  // Public Terms of Use / EULA URL. null when unset (same reasoning).
  readonly termsOfUseUrl: string | null;
  // Apple's canonical manage-subscriptions destination. Opens the user's own subscriptions
  // in the App Store; a fixed system URL, always present.
  readonly manageSubscriptionsUrl: string;
}

// Apple's documented deep link for managing auto-renewable subscriptions. Stable, public,
// and account-scoped by the OS — not a per-project value.
const APPLE_MANAGE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';

// A configured value only counts when it is a real https URL. An empty string or a bare
// placeholder is treated as unset (→ null) so the UI hides the row instead of shipping a
// link that 404s in front of a reviewer.
function httpsUrlOrNull(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('https://')) return null;
  return trimmed;
}

export function loadLegalLinks(): LegalLinks {
  return {
    privacyPolicyUrl: httpsUrlOrNull(process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL),
    termsOfUseUrl: httpsUrlOrNull(process.env.EXPO_PUBLIC_TERMS_OF_USE_URL),
    manageSubscriptionsUrl: APPLE_MANAGE_SUBSCRIPTIONS_URL,
  };
}
