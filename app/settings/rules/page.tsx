import {
  Field,
  SectionCard,
  SourcePanel,
  StatusPill,
  WorkspaceShell,
} from '../../components/team-tj-ui';

export default function RulesSettingsPage() {
  return (
    <WorkspaceShell
      active="settings"
      eyebrow="Settings / Rules"
      title="规则设置"
      description="管理创作禁词、版本和外部能力状态。所有设置都应保留版本与人工编辑记录。"
      status="基础配置"
      statusTone="ready"
      aside={
        <SourcePanel
          title="配置状态"
          items={[
            { label: 'Source Rules', value: '14 条', tone: 'ready' },
            { label: '禁词清单', value: '0 个版本', tone: 'waiting' },
            { label: '模型能力', value: '待接入', tone: 'waiting' },
            { label: 'OpenCLI', value: '待接入', tone: 'waiting' },
          ]}
        />
      }
    >
      <SectionCard
        eyebrow="01 / Blocked terms"
        title="禁词清单"
        description="手工配置的清单会绑定到后续文案与洞察检查，并显示清单来源与版本。"
      >
        <form className="form-grid" action="#settings-preview">
          <Field id="list-name" label="清单名称">
            <input id="list-name" name="list-name" placeholder="例如：品牌审核禁词" />
          </Field>
          <Field id="list-version" label="版本说明">
            <input id="list-version" name="list-version" placeholder="例如：2025-01 初版" />
          </Field>
          <div className="form-grid-wide">
            <Field id="terms" label="禁词内容" hint="每行一个用语，空清单也会记录为未配置状态。">
              <textarea id="terms" name="terms" placeholder="输入需要人工检查的词语" />
            </Field>
          </div>
          <div className="form-actions form-grid-wide">
            <button className="button-primary" type="submit">
              保存清单版本
            </button>
            <button className="button-secondary" type="button">
              导入文本清单
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard
        id="settings-preview"
        eyebrow="02 / Source rules"
        title="本地爆款规则"
        description="规则快照只读，后续生成任务会记录使用的版本和哈希。"
      >
        <div className="rule-list">
          {[
            ['01', '结果先行'],
            ['02', '明确目标人群'],
            ['03', '具体场景与痛点'],
            ['04', '方法与参数可复用'],
          ].map(([number, label]) => (
            <div className="rule-row" key={number}>
              <span>
                <strong>{number}</strong> · {label}
              </span>
              <StatusPill tone="ready">只读快照</StatusPill>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="03 / Integrations"
        title="外部能力状态"
        description="未配置模型、图片或 OpenCLI 时，人工输入与编辑入口仍然可以继续使用。"
      >
        <div className="rule-list">
          <div className="rule-row">
            <span>pi-ai / OpenRouter 免费模型</span>
            <StatusPill tone="waiting">待接入</StatusPill>
          </div>
          <div className="rule-row">
            <span>OpenCLI 授权网关</span>
            <StatusPill tone="waiting">待接入</StatusPill>
          </div>
          <div className="rule-row">
            <span>封面图能力</span>
            <StatusPill tone="waiting">人工回退可用</StatusPill>
          </div>
        </div>
      </SectionCard>
    </WorkspaceShell>
  );
}
