// The Account screen — the identity + data-rights surface.
//
// WHY IT LIVES UNDER features/auth: conventions.json featureRoots does NOT include
// an 'account' root (it lists auth, laundry, monetization, navigation, onboarding,
// outfits, palette, suggestions, wardrobe, wearlog). conventions.json is
// human-owned, so this agent must not add one; the screen sits under the existing
// 'auth' root, which it belongs to anyway (it reads useSession and signs out). If
// the human later adds an 'account' root, moving this file is the whole migration.
//
// It exists because Apple App Store Review Guideline 5.1.1(v) requires a REVIEWER to
// be able to REACH account deletion from inside the app. The backend purge landed
// already; without this screen the guideline is not satisfied. That is also why
// Account is registered in features/navigation/tabs.ts — an unreachable delete
// button is not a delete button.
//
// The delete flow is TYPE-TO-CONFIRM (src/account/deleteConfirmation.ts): she must
// type DELETE exactly. There is no undo, and confirmationToken() is the only way to
// produce the literal the client method accepts, so an unconfirmed purge cannot even
// be expressed.
//
// VISUAL CORRECTNESS IS UNVERIFIED (human-gated) — written with no simulator; no
// screenshot of this screen has ever been observed. In particular the destructive
// section's visual weight (does the delete affordance read as dangerous enough, and
// not so loud that it dominates the screen?) is a JUDGEMENT ONLY A HUMAN LOOKING AT
// IT CAN MAKE. Treat the layout as structural, not designed.
import React, { useState } from 'react';
import { View, TextInput, Share, Linking, type ViewStyle, type TextStyle } from 'react-native';
import { useTokens } from '../../src/tokens/index.js';
import { Screen, Card, Text, Button, Divider, SectionHeader, LoadingState } from '../../src/ui/index.js';
import { useScreenLoad } from '../../src/metrics/index.js';
import { useSession } from '../../src/session/index.js';
import { useNav } from '../../src/navigation/index.js';
import { useDeleteAccount, useExportMyData, useEntitlement } from '../../src/api/index.js';
import { loadLegalLinks } from '../../src/config/legalLinks.js';
import {
  DELETE_CONFIRMATION_WORD,
  confirmationToken,
  summarizeExport,
  serializeExport,
  type ExportSummary,
} from '../../src/account/index.js';

// One generic line per failure. Deliberately NOT the server's message: an ApiError
// carries a code, and a raw message on these two endpoints is the likeliest place a
// user identifier would surface in the UI.
const EXPORT_FAILED = "We couldn't build your export just now. Please try again.";
const DELETE_FAILED = 'Your account was not deleted. Nothing has changed. Please try again.';

function ExportReceipt({ summary }: { readonly summary: ExportSummary }): React.JSX.Element {
  const tokens = useTokens();
  const lines = [
    `${summary.wardrobeItems} wardrobe items`,
    `${summary.outfits} outfits`,
    `${summary.wearLogEntries} wear-log entries`,
    `${summary.parseJobs} photo-parse records`,
    summary.hasPalette ? 'your colour profile' : 'no colour profile',
    summary.hasSubscription ? 'your membership record' : 'no membership record',
  ];
  return (
    <View style={{ gap: tokens.spacing.xs }}>
      <Text variant="body" tone="primary">
        Your export includes:
      </Text>
      {lines.map((line) => (
        <Text key={line} variant="caption" tone="secondary">
          {line}
        </Text>
      ))}
      <Text variant="caption" tone="tertiary">
        Photos themselves aren&apos;t in this file — it lists where each one is stored.
      </Text>
    </View>
  );
}

// An optional extra section rendered above the data/delete cards. The palette swatch quiz
// (features/palette) is composed in HERE by App.tsx rather than imported directly, because a
// features/auth file importing features/palette is the cross-feature import the project bans
// (eslint.config.mjs crossFeatureZones). App.tsx is the composition root that already wires
// every feature, so the slot keeps the isolation intact.
export interface AccountScreenProps {
  readonly extraSection?: React.ReactNode;
}

