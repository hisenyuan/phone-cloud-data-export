/*
 * 魅族云短信：全量抓取
 *
 * 已探明的接口（POST + 表单参数，URL 上要带 tkscsrf）：
 *   /c/browser/sms/getsmsgroups?tkscsrf=...  body: status=phone&type=<文件夹>&start=&length=
 *   /c/browser/sms/getsmsdialogs?tkscsrf=... body: contact=<号码>&status=phone&type=&start=&length=
 *
 * 用法：
 *   1. Chrome 打开 https://cloud.flyme.cn/browser/sms-list.jsp 并确认已登录
 *   2. F12 -> Console，粘贴本文件，回车（首次粘贴要先输入 allow pasting）
 *   3. 让这个标签页保持在前台，别切走、别关。后台标签页的定时器会被浏览器降速，会慢很多
 *   4. 控制台会打印进度，每 200 个会话自动存一份分段文件，最后再存一份 full 文件
 *   5. 抓完把 flyme-sms-*-full.json 给我（分段文件是累积快照，full 最全）
 *
 * 中断了也不怕：分段文件是累积的，重跑不会丢已抓到的部分。
 * 只调只读接口，不改不删任何数据。
 */
(async () => {
  const PAGE_GROUPS = 50;       // 会话列表每页请求条数（服务端若限流会返回更少，脚本按实际返回推进）
  const PAGE_MSGS = 50;         // 单个会话的消息每页请求条数
  const GAP = 90;               // 每个请求后的间隔
  const CONCURRENCY = 3;        // 同时抓 3 个会话
  const AUTOSAVE_EVERY = 200;   // 每抓到多少个会话存一次
  const TYPES = [0, 1, 2, 3, 4, 5];

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const pickToken = () => {
    const hit = performance.getEntriesByType('resource')
      .map(e => e.name.match(/[?&]tkscsrf=([^&]+)/))
      .filter(Boolean)
      .pop();
    if (hit) return decodeURIComponent(hit[1]);
    const c = (document.cookie.match(/(?:^|;\s*)tkscsrf=([^;]+)/) || [])[1];
    return c ? decodeURIComponent(c) : '';
  };

  const token = window.__smsToken || pickToken();
  if (!token) {
    console.error('没拿到 tkscsrf。请在短信页面刷新一次，等列表出来之后再执行本脚本。');
    return;
  }
  window.__smsToken = token;
  console.log('tkscsrf = ' + token);

  const api = async (path, params, tries = 3) => {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 25000);
        const res = await fetch(path + '?tkscsrf=' + encodeURIComponent(token), {
          method: 'POST',
          credentials: 'same-origin',
          signal: ctl.signal,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: new URLSearchParams(params).toString()
        });
        clearTimeout(timer);
        const json = await res.json();
        if (json.returnCode !== 200) {
          throw new Error('接口返回 ' + json.returnCode + ' ' + (json.returnMessage || '') + ' ' + (json.returnUrl || ''));
        }
        return json.returnValue;
      } catch (e) {
        lastErr = e;
        await sleep(600 * (i + 1));
      }
    }
    throw lastErr;
  };

  // 翻页：按服务端实际返回条数推进，避免服务端限制每页条数时漏数据
  const fetchAll = async (path, params, pageSize, onFirst) => {
    const items = [];
    let start = 0;
    let total = null;
    let first = true;
    while (start < 100000) {
      const v = await api(path, { ...params, start, length: pageSize });
      const page = (v && v.content) || [];
      if (first) { total = (v && typeof v.count === 'number') ? v.count : null; if (onFirst) onFirst(v); first = false; }
      if (!page.length) break;
      items.push(...page);
      start += page.length;
      if (total !== null && items.length >= total) break;
      if (page.length < pageSize && total === null) break;
      await sleep(GAP);
    }
    return { items, total };
  };

  const runId = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const state = {
    runId,
    startedAt: new Date().toISOString(),
    source: location.href,
    tkscsrf: token,
    folders: {},
    threads: [],
    failed: []
  };

  const countMsgs = () => state.threads.reduce((s, t) => s + t.messages.length, 0);
  let partNo = 0;
  const download = (suffix) => {
    const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'flyme-sms-' + runId + '-' + suffix + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    console.log('已保存 ' + a.download + '（' + (blob.size / 1024 / 1024).toFixed(2) + ' MB，会话 ' +
      state.threads.length + '，消息 ' + countMsgs() + '）');
  };
  window.__smsState = state;
  window.__smsSave = () => download('part' + (++partNo) + '-manual');

  // ---- 1. 先列出各文件夹里的会话 ----
  const tasks = [];
  const seenThread = new Set();
  for (const type of TYPES) {
    let res;
    try {
      res = await fetchAll('/c/browser/sms/getsmsgroups', { status: 'phone', type }, PAGE_GROUPS);
    } catch (e) {
      console.warn('文件夹 type=' + type + ' 读取失败：' + e.message);
      continue;
    }
    state.folders[type] = { count: res.total, fetched: res.items.length };
    console.log('文件夹 type=' + type + '：接口报 ' + res.total + ' 个会话，取到 ' + res.items.length + ' 个');
    for (const g of res.items) {
      const contact = g.uniformNumber || g.mobilenumber || '';
      if (!contact) continue;
      const key = type + '|' + contact;
      if (seenThread.has(key)) continue;
      seenThread.add(key);
      tasks.push({ key, type, contact, name: g.senderName || '', lastBody: g.body || '' });
    }
    await sleep(GAP);
  }
  const totalTasks = tasks.length;
  console.log('合计待抓会话 ' + totalTasks + ' 个，开始逐个拉消息（同时 ' + CONCURRENCY + ' 个）');

  // ---- 2. 逐个会话拉消息（小并发）----
  let done = 0;
  const worker = async () => {
    while (true) {
      const task = tasks.shift();
      if (!task) return;
      try {
        const res = await fetchAll('/c/browser/sms/getsmsdialogs',
          { contact: task.contact, status: 'phone', type: task.type }, PAGE_MSGS);
        const seen = new Set();
        const messages = [];
        for (const m of res.items) {
          const id = m.uuId || (m.id + '|' + m.senddate);
          if (!seen.has(id)) { seen.add(id); messages.push(m); }
        }
        state.threads.push({ ...task, dialogCount: messages.length, messages });
      } catch (e) {
        state.failed.push({ ...task, error: e.message });
        console.warn('会话 ' + task.contact + ' 失败：' + e.message);
      }
      done++;
      if (done % 25 === 0) console.log('进度 ' + done + '/' + totalTasks + '（剩余 ' + tasks.length + '，成功 ' + state.threads.length + '，失败 ' + state.failed.length + '，消息 ' + countMsgs() + '）');
      if (done % AUTOSAVE_EVERY === 0) download('part' + (++partNo));
      await sleep(GAP);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // ---- 3. 收尾 ----
  console.log('=== 抓取结束 ===');
  console.log('文件夹统计：', state.folders);
  console.log('会话 ' + state.threads.length + ' 个，消息 ' + countMsgs() + ' 条，失败 ' + state.failed.length + ' 个');
  if (state.failed.length) {
    console.warn('失败的会话（重跑一次可以补）：', state.failed.map(f => f.contact));
  }
  download('full');
})();
