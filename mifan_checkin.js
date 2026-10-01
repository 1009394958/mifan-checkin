/*
米饭 (mifan.61.com) 每日签到 for Quantumult X
=============================================

【Token 有效期说明】
  服务器签发的 Token 是 JWT，固定 7 天有效，到期后无法直接"延长"。
  本脚本通过【自动续期】解决：Token 剩余不足 48 小时、或签到时发现失效，
  脚本会用保存的账号密码自动重新登录换取新 Token（又是 7 天），等效于永久有效。

【凭据配置（用于自动续期，三选一）】
  1. MITM 自动捕获（推荐）：登录一次，自动抓取 Token + 账号密码
     [rewrite_local]
     ^https://mifan\.61\.com/api/v1/login url script-request-body  https://raw.githubusercontent.com/1009394958/mifan-checkin/main/mifan_checkin.js
     ^https://mifan\.61\.com/api/v1/login url script-response-body https://raw.githubusercontent.com/1009394958/mifan-checkin/main/mifan_checkin.js
     [mitm]
     hostname = mifan.61.com
  2. BoxJS：Token 文本域中一行一个，支持两种格式：
     - 纯 Token（旧方式，7 天后需重新抓）
     - 账号----密码（推荐，每次运行自动登录，Token 永远新鲜）
       例如：394326743----8888aaaa
  3. 直接编辑脚本：在 MF_ACCOUNTS 中填入 账号----密码

【定时签到 - task 模式】
  [task_local]
  0 30 9 * * * script-path=https://raw.githubusercontent.com/1009394958/mifan-checkin/main/mifan_checkin.js, tag=米饭签到, enabled=true

【BoxJS 面板管理】
  在 BoxJS 中订阅以下链接，用网页管理 Token：
  https://raw.githubusercontent.com/1009394958/mifan-checkin/main/mifan.boxjs.json

【多账号 - 传统方式（按任务分开）】
  [task_local]
  0 30 9 * * * script-path=mifan_checkin.js, tag=米饭-大号, args=token=xxx
  0 31 9 * * * script-path=mifan_checkin.js, tag=米饭-小号, args=token=yyy

【多账号 - 推荐方式（一个任务全搞定）】
  在 BoxJS 中每个账号一行（Token 或 账号----密码 均可），无需重复任务
*/

// ==================== 配置区域 ====================

// ★ 方式一：直接填 账号----密码（推荐，自动续期，多账户用换行或逗号分隔）
// ★ 推荐改用 BoxJS 管理，则此处留空
const MF_ACCOUNTS = "";

// ★ 方式二：直接填 Token（7 天有效期，过期需重新抓取，多账户用 , 或空格分隔）
const MF_TOKEN = "";

// Token 剩余多少小时以内时触发自动续期（重新登录换新 Token）
const TOKEN_RENEW_AHEAD_HOURS = 48;

// ==================== 以下无需修改 ====================

const BASE_URL = "https://mifan.61.com/api/v1/";
const STORAGE_KEY_TOKEN = "mf_token";
const BOXJS_KEY_TOKEN = "boxjs.mifan.checkin.mf_token";
const CREDS_KEY = "mf_creds"; // 自动捕获的 {uid: password}，仅存本机

/**
 * 判断当前运行模式
 * - $response 存在 → rewrite 响应模式（拦截登录响应，提取 token）
 * - 仅 $request 存在 → rewrite 请求模式（拦截登录请求，提取账号密码）
 * - 都不存在 → task 模式（执行定时签到）
 */
