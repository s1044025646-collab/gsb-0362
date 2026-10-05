# Siteswap 周期抛接合法性与落点冲突解释后端

一个只做后端的本地服务（HTTP API + 命令行 CLI），用通俗的整数节拍模型分析杂耍基础异步
Siteswap 数字序列：检查每个抛球会落在哪个节拍、是否同拍相撞、合法模式需要几个球，并给出
中文解释。没有动画、没有真实飞行轨迹、没有双手同步抛、没有同拍多球，也不需要你懂杂耍术语。

技术栈：TypeScript + Node.js（内置 `node:sqlite`，无需安装任何数据库软件）+ SQLite。
不依赖 Docker、WSL、付费服务或外部在线 API。

## 一、这个模型在说什么（不需要杂耍背景）

把时间切成一个个均匀的“**节拍**”，编号是任意整数（……、-2、-1、0、1、2、……）。
你给出一个长度为 **L** 的数字序列，例如 `[5,3,1]`，它会**按固定周期重复**：
`…,5,3,1,5,3,1,…`。序列里第 `i` 个数字 `h_i` 是该节拍的“**抛球高度**”。

- **高度不是米，也不是物理高度。** 高度 `h` 的唯一含义是“这一拍抛出的球，会在 `h` 拍之后落下”。
  所以抛在节拍 `t`、高度 `h` 的球，落在节拍 `t+h`。`h=3` 表示“3 拍后落地”，与球飞多高无关。
- **相位（phase）不是球编号。** 周期长度为 L 时，把节拍对 L 取模得到 0..L-1 的“相位”，
  它只表示“这是周期里的第几拍”。不同球可以先后经过同一相位，相位数字不对应某个具体球。
- **高度 0 表示这一拍没有球可抛**（空拍）。0 仍然参与落点映射的数学检查，但不会生成真实的
  抛出/落下事件，也不贡献球数。
- 模型只允许每拍至多一个球落（每拍一次抛接）。这正是合法性检查的核心。

### 合法性判据

第 `i` 项（0 起编号）的**落点相位**是：

```
landingPhase(i) = (i + h_i) mod L
```

序列合法，当且仅当 0..L-1 这 L 个落点相位**每个恰好出现一次**（落点映射是一个排列/双射）。
若某个相位被两个或更多位置同时指向，就发生**落点冲突**：同拍会有多个球落下，模型内无法接住。
同时必然有别的相位无人落向（**未覆盖相位**），报告会一并指出。

**只检查“平均高度是不是整数”并不够。** 平均高度

```
平均高度 = (h_0 + h_1 + … + h_{L-1}) / L
```

在合法模式下正好等于球数（必须是整数）。但 `[3,2,1]` 的平均是 2，是整数，落点相位却全部
撞在相位 0（位置 0→0、1→0、2→0），所以仍然不合法。本服务对这种情况返回正常的分析结果和
原因，而不是报内部错误。

### 合法模式的循环分解与球数

合法时，落点映射是相位上的一个排列，可以分解成若干个互不相交的**循环**，例如 `0→2→0`。
沿一个循环把各拍高度加起来得到 `S`：

- `S / L` 就是这个循环负责的**球数**，必为非负整数；
- 余数为 0 的原因：沿循环走一圈后终点相位必须回到起点，总位移（各高度之和）必然是 L 的整数倍；
- 所有循环的球数相加，恰好等于平均高度（总球数），服务会核对这个等式；
- 零高度固定点（高度 0 指向自己）是一个“空拍循环”，球数为 0，不产生真实事件。

这里**不给物理球分配唯一身份**，也不追求其他最少球算法。

### 有限节拍区间展开（离线，不等时间）

给定整数区间 `[startBeat, endBeat)`，服务一次性算出区间内的抛出与落下事件：

- 每个事件带绝对节拍、相位、高度、配对的另一时刻（`landsAt` / `thrownAt`）；
- **包含区间开始之前已经在空中的球**：搜索起点向前回溯最多 12 拍，落在窗口内的旧球标记
  `throwBeforeWindow: true`。这样窗口左边界不会被误判成“球凭空多出来/落点冲突”；
- 非法模式不生成事件，只给出说明，避免把无意义数据当冲突；
- 输出条数有 `limit` 上限（默认 200，最大 10000），超出时 `truncated: true`，并同时返回
  `totalCount`，绝不会假装这是完整展开。节拍绝对值上限 100000，防止无界计算。

所有展开都是纯算术离线计算，**不会真的等待时间流逝**。

