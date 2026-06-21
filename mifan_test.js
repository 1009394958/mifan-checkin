/*
简单测试 - 确认 $httpClient 是否可用
在 QX 构造请求中手动运行
*/
console.log("===== 测试 =====");
console.log("$httpClient 类型: " + typeof $httpClient);

if (typeof $httpClient !== "undefined") {
  $httpClient.get({
    url: "https://httpbin.org/get",
    headers: {},
    timeout: 10
  }, (error, resp, data) => {
    if (error) {
      console.log("✗ 请求失败: " + error);
      $notify("测试 ❌", "请求失败", error);
    } else {
      console.log("✓ 请求成功, 状态码: " + resp.status);
      $notify("测试 ✓", "请求成功", "状态码: " + resp.status);
    }
    $done();
  });
} else {
  console.log("✗ $httpClient 不可用");
  $notify("测试 ❌", "$httpClient 不可用", "请确认在 QX 任务中运行");
  $done();
}
