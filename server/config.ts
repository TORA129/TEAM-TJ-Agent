import 'server-only';
import 'server-only';

import { isOpenRouterFreeModelId } from './openrouter-model-catalog';

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_OPENROUTER_MODEL = 'openrouter/free';
const DEFAULT_JOB_RUNNER = 'sync';
const DEFAULT_JOB_MAX_RETRIES = 2;
const DEFAULT_JOB_TIMEOUT_MS = 30_000;
const DEFAULT_JOB_POLL_INTERVAL_MS = 2_000;

type ConfigurationGroup =
  | 'database'
  | 'objectStorage'
  | 'piAi'
  | 'openRouter'
  | 'openCli'
  | 'deployment'
  | 'jobs';
type Environment = Readonly<Record<string, string | undefined>>;
type ConfigurationRequirement = 'required' | 'optional';
type ManualFallback = 'available' | 'unavailable';
type ConfigurationReadiness = 'configured' | 'not_configured' | 'incomplete' | 'invalid';

export type ServerConfiguration = {
  database: {
    url?: string;
  };
  objectStorage: {
    endpoint?: string;
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
  piAi: {
    provider: 'openrouter';
    model: string;
    apiKey?: string;
  };
  openRouter: {
    apiKey?: string;
    baseUrl: string;
    model: string;
  };
  openCli: {
    gatewayUrl?: string;
    gatewayToken?: string;
    timeoutMs: number;
  };
  deployment: {
    nodeEnv: 'development' | 'test' | 'production';
    vercelEnv?: 'development' | 'preview' | 'production';
    appUrl?: string;
    region?: string;
  };
  jobs: {
    runner: 'sync' | 'queue' | 'worker';
    queueUrl?: string;
    maxRetries: number;
    timeoutMs: number;
    pollIntervalMs: number;
  };
};

type ConfigurationIssue = {
  group: ConfigurationGroup;
  key: string;
  code: 'missing' | 'invalid' | 'unsupported';
};

type ParsedConfiguration = {
  config: ServerConfiguration;
  issues: readonly ConfigurationIssue[];
};

export type ConfigurationGroupStatus = {
  requirement: ConfigurationRequirement;
  manualFallback: ManualFallback;
  readiness: ConfigurationReadiness;
  reason: 'ready' | 'not_configured' | 'incomplete_configuration' | 'invalid_configuration';
  missingKeys: readonly string[];
  invalidKeys: readonly string[];
};

export type RedactedConfigurationStatus = {
  overall: 'ready' | 'degraded' | 'invalid';
  environment: 'development' | 'test' | 'preview' | 'production';
  groups: Record<ConfigurationGroup, ConfigurationGroupStatus>;
  capabilities: {
    persistentWorkflows: boolean;
    fileAndCoverStorage: boolean;
    aiGeneration: boolean;
    openCliAccess: boolean;
    imageGeneration: boolean;
    manualWorkflows: true;
  };
};

export class ServerConfigurationError extends Error {
  readonly code = 'CONFIGURATION_INVALID';
  readonly issues: readonly Pick<ConfigurationIssue, 'group' | 'key' | 'code'>[];

  constructor(issues: readonly ConfigurationIssue[]) {
    super('Server configuration is invalid. Review the deployment configuration.');
    this.name = 'ServerConfigurationError';
    this.issues = issues.map(({ group, key, code }) => ({ group, key, code }));
  }
}

function readValue(environment: Environment, key: string): string | undefined {
  const value = environment[key]?.trim();
  return value ? value : undefined;
}

function readNumber(
  environment: Environment,
  key: string,
  group: ConfigurationGroup,
  issues: ConfigurationIssue[],
  fallback: number,
  minimum: number,
): number {
  const rawValue = readValue(environment, key);
  if (rawValue === undefined) {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < minimum) {
    issues.push({ group, key, code: 'invalid' });
    return fallback;
  }

  return value;
}

function readUrl(
  environment: Environment,
  key: string,
  group: ConfigurationGroup,
  issues: ConfigurationIssue[],
): string | undefined {
  return readValidatedUrl(environment, key, group, issues, ['http:', 'https:']);
}

function readValidatedUrl(
  environment: Environment,
  key: string,
  group: ConfigurationGroup,
  issues: ConfigurationIssue[],
  protocols: readonly string[],
): string | undefined {
  const value = readValue(environment, key);
  if (value === undefined) {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (!protocols.includes(url.protocol)) {
      throw new Error('unsupported protocol');
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    issues.push({ group, key, code: 'invalid' });
    return undefined;
  }
}

function readPairedValues(
  environment: Environment,
  group: ConfigurationGroup,
  keys: readonly string[],
  issues: ConfigurationIssue[],
): Record<string, string | undefined> {
  const values = Object.fromEntries(keys.map((key) => [key, readValue(environment, key)]));
  const presentCount = keys.filter((key) => values[key] !== undefined).length;

  if (presentCount > 0 && presentCount < keys.length) {
    for (const key of keys) {
      if (values[key] === undefined) {
        issues.push({ group, key, code: 'missing' });
      }
    }
  }

  return values;
}

function isFreeModel(model: string): boolean {
  return isOpenRouterFreeModelId(model);
}

function parseServerConfiguration(environment: Environment): ParsedConfiguration {
  const issues: ConfigurationIssue[] = [];
  const databaseUrl = readValidatedUrl(environment, 'DATABASE_URL', 'database', issues, [
    'postgres:',
    'postgresql:',
    'mysql:',
    'mysql2:',
    'mariadb:',
  ]);
  const objectStorage = readPairedValues(
    environment,
    'objectStorage',
    [
      'OBJECT_STORAGE_ENDPOINT',
      'OBJECT_STORAGE_BUCKET',
      'OBJECT_STORAGE_ACCESS_KEY_ID',
      'OBJECT_STORAGE_SECRET_ACCESS_KEY',
    ],
    issues,
  );
  const openCli = readPairedValues(
    environment,
    'openCli',
    ['OPENCLI_GATEWAY_URL', 'OPENCLI_GATEWAY_TOKEN'],
    issues,
  );

  if (openCli.OPENCLI_GATEWAY_URL !== undefined) {
    readUrl(environment, 'OPENCLI_GATEWAY_URL', 'openCli', issues);
  }

  const provider = readValue(environment, 'PI_AI_PROVIDER') ?? 'openrouter';
  if (provider !== 'openrouter') {
    issues.push({ group: 'piAi', key: 'PI_AI_PROVIDER', code: 'unsupported' });
  }

  const model = readValue(environment, 'PI_AI_MODEL') ?? DEFAULT_OPENROUTER_MODEL;
  if (!isFreeModel(model)) {
    issues.push({ group: 'piAi', key: 'PI_AI_MODEL', code: 'unsupported' });
  }

  const openRouterModel = readValue(environment, 'OPENROUTER_MODEL') ?? model;
  if (!isFreeModel(openRouterModel)) {
    issues.push({ group: 'openRouter', key: 'OPENROUTER_MODEL', code: 'unsupported' });
  }

  const nodeEnv = readValue(environment, 'NODE_ENV') ?? 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    issues.push({ group: 'deployment', key: 'NODE_ENV', code: 'invalid' });
  }

  const vercelEnv = readValue(environment, 'VERCEL_ENV');
  if (
    vercelEnv !== undefined &&
    vercelEnv !== 'development' &&
    vercelEnv !== 'preview' &&
    vercelEnv !== 'production'
  ) {
    issues.push({ group: 'deployment', key: 'VERCEL_ENV', code: 'invalid' });
  }

  const appUrl = readUrl(environment, 'APP_URL', 'deployment', issues);
  const runner = readValue(environment, 'JOB_RUNNER') ?? DEFAULT_JOB_RUNNER;
  if (runner !== 'sync' && runner !== 'queue' && runner !== 'worker') {
    issues.push({ group: 'jobs', key: 'JOB_RUNNER', code: 'invalid' });
  }

  const queueUrl = readUrl(environment, 'JOB_QUEUE_URL', 'jobs', issues);
  if (runner === 'queue' && queueUrl === undefined) {
    issues.push({ group: 'jobs', key: 'JOB_QUEUE_URL', code: 'missing' });
  }

  const maxRetries = readNumber(
    environment,
    'JOB_MAX_RETRIES',
    'jobs',
    issues,
    DEFAULT_JOB_MAX_RETRIES,
    0,
  );
  const jobTimeoutMs = readNumber(
    environment,
    'JOB_TIMEOUT_MS',
    'jobs',
    issues,
    DEFAULT_JOB_TIMEOUT_MS,
    1_000,
  );
  const jobPollIntervalMs = readNumber(
    environment,
    'JOB_POLL_INTERVAL_MS',
    'jobs',
    issues,
    DEFAULT_JOB_POLL_INTERVAL_MS,
    250,
  );

  const config: ServerConfiguration = {
    database: { url: databaseUrl },
    objectStorage: {
      endpoint: objectStorage.OBJECT_STORAGE_ENDPOINT,
      bucket: objectStorage.OBJECT_STORAGE_BUCKET,
      accessKeyId: objectStorage.OBJECT_STORAGE_ACCESS_KEY_ID,
      secretAccessKey: objectStorage.OBJECT_STORAGE_SECRET_ACCESS_KEY,
    },
    piAi: {
      provider: 'openrouter',
      model,
      apiKey:
        readValue(environment, 'PI_AI_API_KEY') ?? readValue(environment, 'OPENROUTER_API_KEY'),
    },
    openRouter: {
      apiKey: readValue(environment, 'OPENROUTER_API_KEY'),
      baseUrl:
        readUrl(environment, 'OPENROUTER_BASE_URL', 'openRouter', issues) ??
        DEFAULT_OPENROUTER_BASE_URL,
      model: openRouterModel,
    },
    openCli: {
      gatewayUrl: openCli.OPENCLI_GATEWAY_URL,
      gatewayToken: openCli.OPENCLI_GATEWAY_TOKEN,
      timeoutMs: readNumber(
        environment,
        'OPENCLI_TIMEOUT_MS',
        'openCli',
        issues,
        DEFAULT_JOB_TIMEOUT_MS,
        1_000,
      ),
    },
    deployment: {
      nodeEnv: nodeEnv === 'test' || nodeEnv === 'production' ? nodeEnv : 'development',
      vercelEnv:
        vercelEnv === 'development' || vercelEnv === 'preview' || vercelEnv === 'production'
          ? vercelEnv
          : undefined,
      appUrl,
      region: readValue(environment, 'VERCEL_REGION'),
    },
    jobs: {
      runner: runner === 'queue' || runner === 'worker' ? runner : 'sync',
      queueUrl,
      maxRetries,
      timeoutMs: jobTimeoutMs,
      pollIntervalMs: jobPollIntervalMs,
    },
  };

  return { config, issues };
}

export function loadServerConfig(environment: Environment = process.env): ServerConfiguration {
  const { config, issues } = parseServerConfiguration(environment);
  if (issues.length > 0) {
    throw new ServerConfigurationError(issues);
  }
  return config;
}

export function getServerConfig(environment: Environment = process.env): ServerConfiguration {
  return loadServerConfig(environment);
}

function getGroupStatus(
  group: ConfigurationGroup,
  requirement: ConfigurationRequirement,
  manualFallback: ManualFallback,
  configured: boolean,
  issues: readonly ConfigurationIssue[],
): ConfigurationGroupStatus {
  const groupIssues = issues.filter((issue) => issue.group === group);
  const missingKeys = [
    ...new Set(groupIssues.filter((issue) => issue.code === 'missing').map((issue) => issue.key)),
  ];
  const invalidKeys = [
    ...new Set(
      groupIssues
        .filter((issue) => issue.code === 'invalid' || issue.code === 'unsupported')
        .map((issue) => issue.key),
    ),
  ];
  const readiness: ConfigurationReadiness =
    invalidKeys.length > 0
      ? 'invalid'
      : missingKeys.length > 0
        ? 'incomplete'
        : configured
          ? 'configured'
          : 'not_configured';

  const reason =
    readiness === 'invalid'
      ? 'invalid_configuration'
      : readiness === 'incomplete'
        ? 'incomplete_configuration'
        : readiness === 'not_configured'
          ? 'not_configured'
          : 'ready';

  return { requirement, manualFallback, readiness, reason, missingKeys, invalidKeys };
}

function isConfigured(config: ServerConfiguration, group: ConfigurationGroup): boolean {
  switch (group) {
    case 'database':
      return config.database.url !== undefined;
    case 'objectStorage':
      return (
        config.objectStorage.endpoint !== undefined &&
        config.objectStorage.bucket !== undefined &&
        config.objectStorage.accessKeyId !== undefined &&
        config.objectStorage.secretAccessKey !== undefined
      );
    case 'piAi':
      return config.piAi.provider === 'openrouter' && config.piAi.apiKey !== undefined;
    case 'openRouter':
      return config.openRouter.apiKey !== undefined && isFreeModel(config.openRouter.model);
    case 'openCli':
      return config.openCli.gatewayUrl !== undefined && config.openCli.gatewayToken !== undefined;
    case 'deployment':
    case 'jobs':
      return true;
  }
}

export function getConfigurationStatus(
  environment: Environment = process.env,
): RedactedConfigurationStatus {
  const { config, issues } = parseServerConfiguration(environment);
  const groups = {
    database: getGroupStatus(
      'database',
      'required',
      'unavailable',
      isConfigured(config, 'database'),
      issues,
    ),
    objectStorage: getGroupStatus(
      'objectStorage',
      'optional',
      'available',
      isConfigured(config, 'objectStorage'),
      issues,
    ),
    piAi: getGroupStatus('piAi', 'optional', 'available', isConfigured(config, 'piAi'), issues),
    openRouter: getGroupStatus(
      'openRouter',
      'optional',
      'available',
      isConfigured(config, 'openRouter'),
      issues,
    ),
    openCli: getGroupStatus(
      'openCli',
      'optional',
      'available',
      isConfigured(config, 'openCli'),
      issues,
    ),
    deployment: getGroupStatus(
      'deployment',
      'required',
      'unavailable',
      isConfigured(config, 'deployment'),
      issues,
    ),
    jobs: getGroupStatus('jobs', 'required', 'unavailable', isConfigured(config, 'jobs'), issues),
  } satisfies Record<ConfigurationGroup, ConfigurationGroupStatus>;

  const requiredGroups = ['database', 'deployment', 'jobs'] as const;
  const hasInvalidGroup = Object.values(groups).some((group) => group.readiness === 'invalid');
  const missingRequiredGroup = requiredGroups.some(
    (group) => groups[group].readiness !== 'configured',
  );
  const overall = hasInvalidGroup ? 'invalid' : missingRequiredGroup ? 'degraded' : 'ready';
  const environmentName = config.deployment.vercelEnv ?? config.deployment.nodeEnv;

  return {
    overall,
    environment: environmentName,
    groups,
    capabilities: {
      persistentWorkflows: isConfigured(config, 'database'),
      fileAndCoverStorage: isConfigured(config, 'objectStorage'),
      aiGeneration: isConfigured(config, 'piAi') && isConfigured(config, 'openRouter'),
      openCliAccess: isConfigured(config, 'openCli'),
      imageGeneration: isConfigured(config, 'openRouter'),
      manualWorkflows: true,
    },
  };
}
