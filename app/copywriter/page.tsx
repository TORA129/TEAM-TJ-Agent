'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Field, SectionCard, SourcePanel, StatusPill, WorkspaceShell } from '../components/team-tj-ui';

type Brief = Record<string, string> & { missingFields?: string[]; sourceRecordIds?: string[]; version?: number };
type Session = { id: string; status: string; currentVersion: number; brief: Brief };
type QuestionSet = { id: string; questions: string[]; answers: (string | null)[]; status: string; version: number };
type Draft = Record<string, unknown> & { version?: number; validationStatus?: string; complianceStatus?: string; needsOperatorConfirmation?: boolean; sourceRecordIds?: string[]; titles?: string[]; bodyPoints?: string[]; tags?: string[]; tagBuckets?: { broad?: string[]; medium?: string[]; longTail?: string[] } };
type Cover = { brief?: Record<string, unknown>; asset?: Record<string, unknown>; fallback?: { required: boolean; action: string } };

const fields = ['subject', 'targetAudience', 'coreOutcome', 'painPoint', 'method', 'parameters', 'realLimitation', 'closingAction'] as const;
const labels: Record<string, string> = { subject: '创作主题', targetAudience: '目标人群', coreOutcome: '核心结果', painPoint: '具体痛点', method: '可复制方法', parameters: '数字 / 参数', realLimitation: '真实缺点', closingAction: '结尾行动' };

