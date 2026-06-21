# 米饭签到 - Quantumult X

每日自动签到 [mifan.61.com](https://mifan.61.com)

## 使用方法

将以下配置添加到 Quantumult X：

```
[task_local]
0 30 9 * * * https://raw.githubusercontent.com/1009394958/mifan-checkin/main/mifan_checkin.js, tag=米饭签到, enabled=true

[rewrite_local]
^https://mifan\.61\.com/api/v1/login url script-response-body https://raw.githubusercontent.com/1009394958/mifan-checkin/main/mifan_checkin.js

[mitm]
hostname = mifan.61.com
```

然后 Safari 打开 https://mifan.61.com/dist/index.html 登录一次，Token 自动捕获。
每天 9:30 自动签到。