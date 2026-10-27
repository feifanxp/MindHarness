import { describe, expect, it } from 'vitest';
import wire from './__fixtures__/backendApprovalContract.json';
import { getApprovalCapabilities, getApprovalGrantState } from './approvalActions';
import {
  getToolApprovalRenderContent,
  MINDROOM_TOOL_APPROVAL_EVENT,
  parseToolApprovalContent,
} from './toolApproval';

// Captured from MindRoom's terminal_content projector and _approval_delivery_content
// encoder. Keep the literal wire fixture independent of client-side builders.
describe('backend approval wire contract', () => {
  it.each(Object.entries(wire.deliveries))(
    'preserves reviewed evidence for %s',
    (kind, delivery) => {
      const content =
        kind === 'automatic' ? delivery : getToolApprovalRenderContent(wire.original, delivery);
      const approval = parseToolApprovalContent(MINDROOM_TOOL_APPROVAL_EVENT, content);
      expect(approval).toMatchObject({
        approvalId: 'approval-contract',
        toolCallId: 'call-contract',
        status: kind === 'denied' || kind === 'expired' ? kind : 'approved',
        approvable: false,
        fullArguments: {
          tool_name: 'write_note',
          arguments: { text: 'The complete reviewed note.' },
        },
        scope: {
          id: 'scope-contract',
          operation: {
            toolName: 'workspace_call_tool',
            mcpServerId: 'workspace',
            mcpToolName: 'write_note',
          },
        },
      });
      expect(
        getApprovalCapabilities(
          {
            eventId: '$origin',
            sender: '@router:example.org',
            approval: approval!,
            wireStatus: approval!.status,
          },
          '@alice:example.org',
          undefined,
          Date.parse('2026-09-12T12:02:00Z')
        )
      ).toEqual({
        approve: false,
        deny: false,
        durations: [],
        scheduledScopes: [],
        revoke: kind === 'timed_origin',
      });
      expect(approval?.resolvedBy).toBe(kind === 'expired' ? null : '@alice:example.org');
      expect(approval?.resolutionReason).toBe(
        kind === 'denied'
          ? 'Wrong workspace'
          : kind === 'expired'
          ? 'Tool approval request timed out.'
          : null
      );
      if (kind.startsWith('timed_') || kind === 'automatic') {
        expect(approval?.provenance).toEqual({
          kind: 'timed_grant',
          grantId: 'grant-contract',
          grantCardEventId: '$origin',
          grantedBy: '@alice:example.org',
          grantedAt: '2026-09-12T12:01:00+00:00',
          durationSeconds: 600,
          expiresAt: '2026-09-12T12:11:00+00:00',
        });
      } else {
        expect(approval?.provenance).toEqual(kind === 'once' ? { kind: 'once' } : null);
      }
      expect(approval && getApprovalGrantState(approval, Date.parse('2026-09-12T12:02:00Z'))).toBe(
        kind === 'timed_origin' ? 'active' : undefined
      );
      expect(approval && getApprovalGrantState(approval, Date.parse('2026-09-12T12:11:00Z'))).toBe(
        kind === 'timed_origin' ? 'expired' : undefined
      );
    }
  );
});
