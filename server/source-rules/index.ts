import type { SourceRulesSnapshot, SourceRulesVersionReference } from '../../domain/source-rules';
import { SOURCE_RULES_SNAPSHOT_V1_0_0 } from './snapshots/v1.0.0';

const PACKAGED_SNAPSHOTS: Readonly<Record<string, SourceRulesSnapshot>> = Object.freeze({
  [SOURCE_RULES_SNAPSHOT_V1_0_0.version]: SOURCE_RULES_SNAPSHOT_V1_0_0,
});

const CURRENT_SOURCE_RULES_VERSION = SOURCE_RULES_SNAPSHOT_V1_0_0.version;

const PACKAGED_VERSION_REFERENCES: readonly SourceRulesVersionReference[] = Object.freeze(
  Object.values(PACKAGED_SNAPSHOTS).map((snapshot) =>
    Object.freeze({
      snapshotId: snapshot.snapshotId,
      version: snapshot.version,
      deploymentVersion: snapshot.deploymentVersion,
      hash: snapshot.hash,
    }),
  ),
);

/**
 * Reads a versioned rule set from the deployment package only.
 *
 * There is deliberately no filesystem, environment, model, or mutation path in
 * this module. Historical drafts can pass their recorded version to read the
 * exact packaged snapshot that they reference.
 */
export function read_source_rules(
  version: string = CURRENT_SOURCE_RULES_VERSION,
): SourceRulesSnapshot {
  const snapshot = PACKAGED_SNAPSHOTS[version];
  if (!snapshot) {
    throw new Error(`Source_Rules version is not packaged: ${version}`);
  }
  return snapshot;
}

/** Returns the immutable references required to resolve historical drafts. */
export function read_source_rule_version_references(): readonly SourceRulesVersionReference[] {
  return PACKAGED_VERSION_REFERENCES;
}

export { CURRENT_SOURCE_RULES_VERSION };
export { SOURCE_RULES_SNAPSHOT_V1_0_0 } from './snapshots/v1.0.0';