function key(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

export default function CopywriterPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [brief, setBrief] = useState<Brief>({});
  const [questions, setQuestions] = useState<QuestionSet | null>(null);
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [cover, setCover] = useState<Cover | null>(null);
  const [blockedTerms, setBlockedTerms] = useState('');
  const [fileName, setFileName] = useState('未上传');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('填写 Content Brief 后开始。');

  const status = useMemo(() => {
    if (cover?.asset && (cover.asset.status === 'READY' || cover.asset.status === 'REPLACEMENT')) return ['已生成封面', 'ready'] as const;
    if (cover?.fallback?.required) return ['封面失败，可替换', 'attention'] as const;
    if (draft?.complianceStatus === 'FAILED') return ['合规问题', 'attention'] as const;
    if (draft?.needsOperatorConfirmation) return ['需要 Operator 确认', 'attention'] as const;
    if (draft) return ['需要重新检查', 'waiting'] as const;
    if (questions) return ['等待补充', 'waiting'] as const;
    return ['等待输入', 'waiting'] as const;
  }, [cover, draft, questions]);

  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    headers.set('x-idempotency-key', key('copywriter'));
    const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message ?? body.action ?? '请求未完成');
    return body;
  }

  async function saveBrief(event: FormEvent) {
    event.preventDefault(); setBusy('brief'); setMessage('正在保存 Content Brief…');
    try {
      const body = { brief, blockedTermListIds: [], supplementaryFileIds: [], insightMemoryIds: [], operatorProvidedFields: fields.filter((field) => brief[field]?.trim()) };
      const result = session
        ? await request(`/api/copywriter/sessions/${session.id}`, { method: 'PATCH', headers: { 'x-expected-version': String(session.currentVersion) }, body: JSON.stringify({ ...body, editReason: 'Operator 更新 Content Brief' }) })
        : await request('/api/copywriter/sessions', { method: 'POST', body: JSON.stringify(body) });
      setSession(result.session); setBrief(result.session.brief); setMessage('已保存版本，可开始诊断缺失字段。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败，请人工保留输入后重试。'); }
    finally { setBusy(''); }
  }

  async function diagnose() {
    if (!session) { setMessage('请先保存 Content Brief。'); return; }
    setBusy('questions');
    try {
      const result = await request(`/api/copywriter/sessions/${session.id}/questions`, { method: 'POST', headers: { 'x-expected-version': String(session.currentVersion) }, body: JSON.stringify({ action: 'DIAGNOSE' }) });
      setSession(result.session); setQuestions(result.questionSet ?? null); setMessage(result.waitingForAnswers ? '请回答恰好 3 个问题。' : '信息已完整，可以生成草稿。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '诊断失败。'); } finally { setBusy(''); }
  }

  async function answerQuestions() {
    if (!session || !questions || answers.some((answer) => !answer.trim())) { setMessage('三个问题都需要回答。'); return; }
    setBusy('questions');
    try {
      const result = await request(`/api/copywriter/sessions/${session.id}/questions`, { method: 'POST', headers: { 'x-expected-version': String(session.currentVersion) }, body: JSON.stringify({ action: 'ANSWER', questionSetId: questions.id, answers }) });
      setSession(result.session); setBrief(result.session.brief); setQuestions(result.questionSet?.status === 'OPEN' ? result.questionSet : null); setMessage('三问已保存，可以生成结构化草稿。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '回答保存失败。'); } finally { setBusy(''); }
  }

  async function generateDraft() {
    if (!session) return;
    setBusy('draft');
    try { const result = await request(`/api/copywriter/sessions/${session.id}/draft/generate`, { method: 'POST', body: JSON.stringify({ contentType: 'tutorial' }) }); setDraft(result.draft); setMessage('草稿已生成，请逐条检查规则与来源。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '草稿生成失败，可改用人工编辑。'); } finally { setBusy(''); }
  }

  async function saveDraft() {
    if (!session || !draft) return;
    setBusy('edit');
    try { const result = await request(`/api/copywriter/sessions/${session.id}/draft`, { method: 'PATCH', headers: { 'x-expected-version': String(draft.version ?? session.currentVersion) }, body: JSON.stringify({ draft, editReason: 'Operator 人工编辑草稿' }) }); setDraft(result.draft); setMessage('人工编辑已保存，旧版本保持只读。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '草稿编辑失败。'); } finally { setBusy(''); }
  }

  async function generateCover() {
    if (!session || !draft) return;
    setBusy('cover');
    try { const result = await request(`/api/copywriter/sessions/${session.id}/cover/generate`, { method: 'POST', body: JSON.stringify({ title: String(draft.titles?.[0] ?? '小红书运营方法'), limitationOrCaveat: String(draft.realLimitation ?? ''), visualStyle: 'clean editorial, human-made, generous whitespace', illustrationDescription: '与主题相关的小插画' }) }); setCover(result); setMessage(result.fallback?.required ? '封面生成失败，请重新生成或上传 3:4 替代封面。' : '实际封面已生成，可审阅或替换。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '封面生成失败，Cover Brief 已保留。'); } finally { setBusy(''); }
  }

  async function confirm() {
    if (!session || !draft?.version) return;
    setBusy('confirm');
    try { await request(`/api/copywriter/sessions/${session.id}/confirm`, { method: 'POST', body: JSON.stringify({ version: draft.version }) }); setMessage(`草稿 v${draft.version} 已记录确认审计。`); setSession({ ...session, status: 'CONFIRMED' }); }
    catch (error) { setMessage(error instanceof Error ? error.message : '确认失败，请检查版本冲突。'); } finally { setBusy(''); }
  }

  return <WorkspaceShell active="copywriter" eyebrow="Copywriter Workspace" title="爆款文案写手" description="从真实 Content Brief 开始，逐步形成可审阅、可追溯、可确认的标题、正文、标签与封面。" status={status[0]} statusTone={status[1]} aside={<SourcePanel title="当前创作来源" items={[{ label: 'Content Brief', value: session ? `v${session.brief.version}` : '未创建', tone: session ? 'ready' : 'waiting' }, { label: '来源记录', value: String(draft?.sourceRecordIds?.length ?? session?.brief.sourceRecordIds?.length ?? 0), tone: 'neutral' }, { label: '禁词清单', value: blockedTerms.trim() ? '已填写' : '未配置', tone: blockedTerms.trim() ? 'ready' : 'waiting' }, { label: '人工控制', value: '始终保留', tone: 'neutral' }]} />}>
    <SectionCard eyebrow="01 / Content Brief" title="先把事实说清楚" description="信息不足时进入固定三问，不自动补写业务事实。">
      <form className="form-grid" onSubmit={saveBrief}>
        {fields.map((field) => <Field key={field} id={field} label={labels[field]} hint={field === 'parameters' ? '只填写已验证的数字、工具或参数。' : undefined}><input id={field} value={brief[field] ?? ''} onChange={(event) => setBrief({ ...brief, [field]: event.target.value })} placeholder={`填写${labels[field]}`} /></Field>)}
        <div className="form-grid-wide"><Field id="blocked-terms" label="禁词清单（可选）" hint="当前 UI 保留清单输入；匹配结果会绑定清单来源与版本。"><input id="blocked-terms" value={blockedTerms} onChange={(event) => setBlockedTerms(event.target.value)} placeholder="例如：必看，最强，私信" /></Field></div>
        <div className="form-grid-wide"><Field id="supplementary-file" label="补充材料（可选）" hint="文件上传接口会在会话创建后启用。"><input id="supplementary-file" type="file" onChange={(event) => setFileName(event.target.files?.[0]?.name ?? '未上传')} /><p className="field-hint">{fileName}</p></Field></div>
        <div className="form-actions form-grid-wide"><button className="button-primary" type="submit" disabled={!!busy}>{busy === 'brief' ? '保存中…' : '保存当前版本'}</button><button className="button-secondary" type="button" disabled={!session || !!busy} onClick={() => void diagnose()}>诊断并进入三问</button><span className="form-note" role="status">{message}</span></div>
      </form>
    </SectionCard>

    <SectionCard id="questions" eyebrow="02 / Clarification" title="固定三问，补齐关键信息" description="Question Set 永远保留恰好 3 个问题，未回答前不会进入最终稿。">
      {questions ? <div className="form-grid">{questions.questions.map((question, index) => <div className="form-grid-wide" key={question}><Field id={`question-${index}`} label={`${index + 1}. ${question}`}><textarea id={`question-${index}`} value={answers[index]} onChange={(event) => setAnswers(answers.map((answer, item) => item === index ? event.target.value : answer))} /></Field></div>)}<div className="form-actions form-grid-wide"><button className="button-primary" type="button" disabled={!!busy} onClick={() => void answerQuestions()}>{busy === 'questions' ? '提交中…' : '提交三问回答'}</button><StatusPill tone="waiting">{questions.status === 'OPEN' ? '等待补充' : questions.status}</StatusPill></div></div> : <div className="empty-state"><span className="empty-grid" aria-hidden="true" /><h3>尚未创建 Question Set</h3><p>保存 brief 后点击诊断，服务端会返回恰好 3 个问题。</p></div>}
    </SectionCard>

    <SectionCard eyebrow="03 / Structured draft" title="结构化草稿与规则检查" description="草稿、来源和合规状态来自服务端；人工编辑会创建新版本。">
      {draft ? <><div className="form-grid">{['targetAudience', 'targetEmotion', 'opening', 'firstThreeLines', 'painPoint', 'method', 'realLimitation', 'body', 'interactionEnding'].map((field) => <div className="form-grid-wide" key={field}><Field id={`draft-${field}`} label={field}><textarea id={`draft-${field}`} value={String(draft[field] ?? '')} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} /></Field></div>)}<Field id="draft-titles" label="5 个标题（每行一个）"><textarea id="draft-titles" value={(draft.titles ?? []).join('\n')} onChange={(event) => setDraft({ ...draft, titles: event.target.value.split('\n').slice(0, 5) })} /></Field><Field id="draft-tags" label="8 个标签（每行一个）"><textarea id="draft-tags" value={(draft.tags ?? []).join('\n')} onChange={(event) => setDraft({ ...draft, tags: event.target.value.split('\n').slice(0, 8) })} /></Field></div><div className="rule-list"><div className="rule-row"><span>结构校验</span><StatusPill tone={draft.validationStatus === 'PASSED' ? 'ready' : 'attention'}>{String(draft.validationStatus ?? '待检查')}</StatusPill></div><div className="rule-row"><span>合规检查</span><StatusPill tone={draft.complianceStatus === 'PASSED' ? 'ready' : 'waiting'}>{String(draft.complianceStatus ?? '需要重新检查')}</StatusPill></div><div className="rule-row"><span>Source_Record</span><StatusPill tone="neutral">{draft.sourceRecordIds?.length ?? 0} 条</StatusPill></div></div><div className="form-actions"><button className="button-secondary" type="button" disabled={!!busy} onClick={() => void saveDraft()}>{busy === 'edit' ? '保存中…' : '保存人工编辑'}</button><button className="button-primary" type="button" disabled={!!busy} onClick={() => void generateCover()}>生成实际 3:4 封面</button><button className="button-primary" type="button" disabled={!!busy || draft.complianceStatus !== 'PASSED'} onClick={() => void confirm()}>确认此版本</button></div></> : <><div className="empty-state"><span className="empty-grid" aria-hidden="true" /><h3>等待一份可验证的 Content Brief</h3><p>完成 brief 和三问后，服务端才会生成结构化草稿；不会用占位文案冒充结果。</p></div><div className="form-actions"><button className="button-primary" type="button" disabled={!session || !!questions || !!busy} onClick={() => void generateDraft()}>{busy === 'draft' ? '生成中…' : '生成结构化草稿'}</button></div></>}
    </SectionCard>

    <SectionCard eyebrow="04 / Cover" title="Cover Brief 与实际封面" description="只展示真实生成或人工上传的封面；失败时保留 Cover Brief 和替换入口。">
      {cover ? <div className="inline-status"><span className="dot-icon" aria-hidden="true" /><div><strong>{cover.asset ? `封面状态：${String(cover.asset.status)}` : '已保留 Cover Brief'}</strong><p>{cover.fallback?.required ? '生成失败：可重新生成、裁切或上传 3:4 替代封面。' : `画幅 ${String(cover.asset?.width ?? 0)} × ${String(cover.asset?.height ?? 0)}；来源记录已绑定。`}</p></div></div> : <div className="empty-state"><span className="empty-grid" aria-hidden="true" /><h3>合规后生成 Cover_Image</h3><p>这里不会显示占位图。完成草稿合规检查后才会请求实际封面。</p></div>}
    </SectionCard>
  </WorkspaceShell>;
}
