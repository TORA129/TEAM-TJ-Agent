import 'server-only';

import { createHash } from 'node:crypto';

import type { ServerConfiguration } from './config';

export const OPENROUTER_FREE_ROUTE = 'openrouter/free';

export type ModelCapability = 'structuredOutput' | 'toolCalls' | 'imageOutput';

export type ModelCapabilityRequirements = Readonly<Partial<Record<ModelCapability, boolean>>>;

export type ModelCapabilities = Readonly<Record<ModelCapability, boolean>>;

export type CatalogAvailability = 'ready' | 'not_configured' | 'unavailable' | 'rate_limited';

export type ModelSelectionStatus =
  | 'selected'
  | 'configuration_missing'
  | 'unavailable'
  | 'rate_limited'
  | 'capability_insufficient';

export interface OpenRouterModelDescriptor {
  readonly id: string;
  readonly name?: string;
  readonly free: true;
  readonly dynamic: boolean;
  readonly capabilities: ModelCapabilities;
  readonly source: 'catalog' | 'dynamic_route';
}

export interface OpenRouterCatalogSnapshot {
  readonly version: string;
  readonly fetchedAt: string;
  readonly source: 'openrouter_models_api' | 'static';
  readonly status: 'ready';
  readonly models: readonly OpenRouterModelDescriptor[];
}

export interface OpenRouterCatalogState {
  readonly status: CatalogAvailability;
  readonly snapshot?: OpenRouterCatalogSnapshot;
}

export interface ModelSelection {
  readonly status: ModelSelectionStatus;
  readonly requestedModel: string;
  readonly selectedModelId?: string;
  readonly capabilities?: ModelCapabilities;
  readonly missingCapabilities: readonly ModelCapability[];
  readonly catalogVersion?: string;
  readonly manualFallback: true;
}

export interface OpenRouterCatalogFetchOptions {
  readonly signal?: AbortSignal;
  readonly version?: string;
  readonly fetchedAt?: string;
  readonly dynamicRouteCapabilities?: ModelCapabilities;
}

export interface OpenRouterCatalogFetcher {
  fetchModels(options?: { readonly signal?: AbortSignal }): Promise<unknown>;
}

export class OpenRouterCatalogRequestError extends Error {
  readonly status: 'not_configured' | 'unavailable' | 'rate_limited';

  constructor(status: 'not_configured' | 'unavailable' | 'rate_limited') {
    super('OpenRouter model catalog request failed.');
    this.name = 'OpenRouterCatalogRequestError';
    this.status = status;
  }
}

const DEFAULT_DYNAMIC_ROUTE_CAPABILITIES: ModelCapabilities = {
  structuredOutput: true,
  toolCalls: true,
  imageOutput: false,
};

const CAPABILITIES: readonly ModelCapability[] = ['structuredOutput', 'toolCalls', 'imageOutput'];

function normalizeModelId(modelId: string): string {
  return modelId.trim();
}

/** Free-ness is based on OpenRouter's route/suffix contract, not a business model ID. */
export function isOpenRouterFreeModelId(modelId: string): boolean {
  const normalized = normalizeModelId(modelId);
  return normalized === OPENROUTER_FREE_ROUTE || normalized.endsWith(':free');
}

function isZeroPrice(value: unknown): boolean {
  if (typeof value === 'number') return value === 0;
  if (typeof value !== 'string' || value.trim() === '') return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed === 0;
}

function hasFreePricing(record: OpenRouterRawModel): boolean {
  const pricing = record.pricing;
  if (!pricing || pricing.prompt === undefined || pricing.completion === undefined) {
    return true;
  }

  return isZeroPrice(pricing.prompt) && isZeroPrice(pricing.completion);
}

function isExplicitlyFree(record: OpenRouterRawModel): boolean {
  return isOpenRouterFreeModelId(record.id) && hasFreePricing(record);
}

function hasNamedCapability(record: OpenRouterRawModel, names: readonly string[]): boolean {
  const values = [
    ...(record.supported_parameters ?? []),
    ...Object.keys(record.capabilities ?? {}),
  ].map((value) => value.toLowerCase().replace(/[-\s]/g, '_'));

  return names.some((name) => values.includes(name));
}

function explicitCapability(
  record: OpenRouterRawModel,
  names: readonly string[],
): boolean | undefined {
  const capabilities = record.capabilities;
  if (!capabilities) return undefined;

  for (const name of names) {
    const value = capabilities[name];
    if (typeof value === 'boolean') return value;
  }

  return undefined;
}

function outputModalities(record: OpenRouterRawModel): readonly string[] {
  return [
    ...(record.output_modalities ?? []),
    ...(record.architecture?.output_modalities ?? []),
  ].map((value) => value.toLowerCase());
}

