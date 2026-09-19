# Implementation Plan: Team-TJ 小红书 AI Agent

## Overview

本计划基于 `requirements.md` 与 `design.md`，使用 **TypeScript + Next.js App Router** 实现可部署到 Vercel 的 Team-TJ 小红书 AI Agent。任务只覆盖写代码、修改代码、创建运行时配置/数据快照和自动化测试；不在本阶段实现代码。

执行每个任务时遵循以下要求：

> Convert the feature design into a series of prompts for a code-generation LLM that will implement each step with incremental progress. Make sure that each prompt builds on the previous prompts, and ends with wiring things together. There should be no hanging or orphaned code that isn't integrated into a previous step. Focus ONLY on tasks that involve writing, modifying, or testing code.

任务依赖关系已经在文末给出。标记“可并行”的任务只有在依赖波次完成后，且不写入同一文件时才可并行执行。标记 `*` 的测试任务为可选增强测试；核心实现任务不可跳过。

## Tasks

- [x] 1. 建立 Next.js/Vercel 基础工程与 Team-TJ 视觉入口
  - [x] 1.1 初始化 TypeScript Next.js App Router 工程、目录边界、构建脚本和 Vercel 运行时配置
    - 建立 `app`、服务端模块、领域模块、适配器、测试和静态资源的基础结构。
    - 配置严格 TypeScript、lint、format、单次测试命令和生产构建命令；禁止依赖本地磁盘作为持久化。
    - 配置 Vercel 可识别的 Node.js 运行时、Route Handler 基础约定和最小健康检查入口。
    - _Requirements: 1.1, 11.3, 12.4_

  - [x] 1.2 建立服务端环境配置 schema 与非公开 Credential 读取边界
    - 以服务端模块集中读取数据库、对象存储、pi-ai、OpenRouter、OpenCLI Gateway、部署和作业执行所需配置。
    - 拒绝在客户端 bundle 中读取配置；区分必需配置、可选集成配置和人工回退可运行配置。
    - 为配置缺失返回统一的脱敏配置状态，不回显密钥值、连接串、内部路径或完整第三方错误。
    - _Requirements: 11.3, 11.6, 12.4_

  - [x] 1.3 实现 Operator 会话边界、请求上下文和基础 Route Handler 防护
    - 从可信会话解析 Operator，不接受客户端传入的 `operatorId` 作为授权依据。
    - 统一处理请求体大小、Content-Type、FormData 限制、Origin/CSRF 检查、速率限制入口和请求 trace ID。
    - 为所有后续 API 提供版本号、幂等键和统一请求上下文。
    - _Requirements: 11.3, 12.4, 12.5_

  - [x] 1.4 使用 ui-ux-pro-max 设计智能落地 Team-TJ 简约 Logo、入口和工作区壳层
    - 检索并固化内容创作工作区、数据复盘仪表盘、安全授权确认和可编辑来源面板的设计规则。
    - 实现精确显示 `Team-TJ` 的简约文字 Logo 与极简几何标记；确保入口、导航和两个工作区共享统一视觉语言。
    - 创建 `/`、`/copywriter`、`/reviewer`、`/insights`、`/settings/rules`、`/jobs/[jobId]` 的基础页面壳层、清晰工作区名称、响应式布局、状态标签、表单 label、键盘焦点和减少动效支持。
    - _Requirements: 1.2, 1.3, 1.4, 12.4_

- [x] 2. 建立关系数据、对象存储、版本和来源审计基础
  - [x] 2.1 创建数据库 schema、迁移和 Repository 接口
    - 实现 `WorkflowSession`、所有不可变版本实体、文件/封面元数据、授权、指标、阈值、复盘、洞察、设置和作业实体。
    - 覆盖 `ContentBriefVersion`、`QuestionSet`、`CopyDraftVersion`、`SupplementaryFile`、`BlockedTermListVersion`、`ComplianceResult`、`CoverBrief`、`CoverAsset`、`AccessAuthorizationConfirmation`、`AccessibleContent`、`ManualContentInput`、`MetricThresholdSet`、`MetricValue`、`ReviewResultVersion`、`ReviewInsight` 和 `InsightMemory`。
    - 为基础字段、软删除/归档、不可变版本、关系表和 N:M `SourceRecord` 关联提供类型安全 Repository 契约。
    - _Requirements: 2.2, 2.3, 2.6, 5.1, 7.9, 8.1, 9.8, 10.2, 12.1, 12.3_

  - [x] 2.2 实现对象存储适配器和文件/封面 hash 元数据流程
    - 支持私有上传、读取、删除/归档、大小与 MIME 校验、对象 key 隔离和 sha256/hash 记录。
    - 确保 `Supplementary_File` 和 `Cover_Image` 的原始字节不写入数据库业务字段，不保存 Credential 或账号 Cookie/Token。
    - 对孤立对象保留审计所需 hash，并提供生命周期清理所需接口。
    - _Requirements: 2.3, 6.8, 6.9, 7.9, 12.2_

  - [x] 2.3 实现乐观锁、不可变版本、幂等键和 Source_Record/AuditEvent 服务
    - 创建 `SourceRecord` 和 `AuditEvent` 写入/查询服务，记录 source type、引用版本、hash、父来源、限制、脱敏状态、actor、前后 hash、reason、provider/model/tool ID 和 trace ID。
    - 实现 `expectedVersion` 冲突拒绝、`jobId + inputVersion + step` 外部调用幂等、重复请求去重和软删除/审计不可静默删除。
    - 保证人工编辑、生成、访问、指标、合规、确认、导出和失败回退都可以关联来源和审计事件。
    - _Requirements: 2.6, 7.9, 10.2, 12.1, 12.3, 12.6, 12.7_

  - [x] 2.4 创建本地《小红书爆款思路.txt》的不可变规则快照和版本 hash
    - 读取项目根目录现有规则文件，整理为可执行的 14 条 `Source_Rules` 快照，不允许运行时让模型修改规则。
    - 保存规则 ID、版本、原文/规范化规则、部署版本和 hash，并让 `read_source_rules` 只能读取已打包快照。
    - 为历史草稿保留规则版本引用，后续规则变化只能创建新快照。
    - _Requirements: 4.1, 12.1_

