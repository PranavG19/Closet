// Outfit detail — where a saved look's MANAGEMENT lives (rename, delete). It exists so the
// list card can be chrome-free: the list previously carried a permanent two-link action bar
// under every card (Rename/Remove that mutated in place into Save/Cancel or Delete/Keep, plus
// an inline TextInput that shifted every row below it), which read as cluttered and "two bars"
// on every card. Management is a per-look, deliberate act — it belongs on the look, not stamped
// across the whole list. Opened as in-feature state from OutfitsScreen (no push nav — the shell
// is a flat surface swap), with its own Back affordance.
import React from 'react';
import { View, Image, TextInput, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';
import type { OutfitSummary } from '@closet/shared';
import { useTokens } from '../../src/tokens/index.js';
import { Screen, Text, Button, Divider } from '../../src/ui/index.js';

// Same singular/plural + honest-empty label as the list.
function piecesLabel(count: number): string {
  if (count === 0) return 'No pieces yet';
  return count === 1 ? '1 piece' : `${count} pieces`;
}

export function OutfitDetailScreen({
  outfit,
  uris,
  onBack,
  onRename,
  onDelete,
  renaming,
  deleting,
}: {
  readonly outfit: OutfitSummary;
  // Signed-URL map keyed by cutout PATH (parent signs all previews in one pass).
  readonly uris: Readonly<Record<string, string>>;
  readonly onBack: () => void;
  readonly onRename: (id: string, name: string) => void;
  // Called once the two-tap confirm is satisfied. The parent returns to the list on success.
  readonly onDelete: (id: string) => void;
  readonly renaming: boolean;
  readonly deleting: boolean;
}): React.JSX.Element {
  const tokens = useTokens();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  // Two-tap delete confirm, exactly as the list card had — a saved look is rebuildable, so this
  // is a light mis-tap guard, not the type-to-confirm the account purge needs.
  const [armed, setArmed] = React.useState(false);

  const nameInput: TextStyle = {
    minHeight: 44,
    borderWidth: 1,
    borderColor: tokens.color.border.hairline,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.color.bg.surface,
    paddingHorizontal: tokens.spacing.md,
    color: tokens.color.text.primary,
    fontSize: tokens.typography.body.fontSize,
    marginTop: tokens.spacing.sm,
  };

  // A larger preview than the list strip — this is the look's own page, so the pieces earn room.
  const thumb: ViewStyle = {
    width: 96,
    height: 96,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.color.bg.sunken,
    marginRight: tokens.spacing.md,
    marginBottom: tokens.spacing.md,
    overflow: 'hidden',
  };
  const image: ImageStyle = { width: '100%', height: '100%', resizeMode: 'contain' };

  const beginRename = (): void => {
    setDraft(outfit.name ?? '');
    setEditing(true);
  };
  const commitRename = (): void => {
    onRename(outfit.id, draft);
    setEditing(false);
  };

  return (
    <Screen scroll padding="lg">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to outfits"
        onPress={onBack}
        style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.xs, minHeight: 44 }}
      >
        <Ionicons name="chevron-back" size={20} color={tokens.color.text.secondary} />
        <Text variant="overline" tone="secondary">
          Outfits
        </Text>
      </Pressable>

      <View style={{ marginTop: tokens.spacing.lg }}>
        {outfit.name !== null ? (
          <Text variant="display" tone="primary">
            {outfit.name}
          </Text>
        ) : (
          <Text variant="display" tone="secondary">
            Untitled look
          </Text>
        )}
        <Text variant="overline" style={{ marginTop: tokens.spacing.xs }}>
          {piecesLabel(outfit.item_count)}
        </Text>
      </View>

      {outfit.preview_paths.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: tokens.spacing.lg }}>
          {outfit.preview_paths.map((path) => (
            <View key={path} style={thumb}>
              {uris[path] !== undefined ? (
                <Image source={{ uri: uris[path] }} style={image} accessible={false} />
              ) : null}
            </View>
          ))}
        </View>
      )}

      <Divider />
      <View style={{ marginTop: tokens.spacing.xl, gap: tokens.spacing.md }}>
        <Text variant="title" tone="primary">
          Rename
        </Text>
        {editing ? (
          <>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              autoFocus
              maxLength={80}
              placeholder="Name this look"
              placeholderTextColor={tokens.color.text.tertiary}
              accessibilityLabel="Outfit name"
              editable={!renaming}
              style={nameInput}
            />
            <View style={{ flexDirection: 'row', gap: tokens.spacing.xl }}>
              <Button label={renaming ? 'Saving…' : 'Save'} intent="link" disabled={renaming} onPress={commitRename} />
              <Button label="Cancel" intent="ghost" disabled={renaming} onPress={() => setEditing(false)} />
            </View>
          </>
        ) : (
          <Button label={outfit.name !== null ? 'Rename this look' : 'Name this look'} intent="link" onPress={beginRename} />
        )}
      </View>

      <Divider />
      <View style={{ marginTop: tokens.spacing.xl, gap: tokens.spacing.md }}>
        <Text variant="title" tone="primary">
          Remove
        </Text>
        <Text variant="body" tone="secondary">
          This deletes the saved look. Your garments stay in your closet.
        </Text>
        {!armed ? (
          <Button label="Delete this look" intent="link" accent="red" onPress={() => setArmed(true)} />
        ) : (
          <View style={{ flexDirection: 'row', gap: tokens.spacing.xl }}>
            <Button
              label={deleting ? 'Removing…' : 'Delete for good'}
              intent="link"
              accent="red"
              disabled={deleting}
              onPress={() => onDelete(outfit.id)}
            />
            <Button label="Keep" intent="ghost" disabled={deleting} onPress={() => setArmed(false)} />
          </View>
        )}
      </View>
    </Screen>
  );
}