function hasImageOutput(record: OpenRouterRawModel): boolean {
  const modality = record.architecture?.modality?.toLowerCase() ?? '';
  const output = modality.includes('->') ? modality.split('->').slice(1).join('->') : modality;
  const explicit = explicitCapability(record, ['image_output', 'imageOutput', 'image-output']);
  const declared = outputModalities(record).some(
    (value) => value === 'image' || value.includes('image'),
  );
  return explicit ?? (declared || /(?:^|[+ ,])image(?:$|[+ ,])/.test(output));
}

function deriveCapabilities(record: OpenRouterRawModel): ModelCapabilities {
  const structuredOutput =
    explicitCapability(record, ['structured_outputs', 'structured_output', 'structuredOutput']) ??
    hasNamedCapability(record, ['response_format', 'structured_outputs', 'structured_output']);
  const toolCalls =
    explicitCapability(record, ['tool_calls', 'tool_call', 'tools', 'toolCalls']) ??
    hasNamedCapability(record, ['tools', 'tool_choice', 'tool_calls', 'parallel_tool_calls']);

  return {
    structuredOutput,
    toolCalls,
    imageOutput: hasImageOutput(record),
  };
}

function readRawModels(payload: unknown): readonly OpenRouterRawModel[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as { readonly data?: unknown }).data;
  if (!Array.isArray(data)) return [];

  return data.filter((record): record is OpenRouterRawModel => {
    if (!record || typeof record !== 'object') return false;
    const id = (record as { readonly id?: unknown }).id;
    return typeof id === 'string' && id.trim().length > 0;
  });
}

function snapshotVersion(records: readonly OpenRouterModelDescriptor[]): string {
  const serialized = JSON.stringify(records);
  return createHash('sha256').update(serialized).digest('hex').slice(0, 16);
}

function dynamicRouteDescriptor(capabilities: ModelCapabilities): OpenRouterModelDescriptor {
  return {
    id: OPENROUTER_FREE_ROUTE,
    free: true,
    dynamic: true,
    capabilities,
    source: 'dynamic_route',
  };
}

function normalizeCapabilities(capabilities?: Partial<ModelCapabilities>): ModelCapabilities {
  return {
    ...DEFAULT_DYNAMIC_ROUTE_CAPABILITIES,
    ...capabilities,
  };
}

/**
 * Builds an immutable, versioned snapshot from the OpenRouter models response.
 * Only free-marked models are retained; paid model IDs never enter the snapshot.
 */
export function createOpenRouterCatalogSnapshot(
  payload: unknown,
  options: OpenRouterCatalogFetchOptions = {},
): OpenRouterCatalogSnapshot {
  const records = readRawModels(payload)
    .filter(isExplicitlyFree)
    .map<OpenRouterModelDescriptor>((record) => ({
      id: normalizeModelId(record.id),
      name: typeof record.name === 'string' ? record.name : undefined,
      free: true,
      dynamic: false,
      capabilities: deriveCapabilities(record),
      source: 'catalog',
    }));
  const routeDescriptor = dynamicRouteDescriptor(
    normalizeCapabilities(options.dynamicRouteCapabilities),
  );
  const models = [
    routeDescriptor,
    ...records.filter((record) => record.id !== OPENROUTER_FREE_ROUTE),
  ];
  const fetchedAt = options.fetchedAt ?? new Date().toISOString();

  return {
    version: options.version ?? snapshotVersion(models),
    fetchedAt,
    source: 'openrouter_models_api',
    status: 'ready',
    models,
  };
}

export function createStaticOpenRouterCatalogSnapshot(
  models: readonly OpenRouterModelDescriptor[],
  options: { readonly version: string; readonly fetchedAt?: string } = { version: 'static-1' },
): OpenRouterCatalogSnapshot {
  return {
    version: options.version,
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
    source: 'static',
    status: 'ready',
    models: models.filter((model) => model.free && isOpenRouterFreeModelId(model.id)),
  };
}

function requiredCapabilities(
  requirements: ModelCapabilityRequirements,
): readonly ModelCapability[] {
  return CAPABILITIES.filter((capability) => requirements[capability] === true);
}

function missingCapabilities(
  descriptor: OpenRouterModelDescriptor,
  requirements: ModelCapabilityRequirements,
): readonly ModelCapability[] {
  return requiredCapabilities(requirements).filter(
    (capability) => descriptor.capabilities[capability] !== true,
  );
}