- [x] 3. 实现统一错误、状态机、作业和日志脱敏横切能力
  - [x] 3.1 实现统一错误 DTO、公开错误码和可执行回退动作
    - 实现 `code`、`message`、`action`、`retryable`、`fieldErrors`、`currentVersion`、`sourceRecordId`、`traceId` DTO。
    - 覆盖 `VALIDATION_FAILED`、`BRIEF_INCOMPLETE`、`QUESTION_SET_INVALID`、`FILE_UNREADABLE`、模型/封面/OpenCLI/指标/授权/阈值/配置/版本/确认/限流等设计错误码。
    - 将第三方异常、堆栈、请求头、环境变量、内部路径和 Credential 映射为可显示原因，不把原始异常传给客户端。
    - _Requirements: 2.4, 3.5, 6.9, 7.5, 7.6, 8.2, 11.6, 12.4_

  - [x] 3.2 实现 Copywriter、Review 和 Job 状态机及合法迁移门禁
    - 编码 Copywriter 状态机、Review 状态机和 `QUEUED/RUNNING/SUCCEEDED/RETRYABLE_FAILURE/TERMINAL_FAILURE` 作业状态机。
    - 使客户端不能直接赋值状态；每次迁移记录输入版本、尝试次数、脱敏错误码和 Source_Record。
    - 实现确认前不可导出、未授权不可访问、未合规不可生成封面、未完成三问不可生成最终稿、失败达到上限必须人工回退等门禁。
    - _Requirements: 3.3, 4.22, 6.1, 7.5, 8.36, 10.3, 12.7_

  - [x] 3.3 实现长任务创建、轮询、重试上限和页面刷新恢复
    - 为文案生成、文件解析、封面生成和 OpenCLI 访问创建持久化作业，并返回 `202 + jobId`。
    - 仅对限流、超时、暂时性 5xx 和对象存储暂时故障重试；参数、授权、禁词、来源和版本错误不可自动重试。
    - 提供 `GET /api/jobs/:jobId` 的最小状态 DTO、阶段、失败回退、脱敏来源摘要以及刷新后恢复所需数据。
    - _Requirements: 2.3, 6.9, 7.6, 7.9, 11.5_

  - [ ]* 3.4 为错误 DTO、状态迁移、幂等和作业重试编写单元/集成测试
    - 覆盖非法迁移、重复幂等请求、版本冲突、重试上限、终态人工回退和错误 DTO 脱敏。
    - _Requirements: 2.6, 3.3, 6.9, 7.5, 11.5, 12.6_

- [x] 4. 接入 pi-ai、OpenRouter 免费模型和受控 Agent 工具
  - [x] 4.1 实现服务端 `PiAiModelAdapter` 与 OpenRouter provider 适配
    - 使用 pi-ai 作为 Copywriter 和 Review 的核心 Agent 框架，封装结构化输出、流式事件、超时、限流和请求 ID。
    - 强制 provider 为 OpenRouter，并将实际模型标识、调用状态、耗时和 request/job ID 写入脱敏审计。
    - 失败时返回统一模型错误和人工编辑/重试动作，不把 provider 原始错误或凭据带入响应。
    - _Requirements: 11.1, 11.2, 11.5, 11.6_

  - [x] 4.2 实现 OpenRouter 免费模型能力目录和模型选择校验
    - 支持 `openrouter/free` 动态路由或版本化的 `:free` 模型能力目录，不把动态模型 ID 写死在业务规则中。
    - 校验结构化输出、工具调用和图像输出能力；只允许标记为免费且满足当前任务能力的模型。
    - 将不可用、限流和能力不足映射为脱敏配置/模型状态，并保留人工回退。
    - _Requirements: 6.1, 6.9, 11.2, 11.5, 11.6_

  - [x] 4.3 实现 pi-ai 工具 allowlist 和不可绕过的 Agent 边界
    - 仅提供 `read_source_rules`、`read_brief_sources`、`propose_copy_draft`、`classify_review_text`、`propose_recommendations` 和 `compose_cover_visual`。
    - 禁止任意网页抓取、shell、文件系统写入、账号操作、发布、绕过授权、读取环境变量/Credential、修改阈值和直接保存洞察。
    - 对每个工具输入输出做 schema 校验并强制 Source_Record 引用。
    - _Requirements: 4.1, 5.7, 7.8, 9.11, 10.5, 11.1, 11.3_

  - [ ]* 4.4 为 pi-ai/OpenRouter 适配器编写 stub 集成测试
    - 验证免费模型限制、实际 model ID 记录、结构化输出解析、工具 allowlist、超时、限流、空响应、配置缺失和日志无密钥。
    - _Requirements: 11.1, 11.2, 11.5, 11.6_

