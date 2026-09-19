# Requirements Document

## Introduction

Team-TJ 小红书运营 AI Agent 是一个部署在 Vercel 的全栈 Next.js 网站，用于协助运营人员完成小红书图文文案创作、合规检查、实际封面图生成和笔记复盘。网站包含“爆款文案写手”与“小红书笔记文案复盘手”两个工作区。

系统以本地《小红书爆款思路.txt》中的 14 条爆款规则为可执行的文案质量标准。系统使用 pi-ai 作为核心 Agent 框架，并通过 OpenRouter 调用免费模型。凭据只可由环境变量提供，且不得在界面、日志、响应、导出内容或错误信息中显示。

小红书内容访问仅通过用户提供且经确认授权的 opencli 访问工具进行。账号登录、需要授权的内容、公开数据可访问性、指标手动录入和平台条款合规均保留给 Operator 授权或人工处理；系统不得绕过登录、访问控制、付费墙、反爬机制或平台限制。

## Glossary

- **Team_TJ_Website**：面向运营人员提供文案创作、实际封面图生成和笔记复盘功能的 Next.js/Vercel 全栈网站。
- **Operator**：使用 Team_TJ_Website 创建文案或复盘笔记的已授权运营人员。
- **Copywriter_Workspace**：Team_TJ_Website 中用于生成小红书图文文案的“爆款文案写手”工作区。
- **Review_Workspace**：Team_TJ_Website 中用于评估小红书笔记的“小红书笔记文案复盘手”工作区。
- **Source_Rules**：本地《小红书爆款思路.txt》中记录的 14 条小红书爆款文案规则。
- **Content_Brief**：Operator 提供的创作主题、目标、受众、素材、产品信息、可验证事实、用户提供禁词清单和其他业务规则。
- **Supplementary_File**：Operator 上传并用于补充 Content_Brief 的可访问文件。
- **Valid_Content_Input**：包含主题、目标人群、核心结果、具体痛点、可复制方法、可验证数据或参数、真实缺点和结尾行动信息的 Content_Brief 及可读取 Supplementary_File。
- **Question_Set**：在 Content_Brief 信息不足时由 Copywriter_Workspace 提出的恰好 3 个澄清问题。
- **Copy_Draft**：Copywriter_Workspace 生成的、结构化的小红书图文文案草稿。
- **Blocked_Term_List**：由 Operator 提供、人工配置并可编辑的禁词、敏感词或禁止用语清单集合。
- **Compliance_Result**：对 Copy_Draft、Cover_Image、Review_Insight 或复盘洞察执行 Blocked_Term_List 检查后生成的可追溯结果。
- **Cover_Brief**：说明 Cover_Image 构图、标题、主题插画、风格和文字安全区域的可编辑封面生成说明。
- **Cover_Image**：Copywriter_Workspace 输出的实际 3:4 小红书封面图像。
- **Note_URL**：Operator 在 Review_Workspace 提交的小红书笔记网址。
- **OpenCLI_Access_Tool**：由 Operator 提供、经授权配置且用于访问 Note_URL 可访问内容的 opencli 工具。
- **Access_Authorization_Confirmation**：Operator 对 OpenCLI_Access_Tool、目标 Note_URL、访问目的和使用的已登录账号或公开访问状态作出的明确确认记录。
- **Accessible_Content**：OpenCLI_Access_Tool 在遵守账号权限、公开数据可访问性和平台限制的前提下可获得的 Note_URL 内容。
- **Manual_Content_Input**：Operator 人工粘贴或输入、用于替代无法访问 Note_URL 内容的笔记内容、封面、标题或指标。
- **Metric_Threshold_Set**：由 Operator 输入、编辑并保存的曝光、点击率、阅读时长、完播率、点赞率、收藏率、评论率和涨粉指标的阈值规则集合。
- **Review_Result**：Review_Workspace 基于 Accessible_Content、Manual_Content_Input、Operator 输入的指标和 Metric_Threshold_Set 输出的评估结论、建议和复盘模板。
- **Review_Insight**：从 Review_Result 提取、通过合规检查并可供后续 Copy_Draft 引用的洞察。
- **Insight_Memory**：保存合规 Review_Insight 并在后续创作中按来源引用的记忆集合。
- **Source_Record**：记录生成或结论所使用的具体 Source_Rules、Content_Brief 字段、Supplementary_File、Note_URL、Accessible_Content、Manual_Content_Input、Metric_Threshold_Set、时间和人工编辑信息的可追溯记录。
- **Credential**：访问模型服务、OpenCLI_Access_Tool 或部署服务所需的私密配置值。
- **pi-ai**：Team_TJ_Website 使用的核心 Agent 框架。
- **OpenRouter_Free_Model**：通过 OpenRouter 可用且被标记为免费使用的模型。

