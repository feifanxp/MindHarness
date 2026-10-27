import React, { CSSProperties, ReactNode } from 'react';
import { Box, Badge, toRem, Text } from 'folds';
import { millify } from '../../plugins/millify';

type UnreadBadgeProps = {
  highlight?: boolean;
  count: number;
  /**
   * Whether this badge sits on the currently-selected nav row. The soft pill's
   * fill collides with that row's background, so it has to stay solid there.
   */
  selected?: boolean;
};
const styles: CSSProperties = {
  minWidth: toRem(16),
};
export function UnreadBadgeCenter({ children }: { children: ReactNode }) {
  return (
    <Box as="span" style={styles} shrink="No" alignItems="Center" justifyContent="Center">
      {children}
    </Box>
  );
}

export function UnreadBadge({ highlight, count, selected }: UnreadBadgeProps) {
  // A plain unread count is ambient: most rooms in a busy sidebar have one. A
  // mention is not. Rendering both solid put the wrong one on top, because a
  // near-black pill outweighs a green one no matter what the green means, so
  // the sidebar shouted loudest about the thing that mattered least.
  //
  // Mentions keep the solid fill. Counts drop to soft, where the number itself
  // still reads at better than 9:1 in every theme and only the slab behind it
  // recedes. The outline is what keeps the soft pill legible as a pill on the
  // light themes, where its container is barely off the sidebar background;
  // folds draws it with `outline`, so it costs no layout.
  //
  // The selected row is the exception. Secondary.Container and
  // Background.ContainerActive are the same hex in every theme but silver, so
  // on the row the user is actually looking at the soft pill would dissolve
  // into the selection highlight and leave the digits floating. That row is
  // already visually resolved by the selection itself, so there is nothing to
  // gain by receding there — it keeps the solid fill.
  const softened = !highlight && count > 0 && !selected;

  return (
    <Badge
      variant={highlight ? 'Success' : 'Secondary'}
      size={count > 0 ? '400' : '200'}
      // The countless form is an 8px dot standing in for "something happened
      // here". There is no text inside it to carry the meaning, so it stays
      // solid; softening it would leave nothing to see.
      fill={softened ? 'Soft' : 'Solid'}
      radii="Pill"
      outlined={softened}
    >
      {count > 0 && (
        <Text as="span" size="L400">
          {millify(count)}
        </Text>
      )}
    </Badge>
  );
}