- [x] 5. 实现 Copywriter 输入、文件解析、禁词设置和恰好三问流程
  - [x] 5.1 实现 Copywriter 会话、Content_Brief DTO/schema 和基础 API
    - 创建 `POST /api/copywriter/sessions`、`GET/PATCH /api/copywriter/sessions/:id`，支持主题、目标人群、核心结果、痛点、方法、参数/数字、真实缺点、结尾行动、禁词版本引用和洞察引用。
    - 每次写入创建不可变 `ContentBriefVersion`，保存字段来源、operator 提供字段、content hash、编辑理由和 Source_Record。
    - PATCH 使用 `expectedVersion` 与幂等键，变更后使下游草稿进入需要重新检查状态。
    - _Requirements: 2.1, 2.2, 2.6, 5.1, 10.4, 12.1, 12.6_

  - [x] 5.2 实现 Supplementary_File 上传、解析、状态和人工继续流程
    - 创建 `POST /api/copywriter/sessions/:id/files`，支持允许的文本/文档类型、大小限制、对象存储、读取状态和 Source_Record。
    - 解析成功时将可引用内容绑定当前 brief；解析失败时保存 `FILE_UNREADABLE` 来源、错误码和文件状态。
    - 保留已读 Content_Brief，并提供仅使用 brief 继续创作或替换文件的人工动作。
    - _Requirements: 2.1, 2.3, 2.4, 5.7, 12.1_

  - [x] 5.3 实现 Blocked_Term_List 的录入、编辑、删除、导入和版本化 API
    - 创建 `/api/settings/blocked-terms` 全套接口，支持多个清单、来源、版本、归一化策略、软删除/归档和空清单。
    - 将当前清单版本绑定到 Copywriter 输入、Compliance_Result 和后续审计，不允许历史结果静默换清单。
    - _Requirements: 5.1, 5.3, 5.4, 10.1_

  - [x] 5.4 实现 brief 完整性诊断、固定三问、回答合并和拒答回退
    - 诊断八个必需字段；缺任一字段时创建永远恰好 3 个问题并绑定 brief 版本。
    - 仅在收到 3 个回答后将回答以 Operator 来源并入新 brief 版本；0/1/2 个回答保持等待补充，不生成最终稿。
    - 支持拒答/手工编辑返回 brief 编辑态，显示缺失字段，不用模型猜测业务事实。
    - _Requirements: 2.5, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 5.5 为输入、文件、禁词和 Question_Set 编写单元/集成测试
    - 覆盖字段缺失组合、文件读取失败、多个清单、空清单、问题数量/回答数量、拒答、版本冲突和来源绑定。
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 5.1_

  - [ ]* 5.6 编写 Property 1：Brief 完整性与事实不猜测属性测试
    - 对任意字段组合验证只有八字段完整版本进入 `READY_TO_GENERATE`，缺失组合进入澄清/人工编辑且不得产生无 Source_Record 的业务事实。
    - **Validates: Requirements 2.2, 2.5, 3.4, 3.5, 5.7, 5.8**

  - [ ]* 5.7 编写 Property 2：澄清问题恰好三问属性测试
    - 对任意非空缺失字段集合验证问题数恒为 3，少于 3 个回答不能生成，3 个回答全部带 Operator 来源并入新版本。
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [ ]* 5.8 编写 Property 3：输入版本变更使下游版本失效属性测试
    - 对任意 brief、文件、禁词清单或洞察引用变更验证旧 Draft 不可变，新版本需要重新检查且产生前后 Source_Record/审计。
    - **Validates: Requirements 2.6, 12.6**

