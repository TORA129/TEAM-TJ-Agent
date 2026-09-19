'use client';

import { useState } from 'react';
import { Field, SectionCard, StatusPill } from '../components/team-tj-ui';

type MetricKey = 'EXPOSURE' | 'CTR' | 'READ_SECONDS' | 'COMPLETION_RATE' | 'LIKE_RATE' | 'SAVE_RATE' | 'COMMENT_RATE' | 'FOLLOWERS';
type Metric = { metricType: MetricKey; value: number | null; unit: 'COUNT' | 'BASIS_POINTS' | 'SECONDS' };
type ReviewState = { id: string; version: number; status: string; noteUrl?: { raw: string; normalized: string }; limitations?: string[] };
type ResultState = { result?: { colorConclusion?: string; coreExcellentCount?: number; metricAssessments?: Array<{ metricType: string; value?: number; outcome?: string; boundary?: boolean; sourceRecordId?: string }>; observableConclusions?: string[]; needsHumanConfirmation?: string[]; notEvaluable?: string[]; markdownTemplate?: string; sourceRecordIds?: string[] } };

const metricConfig: Array<{ key: MetricKey; label: string; unit: Metric['unit']; hint: string }> = [
  { key: 'EXPOSURE', label: '曝光', unit: 'COUNT', hint: '次数' },
  { key: 'CTR', label: '点击率', unit: 'BASIS_POINTS', hint: '例如 12.5 表示 12.5%' },
  { key: 'READ_SECONDS', label: '阅读时长', unit: 'SECONDS', hint: '秒' },
  { key: 'COMPLETION_RATE', label: '完播率', unit: 'BASIS_POINTS', hint: '仅供人工复盘，不自动设阈值' },
  { key: 'LIKE_RATE', label: '点赞率', unit: 'BASIS_POINTS', hint: '百分比' },
  { key: 'SAVE_RATE', label: '收藏率', unit: 'BASIS_POINTS', hint: '百分比' },
  { key: 'COMMENT_RATE', label: '评论率', unit: 'BASIS_POINTS', hint: '百分比' },
  { key: 'FOLLOWERS', label: '涨粉数', unit: 'COUNT', hint: '人数' },
];

function requestHeaders(idempotency = false, version?: number) {
  return { 'content-type': 'application/json', ...(idempotency ? { 'x-idempotency-key': crypto.randomUUID() } : {}), ...(version !== undefined ? { 'x-expected-version': String(version) } : {}) };
}

