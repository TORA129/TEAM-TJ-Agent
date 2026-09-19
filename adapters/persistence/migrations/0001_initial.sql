-- Team-TJ persistence foundation
-- PostgreSQL migration. File bytes and cover bytes live in object storage; this
-- schema stores only private object keys and integrity metadata.

BEGIN;

CREATE TABLE workflow_sessions (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('COPYWRITER', 'REVIEWER')),
  status text NOT NULL,
  current_version integer NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  archived_at timestamptz
);
CREATE INDEX workflow_sessions_operator_idx ON workflow_sessions (operator_id, updated_at DESC);

CREATE TABLE content_brief_versions (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES workflow_sessions (id),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('DRAFT', 'READY', 'CONFIRMED', 'ARCHIVED')),
  subject text NOT NULL,
  target_audience text NOT NULL,
  core_outcome text NOT NULL,
  pain_point text NOT NULL,
  method text NOT NULL,
  parameters text NOT NULL,
  real_limitation text NOT NULL,
  closing_action text NOT NULL,
  operator_provided_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_hash text NOT NULL,
  edited_by uuid,
  edit_reason text,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL,
  UNIQUE (session_id, version)
);
CREATE INDEX content_brief_versions_session_idx ON content_brief_versions (session_id, version DESC);

CREATE TABLE question_sets (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES workflow_sessions (id),
  brief_version integer NOT NULL,
  questions jsonb NOT NULL CHECK (jsonb_typeof(questions) = 'array' AND jsonb_array_length(questions) = 3),
  field_bindings jsonb NOT NULL CHECK (jsonb_typeof(field_bindings) = 'array' AND jsonb_array_length(field_bindings) = 3),
  answers jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'array' AND jsonb_array_length(answers) = 3),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('OPEN', 'ANSWERED', 'DECLINED')),
  answered_at timestamptz,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL
);
CREATE INDEX question_sets_brief_idx ON question_sets (session_id, brief_version, created_at DESC);

CREATE TABLE copy_draft_versions (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES workflow_sessions (id),
  version integer NOT NULL CHECK (version > 0),
  target_audience text NOT NULL,
  target_emotion text NOT NULL,
  titles jsonb NOT NULL CHECK (jsonb_typeof(titles) = 'array' AND jsonb_array_length(titles) = 5),
  opening text NOT NULL,
  first_three_lines text NOT NULL,
  pain_point text NOT NULL,
  method text NOT NULL,
  real_limitation text NOT NULL,
  body text NOT NULL,
  body_points jsonb NOT NULL CHECK (jsonb_typeof(body_points) = 'array' AND jsonb_array_length(body_points) = 3),
  interaction_ending text NOT NULL,
  tags jsonb NOT NULL CHECK (jsonb_typeof(tags) = 'array' AND jsonb_array_length(tags) = 8),
  tag_buckets jsonb NOT NULL CHECK (
    jsonb_typeof(tag_buckets) = 'object'
    AND jsonb_typeof(tag_buckets -> 'broad') = 'array'
    AND jsonb_array_length(tag_buckets -> 'broad') = 3
    AND jsonb_typeof(tag_buckets -> 'medium') = 'array'
    AND jsonb_array_length(tag_buckets -> 'medium') = 3
    AND jsonb_typeof(tag_buckets -> 'longTail') = 'array'
    AND jsonb_array_length(tag_buckets -> 'longTail') = 2
  ),
  applied_rule_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_status text NOT NULL CHECK (validation_status IN ('PENDING', 'PASSED', 'FAILED', 'NEEDS_OPERATOR_CONFIRMATION')),
  compliance_status text NOT NULL CHECK (compliance_status IN ('NOT_CHECKED', 'PASSED', 'ISSUES_FOUND')),
  needs_operator_confirmation boolean NOT NULL DEFAULT false,
  model_metadata jsonb,
  content_hash text NOT NULL,
  edited_by uuid,
  edit_reason text,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL,
  UNIQUE (session_id, version)
);
CREATE INDEX copy_draft_versions_session_idx ON copy_draft_versions (session_id, version DESC);