- [x] 6. 实现结构化 Copy_Draft、14 条规则、事实来源和禁词合规
  - [x] 6.1 实现 Copy_Draft schema、Unicode tokenizer 和确定性结构校验器
    - 实现汉字/Emoji/句子/段落统一计数，固定 `titles[5]`、`bodyPoints[3]`、`tags[8]` 与 3/3/2 标签 bucket。
    - 校验标题≤20 汉字、封面标题后续复用≤9 汉字、正文≤300 汉字、正文 Emoji 4–6 个、一个目标人群和一个目标情绪。
    - 对缺块、配额、寒暄首句、超过 8 标签、超过 3 分点和禁止互动词返回可定位字段错误。
    - _Requirements: 4.2, 4.3, 4.8, 4.14, 4.15, 4.16, 4.17, 4.18, 4.22_

  - [x] 6.2 实现 14 条 Source_Rules 确定性校验、模型候选生成和一次修复策略
    - 将首句、前三行、痛点、方法、参数、真实缺点、反差、已知实体、内容类型结构和结尾规则逐条输出 PASS/FAIL/NEEDS_OPERATOR_CONFIRMATION。
    - 使用 pi-ai 生成结构化候选；模型输出先过 schema，再过 14 条规则和来源闭包，不允许模型直接将草稿置为 confirmed。
    - 规则失败最多按错误列表修复一次，仍失败则进入人工编辑/确认，不循环调用。
    - _Requirements: 4.1, 4.6, 4.7, 4.9, 4.10, 4.11, 4.12, 4.13, 4.19, 4.20, 4.21_

  - [x] 6.3 实现 Copywriter 生成、读取、人工编辑和确认前 API
    - 创建 `POST .../draft/generate`、`GET/PATCH .../draft` 和 `POST .../confirm`，将完整 brief、问题集、规则快照、文件和洞察版本绑定到生成作业。
    - 提供固定区块：目标人群、目标情绪、5 标题、首句、前 3 行、痛点、方法、真实缺点、正文、标签、结尾、Source_Record、规则结果和确认状态。
    - 人工编辑保存 before/after 值/hash、编辑人、时间、理由和新版本；编辑后重新执行规则/事实/禁词检查，旧版本只读。
    - _Requirements: 4.22, 5.7, 12.1, 12.5, 12.6, 12.7_

  - [x] 6.4 实现多清单禁词匹配、claim/source closure 和 Compliance_Result
    - 对 5 个标题、首句、正文、正文分点、标签和结尾逐项执行 Unicode 归一化后的全部清单匹配。
    - 记录匹配词、归一化词、分块、次数、span、清单 ID/版本；空清单输出 `NOT_CONFIGURED`。
    - 对数字、背书、案例、品牌陈述和效果结论执行 Content_Brief、Supplementary_File 或 APPROVED Insight_Memory 来源闭包；无来源只能确认、删除或补充来源。
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 12.1_

  - [ ]* 6.5 为 Copy_Draft validator、规则、合规和编辑流程编写单元/集成测试
    - 覆盖 14 条规则的 PASS/FAIL/NEEDS_CONFIRMATION、固定区块、标题/正文/Emoji/分点/标签配额、首句、目标情绪、禁词、来源缺失和一次修复失败。
    - _Requirements: 4.1–4.22, 5.1–5.8, 12.5–12.7_

  - [ ]* 6.6 编写 Property 4：Copy_Draft 固定结构和配额属性测试
    - 验证被接受草稿始终有 5 标题、正文≤300、3 分点、8 标签且 3/3/2、Emoji 4–6、结尾行动且无禁止行动词。
    - **Validates: Requirements 4.3, 4.14, 4.15, 4.16, 4.17, 4.18, 4.21**

  - [ ]* 6.7 编写 Property 5：标题钩子与情绪唯一性属性测试
    - 验证每个标题含数字或情绪钩子及信息缺口/反差，排除固定禁词和用户禁词，全文目标情绪集合恰为 1 且有标题/首句证据。
    - **Validates: Requirements 4.4, 4.5, 4.8**

  - [ ]* 6.8 编写 Property 6：14 条规则结构化映射属性测试
    - 验证首句、前三行、痛点、方法、参数、缺点、反差、已知实体、内容结构和结尾都能映射到 Source_Rules/brief，具体参数不被模糊量词替代。
    - **Validates: Requirements 4.1, 4.2, 4.6, 4.7, 4.9, 4.10, 4.11, 4.12, 4.13, 4.19, 4.20**

  - [ ]* 6.9 编写 Property 7：禁词检查穷尽且来源完整属性测试
    - 对任意分块和清单验证全量遍历、归一化、次数、清单来源记录以及空清单 `NOT_CONFIGURED` 行为。
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6**

  - [ ]* 6.10 编写 Property 8：Claim 来源闭包属性测试
    - 验证 Copy_Draft、Review_Result、Review_Insight 中的数字/背书/案例/品牌/效果/建议无允许 Source_Record 时不能进入确认/导出版本。
    - **Validates: Requirements 5.7, 5.8, 9.7, 9.11, 10.2, 10.5, 12.1, 12.3**

- [x] 7. 实现实际 3:4 Cover_Image 生成、合成、校验与人工回退
  - [x] 7.1 实现 CoverImageAdapter 和无文字视觉底图生成流程
    - 仅请求经过能力目录确认的 OpenRouter 免费图像路径，生成无文字底图；提示包含干净留白、真实素人感、右下角主题插画、真实缺点一致性和排除塑料感约束。
    - 生成失败、超时、非图像、收费/非免费能力或不可用时返回 `COVER_UNAVAILABLE`，不伪造成功图。
    - _Requirements: 6.1, 6.3, 6.5, 6.6, 6.7, 6.9, 11.2_

  - [x] 7.2 实现 CoverBrief、CoverComposer、标题/logo/安全区叠加和像素尺寸校验
    - 生成可编辑 Cover_Brief，并在服务端叠加≤9 汉字手写感粗体标题、Team-TJ Logo、安全区和右下角插画。
    - 导出真实 PNG/JPEG 字节，重新读取实际宽高、比例和 hash，要求精确 3:4；记录尺寸、来源、编辑版本和 Source_Record。
    - 对不合比例的输出拒绝成功状态，不静默裁切；提供人工确认裁切选项。
    - _Requirements: 6.2, 6.4, 6.5, 6.7, 6.8, 12.2_

  - [x] 7.3 实现封面生成、重试、替换上传和详情 API
    - 创建 `POST .../cover/generate`、`POST .../cover/upload`、`PATCH .../cover`，仅允许 `COMPLIANCE_PASSED` 的草稿生成封面。
    - 保存 Cover_Brief 和失败 Source_Record；支持有限重试、人工上传替代图、标题/说明编辑和替换原因。
    - UI/API 同时返回 Cover_Brief、尺寸、生成/替换来源、状态、失败原因和人工编辑入口。
    - _Requirements: 6.1, 6.8, 6.9, 12.2, 12.5, 12.6_

  - [ ]* 7.4 为 CoverImageAdapter、CoverComposer 和回退流程编写集成/视觉测试
    - 使用图像 provider stub 验证无文字底图输入、真实合成字节、3:4 像素尺寸、≤9 字标题、非图像/超时/错误比例和人工上传回退。
    - 使用视觉测试检查留白、中央标题、右下角插画、Team-TJ 标识和失败/空状态。
    - _Requirements: 6.1–6.9, 12.2_

  - [ ]* 7.5 编写 Property 9：Cover_Image 尺寸与标题约束属性测试
    - 验证所有可用生成/上传图均为 3:4、中央标题≤9 字且与 Cover_Brief/真实缺点/来源一致，失败能力永不产生成功状态。
    - **Validates: Requirements 6.1, 6.2, 6.4, 6.7, 6.8, 6.9**