## Requirements

### Requirement 1: 网站与 Team-TJ 品牌入口

**User Story:** 作为 Operator，我希望使用简约、干净且具有 Team-TJ 识别度的网站入口，以便快速进入对应运营工作区。

#### Acceptance Criteria

1. THE Team_TJ_Website SHALL 提供可部署到 Vercel 的全栈 Next.js 网站入口。
2. THE Team_TJ_Website SHALL 在网站入口和工作区导航中展示包含精确文本“Team-TJ”的简约 Logo。
3. THE Team_TJ_Website SHALL 使用一致的简约、干净视觉样式呈现 Team-TJ 品牌入口、Copywriter_Workspace 和 Review_Workspace。
4. WHEN Operator 选择 Copywriter_Workspace 或 Review_Workspace，THE Team_TJ_Website SHALL 打开所选工作区且保留清晰的工作区名称。

### Requirement 2: 文案创作有效输入与补充材料

**User Story:** 作为 Operator，我希望在爆款文案写手中输入有效创作需求和上传补充材料，以便为目标业务提供完整且可追溯的创作上下文。

#### Acceptance Criteria

1. THE Copywriter_Workspace SHALL 提供 Content_Brief 文本输入区域、Blocked_Term_List 输入区域和 Supplementary_File 上传入口。
2. WHEN Operator 提交包含主题、目标人群、核心结果、具体痛点、可复制方法、可验证数据或参数、真实缺点和结尾行动信息的 Content_Brief，THE Copywriter_Workspace SHALL 将 Content_Brief 标识为 Valid_Content_Input 并保存当前版本。
3. WHEN Operator 上传 Supplementary_File，THE Copywriter_Workspace SHALL 显示 Supplementary_File 的文件名、读取状态和用于当前 Copy_Draft 的 Source_Record 标识。
4. IF Supplementary_File 无法读取，THEN THE Copywriter_Workspace SHALL 标识无法读取的 Supplementary_File、保留已读取的 Content_Brief，并提供仅使用 Content_Brief 继续创作的人工选择。
5. IF Content_Brief 缺少 Valid_Content_Input 所需信息，THEN THE Copywriter_Workspace SHALL 转入 Question_Set 回退流程且不得将缺失信息补写为业务事实。
6. WHEN Operator 修改 Content_Brief、Blocked_Term_List 或 Supplementary_File，THE Copywriter_Workspace SHALL 使当前 Copy_Draft 标识为“需要重新检查”并保留修改前后的 Source_Record。

### Requirement 3: 信息不足时的澄清流程

**User Story:** 作为 Operator，我希望在创作信息不足时获得固定数量的关键问题，以便补齐生成高质量文案所需的信息。

#### Acceptance Criteria

1. WHEN Content_Brief 缺少主题、目标人群、核心结果、具体痛点、可复制方法、可验证数据或参数、真实缺点或结尾行动信息中的任一项，THE Copywriter_Workspace SHALL 在生成 Copy_Draft 前输出包含恰好 3 个问题的 Question_Set。
2. WHEN Operator 回答 Question_Set，THE Copywriter_Workspace SHALL 将 3 个回答并入当前 Content_Brief 并将每个回答标记为 Operator 提供的来源。
3. WHILE Question_Set 未获得 3 个回答，THE Copywriter_Workspace SHALL 将当前创作状态标识为“等待补充信息”且不得生成最终 Copy_Draft。
4. WHEN Content_Brief 包含 Valid_Content_Input 所需信息，THE Copywriter_Workspace SHALL 直接生成 Copy_Draft 而不输出 Question_Set。
5. IF Operator 选择不回答 Question_Set，THEN THE Copywriter_Workspace SHALL 保留人工编辑 Content_Brief 的入口并提示缺失字段，不得以模型推测替代未提供的事实。

