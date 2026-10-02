/**
 * Multi-Channel Push Notification Gateway
 * Consolidates Bark, ntfy.sh, ServerChan, and generic JSON webhook delivery.
 * English comments only.
 */

const fs = require('fs');
const path = require('path');

// Normalize raw user push input (URL, SendKey, or token) into a standard fetchable URL
function normalizePushUrl(rawInput) {
    if (!rawInput || typeof rawInput !== 'string') return '';
    let val = rawInput.trim();
    if (!val) return '';

    // 1. ServerChan endpoint with domain (with or without protocol/send extension)
    if (val.includes('sctapi.ftqq.com')) {
        if (!/^https?:\/\//i.test(val)) {
            val = `https://${val}`;
        }
        const sctMatch = val.match(/^(https?:\/\/sctapi\.ftqq\.com\/[^/?#]+)(.*)$/i);
        if (sctMatch) {
            const basePath = sctMatch[1];
            const queryAndHash = sctMatch[2] || '';
            if (!basePath.endsWith('.send')) {
                val = `${basePath}.send${queryAndHash}`;
            }
        }
        return val;
    }

    // 2. ServerChan pure SendKey (e.g. SCT420458TnKN2zWsWiB8x3aZKIdYj2rwd)
    if (/^SCT[0-9a-zA-Z_-]+$/i.test(val)) {
        return `https://sctapi.ftqq.com/${val}.send`;
    }

    // 3. Bark device key (standard 20-26 char alphanumeric base62 string)
    if (/^[a-zA-Z0-9]{20,26}$/.test(val) && !val.toLowerCase().startsWith('http')) {
        return `https://api.day.app/${val}/`;
    }

    // 4. Bark URL without protocol
    if (/^api\.day\.app/i.test(val)) {
        return `https://${val}`;
    }

    // 5. ntfy URL without protocol
    if (/^ntfy\.sh/i.test(val)) {
        return `https://${val}`;
    }

    // 6. Enterprise WeChat (WeCom) format and multi-credential parsing
    if (val.toLowerCase().startsWith('wecom://')) {
        return val;
    }
    const wecomParts = val.split(/[\r\n|,;]+/).map(s => s.trim()).filter(Boolean);
    if (wecomParts.length === 3) {
        const corpId = wecomParts.find(p => /^ww[0-9a-zA-Z]+$/i.test(p));
        const agentId = wecomParts.find(p => /^\d{4,12}$/.test(p));
        const secret = wecomParts.find(p => p !== corpId && p !== agentId && p.length >= 16);
        if (corpId && agentId && secret) {
            return `wecom://${corpId}:${secret}@${agentId}`;
        }
    }

    // 7. Qmsg format (e.g. qmsg://KEY, qmsg:KEY, 40-char hex key, or qmsg.zendee.cn URL)
    if (val.toLowerCase().startsWith('qmsg://')) {
        const key = val.slice(7).trim();
        return `https://qmsg.zendee.cn/v3/send/${encodeURIComponent(key)}`;
    }
    if (val.toLowerCase().startsWith('qmsg:')) {
        const key = val.slice(5).trim();
        return `https://qmsg.zendee.cn/v3/send/${encodeURIComponent(key)}`;
    }
    if (/^[a-f0-9]{40}$/i.test(val)) {
        return `https://qmsg.zendee.cn/v3/send/${val}`;
    }
    if (val.includes('qmsg.zendee.cn')) {
        if (!/^https?:\/\//i.test(val)) {
            val = `https://${val}`;
        }
        return val;
    }

    // 9. Generic missing protocol
    if (!/^https?:\/\//i.test(val)) {
        val = `https://${val}`;
    }

    return val;
}

// Extract a human-readable conversation title
function getConversationTitle(conv, tree, turns) {
    if (conv && conv.title && conv.title !== 'Active Conversation' && conv.title !== 'New Conversation') {
        return conv.title.trim();
    }
    const convId = (conv && conv.id) || (tree && tree.activeConvId);
    if (tree && convId) {
        if (Array.isArray(tree.standalone)) {
            const found = tree.standalone.find(c => c.id === convId);
            if (found && found.title && found.title !== 'Active Conversation') return found.title.trim();
        }
        if (Array.isArray(tree.projects)) {
            for (const proj of tree.projects) {
                if (Array.isArray(proj.conversations)) {
                    const found = proj.conversations.find(c => c.id === convId);
                    if (found && found.title && found.title !== 'Active Conversation') return found.title.trim();
                }
            }
        }
    }
    if (Array.isArray(turns) && turns.length > 0) {
        const firstUser = turns.find(t => t.role === 'user');
        if (firstUser && firstUser.text) {
            const clean = firstUser.text.replace(/[\r\n]+/g, ' ').trim();
            if (clean) return clean.slice(0, 25);
        }
    }
    return (conv && conv.title && conv.title !== 'Active Conversation') ? conv.title.trim() : '当前会话';
}

// Extract a human-readable project name for a conversation (returns null if standalone or unassigned)
function getConversationProjectName(conv, tree) {
    const isExcludedName = (name) => {
        if (!name || typeof name !== 'string') return true;
        const clean = name.trim();
        if (!clean) return true;
        return /^(outside\s*of\s*project|未分组|独立对话|none|null|undefined)$/i.test(clean);
    };

    // 1. Direct projectName property on conversation object
    if (conv && typeof conv.projectName === 'string') {
        if (isExcludedName(conv.projectName)) return null;
        return conv.projectName.trim();
    }

    // 2. Direct projectId on conversation object if marked as outside-of-project
    if (conv && conv.projectId && isExcludedName(conv.projectId)) {
        return null;
    }

    const convId = (conv && conv.id) || (tree && tree.activeConvId);

    // 3. Standalone check: If conversation is in tree.standalone, it has no project
    if (tree && Array.isArray(tree.standalone) && convId) {
        if (tree.standalone.some(c => c && c.id === convId)) {
            return null;
        }
    }

    // 4. Lookup in tree.projects by matching convId in conversations list
    if (tree && Array.isArray(tree.projects)) {
        if (convId) {
            for (const proj of tree.projects) {
                if (Array.isArray(proj.conversations) && proj.conversations.some(c => c && c.id === convId)) {
                    if (proj.name && !isExcludedName(proj.name)) {
                        return proj.name.trim();
                    }
                }
            }
        }

        // 5. Lookup by explicit conv.projectId in tree.projects
        if (conv && conv.projectId && !isExcludedName(conv.projectId)) {
            const foundProj = tree.projects.find(p => p && p.id === conv.projectId);
            if (foundProj && foundProj.name && !isExcludedName(foundProj.name)) {
                return foundProj.name.trim();
            }
        }

        // 6. Active conversation fallback (only when conv is omitted, or conv is the active one)
        const isTargetActive = !conv || (conv && conv.id === tree.activeConvId);
        if (isTargetActive && tree && tree.activeProjectId && !isExcludedName(tree.activeProjectId)) {
            const activeId = tree.activeConvId;
            const isActiveInStandalone = activeId && Array.isArray(tree.standalone) && tree.standalone.some(c => c && c.id === activeId);
            if (!isActiveInStandalone) {
                const foundProj = tree.projects.find(p => p && p.id === tree.activeProjectId);
                if (foundProj && foundProj.name && !isExcludedName(foundProj.name)) {
                    return foundProj.name.trim();
                }
            }
        }
    }

    // 7. Lookup in tree.pinned by matching convId
    if (tree && Array.isArray(tree.pinned) && convId) {
        const pinnedItem = tree.pinned.find(p => p && p.id === convId);
        if (pinnedItem && pinnedItem.subtext && !isExcludedName(pinnedItem.subtext)) {
            return pinnedItem.subtext.trim();
        }
    }

    // 8. SQLite fallback for off-DOM / unrendered conversations
    if (convId && typeof convId === 'string' && /^[0-9a-f-]{36}$/i.test(convId)) {
        const candidates = [
            path.join('C:\\Users\\Administrator', '.gemini', 'antigravity', 'conversation_summaries.db'),
            path.join(process.env.USERPROFILE || '', '.gemini', 'antigravity', 'conversation_summaries.db')
        ];
        for (const dbPath of candidates) {
            if (fs.existsSync(dbPath)) {
                try {
                    const { DatabaseSync } = require('node:sqlite');
                    const db = new DatabaseSync(dbPath, { open: true, readOnly: true });
                    try {
                        const stmt = db.prepare('SELECT project_id FROM conversation_summaries WHERE conversation_id = ? LIMIT 1');
                        const row = stmt.get(convId.trim());
                        if (row && row.project_id) {
                            const pid = String(row.project_id).trim();
                            if (isExcludedName(pid)) return null;
                            if (tree && Array.isArray(tree.projects)) {
                                const foundProj = tree.projects.find(p => p && p.id === pid);
                                if (foundProj && foundProj.name && !isExcludedName(foundProj.name)) {
                                    return foundProj.name.trim();
                                }
                            }
                        }
                    } finally {
                        db.close();
                    }
                } catch (e) {}
                break;
            }
        }
    }

    return null;
}

// Format completion time in standard YYYY-MM-DD HH:mm:ss format
function formatCompletionTime(date = new Date()) {
    if (typeof date === 'string' && date.trim()) return date.trim();
    const d = (date instanceof Date && !isNaN(date.getTime())) ? date : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    const seconds = pad(d.getSeconds());
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// Format notification time in 24-hour HH:mm format (hours and minutes only, no date or seconds)
function formatNotificationTime(date = new Date()) {
    if (typeof date === 'string' && /^\d{1,2}:\d{2}$/.test(date.trim())) {
        const parts = date.trim().split(':');
        return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
    }
    const d = (date instanceof Date && !isNaN(date.getTime()))
        ? date
        : (typeof date === 'string' && !isNaN(new Date(date).getTime()) ? new Date(date) : new Date());
    const pad = (n) => String(n).padStart(2, '0');
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    return `${hours}:${minutes}`;
}

// Enterprise WeChat (WeCom) token cache: key -> { token, expiresAt }
const _wecomTokenCache = new Map();

async function deliverWecomNotification({ url, fullTitle }, fetchFn = global.fetch) {
    let corpId = '';
    let secret = '';
    let agentId = '';
    try {
        const u = new URL(url);
        corpId = decodeURIComponent(u.username || '');
        secret = decodeURIComponent(u.password || '');
        agentId = decodeURIComponent(u.hostname || '');
    } catch (e) {
        return { ok: false, error: 'Invalid WeCom configuration URL', normalizedUrl: url };
    }

    if (!corpId || !secret || !agentId) {
        return { ok: false, error: 'Missing WeCom CorpID, Secret, or AgentID', normalizedUrl: url };
    }

    const cacheKey = `${corpId}:${secret}`;
    const now = Date.now();
    let token = '';
    const cached = _wecomTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > now + 60000) {
        token = cached.token;
    } else {
        try {
            const tokenUrl = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`;
            const tokenRes = await fetchFn(tokenUrl, { signal: AbortSignal.timeout(10000) });
            if (!tokenRes.ok) {
                return { ok: false, error: `WeCom token endpoint returned HTTP ${tokenRes.status}`, normalizedUrl: url };
            }
            const tokenJson = await tokenRes.json();
            if (tokenJson.errcode !== 0 || !tokenJson.access_token) {
                return { ok: false, error: `WeCom token error: [${tokenJson.errcode}] ${tokenJson.errmsg}`, normalizedUrl: url };
            }
            token = tokenJson.access_token;
            _wecomTokenCache.set(cacheKey, {
                token,
                expiresAt: now + (Number(tokenJson.expires_in) || 7200) * 1000
            });
        } catch (err) {
            return { ok: false, error: `Failed to obtain WeCom token: ${err.message}`, normalizedUrl: url };
        }
    }

    const sendUrl = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`;
    const textcardDescription = `<div class="normal">${fullTitle}</div>`;

    const payload = {
        touser: '@all',
        msgtype: 'textcard',
        agentid: Number(agentId),
        textcard: {
            title: fullTitle,
            description: textcardDescription,
            url: 'https://work.weixin.qq.com'
        }
    };

    try {
        const sendRes = await fetchFn(sendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10000)
        });
        if (!sendRes.ok) {
            return { ok: false, error: `WeCom message API returned HTTP ${sendRes.status}`, normalizedUrl: url };
        }
        const sendJson = await sendRes.json();
        if (sendJson.errcode === 0) {
            return { ok: true, normalizedUrl: url };
        }
        if (sendJson.errcode === 60020) {
            const ipMatch = String(sendJson.errmsg || '').match(/from ip:\s*([0-9.]+)/i);
            const detectedIp = ipMatch ? ipMatch[1] : '';
            const ipHint = detectedIp ? `（请在企业微信管理后台将 IP: ${detectedIp} 添加到该应用的“企业可信IP”中）` : '';
            return {
                ok: false,
                error: `企业微信未配置可信IP白名单${ipHint}`,
                errorCode: 60020,
                detectedIp,
                normalizedUrl: url
            };
        }
        return {
            ok: false,
            error: `企业微信推送失败: [${sendJson.errcode}] ${sendJson.errmsg}`,
            normalizedUrl: url
        };
    } catch (err) {
        return { ok: false, error: `WeCom push delivery error: ${err.message}`, normalizedUrl: url };
    }
}

// Deliver push notification to target destination with detailed error reporting
async function deliverPushNotification(options = {}, fetchFn = global.fetch) {
    const {
        url,
        title,
        message,
        convId,
        convTitle,
        projectName,
        taskName,
        summary,
        userInput,
        aiOutput,
        completedAt,
        statusText: explicitStatusText,
        isCancelled,
        isPlanApprovalPending,
        isQuestionPending
    } = options;

    const rawUrl = String(url || options.pushUrl || '').trim();
    if (!rawUrl) {
        return { ok: false, error: 'Push URL or key is required' };
    }

    const normalizedUrl = normalizePushUrl(rawUrl);
    let urlObj;
    try {
        urlObj = new URL(normalizedUrl);
    } catch (err) {
        return { ok: false, error: `Invalid URL format: ${err.message}`, normalizedUrl };
    }

    const timeStr = formatCompletionTime(completedAt || new Date());
    const timeHm = formatNotificationTime(completedAt || new Date());
    const resolvedConvTitle = (convTitle || '').trim() || '当前会话';

    // If projectName is explicitly provided, use it; otherwise default to standalone
    const rawProjectName = (typeof projectName === 'string' && projectName.trim())
        ? projectName.trim()
        : '';
    const resolvedProjectName = rawProjectName || '独立对话';

    const resolvedStatus = (explicitStatusText && typeof explicitStatusText === 'string' && explicitStatusText.trim())
        ? explicitStatusText.trim()
        : (isQuestionPending ? '待输入' : (isPlanApprovalPending ? '待确认' : (isCancelled ? '已中断' : '已完成')));

    // Formatted notification title: ConversationName(ProjectName)Status HH:mm
    const fullTitle = title || `${resolvedConvTitle}（${resolvedProjectName}）${resolvedStatus} ${timeHm}`;

    // Notification body: strictly ConversationName(ProjectName)Status HH:mm
    const plainBody = fullTitle;
    const markdownDesp = fullTitle;

    // Handle Enterprise WeChat (WeCom) custom scheme
    if (normalizedUrl.toLowerCase().startsWith('wecom://')) {
        return await deliverWecomNotification({
            url: normalizedUrl,
            fullTitle
        }, fetchFn);
    }

    const host = urlObj.hostname.toLowerCase();

    try {
        // 1. Bark format (iOS Native Push)
        if (host.includes('api.day.app') || normalizedUrl.includes('bark')) {
            const barkUrl = new URL(normalizedUrl);
            barkUrl.searchParams.set('title', fullTitle);
            barkUrl.searchParams.set('body', plainBody);
            barkUrl.searchParams.set('group', 'antigravity');
            barkUrl.searchParams.set('sound', 'minuet');
            barkUrl.searchParams.set('badge', '1');
            const res = await fetchFn(barkUrl.toString(), {
                method: 'GET',
                signal: AbortSignal.timeout(10000)
            });
            if (!res.ok) {
                return { ok: false, error: `Bark server returned HTTP ${res.status}`, normalizedUrl };
            }
            return { ok: true, normalizedUrl };
        }

        // 2. ntfy.sh format (Android & iOS open-source push)
        if (host.includes('ntfy.sh') || host.includes('ntfy')) {
            // Encode title as RFC 2047 MIME base64 to support non-ASCII characters in HTTP headers
            const isNonAscii = /[^\x00-\x7F]/.test(fullTitle);
            const headerTitle = isNonAscii
                ? `=?utf-8?B?${Buffer.from(fullTitle, 'utf8').toString('base64')}?=`
                : fullTitle;

            const res = await fetchFn(normalizedUrl, {
                method: 'POST',
                headers: {
                    'Title': headerTitle,
                    'Priority': 'default',
                    'Tags': 'white_check_mark'
                },
                body: plainBody,
                signal: AbortSignal.timeout(10000)
            });
            if (!res.ok) {
                return { ok: false, error: `ntfy server returned HTTP ${res.status}`, normalizedUrl };
            }
            return { ok: true, normalizedUrl };
        }

        // 3. Qmsg format (Dedicated QQ Robot Push)
        if (host.includes('qmsg.zendee.cn') || normalizedUrl.includes('qmsg')) {
            const formBody = new URLSearchParams({ msg: fullTitle }).toString();
            const res = await fetchFn(normalizedUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formBody,
                signal: AbortSignal.timeout(10000)
            });
            let responseJson = null;
            try {
                responseJson = await res.json();
            } catch (_) {}

            if (!res.ok) {
                return { ok: false, error: `Qmsg server returned HTTP ${res.status}`, normalizedUrl };
            }
            if (responseJson) {
                if (responseJson.success === false || (typeof responseJson.code === 'number' && responseJson.code !== 0)) {
                    const errorMsg = responseJson.reason || responseJson.msg || responseJson.message || `Code ${responseJson.code}`;
                    return { ok: false, error: `Qmsg error: ${errorMsg}`, normalizedUrl };
                }
            }
            return { ok: true, normalizedUrl };
        }

        // 4. Generic JSON Webhook (ServerChan, PushDeer, Feishu, DingTalk, etc.)
        let sctTitle = fullTitle.replace(/[\r\n]+/g, ' ').trim();
        if (sctTitle.length > 32) {
            sctTitle = sctTitle.slice(0, 31) + '…';
        }

        const payload = {
            title: sctTitle,
            short: sctTitle,
            body: plainBody,
            text: plainBody,
            desp: markdownDesp,
            content: markdownDesp,
            convId: convId || '',
            convTitle: resolvedConvTitle,
            projectName: resolvedProjectName || '',
            taskName: taskName || ''
        };
        const res = await fetchFn(normalizedUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10000)
        });

        // Parse response text to extract any provider-specific error message
        let responseJson = null;
        try {
            const text = await res.text();
            if (text) {
                responseJson = JSON.parse(text);
            }
        } catch (_) {
            // Non-JSON response, ignore parsing error
        }

        if (!res.ok) {
            const providerMsg = (responseJson && (responseJson.message || responseJson.info || responseJson.error))
                ? `: ${responseJson.message || responseJson.info || responseJson.error}`
                : '';
            return {
                ok: false,
                error: `Push provider returned HTTP ${res.status}${providerMsg}`,
                normalizedUrl
            };
        }

        // ServerChan and some webhooks return HTTP 200 with code !== 0 on error
        if (responseJson && typeof responseJson.code === 'number' && responseJson.code !== 0) {
            const providerMsg = responseJson.message || responseJson.info || responseJson.error || `Code ${responseJson.code}`;
            return {
                ok: false,
                error: `Push provider reported error: ${providerMsg}`,
                normalizedUrl
            };
        }

        return { ok: true, normalizedUrl };
    } catch (err) {
        console.warn('Push notification delivery failed:', err.message);
        return { ok: false, error: `Delivery error: ${err.message}`, normalizedUrl };
    }
}

