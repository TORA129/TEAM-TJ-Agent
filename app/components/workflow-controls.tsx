'use client';

import { useState } from 'react';

export type SourceAuditItem = {
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
  readonly tone?: 'ready' | 'waiting' | 'attention' | 'neutral';
};

type WorkflowControlsProps = {
  readonly version: number;
  readonly confirmEndpoint?: string;
  readonly exportEndpoint?: string;
  readonly entityLabel: string;
  readonly onSaved?: () => void;
};

export function WorkflowControls({
  version,
  confirmEndpoint,
  exportEndpoint,
  entityLabel,
  onSaved,
}: WorkflowControlsProps) {
  const [busy, setBusy] = useState<'confirm' | 'export' | null>(null);
  const [message, setMessage] = useState<string>('');

  async function run(action: 'confirm' | 'export') {
    const endpoint = action === 'confirm' ? confirmEndpoint : exportEndpoint;
    if (!endpoint) {
      setMessage(action === 'confirm' ? '确认接口尚未配置，请保留人工确认记录。' : '导出接口尚未配置，当前不可导出。');
      return;
    }
    setBusy(action);
    setMessage('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-idempotency-key': `${action}-${version}` },
        credentials: 'same-origin',
        body: JSON.stringify({ version, expectedVersion: version }),
      });
      const body = (await response.json()) as { message?: string; action?: string };
      if (!response.ok) {
        setMessage(body.message ?? body.action ?? '操作未完成，请检查版本或稍后重试。');
        return;
      }
      setMessage(action === 'confirm' ? `${entityLabel} v${version} 已记录确认审计。` : '已请求脱敏导出。');
      onSaved?.();
    } catch {
      setMessage('服务暂时不可用，请刷新后重试或改用人工回退。');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="workflow-controls" aria-label={`${entityLabel}版本操作`}>
      <span className="version-badge">当前版本 v{version}</span>
      <button className="button-primary" type="button" disabled={busy !== null} onClick={() => void run('confirm')}>
        {busy === 'confirm' ? '确认中…' : '确认此版本'}
      </button>
      <button className="button-secondary" type="button" disabled={busy !== null} onClick={() => void run('export')}>
        {busy === 'export' ? '准备导出…' : '导出脱敏内容'}
      </button>
      {message && <p className="form-note" role="status">{message}</p>}
    </div>
  );
}

export function ManualEditor({
  id,
  label,
  initialValue = '',
  hint,
  onSave,
}: {
  readonly id: string;
  readonly label: string;
  readonly initialValue?: string;
  readonly hint?: string;
  readonly onSave?: (value: string) => Promise<void> | void;
}) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function save() {
    if (!value.trim()) {
      setMessage('请输入内容后再保存。');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      await onSave?.(value.trim());
      setMessage('已保存人工编辑；旧版本保持只读。');
    } catch {
      setMessage('保存失败，请保留内容并稍后重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="manual-editor">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} value={value} onChange={(event) => setValue(event.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} />
      {hint && <p className="field-hint" id={`${id}-hint`}>{hint}</p>}
      <div className="card-actions">
        <button className="button-secondary" type="button" disabled={saving} onClick={() => void save()}>
          {saving ? '保存中…' : '保存人工编辑'}
        </button>
        {message && <span className="form-note" role="status">{message}</span>}
      </div>
    </div>
  );
}
