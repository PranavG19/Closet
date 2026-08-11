// Add a garment (F1) — pick photos → the gate runs ON DEVICE → she approves → upload + parse
// → the garment appears in the closet. docs/01 F1 steps 2-5.
//
// THIS SCREEN IS RENDER AND HANDLERS ONLY. Every decision it makes is a call into a pure
// module: which state is showing (stage.ts), what she may see and what may be uploaded
// (intake.ts), and what a failure says (intake.ts's outcomeMessage). That split is forced,
// not stylistic — this repo has no render-test infrastructure, and a `.test.tsx` matches no
// vitest glob, so anything left in here is untested by construction. What is left in here is
// only JSX.
//
// THE PRIVACY MOMENT IS EXPLAINED AT THE POINT IT HAPPENS, not in a settings page (docs/01:37
// "plainly", docs/01:138 "privacy is a visible feature, not fine print"), and the copy comes
// from privacyPromise() — a pure function gated on whether a screener actually runs. It does
// not hedge about screening; it claims only the approval tap, because
// content/store/app-store-listing.md:233 blocks any "screened on your device" claim until the
// classifier exists and clears a recall floor, and :240 warns that softening the adjectives
// does not help ("hedged screening is still a screening claim").
//
// WHAT SHE SEES IS THE CANDIDATE LIST AND NOTHING ELSE. A photo the gate set aside is not in
// the model at all — only an anonymous count survives — so no code path here can render it,
// and `approvedPhotos()` is the only source of uploads (docs/01:44's two obligations).
//
// NO PHOTO PICKER IS BOUND IN THIS BUILD. Every native module this flow needs
// (expo-image-picker, expo-file-system, expo-image-manipulator, an ML runtime) is absent from
// packages/mobile, so the flow sits behind PhotoIntakePort and reports `available: false`,
// which renders as an honest unavailable state. See src/photo/photoIntakeNative.ts.
//
// VISUAL CORRECTNESS IS UNVERIFIED (human-gated) — no simulator in this build. No screenshot
// of this screen has ever been observed; layout, rhythm, and copy placement are structural
// guesses. Per CLAUDE.md rule 3 nobody may claim this UI works until one exists.
import React from 'react';
import { View, Image, Pressable, type ViewStyle, type ImageStyle } from 'react-native';
import { approvePhoto } from '@closet/shared';
import { useTokens } from '../../src/tokens/index.js';
import { Screen, Card, Text, Button, LoadingState, ErrorState } from '../../src/ui/index.js';
import { useSession } from '../../src/session/index.js';
import {
  usePhotoIntakePort,
  useAddGarment,
  classifyParseFailure,
  type AddGarmentOutcome,
} from '../../src/photo/index.js';
import {
  EMPTY_INTAKE,
  admit,
  approvedPhotos,
  candidateCount,
  isApproved,
  outcomeMessage,
  privacyPromise,
  setAsideCount,
  toggleApproval,
} from './intake.js';
import { stage } from './stage.js';

// The parse kind this screen submits. `teaser` — NOT `full` — is deliberate: `full` is
// entitlement-gated (parse-photo returns 402 without an active entitlement), and the teaser
// path is what produces the reveal that the paywall follows (docs/01 F1 step 4 → F2). Once
// she is a member, F3 parses the rest; that is a different flow, not a flag here.
const PARSE_KIND = 'teaser' as const;

