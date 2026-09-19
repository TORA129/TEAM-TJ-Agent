import Link from 'next/link';

import { Logo, StatusPill } from './components/team-tj-ui';

const workspaces = [
  {
    index: '01',
    href: '/copywriter',
    title: '爆款文案写手',
    label: 'Copywriter Workspace',
    description: '把真实业务信息整理成可审阅、可编辑、可追溯的小红书图文草稿。',
    status: '输入 brief → 生成候选',
  },
  {
    index: '02',
    href: '/reviewer',
    title: '笔记文案复盘手',
    label: 'Review Workspace',
    description: '在授权边界内查看笔记表现，补充指标并沉淀下一篇可复用的运营洞察。',
    status: '授权访问 → 人工复盘',
  },
];

export default function HomePage() {
  return (
    <div className="landing-page">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="landing-header">
        <Logo />
        <span className="landing-header-note">CONTENT OPERATIONS / 01</span>
      </header>
      <main className="landing-main" id="main-content">
        <section className="hero-grid" aria-labelledby="hero-title">
          <div>
            <p className="hero-kicker">小红书运营台</p>
            <h1 className="hero-title" id="hero-title">
              让每一次运营，<em>更有依据。</em>
            </h1>
            <p className="hero-copy">
              Team-TJ
              将创作、复盘与来源审阅放在同一个清晰工作区。先保留人工判断，再让智能能力在边界内协助你推进。
            </p>
            <div className="hero-actions">
              <Link className="button-primary" href="#workspaces">
                选择工作区
              </Link>
              <Link className="button-secondary" href="/settings/rules">
                查看规则设置
              </Link>
            </div>
            <p className="hero-note">当前为基础工作区预览，外部能力接入后仍保留人工回退。</p>
          </div>
          <div className="workspace-preview" aria-label="Team-TJ 工作区界面预览" role="img">
            <div className="preview-chrome">
              <div className="preview-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <span className="preview-label">TEAM-TJ / WORKSPACE</span>
            </div>
            <div className="preview-body">
              <div className="preview-main">
                <div className="preview-heading" />
                <div className="preview-line" />
                <div className="preview-line short" />
                <div className="preview-card accent">
                  <span className="preview-badge">来源已保留</span>
                  <div className="preview-line" />
                  <div className="preview-line short" />
                </div>
                <div className="preview-card">
                  <strong>下一步</strong>
                  <div className="preview-line" />
                  <div className="preview-line short" />
                </div>
              </div>
              <div className="preview-side">
                <div className="preview-card">
                  <strong>STATUS</strong>
                  <div className="preview-line" />
                  <div className="preview-line short" />
                </div>
                <div className="preview-card">
                  <strong>SOURCE</strong>
                  <div className="preview-line" />
                  <div className="preview-line" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section" id="workspaces" aria-labelledby="workspace-title">
          <div className="landing-section-heading">
            <div>
              <p className="kicker">开始一个工作流</p>
              <h2 id="workspace-title">今天先从哪里开始？</h2>
            </div>
            <p>两个入口保持相同的视觉与状态语言，减少切换工作区时的认知负担。</p>
          </div>
          <div className="workspace-cards">
            {workspaces.map((workspace) => (
              <Link className="workspace-card" href={workspace.href} key={workspace.href}>
                <div className="workspace-card-top">
                  <div>
                    <span className="kicker">{workspace.label}</span>
                    <h2>{workspace.title}</h2>
                    <p>{workspace.description}</p>
                  </div>
                  <span className="workspace-card-index">{workspace.index}</span>
                </div>
                <div className="workspace-card-footer">
                  <span>{workspace.status}</span>
                  <span className="arrow-icon" aria-hidden="true">
                    ↗
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="landing-section" aria-labelledby="principles-title">
          <div className="landing-section-heading">
            <div>
              <p className="kicker">工作原则</p>
              <h2 id="principles-title">智能协助，人工掌控。</h2>
            </div>
            <p>每一个自动化状态都应能被理解、被追溯，也能在必要时回到人工操作。</p>
          </div>
          <div className="trust-strip">
            <div className="trust-item">
              <strong>来源优先</strong>
              <span>业务事实不靠模型猜测。</span>
            </div>
            <div className="trust-item">
              <strong>授权明确</strong>
              <span>受限内容只在确认后访问。</span>
            </div>
            <div className="trust-item">
              <strong>状态透明</strong>
              <span>失败时提供可执行的回退。</span>
            </div>
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <Logo compact />
        <span> · Team-TJ content operations foundation</span>
        <StatusPill tone="neutral">Preview shell</StatusPill>
      </footer>
    </div>
  );
}
