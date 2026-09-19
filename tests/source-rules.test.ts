import { describe, expect, it } from 'vitest';

import { SOURCE_RULE_COUNT } from '../domain/source-rules';
import {
  CURRENT_SOURCE_RULES_VERSION,
  read_source_rule_version_references,
  read_source_rules,
} from '../server/source-rules';
import { calculateSourceRulesHash } from '../server/source-rules/snapshots/v1.0.0';

describe('packaged Source_Rules snapshot', () => {
  it('contains the normalized 14-rule checklist with stable IDs and source wording', () => {
    const snapshot = read_source_rules();

    expect(snapshot.rules).toHaveLength(SOURCE_RULE_COUNT);
    expect(snapshot.ruleIds).toEqual(
      Array.from(
        { length: SOURCE_RULE_COUNT },
        (_, index) => `SR-${String(index + 1).padStart(3, '0')}`,
      ),
    );
    expect(snapshot.rules.map((rule) => rule.id)).toEqual(snapshot.ruleIds);
    expect(snapshot.rules.every((rule) => rule.sourceText.length > 0)).toBe(true);
    expect(snapshot.rules.every((rule) => rule.normalizedRule.length > 0)).toBe(true);
    expect(snapshot.rules.every((rule) => rule.executableChecks.length > 0)).toBe(true);
    expect(snapshot.rules[0]?.sourceText).toContain('具体对象/人群');
    expect(snapshot.rules[13]?.sourceText).toContain('不强求点赞');
  });

  it('exposes stable rule-set, deployment, and content hashes', () => {
    const snapshot = read_source_rules();

    expect(snapshot.version).toBe('1.0.0');
    expect(snapshot.deploymentVersion).toBe('0.1.0');
    expect(snapshot.sourceDocument).toBe('小红书爆款思路.txt');
    expect(snapshot.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.contentHash).toBe(snapshot.hash);
    expect(calculateSourceRulesHash(snapshot)).toBe(snapshot.hash);
    expect(read_source_rules(snapshot.version).hash).toBe(snapshot.hash);
  });

  it('returns an immutable snapshot and offers no runtime mutation path', () => {
    const snapshot = read_source_rules();
    const originalRuleText = snapshot.rules[0]?.normalizedRule;

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.rules)).toBe(true);
    expect(Object.isFrozen(snapshot.rules[0])).toBe(true);
    expect(() => {
      (snapshot.rules as Array<unknown>).push({});
    }).toThrow();
    expect(() => {
      (snapshot.rules[0] as { normalizedRule: string }).normalizedRule = 'runtime override';
    }).toThrow();
    expect(snapshot.rules[0]?.normalizedRule).toBe(originalRuleText);
  });

  it('preserves version references for historical draft resolution', () => {
    const snapshot = read_source_rules(CURRENT_SOURCE_RULES_VERSION);
    const references = read_source_rule_version_references();

    expect(references).toHaveLength(1);
    expect(references[0]).toEqual({
      snapshotId: snapshot.snapshotId,
      version: snapshot.version,
      deploymentVersion: snapshot.deploymentVersion,
      hash: snapshot.hash,
    });
    expect(Object.isFrozen(references)).toBe(true);
    expect(() => read_source_rules('9.9.9')).toThrow('Source_Rules version is not packaged: 9.9.9');
  });
});