(function () {
  // ============ 模式一：Rewrite 请求模式 - 捕获账号密码 ============
  if (typeof $request !== "undefined" && $request && (typeof $response === "undefined" || !$response)) {
    console.log("===== 米饭 账号密码捕获 =====");
    try {
      const uid = captureCreds($request.body);
      if (uid) {
        console.log("✓ 已保存账号 " + uid + " 的登录凭据（用于 Token 自动续期）");
        $notify("米饭 凭据捕获 ✓", "账号 " + uid, "已保存密码到本机，Token 到期将自动续期");
      } else {
        console.log("ℹ 请求中未识别到 uid/password: " + String($request.body || "").substring(0, 200));
      }
    } catch (e) {
      console.log("✗ 捕获失败: " + e.message);
    }
    $done({});
    return;
  }

  // ============ 模式二：Rewrite 响应模式 - 捕获 Token ============
  if (typeof $response !== "undefined" && $response) {
    console.log("===== 米饭 Token 捕获 =====");
    try {
      const rawBody = typeof $response.body === "string" ? $response.body : JSON.stringify($response.body);
      console.log("原始响应: " + rawBody.substring(0, 300));
      const body = JSON.parse(rawBody);

      // 顺便捕获请求中的账号密码（部分环境 $request.body 可用）
      const credUid = captureCreds(typeof $request !== "undefined" && $request ? $request.body : null);

      // 尝试多种可能的 Token 字段位置
      const token = body.token || body.data?.token || body.result || body.access_token || null;

      if (body.code === 200 && token) {
        const t = token.trim();
        const payload = parseJwt(t);
        const mid = (payload && payload.data && payload.data.mid) || body.uid || body.account || null;

        // 按账号替换旧 Token（避免续期后旧 Token 堆积），追加保存到 BoxJS
        const existing = $prefs.valueForKey(BOXJS_KEY_TOKEN) || "";
        const lines = existing.split("\n").map(s => s.trim()).filter(s => s);
        let replaced = false;
        const newLines = lines.map(line => {
          const p = parseJwt(line);
          const lmid = p && p.data ? p.data.mid : null;
          if ((mid && lmid && lmid === mid) || line === t) {
            replaced = true;
            return t;
          }
          return line;
        });
        if (!replaced) newLines.push(t);
        $prefs.setValueForKey(newLines.join("\n"), BOXJS_KEY_TOKEN);
        // 同时写回老 key 保持兼容
        $prefs.setValueForKey(t, STORAGE_KEY_TOKEN);

        const expInfo = tokenRemainStr(payload);
        const credInfo = credUid ? "，凭据已保存" : "";
        console.log("✓ Token 已保存到 BoxJS: " + t.substring(0, 30) + "... " + expInfo);
        $notify("米饭 Token 捕获 ✓", "已自动保存" + credInfo,
          "账号 " + (mid || "未知") + (expInfo ? "，" + expInfo : "") +
          (credUid ? "" : "\n如需自动续期，请在 BoxJS 中添加 账号----密码"));
      } else if (body.code && body.code !== 200) {
        console.log("ℹ 登录失败: " + (typeof body.data === "string" ? body.data : rawBody.substring(0, 200)));
      } else {
        console.log("ℹ 未识别到 Token，完整响应: " + rawBody.substring(0, 500));
        $notify("米饭 Token 捕获 ⚠", "响应格式未识别", "请从浏览器 localStorage 获取 Token");
      }
    } catch (e) {
      console.log("✗ 解析失败: " + e.message + " | 原始内容: " + String($response.body).substring(0, 200));
    }
    $done({});
    return;
  }

  // ============ 模式三：Task 模式 - 执行签到 ============
  main().then(() => $done()).catch(e => {
    console.log("脚本异常: " + e.message);
    $notify("米饭签到 ❌", "脚本异常", e.message);
    $done();
  });
})();

// ==================== 核心代码 ====================

function getHeaders(token) {
  const h = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    "Content-Type": "application/x-www-form-urlencoded",
    "Origin": "https://mifan.61.com",
    "Referer": "https://mifan.61.com/dist/index.html",
  };
  if (token) h["Authorization"] = token;
  return h;
}

function getNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = BASE_URL.replace(/\/$/, "") + "/" + path.replace(/^\//, "");
    const params = {
      url: url,
      headers: getHeaders(token),
      timeout: 15,
      method: method
    };
    if (body) params.body = body;
    // 优先使用 $task.fetch（兼容性更广），回退 $httpClient
    if (typeof $task !== "undefined" && $task.fetch) {
      $task.fetch(params).then(
        resp => {
          try { resolve(JSON.parse(resp.body)); }
          catch (e) { resolve({ code: -1, data: resp.body }); }
        },
        reason => reject(reason.error || reason)
      );
    } else if (typeof $httpClient !== "undefined") {
      const cb = (error, resp, data) => {
        if (error) { reject(error); return; }
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve({ code: -1, data: data }); }
      };
      if (method === "GET") $httpClient.get(params, cb);
      else $httpClient.post(params, cb);
    } else {
      reject("无法找到网络请求 API（$task 和 $httpClient 均不可用）");
    }
  });
}

// ---------- 自动登录（自动续期核心） ----------

/**
 * 用账号密码登录换取新 Token
 * 请求格式与网页版一致：uid/password/gid/savepwd/tad
 */
async function login(uid, password) {
  if (!uid || !password) throw new Error("缺少账号或密码，无法自动续期");
  const body = "uid=" + encodeURIComponent(String(uid))
    + "&password=" + encodeURIComponent(String(password))
    + "&gid=689&savepwd=true&tad=";
  const data = await request("POST", "login", null, body);
  if (data.code === 200 && data.token) {
    console.log("✓ 自动登录成功 uid=" + uid);
    return data.token;
  }
  const detail = typeof data.data === "string" ? data.data : "登录失败";
  throw new Error("[" + data.code + "] " + detail);
}

function isAuthError(msg) {
  return /401|无记录|已过期|token失效|unauthorized/i.test(String(msg));
}

// ---------- JWT 解析 ----------

function base64UrlDecode(str) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  let out = "", bits = 0, buffer = 0;
  for (let i = 0; i < s.length; i++) {
    const v = chars.indexOf(s[i]);
    if (v < 0) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xFF);
    }
  }
  try { return decodeURIComponent(escape(out)); }
  catch (_) { return out; }
}