### Requirement 4: 基于本地规则的结构化文案生成

**User Story:** 作为 Operator，我希望系统依据本地爆款思路输出严格分块的图文文案，以便直接审阅和编辑内容。

#### Acceptance Criteria

1. THE Copywriter_Workspace SHALL 将 Source_Rules 作为生成 Copy_Draft 的创作依据，并在 Copy_Draft 中显示已应用的 Source_Rules 标识。
2. WHEN Copywriter_Workspace 生成 Copy_Draft，THE Copywriter_Workspace SHALL 只针对 Content_Brief 中指定的一个目标人群创作标题、首句、正文和标签。
3. WHEN Copywriter_Workspace 生成 Copy_Draft，THE Copywriter_Workspace SHALL 输出恰好 5 个标题，且每个标题不超过 20 个汉字。
4. WHEN Copywriter_Workspace 生成标题，THE Copywriter_Workspace SHALL 为每个标题包含至少一个数字或一种情绪钩子，并包含信息缺口或反差。
5. WHEN Copywriter_Workspace 生成标题，THE Copywriter_Workspace SHALL 从全部标题中排除“分享”“干货”“必看”“收藏”以及 Blocked_Term_List 中的全部用语。
6. WHEN Copywriter_Workspace 生成 Copy_Draft，THE Copywriter_Workspace SHALL 将首句输出为承接标题的反转、结论、时间、价格或使用场景，且首句不得使用寒暄语。
7. WHEN Copywriter_Workspace 生成 Copy_Draft，THE Copywriter_Workspace SHALL 在前 3 行中呈现结果、成品、收入、效果、数字或对比中的至少一项。
8. WHEN Copywriter_Workspace 生成 Copy_Draft，THE Copywriter_Workspace SHALL 在标题或首句中表达羡慕、焦虑、恐惧、感动、好奇或收藏中的恰好一种目标情绪。
9. WHEN Copywriter_Workspace 生成 Copy_Draft，THE Copywriter_Workspace SHALL 将痛点表述为“场景 + 麻烦”的具体困扰。
10. WHEN Copywriter_Workspace 生成 Copy_Draft，THE Copywriter_Workspace SHALL 在方法区输出工具名称和步骤，并在 Content_Brief 提供参数、口令或模型来源时原样纳入对应方法步骤。
11. WHEN Copywriter_Workspace 生成 Copy_Draft，THE Copywriter_Workspace SHALL 使用 Content_Brief 中的具体数字替代“很多”“很好”或“很久”等模糊量词。
12. WHEN Copywriter_Workspace 生成 Copy_Draft，THE Copywriter_Workspace SHALL 在缺点区输出至少一个由 Content_Brief 支持的真实缺点、瑕疵、限制或注意事项。
13. WHEN Copywriter_Workspace 生成 Copy_Draft，THE Copywriter_Workspace SHALL 在标题或正文第一点中输出“不是 A，是 B”“以前错了”或“突然通了”中的一种反差或认知冲突表达。
14. WHEN Copywriter_Workspace 生成 Copy_Draft，THE Copywriter_Workspace SHALL 输出不超过 300 个汉字的第一人称正文，并以每 2 至 3 句为一个段落换行。
15. WHEN Copywriter_Workspace 生成 Copy_Draft，THE Copywriter_Workspace SHALL 在正文中自然分布 4 至 6 个 Emoji。
16. WHEN Copywriter_Workspace 生成 Copy_Draft，THE Copywriter_Workspace SHALL 输出恰好 3 个正文分点，且每个分点 SHALL 以 Emoji 小标题开头并附有一句说明。
17. WHEN Copywriter_Workspace 生成 Copy_Draft，THE Copywriter_Workspace SHALL 输出结尾互动引导并从结尾互动引导中排除“私信”。
18. WHEN Copywriter_Workspace 生成 Copy_Draft，THE Copywriter_Workspace SHALL 输出恰好 8 个标签，其中包含 3 个大词、3 个中词和 2 个精准长尾词。
19. WHEN Content_Brief 包含已知品牌、工具或节日，THE Copywriter_Workspace SHALL 在标题或首句中引用一个与 Content_Brief 相关的已知品牌、工具或节日。
20. WHEN Copywriter_Workspace 生成 Copy_Draft，THE Copywriter_Workspace SHALL 将干货内容组织为编号步骤、体验内容组织为分点、展示内容组织为每段 1 至 2 行的短段落。
21. WHEN Copywriter_Workspace 生成 Copy_Draft，THE Copywriter_Workspace SHALL 在结尾区输出一个可行动的信息且不得要求点赞。
22. THE Copywriter_Workspace SHALL 将 Copy_Draft 分块显示为目标人群、目标情绪、标题、首句、前 3 行、痛点、方法、真实缺点、正文、标签、结尾互动引导、Source_Record 和规则检查结果。