export function ReviewWorkspace() {
  const [url, setUrl] = useState('');
  const [toolId, setToolId] = useState('');
  const [purpose, setPurpose] = useState('用于本次笔记复盘');
  const [accountMode, setAccountMode] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [manual, setManual] = useState({ title: '', body: '', coverDescription: '' });
  const [metrics, setMetrics] = useState<Record<MetricKey, string>>({ EXPOSURE: '', CTR: '', READ_SECONDS: '', COMPLETION_RATE: '', LIKE_RATE: '', SAVE_RATE: '', COMMENT_RATE: '', FOLLOWERS: '' });
  const [thresholdVersion, setThresholdVersion] = useState(1);
  const [result, setResult] = useState<ResultState['result']>();
  const [message, setMessage] = useState('尚未创建复盘会话');
  const [busy, setBusy] = useState(false);

  async function createReview() {
    setBusy(true); setMessage('正在创建复盘会话…');
    try {
      const response = await fetch('/api/reviews', { method: 'POST', headers: requestHeaders(true), body: JSON.stringify({ noteUrl: url }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? '无法创建复盘会话');
      setReview({ ...body.review, version: body.review.currentVersion ?? 0 }); setMessage('复盘会话已创建，等待授权确认');
    } catch (error) { setMessage(error instanceof Error ? error.message : '请求失败，请改用人工输入'); }
    finally { setBusy(false); }
  }

  async function saveAuthorization() {
    if (!review || !authorized || !toolId || !accountMode) return setMessage('请先完成精确 URL、工具、目的、账号状态和确认勾选');
    setBusy(true);
    try {
      const response = await fetch(`/api/reviews/${review.id}`, { method: 'PATCH', headers: requestHeaders(true, review.version), body: JSON.stringify({ exactNoteUrl: url, toolId, purpose, accountMode: accountMode === 'authorized' ? 'AUTHORIZED_ACCOUNT' : 'PUBLIC_ACCESS', confirmedAt: new Date().toISOString() }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? '授权确认失败');
      setReview({ ...body.review, version: body.review.currentVersion ?? review.version + 1 }); setMessage('授权确认已保存，可以按确认权限访问');
    } catch (error) { setMessage(error instanceof Error ? error.message : '授权确认失败'); }
    finally { setBusy(false); }
  }

  async function saveManual() {
    if (!review) { setMessage('请先创建复盘会话'); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/reviews/${review.id}/manual-content`, { method: 'POST', headers: requestHeaders(true, review.version), body: JSON.stringify({ ...manual, metricValues: {} }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? '人工内容保存失败');
      setReview({ ...review, version: body.manualContent?.version ?? review.version + 1, status: 'MANUAL_INPUT' }); setMessage('人工内容已保存，来源已记录');
    } catch (error) { setMessage(error instanceof Error ? error.message : '人工内容保存失败'); }
    finally { setBusy(false); }
  }

  async function saveMetrics() {
    if (!review) { setMessage('请先创建复盘会话'); return; }
    const items: Metric[] = metricConfig.filter(({ key }) => metrics[key] !== '').map(({ key, unit }) => ({ metricType: key, unit, value: Number(metrics[key]) }));
    if (!items.length) { setMessage('至少输入一个指标；缺失指标不会被推断'); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/reviews/${review.id}/metrics`, { method: 'PATCH', headers: requestHeaders(true, review.version), body: JSON.stringify({ metrics: items }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? '指标保存失败');
      setReview({ ...review, version: Math.max(review.version + 1, ...(body.metrics ?? []).map((item: { version: number }) => item.version)) }); setMessage('指标版本已保存；每项值都带有人工来源');
    } catch (error) { setMessage(error instanceof Error ? error.message : '指标保存失败'); }
    finally { setBusy(false); }
  }

  async function evaluate() {
    if (!review) { setMessage('请先创建复盘会话'); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/reviews/${review.id}/evaluate`, { method: 'POST', headers: requestHeaders(false, review.version), body: JSON.stringify({}) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? '评估失败');
      setResult(body.result); setReview({ ...review, version: body.result?.version ?? review.version + 1, status: body.result?.colorConclusion ?? 'NEEDS_HUMAN_INPUT' }); setMessage('复盘结果已生成；完播率仍需人工复盘');
    } catch (error) { setMessage(error instanceof Error ? error.message : '评估失败，请检查指标和版本'); }
    finally { setBusy(false); }
  }

  return <>
    <SectionCard eyebrow="01 / Access boundary" title="先确认允许的访问方式" description="没有精确 URL、工具、目的和账号/公开状态确认时，不发起访问，并始终提供人工输入回退。">
      <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void createReview(); }}>
        <div className="form-grid-wide"><Field id="note-url" label="笔记网址 Note URL" hint="只提交你有权访问的精确小红书笔记地址。"><input id="note-url" type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.xiaohongshu.com/explore/..." /></Field></div>
        <Field id="tool-id" label="授权工具标识"><input id="tool-id" value={toolId} onChange={(event) => setToolId(event.target.value)} placeholder="已配置的 OpenCLI 工具" /></Field>
        <Field id="purpose" label="访问目的"><input id="purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)} /></Field>
        <Field id="account-mode" label="账号或公开访问状态"><select id="account-mode" value={accountMode} onChange={(event) => setAccountMode(event.target.value)}><option value="">请选择当前状态</option><option value="public">公开访问</option><option value="authorized">已登录且获授权账号</option></select></Field>
        <div className="form-grid-wide"><label className="check-row" htmlFor="authorization-confirmed"><input id="authorization-confirmed" type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} /><span>我确认以上信息与本次访问一致，并理解平台限制不会被绕过。</span></label></div>
        <div className="form-actions form-grid-wide"><button className="button-primary" type="submit" disabled={busy}>{review ? '刷新会话' : '创建复盘会话'}</button><button className="button-secondary" type="button" onClick={() => void saveAuthorization()} disabled={busy || !review}>保存授权确认</button></div>
      </form>
      <div className="inline-status inline-status-warning" role="status"><span className="dot-icon" aria-hidden="true" /><div><strong>{message}</strong><p>账号登录、公开访问性和平台条款限制会随来源一起保留；系统不绕过登录、付费墙或反爬机制。</p></div></div>
    </SectionCard>

    <SectionCard id="manual-input" eyebrow="02 / Manual fallback" title="无法访问时，保留人工入口" description="可人工粘贴标题、正文、封面描述；保存后内容会标记为 Manual_Content_Input。">
      <div className="form-grid"><Field id="manual-title" label="人工输入的标题"><input id="manual-title" value={manual.title} onChange={(event) => setManual({ ...manual, title: event.target.value })} placeholder="粘贴或输入笔记标题" /></Field><Field id="manual-cover" label="封面描述"><input id="manual-cover" value={manual.coverDescription} onChange={(event) => setManual({ ...manual, coverDescription: event.target.value })} placeholder="描述封面视觉与标题" /></Field><div className="form-grid-wide"><Field id="manual-body" label="人工输入的正文"><textarea id="manual-body" value={manual.body} onChange={(event) => setManual({ ...manual, body: event.target.value })} placeholder="粘贴允许用于复盘的内容" /></Field></div><div className="form-actions form-grid-wide"><button className="button-secondary" type="button" onClick={() => void saveManual()} disabled={busy}>保存人工内容</button><StatusPill tone={review?.status === 'MANUAL_INPUT' ? 'ready' : 'waiting'}>{review?.status === 'MANUAL_INPUT' ? '已保存并可复盘' : '等待输入'}</StatusPill></div></div>
    </SectionCard>

    <SectionCard id="review-metrics" eyebrow="03 / Metrics" title="八类指标与阈值边界" description="缺失值保持为需要人工输入；完播率不会获得系统默认阈值。">
      <div className="metric-list" aria-label="复盘指标列表">{metricConfig.map(({ key, label, hint }) => <div className="metric-row" key={key}><label htmlFor={`metric-${key}`}>{label}</label><input id={`metric-${key}`} aria-label={`${label}指标值`} inputMode="decimal" value={metrics[key]} onChange={(event) => setMetrics({ ...metrics, [key]: event.target.value })} placeholder="未输入" /><StatusPill tone={key === 'COMPLETION_RATE' ? 'neutral' : metrics[key] ? 'ready' : 'waiting'}>{key === 'COMPLETION_RATE' ? '供人工复盘' : metrics[key] ? '已提供' : '需要人工输入'}</StatusPill><small>{hint}</small></div>)}</div>
      <div className="card-actions"><label className="field-group compact-field" htmlFor="threshold-version"><span>阈值集版本</span><input id="threshold-version" type="number" min="1" value={thresholdVersion} onChange={(event) => setThresholdVersion(Number(event.target.value) || 1)} /></label><button className="button-primary" type="button" onClick={() => void saveMetrics()} disabled={busy}>保存指标版本</button><button className="button-primary" type="button" onClick={() => void evaluate()} disabled={busy || !review}>生成复盘结果</button></div>
    </SectionCard>

    <SectionCard eyebrow="04 / Result" title="结果、建议与模板" description="结果区分可观察结论、需要人工确认和无法评估，并显示来源记录。">
      {!result ? <div className="empty-state"><h3>尚无复盘结果</h3><p>保存人工内容或指标后生成评估；全缺失时不会输出颜色结论。</p></div> : <div className="result-stack"><div className="inline-status" role="status"><span className="dot-icon" aria-hidden="true" /><div><strong>{result.colorConclusion ?? '需要人工输入核心优秀指标'}</strong><p>核心优秀指标：{result.coreExcellentCount ?? 0} 项；完播率不改变总体计数。</p></div></div><div className="result-columns"><div><h3>可观察结论</h3><ul>{(result.observableConclusions ?? []).map((item) => <li key={item}>{item}</li>)}</ul></div><div><h3>需要人工确认</h3><ul>{(result.needsHumanConfirmation ?? []).map((item) => <li key={item}>{item}</li>)}</ul></div><div><h3>无法评估</h3><ul>{(result.notEvaluable ?? []).map((item) => <li key={item}>{item}</li>)}</ul></div></div><label className="field-group" htmlFor="review-template"><span>Markdown 复盘模板</span><textarea id="review-template" readOnly value={result.markdownTemplate ?? '模板将在建议服务接入后显示。'} /></label><p className="form-note">Source_Record：{result.sourceRecordIds?.join(', ') || '等待生成'}</p></div>}
    </SectionCard>

    <SectionCard eyebrow="05 / Insight memory" title="保存合规洞察" description="洞察保存前必须经过禁词和来源检查；当前页面保留人工选择与可追溯入口。"><Field id="insight-text" label="复盘洞察"><textarea id="insight-text" placeholder="选择一条可复用、可验证且不含禁词的洞察" /></Field><div className="card-actions"><button className="button-secondary" type="button" disabled={!review || !result}>检查并保存洞察</button><StatusPill tone="neutral">来源闭包必需</StatusPill></div></SectionCard>
  </>;
}

export function reviewerSourceItems(review: ReviewState | null, result?: ResultState['result']) {
  return [
    { label: 'Note URL', value: review?.noteUrl?.normalized ?? '未提交', tone: review ? 'ready' as const : 'waiting' as const },
    { label: '访问限制', value: review?.limitations?.length ? `${review.limitations.length} 项` : '等待读取', tone: review ? 'neutral' as const : 'waiting' as const },
    { label: '结果状态', value: result?.colorConclusion ?? '尚无结果', tone: result ? 'ready' as const : 'waiting' as const },
    { label: '人工控制', value: '始终保留', tone: 'neutral' as const },
  ];
}
