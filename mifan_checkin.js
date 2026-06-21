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
  ^https://mifan\.61\.com/api/v1/login url script-response-body https://raw.githubusercontent.com/1009394958/mifan-checkin/main/mifan_checkin.js

  [mitm]
  hostname = mifan.61.com

  ★ 如果已有 token，也可以直接在下方 MF_TOKEN 中填写，跳过捕获步骤

【多账号】
  [task_local]
  0 30 9 * * * script-path=mifan_checkin.js, tag=米饭-大号, args=token=xxx
  0 31 9 * * * script-path=mifan_checkin.js, tag=米饭-小号, args=token=yyy
*/

// ==================== 配置区域 ====================

// ★ 已有 token 直接填这里（可从浏览器 localStorage.MF_AUTH 获取）
// ★ 不想手动填？配置上方 rewrite + MITM，登录一次自动捕获
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
      console.log("响应: " + JSON.stringify(body).substring(0, 200));

      if (body.code === 200 && body.token) {
        const token = body.token;
        $prefs.setValueForKey(token, STORAGE_KEY_TOKEN);
        console.log("✓ Token 捕获成功并已持久化: " + token.substring(0, 30) + "...");
        $notify(
          "米饭 Token 捕获 ✓",
          "登录 Token 已自动保存",
          "现在可以正常使用定时签到了"
        );
      } else {
        console.log("ℹ 该响应无 token，跳过: code=" + body.code);
      }
    } catch (e) {
      console.log("✗ 解析响应失败: " + e.message);
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

async function main() {
  console.log("===== 米饭签到 for Quantumult X =====");
  console.log("时间: " + getNow());

  // 获取 token：args > 脚本变量 > 持久化存储
  let token = "";

  if (typeof $argument !== "undefined" && $argument) {
    const argObj = {};
    $argument.split("&").forEach(pair => {
      const [k, v] = pair.split("=");
      argObj[k] = v;
    });
    token = argObj.token || "";
  }
  if (!token) token = MF_TOKEN;
  if (!token) token = $prefs.valueForKey(STORAGE_KEY_TOKEN) || "";

  if (!token) {
    const msg = "未配置 Token，请按以下步骤操作：\n"
      + "1. 在 Quantumult X 配置中添加 rewrite + MITM（见脚本头部注释）\n"
      + "2. 在 Safari 中登录 https://mifan.61.com/dist/index.html\n"
      + "3. Quantumult X 会自动捕获 token\n"
      + "4. 之后定时签到即可正常运行";
    console.log("✗ " + msg);
    $notify("米饭签到 ❌", "缺少 Token", msg);
    return;
  }

  console.log("ℹ Token: " + token.substring(0, 20) + "...");

  // 验证 token + 查签到状态
  let signed = false;
  try {
    signed = await getSignStatus(token);
    console.log("ℹ 签到状态: " + (signed ? "已签到 ✓" : "未签到"));
  } catch (e) {
    console.log("✗ Token 无效: " + e.message);
    $prefs.removeValueForKey(STORAGE_KEY_TOKEN);
    $notify("米饭签到 ❌", "Token 无效",
      "请在浏览器重新登录后，让 Quantumult X 重新捕获 token");
    return;
  }

  // 已签到
  if (signed) {
    try {
      const history = await getSignHistory(token);
      const signedDays = history.filter(r => r.state).length;
      $notify("米饭签到 ✓", "今日已签到",
        "近期 " + history.length + " 天已签 " + signedDays + " 天");
    } catch (_) {
      $notify("米饭签到 ✓", "今日已签到", "时间: " + getNow());
    }
    return;
  }

  // 执行签到
  try {
    const gold = await doSign(token);
    $prefs.setValueForKey(token, STORAGE_KEY_TOKEN);
    const goldMsg = gold > 0 ? "获得 " + gold + " 米粒 ✨" : "";
    console.log("✓ 签到成功 " + goldMsg);
    $notify("米饭签到 ✓", "签到成功", goldMsg + "时间: " + getNow());
  } catch (e) {
    console.log("✗ 签到失败: " + e.message);
    $notify("米饭签到 ❌", "签到失败", e.message);
  }
}
