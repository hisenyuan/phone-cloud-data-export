/*
 * 魅族云短信：接口探针
 *
 * 目的：把短信页真正用的接口地址、请求参数、返回结构记录下来，供下一步写备份脚本。
 *
 * 用法：
 *   1. Chrome 打开 https://cloud.flyme.cn/browser/sms-list.jsp 并确认已登录
 *   2. F12 -> Console，粘贴本文件，回车
 *   3. 在页面上点几下：切换左侧会话/文件夹、点开一条短信、往下滚动加载更多
 *      （脚本只记录这之后发生的请求，所以要点一点才有内容）
 *   4. 执行 __smsdump()   -> 会下载 flyme-sms-probe.json
 *   5. 把那个文件给我
 *
 * 只记录请求地址、参数和返回值片段，不改页面、不发送任何数据到外部。
 */
(() => {
  const clip = (s, n) => (s == null ? '' : String(s)).slice(0, n);
  const interesting = (u) => /cloud\.flyme\.cn/.test(u) && !/\.(js|css|png|jpe?g|gif|svg|woff2?|ico|ttf)(\?|$)/i.test(u);

  const log = { startedAt: new Date().toISOString(), page: location.href, perf: [], calls: [], storage: {} };

  // 1) 页面已经发过的请求（只有地址，没有内容）
  for (const e of performance.getEntriesByType('resource')) {
    if (interesting(e.name)) log.perf.push(e.name);
  }

  // 2) 钩住之后的 XHR
  const oOpen = XMLHttpRequest.prototype.open;
  const oSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) {
    this.__rec = { method: m, url: String(u), via: 'xhr' };
    return oOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const rec = this.__rec;
    if (rec) {
      rec.body = clip(body, 2000);
      this.addEventListener('load', () => {
        rec.status = this.status;
        try { rec.resp = clip(this.responseType === '' ? this.responseText : '[非文本响应]', 4000); }
        catch (e) { rec.resp = '[读不到]'; }
        log.calls.push(rec);
      });
    }
    return oSend.apply(this, arguments);
  };

  // 3) 钩住之后的 fetch
  const oFetch = window.fetch;
  if (oFetch) {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url);
      const rec = {
        method: (init && init.method) || 'GET',
        url: String(url),
        body: clip(init && init.body, 2000),
        via: 'fetch'
      };
      return oFetch.apply(this, arguments).then((res) => {
        rec.status = res.status;
        try {
          res.clone().text().then(t => { rec.resp = clip(t, 4000); log.calls.push(rec); });
        } catch (e) { log.calls.push(rec); }
        return res;
      });
    };
  }

  // 4) 页面里可能存了登录标识，只看键名不看值
  for (const store of ['localStorage', 'sessionStorage']) {
    try {
      const keys = [];
      for (let i = 0; i < window[store].length; i++) keys.push(window[store].key(i));
      log.storage[store] = keys;
    } catch (e) { log.storage[store] = '读不到'; }
  }

  window.__smslog = log;
  window.__smsdump = () => {
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'flyme-sms-probe.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    console.log('已下载 flyme-sms-probe.json：历史请求 ' + log.perf.length + ' 条，本次捕获 ' + log.calls.length + ' 条');
  };

  console.log('探针就绪。历史上已经发过的请求抓到 ' + log.perf.length + ' 条。');
  console.log('现在去页面上点几个会话/文件夹、滚动列表，然后执行 __smsdump()');
})();
