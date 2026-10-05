# Siteswap 周期抛接合法性与落点冲突解释后端

纯本地运行的**异步 Siteswap**（杂耍抛接数学模式）分析服务，只提供 **HTTP API** 与 **命令行（CLI）**，没有界面、没有动画、不依赖 Docker / WSL / 任何在线服务。

技术栈：TypeScript + Node.js（内置 `node:sqlite`，无需安装原生模块）。

---

## 1. 这是什么？通俗解释

一个 siteswap 用一串整数表示，例如 `[5, 3, 1]`。序列周期性地重复：

- 数字的位置表示**节拍**（等间隔的时间点），从 0 开始编号。
- 位置 `i` 上的数字叫**高度** `h`，它的单位是**拍**，不是米，也不表示球飞多高。
- `h` 的含义是：**在第 `t` 拍抛出的球，会在第 `t + h` 拍落下**。
- `h = 0` 表示这一拍手上没有球可抛（空位）；`0` 仍然是序列的正式成员，参与合法性检查，但不产生抛接事件。
- 本服务只研究“每拍至多一个球”的抽象节拍模型，不处理双手同步抛、同拍多球、飞行轨迹和人体动作。

### 相位是什么？不是球编号！

设序列长度为 `L`，任何整数节拍 `t` 的**相位**是：

```
phase(t) = ((t mod L) + L) mod L     （范围 0..L-1，负节拍也适用）
```

相位只是“落在周期里的哪个槽位”，**不是球的身份编号**。本服务不追踪“第几号球”，只检查每个节拍槽位是否恰好被一个落点覆盖。

### 合法性判定（两件事都要满足）

1. **平均高度必须是整数**：`sum(h) / L = 球数`。它就是同时在空中的球数。
2. **落点相位不能冲突**：每个位置 `i` 的落点相位是 `(i + h_i) mod L`，所有 `L` 个落点相位必须恰好覆盖 `0..L-1` 各一次。

只满足第 1 条**不够**。`[3, 2, 1]` 平均高度是 `6/3 = 2`（整数），但三个落点全部挤到相位 0：

```
位置 0: (0+3) mod 3 = 0
位置 1: (1+2) mod 3 = 0
位置 2: (2+1) mod 3 = 0
```

冲突相位是 0，贡献它的原始位置是 0、1、2，未被覆盖的相位是 1、2，因此模式不合法。

### 合法模式的“相位循环”和球数

合法序列的落点映射是相位集合上的一个排列（双射），可以分解成互不相交的循环。例如 `[5, 3, 1]`（L=3）：

```
0 → 2 → 0   （0 拍抛的球落到相位 2，2 拍抛的球落到相位 0）
1 → 1       （1 拍抛的球落回相位 1）
```

沿一个相位循环，每一步的高度可以写成

```
h(pj) = (p(j+1) − pj) + kj·L       （kj 为非负整数）
```

把循环内所有高度相加，相位差逐项望远镜式抵消，总和必然是 `L` 的整数倍，**余数必为 0**；这个倍数就是该循环承担的球数：

```
循环 [0 → 2]：高度 5 + 1 = 6 = 2×3 → 2 个球
循环 [1]：    高度 3     = 3 = 1×3 → 1 个球
合计 2 + 1 = 3 个球，与平均高度 9/3 = 3 一致。
```

全零模式 `[0, 0, 0]` 是**合法的零球模式**：每个零高度都是一个“固定点”循环，高度和为 0，贡献 0 个球。

### 有限节拍区间与“在途”的球

真实世界里，在你开始观察（区间起点）之前，可能已经有球在空中。展开有限区间 `[startTime, endTime]` 时，本服务会把这些“起点前抛出、区间内落下”的球也统计进来（输出 `inFlightFromBefore`），因此窗口左边界的裁剪不会被误判成落点冲突。展开是**离线一次性计算**，不会真的等待时间流逝。

---

## 2. 环境要求

- Windows + Node.js **22 或更高版本**（开发实测 Node.js v25.5.0；使用内置 `node:sqlite`，启动时会有一条 ExperimentalWarning，可忽略）。
- 不需要联网安装除 npm 依赖（`typescript`、`@types/node`）之外的任何东西。

## 3. 构建、测试、启动

在项目根目录打开 PowerShell：

```powershell
npm install        # 安装 typescript 与 @types/node
npm run build      # TypeScript 编译到 dist/
npm test           # 构建并运行 21 个内置测试（含独立逐拍枚举交叉核验）
npm run demo       # 运行完整中文演示（11 个场景，直接打印到终端）
npm start          # 启动 HTTP API，默认自动选择一个空闲端口
```

指定端口和数据文件：

```powershell
node dist/src/cli/cli.js serve --port 8080 --db data/siteswap.sqlite
# 或用环境变量
$env:PORT=8080; npm start
```

数据默认放在**项目内** `data/siteswap.sqlite`（自动创建）。

## 4. 完整中文演示步骤

