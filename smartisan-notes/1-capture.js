/* 锤子便签（欢喜云）导出 · 第一步：抓取原始数据
 *
 * 用法：
 *   1. Chrome 打开 https://yun.smartisan.com/?from=snote#/notes ，确认已登录、能看到便签列表
 *   2. 按 ⌥⌘I 打开开发者工具，切到 Console
 *   3. 把本文件整段粘进去，回车
 *   4. 等它跑完（通常几秒），浏览器会下载 smartisan-notes-raw.json
 *
 * 只调三个官方只读接口：account/login、folder/getList、v2/getList。
 * 全程不改动云端任何数据，脚本也不读取、不外传你的 Cookie。
 */
(async () => {
  const BASE = 'https://yun.smartisan.com/apps/note/index.php';
  const PAGE_SIZE = 3000;

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
      throw new Error(`接口返回的不是 JSON（${query}）：${text.slice(0, 300)}`);
    }
    // 前端约定：code 为 1 表示出错，其余视为成功
    if (json.code === 1 || json.code === '1') {
      throw new Error(`接口报错（${query}）：${JSON.stringify(json).slice(0, 300)}`);
    }
    return json.data;
  };

  console.log('%c[1/5] 检查登录态…', 'color:#c60;font-weight:bold');
  const account = await get('r=account/login');
  console.log('  account/login 返回：', account);
  if (!account) throw new Error('登录态无效，请先在页面上确认能正常看到便签列表。');

  console.log('%c[2/5] 取分类列表…', 'color:#c60;font-weight:bold');
  const foldersRaw = await get('r=folder/getList');
  const folders = Array.isArray(foldersRaw)
    ? foldersRaw
    : (foldersRaw && (foldersRaw.noteFolder || foldersRaw.list)) || [];
  console.log(`  分类 ${folders.length} 个：`, folders.map((f) => f.title));

  console.log('%c[3/5] 取便签列表…', 'color:#c60;font-weight:bold');
  const first = await get(`r=v2/getList&page=1&page_size=${PAGE_SIZE}`);
  const pageCount = (first && first.note && first.note.page_count) || 1;
  let notes = ((first && first.note && first.note.list) || []).slice();
  console.log(`  第 1 页 ${notes.length} 条，共 ${pageCount} 页`);

  for (let page = 2; page <= pageCount; page++) {
    const data = await get(`r=v2/getList&page=${page}&page_size=${PAGE_SIZE}`);
    const list = (data && data.note && data.note.list) || [];
    notes = notes.concat(list);
    console.log(`  第 ${page} 页 ${list.length} 条`);
  }

  // 按 sync_id 去重（分页边界可能重复）
  const seen = new Set();
  const unique = [];
  let dup = 0;
  for (const n of notes) {
    const key = n && n.sync_id != null ? String(n.sync_id) : `__noid_${unique.length}`;
    if (seen.has(key)) {
      dup++;
      continue;
    }
    seen.add(key);
    unique.push(n);
  }

  console.log('%c[4/5] 自检…', 'color:#c60;font-weight:bold');
  const last = pageCount > 1 ? await get(`r=v2/getList&page=${pageCount}&page_size=${PAGE_SIZE}`) : first;
  const noteVersion = (last && last.note_version) || (first && first.note_version) || null;
  const fields = Object.keys(unique[0] || {}).sort();
  const emptyDetail = unique.filter((n) => !n.detail || String(n.detail).length === 0).length;
  const inTrash = unique.filter((n) => String(n.folder_type) === '3').length;
  const others = unique.filter((n) => String(n.folder_type) !== '3').length;

  console.log(`  抓取 ${notes.length} 条，去重后 ${unique.length} 条（重复 ${dup} 条）`);
  console.log(`  回收站 ${inTrash} 条，非回收站 ${others} 条；正文为空 ${emptyDetail} 条`);
  console.log(`  note_version=${noteVersion}，服务端 timestamp=${first && first.timestamp}`);
  console.log('  便签字段清单：', fields);
  console.log('  时间相关字段：', fields.filter((k) => /time|date/i.test(k)));
  console.log('  第一条样例（正文截断 300 字）：');
  console.log(JSON.stringify({ ...(unique[0] || {}), detail: String((unique[0] || {}).detail || '').slice(0, 300) }, null, 2));

  const payload = {
    exported_at: new Date().toISOString(),
    source: 'https://yun.smartisan.com/?from=snote#/notes',
    api: BASE,
    note_version: noteVersion,
    server_timestamp: (first && first.timestamp) || null,
    counts: { fetched: notes.length, unique: unique.length, trash: inTrash, folder: folders.length },
    folders,
    notes: unique,
  };

  console.log('%c[5/5] 下载 smartisan-notes-raw.json …', 'color:#c60;font-weight:bold');
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'smartisan-notes-raw.json';
  document.body.appendChild(a);
  a.click();
  a.remove();

  window.__snoteRaw = payload;
  console.log('%c完成。文件已下载，另外 window.__snoteRaw 里也留了一份。', 'color:#0a0;font-weight:bold');
  console.log('把上面「抓取/去重/回收站/字段清单/时间相关字段」这几行贴回给我即可。');
})().catch((e) => {
  console.error('%c抓取失败：' + e.message, 'color:#c00;font-weight:bold');
});
