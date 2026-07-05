# TSDK/ACE Node.js 调用约定

适用文件：官方 `tsdk.wasm`，版本 `v3.8.2.1783066265`，SHA-256
`705e326caad538d6cccb40cb1bd54573525a42d12215c9da9c9c513ec4850a5f`。

## 初始化顺序

1. 校验 WASM SHA-256、导入数量和必要导出。
2. 实例化 22 个 `a.a` 至 `a.v` 宿主函数。
3. 使用官方 mergewasm 解密器解密 17 个数据段。
4. 调用 `__wasm_call_ctors`。
5. 按官方 `SdkInitEx(3167, 0)` 申请并写入 appKey，调用
   `_init_runtime(3167, appKeyPtr)`，随后释放。
6. 登录请求开始使用 TSDK 请求体加密；网关 Token 使用官方
   `AceManager.randomStr()` 格式。
7. 游戏登录成功后启动 ACE 生命周期和数据轮询。

默认 TSDK `gameId` 为 `3167`、`appKey` 为字符串 `"0"`；可分别通过
`FARM_TSDK_GAME_ID`、`FARM_TSDK_APP_KEY` 覆盖。小程序应用 ID 和 TSDK
宿主 game ID 字符串均为 `1112386029`，不要与 `SdkInitEx` 的 `3167` 混用。
`FARM_TSDK_ACE_ENABLED=false` 会显式关闭整条安全链路。

## 导入映射

| 导入 | 官方宿主能力 | Node.js 实现 |
| --- | --- | --- |
| `a.a` | assertion | 抛出带位置的错误 |
| `a.b` | write file | 账号独立数据目录 |
| `a.c` | JS stack | 写入当前调用栈 |
| `a.d` | TSDK version | `v3.8.2.1783066265` |
| `a.e` | ACEVM/JS integrity | 官方允许的空结果降级并一次告警 |
| `a.f` | touch/gyroscope setup | 无传感器数据，一次告警 |
| `a.g` | read file | 账号独立数据目录 |
| `a.h` | wall/monotonic clock | `Date.now` / `performance.now` |
| `a.i` | user data path | 账号独立 TSDK 目录 |
| `a.j` | device info | 配置设备信息与 Node 系统信息 |
| `a.k` | runtime table | 官方封装中的 59 字节表 |
| `a.l` | debug state | release/disabled |
| `a.m` | app id | `1112386029` |
| `a.n` | game id string | 官方固定值 `1112386029` |
| `a.o` | function integrity array | Node 空能力降级并一次告警 |
| `a.p` | file stat | 读取账号目录文件并构造 WASM stat |
| `a.q` | server timestamp | 立即写本机时间并异步校准响应 Date |
| `a.r` | memory growth failure | 显式抛错 |
| `a.s` | epoch milliseconds | `Date.now` |
| `a.t` | append file | 账号独立数据目录 |
| `a.u` | abort | 显式抛错 |
| `a.v` | TQOS report | 按官方封装异步 POST 至 ACE TQOS |

## 导出映射和内存

| API | WASM 导出 | 参数/返回 |
| --- | --- | --- |
| create buffer | `A` | `(length) -> ptr` |
| destroy buffer | `B` | `(ptr) -> void` |
| get result | `C` | `() -> 64-byte ptr`，WASM 所有 |
| init runtime | `G` | `(gameId, appKeyPtr) -> void` |
| heartbeat tick | `M` | `() -> void` |
| get data to server | `N` | `(lengthOutPtr) -> dataPtr`，WASM 所有 |
| send data from server | `O` | `(ptr, length) -> void` |
| generate token | `aa` | `(ptr, length) -> UTF-8 token ptr` |
| encrypt in place | `ba` | `(ptr, length) -> void` |
| decrypt in place | `ca` | `(ptr, length) -> void` |
| encrypt v2 | `da` | `(inPtr, inLen, outPtr, outCap) -> length` |
| decrypt v2 | `ea` | `(inPtr, inLen, outPtr, outCap) -> length` |

调用者分配的输入和 Token 返回指针均在复制后由 `_destroy_buffer` 释放；
`getResult` 和 `getDataToServer` 返回的 WASM 所有内存不由 JavaScript 释放。
所有复制前均检查指针、长度和当前 `memory.buffer` 边界。

## 网关与 ACE

业务体先由 `_encrypt_data` 原地加密。网关 `auth_token` 不使用
`_generate_token` 的 24 字符结果，而是复刻官方 `AceManager.randomStr()`：
随机生成 64～127 个字母数字字符并追加一个 `=`。抓包中登录及好友操作的 Token
长度均落在 65～128 字符范围。`AnoUserLogin(0, openId)` 绑定账号后，
`_get_encrypted_init_info` 产生的一次性初始化凭据会优先用于下一条请求；之后恢复
随机 Token，这与官方每次登录后首条 `AllLands` 请求的特殊长 Token 相符。

`AceService` 每 5 秒检查 `_get_data_to_server`，仅在非空时调用
`gamepb.acepb.AceService.AntiData`。服务器 `reply.data` 原样传给
`_send_data_from_server`。同账号最多一个在途请求，失败按 2–30 秒有限退避。
`_process_received_data` 每 5 秒执行，`_send_heartbeat_tick` 每 25 秒执行；
速度检测每 30 秒执行，状态上报和函数检查分别在 150 秒、180 秒触发。普通用户
心跳仍按原 25 秒周期独立运行。

每个 Worker 加载自己的 CommonJS 模块实例，因此运行时、内存、文件目录、请求、
定时器和服务器回灌均按账号隔离。重连、连接关闭和账号停止都会销毁旧实例。