## 二、环境要求

- Windows 本地安装 **Node.js 22.5 或更高**（开发与实测在 Node.js 25.5 上完成）。
  只有较新的 Node 自带 `node:sqlite`；若你的 Node 版本没有该模块，请升级 Node。
- 仅在构建时需要 TypeScript（已列为 devDependencies，`npm install` 即可）。

## 三、构建、测试、启动、演示

在项目根目录（本 README 所在目录）打开 PowerShell：

```powershell
# 1) 安装依赖（只有 typescript 和类型声明，本地完成，不访问业务在线服务）
npm install

# 2) 构建（TypeScript -> dist/）
npm run build

# 3) 跑全部测试（33 个：分析、展开、SQLite 版本、HTTP 端到端、独立暴力枚举交叉核验）
npm test

# 4) 启动 HTTP 服务（默认自动选择一个空闲端口，控制台会打印实际地址）
npm start

# 5) 另开一个终端，运行完整中文演示脚本
npm run demo
```

指定端口或数据目录：

```powershell
$env:PORT = "8080"                 # 不设则端口 0 = 由系统分配空闲端口
$env:SITESWAP_DATA_DIR = "data"    # SQLite 数据目录（默认项目内 ./data）
npm start
```

SQLite 数据库文件位于 `<数据目录>/siteswap.sqlite`（首次启动自动创建，含 WAL 文件）。

## 四、完整中文演示步骤（可照着敲）

### 用 CLI

```powershell
# 演示 1：3 的三球模式
node dist/cli.js analyze "[3]"

# 演示 2：5,3,1 合法模式——看相位循环与各自球数（循环 0->2->0 两球，1->1 一球）
node dist/cli.js cycles "[5,3,1]"

# 演示 3：含零模式，空拍不产生事件
node dist/cli.js analyze "[5,0,1]"

# 演示 4：3,2,1 平均为整数却冲突（给出冲突相位、贡献位置、未覆盖相位）
node dist/cli.js mapping "[3,2,1]"

# 演示 5：循环旋转比较（旋转等价，但各自原始位置保留）
node dist/cli.js rotate "[5,3,1]" "[3,1,5]"

# 演示 6：负起点区间展开，覆盖窗口左边界的在途球
node dist/cli.js expand "[5,3,1]" --start -4 --end 8

# 演示 7：输出截断被明确标记
node dist/cli.js expand "[3]" --start 0 --end 100 --limit 8

# 演示 8：保存模式版本（相同输入再存一次 -> version+1）、保存分析/展开报告并导出
node dist/cli.js save "[5,3,1]"
node dist/cli.js list
node dist/cli.js report 1 analyze
node dist/cli.js report 1 timeline --start -2 --end 6
node dist/cli.js reports 1
node dist/cli.js export 1 --out report1.json
```

一条命令跑完全部演示（输出到控制台，演示数据库在 `data/demo.sqlite`）：

```powershell
npm run demo
```

### 用 HTTP API（服务启动后，把端口换成控制台打印的端口）

```powershell
$base = "http://127.0.0.1:8080"

Invoke-RestMethod "$base/health"

# 完整分析（请求体直接是 JSON 数组）
Invoke-RestMethod "$base/analyze" -Method Post -ContentType "application/json" -Body '[5,3,1]'
Invoke-RestMethod "$base/analyze" -Method Post -ContentType "application/json" -Body '[3,2,1]'

# 旋转比较
Invoke-RestMethod "$base/rotate-compare" -Method Post -ContentType "application/json" `
  -Body '{"a":[5,3,1],"b":[3,1,5]}'

# 有限节拍展开（负起点 + 条数上限）
Invoke-RestMethod "$base/timeline" -Method Post -ContentType "application/json" `
  -Body '{"pattern":[5,3,1],"startBeat":-4,"endBeat":8,"limit":50}'

# 保存模式版本、保存分析报告、保存展开报告、查看与导出
Invoke-RestMethod "$base/patterns" -Method Post -ContentType "application/json" `
  -Body '{"pattern":[5,3,1],"runParams":{"note":"demo"}}'
Invoke-RestMethod "$base/patterns/1/analyses"  -Method Post -Body '{}'
Invoke-RestMethod "$base/patterns/1/timelines" -Method Post -ContentType "application/json" `
  -Body '{"startBeat":-2,"endBeat":6}'
Invoke-RestMethod "$base/patterns/1/reports"
Invoke-RestMethod "$base/reports/1"
```