export function AddGarmentScreen(): React.JSX.Element {
  const tokens = useTokens();
  const intakePort = usePhotoIntakePort();
  const { session } = useSession();
  // The screen only mounts behind the session gate (App.tsx's RootGate), so a session exists.
  // '' can never be a real Storage prefix, so if that assumption ever broke the upload would
  // fail closed at RLS rather than writing under someone else's prefix.
  const userId = session?.user.userId ?? '';
  const addGarment = useAddGarment(userId, intakePort.sha256Hex);

  const [intake, setIntake] = React.useState(EMPTY_INTAKE);
  const [choosing, setChoosing] = React.useState(false);
  // A closed outcome token, never a server message (raw error text can carry a storage path
  // or an id — the PII rule). null = nothing to say.
  const [outcome, setOutcome] = React.useState<AddGarmentOutcome | null>(null);

  // PICK → SCREEN → ADMIT, in that order, all on device. Nothing here touches the network:
  // there is no upload call in this function and no way to reach one, because the upload seam
  // requires a branded ApprovedPhoto that only the confirm handler below can mint.
  const importPhotos = async (): Promise<void> => {
    setOutcome(null);
    setChoosing(true);
    try {
      const picked = await intakePort.pickPhotos();
      // The gate. Its verdicts decide what may be OFFERED; `admit` drops everything else and
      // keeps only a count of it.
      const screened = await intakePort.screen(picked);
      setIntake((current) => admit(current, screened));
    } catch {
      // A picker failure is not a parse failure, but she does not need the distinction — and
      // the raw message must not reach the screen.
      setOutcome('try_again');
    } finally {
      setChoosing(false);
    }
  };

  // THE CONFIRM. This is the only place bytes leave the device, and it can only ever see
  // photos she tapped: `approvedPhotos` filters the candidates by her approval set, so a photo
  // the gate rejected is not reachable from here at all.
  //
  // approvePhoto() is what mints the branded ApprovedPhoto — hashing the bytes at THIS moment,
  // the approval tap. The hash is therefore minted by the caller at tap time, never inside
  // mutationFn (CLAUDE.md's client_id rule, same reason): a react-query retry re-sends the same
  // variables, so Storage upserts the same object and parse-photo replays instead of burning a
  // second teaser-cap slot.
  //
  // Uploaded SEQUENTIALLY, matching LaundryScreen's batch loop: there is no batch parse
  // endpoint, each photo is an independent metered job, and firing them at once would race the
  // wardrobe cache invalidation and hit the rate limiter. A failure stops the run — unlike
  // laundry, each of these costs money and a cap slot, so continuing after a 402/429 would burn
  // the rest for nothing.
  const confirmApproved = async (): Promise<void> => {
    setOutcome(null);
    for (const candidate of approvedPhotos(intake)) {
      try {
        // The whole ScreenedPhoto goes in: approvePhoto checks the verdict itself rather
        // than trusting this loop to have filtered correctly.
        // Only the tap and the digest port: the bytes come from inside the tapped photo, so
        // this call cannot pair her approval with some other photo's bytes.
        const approved = await approvePhoto({
          tapped: candidate,
          sha256Hex: intakePort.sha256Hex,
        });
        await addGarment.mutateAsync({ photo: approved, kind: PARSE_KIND });
      } catch (thrown: unknown) {
        setOutcome(classifyParseFailure(thrown));
        return;
      }
    }
    // Everything she approved is in. Clear the tray so a second import starts clean.
    setIntake(EMPTY_INTAKE);
  };

  const candidates = candidateCount(intake);
  const setAside = setAsideCount(intake);
  const approved = approvedPhotos(intake);
  const current = stage({
    intakeAvailable: intakePort.available,
    choosing,
    adding: addGarment.isPending,
    candidateCount: candidates,
  });

  if (current === 'unavailable') {
    return (
      <ErrorState
        title="Photo import isn't ready yet"
        body="This build can't open your photo library. Everything else in your closet still works."
      />
    );
  }
  if (current === 'choosing') return <LoadingState message="Opening your photos…" />;
  if (current === 'adding') return <LoadingState message="Adding to your closet…" />;

  const promise = privacyPromise(intakePort.screeningAvailable);
  const notice = outcome === null ? null : outcomeMessage(outcome);

  const tile: ViewStyle = { width: '48%', marginBottom: tokens.spacing.lg };
  const well: ViewStyle = {
    aspectRatio: 1,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.color.bg.sunken,
    marginBottom: tokens.spacing.sm,
    overflow: 'hidden',
  };
  // Approval is marked with a border, not a background tint: tinting the card would change the
  // surface every label on it was contrast-checked against (the same call LaundryScreen made).
  const approvedWell: ViewStyle = {
    ...well,
    borderWidth: 2,
    borderColor: tokens.color.accent.pink,
  };
  const thumbnail: ImageStyle = { width: '100%', height: '100%', resizeMode: 'cover' };
  const grid: ViewStyle = {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  };

  if (current === 'intro') {
    return (
      <Screen scroll padding="lg">
        <Text variant="display" tone="primary" style={{ marginBottom: tokens.spacing.md }}>
          Add clothing
        </Text>
        {/* THE PRIVACY MOMENT — stated before she opens her photo library, which is the point
            at which it matters, and in a Card so it reads as the screen's substance rather
            than a footnote. */}
        <Card variant="sunken" padding="lg" style={{ marginBottom: tokens.spacing.lg }}>
          <Text variant="body" tone="primary">
            {promise}
          </Text>
        </Card>
        <Text variant="body" tone="secondary" style={{ marginBottom: tokens.spacing.lg }}>
          Pick the photos you'd like in your closet. You'll see them here first and choose which
          ones to add.
        </Text>
        {setAside > 0 && (
          // Shown ONLY as a count. Saying how many were set aside is what makes the gate a
          // visible feature; naming or showing them would be the leak the gate exists to
          // prevent.
          <Text variant="caption" tone="secondary" style={{ marginBottom: tokens.spacing.md }}>
            {`${setAside} ${setAside === 1 ? 'photo was' : 'photos were'} set aside and stayed on your phone.`}
          </Text>
        )}
        {notice !== null && (
          <Text variant="caption" tone="secondary" style={{ marginBottom: tokens.spacing.md }}>
            {notice}
          </Text>
        )}
        <Button label="Choose photos" accent="pink" onPress={() => void importPhotos()} />
      </Screen>
    );
  }

  return (
    <Screen scroll padding="lg">
      <Text variant="display" tone="primary" style={{ marginBottom: tokens.spacing.md }}>
        Which ones?
      </Text>
      {/* The promise is repeated here because THIS is the tap it describes. */}
      <Text variant="body" tone="secondary" style={{ marginBottom: tokens.spacing.md }}>
        {promise}
      </Text>
      {setAside > 0 && (
        <Text variant="caption" tone="secondary" style={{ marginBottom: tokens.spacing.md }}>
          {`${setAside} ${setAside === 1 ? 'photo was' : 'photos were'} set aside and stayed on your phone.`}
        </Text>
      )}
      {notice !== null && (
        <Text variant="caption" tone="secondary" style={{ marginBottom: tokens.spacing.md }}>
          {notice}
        </Text>
      )}

      <Card variant="sunken" padding="md" style={grid}>
        {intake.candidates.map(({ photo }, index) => {
          const chosen = isApproved(intake, photo.id);
          return (
            <Pressable
              key={photo.id}
              style={tile}
              onPress={() => setIntake(toggleApproval(intake, photo.id))}
              // No testID convention exists in this repo, so the a11y props are the identifying
              // surface. `checkbox` + checked is the same shape LaundryScreen's rows use, and it
              // is honest: this is a per-photo opt-in, and it is the control that decides what
              // leaves the device.
              accessibilityRole="checkbox"
              accessibilityState={{ checked: chosen }}
              accessibilityLabel={`Photo ${index + 1}, ${chosen ? 'will be added' : 'not added'}`}
            >
              <View style={chosen ? approvedWell : well}>
                {/* The tile's own label already describes this, so the image is decorative to a
                    screen reader. `cover` (not `contain`) because these are raw camera-roll
                    photos, not alpha cutouts — a letterboxed thumbnail is harder to recognise. */}
                <Image source={{ uri: photo.uri }} style={thumbnail} accessible={false} />
              </View>
              <Text variant="caption" tone={chosen ? 'primary' : 'tertiary'}>
                {chosen ? 'Adding' : 'Tap to add'}
              </Text>
            </Pressable>
          );
        })}
      </Card>

      {/* The count is IN the label, so the button states exactly what it will do — and here
          that matters more than anywhere else in the app, because what it will do is upload. */}
      <Button
        label={approved.length === 0 ? 'Pick at least one' : `Add ${approved.length} to my closet`}
        accent="pink"
        disabled={approved.length === 0}
        onPress={() => void confirmApproved()}
        style={{ marginBottom: tokens.spacing.md }}
      />
      <Button label="Choose different photos" intent="ghost" onPress={() => void importPhotos()} />
    </Screen>
  );
}
