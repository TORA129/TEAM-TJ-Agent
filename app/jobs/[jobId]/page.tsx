import Link from 'next/link';

import { JobStatus } from './job-status';
import { ManualEditor, WorkflowControls } from '../../components/workflow-controls';
import { SectionCard, SourcePanel, StatusPill, WorkspaceShell } from '../../components/team-tj-ui';

type JobPageProps = {
  params: Promise<{ jobId: string }>;
};

export default async function JobPage({ params }: JobPageProps) {
  const { jobId } = await params;

  return (
    <WorkspaceShell
      active="jobs"
      eyebrow="Job Monitor"
      title="任务状态"
      description="长任务会保留输入版本、当前阶段和脱敏失败回退；页面刷新后仍可从这里恢复查看。"
      status="等待调度"
      statusTone="waiting"
      aside={
        <SourcePanel
          title="任务摘要"
          items={[
            { label: 'Job ID', value: jobId, tone: 'neutral' },
            { label: '输入版本', value: '未创建', tone: 'waiting' },
            { label: '调用状态', value: '未开始', tone: 'waiting' },
            { label: '人工回退', value: '可用', tone: 'ready' },
          ]}
        />
      }
    >
      <SectionCard
        eyebrow="01 / Lifecycle"
        title="任务生命周期"
        description="当前为页面壳层，实际任务创建与轮询会在作业接口接入后启用。"
      >
        <JobStatus jobId={jobId} />
        <div className="job-timeline" aria-label="任务生命周期">
          <div className="job-step job-step-current">
            <span className="job-step-number">01</span>
            <div>
              <strong>排队等待</strong>
              <p>等待服务端创建输入版本。</p>
            </div>
            <StatusPill tone="waiting">当前</StatusPill>
          </div>
          <div className="job-step">
            <span className="job-step-number">02</span>
            <div>
              <strong>运行中</strong>
              <p>外部调用状态与模型/工具标识将被脱敏记录。</p>
            </div>
            <StatusPill tone="neutral">未开始</StatusPill>
          </div>
          <div className="job-step">
            <span className="job-step-number">03</span>
            <div>
              <strong>成功或人工回退</strong>
              <p>失败不会伪造成功结果，会提供可执行下一步。</p>
            </div>
            <StatusPill tone="neutral">未开始</StatusPill>
          </div>
        </div>
      </SectionCard>
      <SectionCard
        eyebrow="02 / Recovery"
        title="如果任务不可用"
        description="配置、授权、限流或第三方限制都只会显示公开原因，不会暴露凭据或内部错误。"
      >
        <div className="inline-status">
          <span className="dot-icon" aria-hidden="true" />
          <div>
            <strong>人工输入回退已保留</strong>
            <p>你可以返回对应工作区继续编辑 Content Brief、人工内容或指标。</p>
          </div>
        </div>
        <ManualEditor
          id="job-recovery-note"
          label="人工回退记录"
          hint="记录下一步动作或外部限制；不要粘贴 Cookie、Token、连接串或完整堆栈。"
        />
        <WorkflowControls entityLabel="任务结果" version={1} exportEndpoint={`/api/jobs/${encodeURIComponent(jobId)}/export`} />
        <div className="card-actions">
          <Link className="button-secondary" href="/copywriter">
            返回文案工作区
          </Link>
          <Link className="button-secondary" href="/reviewer">
            返回复盘工作区
          </Link>
        </div>
      </SectionCard>
    </WorkspaceShell>
  );
}