// Mobile push notification dispatcher (supports Bark, ntfy, ServerChan, and custom webhooks)
async function sendTaskCompletePushNotification(titleOrOptions, maybeMessage, maybeConvId, runtimeConfig = null, fetchFn = global.fetch) {
    let options = {};
    if (typeof titleOrOptions === 'object' && titleOrOptions !== null) {
        options = { ...titleOrOptions };
    } else {
        options = {
            title: titleOrOptions,
            message: maybeMessage,
            convId: maybeConvId
        };
    }

    let cfg = runtimeConfig;
    if (!cfg) {
        try {
            const configPath = path.join(__dirname, '..', '..', 'config.json');
            if (fs.existsSync(configPath)) {
                cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            }
        } catch (e) {
            cfg = {};
        }
    }
    cfg = cfg || {};

    const rawUrl = String(cfg.pushNotificationUrl || cfg.pushUrl || '').trim();
    const isEnabled = cfg.pushNotificationEnabled !== undefined ? Boolean(cfg.pushNotificationEnabled) : (cfg.enabled !== false);
    if (!isEnabled || !rawUrl) return false;

    const result = await deliverPushNotification({
        url: rawUrl,
        ...options
    }, fetchFn);
    return result.ok;
}

/**
 * Deep Notification Gateway Class
 * Provides object-oriented dispatch, test seams, and event formatting.
 */