### Requirement 5: 禁词、事实与声明合规检查

**User Story:** 作为 Operator，我希望在文案发布前检查全部禁词和事实声明，以便按照业务和平台要求修订风险内容。

#### Acceptance Criteria

1. THE Copywriter_Workspace SHALL 提供 Blocked_Term_List 的人工录入、编辑、删除、导入和版本标识功能。
2. WHEN Operator 执行合规检查，THE Copywriter_Workspace SHALL 对 Copy_Draft 的全部 5 个标题、首句、正文、正文分点、标签和结尾互动引导执行逐项 Blocked_Term_List 匹配。
3. WHEN Operator 提供多个 Blocked_Term_List，THE Copywriter_Workspace SHALL 检查每个用户提供清单中的全部用语并在 Compliance_Result 中标识清单来源和版本。
4. WHEN Blocked_Term_List 匹配到一个或多个用语，THE Copywriter_Workspace SHALL 在 Compliance_Result 中展示每个匹配用语、所在分块、匹配次数和对应清单来源。
5. WHEN Blocked_Term_List 未匹配任何用语，THE Copywriter_Workspace SHALL 在 Compliance_Result 中展示“未发现已配置禁词”。
6. WHILE Blocked_Term_List 为空，THE Copywriter_Workspace SHALL 在 Compliance_Result 中展示“未配置禁词清单，未执行禁词匹配”。
7. WHEN Copywriter_Workspace 生成或编辑 Copy_Draft，THE Copywriter_Workspace SHALL 将数据、权威背书、案例、品牌陈述和效果结论限定为 Content_Brief、Supplementary_File 或已引用 Insight_Memory 中具有 Source_Record 的内容。
8. IF Copy_Draft 包含无法映射到 Source_Record 的数据、权威背书或案例，THEN THE Copywriter_Workspace SHALL 将相应内容标识为“需要 Operator 确认”，并提供删除或人工补充来源的入口。

### Requirement 6: 实际 3:4 小红书封面图生成

**User Story:** 作为 Operator，我希望在文案完成后得到可直接审阅和编辑的实际封面图，以便保持笔记视觉与文案一致。

#### Acceptance Criteria

1. WHEN Copy_Draft 完成 Compliance_Result，THE Copywriter_Workspace SHALL 生成 Cover_Brief 和实际 Cover_Image，而非仅生成 Cover_Brief。
2. THE Cover_Image SHALL 使用 3:4 画幅比例。
3. THE Cover_Image SHALL 采用干净留白的构图。
4. THE Cover_Image SHALL 在画面中央显示不超过 9 个汉字的手写感粗体封面标题。
5. THE Cover_Image SHALL 在右下角显示与 Content_Brief 主题相关的小插画。
6. THE Cover_Image SHALL 呈现真实素人感的视觉质感，并排除塑料感 AI 质感。
7. WHEN Copy_Draft 包含真实缺点或注意事项，THE Copywriter_Workspace SHALL 使 Cover_Brief 和 Cover_Image 保持与真实缺点或注意事项一致的表达。
8. WHEN Copywriter_Workspace 显示 Cover_Image，THE Copywriter_Workspace SHALL 同时显示 Cover_Brief、图像尺寸、生成 Source_Record 和人工编辑入口。
9. IF Cover_Image 生成失败，THEN THE Copywriter_Workspace SHALL 展示失败状态、保留 Cover_Brief 和编辑入口，并提供由 Operator 重新生成或上传替代封面的操作。