CREATE TABLE supplementary_files (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES workflow_sessions (id),
  object_key text NOT NULL UNIQUE,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  parse_status text NOT NULL CHECK (parse_status IN ('PENDING', 'READABLE', 'UNREADABLE', 'REPLACED', 'ARCHIVED')),
  parse_error_code text,
  parse_source_record_id uuid,
  parsed_content text,
  parsed_content_hash text,
  content_source_record_id uuid,
  bound_brief_version integer,
  manual_action text CHECK (manual_action IS NULL OR manual_action IN ('CONTINUE_WITH_BRIEF', 'REPLACE_FILE')),
  manual_action_source_record_id uuid,
  source_record_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL,
  archived_at timestamptz
);
CREATE INDEX supplementary_files_session_idx ON supplementary_files (session_id, created_at DESC);

CREATE TABLE blocked_term_list_versions (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL,
  name text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  terms jsonb NOT NULL CHECK (jsonb_typeof(terms) = 'array'),
  normalization_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  imported_from text,
  content_hash text NOT NULL,
  edited_by uuid,
  edit_reason text,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL,
  archived_at timestamptz,
  UNIQUE (operator_id, name, version)
);
CREATE INDEX blocked_term_lists_operator_idx ON blocked_term_list_versions (operator_id, name, version DESC);

CREATE TABLE compliance_results (
  id uuid PRIMARY KEY,
  target_type text NOT NULL CHECK (target_type IN ('COPY_DRAFT', 'COVER_BRIEF', 'COVER_ASSET', 'REVIEW_INSIGHT')),
  target_version_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('MATCHED', 'NOT_CONFIGURED', 'NO_MATCH')),
  checked_blocks jsonb NOT NULL CHECK (jsonb_typeof(checked_blocks) = 'array'),
  blocked_term_list_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL
);
CREATE INDEX compliance_results_target_idx ON compliance_results (target_type, target_version_id, created_at DESC);

CREATE TABLE compliance_matches (
  id uuid PRIMARY KEY,
  result_id uuid NOT NULL REFERENCES compliance_results (id),
  term text NOT NULL,
  normalized_term text NOT NULL,
  block text NOT NULL,
  occurrence_count integer NOT NULL CHECK (occurrence_count > 0),
  source_list_id uuid NOT NULL REFERENCES blocked_term_list_versions (id),
  source_list_version integer NOT NULL,
  span jsonb
);
CREATE INDEX compliance_matches_result_idx ON compliance_matches (result_id);

CREATE TABLE compliance_claims (
  id uuid PRIMARY KEY,
  result_id uuid NOT NULL REFERENCES compliance_results (id),
  claim text NOT NULL,
  source_record_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('VERIFIED', 'NEEDS_OPERATOR_CONFIRMATION', 'REMOVED'))
);
CREATE INDEX compliance_claims_result_idx ON compliance_claims (result_id);

CREATE TABLE cover_briefs (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES workflow_sessions (id),
  draft_version_id uuid NOT NULL REFERENCES copy_draft_versions (id),
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL,
  visual_style text NOT NULL,
  whitespace_requirements text NOT NULL,
  limitation_or_caveat text NOT NULL,
  illustration_description text NOT NULL,
  content_hash text NOT NULL,
  edited_by uuid,
  edit_reason text,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL,
  UNIQUE (draft_version_id, version)
);
CREATE INDEX cover_briefs_session_idx ON cover_briefs (session_id, version DESC);

CREATE TABLE cover_assets (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES workflow_sessions (id),
  cover_brief_version_id uuid NOT NULL REFERENCES cover_briefs (id),
  object_key text UNIQUE,
  mime_type text,
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  aspect_ratio text,
  pixel_hash text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('PENDING', 'GENERATING', 'READY', 'FAILED', 'REPLACEMENT', 'ARCHIVED')),
  origin text NOT NULL CHECK (origin IN ('GENERATED', 'OPERATOR_UPLOAD', 'OPERATOR_EDIT')),
  generated_at timestamptz,
  failure_code text,
  failure_message text,
  edit_version integer NOT NULL DEFAULT 0 CHECK (edit_version >= 0),
  created_at timestamptz NOT NULL,
  created_by text NOT NULL,
  archived_at timestamptz
);
CREATE INDEX cover_assets_session_idx ON cover_assets (session_id, created_at DESC);

