import { describe, expect, it } from 'vitest';
import {
  estimateMindroomTextMessageContentBytes,
  shouldConvertPasteToAttachment,
} from './pasteAttachment';

describe('pasteAttachment', () => {
  it('converts when pasted text pushes content over the budget', () => {
    expect(
      shouldConvertPasteToAttachment({
        currentPlainText: 'hello',
        pastedText: 'x'.repeat(80),
        budgetBytes: 64,
      })
    ).toBe(true);
  });

  it('allows normal paste under the budget', () => {
    expect(
      shouldConvertPasteToAttachment({
        currentPlainText: 'hello',
        pastedText: ' world',
        budgetBytes: 1024,
      })
    ).toBe(false);
  });

  it('accounts for formatted body overhead when present', () => {
    const plainOnlyBytes = estimateMindroomTextMessageContentBytes({
      body: `${'a'.repeat(40)}${'b'.repeat(40)}`,
    });
    const formattedBytes = estimateMindroomTextMessageContentBytes({
      body: `${'a'.repeat(40)}${'b'.repeat(40)}`,
      formattedBody: `${'<strong>a</strong>'.repeat(40)}${'b'.repeat(40)}`,
    });

    expect(formattedBytes).toBeGreaterThan(plainOnlyBytes);
    expect(
      shouldConvertPasteToAttachment({
        currentPlainText: 'a'.repeat(40),
        currentFormattedBody: '<strong>a</strong>'.repeat(40),
        pastedText: 'b'.repeat(40),
        budgetBytes: plainOnlyBytes + 1,
      })
    ).toBe(true);
  });

  it('treats markdown mode as formatted-body risk', () => {
    expect(
      shouldConvertPasteToAttachment({
        currentPlainText: '',
        currentFormattedBody: '',
        pastedText: 'x'.repeat(40),
        includeFormattedPaste: true,
        budgetBytes: estimateMindroomTextMessageContentBytes({ body: 'x'.repeat(40) }) + 1,
      })
    ).toBe(true);
  });
});
