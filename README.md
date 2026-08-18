# MetaEvidence · Systematic Review Studio

本地优先的系统评价与 Meta 分析全流程工作台。双击 `启动MetaEvidence.bat` 后，本地检索网关会同时提供网页、数据库代理、限流重试和安全缓存；页面模块位于 `js/`。

## 工作流

1. 研究方案与 PICOS：研究问题、预设结局、纳排标准和注册信息。
2. 多数据库检索：PubMed、Europe PMC、Crossref、OpenAlex；CNKI、万方、维普和 SinoMed 专用检索式。
3. 题录去重与摘要初筛：人群、动物、体外研究规则评分，保留人工最终决策。
4. 全文复筛：记录获取状态、全文排除理由和原文定位。
5. 质量评价：RoB 2、ROBINS-I、Newcastle–Ottawa Scale、SYRCLE 和 GRADE。
6. 数据提取：二分类、连续型和文献已报告效应值；支持结局、时间点、亚组和原文页码。
7. 统计分析：OR、RR、RD、MD、SMD、固定/随机效应、Q、I²、τ²、预测区间、亚组、逐一剔除敏感性分析和 Egger 回归。
8. 图形与报告：森林图、漏斗图、PRISMA 2020、HTML/PDF 项目报告和完整 JSON 备份。

## 检索逻辑

- 同一行的同义词使用 `OR` 连接。
- 不同行及不同概念字段使用 `AND` 连接。
- 各数据库使用专用字段语法，数据库命中数、接口下载数和去重后记录数是不同口径。
- PubMed、Europe PMC、Crossref 与 OpenAlex 并行检索；相同请求在有效期内读取本地缓存，重复检索明显加速。
- 检索网关只允许访问四个预设学术 API，缓存键使用摘要值，不保存检索 URL 或 API Key。
- 人工复核数量时，应在数据库的高级/专业检索中运行完整检索式，并保持年份、扩展选项和检索时间一致。

## 数据与授权

- 研究数据和统计提取表默认保存在当前浏览器。
- 清除浏览器数据会删除本地项目，必须定期使用“备份 JSON”。
- JSON 备份包含方案、题录、筛选决策、数据提取表、质量评价和分析设置。
- API Key 仅保存于本机，并只发送给对应数据库。

## 测试

```powershell
node tests/query-builder.test.mjs
node tests/meta-analysis.test.mjs
```

`meta-analysis.test.mjs` 覆盖 OR、RR 零事件校正、RD、MD、SMD、通用效应值、固定/随机效应、卡方异质性检验、预测区间、亚组分析、Egger 回归和敏感性分析。
