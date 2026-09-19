import { ReviewWorkspace } from './review-workspace';
import { SourcePanel, WorkspaceShell } from '../components/team-tj-ui';

const reviewerSourceItems = [
  { label: 'Note URL', value: '未提交', tone: 'waiting' as const },
  { label: '访问授权', value: '未确认', tone: 'attention' as const },
  { label: 'OpenCLI', value: '不调用', tone: 'neutral' as const },
  { label: '人工回退', value: '可用', tone: 'ready' as const },
];

export default function ReviewerPage() {
  return (
    <WorkspaceShell
      active="reviewer"
      eyebrow="Review Workspace"
      title="小红书笔记文案复盘手"
      description="在明确授权或人工输入的前提下，查看内容表现、指标缺口与下一步改进方向。"
      status="人工可控"
      statusTone="ready"
      aside={<SourcePanel title="来源与访问边界" items={reviewerSourceItems} />}
    >
      <ReviewWorkspace />
    </WorkspaceShell>
  );
}
