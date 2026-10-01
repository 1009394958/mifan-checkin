/*
米饭签到 - Node 本地测试
========================
Mock Quantumult X 环境（$prefs / $task / $notify / $done），直连真实服务器验证：

  node mifan_test.js cred     场景1：BoxJS 填 账号----密码 → 自动登录 → 签到
  node mifan_test.js expired  场景2：Token已过期 → 主动续期 → 签到
  node mifan_test.js soon     场景3：Token剩1小时 → 主动续期 → 签到
  node mifan_test.js reject   场景4：Token格式完好但被服务器拒绝 → 401 → 自动续期重试
  node mifan_test.js all      全部场景

测试前请设置环境变量 MF_TEST_ACCOUNT / MF_TEST_PASSWORD（避免真实凭据写入仓库）。
*/
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

const script = fs.readFileSync(path.join(__dirname, "mifan_checkin.js"), "utf8");

// ---------- Mock QX 环境 ----------

function makeEnv() {
  const store = {};           // 模拟 $prefs 持久化存储
  const notifies = [];        // 模拟通知
  const env = {
    $prefs: {
      valueForKey: (k) => (store[k] === undefined ? "" : store[k]),
      setValueForKey: (v, k) => { store[k] = String(v); },
    },
    $task: {
      fetch: (params) => new Promise((resolve, reject) => {
        const u = new URL(params.url);
        const req = https.request({
          hostname: u.hostname,
          path: u.pathname + u.search,
          method: params.method || "GET",
          headers: params.headers,
          timeout: (params.timeout || 15) * 1000,
        }, (res) => {
          let data = "";
          res.on("data", (c) => { data += c; });
          res.on("end", () => {
            console.log("[HTTP] " + (params.method || "GET") + " " + u.pathname + " → " + res.statusCode + " " + data.substring(0, 120));
            resolve({ statusCode: res.statusCode, body: data });
          });
        });
        req.on("timeout", () => req.destroy(new Error("请求超时")));
        req.on("error", reject);
        if (params.body) req.write(params.body);
        req.end();
      }),
    },
    $notify: (t, s, b) => {
      notifies.push({ t, s, b });
      console.log("[通知] " + t + " | " + s + "\n" + (b || ""));
    },
  };
  return { env, store, notifies };
}

function fakeJwt(payload) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64")
    .replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return b64({ alg: "HS256", typ: "JWT" }) + "." + b64(payload) + ".fakesig";
}

async function scenario(name, prefs, extras) {
  console.log("\n########## " + name + " ##########");
  const { env, store, notifies } = makeEnv();
  Object.assign(store, prefs);
  if (extras && extras.request) env.$request = extras.request;
  if (extras && extras.response) env.$response = extras.response;

  const done = new Promise((resolve) => { env.$done = resolve; });
  const keys = Object.keys(env);
  // 加载签到脚本（task 模式）
  new Function(...keys, script)(...keys.map((k) => env[k]));

  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("测试超时(60s)")), 60000));
  await Promise.race([done, timeout]);

  const boxjs = (store["boxjs.mifan.checkin.mf_token"] || "").split("\n");
  console.log("\n[结果存储] BoxJS Token 行: " + boxjs.map(l => l.substring(0, 40) + "...").join(" | "));
  console.log("[结果存储] mf_creds = " + (store["mf_creds"] || "(空)"));
  console.log("[断言] 通知数: " + notifies.length);
  return { store, notifies };
}

// ---------- 场景 ----------