CREATE TABLE access_authorization_confirmations (
  id uuid PRIMARY KEY,
  review_id uuid NOT NULL REFERENCES workflow_sessions (id),
  exact_note_url text NOT NULL,
  normalized_note_url text NOT NULL,
  tool_id text NOT NULL,
  purpose text NOT NULL,
  account_mode text NOT NULL CHECK (account_mode IN ('AUTHORIZED_ACCOUNT', 'PUBLIC_ACCESS')),
  confirmed_at timestamptz NOT NULL,
  operator_id uuid NOT NULL,
  expires_at timestamptz,
  confirmation_version integer NOT NULL CHECK (confirmation_version > 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL,
  UNIQUE (review_id, confirmation_version)
);
CREATE INDEX access_authorizations_lookup_idx ON access_authorization_confirmations (review_id, exact_note_url, tool_id, invalidated_at);

CREATE TABLE accessible_contents (
  id uuid PRIMARY KEY,
  review_id uuid NOT NULL REFERENCES workflow_sessions (id),
  authorization_id uuid NOT NULL REFERENCES access_authorization_confirmations (id),
  retrieved_at timestamptz NOT NULL,
  content_type text NOT NULL,
  title text,
  body text,
  cover_reference text,
  observed_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_hash text NOT NULL,
  platform_limitations jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_record_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL
);
CREATE INDEX accessible_contents_review_idx ON accessible_contents (review_id, retrieved_at DESC);

CREATE TABLE manual_content_inputs (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES workflow_sessions (id),
  review_id uuid NOT NULL REFERENCES workflow_sessions (id),
  version integer NOT NULL CHECK (version > 0),
  title text,
  body text,
  cover_description text,
  metric_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_record_id uuid NOT NULL,
  content_hash text NOT NULL,
  edited_by uuid,
  edit_reason text,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL,
  UNIQUE (review_id, version)
);
CREATE INDEX manual_content_inputs_review_idx ON manual_content_inputs (review_id, version DESC);

CREATE TABLE metric_threshold_sets (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  completion_rate_policy text NOT NULL CHECK (completion_rate_policy IN ('UNDEFINED_UNLESS_OPERATOR_DEFINED', 'OPERATOR_DEFINED')),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  content_hash text NOT NULL,
  edited_by uuid,
  edit_reason text,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL,
  UNIQUE (operator_id, version)
);
CREATE INDEX metric_threshold_sets_operator_idx ON metric_threshold_sets (operator_id, version DESC);

CREATE TABLE metric_threshold_rules (
  id uuid PRIMARY KEY,
  threshold_set_id uuid NOT NULL REFERENCES metric_threshold_sets (id),
  metric_type text NOT NULL CHECK (metric_type IN ('EXPOSURE', 'CTR', 'READ_SECONDS', 'COMPLETION_RATE', 'LIKE_RATE', 'SAVE_RATE', 'COMMENT_RATE', 'FOLLOWERS')),
  label text NOT NULL,
  comparator text NOT NULL CHECK (comparator IN ('GT', 'GTE', 'LT', 'LTE', 'EQ', 'RANGE')),
  lower_value numeric,
  upper_value numeric,
  unit text NOT NULL CHECK (unit IN ('COUNT', 'BASIS_POINTS', 'SECONDS')),
  boundary_action text NOT NULL CHECK (boundary_action IN ('CLASSIFY', 'OPERATOR_CONFIRMATION', 'UNDEFINED')),
  outcome text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX metric_threshold_rules_set_idx ON metric_threshold_rules (threshold_set_id, metric_type);

CREATE TABLE metric_values (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES workflow_sessions (id),
  review_id uuid NOT NULL REFERENCES workflow_sessions (id),
  version integer NOT NULL CHECK (version > 0),
  metric_type text NOT NULL CHECK (metric_type IN ('EXPOSURE', 'CTR', 'READ_SECONDS', 'COMPLETION_RATE', 'LIKE_RATE', 'SAVE_RATE', 'COMMENT_RATE', 'FOLLOWERS')),
  value numeric NOT NULL CHECK (value >= 0),
  unit text NOT NULL CHECK (unit IN ('COUNT', 'BASIS_POINTS', 'SECONDS')),
  origin text NOT NULL CHECK (origin IN ('OPENCLI', 'MANUAL', 'OBSERVED_CONTENT')),
  source_record_id uuid NOT NULL,
  entered_at timestamptz NOT NULL,
  content_hash text NOT NULL,
  edited_by uuid,
  edit_reason text,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL,
  UNIQUE (review_id, metric_type, version)
);
CREATE INDEX metric_values_review_idx ON metric_values (review_id, metric_type, version DESC);

CREATE TABLE review_result_versions (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES workflow_sessions (id),
  review_id uuid NOT NULL REFERENCES workflow_sessions (id),
  version integer NOT NULL CHECK (version > 0),
  content_summary text NOT NULL,
  metric_assessments jsonb NOT NULL DEFAULT '[]'::jsonb,
  core_excellent_count integer NOT NULL CHECK (core_excellent_count >= 0 AND core_excellent_count <= 7),
  color_conclusion text CHECK (color_conclusion IS NULL OR color_conclusion IN ('GREEN', 'YELLOW')),
  observable_conclusions jsonb NOT NULL DEFAULT '[]'::jsonb,
  needs_human_confirmation jsonb NOT NULL DEFAULT '[]'::jsonb,
  not_evaluable jsonb NOT NULL DEFAULT '[]'::jsonb,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  markdown_template text NOT NULL,
  content_hash text NOT NULL,
  edited_by uuid,
  edit_reason text,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL,
  UNIQUE (review_id, version)
);
CREATE INDEX review_result_versions_review_idx ON review_result_versions (review_id, version DESC);

CREATE TABLE review_insights (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES workflow_sessions (id),
  review_id uuid NOT NULL REFERENCES workflow_sessions (id),
  version integer NOT NULL CHECK (version > 0),
  selected_text text NOT NULL,
  insight_type text NOT NULL,
  normalized_insight text NOT NULL,
  metric_threshold_set_version integer NOT NULL,
  compliance_result_id uuid REFERENCES compliance_results (id),
  status text NOT NULL CHECK (status IN ('CANDIDATE', 'APPROVED', 'BLOCKED')),
  source_record_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_hash text NOT NULL,
  edited_by uuid,
  edit_reason text,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL,
  UNIQUE (review_id, version)
);
CREATE INDEX review_insights_review_idx ON review_insights (review_id, version DESC);

CREATE TABLE insight_memories (
  id uuid PRIMARY KEY,
  insight_id uuid NOT NULL REFERENCES review_insights (id),
  operator_id uuid NOT NULL,
  text text NOT NULL,
  source_note_url_or_manual_input text NOT NULL,
  saved_at timestamptz NOT NULL,
  metric_threshold_set_version integer NOT NULL,
  compliance_result_id uuid NOT NULL REFERENCES compliance_results (id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('APPROVED', 'ARCHIVED')),
  created_at timestamptz NOT NULL,
  created_by text NOT NULL,
  archived_at timestamptz
);
CREATE INDEX insight_memories_operator_idx ON insight_memories (operator_id, saved_at DESC);

CREATE TABLE source_records (
  id uuid PRIMARY KEY,
  source_type text NOT NULL CHECK (source_type IN ('SOURCE_RULES', 'BRIEF_FIELD', 'FILE', 'URL', 'AUTHORIZATION', 'OPENCLI_CONTENT', 'MANUAL_INPUT', 'METRIC', 'THRESHOLD_SET', 'INSIGHT', 'MODEL_OUTPUT', 'HUMAN_EDIT')),
  source_ref text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  content_hash text,
  captured_at timestamptz NOT NULL,
  operator_id uuid,
  parent_source_record_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  access_limitations jsonb NOT NULL DEFAULT '[]'::jsonb,
  redaction_status text NOT NULL CHECK (redaction_status IN ('NOT_REQUIRED', 'REDACTED', 'REVIEW_REQUIRED')),
  created_at timestamptz NOT NULL,
  created_by text NOT NULL
);
CREATE INDEX source_records_ref_idx ON source_records (source_type, source_ref, version DESC);

CREATE TABLE source_record_parents (
  source_record_id uuid NOT NULL REFERENCES source_records (id),
  parent_source_record_id uuid NOT NULL REFERENCES source_records (id),
  PRIMARY KEY (source_record_id, parent_source_record_id),
  CHECK (source_record_id <> parent_source_record_id)
);

-- One explicit N:M relation supports every immutable output and review entity
-- without forcing persistence adapters to duplicate source-link code.
CREATE TABLE source_record_links (
  source_record_id uuid NOT NULL REFERENCES source_records (id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  role text NOT NULL,
  PRIMARY KEY (source_record_id, entity_type, entity_id, role)
);
CREATE INDEX source_record_links_entity_idx ON source_record_links (entity_type, entity_id);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  actor_type text NOT NULL CHECK (actor_type IN ('OPERATOR', 'SYSTEM', 'MODEL', 'OPENCLI')),
  actor_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  before_hash text,
  after_hash text,
  reason text,
  result_status text NOT NULL,
  source_record_id uuid REFERENCES source_records (id),
  provider_id text,
  model_id text,
  tool_id text,
  trace_id text NOT NULL,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL
);
CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_events_trace_idx ON audit_events (trace_id, created_at DESC);

CREATE TABLE jobs (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('COPY_GENERATION', 'FILE_PARSE', 'COVER_GENERATION', 'OPENCLI_FETCH', 'REVIEW_EVALUATION')),
  status text NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'RETRYABLE_FAILURE', 'TERMINAL_FAILURE')),
  entity_id uuid NOT NULL,
  input_version integer NOT NULL CHECK (input_version > 0),
  idempotency_key text NOT NULL UNIQUE,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  error_code text,
  source_record_id uuid REFERENCES source_records (id),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX jobs_entity_idx ON jobs (entity_id, created_at DESC);
