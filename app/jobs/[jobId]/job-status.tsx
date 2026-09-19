'use client';

import { useEffect, useState } from 'react';

type JobStatusResponse = {
  readonly jobId: string;
  readonly status: string;
  readonly phase: string;
  readonly inputVersion: number;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly pollAfterMs: number;
  readonly fallback: {
    readonly required: boolean;
    readonly action: string;
    readonly errorCode?: string;
  };
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly action: string;
    readonly retryable: boolean;
  };
};

type PublicErrorResponse = {
  readonly code?: string;
  readonly message?: string;
  readonly action?: string;
};

const terminalPhases = new Set(['SUCCEEDED', 'MANUAL_FALLBACK']);

export function JobStatus({ jobId }: { readonly jobId: string }) {
  const [status, setStatus] = useState<JobStatusResponse | null>(null);
  const [error, setError] = useState<PublicErrorResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        const body = (await response.json()) as JobStatusResponse & PublicErrorResponse;
        if (cancelled) return;
        if (!response.ok) {
          setError(body);
          return;
        }
        setError(null);
        setStatus(body);
        if (!terminalPhases.has(body.phase)) {
          timer = setTimeout(poll, Math.max(500, body.pollAfterMs));
        }
      } catch {
        if (!cancelled) {
          setError({
            code: 'REQUEST_UNAVAILABLE',
            message: '任务状态暂时无法读取，请稍后刷新页面。',
            action: '刷新页面后重试',
          });
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  if (error) {
    return (
      <div className="inline-status" role="alert">
        <span className="dot-icon" aria-hidden="true" />
        <div>
          <strong>{error.message ?? '任务状态无法读取。'}</strong>
          <p>{error.action ?? '请刷新页面后重试。'}</p>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="inline-status" aria-live="polite">
        <span className="dot-icon" aria-hidden="true" />
        <div>
          <strong>正在恢复任务状态</strong>
          <p>正在从服务端读取持久化任务；刷新页面不会丢失当前输入版本。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="job-status-live" aria-live="polite">
      <div className="job-status-grid">
        <div>
          <span className="source-label">当前阶段</span>
          <strong>{phaseLabel(status.phase)}</strong>
        </div>
        <div>
          <span className="source-label">尝试次数</span>
          <strong>
            {status.attemptCount} / {status.maxAttempts}
          </strong>
        </div>
        <div>
          <span className="source-label">输入版本</span>
          <strong>v{status.inputVersion}</strong>
        </div>
      </div>
      {status.error ? (
        <p className="status-note">
          {status.error.message} {status.error.retryable ? '系统将按上限重试。' : ''}
        </p>
      ) : null}
      {status.fallback.required ? (
        <div className="inline-status" role="status">
          <span className="dot-icon" aria-hidden="true" />
          <div>
            <strong>需要人工回退</strong>
            <p>{status.fallback.action}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'QUEUED':
      return '排队等待';
    case 'RUNNING':
      return '运行中';
    case 'RETRYING':
      return '限次重试中';
    case 'SUCCEEDED':
      return '已完成';
    case 'MANUAL_FALLBACK':
      return '人工回退';
    default:
      return '状态读取中';
  }
}