export function AccountScreen({ extraSection }: AccountScreenProps = {}): React.JSX.Element {
  const tokens = useTokens();
  const { user, signOut } = useSession();
  // The paywall is no longer a tab (a permanent paywall tab is a dark pattern); it's reached
  // from the Membership section below when she isn't entitled.
  const nav = useNav();
  const exportMutation = useExportMyData();
  const deleteMutation = useDeleteAccount();
  // Current membership status, shown as a plain plan line + a manage-subscription link. NOT
  // gated on: the section renders "checking / couldn't check" rather than blocking the whole
  // account surface on a billing read. Declared with the other hooks (Rules of Hooks).
  const entitlement = useEntitlement();
  // The App-Store-required legal destinations. privacy/terms are null until a real https URL
  // is configured (EXPO_PUBLIC_*), in which case the row is hidden rather than linking to a
  // dead placeholder. manage-subscriptions is Apple's fixed system deep link, always present.
  const legal = loadLegalLinks();
  // Mount → ready metric. Account waits on no read (session is already present) — ready on mount,
  // before the delete-pending early return so the hook order is stable (Rules of Hooks).
  useScreenLoad('account', true);

  // Two-STAGE plus type-to-confirm: the destructive controls are not even mounted
  // until she opts in, so the text field cannot be pre-filled by a stray render.
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [typed, setTyped] = useState('');
  const token = confirmationToken(typed);

  const onExport = (): void => {
    exportMutation.mutate(undefined, {
      onSuccess: (document) => {
        // Share is core react-native (no extra dependency). It hands the JSON to the
        // OS sheet, from which she can save to Files, mail it, or copy it. The
        // document is ALSO rendered below, so if a platform truncates a long share
        // message the data is still retrievable on screen.
        void Share.share({ message: serializeExport(document) }).catch(() => {
          // A dismissed/unavailable share sheet is not a data-rights failure: the
          // document is already on screen. Swallow rather than alarm her.
        });
      },
    });
  };

  const onDelete = (): void => {
    // `token` is null unless she typed DELETE exactly; this is the last gate and it
    // is also what makes the call type-check at all.
    if (token === null) return;
    deleteMutation.mutate(token, {
      // Sign out AFTER the purge is confirmed by a parsed 200. The gate in App.tsx
      // then returns her to SignInScreen with no imperative navigation.
      onSuccess: () => {
        void signOut();
      },
    });
  };

  const section: ViewStyle = { gap: tokens.spacing.md, marginBottom: tokens.spacing.xl };
  const input: TextStyle = {
    minHeight: 44,
    borderWidth: 1,
    borderColor: tokens.color.border.hairline,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.color.bg.surface,
    paddingHorizontal: tokens.spacing.md,
    color: tokens.color.text.primary,
    fontSize: tokens.typography.body.fontSize,
  };

  if (deleteMutation.isPending) {
    return <LoadingState message="Deleting your account…" />;
  }

  return (
    <Screen scroll padding="lg">
      {/* Masthead — the tab is "You"; the eyebrow names the surface, the serif title greets. */}
      <SectionHeader eyebrow="Your account" title="You" titleVariant="display" />

      <View style={[section, { marginTop: tokens.spacing.xl }]}>
        <Text variant="overline">Signed in as</Text>
        <Text variant="body" tone="primary">
          {user?.email ?? 'your private account'}
        </Text>
        <Button label="Sign out" onPress={() => void signOut()} intent="link" />
      </View>

      <Divider />
      <View style={[section, { marginTop: tokens.spacing.xl }]}>
        <Text variant="title" tone="primary">
          Membership
        </Text>
        {/* Plan status in plain words. Server is the truth (entitlement is webhook-written),
            so we report what the read says and degrade honestly if it hasn't landed. */}
        <Text variant="body" tone="secondary">
          {entitlement.isSuccess
            ? entitlement.data.entitlement_active
              ? 'Premium — every feature is unlocked.'
              : "You're on the free plan."
            : entitlement.isError
              ? "We couldn't check your membership just now."
              : 'Checking your membership…'}
        </Text>
        {/* When she isn't a member, the ONE earned filled action on this section is the upgrade
            — this is the paywall's entry point now that Plan is not a tab. Shown only once the
            entitlement read has resolved as inactive, so it never flashes for a member or during
            the check. Opens the paywall surface via the nav seam. */}
        {entitlement.isSuccess && !entitlement.data.entitlement_active && (
          <Button
            label="Upgrade to Premium"
            accent="pink"
            onPress={() => nav.navigate('profile')}
          />
        )}
        {/* Apple manages auto-renewable subscriptions from the App Store, not in-app — this
            opens the user's own subscriptions there (also where she cancels; deleting the
            account below does NOT cancel a store subscription). */}
        <Button
          label="Manage subscription"
          intent="link"
          onPress={() => void Linking.openURL(legal.manageSubscriptionsUrl)}
        />
      </View>

      {extraSection}

      <Divider />
      <View style={[section, { marginTop: tokens.spacing.xl }]}>
        <Text variant="title" tone="primary">
          Your data
        </Text>
        <Text variant="body" tone="secondary">
          Get a copy of everything we hold for you — your items, outfits, wear history,
          colour profile and membership status — as one file.
        </Text>
        <Button
          label="Export my data"
          onPress={onExport}
          intent="link"
          disabled={exportMutation.isPending}
        />
        {exportMutation.isPending ? (
          <Text variant="caption" tone="tertiary">
            Gathering your data…
          </Text>
        ) : null}
        {exportMutation.isError ? (
          <Text variant="caption" tone="secondary">
            {EXPORT_FAILED}
          </Text>
        ) : null}
        {exportMutation.isSuccess ? (
          <View style={{ gap: tokens.spacing.md }}>
            <ExportReceipt summary={summarizeExport(exportMutation.data)} />
            {/* Rendered as selectable text so the document is retrievable even if
                the OS share sheet is unavailable or truncates it. This block EARNS a Card —
                it is literally the export payload (synthesis §2 Card doctrine). */}
            <Card variant="sunken" padding="md">
              <Text variant="caption" tone="secondary" selectable>
                {serializeExport(exportMutation.data)}
              </Text>
            </Card>
          </View>
        ) : null}
      </View>

      {/* Legal. App Store 3.1.2 requires a functional Privacy Policy AND Terms of Use link
          reachable in-app for a subscription app. Each row appears ONLY when a real https URL
          is configured (EXPO_PUBLIC_PRIVACY_POLICY_URL / _TERMS_OF_USE_URL) — a hidden row is
          strictly better at review than one that opens a 404. When BOTH are unset the whole
          section collapses; that unset state is the one remaining human-required launch step. */}
      {(legal.privacyPolicyUrl !== null || legal.termsOfUseUrl !== null) && (
        <>
          <Divider />
          <View style={[section, { marginTop: tokens.spacing.xl }]}>
            <Text variant="title" tone="primary">
              Legal
            </Text>
            {legal.privacyPolicyUrl !== null && (
              <Button
                label="Privacy Policy"
                intent="link"
                onPress={() => void Linking.openURL(legal.privacyPolicyUrl!)}
              />
            )}
            {legal.termsOfUseUrl !== null && (
              <Button
                label="Terms of Use"
                intent="link"
                onPress={() => void Linking.openURL(legal.termsOfUseUrl!)}
              />
            )}
          </View>
        </>
      )}

      <Divider />
      <View style={[section, { marginTop: tokens.spacing.xl }]}>
        <Text variant="title" tone="primary">
          Delete my account
        </Text>
        <Text variant="body" tone="secondary">
          This permanently deletes your account and everything in it: every item,
          outfit, wear-log entry, photo record, your colour profile and your membership
          record. It cannot be undone and we cannot restore it for you.
        </Text>
        <Text variant="caption" tone="tertiary">
          If you pay through the App Store or Play Store, cancel the subscription there
          too — deleting your account here does not cancel the store subscription.
        </Text>

        {!deleteArmed ? (
          <Button
            label="Delete my account"
            onPress={() => setDeleteArmed(true)}
            intent="link"
            accent="red"
          />
        ) : (
          <View style={{ gap: tokens.spacing.md }}>
            <Text variant="body" tone="primary">
              Type {DELETE_CONFIRMATION_WORD} to confirm.
            </Text>
            <TextInput
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel={`Type ${DELETE_CONFIRMATION_WORD} to confirm account deletion`}
              placeholder={DELETE_CONFIRMATION_WORD}
              placeholderTextColor={tokens.color.text.tertiary}
              style={input}
            />
            <Button
              label="Permanently delete everything"
              onPress={onDelete}
              intent="accent"
              accent="red"
              // Unarmed until the word matches EXACTLY — the button cannot fire a
              // purge she did not type.
              disabled={token === null}
            />
            <Button
              label="Keep my account"
              onPress={() => {
                setDeleteArmed(false);
                setTyped('');
              }}
              intent="ghost"
            />
            {deleteMutation.isError ? (
              <Text variant="caption" tone="secondary">
                {DELETE_FAILED}
              </Text>
            ) : null}
          </View>
        )}
      </View>
    </Screen>
  );
}