CREATE INDEX jobs_status_idx ON jobs (status, updated_at DESC);

-- Generic request ledger used by synchronous mutations and external job steps.
-- A deterministic key is job_id + input_version + step; completion is the only
-- mutable field so retries can safely resolve the original result.
CREATE TABLE idempotency_records (
  id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  job_id uuid NOT NULL REFERENCES jobs (id),
  input_version integer NOT NULL CHECK (input_version > 0),
  step text NOT NULL,
  entity_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
  result_entity_id uuid,
  result_version integer,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  completed_at timestamptz,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL,
  UNIQUE (job_id, input_version, step)
);
CREATE INDEX idempotency_records_entity_idx ON idempotency_records (entity_id, created_at DESC);

CREATE TABLE operator_settings (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL UNIQUE,
  current_blocked_term_list_id uuid REFERENCES blocked_term_list_versions (id),
  current_threshold_set_id uuid REFERENCES metric_threshold_sets (id),
  version integer NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL,
  created_by text NOT NULL,
  updated_at timestamptz NOT NULL
);

-- Archive markers keep version rows append-only while supporting soft deletion.
CREATE TABLE archived_records (
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  archived_at timestamptz NOT NULL,
  archived_by uuid,
  PRIMARY KEY (entity_type, entity_id)
);

