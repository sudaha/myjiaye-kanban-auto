# AGENTS.md — 佳业采购雷达（zycg_board）改动纪律

静态商机看板：fetcher 抓数据 → export_static.py 生成 dist → wrangler 部署 Cloudflare Pages（https://kanban.myjiaye.top）。

## 央采询价数据契约（改动前必读）

| 字段 | 含义 | 来源/写入 |
|---|---|---|
| `publish_date` | 原始发标日期（与询价通知书 PDF 落款一致） | fetcher 详情/PDF 解析，`_norm_pub_date` 归一化（10 位时间戳→北京时间串） |
| `pub_date` | **首次上架日**（项目首次进入官网进行中集合被抓到的那天），**稳定不变** | fetcher 首次入库写入；`db.upsert_announcement` 冲突更新**不得覆盖**（pub_date 在 cols 但排除出 updates） |
| meta `mkt_list_latest` | 官网列表上架日期（进行中集合每日刷新成当天） | fetcher 每次抓取写 meta |
| `is_end` | 0=进行中 1=已结束/撤项 | fetcher 每次抓取按官网列表复核（不在列表标 1；首抓/空列表不动状态） |
| `is_new` | 当天新出现项目标"新" | fetcher 快照差集（meta `in_prog_ids` → `data/new_ids.json` 按日累积）；导出只读当天 |

UI 消费端映射（改任一字段口径必须核对这一整行）：

- 表头"最新日期" = max(条目 pub_date, mkt_list_latest)
- 表头"新增 N 条" = new_count（必须 = is_new 条目数）
- 日历 available_dates / "选择公告日期"筛选 / 卡片"发布" / 默认排序 = 条目 `pub_date || publish_date`
- 详情弹层双日期：发布日期 = pub_date、发标日期 = publish_date
- 已结束项展示窗口 = 最近 3 个**原始发标日期**（轮换，窗口只按已结束项 publish_date 算）
- "新"标注 = new_ids.json 当日差集，**不得**改用 pub_date==当天（进行中项会天天全标新）

## 口径/字段改动硬纪律（2026-11-24 用户明确要求）

1. **先列消费端**：改任何数据字段或展示口径前，grep 仓库（export_static.py / static_src/app.js / fetcher.py / db.py）列出该字段的**全部**消费端，改动说明里逐条列出打算如何处理。
2. **一次改完**：所有消费端在同一笔改动里改齐，禁止"先改被点名的那一处、其余等用户发现"。
3. **接口先探测**：涉及官网接口语义（列表返回什么日期、状态含义）时，先写探针脚本看真实返回，禁止凭猜测改口径。
4. **导出自检门禁**：`export_static.py` 末尾 `_consistency_check()` 断言日期格式/首次上架日非空/日历对齐/最新日期/新标注计数/进行中非空——**失败即 RuntimeError 阻断部署**。新增展示口径时同步加对应断言。
5. **部署后核验**：对**实际部署版本**（部署 URL 或线上 status.json + 浏览器实开页面）核验所有消费端，核对版本号戳，确认不是旧缓存/旧部署后再汇报完成。
6. **汇报口径**：向用户汇报数据变更时，"新增 N 条"必须与 new_ids 差集一致；不得把"沿用旧数据"说成已更新。

## 部署要点

- 本地：`python export_static.py`（含自检门禁）→ `npx wrangler pages deploy --project-name=myjiaye-kanban`（**禁止带 dist 参数**，KV 绑定在仓库根 wrangler.json）
- 云端：GitHub Actions 每天 9/13/17/22（sync.yml，fetcher→export→deploy→回写）；push main 后 CF Pages 另会自动触发一次生产部署
- 本机双时段（10:00/15:00 cron）覆盖：国铁商城批采(UKey)/国铁公开/保利/中标喜报/**央采电子询价 fetcher.py**/央采委托(hunter+浏览器通道兜底)
- 所有改动必须 commit+push（生产站会被云端构建用仓库旧代码覆盖）
