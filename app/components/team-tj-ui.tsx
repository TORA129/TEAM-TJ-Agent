import Link from 'next/link';
import type { ReactNode } from 'react';

type WorkspaceKey = 'home' | 'copywriter' | 'reviewer' | 'insights' | 'settings' | 'jobs';

type WorkspaceShellProps = {
  active: Exclude<WorkspaceKey, 'home'>;
  eyebrow: string;
  title: string;
  description: string;
  status: string;
  statusTone?: 'ready' | 'waiting' | 'attention';
  children: ReactNode;
  aside?: ReactNode;
};

type StatusPillProps = {
  children: ReactNode;
  tone?: 'ready' | 'waiting' | 'attention' | 'neutral';
};

const navItems: Array<{ href: string; label: string; key: WorkspaceKey }> = [
  { href: '/copywriter', label: '爆款文案写手', key: 'copywriter' },
  { href: '/reviewer', label: '笔记复盘手', key: 'reviewer' },
  { href: '/insights', label: '洞察记忆', key: 'insights' },
  { href: '/settings/rules', label: '规则设置', key: 'settings' },
];

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand-lockup" href="/" aria-label="返回 Team-TJ 首页">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" role="presentation">
          <rect x="1" y="1" width="30" height="30" rx="8" />
          <path d="M8 12h16M11 8v16M16 8v16M21 8v16M8 20h16" />
        </svg>
      </span>
      <span className="brand-name">Team-TJ</span>
      {!compact && <span className="brand-context">小红书运营台</span>}
    </Link>
  );
}

export function StatusPill({ children, tone = 'neutral' }: StatusPillProps) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}

export function SourcePanel({
  title = '来源与限制',
  items,
  auditNote,
  nextAction,
}: {
  title?: string;
  items: Array<{ label: string; value: string; detail?: string; tone?: StatusPillProps['tone'] }>;
  auditNote?: string;
  nextAction?: string;
}) {
  return (
    <aside className="source-panel" aria-labelledby="source-panel-title">
      <div className="section-heading compact-heading">
        <span className="kicker">可追溯面板</span>
        <h2 id="source-panel-title">{title}</h2>
      </div>
      <div className="source-list">
        {items.map((item) => (
          <div className="source-row" key={`${item.label}-${item.value}`}>
            <div>
              <span>{item.label}</span>
              {item.detail && <small>{item.detail}</small>}
            </div>
            {item.tone ? <StatusPill tone={item.tone}>{item.value}</StatusPill> : <strong>{item.value}</strong>}
          </div>
        ))}
      </div>
      <div className="source-audit" aria-label="审计与下一步">
        <strong>审计记录</strong>
        <p>{auditNote ?? '版本、时间和操作人由服务端审计记录。'}</p>
        <strong>下一步</strong>
        <p>{nextAction ?? '确认来源后再生成、确认或导出。'}</p>
      </div>
    </aside>
  );
}

export function WorkspaceShell({
  active,
  eyebrow,
  title,
  description,
  status,
  statusTone = 'ready',
  children,
  aside,
}: WorkspaceShellProps) {
  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <Logo />
          <nav className="main-nav" aria-label="主要工作区">
            {navItems.map((item) => (
              <Link
                className={`nav-link ${active === item.key ? 'nav-link-active' : ''}`}
                href={item.href}
                key={item.key}
                aria-current={active === item.key ? 'page' : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <Link className="operator-chip" href="/settings/rules" aria-label="打开 Team-TJ 设置">
            <span className="operator-dot" aria-hidden="true" />
            <span>Operator</span>
          </Link>
        </div>
      </header>
      <main className="workspace-main" id="main-content">
        <div className="workspace-heading">
          <div>
            <p className="kicker">{eyebrow}</p>
            <div className="title-with-status">
              <h1>{title}</h1>
              <StatusPill tone={statusTone}>{status}</StatusPill>
            </div>
            <p className="workspace-description">{description}</p>
          </div>
          <div className="workspace-id" aria-label="当前工作区">
            <span className="workspace-id-label">WORKSPACE</span>
            <strong>{active.toUpperCase()}</strong>
          </div>
        </div>
        <div className="workspace-grid">
          <section className="workspace-content">{children}</section>
          {aside ?? <SourcePanel items={defaultSourceItems} />}
        </div>
      </main>
    </div>
  );
}

const defaultSourceItems = [
  { label: '界面状态', value: '基础壳层', tone: 'ready' as const },
  { label: '数据来源', value: '等待接入', tone: 'waiting' as const },
  { label: '人工控制', value: '始终保留', tone: 'neutral' as const },
];

export function SectionCard({
  eyebrow,
  title,
  description,
  children,
  className = '',
  id,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`panel-card ${className}`} id={id}>
      <div className="section-heading">
        {eyebrow && <span className="kicker">{eyebrow}</span>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function Field({
  label,
  id,
  hint,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field-group">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function MetricRow({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status: string;
}) {
  return (
    <div className="metric-row">
      <span>{label}</span>
      <strong>{value}</strong>
      <StatusPill tone="waiting">{status}</StatusPill>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-grid" aria-hidden="true" />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
