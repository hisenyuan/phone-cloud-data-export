/* 锤子便签导出 · 第二步（可选）：下载便签里的图片
 *
 * 图片存在云端，要登录态才能取（`/apps/note/notesimage/` 未登录会返回 code 1701）。
 * 文件名不写死在脚本里：现拉一遍便签列表，扫出所有 `<image ... name=...>` 再逐个下载。
 *
 * 用法：
 *   1. Chrome 打开 https://yun.smartisan.com/?from=snote#/notes ，确认已登录、能看到便签列表
 *   2. 按 ⌥⌘I 打开开发者工具，切到 Console
 *   3. 把本文件整段粘进去，回车
 *   4. Chrome 问「是否允许下载多个文件」时点允许
 *   5. 下载完把文件放进转换输出目录下的 attachments/
 *
 * 只调只读接口，不改动云端任何数据，也不读取、不外传你的 Cookie。
 */
(async () => {
  const BASE = 'https://yun.smartisan.com/apps/note/index.php';
  const IMG_BASE = 'https://yun.smartisan.com/apps/note/notesimage/';
  const PAGE_SIZE = 3000;
  const WAIT = 300;

  const get = async (query) => {
    const res = await fetch(`${BASE}?${query}`, {
      method: 'GET',
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(`接口返回的不是 JSON（${query}）：${text.slice(0, 200)}`);
    }
    if (json.code === 1 || json.code === '1') {
      throw new Error(`接口报错（${query}）：${JSON.stringify(json).slice(0, 200)}`);
    }
    return json.data;
  };

  console.log('%c[1/3] 检查登录态…', 'color:#c60;font-weight:bold');
  const account = await get('r=account/login');
  if (!account) throw new Error('登录态无效，请先在页面上确认能看到便签列表。');

  console.log('%c[2/3] 收集图片文件名…', 'color:#c60;font-weight:bold');
  const first = await get(`r=v2/getList&page=1&page_size=${PAGE_SIZE}`);
  const pageCount = (first && first.note && first.note.page_count) || 1;
  let notes = ((first && first.note && first.note.list) || []).slice();
  for (let page = 2; page <= pageCount; page++) {
    const data = await get(`r=v2/getList&page=${page}&page_size=${PAGE_SIZE}`);
    notes = notes.concat((data && data.note && data.note.list) || []);
  }

  const IMAGE_RE = /<image\s+w=(\d+)\s+h=(\d+)\s+describe=(.*?)\s+name=([^>]+)>/g;
  const names = new Set();
  for (const note of notes) {
    IMAGE_RE.lastIndex = 0;
    let m;
    while ((m = IMAGE_RE.exec(note.detail || ''))) names.add(m[4].trim());
  }
  console.log(`  便签 ${notes.length} 条，图片 ${names.size} 个：`, [...names]);
  if (!names.size) {
    console.log('这份数据里没有图片，不用下载。');
    return;
  }

  console.log('%c[3/3] 开始下载…', 'color:#c60;font-weight:bold');
  let ok = 0;
  let fail = 0;
  for (const name of names) {
    try {
      const res = await fetch(IMG_BASE + encodeURIComponent(name), { credentials: 'include' });
      const type = res.headers.get('content-type') || '';
      if (!res.ok || type.includes('json')) {
        console.warn(`  跳过 ${name}：${res.status} ${type}`);
        fail++;
        continue;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      ok++;
      console.log(`  ✓ ${name}（${(blob.size / 1024).toFixed(0)} KB）`);
    } catch (e) {
      fail++;
      console.warn(`  失败 ${name}：${e.message}`);
    }
    await new Promise((r) => setTimeout(r, WAIT));
  }
  console.log(`%c完成：成功 ${ok}，失败 ${fail}`, 'color:#080;font-weight:bold');
  if (fail) console.log('失败的多半是云端已经删掉的图，原始清单看上面的日志。');
})();