### Requirement 7: 笔记网址、精确访问授权与可访问内容边界

**User Story:** 作为 Operator，我希望在复盘手中提交笔记网址并按已授权权限获取内容，以便在不绕过平台限制的前提下进行复盘。

#### Acceptance Criteria

1. THE Review_Workspace SHALL 提供 Note_URL 输入区域和 Manual_Content_Input 入口。
2. THE Review_Workspace SHALL 显示账号登录、OpenCLI_Access_Tool 配置、公开数据可访问性、平台条款和指标人工输入的限制说明。
3. WHEN Operator 提交 Note_URL，THE Review_Workspace SHALL 要求 Operator 创建 Access_Authorization_Confirmation，且该确认 SHALL 包含精确 Note_URL、OpenCLI_Access_Tool、访问目的、已登录账号或公开访问状态和确认时间。
4. WHEN Operator 完成 Access_Authorization_Confirmation 且 OpenCLI_Access_Tool 可以在已确认权限内访问 Note_URL，THE Review_Workspace SHALL 仅使用 OpenCLI_Access_Tool 获取 Accessible_Content。
5. IF Operator 未完成 Access_Authorization_Confirmation，THEN THE Review_Workspace SHALL 不发起 Note_URL 访问，并提供 Manual_Content_Input 回退入口。
6. IF OpenCLI_Access_Tool 无法访问 Note_URL，THEN THE Review_Workspace SHALL 展示访问失败原因、保存失败 Source_Record，并提供人工粘贴或输入可用内容的 Manual_Content_Input 入口。
7. WHEN Note_URL 需要账号登录、内容非公开、内容受访问控制或平台限制阻止访问，THE Review_Workspace SHALL 要求 Operator 使用已授权账号完成新的 Access_Authorization_Confirmation 或提供 Manual_Content_Input。
8. THE Review_Workspace SHALL 不提供绕过登录、访问控制、付费墙、反爬机制或平台限制的操作。
9. THE Review_Workspace SHALL 将每次 Accessible_Content 获取记录为包含 Note_URL、Access_Authorization_Confirmation、访问时间、访问结果和内容来源的 Source_Record。

### Requirement 8: 复盘指标、阈值、分层判断与颜色结论

**User Story:** 作为 Operator，我希望按用户指定的复盘指标规则评估笔记，以便获得明确、可解释且不捏造完播率阈值的结论。

#### Acceptance Criteria

