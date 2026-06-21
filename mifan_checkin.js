/*
米饭 (mifan.61.com) 每日签到 for Quantumult X
=============================================

【定时签到 - task 模式】
  [task_local]
  0 30 9 * * * script-path=https://raw.githubusercontent.com/1009394958/mifan-checkin/main/mifan_checkin.js, tag=米饭签到, enabled=true

【自动捕获 Token - rewrite 模式】
  首次使用前，先通过 MITM 自动捕获登录 token：
  1. 在浏览器/App 中登录米饭账号一次
  2. Quantumult X 自动拦截登录响应并提取 token
  3. 之后定时签到就无需再管了

  [rewrite_local]
  ^https://mifan\\.61\\.com/api/v1/login url script-response-body https://raw.githubusercontent.com/1009394958/mifan-checkin/main/mifan_checkin.js

  [mitm]
  hostname = mifan.61.com

【BoxJS 面板管理 Token】
  在 BoxJS 中订阅以下链接，用网页管理 Token，无需改脚本：
  https://raw.githubusercontent.com/1009394958/mifan-checkin/main/mifan.boxjs.json
  在 BoxJS 中一行一个 Token，支持多账户自动循环签到

【多账号 - 传统方式（按任务分开）】
  [task_local]
  0 30 9 * * * script-path=mifan_checkin.js, tag=米饭-大号, args=token=xxx
  0 31 9 * * * script-path=mifan_checkin.js, tag=米饭-小号, args=token=yyy

【多账号 - 推荐方式（一个任务全搞定）】
  在 BoxJS 中将两个 Token 分两行填写即可，无需重复任务
*/

// ==================== 配置区域 ====================

// ★ 已有 token 直接填这里，多账户用 , 或空格分隔
// ★ 推荐改用 BoxJS 管理，则此处留空
const MF_TOKEN = "";

// ==================== 以下无需修改 ====================

const BASE_URL = "https://mifan.61.com/api/v1/";
const STORAGE_KEY_TOKEN = "mf_token";

/**
 * 判断当前运行模式
 * - $response 存在 → rewrite 模式（拦截登录响应，提取 token）
 * - $response 不存在 → task 模式（执行定时签到）
 */
(function () {
  // ============ 模式一：Rewrite 模式 - 自动捕获 Token ============
  if (typeof $response !== "undefined" && $response) {
    console.log("===== 米饭 Token 捕获 =====");
    try {
      const body = JSON.parse($response.body);
      if (body.code === 200 && body.token) {
        const token = body.token;
        // 保存到 $prefs（任务脚本会从这里读取）
        $prefs.setValueForKey(token, STORAGE_KEY_TOKEN);
        console.log("✓ Token: " + token.substring(0, 30) + "...");
        // 通知中显示完整 Token，方便复制到 BoxJS
        $notify(
          "米饭 Token 捕获 ✓",
          "已自动保存，可复制到 BoxJS 管理",
          token
        );
      } else {
        console.log("ℹ 该响应无 token，跳过");
      }
    } catch (e) {
      console.log("✗ 解析失败: " + e.message);
    }
    $done({});
    return;
  }

  // ============ 模式二：Task 模式 - 执行签到 ============
  main().then(() => $done()).catch(e => {
    console.log("脚本异常: " + e.message);
    $notify("米饭签到 ❌", "脚本异常", e.message);
    $done();
  });
})();

// ==================== 核心代码 ====================

function getHeaders(token) {
  return {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    "Content-Type": "application/x-www-form-urlencoded",
    "Origin": "https://mifan.61.com",
    "Referer": "https://mifan.61.com/dist/index.html",
    "Authorization": token,
  };
}

function getNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function request(method, path, token) {
  return new Promise((resolve, reject) => {
    const url = BASE_URL.replace(/\/$/, "") + "/" + path.replace(/^\//, "");
    const cb = (error, resp, data) => {
      if (error) { reject(error); return; }
      try { resolve(JSON.parse(data)); }
      catch (e) { resolve({ code: -1, data: data }); }
    };
    if (method === "GET") $httpClient.get({ url, headers: getHeaders(token), timeout: 15 }, cb);
    else $httpClient.post({ url, headers: getHeaders(token), timeout: 15 }, cb);
  });
}

async function getSignStatus(token) {
  const data = await request("GET", "event/dailysign/status/", token);
  if (data.code === 200) return data.data;
  throw new Error(data.data || "查询失败");
}

async function doSign(token) {
  const data = await request("POST", "event/dailysign/", token);
  if (data.code === 200) return data.gold || 0;
  throw new Error(data.data || "签到失败");
}

async function getSignHistory(token) {
  const data = await request("GET", "event/dailysign/recent", token);
  if (data.code === 200) return data.data || [];
  throw new Error(data.data || "查询失败");
}

/**
 * 处理单个账号的签到
 */
async function processAccount(token, index) {
  const prefix = "账号" + (index + 1);
  console.log("===== " + prefix + " =====");

  let signed = false;
  try {
    signed = await getSignStatus(token);
    console.log("ℹ " + prefix + " 签到状态: " + (signed ? "已签到 ✓" : "未签到"));
  } catch (e) {
    console.log("✗ " + prefix + " Token 无效: " + e.message);
    return prefix + ": ❌ Token 无效";
  }

  if (signed) {
    try {
      const history = await getSignHistory(token);
      const signedDays = history.filter(r => r.state).length;
      return prefix + ": ✓ 已签到（近 " + history.length + " 天签 " + signedDays + " 天）";
    } catch (_) {
      return prefix + ": ✓ 今日已签到";
    }
  }

  try {
    const gold = await doSign(token);
    const goldStr = gold > 0 ? " +" + gold + "米粒" : "";
    console.log("✓ " + prefix + " 签到成功" + goldStr);
    return prefix + ": ✓ 签到成功" + goldStr;
  } catch (e) {
    console.log("✗ " + prefix + " 签到失败: " + e.message);
    return prefix + ": ❌ 签到失败";
  }
}

function getTokenList() {
  // 1. 从 args 获取
  if (typeof $argument !== "undefined" && $argument) {
    const argObj = {};
    $argument.split("&").forEach(pair => {
      const [k, v] = pair.split("=");
      argObj[k] = v;
    });
    if (argObj.token) return [argObj.token];
  }

  // 2. 从 BoxJS textarea 获取（多行分隔）
  const boxjsToken = $prefs.valueForKey(STORAGE_KEY_TOKEN) || "";
  const boxjsTokens = boxjsToken.split("\n").map(t => t.trim()).filter(t => t);
  if (boxjsTokens.length > 0) return boxjsTokens;

  // 3. 从 MF_TOKEN 常量获取
  if (MF_TOKEN) {
    return MF_TOKEN.split(/[, ]+/).filter(t => t.trim());
  }

  return [];
}

async function main() {
  console.log("===== 米饭签到 for Quantumult X =====");
  console.log("时间: " + getNow());

  const tokens = getTokenList();

  if (tokens.length === 0) {
    const msg = "未配置 Token，三种方式任选：\n"
      + "1. BoxJS 面板：订阅 mifan.boxjs.json，在网页中填入 Token\n"
      + "2. MITM 自动捕获：配置上面的 rewrite + MITM，登录一次自动抓取\n"
      + "3. 直接编辑脚本：在 MF_TOKEN 变量中填入 Token";
    console.log("✗ " + msg);
    $notify("米饭签到 ❌", "缺少 Token", msg);
    return;
  }

  console.log("ℹ 共发现 " + tokens.length + " 个 Token");

  const results = [];
  for (let i = 0; i < tokens.length; i++) {
    const result = await processAccount(tokens[i], i);
    results.push(result);
    if (i < tokens.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  const successCount = results.filter(r => r.includes("✓")).length;
  const failCount = results.filter(r => r.includes("❌")).length;
  const title = "米饭签到 " + (failCount === 0 ? "✓" : "⚠");
  const body = results.join("\n");
  const subtitle = successCount + "/" + tokens.length + " 成功" +
    (failCount > 0 ? "，" + failCount + " 失败" : "");

  console.log("===== 汇总 =====");
  console.log(body);

  $notify(title, subtitle, body);
}