- [x] 8. 实现 Review URL、授权门禁、OpenCLI 网关、SSRF 与人工内容回退
  - [x] 8.1 实现 Review 会话、Note_URL 规范化和 Manual_Content_Input API
    - 创建 `POST /api/reviews`，保存原始 URL、规范化 URL、内容/封面人工输入和来源版本。
    - 提供标题、正文、封面描述和人工指标粘贴入口；区分人工输入值、空值、零值和缺失值。
    - 页面显示账号登录、公开数据、OpenCLI 配置、平台条款和指标人工输入限制说明。
    - _Requirements: 7.1, 7.2, 7.5, 7.6, 8.1, 8.2, 12.3, 12.4_

  - [x] 8.2 实现 Access_Authorization_Confirmation 和 OpenCLI Gateway Adapter
    - 创建 `PATCH /api/reviews/:id/authorization`，确认精确 URL、工具 ID、访问目的、已登录账号/公开状态、确认时间和可选过期时间。
    - Gateway 只接受服务端加载的 `reviewId + authorizationId + exactNoteUrl`，不信任客户端授权对象，不接收/返回 Cookie/Token。
    - 成功归一化为 Accessible_Content；失败归一化为授权所需、非公开、平台阻止、工具不可用或超时。
    - _Requirements: 7.3, 7.4, 7.6, 7.7, 7.9, 11.5_

  - [x] 8.3 实现官方小红书 URL allowlist、SSRF 和平台限制防护
    - 只接受明确官方域名/协议和安全 query；拒绝内网地址、非 allowlist 域名、包含凭据的 URL、非必要 query 和重定向到非 allowlist 域名。
    - 限制网关响应字段、大小和执行时间；禁止“绕过”“强制抓取”“未授权账号”等操作和 Agent 工具。
    - URL、工具、目的或账号模式任一变化时使授权失效并回到 `AUTH_REQUIRED`。
    - _Requirements: 7.3, 7.5, 7.7, 7.8, 7.9, 12.4_

  - [x] 8.4 实现 Review fetch 编排、访问作业和失败人工回退
    - 创建 `POST /api/reviews/:id/fetch`，只有有效精确授权才调用 OpenCLI；未授权时调用次数必须为 0 并只提供人工输入。
    - 成功保存 Accessible_Content 和 Source_Record；失败保存失败原因/来源，不无限重试、不切换绕过路径，允许新授权或 Manual_Content_Input。
    - 支持 `CONTENT_READY`、`AUTH_REQUIRED`、`ACCESS_FAILED`、`MANUAL_INPUT` 状态和页面刷新恢复。
    - _Requirements: 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_

  - [ ]* 8.5 为 URL、OpenCLI、SSRF 和人工回退编写集成/安全测试
    - 使用 gateway contract mock 验证精确 URL、授权门禁、allowlist、重定向拒绝、响应限制、失败分类、Source_Record 和未授权零调用。
    - 覆盖内网地址、非法协议、凭据 URL、平台限制、超时、工具不可用、账号/公开状态变化和手工回退。
    - _Requirements: 7.3–7.9, 11.5, 12.4_

  - [ ]* 8.6 编写 Property 10：授权是 OpenCLI 必要前置条件属性测试
    - 对任意 URL 请求验证无精确授权时 OpenCLI 调用次数为 0、状态为授权所需并提供人工回退，任一授权上下文变化都会失效。
    - **Validates: Requirements 7.3, 7.5, 7.7, 7.8**

  - [ ]* 8.7 编写 Property 11：OpenCLI 结果与失败均可追溯属性测试
    - 对成功、受限、超时和不可用结果验证均产生 URL/授权/工具/时间/分类/来源的 Source_Record，失败不得走绕过路径。
    - **Validates: Requirements 7.4, 7.6, 7.9**

