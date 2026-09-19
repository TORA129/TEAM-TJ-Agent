import Link from 'next/link';

import {
  EmptyState,
  SectionCard,
  SourcePanel,
  StatusPill,
  WorkspaceShell,
} from '../components/team-tj-ui';

export default function InsightsPage() {
  return (
    <WorkspaceShell
      active="insights"
      eyebrow="Insight Memory"
      title="洞察记忆"
      description="把通过合规检查、带有来源记录的复盘洞察，整理成下一次创作可以引用的辅助信息。"
      status="暂无洞察"
      statusTone="waiting"
      aside={
        <SourcePanel
          title="记忆规则"
          items={[
            { label: '来源闭包', value: '必需', tone: 'attention' },
            { label: '禁词检查', value: '保存前执行', tone: 'ready' },
            { label: '业务事实替代', value: '禁止', tone: 'attention' },
            { label: '人工归档', value: '支持', tone: 'neutral' },
          ]}
        />
      }
    >
      <SectionCard
        eyebrow="Memory / 01"
        title="已保存的运营经验"
        description="洞察会保留来源、保存时间、指标版本与合规结果，供文案创作时辅助引用。"
      >
        <EmptyState
          title="还没有已批准的洞察"
          description="完成一次复盘并通过禁词与来源检查后，合规的洞察会出现在这里。"
          action={
            <Link className="button-secondary" href="/reviewer">
              去做一次复盘
            </Link>
          }
        />
      </SectionCard>
      <SectionCard
        eyebrow="Memory / 02"
        title="引用边界"
        description="洞察可以帮助你发现可复用的方向，但不能替代当前 Content Brief 中的业务事实。"
      >
        <div className="rule-list">
          <div className="rule-row">
            <span>每条洞察有 Source Record</span>
            <StatusPill tone="ready">要求</StatusPill>
          </div>
          <div className="rule-row">
            <span>保存前执行 Blocked Term 检查</span>
            <StatusPill tone="ready">要求</StatusPill>
          </div>
          <div className="rule-row">
            <span>当前业务事实仍来自 Brief</span>
            <StatusPill tone="neutral">边界</StatusPill>
          </div>
        </div>
      </SectionCard>
    </WorkspaceShell>
  );
}
