# 1688 CLI：面向 AI Agent 的阿里巴巴 1688.com 商品搜索与供应商采集 CLI

[![npm version](https://img.shields.io/npm/v/1688-cli.svg)](https://www.npmjs.com/package/1688-cli)
[![npm downloads](https://img.shields.io/npm/dm/1688-cli.svg)](https://www.npmjs.com/package/1688-cli)
[![license](https://img.shields.io/npm/l/1688-cli.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/1688-cli.svg)](https://nodejs.org/)

[English](./README.md) | 简体中文

阿里巴巴 1688.com 批发采购命令行工具：商品搜索、供应商公司搜索、供应商采集/调研、
以图搜货、售前询盘、购物车、下单、订单跟踪、卖家聊天。管道输出时自动切换为 JSON（适配
Codex / Claude Code / 其他 AI agent），终端 TTY 下则输出可读文本。

你可以在终端里做的 6 件事：

1. **找货** — 商品采集/调研 + 供应商采集/调研
2. **售前询盘** — 向卖家提问，实时查看回复
3. **购物车** — 添加 SKU（带差异确认）
4. **下单** — 预览 + 提交订单
5. **订单跟踪** — 列表 / 详情 / 物流 / 逾期检测
6. **售后沟通** — 催发货，以 JSON 流读取回复

```bash
npm i -g 1688-cli
1688 login                                       # 用 1688 App 扫码登录

# 商品采集 / 商品调研
1688 search "佛龛柜" --max 10                                 # 关键词搜索
1688 search "手机壳" --sort best-selling --price-max 50        # 排序/筛选采购
1688 research 手机壳 数据线 --max-per-query 50 --jsonl         # 多关键词调研数据集
1688 image-search ./sample.jpg                                # 本地图片搜货
1688 offer 628196518518                                       # 单个商品详情
1688 offer 628196518518 1234567890 --json --pretty --pro      # 批量商品详情，绕过 daemon
1688 compare 628196518518 1234567890                          # 对比商品详情

# 供应商采集 / 供应商调研
1688 supplier search 键盘 --factory-only --json                # 公司搜索供应商发现
1688 supplier research 键盘 --enrich top:5 --csv               # 供应商评分 + inspect 增强
1688 supplier inspect 628196518518                            # 检查供应商/工厂信任信号

# 售前询盘（支持 AI agent 实时监听）
1688 seller inquire 628196518518 "支持定制 logo 吗？"          # 向卖家提问
1688 seller messages --offer 628196518518                     # 一次性读取回复
1688 seller messages --offer 628196518518 --watch             # 实时追踪新回复（管道时输出 JSON）

# 订单跟踪 & 售后沟通
1688 order list --status waitsellersend                       # 订单列表
1688 order get      <orderId>                                 # 单个订单详情
1688 order logistics <orderId>                                # 物流跟踪
1688 seller chat    <orderId> "麻烦尽快发货谢谢"               # 催发货
1688 seller messages <orderId>                                # 读取卖家回复
```

---

## 为什么用这个

现有的 1688 自动化方案很重：需要自己维护 Selenium 胶水代码、浏览器插件没法 pipe 到
shell、MCP server 跟 agent 工具链打架。`1688-cli` 一个命令搞定：

- **底层是真 Microsoft Edge**（`channel:'msedge'`）。跟你手动用的浏览器一样 — session 是真实的，
  不是虚拟 Chromium。
- **持久化 profile** 存在 `~/.1688/` 下。一次登录管几周，多个买家 profile 互相隔离。
- **Profile 级 daemon** — 每个 profile 维护一个预热浏览器 context，后续命令复用，无需
  重复启动 Chrome。
- **JSON / 文本双模式** — `1688 order list | jq` 能正常工作；`1688 order list` 在终端
  直接输出可读格式。
- **面向 AI agent 设计。** 契约文档见 [AGENTS.md](./AGENTS.md)。

### 不做的事

这不是整站批量扒取的营销/爬虫工具，也不是下单自动化农场。它复现买家手动操作的流程：挑
商品、问卖家、下单、跟踪物流。下单（`checkout confirm`）需要 TTY 交互确认或显式传入
`--agent` 标志，防止 agent 在无人监督的情况下划款。

---

## 安装

需要 Node 20+ 和（推荐）Google Chrome。如果没有 Chrome，postinstall 会自动下载
Playwright 内置 Chromium（约 150 MB；国内用户自动走 npmmirror 镜像）。

```bash
npm i -g 1688-cli
1688 doctor                # 检查环境
1688 login                 # 一次性扫码登录
```

---

## 命令速查表

| 命令 | 说明 |
|---|---|
| `1688 login` | 扫码登录，自动启动 daemon |
| `1688 search <keyword>` | 关键词商品搜索，支持筛选 |
| `1688 research <keywords...>` | 多关键词采购调研，带评分与增强 |
| `1688 compare <offerIds...>` | 对比多个商品详情 |
| `1688 supplier inspect <target>` | 供应商身份、工厂档案、信任信号 |
| `1688 supplier search <keywords...>` | 公司搜索供应商发现 |
| `1688 supplier research <keywords...>` | 带评分的供应商数据集 + inspect 增强 |
| `1688 image-search <path\|url>` | 本地图片或 URL 以图搜货 |
| `1688 offer <offerIds...>` | 单个或批量商品详情（SKU、包装、图片） |
| `1688 similar <offerId>` | 找同款（官方入口） |
| `1688 inbox` | 最近旺旺会话列表 |
| `1688 seller inquire` | 售前询盘：发送商品链接 + 问题 |
| `1688 seller messages` | 读取卖家会话消息 |
| `1688 seller chat` | 向卖家发送消息（订单或售前） |
| `1688 checkout prepare` | 预览订单金额/地址/商品（只读） |
| `1688 checkout confirm` | 提交购物车商品下单 |
| `1688 cart list` | 查看购物车 |
| `1688 cart add` | 按 offerId + SKU 加入购物车 |
| `1688 cart remove` | 按 cartId 移除购物车商品 |
| `1688 shipped <orderId>` | 订单详情 + 物流合并视图 |
| `1688 stuck` | 付款超过 N 天未发货的订单 |
| `1688 fake-shipped` | 标记已发货但快递未揽收（虚假发货） |
| `1688 seller-history <seller>` | 某卖家全部订单 + 统计 |
| `1688 order list` | 按状态列出买家订单 |
| `1688 order get <orderId>` | 按 orderId 查看单个订单 |
| `1688 order logistics <orderId>` | 物流状态 + 运单号 |
| `1688 whoami` | 当前登录账号信息 |
| `1688 logout` | 退出登录并清除本地 session |
| `1688 doctor` | 检查环境、profile、Chromium 和 session |
| `1688 serve` | 前台运行 1688 daemon |
| `1688 daemon start\|stop\|reload\|status` | 管理后台 daemon |
| `1688 profile list\|status` | 查看本地 1688 profile |
| `1688 debug list\|last\|show` | 查看最近的命令事件和诊断产物 |
| `1688 feedback` | 提交反馈或 bug 报告 |

---

## 命令详解

按买家旅程组织：发现 → 询问 → 决策 → 购买 → 跟踪 → 跟进。

### 1. 找货 — 商品采集与供应商采集

找货有两条独立路径。当你从商品或 offer 入手时，用**商品采集 / 商品调研**。
当你从公司、工厂或供应商资质入手时，用**供应商采集 / 供应商调研**。

#### 商品采集 / 商品调研

```bash
1688 search 机械键盘 --max 20                    # 关键词搜索
1688 search 手机壳 --sort best-selling --price-max 50 --exclude-ads
1688 research 手机壳 数据线 --max-per-query 50 --enrich top:5 --csv
1688 image-search ./shoe.jpg                     # 本地图片搜货
1688 image-search https://.../img.png            # URL 以图搜货
1688 offer 628196518518                          # 单个商品详情（priceTiers、attributes、packageInfo、SKU）
1688 offer 628196518518 1234567890 --pro --json  # 批量商品详情，绕过 daemon
1688 compare 628196518518 1234567890             # 对比价格/MOQ/SKU/销量信号
```

#### 批量商品采集

传入多个 offer ID 逐个采集。单个 ID 保持原有 JSON 结构；多个 ID 返回 batch envelope：

```bash
1688 offer 967417789506 --json --pretty                      # 单个 → OfferResult
1688 offer 967417789506 --json --pretty --pro                # 单个，绕过 daemon pause
1688 offer 967417789506 817273094122 --json --pretty --pro   # 批量 → OfferBatchResult
```

批量输出结构：

```json
{
  "mode": "batch",
  "total": 2,
  "success": 2,
  "failed": 0,
  "offerIds": ["967417789506", "817273094122"],
  "offers": [ /* ... */ ],
  "failures": []
}
```

- `--pro` 为每个 offer 绕过 daemon 健康暂停。
- `RISK_CONTROL` 导致的单商品失败进入 `failures[]`，不中断批量采集。
- 进度信息写入 stderr，`--json --pretty` 的 stdout 保持干净。

#### Deep Pro 搜索

先搜索，再对搜索结果中的 offerId 逐个以 pro inline 模式深度采集。
每个 offer 首次失败后最多重试 2 次。

```bash
# 正式 npm 安装版
1688 search "修枝剪" --max 30 --deeppro --json --pretty

# 本地开发版
node .\dist\cli.js search "修枝剪" --max 30 --deeppro --json --pretty

# 价格区间过滤的深度搜索
1688 search "修枝剪" --max 15 --price-min 5 --price-max 20 --deeppro --json --pretty
```

> `--price-min` / `--price-max` 过滤搜索页卡片价格。
> DEEPPRO 详情页价格可能超出搜索页范围，因为详情页会展开全部 SKU。

输出在正常搜索结果旁附带 `deeppro` envelope：

```json
{
  "keyword": "修枝剪",
  "total": 30,
  "offers": [ /* 正常搜索结果 */ ],
  "deeppro": {
    "enabled": true,
    "total": 30,
    "success": 27,
    "failed": 3,
    "offers": [ /* 完整 OfferResult 深度采集 */ ],
    "failures": [
      { "offerId": "...", "code": "RISK_CONTROL", "message": "...", "attempts": 3 }
    ]
  }
}
```

- `--max` 控制深度采集的搜索结果数量。
- `--deeppro` 为每个 offer 使用 pro inline 采集，绕过 daemon 健康暂停。
- `--deeppro-delay-min` / `--deeppro-delay-max` 控制两次采集之间的等待时间（默认 6–10 秒）。
- `--deeppro-search-mode inline`（默认）：搜索阶段也绕过 daemon。
- `--deeppro-search-mode daemon`：搜索阶段走 daemon，offer 深采仍为 pro inline。
  此模式更接近旧脚本流程，敏感类目或搜索结果不稳定时可尝试。
- `--deeppro-output-dir <dir>`：保存 search.json、每次 offer attempt JSON、错误 JSON、最终 JSON
  以及 summary.json，方便离线排查 deeppro 为何判失败。
- 每个 offer 最多尝试 3 次（1 次初始 + 2 次重试）。
- 进度信息写入 stderr；stdout 保持干净 JSON。
- `RISK_CONTROL` 仍然表示 1688 自身返回了验证挑战。

```bash
# 敏感类目调试：daemon 搜索模式 + 输出文件落盘
node .\dist\cli.js search "飞机杯" --max 5 --deeppro --deeppro-search-mode daemon \
  --deeppro-output-dir .\deeppro_debug --json --pretty \
  1> result.json 2> progress.txt
```

`1688 search` 和 `1688 research` 以 offer 为核心。它们搜索商品 offer、评分、导出数据集，
并可通过详情页增强排名靠前的 offer。当价格、MOQ、SKU 深度、销量信号、图片和 offer 级
对比是首要决策点时，走这条路径。

`1688 similar <offerId>` 保留供兼容 1688 官方"找同款"入口使用，但该入口目前在测试中返回
空的以图搜货壳。该命令不会回退到关键词搜索或以图搜货，因为那些结果不是严格的同款匹配。

#### 供应商采集 / 供应商调研

```bash
1688 supplier search 键盘 --factory-only           # 公司搜索供应商发现，不是 offer 聚合
1688 supplier search 键盘 --max 20 --province 广东 --city 深圳
1688 supplier research 键盘 --enrich top:5 --csv   # 供应商评分 + 可选 supplier inspect 增强
1688 supplier inspect 628196518518                # 供应商身份、工厂档案、信任/服务信号
1688 supplier inspect b2b-22066467246504ba0d      # 按 supplier memberId 检查
```

`1688 supplier search` 是只读的 1688 供应商采集器。它直接通过 1688 公司搜索
（`companySearchBusinessService`）按关键词和筛选条件拉取供应商/公司记录，不通过
聚合商品 offer 结果来构建供应商列表。

`1688 supplier research` 是建立在该供应商采集器之上的评分/导出工作流，可对排名靠前的
企业进行 `supplier inspect` 增强。当工厂身份、经营年限、复购/响应率、所在地、公司简介
和供应商资质是首要决策点时，走这条路径。

#### 我应该选哪条路径？

| 需求 | 命令 |
|---|---|
| 找商品 offer | `1688 search <keyword...>` |
| 构建带评分的商品数据集 | `1688 research <keyword...>` |
| 官方同款匹配 | `1688 similar <offerId>`（官方入口返回空时暂不可用） |
| 查看单个商品 offer | `1688 offer <offerId>` |
| 批量采集商品 offer | `1688 offer <offerId...>` |
| 对比商品 offer | `1688 compare <offerId...>` |
| 直接找公司或工厂 | `1688 supplier search <keyword...>` |
| 构建带评分的供应商数据集 | `1688 supplier research <keyword...>` |
| 检查单个供应商/工厂 | `1688 supplier inspect <offerId\|memberId>` |

供应商公司搜索参数：

```bash
1688 supplier search 键盘 --max 20 --factory-only --province 广东 --city 深圳
1688 supplier search 键盘 --min-years 3 --min-repeat-rate 0.4 --min-response-rate 0.6
1688 supplier research 键盘 --enrich top:10 --jsonl
1688 supplier research 键盘 --enrich top:5 --csv --output suppliers.csv
```

`supplier search` 默认不做增强（`--enrich 0`）。`supplier research` 默认
`--enrich top:10`，在可用 `memberId` 时调用 `supplier inspect` 增强排名靠前的公司搜索
供应商。供应商结果包含公司名称、`memberId`、店铺 URL、所在地、经营年限、工厂信号、
复购/响应率、近 3 个月订单/金额信号、评分细项，以及公司搜索 payload 中的商品预览。

### 2. 售前询盘 — 向卖家提问

> 使用与 §6 相同的 `seller messages` / `seller chat` 工具，通过
> `--offer <offerId>` 而非 orderId 来限定范围。

```bash
1688 seller inquire 628196518518 "支持定制 logo 吗？"               # 发送商品链接 + 问题
1688 seller messages --offer 628196518518                          # 读取回复（一次性）
1688 seller messages --offer 628196518518 --since 2026-05-13T10:00:00+08:00
1688 seller messages --offer 628196518518 --watch --interval 30    # 实时追踪新回复
```

**Watch 模式**在 stdout 被管道时仅输出新到达的消息（行分隔 JSON）—— pipe 到任意 agent。
去重基于服务端 `messageId`。最小间隔 10 秒。

### 3. 购物车 — 添加 SKU

```bash
1688 cart list
1688 cart add    <offerId> --sku <skuId> --qty 2
1688 cart remove <cartId>
```

`cart add` 返回 `{added: CartItem, isNewRow, addedQuantity}`，即使同一 SKU 已在购物车
中（服务端会合并到已有行），管道也能可靠地拿到新的 cartId：

```bash
id=$(1688 cart add 628196518518 --sku 6070845665229 --qty 1 | jq -r '.added.cartId')
1688 cart remove "$id"
```

PowerShell 等效写法：

```powershell
$added = 1688 cart add 628196518518 --sku 6070845665229 --qty 1 --json | ConvertFrom-Json
1688 cart remove $added.added.cartId
```

### 4. 下单

```bash
1688 checkout prepare <cartIds...>           # 预览金额/地址/商品 — 安全，只读
1688 checkout confirm <cartIds...>           # 默认：TTY 交互确认 y/N
1688 checkout confirm <cartIds...> -y        # 跳过确认提示（仍需 TTY）
1688 checkout confirm <cartIds...> --agent   # AI agent 模式：无交互提示（显式授权）
```

### 5. 订单跟踪

```bash
1688 order list                                       # 全部状态（含操作、服务、标记）
1688 order list --status waitsellersend               # 已付款待发货
1688 order list --status waitbuyerreceive             # 已发货待收货
1688 order get   <orderId>                            # 单个订单详情
1688 order logistics <orderId>                        # 运单号 + 物流追踪
1688 order get  <orderId> --status waitbuyerreceive   # 大账号下缩小扫描范围

# 便捷视图
1688 shipped <orderId>                  # 订单详情 + 物流合并
1688 stuck --days 3                     # 付款超过 N 天未发货
1688 fake-shipped --days 1              # 标记发货但快递未揽收（虚假发货）
1688 fake-shipped --debug               # 显示每个候选订单的状态和备注
1688 seller-history <sellerName>        # 某卖家全部订单 + 平均发货天数 + 准时率
```

### 6. 售后沟通 — 催发货 / 维权

> 与 §2 相同的工具，通过 `<orderId>` 限定范围，消息会自动附带订单卡片，
> 回复串在正确会话下。

```bash
1688 seller chat <orderId> "麻烦尽快发货谢谢"                     # 发送（自动附带订单卡片）
1688 seller chat <orderId> "请问什么时候发货" --no-card           # 跟进消息，不附带卡片
1688 seller messages <orderId>                                  # 读取回复
1688 seller messages <orderId> --limit 50 --since 2026-05-01T00:00:00+08:00
1688 seller messages <orderId> --watch                          # 实时追踪
```

### 账号与 daemon

```bash
1688 login                              # 扫码；自动启动 daemon
1688 login --headed                     # 打开真实窗口（风控兜底方案）
1688 login --force                      # 即使已有缓存也重新登录
1688 logout                             # 清除 cookie
1688 whoami                             # 当前昵称 + memberId
1688 doctor                             # 环境检查

1688 daemon start | stop | status | reload
```

### Profiles

每个命令默认使用 `default` profile，除非传入 `--profile <name>`。
默认行为向后兼容：`1688 search 雨伞` 使用默认 profile、默认 daemon、默认锁和默认缓存身份。

当你操作多个买家账号或需要隔离 cookie/session 状态时使用 profile：

```bash
1688 login --profile acc-a --headed
1688 login --profile acc-b --headed

1688 daemon start  --profile acc-a
1688 daemon start  --profile acc-b
1688 daemon status --profile acc-a
1688 daemon status --profile acc-b

1688 search "实木床头柜" --profile acc-a
1688 search "实木床头柜" --profile acc-b

1688 profile list
1688 profile status acc-a
1688 doctor --profile acc-a
```

每个 profile 拥有独立的浏览器持久化目录、daemon 进程、socket/named pipe、pid/version/log
文件、state 文件和锁。不同 profile 可以并行运行；一个 profile 的命令不会等待另一个
profile 的锁。同一 profile 内，daemon 工作保持串行和节奏控制。

### 旺旺会话

```bash
1688 inbox --limit 20                    # 最近会话（最新优先）
1688 inbox --unread                       # 仅未读会话
1688 inbox --profile acc-a                # 限定到指定 profile
```

### Debug — 命令事件检查

```bash
1688 debug list                           # 最近命令事件
1688 debug list --limit 50 --failed       # 失败事件，更长的历史
1688 debug last                           # 最近一次命令事件
1688 debug last --failed                  # 最近一次失败事件
1688 debug show <requestId>               # 完整事件 + 产物位置
```

### Feedback — 提交 bug 报告

```bash
1688 feedback "search --deeppro failed on Windows" --bug --no-open
1688 feedback "offer batch should support --csv export" --submit
```

### Serve — 前台 daemon

```bash
1688 serve --profile default              # 前台运行 daemon
1688 serve --idle-timeout 60              # 自定义空闲超时（分钟）
1688 serve --no-prewarm                   # 启动时跳过 Chromium 预热
```

### Doctor — 环境检查

```bash
1688 doctor                               # 完整检查（含 Chromium 启动测试）
1688 doctor --no-launch                   # 跳过 Chromium 启动测试（更快）
1688 doctor --live                        # 只读实时探测（daemon、产物、事件日志）
1688 doctor --profile acc-a               # 检查指定 profile
```

### Login — 登录选项

```bash
1688 login                                # 扫码，自动启动 daemon
1688 login --timeout 300                  # 等待扫码最长 5 分钟
1688 login --no-daemon                    # 登录但不自动启动 daemon
1688 login --headed                       # 打开真实浏览器窗口而非终端二维码
1688 login --force                        # 即使已有 session 也重新登录
```

### 输出形态原则

- **普通 search**（不带 `--deeppro`）：返回 `{ offers: Offer[] }` — 行为不变。
- **单个 offer**：返回一个 `OfferResult` — 保持原始结构。
- **批量 offer**：返回 `{ mode: "batch", offers: OfferResult[], failures: OfferFailure[] }`。
- **Search `--deeppro`**：返回正常 `offers[]` + `deeppro: { offers: OfferResult[], failures: DeepProFailure[] }`。
- **进度**行写入 `stderr`；**JSON** 输出写入 `stdout`。

---

## FAQ

### 与其他方案的对比

#### 1688-cli 与 MCP server 和 Selenium 脚本有什么区别？

1688-cli 以普通 shell 命令运行，不是 MCP server。Agent 通过 `child_process` 或 shell
管道调用它，而非 MCP 协议 — 更容易与 `jq`、`xargs` 和 CI 脚本组合。相比直接编写底层
浏览器自动化，1688-cli 内置结构化 JSON 输出、session 持久化和预热 context 的 daemon，
无需按项目重新造轮子。

#### 1688 有官方 API，我该用那个吗？

阿里巴巴提供 1688 开放平台（`open.1688.com`），但仅对企业 ISV 合作伙伴开放，需要
销售合同和按应用授权。个人买家、小企业和 AI agent 通常无法获得接入资格。1688-cli
通过一次性扫码使用你正常的买家登录账号，复现你在浏览器中手动能做的一切 — 无需
开发者密钥。

### 账号与验证

#### 这个工具需要 1688 开发者账号或 API 密钥吗？

不需要。登录是在你正常的 1688 手机 App 上一次性扫码 — 和在全新浏览器登录 1688 的
流程一样。默认 session 存储在你的本地 profile（`~/.1688/profiles/default/`）中并在
命令间复用，只有当 1688 使其失效时才需要重新扫码。命名 profile 使用各自独立的目录
（`~/.1688/profiles/<name>/`）。

#### 1688 弹出验证挑战（滑块）怎么办？

1688 偶尔会在陌生 session 或长时间不活动后弹出滑块验证 — 和你在新设备上手动登录时
看到的一样。如果命令因此失败，加 `--headed` 运行一次（如 `1688 search 雨伞 --headed`）；
会打开真实窗口，你手动拖动滑块，验证后的 session 即可用于后续命令。没有自动求解器 —
这和人工操作步骤完全一样。

#### 使用安全吗？账号会被限频吗？

该工具驱动你自己已登录的浏览器 session，只执行你手动也会做的操作 — 搜索、查看订单
详情、发送聊天消息、确认下单。以人工速度使用（默认 `--watch` 间隔 30 秒，最小 10
秒），用于你自己的一个账号。激进自动化、高频抓取或跨大量账号运行超出工具的设计
范围，会增加触发 1688 风控的几率。

---

## 面向 Agent 的 JSON

每个命令在 stdout 被管道时自动切换为 JSON：

```bash
1688 order list --status waitsellersend | jq '.orders[] | {id: .orderId, paid: .paidAt}'
1688 fake-shipped --debug             | jq '.orders[].orderId'
1688 search 雨伞                       | jq '.offers[0:5]'
1688 supplier search 键盘              | jq '.items[0] | {company: .supplier.companyName, memberId: .supplier.memberId, score}'
1688 supplier research 键盘 --enrich top:1 | jq '{source,total,enrichedCount,first: .items[0].supplier.companyName}'
```

供应商搜索 JSON 显式声明数据来源：

```json
{
  "source": {
    "kind": "company-search",
    "endpoint": "companySearchBusinessService",
    "offerAggregation": false
  }
}
```

### 内置 JSON 参数（无需 jq）

每个命令支持四个输出整形参数。适用于 Windows 或任何未安装 `jq` 的环境 — 也适用于
需要精简输出而不解析完整 payload 的 agent。

```bash
1688 offer <id> --json                       # 在 TTY 中强制输出 JSON
1688 offer <id> --json --pretty              # 2 空格缩进 JSON

1688 offer <id> --get supplier.name          # 单个标量字段，原始行
1688 offer <id> --get supplier               # 子对象，JSON 格式
1688 offer <id> --get 'skus[0].skuId'        # 数组索引
1688 offer <id> --get 'skus[*].price'        # 通配符 — 每元素一行

1688 offer <id> --pick price,supplier.name,'skus[0].skuId'
# {"price":1.25,"supplier.name":"...","skus[0].skuId":"..."}
```

路径语法：`field.sub`、`arr[N].field`、`arr[*].field`。通配符每元素输出一行；标量输出
原始行（无引号），对象和数组输出 JSON。不传 `--get`/`--pick` 时仍输出完整 payload，
已有的 `| jq` 管道继续正常运行。

在 TTY 中强制 JSON（`--json` 的替代方式）：

```bash
BB1688_JSON=1 1688 doctor
```

PowerShell：

```powershell
$env:BB1688_JSON = "1"
1688 doctor
Remove-Item Env:\BB1688_JSON
```

### Windows / PowerShell 示例

npm 的 `1688` shim 可在 PowerShell 和 cmd.exe 中使用。未安装 `jq` 时优先使用内置
`--get` / `--pick`：

```powershell
1688 offer 628196518518 --get supplier.name
1688 supplier search 键盘 --pick total,source.kind,'items[0].supplier.companyName'
1688 supplier research 键盘 --csv --output "$env:TEMP\suppliers.csv"
```

Daemon 管理使用相同命令界面：

```powershell
1688 daemon start
1688 daemon status --json
1688 daemon stop

1688 daemon start --profile acc-a
1688 daemon status --profile acc-a --json
1688 daemon stop --profile acc-a
```

---

## 风控处理

如果 1688 弹出滑块验证，用 `--headed` 处理一次：

```bash
1688 search 雨伞 --headed     # 打开窗口；手动拖动滑块
1688 supplier search 键盘 --headed
1688 search 雨伞              # 后续调用复用已验证的 session
```

另见 FAQ 中关于[验证挑战](#1688-弹出验证挑战滑块怎么办)的条目。

---

## 文件与目录

```
~/.1688/profiles/default/   Chromium profile（macOS/Linux）
~/.1688/state.json          缓存身份信息（macOS/Linux）
~/.1688/daemon.sock         daemon Unix socket（macOS/Linux）
~/.1688/daemon.pid          daemon PID
~/.1688/.lock               proper-lockfile（单进程锁）

~/.1688/profiles/<name>/state.json       命名 profile 缓存身份
~/.1688/profiles/<name>/daemon.sock      命名 profile daemon Unix socket
~/.1688/profiles/<name>/daemon.pid       命名 profile daemon PID
~/.1688/profiles/<name>/.lock            命名 profile 锁

%USERPROFILE%\.1688\profiles\default\   Chromium profile（Windows）
%USERPROFILE%\.1688\state.json          缓存身份信息（Windows）
\\.\pipe\1688-cli-daemon-<hash>         daemon named pipe（Windows）
\\.\pipe\1688-cli-daemon-<hash>-<hash>  命名 profile daemon pipe（Windows）
```

## 环境变量

```
BB1688_NO_DAEMON=1          禁用 daemon，始终 inline 运行
BB1688_JSON=1               在 TTY 中强制 JSON 输出
BB1688_DEBUG=1              详细内部日志输出到 stderr
BB1688_FORCE_CHROMIUM=1     跳过系统 Chrome，使用内置 Chromium
BB1688_HOME=<path>          覆盖 ~/.1688 或 %USERPROFILE%\.1688
BB1688_SKIP_POSTINSTALL=1   在 npm install 时跳过 Chromium 下载
PLAYWRIGHT_DOWNLOAD_HOST    自定义 Playwright 镜像
```

---

## 版本状态

Pre-1.0 — 功能面已成型，但在 1.0 之前小版本之间可能存在不兼容变更。详见
[CHANGELOG.md](./CHANGELOG.md)。与阿里巴巴 / 1688 无关联。

## Agent 契约

如果你从 Codex、Claude Code 或其他自主 agent 驱动 `1688-cli`，请阅读
[AGENTS.md](./AGENTS.md) — 其中记录了 JSON 结构、退出码以及写操作命令的规则。

## License

[MIT](./LICENSE)