1. THE Review_Workspace SHALL 提供曝光、点击率、阅读时长、完播率、点赞率、收藏率、评论率和涨粉数的指标值录入、编辑、删除、数据来源和版本标识功能。
2. WHEN Accessible_Content 或 Manual_Content_Input 未包含曝光、点击率、阅读时长、完播率、点赞率、收藏率、评论率或涨粉数中的一个指标值，THE Review_Workspace SHALL 将缺失指标标识为“需要人工输入”，且不得从 Note_URL 或其他指标推断缺失指标值。
3. WHEN Operator 输入一个缺失指标值，THE Review_Workspace SHALL 在当前 Review_Result 中使用该指标值并记录 Manual_Content_Input 来源。
4. WHEN 可获取完播率，THE Review_Workspace SHALL 显示完播率、数据来源和“供人工复盘”标识，且不得为完播率生成或应用未由 Operator 定义的通过阈值、优秀阈值或低表现阈值。
5. WHEN 曝光大于 5000 且 Review_Workspace 未识别任何违规，THE Review_Workspace SHALL 输出“流量优秀且无任何违规”的曝光结论。
6. WHEN 曝光大于 2000 且小于 5000，THE Review_Workspace SHALL 输出“流量中等且无违规、内容质量不佳”的曝光结论。
7. WHEN 曝光大于 500 且小于 2000，THE Review_Workspace SHALL 输出“流量低且无违规、内容质量严重不佳且可能有违规”的曝光结论。
8. WHEN 曝光大于 100 且小于 500，THE Review_Workspace SHALL 输出“检查账号异常或严重违规”的提示。
9. WHEN 曝光小于 100，THE Review_Workspace SHALL 输出“隐藏笔记并进行养号操作”的提示。
10. IF 曝光等于 100、500、2000 或 5000，THEN THE Review_Workspace SHALL 将曝光标识为“阈值边界值，需要 Operator 人工确认”，且不得将曝光归类为未定义的流量等级。
11. WHEN 点击率大于 15%，THE Review_Workspace SHALL 输出“封面优秀”的点击率结论并总结可复用点。
12. WHEN 点击率大于或等于 9% 且小于 15%，THE Review_Workspace SHALL 提供封面改进意见。
13. WHEN 点击率小于 9%，THE Review_Workspace SHALL 提供加强封面的改进意见。
14. IF 点击率等于 15%，THEN THE Review_Workspace SHALL 将点击率标识为“阈值边界值，需要 Operator 人工确认”，且不得将点击率归类为未定义的封面等级。
15. WHEN 阅读时长大于 20 秒，THE Review_Workspace SHALL 输出“内容优质”的阅读时长结论并总结可复用点。
16. WHEN 阅读时长大于或等于 10 秒且小于 20 秒，THE Review_Workspace SHALL 输出“内容一般”的阅读时长结论。
17. WHEN 阅读时长小于 10 秒，THE Review_Workspace SHALL 输出“吸引点很少”的阅读时长结论。
18. IF 阅读时长等于 20 秒，THEN THE Review_Workspace SHALL 将阅读时长标识为“阈值边界值，需要 Operator 人工确认”，且不得将阅读时长归类为未定义的内容质量等级。
19. WHEN 点赞率大于 15%，THE Review_Workspace SHALL 输出“点赞优秀”的点赞率结论。
20. WHEN 点赞率大于或等于 10% 且小于 15%，THE Review_Workspace SHALL 输出“点赞一般”的点赞率结论。
21. WHEN 点赞率大于或等于 5% 且小于 10%，THE Review_Workspace SHALL 输出“点赞少吸引点”的点赞率结论。
22. WHEN 点赞率小于 5%，THE Review_Workspace SHALL 输出“点赞极少吸引点”的点赞率结论。
23. IF 点赞率等于 15%，THEN THE Review_Workspace SHALL 将点赞率标识为“阈值边界值，需要 Operator 人工确认”，且不得将点赞率归类为未定义的点赞等级。
24. WHEN 收藏率大于 13%，THE Review_Workspace SHALL 输出“收藏优秀”的收藏率结论。
25. WHEN 收藏率大于或等于 3% 且小于 13%，THE Review_Workspace SHALL 输出“收藏一般”的收藏率结论。
26. WHEN 收藏率小于 3%，THE Review_Workspace SHALL 输出“不值得收藏”的收藏率结论。
27. IF 收藏率等于 13%，THEN THE Review_Workspace SHALL 将收藏率标识为“阈值边界值，需要 Operator 人工确认”，且不得将收藏率归类为未定义的收藏等级。
28. WHEN 评论率大于 5%，THE Review_Workspace SHALL 输出“评论优秀”的评论率结论。
29. WHEN 评论率大于或等于 1% 且小于 5%，THE Review_Workspace SHALL 输出“评论一般”的评论率结论。
30. WHEN 评论率小于 1%，THE Review_Workspace SHALL 输出“无评论吸引”的评论率结论。
31. IF 评论率等于 5%，THEN THE Review_Workspace SHALL 将评论率标识为“阈值边界值，需要 Operator 人工确认”，且不得将评论率归类为未定义的评论等级。
32. WHEN 涨粉数大于 30，THE Review_Workspace SHALL 输出“涨粉优秀”的涨粉数结论。
33. WHEN 涨粉数小于或等于 30，THE Review_Workspace SHALL 输出“涨粉一般”的涨粉数结论。
34. WHEN 曝光大于 5000、点击率大于 15%、阅读时长大于 20 秒、点赞率大于 15%、收藏率大于 13%、评论率大于 5% 和涨粉数大于 30 中至少 4 项具备值且满足对应条件，THE Review_Workspace SHALL 输出绿色“笔记文案优秀”。
35. WHEN 曝光大于 5000、点击率大于 15%、阅读时长大于 20 秒、点赞率大于 15%、收藏率大于 13%、评论率大于 5% 和涨粉数大于 30 中具备值且满足对应条件的项目少于 4 项，THE Review_Workspace SHALL 输出黄色“笔记文案仍需改进”。
36. WHILE 曝光、点击率、阅读时长、点赞率、收藏率、评论率和涨粉数均缺少值，THE Review_Workspace SHALL 显示“需要人工输入核心优秀指标”，且不得输出总体颜色结论。