CREATE FUNCTION reject_immutable_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_RECORD: % cannot be changed after creation', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER content_brief_versions_immutable
  BEFORE UPDATE OR DELETE ON content_brief_versions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER blocked_term_list_versions_immutable
  BEFORE UPDATE OR DELETE ON blocked_term_list_versions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER compliance_results_immutable
  BEFORE UPDATE OR DELETE ON compliance_results
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER compliance_matches_immutable
  BEFORE UPDATE OR DELETE ON compliance_matches
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER compliance_claims_immutable
  BEFORE UPDATE OR DELETE ON compliance_claims
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER accessible_contents_immutable
  BEFORE UPDATE OR DELETE ON accessible_contents
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER copy_draft_versions_immutable
  BEFORE UPDATE OR DELETE ON copy_draft_versions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER cover_briefs_immutable
  BEFORE UPDATE OR DELETE ON cover_briefs
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER manual_content_inputs_immutable
  BEFORE UPDATE OR DELETE ON manual_content_inputs
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER metric_threshold_sets_immutable
  BEFORE UPDATE OR DELETE ON metric_threshold_sets
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER metric_threshold_rules_immutable
  BEFORE UPDATE OR DELETE ON metric_threshold_rules
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER metric_values_immutable
  BEFORE UPDATE OR DELETE ON metric_values
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER review_result_versions_immutable
  BEFORE UPDATE OR DELETE ON review_result_versions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER review_insights_immutable
  BEFORE UPDATE OR DELETE ON review_insights
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER source_records_immutable
  BEFORE UPDATE OR DELETE ON source_records
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER source_record_parents_immutable
  BEFORE UPDATE OR DELETE ON source_record_parents
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER source_record_links_immutable
  BEFORE UPDATE OR DELETE ON source_record_links
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER archived_records_immutable
  BEFORE UPDATE OR DELETE ON archived_records
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

COMMIT;
