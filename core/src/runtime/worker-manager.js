const path = require('node:path');
const { createScheduler } = require('../services/scheduler');

/**
 * 创建 Worker 管理器
 * 负责账号 Worker 进程/线程的启动、停止、重启、消息处理和 RPC 调用
 */
function createWorkerManager(deps) {
    const {
        fork,
        WorkerThread,
        runtimeMode = 'thread',
        processRef,
        mainEntryPath,
        workerScriptPath,
        workers,
        globalLogs,
        log,
        addAccountLog,
        normalizeStatusForPanel,
        buildConfigSnapshotForAccount,
        getOfflineAutoDeleteMs,
        triggerOfflineReminder,
        addOrUpdateAccount,
        deleteAccount,
        onStatusSync,
        onWorkerLog
    } = deps;

    const scheduler = createScheduler('worker_manager');

    // 应用宝离线重连的独立计数（不受 startWorker 成功清零影响，否则 maxAttempts 会失效导致无限重连）
    const reconnectAttemptsMap = new Map();

    /** 是否支持 Thread 模式（非 pkg 打包 + Worker 可用） */
    const threadMode = runtimeMode === 'thread' && !processRef.pkg && typeof WorkerThread === 'function';

    function cleanText(value) {
        return String(value || '').trim();
    }

    function buildQqAvatarUrl(qq) {
        const value = cleanText(qq);
        if (!/^\d+$/.test(value)) return '';
        return `https://q1.qlogo.cn/g?b=qq&nk=${  value  }&s=100`;
    }

    function resolveLoginProfile(status, worker) {
        const data = status && typeof status === 'object' ? status : {};
        const info = data.status && typeof data.status === 'object' ? data.status : {};
        const platform = cleanText(info.platform || data.platform || worker.platform || 'qq').toLowerCase();
        const gid = cleanText(info.gid || data.gid);
        const openId = cleanText(info.openId || info.open_id || data.openId || data.open_id);
        const avatar = cleanText(info.avatar || info.avatarUrl || info.avatar_url || data.avatar || data.avatarUrl || data.avatar_url);
        const qq = cleanText(info.qq || info.uin || data.qq || data.uin || worker.qq || worker.uin);
        const fallbackAvatar = platform === 'qq' ? buildQqAvatarUrl(qq) : '';

        return {
            platform,
            gid,
            openId,
            qq,
            avatar: avatar || fallbackAvatar
        };
    }

    function syncAccountProfile(accountId, msgData, worker) {
        const profile = resolveLoginProfile(msgData, worker);
        const update = { id: accountId };

        if (profile.openId && worker.openId !== profile.openId) {
            update.openId = profile.openId;
        }
        if (profile.gid && worker.gid !== profile.gid) {
            update.gid = profile.gid;
        }
        if (profile.qq && worker.qq !== profile.qq) {
            update.qq = profile.qq;
            update.uin = profile.qq;
        }
        if (profile.avatar && worker.avatar !== profile.avatar) {
            update.avatar = profile.avatar;
        }

        if (Object.keys(update).length <= 1) return;

        addOrUpdateAccount(update);
        if (update.openId) worker.openId = update.openId;
        if (update.gid) worker.gid = update.gid;
        if (update.qq) {
            worker.qq = update.qq;
            worker.uin = update.uin;
        }
        if (update.avatar) worker.avatar = update.avatar;
    }

    /**
     * 创建 Thread Worker
     */
    function createThreadWorker(account) {
        const worker = new WorkerThread(workerScriptPath, {
            workerData: {
                accountId: String(account.id || ''),
                channel: 'thread'
            }
        });
        // 统一 send/kill 接口
        worker.send = (msg) => worker.postMessage(msg);
        worker.kill = () => worker.terminate();
        return worker;
    }

    /**
     * 创建 Fork Worker
     */
    function createForkWorker(account) {
        // 显式指定 cwd：用 mainEntryPath 所在目录（core/）的绝对路径，
        // 避免父进程 cwd 失效（ENOENT: uv_cwd）导致子进程启动失败。
        const workerCwd = path.dirname(mainEntryPath);

        if (processRef.pkg) {
            // pkg 打包模式：fork 主入口而不是 worker 脚本
            return fork(mainEntryPath, [], {
                execPath: processRef.execPath,
                stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
                cwd: workerCwd,
                env: {
                    ...processRef.env,
                    FARM_WORKER: '1',
                    FARM_ACCOUNT_ID: String(account.id || '')
                }
            });
        }
        return fork(workerScriptPath, [], {
            stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
            cwd: workerCwd,
            env: {
                ...processRef.env,
                FARM_ACCOUNT_ID: String(account.id || '')
            }
        });
    }

    /**
     * 根据运行模式创建 Worker
     */
    function createWorker(account) {
        if (threadMode) return createThreadWorker(account);
        return createForkWorker(account);
    }

    /**
     * 应用宝账号启动前自动刷新 code
     * 调应用宝接口用 openid 换新的 code，覆盖 account.code。
     * 失败则沿用旧 code（可能已过期，但让 worker 自己报错更直观）。
     */
    async function refreshYybCodeIfNeeded(account) {
        if (!account || account.loginType !== 'yyb' || !account.yybOpenid) return;
        try {
            const store = require('../models/store');
            const wxConfig = store.getGlobalWxConfig ? store.getGlobalWxConfig() : null;
            if (!wxConfig || !wxConfig.apiBase || !wxConfig.apiKey) {
                log('系统', `账号 ${account.name} 应用宝接口未配置，使用旧 code 启动`, {
                    accountId: String(account.id),
                });
                return;
            }
            // 规范化 apiBase：去掉尾部斜杠和可能误带的路径后缀
            const rawBase = String(wxConfig.apiBase).trim().replace(/\/+$/, '');
            const base = rawBase.replace(/\/wxapp\/getCode$/i, '').replace(/\/wxapp$/i, '').replace(/\/accounts$/i, '');
            const appId = wxConfig.appId || 'wx5306c5978fdb76e4';
            const resp = await fetch(`${base}/wxapp/getCode`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${wxConfig.apiKey}`,
                },
                body: JSON.stringify({ ref: account.yybOpenid, app_id: appId }),
            });
            const data = await resp.json();
            if (data && data.code === 0 && data.data && data.data.result && data.data.result.code) {
                account.code = data.data.result.code;
                log('系统', `账号 ${account.name} 应用宝 code 已自动刷新`, {
                    accountId: String(account.id),
                });
            } else {
                const msg = (data && data.msg) || '未知错误';
                log('系统', `账号 ${account.name} 应用宝 code 刷新失败: ${msg}`, {
                    accountId: String(account.id),
                    yybCode: data && data.code,
                });
            }
        } catch (e) {
            log('系统', `账号 ${account.name} 应用宝 code 刷新异常: ${e.message}`, {
                accountId: String(account.id),
            });
        }
    }

    /**
     * 启动账号 Worker
     */
    async function startWorker(account) {
        if (!account || !account.id) return false;
        if (workers[account.id]) return false;

        log('系统', `正在启动账号: ${  account.name}`, {
            accountId: String(account.id),
            accountName: account.name
        });

        // 应用宝账号：启动前自动刷新 code
        await refreshYybCodeIfNeeded(account);

        let proc = null;
        try {
            proc = createWorker(account);
        } catch (err) {
            const errorMsg = err && err.message ? err.message : String(err || 'unknown error');
            log('错误', `账号 ${  account.name  } 启动失败: ${  errorMsg}`, {
                accountId: String(account.id),
                accountName: account.name
            });
            addAccountLog('start_failed', `账号 ${  account.name  } 启动失败`,
                account.id, account.name, { reason: errorMsg });
            return false;
        }

        // 注册 Worker 记录
        workers[account.id] = {
            process: proc,
            status: null,
            logs: [],
            requests: new Map(),
            reqId: 1,
            name: account.name,
            username: account.username || '',
            platform: account.platform || 'qq',
            gid: account.gid || '',
            openId: account.openId || account.open_id || '',
            qq: account.qq || account.uin || '',
            uin: account.uin || account.qq || '',
            avatar: account.avatar || account.avatarUrl || '',
            stopping: false,
            disconnectedSince: 0,
            offlineReminderTriggered: false,
            autoDeleteTriggered: false,
            wsError: null
        };

        // 注意：这里不再清理应用宝离线重连计数（reconnectAttemptsMap）。
        // 旧逻辑会在 startWorker 成功时清零，导致重连计数永远从 0 起算、
        // maxAttempts 失效、账号被无限重连。计数只在"达到上限 /
        // 账号被删 / 手动停止"时清零（见下方 ws_reconnect_failed 与 stopWorker）。

        // 发送启动配置
        proc.send({
            type: 'start',
            config: { code: account.code, platform: account.platform }
        });

        // 发送配置快照
        proc.send({
            type: 'config_sync',
            config: buildConfigSnapshotForAccount(account.id)
        });

        // 监听 Worker 消息
        proc.on('message', (msg) => {
            handleWorkerMessage(account.id, msg);
        });

        // 监听 Worker 错误
        proc.on('error', (err) => {
            log('系统', `账号 ${  account.name  } 子进程启动失败: ${ 
                err && err.message ? err.message : err}`, {
                accountId: String(account.id),
                accountName: account.name
            });
        });

        // 监听 Worker 退出
        proc.on('exit', (code, signal) => {
            const wrk = workers[account.id];
            const displayName = wrk && wrk.name ? wrk.name : account.name;

            log('系统', `账号 ${  displayName  } 进程退出 (code=${  code 
                }, signal=${  signal || 'none'  })`, {
                accountId: String(account.id),
                accountName: displayName,
                runtimeMode: threadMode ? 'thread' : 'fork'
            });

            scheduler.clear(`force_kill_${  account.id}`);
            scheduler.clear(`restart_fallback_${  account.id}`);

            // 清理所有未完成的 API 请求
            if (wrk && wrk.requests && wrk.requests.size > 0) {
                for (const [reqId, pending] of wrk.requests.entries()) {
                    scheduler.clear(`api_timeout_${  account.id  }_${  reqId}`);
                    try { pending.reject(new Error('Worker exited')); } catch { }
                }
                wrk.requests.clear();
            }

            if (wrk && wrk.process === proc) {
                delete workers[account.id];
            }
        });

        return true;
    }

    /**
     * 停止账号 Worker
     */
    function stopWorker(accountId) {
        const wrk = workers[accountId];
        if (!wrk) return;

        // 手动停止账号：取消尚未触发的离线重连计划并清零计数
        scheduler.clear(`reconnect_attempt_${accountId}`);
        reconnectAttemptsMap.delete(accountId);

        const targetProc = wrk.process;
        wrk.stopping = true;

        // 发送停止指令
        wrk.process.send({ type: 'stop' });

        // 1 秒后强制杀死
        scheduler.setTimeoutTask(`force_kill_${  accountId}`, 1000, () => {
            const current = workers[accountId];
            if (current && current.process === targetProc) {
                current.process.kill();
                delete workers[accountId];
            }
        });
    }

    /**
     * 重启账号 Worker
     */
    async function restartWorker(account) {
        if (!account) return;
        const accountId = account.id;
        const wrk = workers[accountId];

        // 如果未运行，直接启动
        if (!wrk) return startWorker(account);

        const targetProc = wrk.process;
        let restarted = false;

        const doRestart = async () => {
            if (restarted) return;
            restarted = true;
            scheduler.clear(`restart_fallback_${  accountId}`);

            const current = workers[accountId];
            if (!current) return startWorker(account);
            if (current.process !== targetProc) return;

            delete workers[accountId];
            await startWorker(account);
        };

        const forceKill = () => {
            const current = workers[accountId];
            if (!current || current.process !== targetProc) return false;
            try { current.process.kill(); } catch { }
            delete workers[accountId];
            return true;
        };

        // 如果进程已退出，直接重启
        if (typeof targetProc.exitCode === 'number' || targetProc.signalCode) {
            return doRestart();
        }

        // 先尝试正常停止，再等待退出事件
        targetProc.once('exit', doRestart);
        stopWorker(accountId);

        // 1500ms 超时回退
        scheduler.setTimeoutTask(`restart_fallback_${  accountId}`, 1500, () => {
            if (restarted) return;
            forceKill();
            doRestart();
        });
    }

    /**
     * 处理 Worker 消息
     */
    function handleWorkerMessage(accountId, msg) {
        const wrk = workers[accountId];
        if (!wrk) return;

        if (msg.type === 'status_sync') {
            // 状态同步
            wrk.status = normalizeStatusForPanel(msg.data, accountId, wrk.name);
            if (typeof onStatusSync === 'function') {
                onStatusSync(accountId, wrk.status, wrk.name);
            }

            syncAccountProfile(accountId, msg.data, wrk);

            // 同步昵称
            if (msg.data && msg.data.status && msg.data.status.name) {
                const nick = String(msg.data.status.name).trim();
                if (nick && nick !== '未知' && nick !== '未登录') {
                    if (wrk.nick !== nick) {
                        const oldNick = wrk.nick;
                        wrk.nick = nick;
                        addOrUpdateAccount({ id: accountId, nick });
                        if (oldNick !== nick) {
                            log('系统', `已同步账号昵称: ${  oldNick || 'None'  } -> ${  nick}`, {
                                accountId, accountName: wrk.name
                            });
                        }
                    }
                }
            }

            // 连接状态追踪和离线提醒
            const isConnected = !!(msg.data && msg.data.connection && msg.data.connection.connected);
            if (isConnected) {
                wrk.disconnectedSince = 0;
                wrk.offlineReminderTriggered = false;
                wrk.autoDeleteTriggered = false;
                wrk.wsError = null;
            } else if (!wrk.stopping) {
                const now = Date.now();
                if (!wrk.disconnectedSince) wrk.disconnectedSince = now;

                const offlineDuration = now - wrk.disconnectedSince;
                if (!wrk.offlineReminderTriggered && offlineDuration >= 60000) {
                    wrk.offlineReminderTriggered = true;
                    const offlineMinutes = Math.floor(offlineDuration / 60000);
                    log('系统', `账号 ${  wrk.name  } 已离线 ${  offlineMinutes  } 分钟，发送下线提醒`);

                    triggerOfflineReminder({
                        accountId,
                        accountName: wrk.name,
                        username: wrk.username,
                        reason: 'offline',
                        offlineMs: offlineDuration
                    });
                    addAccountLog('offline_reminder',
                        `账号 ${  wrk.name  } 已离线 ${  offlineMinutes  } 分钟，已发送下线提醒`,
                        accountId, wrk.name, { reason: 'offline', offlineMs: offlineDuration });
                }

                const autoDeleteMs = typeof getOfflineAutoDeleteMs === 'function'
                    ? getOfflineAutoDeleteMs(wrk.username)
                    : Infinity;
                if (!wrk.autoDeleteTriggered && offlineDuration >= autoDeleteMs) {
                    wrk.autoDeleteTriggered = true;
                    const offlineMinutes = Math.floor(offlineDuration / 60000);
                    log('系统', `账号 ${  wrk.name  } 持续离线 ${  offlineMinutes  } 分钟，自动删除账号信息`, {
                        accountId: String(accountId),
                        accountName: wrk.name
                    });
                    triggerOfflineReminder({
                        accountId,
                        accountName: wrk.name,
                        username: wrk.username,
                        reason: 'offline_timeout',
                        offlineMs: offlineDuration
                    });
                    addAccountLog('offline_delete',
                        `账号 ${  wrk.name  } 持续离线 ${  offlineMinutes  } 分钟，已自动删除`,
                        accountId, wrk.name, { reason: 'offline_timeout', offlineMs: offlineDuration });
                    stopWorker(accountId);
                    try {
                        if (typeof deleteAccount === 'function') deleteAccount(accountId);
                    } catch (err) {
                        log('错误', `删除离线账号失败: ${  err.message}`);
                    }
                }
            }
        } else if (msg.type === 'log') {
            // 日志消息
            const entry = {
                ...msg.data,
                accountId,
                accountName: wrk.name,
                ts: Date.now(),
                meta: msg.data && msg.data.meta ? msg.data.meta : {}
            };
            entry._searchText = (`${entry.msg || ''  } ${  entry.tag || '' 
                } ${  JSON.stringify(entry.meta || {})}`).toLowerCase();

            wrk.logs.push(entry);
            if (wrk.logs.length > 1000) wrk.logs.shift();

            globalLogs.push(entry);
            if (globalLogs.length > 2000) globalLogs.shift();

            if (typeof onWorkerLog === 'function') {
                onWorkerLog(entry, accountId, wrk.name);
            }
        } else if (msg.type === 'error') {
            log('错误', `账号[${  accountId  }]进程报错: ${  msg.error}`, {
                accountId: String(accountId),
                accountName: wrk.name
            });
        } else if (msg.type === 'ws_error') {
            // WebSocket 错误
            const code = Number(msg.code) || 0;
            const message = msg.message || '';
            wrk.wsError = { code, message, at: Date.now() };

            // Code 400 = 登录失效
            if (code === 400) {
                addAccountLog('ws_400', `账号 ${  wrk.name  } 登录失效，请更新 Code`,
                    accountId, wrk.name);
            }
        } else if (msg.type === 'account_kicked') {
            // 被踢下线
            const reason = msg.reason || '未知';
            log('系统', `账号 ${  wrk.name  } 被踢下线，已自动停止账号`, {
                accountId: String(accountId),
                accountName: wrk.name
            });

            triggerOfflineReminder({
                accountId,
                accountName: wrk.name,
                reason: `kickout:${  reason}`,
                offlineMs: 0
            });
            addAccountLog('kickout_stop',
                `账号 ${  wrk.name  } 被踢下线，已自动停止`,
                accountId, wrk.name, { reason });

            stopWorker(accountId);
        } else if (msg.type === 'ws_reconnect_failed') {
            const reason = msg.reason || '未知';
            log('系统', `账号 ${  wrk.name  } 连接中断，交由应用宝离线重连处理`, {
                accountId: String(accountId),
                accountName: wrk.name
            });

            triggerOfflineReminder({
                accountId,
                accountName: wrk.name,
                reason: `ws_reconnect_failed:${  reason}`,
                offlineMs: 0
            });
            addAccountLog('ws_reconnect_failed',
                `账号 ${  wrk.name  } 连接中断，交由应用宝离线重连处理`,
                accountId, wrk.name, { reason });

            // 先停止当前 worker（清理进程）
            stopWorker(accountId);

            // 应用宝离线重连：仅当全局配置开启时执行。Worker 内已无自动重连，
            // 此处是唯一的重连入口，按 reconnectDelayMin 延迟重启 Worker 并刷新 code。
            try {
                const store = require('../models/store');
                const wxConfig = store.getGlobalWxConfig ? store.getGlobalWxConfig() : null;
                if (wxConfig && wxConfig.autoReconnect && wxConfig.reconnectDelayMin > 0) {
                    const attemptKey = `reconnect_attempt_${accountId}`;
                    // 从独立计数 Map 读取（不受 startWorker 清零影响，保证 maxAttempts 生效）
                    const currentAttempt = reconnectAttemptsMap.get(accountId) || 0;
                    const maxAttempts = wxConfig.reconnectMaxAttempts || 3;

                    if (currentAttempt >= maxAttempts) {
                        log('系统', `账号 ${wrk.name} 自动重连已达上限(${maxAttempts}次)，停止重连`, {
                            accountId: String(accountId),
                            attempts: currentAttempt,
                        });
                        reconnectAttemptsMap.delete(accountId);
                        return;
                    }

                    // 记录重连计数（先自增，作为下一次判断基准）
                    const nextAttempt = currentAttempt + 1;
                    reconnectAttemptsMap.set(accountId, nextAttempt);

                    const delayMs = wxConfig.reconnectDelayMin * 60 * 1000;
                    log('系统', `账号 ${wrk.name} 将在 ${wxConfig.reconnectDelayMin} 分钟后自动重连 (${nextAttempt}/${maxAttempts})`, {
                        accountId: String(accountId),
                        delayMin: wxConfig.reconnectDelayMin,
                        attempt: nextAttempt,
                        maxAttempts,
                    });

                    scheduler.setTimeoutTask(attemptKey, delayMs, async () => {
                        // 重连前检查账号是否还存在、是否已被手动停止
                        const currentWrk = workers[accountId];
                        if (currentWrk) {
                            // 已经有 worker 在跑，不需要重连
                            return;
                        }
                        try {
                            const accountsData = store.getAccounts();
                            const account = (accountsData.accounts || []).find(a => a.id === accountId);
                            if (!account) {
                                log('系统', `账号 ${wrk.name} 已被删除，取消自动重连`);
                                reconnectAttemptsMap.delete(accountId);
                                return;
                            }
                            log('系统', `账号 ${wrk.name} 开始自动重连 (${nextAttempt}/${maxAttempts})`);
                            await startWorker(account);
                            addAccountLog('reconnect_success',
                                `账号 ${wrk.name} 已通过应用宝离线重连恢复在线 (${nextAttempt}/${maxAttempts})`,
                                accountId, wrk.name, { attempt: nextAttempt, maxAttempts });
                        } catch (e) {
                            log('系统', `账号 ${wrk.name} 自动重连启动失败: ${e.message}`);
                        }
                    });
                } else {
                    // 未启用自动重连，保持停止状态
                    log('系统', `账号 ${wrk.name} 未启用应用宝离线重连，已停止`);
                }
            } catch (e) {
                log('系统', `账号 ${wrk.name} 自动重连逻辑异常: ${e.message}`);
            }
        } else if (msg.type === 'automation_patch') {
            const patch = msg.patch && typeof msg.patch === 'object' ? msg.patch : {};
            if ((patch.automation && typeof patch.automation === 'object')
                || patch.friendBadRetryDate !== undefined) {
                const store = require('../models/store');
                store.applyConfigSnapshot(patch, { accountId });
                const currentWrk = workers[accountId];
                if (currentWrk && currentWrk.process) {
                    currentWrk.process.send({
                        type: 'config_sync',
                        config: buildConfigSnapshotForAccount(accountId)
                    });
                }
            }
        } else if (msg.type === 'api_response') {
            // API 响应
            const { id, result, error } = msg;
            scheduler.clear(`api_timeout_${  accountId  }_${  id}`);

            const pending = wrk.requests.get(id);
            if (pending) {
                if (error) pending.reject(new Error(error));
                else pending.resolve(result);
                wrk.requests.delete(id);
            }
        } else if (msg.type === 'friend_blacklist_add') {
            // 好友黑名单添加
            const gid = Number(msg.gid) || 0;
            if (gid > 0) {
                const { addFriendToBlacklist } = require('../models/store');
                addFriendToBlacklist(accountId, gid);
                log('好友', `已将好友 ${  msg.friendName || `GID:${  gid}`  } 加入黑名单`, {
                    accountId: String(accountId),
                    accountName: wrk.name,
                    friendGid: gid,
                    friendName: msg.friendName,
                    reason: msg.reason
                });

                // 同步黑名单到 Worker
                const currentWrk = workers[accountId];
                if (currentWrk && currentWrk.process) {
                    currentWrk.process.send({
                        type: 'config_sync',
                        config: buildConfigSnapshotForAccount(accountId)
                    });
                }
            }
        }
    }

    /**
     * 调用 Worker API（RPC）
     */
    function callWorkerApi(accountId, method, ...args) {
        const wrk = workers[accountId];
        if (!wrk) return Promise.reject(new Error('账号未运行'));

        // 检查最后一个参数是否包含 _timeoutMs
        const lastArg = args.at(-1);
        const customTimeout = lastArg && typeof lastArg === 'object' && lastArg._timeoutMs;
        const timeoutMs = customTimeout
            ? Number(lastArg._timeoutMs) || 10000
            : 10000;

        const actualArgs = customTimeout ? args.slice(0, -1) : args;

        return new Promise((resolve, reject) => {
            const reqId = wrk.reqId++;
            wrk.requests.set(reqId, { resolve, reject });

            // API 超时保护
            scheduler.setTimeoutTask(`api_timeout_${  accountId  }_${  reqId}`, timeoutMs, () => {
                if (wrk.requests.has(reqId)) {
                    wrk.requests.delete(reqId);
                    reject(new Error('API Timeout'));
                }
            });

            wrk.process.send({
                type: 'api_call',
                id: reqId,
                method,
                args: actualArgs
            });
        });
    }

    return {
        startWorker,
        stopWorker,
        restartWorker,
        callWorkerApi
    };
}

module.exports = { createWorkerManager };