### Requirement 9: 复盘结论、低表现建议和指定模板

**User Story:** 作为 Operator，我希望获得结构化复盘、针对低表现指标的可执行建议和有效复盘模板，以便改进下一篇小红书笔记。

#### Acceptance Criteria

1. WHEN Review_Workspace 具备 Accessible_Content 或 Manual_Content_Input，THE Review_Workspace SHALL 输出包含内容摘要、已评估指标、颜色结论、表现原因、可执行建议和数据缺口的 Review_Result。
2. WHEN 点击率小于 9%，THE Review_Workspace SHALL 生成针对低点击率的封面和标题分析建议，且每条建议 SHALL 关联 Cover_Image、封面标题、标题钩子或首句中的至少一项。
3. WHEN 阅读时长小于 10 秒，THE Review_Workspace SHALL 生成针对低阅读时长的内容吸引点分析建议，且每条建议 SHALL 关联首句、前 3 行、具体痛点、目标情绪、可复制方法或数字参数中的至少一项。
4. WHEN 完播率可获取且 Operator 将完播表现标记为低，THE Review_Workspace SHALL 生成针对低完播表现的内容节奏、结构或吸引点分析建议，且不得依据系统捏造的完播率阈值将完播表现标记为低。
5. WHEN 点赞率小于 10% 或收藏率小于 3%，THE Review_Workspace SHALL 生成针对低点赞或低收藏的价值表达分析建议，且每条建议 SHALL 关联具体痛点、可复制方法、数字参数、真实缺点、互动结尾或内容结构中的至少一项。
6. WHEN 评论率小于 1%，THE Review_Workspace SHALL 生成针对低评论的互动设计分析建议，且每条建议 SHALL 关联结尾互动引导、目标人群、目标情绪、具体痛点或标题钩子中的至少一项。
7. WHEN Review_Workspace 输出可执行建议，THE Review_Workspace SHALL 为每条建议显示对应的低表现指标、指标值、触发分层规则和 Source_Record。
8. THE Review_Workspace SHALL 输出有效的 Markdown 复盘模板，且模板 SHALL 使用唯一字段标签和非空占位区域包含至少日期、笔记主题、封面或标题、点击率、完播率、点赞率、收藏率、评论率、复盘结论（好在哪和差在哪）以及下次改进点。
9. WHEN Review_Workspace 输出复盘模板，THE Review_Workspace SHALL 为曝光、点击率、阅读时长、完播率、点赞率、收藏率、评论率和涨粉数中的每个可获取指标显示指标值、数据来源和适用的分层结论或“供人工复盘”标识。
10. WHEN Accessible_Content 或 Manual_Content_Input 缺少复盘所需数据，THE Review_Workspace SHALL 在 Review_Result 中区分“可观察结论”“需要人工确认”和“无法评估”的内容。
11. WHEN Review_Workspace 输出结论、原因或建议，THE Review_Workspace SHALL 为每项内容显示对应 Source_Record。

### Requirement 10: 合规洞察记忆与后续引用

**User Story:** 作为 Operator，我希望将合规的复盘洞察用于后续创作，以便逐步积累可复用的运营经验。

#### Acceptance Criteria