- [x] 9. 实现八类指标、用户阈值集、完播率人工复盘和总体颜色结论
  - [x] 9.1 实现 MetricValue、MetricThresholdSet 和默认严格边界规则
    - 支持曝光、点击率、阅读时长、完播率、点赞率、收藏率、评论率和涨粉数，区分 missing/zero/value、单位和来源。
    - 使用整数、秒和 basis points 进行领域计算；拒绝负值、无穷、非法百分比和单位不一致。
    - 初始化需求规定的严格 `>`、`>=/<` 区间、曝光四个边界、CTR 15%、阅读 20 秒、点赞 15%、收藏 13%、评论 5% 边界人工确认策略。
    - 完播率默认 `UNDEFINED_UNLESS_OPERATOR_DEFINED`，不得创建系统自带通过/优秀/低表现阈值。
    - _Requirements: 8.1–8.4, 8.5–8.33_

  - [x] 9.2 实现指标/阈值录入 API、来源和版本控制
    - 创建 `GET/PATCH /api/reviews/:id/metrics` 和 `GET/PATCH /api/reviews/:id/thresholds`，支持增删改、来源、录入时间、版本和乐观锁。
    - 将人工录入绑定 `OPERATOR_MANUAL`/Manual_Content_Input Source_Record，不用 URL、其他指标或模型输出推断缺失值。
    - 保存 Operator 自定义完播率阈值和版本；所有评估显示实际阈值集版本。
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 9.9, 12.3, 12.6_

  - [x] 9.3 实现单指标分层、边界人工确认和七项核心指标总体结论
    - 创建 `POST /api/reviews/:id/evaluate`，输出每项值、单位、来源、触发规则、分层、边界状态和缺失状态。
    - 完成曝光、CTR、阅读时长、点赞率、收藏率、评论率、涨粉数全部默认分层；完播率仅显示实际值/来源/供人工复盘，除非 Operator 自定义并标记低表现。
    - 仅统计七项核心指标：有值且优秀达到 4 项以上输出绿色“笔记文案优秀”，少于 4 项输出黄色“笔记文案仍需改进”，七项全缺失显示需要人工输入且不输出颜色结论。
    - _Requirements: 8.5–8.36_

  - [x] 9.4 实现低表现建议、指定 Markdown 模板和数据缺口分类
    - 输出内容摘要、可观察结论、需要人工确认、无法评估、已评估指标、颜色结论、原因、建议和每项 Source_Record。
    - 为低 CTR、阅读时长、Operator 标记低完播、低点赞/收藏和低评论生成带指标值、触发规则、内容锚点、动作和来源的建议。
    - 渲染包含唯一字段标签、非空占位区域、日期、主题、封面/标题、八类指标、好在哪/差在哪和下次改进点的有效 Markdown 模板。
    - _Requirements: 9.1–9.11, 12.3_

  - [ ]* 9.5 为指标解析、分层、总体结论、建议和模板编写单元/集成测试
    - 覆盖每个默认区间、所有等值边界、缺失/零值、完播率无阈值和自定义阈值、0/1/3/4/7 项优秀、建议锚点和模板字段。
    - _Requirements: 8.1–8.36, 9.1–9.11_

  - [ ]* 9.6 编写 Property 12：指标缺失与来源不被推断属性测试
    - 对任意八类指标缺失组合验证缺失标人工输入/无法评估且不被推断，人工值保留 `OPERATOR_MANUAL` 来源，完播率无阈值只显示人工复盘。
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 9.9, 9.10**

  - [ ]* 9.7 编写 Property 13：指标分层互斥、穷尽和边界属性测试
    - 对任意合法值验证实际阈值集下恰属于一个定义区间、边界人工确认或拒绝状态；非法值/单位在评估前拒绝。
    - **Validates: Requirements 8.5–8.33**

  - [ ]* 9.8 编写 Property 14：总体颜色由七项核心指标计数决定属性测试
    - 对任意七项存在/达标组合验证仅统计有值优秀项，≥4 为绿色、1–3 为黄色、全缺失为无颜色人工输入，完播率不改变计数。
    - **Validates: Requirements 8.34, 8.35, 8.36**

  - [ ]* 9.9 编写 Property 15：低表现建议必须有指标、锚点、规则和来源属性测试
    - 对任意触发的低表现类型验证建议包含指标和值、实际规则、允许内容锚点、Source_Record 和可执行动作；未触发时不产生对应建议。
    - **Validates: Requirements 9.2, 9.3, 9.4, 9.5, 9.6, 9.7**

  - [ ]* 9.10 编写 Property 16：复盘模板字段完整且状态互斥属性测试
    - 验证模板包含唯一标签和非空占位区，涵盖日期/主题/封面或标题/八指标/好坏结论/下次改进；有值显示值+来源+分层，无值显示人工/无法评估。
    - **Validates: Requirements 9.8, 9.9, 9.10**

- [x] 10. 实现 Review_Insight、Insight_Memory 和后续 Copywriter 引用
  - [x] 10.1 实现洞察选择、禁词/来源检查和 Insight_Memory 持久化
    - 创建 `POST /api/reviews/:id/insights/check` 与 `POST /api/reviews/:id/insights`，保存前必须检查当前 Blocked_Term_List 和来源闭包。
    - 命中禁词或缺来源时阻止保存并返回匹配词、位置、清单来源和缺失来源；通过时保存文本、来源 URL/人工输入、时间、阈值版本、Compliance_Result 和 Source_Record。
    - _Requirements: 10.1, 10.2, 10.3, 12.3_

  - [x] 10.2 实现 Insight_Memory 查询、归档和 Copywriter 辅助引用 DTO
    - 提供已保存洞察列表、来源/版本/合规状态和归档能力；引用 DTO 只返回最小、脱敏、可追溯摘要。
    - Copywriter 生成时显示每条洞察的来源、保存时间、指标版本和 Source_Record，并强制其只能作为辅助信息，不能替代当前 brief 事实。
    - _Requirements: 10.4, 10.5, 12.1, 12.5, 12.6_

  - [ ]* 10.3 编写 Property 17：Insight_Memory 只能保存合规且有来源洞察属性测试
    - 验证命中禁词或缺来源时保存调用不发生；通过时保存完整元数据；被引用时不能覆盖当前 brief 事实。
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5**

