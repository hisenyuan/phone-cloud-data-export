/*
 * 魅族云便签（notes.flyme.cn）原始数据抓取脚本
 *
 * 用法：
 *   1. Chrome 打开并登录 https://notes.flyme.cn/notes
 *   2. 二选一：
 *      A. F12 -> Console（控制台）。首次粘贴 Chrome 会拦一下，让你先手动输入 allow pasting 再粘
 *      B. F12 -> Sources -> Snippets（代码段）-> New snippet，粘贴后 Ctrl/Cmd+Enter 运行（不用输 allow pasting）
 *   3. 整段粘贴本文件内容，回车
 *   4. 等控制台打印「完成：N 条笔记」，文件会存到「下载」目录：flyme-notes-raw.json
 *
 * 说明：脚本只在你已登录的这个页面里调用官方接口，不发送任何数据到外部。
 *      如果 Chrome 设置了「下载前询问保存位置」，会弹一次保存框。
 */
(async () => {
  const api = async (path, params) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    const res = await fetch(path + qs, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: ''
    });
    const json = await res.json();
    if (json.returnCode !== 200) {
      throw new Error(path + ' 返回 ' + json.returnCode + ' ' + (json.returnMessage || '') + ' ' + (json.returnUrl || ''));
    }
    return json.returnValue;
  };

  const tagsRaw = await api('/c/browser/note/gettags', {});
  const tags = (tagsRaw && tagsRaw.data) || [];
  console.log('分类数：', tags.length, tags.map(t => t.name + '(' + t.id + ')' + ':' + t.count).join(' | '));

  const PAGE = 200;
  const notes = new Map();
  const firstSeen = [];
  const collect = (items) => {
    for (const n of items || []) {
      if (!notes.has(n.uuid)) { notes.set(n.uuid, n); firstSeen.push(n.uuid); }
    }
  };

  // 先按「全部」抓一遍，再按每个分类抓一遍，按 uuid 去重，避免任何一条漏掉
  const groupIds = ['-1', ...tags.map(t => t.id).filter(id => id !== '-1')];
  const meta = [];
  for (const gid of groupIds) {
    let got = 0;
    for (let start = 0; start < 50000; start += PAGE) {
      let r;
      try {
        r = await api('/c/browser/note/getnotegroups', { start, length: PAGE, groupUuid: gid });
      } catch (e) {
        console.warn('跳过分类 ' + gid + '：' + e.message);
        break;
      }
      if (start === 0 && meta.length < 3) meta.push({ group: gid, keys: Object.keys(r || {}), sample: r });
      const items = (r && r.content) || [];
      collect(items);
      got += items.length;
      if (items.length < PAGE) break;
    }
    console.log('分类 ' + gid + ' 取到 ' + got + ' 条，累计去重后 ' + notes.size + ' 条');
  }

  console.log('首个响应结构（排查用）：', meta.slice(0, 1));

  const payload = {
    exportedAt: new Date().toISOString(),
    source: location.href,
    tags: tags,
    notes: firstSeen.map(u => notes.get(u))
  };

  // 完整性核对：拿云端各分类的条数跟实际抓到的比一比
  const cloudCount = tags.reduce((s, t) => s + (Number(t.count) || 0), 0);
  const noBody = payload.notes.filter(n => !n.body || n.body === '[]').length;
  const one = payload.notes[0] || {};
  console.log('字段核对：', {
    取到条数: payload.notes.length,
    分类条数之和: cloudCount,
    正文为空的条数: noBody,
    样例字段: Object.keys(one).join(','),
    样例时间: one.createDate,
    样例分类: one.groupStatus || one.groupUuid
  });

  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  console.log('文件大小：' + (blob.size / 1024 / 1024).toFixed(2) + ' MB');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'flyme-notes-raw.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  console.log('完成：' + payload.notes.length + ' 条笔记，已保存到下载目录 flyme-notes-raw.json');
})();