(async () => {
  const uid = process.env.MF_TEST_ACCOUNT;
  const pwd = process.env.MF_TEST_PASSWORD;
  if (!uid || !pwd) {
    console.error("请先设置环境变量：set MF_TEST_ACCOUNT=账号 & set MF_TEST_PASSWORD=密码");
    process.exit(1);
  }
  const now = Math.floor(Date.now() / 1000);
  const creds = JSON.stringify({ [uid]: pwd });
  let expectedRespToken = null;
  const which = process.argv[2] || "all";

  const cases = {
    // BoxJS 中直接填 账号----密码：每次自动登录，Token 永远新鲜
    cred: () => scenario("场景1: 账号----密码 → 自动登录 → 签到", {
      "boxjs.mifan.checkin.mf_token": uid + "----" + pwd,
    }),
    // Token 已过期 + 本机有凭据 → 主动续期
    expired: () => scenario("场景2: Token已过期 → 自动续期 → 签到", {
      "boxjs.mifan.checkin.mf_token": fakeJwt({ iss: "admin", iat: now - 100000, exp: now - 100, data: { mid: uid } }),
      "mf_creds": creds,
    }),
    // Token 剩余 1 小时（< 48h 阈值）→ 主动续期
    soon: () => scenario("场景3: Token剩余1小时 → 主动续期 → 签到", {
      "boxjs.mifan.checkin.mf_token": fakeJwt({ iss: "admin", iat: now, exp: now + 3600, data: { mid: uid } }),
      "mf_creds": creds,
    }),
    // Token 格式完好（未过期）但服务器无记录 → 401 → 自动续期重试
    reject: () => scenario("场景4: Token被服务器拒绝(401) → 自动续期重试", {
      "boxjs.mifan.checkin.mf_token": fakeJwt({ iss: "admin", iat: now, exp: now + 5 * 86400, data: { mid: uid } }),
      "mf_creds": creds,
    }),
    // rewrite 请求模式：MITM 捕获账号密码
    captureReq: () => scenario("场景5: MITM 请求捕获账号密码", {
    }, {
      request: { body: "uid=" + uid + "&password=" + pwd + "&gid=689&savepwd=true&tad=" },
    }),
    // rewrite 响应模式：捕获 Token，同账号旧 Token 被替换不堆积
    captureResp: () => {
      const respToken = fakeJwt({ iss: "admin", iat: now, exp: now + 6 * 86400, data: { mid: uid } });
      expectedRespToken = respToken;
      return scenario("场景6: MITM 响应捕获Token + 同账号去重", {
        "boxjs.mifan.checkin.mf_token": fakeJwt({ iss: "admin", iat: now, exp: now - 1, data: { mid: uid } }),
      }, {
        response: { body: JSON.stringify({ code: 200, error: 0, uid: uid, token: respToken }) },
      });
    },
  };

  const list = which === "all" ? Object.keys(cases) : [which];
  for (const name of list) {
    if (!cases[name]) { console.error("未知场景: " + name); process.exit(1); }
    const { store, notifies } = await cases[name]();

    // 断言按场景类型区分
    const isCapture = name.startsWith("capture");
    if (isCapture) {
      if (name === "captureReq") {
        const saved = JSON.parse(store["mf_creds"] || "{}");
        if (saved[uid] !== pwd) throw new Error(name + ": 账号密码未正确捕获");
        console.log("✓ 账号密码已捕获: " + JSON.stringify(Object.keys(saved)));
      }
      if (name === "captureResp") {
        const lines = (store["boxjs.mifan.checkin.mf_token"] || "").split("\n");
        if (lines.length !== 1 || lines[0] !== expectedRespToken) throw new Error(name + ": 存储行应为响应中的新Token且旧Token被替换，实际行数=" + lines.length);
        console.log("✓ Token 已捕获并替换旧值，共 " + lines.length + " 行");
      }
    } else {
      // 签到场景：凭据条目保留原行，Token 条目应被续期为真实 JWT
      const finalLine = (store["boxjs.mifan.checkin.mf_token"] || "").split("\n")[0];
      if (name === "cred") {
        if (!finalLine.includes("----")) throw new Error(name + ": 凭据行应保持不变");
      } else if (!finalLine.startsWith("eyJ")) {
        throw new Error(name + ": 最终存储的不是真实JWT Token");
      }
      const signNotify = notifies.find(n => n.t.startsWith("米饭签到"));
      if (!signNotify) throw new Error(name + ": 未收到签到汇总通知");
    }
    console.log("✅ " + name + " 通过");
  }
  console.log("\n===== 全部通过 =====");
})().catch((e) => { console.error("\n❌ 测试失败: " + e.message); process.exit(1); });
