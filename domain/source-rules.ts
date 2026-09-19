export const SOURCE_RULE_COUNT = 14 as const;

export type SourceRuleId = `SR-${string}`;

export interface SourceRule {
  readonly id: SourceRuleId;
  readonly order: number;
  readonly sourceText: string;
  readonly normalizedRule: string;
  readonly executableChecks: readonly string[];
}

export interface SourceRulesVersionReference {
  readonly snapshotId: string;
  readonly version: string;
  readonly deploymentVersion: string;
  readonly hash: string;
}

export interface SourceRulesSnapshot {
  readonly snapshotId: string;
  readonly version: string;
  readonly deploymentVersion: string;
  readonly sourceDocument: string;
  readonly sourceSection: string;
  readonly sourceHash: string;
  readonly hash: string;
  readonly contentHash: string;
  readonly ruleIds: readonly SourceRuleId[];
  readonly rules: readonly SourceRule[];
}