- [x] 11. 完成两个工作区的交互、来源审阅、人工编辑和确认/导出
  - [x] 11.1 完成 Copywriter 工作区 UI 与端到端状态展示
    - 实现 Content_Brief、禁词清单、文件上传、恰好三问、结构化草稿编辑、逐条规则/合规结果、Cover_Brief/Cover_Image、失败回退、来源和确认流程。
    - 显示等待补充、需要重新检查、需要 Operator 确认、合规问题、封面失败、可替换和已确认等状态，不将占位图当成实际封面。
    - _Requirements: 2.1–2.6, 3.1–3.5, 4.22, 5.1–5.8, 6.8–6.9, 12.1, 12.2, 12.5–12.7_

  - [x] 11.2 完成 Review 工作区 UI 与端到端状态展示
    - 实现 URL、授权确认、限制说明、OpenCLI 访问、人工内容、八类指标、阈值编辑、完播率人工复盘、结果、建议、模板和洞察保存。
    - 显示可观察结论、需要人工确认、无法评估、缺失数据、绿色/黄色/无颜色结果、失败回退和每项来源。
    - _Requirements: 7.1–7.9, 8.1–8.36, 9.1–9.11, 10.1–10.5, 12.3–12.7_

  - [x] 11.3 完成 Source/Audit 面板、Job 轮询、人工编辑、版本确认和导出脱敏
    - 在草稿、封面、复盘结果、洞察和导出前展示来源类型、版本、时间、限制、编辑记录、Source_Record 和下一步动作。
    - 实现长任务轮询、刷新恢复、错误重试/人工回退、版本冲突提示，以及 `POST .../confirm` 的具体版本确认审计。
    - 导出只包含 Operator 选择的业务内容、来源摘要和限制，不包含内部路径、Credential、网关连接信息、Cookie、Token 或完整堆栈。
    - _Requirements: 2.6, 6.8, 7.9, 9.8–9.11, 10.2, 12.1–12.7_

  - [ ]* 11.4 编写 Playwright UI、可访问性和视觉回归测试
    - 覆盖入口 Logo、工作区导航、表单 label、三问、编辑器、来源面板、授权门禁、指标表格、颜色状态、确认按钮、失败回退、键盘导航、减少动效和刷新恢复。
    - 在桌面/移动视口验证 Team-TJ 入口、Copywriter、Reviewer、Cover 详情、空态、错误态、边界态的视觉一致性和 WCAG AA 关键项。
    - _Requirements: 1.2–1.4, 2.1, 3.1, 6.8, 7.1–7.5, 8.34–8.36, 12.4–12.7_

- [x] 12. 完成凭据脱敏、客户端隔离、导出安全和安全测试
  - [x] 12.1 实现递归 Credential redaction、日志字段白名单和安全 DTO
    - 对 key 名和 secret-like value 递归脱敏，覆盖模型消息、OpenCLI 响应、对象存储/数据库异常、日志、Source_Record 摘要、API DTO 和导出 Markdown。
    - 日志仅允许状态、provider/model/tool ID、job ID、trace ID、错误码和来源 ID；禁止 `JSON.stringify` 任意异常对象。
    - _Requirements: 11.3, 11.4, 11.5, 11.6, 12.1–12.4_

  - [x] 12.2 完成客户端 bundle、依赖导入、请求安全和数据导出扫描规则
    - 静态保证 Client Component 不导入 pi-ai、OpenRouter SDK、OpenCLI adapter、数据库、Credential reader 或 `server-only` 模块。
    - 检查无 `NEXT_PUBLIC_` secret、无 `.env` 值进入仓库/测试快照、无敏感 header/Token 写入对象元数据。
    - 将请求大小、速率限制、身份会话、CSRF/Origin、URL SSRF、官方域名 allowlist 和重定向规则纳入自动扫描/检查命令。
    - _Requirements: 7.8, 11.3, 11.4, 12.4_

  - [ ]* 12.3 编写安全测试和脱敏扫描测试
    - 对 API 响应、错误、日志、导出、数据库审计样例、客户端 bundle 和模型/OpenCLI stub 响应运行 secret-like、Cookie、Authorization header、内部路径和完整堆栈扫描。
    - 覆盖身份越权、CSRF/Origin、请求大小、速率限制、SSRF、重定向、allowlist、非公开平台限制和确认门禁。
    - _Requirements: 7.3–7.8, 11.3–11.6, 12.4_

  - [ ]* 12.4 编写 Property 18：凭据永不进入可观察输出属性测试
    - 对任意 credential-like key/value 的成功/失败调用和错误验证日志、DTO、导出、Source_Record、AuditEvent 均无明文，同时保留状态和 provider/model/tool ID。
    - **Validates: Requirements 11.3, 11.4, 11.5, 11.6**

  - [ ]* 12.5 编写 Property 19：人工编辑产生可审计版本属性测试
    - 对任意规定实体编辑验证保存编辑人、时间、前后值/hash、非空原因，旧版本不可变且相关合规/评估结果失效并可重新执行。
    - **Validates: Requirements 12.5, 12.6**

- [x] 13. 完成 API、编排器、Repository、适配器和 UI 的整体 wiring
  - [x] 13.1 接通所有 Route Handlers 与 Orchestrator/Domain/Repository/Adapter 层
    - 接通通用 session/jobs/source-records 路由、Copywriter 全部路由、Reviewer 全部路由和 settings 路由。
    - 确保 Route Handler 只负责协议/身份/输入校验，业务规则由领域服务执行，外部能力由 server-only adapter 执行。
    - 让每个客户端动作都使用最小 DTO、版本号和幂等键，并能显示统一错误和回退。
    - _Requirements: 1.1, 2.1–2.6, 3.1–3.5, 4.22, 5.1–5.8, 7.1–7.9, 8.1–8.36, 9.1–9.11, 10.1–10.5_

  - [x] 13.2 接通持久作业、对象存储、来源审计和状态恢复
    - 验证生成、文件解析、封面、OpenCLI 和复盘评估的输入版本、状态迁移、重试/终态失败、对象 key/hash、Source_Record 和 AuditEvent 全链路一致。
    - 确保 Vercel 函数结束不依赖未持久化异步代码；无队列/worker 时只提供受限同步或人工回退。
    - _Requirements: 2.3, 6.9, 7.9, 11.5, 12.1, 12.6_

  - [ ]* 13.3 编写全链路集成测试
    - 覆盖 Copywriter 从 brief/文件/三问到草稿/合规/封面/确认导出，以及 Review 从 URL/授权或人工输入到指标/结果/建议/模板/洞察/确认导出。
    - 覆盖模型、OpenCLI、图像、数据库、对象存储和队列的受控 mock，验证调用顺序、幂等、状态机和来源闭包。
    - _Requirements: 2.1–2.6, 3.1–3.5, 4.1–4.22, 5.1–5.8, 6.1–6.9, 7.1–7.9, 8.1–8.36, 9.1–9.11, 10.1–10.5, 12.1–12.7_

  - [ ]* 13.4 运行 19 项 fast-check 属性测试集合并固定测试元数据
    - 所有 Property 1–19 分别运行至少 100 次，测试注释使用 `Feature: team-tj-xiaohongshu-ai-agent, Property N: ...`。
    - 为所有边界值补充参数化样例；属性测试不得调用真实 OpenRouter、OpenCLI、数据库或 Vercel。
    - _Requirements: 2.2, 2.5, 2.6, 3.1–3.3, 4.1–4.21, 5.2–5.8, 6.1–6.9, 7.3–7.9, 8.1–8.36, 9.2–9.11, 10.1–10.5, 11.3–11.6, 12.1–12.7_

