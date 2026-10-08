/*
 * 魅族云便签：下载笔记里的图片和附件（可选步骤）
 *
 * 附件在 cloud.flyme.cn 上，要登录态。清单不写死在脚本里：重新拉一遍笔记列表，
 * 从每条笔记的 `files` 字段收集「文件名 -> 地址」，再逐个下载。
 *
 * 用法：
 *   1. Chrome 打开并保持登录 https://notes.flyme.cn/notes
 *   2. F12 -> Console，整段粘贴本文件，回车（首次粘贴 Chrome 会拦一下，先手动输入 allow pasting）
 *   3. 文件陆续下载到「下载」目录，控制台打印进度
 *   4. 跑完把文件放进转换输出目录下的 attachments/
 *
 * 只调只读接口，不改动云端任何数据。Chrome 提示「已阻止弹出式窗口」时允许一次。
 */
(async () => {
  const PAGE = 200;
  const WAIT = 300;

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

  console.log('%c[1/3] 拉取笔记列表…', 'color:#c60;font-weight:bold');
  const tagsRaw = await api('/c/browser/note/gettags', {});
  const tags = (tagsRaw && tagsRaw.data) || [];
  const groupIds = ['-1', ...tags.map(t => t.id).filter(id => id !== '-1')];

  const files = new Map();
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
      const items = (r && r.content) || [];
      for (const n of items) {
        for (const [name, url] of Object.entries(n.files || {})) {
          if (!files.has(name)) files.set(name, url);
        }
      }
      got += items.length;
      if (items.length < PAGE) break;
    }
    console.log('  分类 ' + gid + ' 取到 ' + got + ' 条，累计附件 ' + files.size + ' 个');
  }

  if (!files.size) {
    console.log('这份数据里没有附件，不用下载。');
    return;
  }

  console.log('%c[2/3] 开始下载 ' + files.size + ' 个附件…', 'color:#c60;font-weight:bold');
  let ok = 0;
  let fail = 0;
  for (const [name, url] of files) {
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) {
        console.warn(`  跳过 ${name}：HTTP ${res.status}`);
        fail++;
        continue;
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10000);
      ok++;
      console.log(`  ✓ ${name}（${(blob.size / 1024).toFixed(0)} KB）`);
    } catch (e) {
      fail++;
      console.warn(`  失败 ${name}：${e.message}`);
    }
    await new Promise(r => setTimeout(r, WAIT));
  }

  console.log('%c[3/3] 完成：成功 ' + ok + '，失败 ' + fail, 'color:#080;font-weight:bold');
  if (fail) console.log('失败的多半是云端已经删掉的附件，原始清单看上面的日志。');
})();