1. WHEN Operator 选择一个 Review_Insight 保存到 Insight_Memory，THE Review_Workspace SHALL 对 Review_Insight 执行 Blocked_Term_List 检查。
2. WHEN Review_Insight 未匹配 Blocked_Term_List，THE Review_Workspace SHALL 将 Review_Insight、来源 Note_URL 或 Manual_Content_Input、保存时间、Metric_Threshold_Set 版本、Source_Record 和 Compliance_Result 保存到 Insight_Memory。
3. IF Review_Insight 匹配 Blocked_Term_List，THEN THE Review_Workspace SHALL 阻止保存该 Review_Insight 并展示匹配用语、所在内容和对应清单来源。
4. WHEN Copywriter_Workspace 生成 Copy_Draft 且 Operator 选择引用 Insight_Memory，THE Copywriter_Workspace SHALL 显示每条被引用 Review_Insight 的来源、保存时间、指标版本和 Source_Record。
5. WHEN Insight_Memory 被引用，THE Copywriter_Workspace SHALL 将 Insight_Memory 作为辅助创作信息且不得替代当前 Content_Brief 的业务事实。

### Requirement 11: Agent、模型与 pi-ai/OpenRouter 凭据安全约束

**User Story:** 作为 Operator，我希望系统在使用 AI 能力时保护凭据并遵循指定技术边界，以便安全地运行运营工作流。

#### Acceptance Criteria

1. THE Team_TJ_Website SHALL 使用 pi-ai 作为 Copywriter_Workspace 和 Review_Workspace 的核心 Agent 框架。
2. WHEN Team_TJ_Website 发起模型调用，THE Team_TJ_Website SHALL 仅选择 OpenRouter_Free_Model。
3. THE Team_TJ_Website SHALL 仅从服务端环境变量读取 pi-ai、OpenRouter、OpenCLI_Access_Tool 和部署服务所需的 Credential。
4. THE Team_TJ_Website SHALL 在客户端代码、用户界面、API 响应、导出内容、应用日志和错误信息中排除 Credential 明文。
5. WHEN Team_TJ_Website 记录模型调用或 OpenCLI_Access_Tool 调用，THE Team_TJ_Website SHALL 记录调用状态、模型标识或工具标识和 Source_Record，且 SHALL 从记录中排除 Credential。
6. IF 缺少模型调用或 OpenCLI_Access_Tool 调用所需 Credential，THEN THE Team_TJ_Website SHALL 返回不包含 Credential 内容的配置缺失提示，并提供由 Operator 修正配置或使用人工输入回退的说明。

### Requirement 12: 可审阅性、来源可追溯与人工控制

**User Story:** 作为 Operator，我希望在每个自动化结论旁看到来源、限制和人工操作入口，以便对发布与复盘结果保持最终控制权。

#### Acceptance Criteria

1. THE Team_TJ_Website SHALL 为 Copy_Draft 显示使用的 Source_Rules、Content_Brief、Supplementary_File、Insight_Memory、Blocked_Term_List 和 Compliance_Result 来源。
2. THE Team_TJ_Website SHALL 为 Cover_Image 显示 Cover_Brief、Content_Brief、生成时间、图像状态和人工编辑或替换来源。
3. THE Team_TJ_Website SHALL 为 Review_Result 显示 Note_URL、Access_Authorization_Confirmation、Accessible_Content 或 Manual_Content_Input、Metric_Threshold_Set、数据缺口和各项结论来源。
4. WHEN Team_TJ_Website 显示受账号登录、公开数据可访问性、人工指标输入或平台条款影响的结果，THE Team_TJ_Website SHALL 同时显示对应限制、Source_Record 和 Operator 可执行的下一步操作。
5. THE Team_TJ_Website SHALL 允许 Operator 在发布或保存前人工编辑 Copy_Draft、Cover_Brief、Cover_Image 标题、Metric_Threshold_Set、Manual_Content_Input、Review_Result 和 Review_Insight。
6. WHEN Operator 编辑 Copy_Draft、Cover_Brief、Cover_Image 标题、Metric_Threshold_Set、Manual_Content_Input、Review_Result 或 Review_Insight，THE Team_TJ_Website SHALL 保存编辑人、编辑时间、编辑前后值和编辑原因，并提供重新执行相关合规检查或阈值评估的操作。
7. WHEN Operator 选择发布、保存或导出 Copy_Draft、Cover_Image、Review_Result 或 Review_Insight，THE Team_TJ_Website SHALL 要求 Operator 确认当前版本，并将确认时间和 Source_Record 保存为审阅记录。