export function selectOpenRouterModel(
  state: OpenRouterCatalogState | undefined,
  requirements: ModelCapabilityRequirements,
  requestedModel = OPENROUTER_FREE_ROUTE,
): ModelSelection {
  const normalizedRequestedModel = normalizeModelId(requestedModel) || OPENROUTER_FREE_ROUTE;
  const base = {
    requestedModel: normalizedRequestedModel,
    missingCapabilities: [] as readonly ModelCapability[],
    manualFallback: true as const,
  };

  if (!state || state.status === 'not_configured') {
    return { ...base, status: 'configuration_missing' };
  }
  if (state.status === 'rate_limited') {
    return { ...base, status: 'rate_limited', catalogVersion: state.snapshot?.version };
  }
  if (state.status === 'unavailable' || !state.snapshot) {
    return { ...base, status: 'unavailable', catalogVersion: state.snapshot?.version };
  }

  const descriptor = state.snapshot.models.find((model) => model.id === normalizedRequestedModel);
  if (!descriptor) {
    return {
      ...base,
      status: 'unavailable',
      catalogVersion: state.snapshot.version,
    };
  }

  const missing = missingCapabilities(descriptor, requirements);
  if (missing.length > 0) {
    return {
      ...base,
      status: 'capability_insufficient',
      capabilities: descriptor.capabilities,
      missingCapabilities: missing,
      catalogVersion: state.snapshot.version,
    };
  }

  return {
    ...base,
    status: 'selected',
    selectedModelId: descriptor.id,
    capabilities: descriptor.capabilities,
    catalogVersion: state.snapshot.version,
  };
}

export function validateActualOpenRouterModel(
  state: OpenRouterCatalogState,
  actualModelId: string,
  requirements: ModelCapabilityRequirements,
): ModelSelection {
  return selectOpenRouterModel(state, requirements, actualModelId);
}

export async function refreshOpenRouterCatalog(
  fetcher: OpenRouterCatalogFetcher,
  options: OpenRouterCatalogFetchOptions = {},
  previousSnapshot?: OpenRouterCatalogSnapshot,
): Promise<OpenRouterCatalogState> {
  try {
    const payload = await fetcher.fetchModels({ signal: options.signal });
    return {
      status: 'ready',
      snapshot: createOpenRouterCatalogSnapshot(payload, options),
    };
  } catch (error) {
    if (error instanceof OpenRouterCatalogRequestError) {
      return { status: error.status, snapshot: previousSnapshot };
    }
    return { status: 'unavailable', snapshot: previousSnapshot };
  }
}

export function createOpenRouterCatalogFetcher(
  config: Pick<ServerConfiguration['openRouter'], 'apiKey' | 'baseUrl'>,
): OpenRouterCatalogFetcher {
  return {
    async fetchModels(options = {}) {
      if (!config.apiKey) {
        throw new OpenRouterCatalogRequestError('not_configured');
      }

      let response: Response;
      try {
        response = await fetch(`${config.baseUrl}/models`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            Accept: 'application/json',
          },
          signal: options.signal,
        });
      } catch {
        throw new OpenRouterCatalogRequestError('unavailable');
      }

      if (response.status === 429) {
        throw new OpenRouterCatalogRequestError('rate_limited');
      }
      if (!response.ok) {
        throw new OpenRouterCatalogRequestError('unavailable');
      }

      try {
        return await response.json();
      } catch {
        throw new OpenRouterCatalogRequestError('unavailable');
      }
    },
  };
}

type OpenRouterRawModel = {
  readonly id: string;
  readonly name?: unknown;
  readonly pricing?: {
    readonly prompt?: unknown;
    readonly completion?: unknown;
  };
  readonly supported_parameters?: readonly string[];
  readonly capabilities?: Readonly<Record<string, unknown>>;
  readonly output_modalities?: readonly string[];
  readonly architecture?: {
    readonly modality?: string;
    readonly output_modalities?: readonly string[];
  };
};

export class OpenRouterModelCatalog {
  private state: OpenRouterCatalogState;

  constructor(state: OpenRouterCatalogState = { status: 'not_configured' }) {
    this.state = state;
  }

  getState(): OpenRouterCatalogState {
    return this.state;
  }

  setState(state: OpenRouterCatalogState): void {
    this.state = state;
  }

  async refresh(
    fetcher: OpenRouterCatalogFetcher,
    options: OpenRouterCatalogFetchOptions = {},
  ): Promise<OpenRouterCatalogState> {
    this.state = await refreshOpenRouterCatalog(fetcher, options, this.state.snapshot);
    return this.state;
  }

  select(
    requirements: ModelCapabilityRequirements,
    requestedModel = OPENROUTER_FREE_ROUTE,
  ): ModelSelection {
    return selectOpenRouterModel(this.state, requirements, requestedModel);
  }

  validateActual(actualModelId: string, requirements: ModelCapabilityRequirements): ModelSelection {
    return validateActualOpenRouterModel(this.state, actualModelId, requirements);
  }
}
