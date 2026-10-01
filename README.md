# 米饭签到 - Quantumult X

每日自动签到 [mifan.61.com](https://mifan.61.com)

## Token 自动续期

服务器签发的 Token 是 JWT，**固定 7 天有效**，无法直接延长。
脚本通过**自动续期**解决：

- Token 剩余不足 48 小时 → 自动用保存的账号密码重新登录换新 Token（又是 7 天）
- 签到时发现 Token 失效（401）→ 同样自动重登重试
- 效果：**等效永久有效**，前提是保存过账号密码

保存账号密码的三种方式（任选其一）：

1. **MITM 自动捕获（推荐）**：配置下面的 rewrite，Safari 登录一次，Token 和账号密码同时自动抓取（密码仅存本机）
2. **BoxJS**：Token 文本域中按 `账号----密码` 格式一行一个
3. **编辑脚本**：在 `MF_ACCOUNTS` 中填入 `账号----密码`

只保存了 Token 没保存密码？Token 仍会自动续期失败时提醒你重新登录。

## 使用方法

将以下配置添加到 Quantumult X：

```
[task_local]
0 30 9 * * * https://raw.githubusercontent.com/1009394958/mifan-checkin/main/mifan_checkin.js, tag=米饭签到, enabled=true

[rewrite_local]
^https://mifan\.61\.com/api/v1/login url script-request-body https://raw.githubusercontent.com/1009394958/mifan-checkin/main/mifan_checkin.js
^https://mifan\.61\.com/api/v1/login url script-response-body https://raw.githubusercontent.com/1009394958/mifan-checkin/main/mifan_checkin.js

[mitm]
hostname = mifan.61.com
```

然后 Safari 打开 https://mifan.61.com/dist/index.html 登录一次，Token 和账号密码自动捕获。
每天 9:30 自动签到，通知中会显示 Token 剩余有效期。
