import 'server-only';

import { createHash } from 'node:crypto';
import type { AssetStorageService } from '@/adapters/object-storage/asset-storage-service';
import type { CoverAsset, CoverBrief, UUID } from '@/domain/persistence/models';
import type { PersistenceRepositories } from '@/domain/persistence/repositories';
import { ImmutableVersionService, SourceRecordService } from '@/domain/persistence/services';
import { PublicApplicationError } from '@/server/public-errors';
import { composeCoverImage, createCoverBrief, updateCoverBrief } from './cover-composer';
import type { CoverImageAdapter } from './cover-image';
import type { CoverGenerateInput, CoverPatchInput } from './schema';

export type CoverDto = Readonly<{
  brief?: CoverBriefDto;
  asset?: CoverAssetDto;
  fallback: { readonly required: boolean; readonly action: string };
}>;
export type CoverBriefDto = Omit<CoverBrief, 'createdAt'> & { readonly createdAt: string };
export type CoverAssetDto = Omit<CoverAsset, 'createdAt' | 'generatedAt'> & { readonly createdAt: string; readonly generatedAt?: string };

const notFound = () => new PublicApplicationError({ code: 'JOB_NOT_FOUND' });
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function briefDto(value: CoverBrief): CoverBriefDto { return { ...value, createdAt: value.createdAt.toISOString() }; }
function assetDto(value: CoverAsset): CoverAssetDto {
  const { createdAt, generatedAt, ...rest } = value;
  return { ...rest, createdAt: createdAt.toISOString(), ...(generatedAt ? { generatedAt: generatedAt.toISOString() } : {}) };
}
function dto(brief: CoverBrief | undefined, asset: CoverAsset | undefined): CoverDto {
  const failed = asset?.status === 'FAILED' || asset?.status === 'ARCHIVED';
  return { ...(brief ? { brief: briefDto(brief) } : {}), ...(asset ? { asset: assetDto(asset) } : {}), fallback: { required: failed, action: failed ? 'REGENERATE_OR_CROP_OR_UPLOAD' : 'NONE' } };
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 24 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export class CoverService {
  private readonly versions = new ImmutableVersionService();
  private readonly sources: SourceRecordService;
  constructor(
    private readonly repositories: PersistenceRepositories,
    private readonly storage: AssetStorageService,
    private readonly image: CoverImageAdapter,
    private readonly now = () => new Date(),
  ) { this.sources = new SourceRecordService(repositories.sourceRecords); }

  private async session(sessionId: UUID, operatorId: UUID) {
    const session = await this.repositories.workflowSessions.getById(sessionId);
    if (!session || session.operatorId !== operatorId || session.kind !== 'COPYWRITER') throw notFound();
    return session;
  }

  private async gate(sessionId: UUID, operatorId: UUID) {
    const session = await this.session(sessionId, operatorId);
    const draft = await this.repositories.copyDraftVersions.getLatestBySession(sessionId);
    if (!draft) throw notFound();
    if (draft.complianceStatus !== 'PASSED') throw new PublicApplicationError({ code: 'COMPLIANCE_BLOCKED' });
    return { session, draft };
  }

  private async current(sessionId: UUID, operatorId: UUID): Promise<CoverDto> {
    await this.session(sessionId, operatorId);
    const brief = await this.repositories.coverBriefs.getLatestBySession(sessionId);
    const page = await this.repositories.coverAssets.listBySession(sessionId, { limit: 1 });
    return dto(brief ?? undefined, page.items[0]);
  }

  async detail(input: { sessionId: UUID; operatorId: UUID }): Promise<CoverDto> { return this.current(input.sessionId, input.operatorId); }

  async generate(input: { sessionId: UUID; operatorId: UUID; request: CoverGenerateInput }): Promise<CoverDto> {
    const { session, draft } = await this.gate(input.sessionId, input.operatorId);
    const previous = await this.repositories.coverBriefs.getLatestBySession(session.id);
    const briefInput = createCoverBrief({ title: input.request.title, visualStyle: input.request.visualStyle ?? 'clean editorial', whitespaceRequirements: input.request.whitespaceRequirements, limitationOrCaveat: input.request.limitationOrCaveat ?? draft.realLimitation, illustrationDescription: input.request.illustrationDescription, logoText: input.request.logoText });
    const brief = await this.versions.append({ repository: this.repositories.coverBriefs, sessionId: session.id, expectedVersion: previous?.version ?? 0, input: { draftVersionId: draft.id, ...briefInput, sourceRecordIds: [...new Set([...draft.sourceRecordIds])] , contentHash: hash(briefInput), editedBy: input.operatorId } });
    let asset: CoverAsset | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3 && !asset; attempt += 1) {
      try {
        const visual = await this.image.generate({ subject: draft.targetAudience, visualMood: draft.targetEmotion, realLimitation: draft.realLimitation, style: brief.visualStyle });
        const composed = composeCoverImage(visual.bytes, brief);
        asset = await this.storage.storeCoverAsset({ sessionId: session.id, coverBriefVersionId: brief.id, width: composed.width, height: composed.height, origin: 'GENERATED', sourceRecordIds: [...brief.sourceRecordIds], bytes: composed.bytes, mimeType: composed.mimeType, generatedAt: this.now(), status: 'READY' });
      } catch (error) { lastError = error; }
    }
    if (!asset) {
      const error = lastError;
      const failure = await this.sources.create({ sourceType: 'MODEL_OUTPUT', sourceRef: `cover-failure:${session.id}:${brief.version}`, version: brief.version, capturedAt: this.now(), operatorId: input.operatorId, parentSourceRecordIds: [...brief.sourceRecordIds], accessLimitations: ['MODEL_FAILURE'], redactionStatus: 'NOT_REQUIRED' });
      asset = await this.repositories.coverAssets.create({ sessionId: session.id, coverBriefVersionId: brief.id, version: 1, status: 'FAILED', origin: 'GENERATED', editVersion: 0, sourceRecordIds: [failure.id], failureCode: error instanceof PublicApplicationError ? error.code : 'COVER_UNAVAILABLE', failureMessage: error instanceof PublicApplicationError ? error.message : 'Cover generation failed.' });
    }
    return dto(brief, asset);
  }

  async upload(input: { sessionId: UUID; operatorId: UUID; file: File; reason: string }): Promise<CoverDto> {
    const { session, draft } = await this.gate(input.sessionId, input.operatorId);
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    const dimensions = pngDimensions(bytes);
    if (!dimensions || dimensions.width * 4 !== dimensions.height * 3) throw new PublicApplicationError({ code: 'COVER_RATIO_INVALID' });
    const brief = await this.repositories.coverBriefs.getLatestBySession(session.id);
    if (!brief) throw notFound();
    const source = await this.sources.create({ sourceType: 'HUMAN_EDIT', sourceRef: `cover-upload:${session.id}:${input.file.name}`, version: brief.version, contentHash: createHash('sha256').update(bytes).digest('hex'), capturedAt: this.now(), operatorId: input.operatorId, parentSourceRecordIds: [...draft.sourceRecordIds], accessLimitations: ['PRIVATE_OBJECT_STORAGE'], redactionStatus: 'NOT_REQUIRED' });
    const asset = await this.storage.storeCoverAsset({ sessionId: session.id, coverBriefVersionId: brief.id, width: dimensions.width, height: dimensions.height, origin: 'OPERATOR_UPLOAD', sourceRecordIds: [source.id], bytes, mimeType: 'image/png', generatedAt: this.now(), status: 'REPLACEMENT', editVersion: 1 });
    return dto(brief, asset);
  }

  async patch(input: { sessionId: UUID; operatorId: UUID; request: CoverPatchInput }): Promise<CoverDto> {
    const { session, draft } = await this.gate(input.sessionId, input.operatorId);
    const previous = await this.repositories.coverBriefs.getLatestBySession(session.id);
    if (!previous) throw notFound();
    const next = updateCoverBrief({ ...previous, logoText: 'Team-TJ' }, input.request);
    const source = await this.sources.create({ sourceType: 'HUMAN_EDIT', sourceRef: `cover-edit:${session.id}:${previous.version + 1}`, version: previous.version + 1, capturedAt: this.now(), operatorId: input.operatorId, parentSourceRecordIds: [...previous.sourceRecordIds], accessLimitations: [], redactionStatus: 'NOT_REQUIRED' });
    const brief = await this.versions.append({ repository: this.repositories.coverBriefs, sessionId: session.id, expectedVersion: previous.version, input: { draftVersionId: draft.id, ...next, sourceRecordIds: [...new Set([...previous.sourceRecordIds, source.id])], contentHash: hash(next), editedBy: input.operatorId, editReason: input.request.editReason } });
    return dto(brief, (await this.repositories.coverAssets.listBySession(session.id, { limit: 1 })).items[0]);
  }
}
