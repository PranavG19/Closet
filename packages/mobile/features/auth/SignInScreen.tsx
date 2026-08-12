// The identity-up-front gate: sign in BEFORE the app, with no anonymous session
// (docs decision). Nothing in the tree behind this screen can render without a
// session, so every Edge endpoint below it is reachable with a real bearer.
//
// Apple is listed first: on iOS, shipping any other social login makes Sign in with
// Apple mandatory (App Store Guideline 4.8), so it is the primary affordance.
//
// Errors: only the closed AuthErrorCode set reaches this screen, mapped to copy by
// authErrorMessage(). A raw provider/Supabase message is never rendered — it can
// carry an email or an internal reason, and it isn't this product's voice. A user
// cancellation maps to null and shows NOTHING: she dismissed the sheet on purpose.
//
// VISUAL CORRECTNESS IS UNVERIFIED (human-gated) — this was written without a
// simulator; no screenshot of this screen has ever been observed. Layout, rhythm,
// and copy placement are structural guesses pending the human's review.
import React, { useState } from 'react';
import { View, type ViewStyle } from 'react-native';
import { useTokens } from '../../src/tokens/index.js';
import { Screen, Text, Button, ErrorState } from '../../src/ui/index.js';
import { useScreenLoad } from '../../src/metrics/index.js';
import { useSession, authErrorMessageFromThrown } from '../../src/session/index.js';

export function SignInScreen(): React.JSX.Element {
  const tokens = useTokens();
  const { signInWithApple, signInWithGoogle } = useSession();
  // null = nothing to say (never signed in yet, or she cancelled).
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Mount → ready metric. SignIn waits on no query — it is ready as soon as it mounts, so this
  // records the sign-in screen's render cost (a near-zero duration is itself the signal).
  useScreenLoad('sign_in', true);

  const attempt = (signIn: () => Promise<void>) => (): void => {
    setErrorMessage(null);
    setBusy(true);
    void signIn()
      .catch((thrown: unknown) => {
        // The mapper is the ONLY thing that ever looks at the thrown value, and it
        // reads `.code` — never `.message` from a non-AuthFlowError.
        setErrorMessage(authErrorMessageFromThrown(thrown));
      })
      .finally(() => setBusy(false));
  };

  const hero: ViewStyle = { flex: 1, justifyContent: 'center', gap: tokens.spacing.md };
  const actions: ViewStyle = { gap: tokens.spacing.md, paddingBottom: tokens.spacing.xl };

  return (
    <Screen padding="xl">
      <View style={hero}>
        <Text variant="display" tone="primary">
          Your closet, finally organised
        </Text>
        <Text variant="body" tone="secondary">
          Sign in to start. Your photos are checked on this device before anything is
          ever uploaded.
        </Text>
      </View>

      {errorMessage !== null ? (
        <ErrorState title="Sign-in didn't go through" body={errorMessage} />
      ) : null}

      <View style={actions}>
        <Button
          label="Continue with Apple"
          onPress={attempt(signInWithApple)}
          intent="accent"
          disabled={busy}
        />
        <Button
          label="Continue with Google"
          onPress={attempt(signInWithGoogle)}
          intent="secondary"
          disabled={busy}
        />
        <Text variant="caption" tone="tertiary">
          You can export or permanently delete everything from Profile at any time.
        </Text>
      </View>
    </Screen>
  );
}