/** 解析 JWT payload，失败返回 null */
function parseJwt(token) {
  try {
    const parts = String(token).split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch (_) {
    return null;
  }
}

/** Token 剩余有效期的可读描述 */
function tokenRemainStr(payload) {
  if (payload && payload.exp) {
    const remainSec = payload.exp - nowSec();
    if (remainSec <= 0) return "Token已过期";
    const days = Math.floor(remainSec / 86400);
    const hours = Math.floor((remainSec % 86400) / 3600);
    const d = new Date(payload.exp * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    const expireAt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return (days > 0 ? "剩" + days + "天" : "剩" + hours + "小时") + "，至 " + expireAt;
  }
  return "";
}

// ---------- 凭据存储（本机） ----------

function loadCreds() {
  try {
    return JSON.parse($prefs.valueForKey(CREDS_KEY) || "{}") || {};
  } catch (_) {
    return {};
  }
}

/** 从登录请求体（form 表单）中提取账号密码并保存，返回 uid 或 null */
function captureCreds(reqBody) {
  if (!reqBody) return null;
  try {
    const form = parseForm(reqBody);
    const uid = form.uid || form.username || form.account;
    const pwd = form.password;
    if (uid && pwd) {
      const store = loadCreds();
      if (store[uid] !== pwd) {
        store[uid] = pwd;
        $prefs.setValueForKey(JSON.stringify(store), CREDS_KEY);
      }
      return uid;
    }
  } catch (_) { }
  return null;
}

function parseForm(s) {
  const o = {};
  String(s).split("&").forEach(p => {
    const i = p.indexOf("=");
    if (i > 0) {
      const k = decodeURIComponent(p.slice(0, i).replace(/\+/g, " "));
      const v = decodeURIComponent(p.slice(i + 1).replace(/\+/g, " "));
      o[k] = v;
    }
  });
  return o;
}

/** 用新 Token 替换存储中的旧 Token（按 uid 匹配），保持 BoxJS 行数不增长 */
function updateStoredToken(oldToken, newToken, mid) {
  try {
    const val = $prefs.valueForKey(BOXJS_KEY_TOKEN) || "";
    const lines = val.split("\n").map(s => s.trim()).filter(s => s);
    let replaced = false;
    const newLines = lines.map(line => {
      if (line === newToken) { replaced = true; return line; }
      const p = parseJwt(line);
      const lmid = p && p.data ? p.data.mid : null;
      if ((mid && lmid && lmid === mid) || line === oldToken) {
        replaced = true;
        return newToken;
      }
      return line;
    });
    if (!replaced) newLines.push(newToken);
    $prefs.setValueForKey(newLines.join("\n"), BOXJS_KEY_TOKEN);
    if ($prefs.valueForKey(STORAGE_KEY_TOKEN) === oldToken) {
      $prefs.setValueForKey(newToken, STORAGE_KEY_TOKEN);
    }
    console.log("✓ 新 Token 已写回存储");
  } catch (e) {
    console.log("⚠ Token 写回存储失败: " + e.message);
  }
}

// ---------- 签到接口 ----------

async function getSignStatus(token) {
  const data = await request("GET", "event/dailysign/status/", token);
  if (data.code === 200) return data.data;
  throw new Error("[" + data.code + "] " + (data.err_desc || data.data || "未知错误"));
}

async function doSign(token) {
  const data = await request("POST", "event/dailysign/", token);
  if (data.code === 200) return data.gold || 0;
  throw new Error("[" + data.code + "] " + (data.err_desc || data.data || "签到失败"));
}

async function getSignHistory(token) {
  const data = await request("GET", "event/dailysign/recent", token);
  if (data.code === 200) return data.data || [];
  throw new Error("[" + data.code + "] " + (data.err_desc || data.data || "查询失败"));
}

// ---------- 单账号处理 ----------

async function processAccount(entry, index, credsStore) {
  const prefix = "账号" + (index + 1);
  console.log("===== " + prefix + " =====");

  let token = entry.token || null;
  let uid = entry.uid || null;
  let password = entry.password || null;
  let renewedNote = "";

  try {
    // 凭据条目：直接自动登录，Token 永远新鲜
    if (!token && password) {
      token = await login(uid, password);
      renewedNote = "🔄自动登录";
    }

    if (!token) return prefix + ": ❌ 无有效Token";

    let payload = parseJwt(token);
    if (!uid && payload && payload.data) uid = payload.data.mid;
    if (!password && uid && credsStore[uid]) password = credsStore[uid];

    // 主动续期：Token 快到期时自动重新登录换新
    if (password && payload && payload.exp) {
      const remainSec = payload.exp - nowSec();
      if (remainSec < TOKEN_RENEW_AHEAD_HOURS * 3600) {
        try {
          const newToken = await login(uid, password);
          updateStoredToken(token, newToken, uid);
          token = newToken;
          payload = parseJwt(token);
          renewedNote = "🔄Token已自动续期";
          console.log("✓ " + prefix + " Token 已自动续期");
        } catch (e) {
          console.log("⚠ " + prefix + " 自动续期失败: " + e.message);
          renewedNote = "⚠续期失败";
        }
      }
    }

    let signed;
    try {
      signed = await getSignStatus(token);
    } catch (e) {
      // Token 失效 → 自动登录换新后重试一次
      if (!isAuthError(e.message) || !password) throw e;
      console.log("⚠ " + prefix + " Token 已失效，尝试自动续期...");
      const newToken = await login(uid, password);
      updateStoredToken(token, newToken, uid);
      token = newToken;
      payload = parseJwt(token);
      renewedNote = "🔄Token已自动续期";
      signed = await getSignStatus(token);
    }
    console.log("ℹ " + prefix + " 签到状态: " + (signed ? "已签到 ✓" : "未签到"));

    const info = tokenRemainStr(payload);
    const suffix = (renewedNote ? " " + renewedNote : "") + (info ? "（" + info + "）" : "");

    if (signed) {
      try {
        const history = await getSignHistory(token);
        const signedDays = history.filter(r => r.state).length;
        return prefix + ": ✓ 已签到（近 " + history.length + " 天签 " + signedDays + " 天）" + suffix;
      } catch (_) {
        return prefix + ": ✓ 今日已签到" + suffix;
      }
    }

    const gold = await doSign(token);
    const goldStr = gold > 0 ? " +" + gold + "米粒" : "";
    console.log("✓ " + prefix + " 签到成功" + goldStr);
    return prefix + ": ✓ 签到成功" + goldStr + suffix;
  } catch (e) {
    console.log("✗ " + prefix + " " + e.message);
    const hint = (!password && /401|无记录|已过期/.test(String(e.message)))
      ? "（Token失效，请配置 账号----密码 或重新登录一次）" : "";
    return prefix + ": ❌ " + e.message + hint;
  }
}

// ---------- 账号列表 ----------

/** 解析单行配置：`账号----密码` → 凭据条目，否则视为 Token */
function parseEntryLine(line) {
  const sep = line.indexOf("----");
  if (sep > 0) {
    const uid = line.slice(0, sep).trim();
    const password = line.slice(sep + 4).trim();
    if (uid && password) return { uid: uid, password: password };
  }
  return { token: line };
}

function getTokenList() {
  if (typeof $argument !== "undefined" && $argument) {
    const argObj = {};
    $argument.split("&").forEach(pair => {
      const [k, v] = pair.split("=");
      argObj[k] = v;
    });
    if (argObj.token) return [{ token: argObj.token.trim() }];
  }

  const boxjsVal = $prefs.valueForKey(BOXJS_KEY_TOKEN) || "";
  const boxjsLines = boxjsVal.split("\n").map(t => t.trim()).filter(t => t);
  if (boxjsLines.length > 0) return boxjsLines.map(parseEntryLine);

  const oldVal = $prefs.valueForKey(STORAGE_KEY_TOKEN) || "";
  if (oldVal) return [{ token: oldVal.trim() }];

  if (MF_ACCOUNTS) {
    return MF_ACCOUNTS.split(/[\n,，]+/).map(s => s.trim()).filter(s => s).map(parseEntryLine);
  }

  if (MF_TOKEN) {
    return MF_TOKEN.split(/[, ]+/).map(t => t.trim()).filter(t => t).map(t => ({ token: t }));
  }

  return [];
}

async function main() {
  console.log("===== 米饭签到 for Quantumult X =====");
  console.log("时间: " + getNow());

  const credsStore = loadCreds();
  const entries = getTokenList();

  if (entries.length === 0) {
    const msg = "未配置账号，三种方式任选：\n"
      + "1. BoxJS 面板：订阅 mifan.boxjs.json，填入 Token 或 账号----密码\n"
      + "2. MITM 自动捕获：配置 rewrite + MITM，登录一次自动抓取凭据\n"
      + "3. 直接编辑脚本：在 MF_ACCOUNTS 中填入 账号----密码";
    console.log("✗ " + msg);
    $notify("米饭签到 ❌", "缺少账号", msg);
    return;
  }

  console.log("ℹ 共发现 " + entries.length + " 个账号"
    + (Object.keys(credsStore).length ? "（本机已存 " + Object.keys(credsStore).length + " 份凭据用于自动续期）" : ""));

  const results = [];
  for (let i = 0; i < entries.length; i++) {
    const result = await processAccount(entries[i], i, credsStore);
    results.push(result);
    if (i < entries.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  const successCount = results.filter(r => r.includes("✓")).length;
  const failCount = results.filter(r => r.includes("❌")).length;
  const renewedCount = results.filter(r => r.includes("自动续期") || r.includes("自动登录")).length;
  const title = "米饭签到 " + (failCount === 0 ? "✓" : "⚠");
  const body = results.join("\n");
  const subtitle = successCount + "/" + entries.length + " 成功"
    + (renewedCount > 0 ? "，续期 " + renewedCount + " 个" : "")
    + (failCount > 0 ? "，" + failCount + " 失败" : "");

  console.log("===== 汇总 =====");
  console.log(body);

  $notify(title, subtitle, body);
}
