import { describe, expect, it } from 'vitest';

import {
  parseBlockedTermListCreateInput,
  parseBlockedTermListPatchInput,
} from '../../server/settings/blocked-terms-schema';

describe('blocked term list schema', () => {
  it('normalizes newline and comma imports while removing duplicates', () => {
    expect(
      parseBlockedTermListCreateInput({ name: 'Platform rules', content: ' 分享\n收藏, 分享 ' }),
    ).toMatchObject({
      name: 'Platform rules',
      terms: ['分享', '收藏'],
    });
  });

  it('allows an explicitly empty list', () => {
    expect(parseBlockedTermListCreateInput({ name: 'Empty', terms: [] }).terms).toEqual([]);
  });

  it('requires an edit reason for versioned edits', () => {
    expect(() => parseBlockedTermListPatchInput({ terms: ['new'] }, 'list-1')).toThrow();
    expect(
      parseBlockedTermListPatchInput({ terms: ['new'], editReason: 'Operator update' }, 'list-1'),
    ).toMatchObject({
      id: 'list-1',
      terms: ['new'],
      editReason: 'Operator update',
    });
  });
});