```powershell
# 步骤 1：构建
npm run build

# 步骤 2：一键演示（3 球模式、5,3,1、含零模式、3,2,1 冲突、
# 全零、最高高度、旋转等价、非整数平均、负起点区间、截断标记）
node dist/src/cli/cli.js demo

# 步骤 3：手动分析几个模式
node dist/src/cli/cli.js analyze [3]
node dist/src/cli/cli.js analyze [5,3,1]
node dist/src/cli/cli.js analyze [5,0,1]
node dist/src/cli/cli.js analyze [3,2,1]

# 步骤 4：循环旋转比较与最小基本周期
node dist/src/cli/cli.js rotate-compare [5,3,1] [3,1,5]

# 步骤 5：离线展开有限节拍（负起点、在途球、截断）
node dist/src/cli/cli.js expand [5,3,1] --start 0 --end 11
node dist/src/cli/cli.js expand [3] --start -2 --end 3
node dist/src/cli/cli.js expand [3] --start 0 --end 23 --limit 6

# 步骤 6：保存模式、保存分析（不覆盖旧报告）、导出
node dist/src/cli/cli.js save [5,3,1] --note "三球模式"
node dist/src/cli/cli.js list
node dist/src/cli/cli.js save-analysis 1
node dist/src/cli/cli.js analyses 1
node dist/src/cli/cli.js export [5,3,1] --out data/report.json

# 步骤 7：启动 API 并用 PowerShell 调用
node dist/src/cli/cli.js serve
# （终端会打印实际端口，例如 http://127.0.0.1:51688）
```

另开一个 PowerShell 窗口（把端口换成实际端口）：

```powershell
$base = 'http://127.0.0.1:51688'
Invoke-RestMethod "$base/health"
Invoke-RestMethod -Method Post "$base/api/analyze" -ContentType 'application/json' -Body '{"pattern":[5,3,1]}'
Invoke-RestMethod -Method Post "$base/api/cycles"  -ContentType 'application/json' -Body '{"pattern":[5,3,1]}'
Invoke-RestMethod -Method Post "$base/api/expand"  -ContentType 'application/json' -Body '{"pattern":[3],"startTime":-2,"endTime":3}'
Invoke-RestMethod -Method Post "$base/api/rotate-compare" -ContentType 'application/json' -Body '{"pattern":[5,3,1],"other":[3,1,5]}'
Invoke-RestMethod -Method Post "$base/api/patterns" -ContentType 'application/json' -Body '{"pattern":[5,3,1],"note":"demo"}'
Invoke-RestMethod -Method Post "$base/api/patterns/1/analyses" -ContentType 'application/json' -Body '{}'
Invoke-RestMethod "$base/api/analyses"
Invoke-RestMethod -Method Post "$base/api/export" -ContentType 'application/json' -Body '{"pattern":[5,3,1]}'
```

## 5. HTTP API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| POST | `/api/analyze` | 校验 + 完整分析（合法/不合法都返回 200 与分析结果） |
| POST | `/api/validate` | 同 analyze 的校验入口 |
| POST | `/api/mapping` | 只看落点映射 |
| POST | `/api/cycles` | 相位循环分解与余数解释（不合法返回 422 + 分析结果） |
| POST | `/api/expand` | 离线节拍展开，参数 `startTime`/`endTime`/`limitEvents`/`maxTime` |
| POST | `/api/rotate-compare` | 请求体 `{"pattern":[...], "other":[...]}`，旋转等价 + 基本周期 |
| POST | `/api/patterns` | 保存模式（版本、原输入 JSON、备注） |
| GET | `/api/patterns`、`/api/patterns/:id` | 查看模式 |
| POST | `/api/patterns/:id/analyses` | 对已保存模式跑分析并**新增**一条报告（从不覆盖旧报告） |
| GET | `/api/patterns/:id/analyses`、`/api/analyses`、`/api/analyses/:id` | 查询报告 |
| POST | `/api/export` | 导出完整分析 JSON（附件下载） |

### 错误码（4xx 代表输入问题，与 500 内部错误严格区分）

| code | 含义 |
|---|---|
| `NOT_ARRAY` | 输入不是数组 |
| `EMPTY_PATTERN` | 空数组 |
| `LENGTH_OUT_OF_RANGE` | 长度不在 1..16 |
| `NOT_INTEGER` | 存在小数或非数字 |
| `HEIGHT_OUT_OF_RANGE` | 高度不在 0..12（负数同码） |
| `BALL_COUNT_OUT_OF_RANGE` | 整数球数超过 12 |
| `BAD_RANGE_PARAM` | `startTime`/`endTime`/`limitEvents`/`maxTime` 不是合法整数或越界 |
| `INVALID_SITESWAP` | 输入格式合法但数学上不合法（如落点冲突），附带分析结果 |
| `NOT_FOUND` / `ROUTE_NOT_FOUND` / `INTERNAL_ERROR` | 资源不存在 / 路由不存在 / 服务内部错误 |

## 6. 输入约束与上限

- 序列长度：1..16；高度：0..12；球数上限：12。
- 展开区间长度上限：100000 拍；输出条数上限：10000（默认即上限）；整数时间上限：1000000。
- 截断时输出显式标记 `truncatedByLimit` / `truncatedByMaxTime`，并给出 `enumeratedThrough`（实际枚举到的最晚节拍），不会假装展开完整。

## 7. 设计约定

- **保留原序列**：所有报告里的 `position` 都是用户输入的原始下标，服务不会偷偷旋转或改写输入；旋转比较另出结果。
- **顺序固定**：循环按“循环内最小相位”开头，循环之间按首个相位升序；相同输入的 JSON 输出顺序恒定。
- **稳定性优先**：数学不合法是正常业务结果（HTTP 200 分析结果或 422 + 结果），只有真正的服务故障才是 500。
- SQLite 保存 schema 版本（`schema_meta` 表）、原始输入与运行参数；修改模式请保存为新模式，分析报告只追加不覆盖。

## 8. 已知限制

- 仅支持基础异步 siteswap：每拍一个高度数字；不支持同步 siteswap（如 `(4,4)`）、多重抛（multiplex）、传递模式。
- 高度是抽象节拍数，不代表物理高度、抛物线或手的动作；不做动画。
- `node:sqlite` 在当前 Node 版本标记为实验特性（API 稳定，仅启动警告）。