- [x] 14. 完成 Vercel 构建、部署配置和冒烟验证
  - [x] 14.1 完成生产构建、环境配置模板和部署前检查
    - 验证 TypeScript、lint、单次单元/集成/UI 测试、生产构建和静态 bundle 检查均可由 CI/本地非 watch 命令执行。
    - 提供无值的环境配置说明模板；确认本地 `.env` 不被提交，生产 Credential 只由 Vercel/部署平台密钥配置提供。
    - _Requirements: 1.1, 11.3, 11.4, 12.4_

  - [x] 14.2 实现部署能力状态、健康检查和未配置集成的可用回退
    - `GET /api/settings/integrations/status` 只返回模型、OpenCLI、图像、数据库和对象存储是否可用及脱敏原因。
    - 当 OpenCLI/图像/模型未配置时，入口、brief 编辑、三问、规则/禁词检查、人工复盘、数据缺口和人工上传仍可运行，不启动失败。
    - _Requirements: 2.4, 6.9, 7.5, 7.6, 8.2, 11.6, 12.4_

  - [ ]* 14.3 编写 Vercel Preview 冒烟测试
    - 验证入口可访问、两个工作区可打开、Route Handlers 可响应、数据库/对象存储健康、配置状态脱敏、刷新可恢复作业，以及未配置 OpenCLI/图像时显示人工回退。
    - 记录测试名称、输入版本、结果、trace/Source_Record 摘要、截图/API 摘要、审阅者和时间；真实外部能力未满足时明确标记前置条件，不用 mock 冒充真实验收。
    - _Requirements: 1.1, 1.4, 6.9, 7.5, 11.6, 12.4_

- [x] 15. Checkpoint - 确认所有核心实现与测试命令通过
  - 确认没有孤立模块或未接线 Route Handler；确认 TypeScript/lint/生产构建、单元测试、fast-check、集成测试、UI/视觉测试、安全扫描和 Vercel 冒烟测试均有明确结果。
  - 对真实 OpenRouter、OpenCLI、图像能力或部署前置条件未满足的项目，保留明确的人工/部署回退证据，不把 mock 结果标记为真实能力已验收。

## Notes

- 设计文档已明确实现语言为 TypeScript，本计划不再询问语言。
- 任务按依赖顺序组织；Task Dependency Graph 中同一 wave 的叶子任务明确表示可并行，但仅在不写同一文件且前置接口已存在时并行执行。
- `*` 仅表示测试增强任务可选，不表示核心业务行为可跳过；所有需求对应的实现任务均为必需任务。
- Property 1–19 各自拥有独立属性测试子任务；属性测试使用 `fast-check`，至少 100 次，并辅以边界参数化样例。
- 不实现自动登录、绕过访问控制/反爬/付费墙、自动发布或任何未授权平台操作。
- 所有历史版本、Source_Record 和 AuditEvent 保留可追溯性；业务删除采用软删除/归档。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.4", "2.1", "2.4"] },
    { "id": 2, "tasks": ["1.3", "2.2", "3.1", "4.1"] },
    { "id": 3, "tasks": ["2.3", "3.2", "3.3", "4.2", "4.3", "12.1"] },
    { "id": 4, "tasks": ["3.4", "4.4", "5.1", "5.2", "5.3", "8.1", "12.2"] },
    { "id": 5, "tasks": ["5.4", "6.1", "6.2", "8.2", "8.3", "9.1"] },
    { "id": 6, "tasks": ["5.5", "5.6", "5.7", "5.8", "6.3", "6.4", "8.4", "9.2", "10.1"] },
    { "id": 7, "tasks": ["6.5", "6.6", "6.7", "6.8", "6.9", "6.10", "7.1", "7.2", "8.5", "8.6", "8.7", "9.3", "10.2"] },
    { "id": 8, "tasks": ["7.3", "7.4", "7.5", "9.4", "9.5", "9.6", "9.7", "9.8", "9.9", "9.10", "10.3", "11.1", "11.2", "12.3", "12.4", "12.5"] },
    { "id": 9, "tasks": ["11.3", "11.4", "13.1", "13.2", "13.3", "13.4"] },
    { "id": 10, "tasks": ["14.1", "14.2"] },
    { "id": 11, "tasks": ["14.3"] }
  ]
}
```