class NotificationGateway {
    constructor(config = {}, options = {}) {
        this.config = config;
        this.fetchFn = options.fetchFn || global.fetch;
    }

    setConfig(newConfig) {
        this.config = newConfig || {};
    }

    async testChannel(targetUrl, options = {}) {
        const url = String(targetUrl || (this.config && this.config.pushNotificationUrl) || '').trim();
        if (!url) {
            return { ok: false, error: 'Push URL or key is required' };
        }
        const convTitle = (options.convTitle || '').trim() || '当前会话';
        const rawProject = (typeof options.projectName === 'string' && options.projectName.trim())
            ? options.projectName.trim()
            : null;
        const projectName = rawProject || '独立对话';
        const completedAt = options.completedAt || new Date();
        const timeHm = formatNotificationTime(completedAt);
        const status = options.statusText || (options.isQuestionPending ? '待输入' : (options.isPlanApprovalPending ? '待确认' : (options.isCancelled ? '已中断' : '已完成')));
        const title = options.title || `${convTitle}（${projectName}）${status} ${timeHm}`;
        return deliverPushNotification({
            url,
            title,
            convTitle,
            projectName,
            completedAt,
            isCancelled: options.isCancelled,
            convId: options.convId || null
        }, this.fetchFn);
    }

    async notifyTaskEvent({ conv, tree, turns, taskName, summary, userInput, aiOutput, completedAt, isCancelled, isPlanApprovalPending, isQuestionPending, title, projectName, convTitle: explicitConvTitle, convId: explicitConvId, statusText: explicitStatusText }) {
        const convTitle = explicitConvTitle || getConversationTitle(conv, tree, turns);
        const rawProjectName = (typeof projectName === 'string' && projectName.trim())
            ? projectName.trim()
            : getConversationProjectName(conv, tree);
        const resolvedProjectName = rawProjectName || '独立对话';
        const taskCompletedAt = completedAt || new Date();
        const timeHm = formatNotificationTime(taskCompletedAt);
        const status = explicitStatusText || (isQuestionPending ? '待输入' : (isPlanApprovalPending ? '待确认' : (isCancelled ? '已中断' : '已完成')));

        const resolvedTitle = title || `${convTitle}（${resolvedProjectName}）${status} ${timeHm}`;
        const convId = explicitConvId !== undefined ? explicitConvId : (conv ? conv.id : null);

        return sendTaskCompletePushNotification({
            title: resolvedTitle,
            convTitle,
            projectName: resolvedProjectName,
            completedAt: taskCompletedAt,
            convId
        }, null, null, this.config, this.fetchFn);
    }
}

function createNotificationGateway(config, options) {
    return new NotificationGateway(config, options);
}

module.exports = {
    formatCompletionTime,
    formatNotificationTime,
    normalizePushUrl,
    getConversationTitle,
    getConversationProjectName,
    deliverPushNotification,
    sendTaskCompletePushNotification,
    NotificationGateway,
    createNotificationGateway
};