成功响应统一形如 `{"ok":true,"data":...}`；出错形如
`{"error":{"code":"...","message":"中文说明"}}`，HTTP 400/404，非法输入不会变成 500。

## 五、API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查，返回数据库路径 |
| POST | `/analyze` | 完整分析：校验、映射、冲突、未覆盖相位、循环、球数、最小周期、中文解释 |
| POST | `/rotate-compare` | `{a,b}` 判断两个等长序列是否循环旋转等价，给出左移位数 |
| POST | `/timeline` | `{pattern,startBeat,endBeat,limit?}` 离线展开有限区间事件 |
| POST | `/patterns` | `{pattern,runParams?}` 保存模式（相同输入复用 id、版本号 +1） |
| GET | `/patterns` | 列出全部模式及版本 |
| GET | `/patterns/:id` | 查看单个模式 |
| POST | `/patterns/:id/analyses` | 为已存模式保存一份分析报告（不覆盖旧报告） |
| POST | `/patterns/:id/timelines` | 为已存模式保存一份节拍展开报告（记录区间参数） |
| GET | `/patterns/:id/reports` | 列出某模式的全部历史报告 |
| GET | `/reports` | 全部报告，可用 `?patternId=` 过滤 |
| GET | `/reports/:id` | 导出单份报告（参数与结果完整保存） |

## 六、错误码

| code | 触发条件 | HTTP |
| --- | --- | --- |
| `INVALID_PATTERN` | 请求体不是数组 / CLI 参数不是 JSON 数组 | 400 |
| `INVALID_LENGTH` | 长度不在 1..16 | 400 |
| `NON_INTEGER_VALUE` | 某一项不是整数（含小数、字符串） | 400 |
| `NEGATIVE_VALUE` | 出现负数 | 400 |
| `HEIGHT_OUT_OF_RANGE` | 高度超出 0..12 | 400 |
| `INVALID_RANGE` | 起点/终点不是整数、终点不大于起点、绝对值超 100000 | 400 |
| `INVALID_LIMIT` | limit 不在 1..10000 | 400 |
| `INVALID_JSON` | 请求体不是合法 JSON（或大于 1MB） | 400 |
| `NOT_FOUND` | 模式/报告 id 不存在，或路由不存在 | 404 |
| `INTERNAL` | 兜底内部错误 | 500 |

数学上不合法（如 `[3,2,1]`、平均非整数）**不是错误**：HTTP 200，返回 `valid:false` 加原因。

## 七、数据模型（SQLite）

- `schema_meta`：保存 schema 版本（当前 `1`）。
- `patterns`：`id`、`version`、`pattern_json`（原输入，唯一，不旋转不改写）、`run_params_json`、
  `created_at`。相同输入再次保存时 `version` 自增，旧版本信息通过报告里的 `pattern_version` 留存。
- `reports`：`id`、`pattern_id`、`pattern_version`（保存时的版本快照）、`kind`
  （`analyze` / `timeline`）、`params_json`（运行参数）、`result_json`（完整结果）、`created_at`。
  修改/重新保存模式不会覆盖或删除任何旧报告。

## 八、测试与交叉核验

`npm test` 覆盖：全零零球模式、长度 1、最高高度 12、重复周期（最小基本周期）、旋转等价、
非整数平均、整数平均但冲突（`[3,2,1]`）、负起点区间、左边界在途事件、输出截断、SQLite 版本
与报告保留、HTTP 端到端（含重启式新进程启动选空闲端口）。

此外测试里有一段**独立逐时刻暴力枚举**：不使用分析引擎的结论，直接在长整数时间轴上逐拍抛球、
统计每个节拍的落球数，对多个合法模式断言“每拍 ≤ 1 个真实落球”，并对 `[3,2,1]` 断言长轴上
必然出现同拍两球，从另一条路径交叉验证引擎。

## 九、范围与限制（明确的合理假设）

- 只研究每拍一次抛接的基础**异步** Siteswap：没有同步抛（如 `(4,4)`）、同拍多球、多路数、
  身体动作、真实抛物线、动画或计时等待。
- 数字只取 0..12、长度 1..16；在此范围内平均球数不超过 12，因此不会出现球数超上限的输入。
- “高度 0”是空拍；不引入 Siteswap 文献里的 2（手握）等额外约定，0 就是没有抛接事件。
- 循环与解释的输出顺序固定：循环按其最小相位升序排列，冲突/未覆盖相位按相位升序，便于比较。
- 服务只监听 `127.0.0.1`，面向本机使用，未内置鉴权与 HTTPS。
