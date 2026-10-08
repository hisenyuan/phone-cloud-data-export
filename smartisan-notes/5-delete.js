/* 锤子便签 · 批量删便签（带开关的版本）
 *
 * 用法：还是那个已登录的欢喜云便签页面，F12 -> Console，整段粘贴。
 * 默认 DRY_RUN = true，只打印命中清单，不动数据。
 *
 * 三种模式：
 *   MODE: 'trash'   把不在回收站的便签移进回收站（可恢复）
 *   MODE: 'purge'   把回收站里的便签彻底删除（不可恢复）
 *   MODE: 'restore' 把回收站里的便签恢复出来
 *
 * 接口语义（从前端包 note-app_5edb5c68aa.js 逆出来的）：
 *   移到回收站 = note/updateFolder，folder_type=3，folderId 空
 *   彻底删除   = note/deleteAll，sync_ids 逗号拼接
 *   deleteAll 对不在回收站的便签不生效，所以清空必须两步：先 trash 再 purge
 *
 * 这个脚本只在浏览器控制台里跑，没有任何本地依赖。默认 DRY_RUN，不会动数据。
 */
(async () => {
  // ======= 只改这一段 =======
  const CONFIG = {
    MODE: 'trash',
    DRY_RUN: true,      // true 只打印；确认清单后改 false
    CONFIRM: '',        // 真正执行时必须填「确认」
    LIMIT: 0,           // 0 = 不限；填 1 可以只处理一条
    BATCH: 20,          // 每批多少个（别调太大，服务端可能限流）
    FILTER: () => true, // 例：n => n.title.includes('测试')
  };
  // =========================

  const BASE = 'https://yun.smartisan.com/apps/note/index.php';
  const PAGE_SIZE = 3000;
  const TRASH = '3';
  // 前端每个页面加载都会生成一个 8 位随机 tab_id，所有写请求都带上；
  // 不带的话 deleteAll 会报 2109「便签web标签错误」
  const TAB_ID = Array.from({ length: 8 }, () =>
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'[0 | (Math.random() * 62)]
  ).join('');

  const get = async (query) => {
    const res = await fetch(`${BASE}?${query}`, {
      method: 'GET', credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    const json = await res.json();
    if (json.code === 1 || json.code === '1') throw new Error(`接口报错（${query}）：${JSON.stringify(json).slice(0, 300)}`);
    return json.data;
  };

  const post = async (route, params) => {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, tab_id: TAB_ID })) body.set(k, String(v));
    const res = await fetch(`${BASE}?r=${route}`, {
      method: 'POST', credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body,
    });
    const json = await res.json();
    if (json.code === 1 || json.code === '1') {
      const keys = Object.keys(json.errInfo || {});
      if (!keys.includes('2154')) {
        const err = new Error(`接口报错（${route}）：${JSON.stringify(json).slice(0, 300)}`);
        err.json = json;
        throw err;
      }
    }
    return json;
  };

  const fetchStats = async () => {
    const first = await get(`r=v2/getList&page=1&page_size=${PAGE_SIZE}`);
    const pageCount = (first.note && first.note.page_count) || 1;
    let list = ((first.note && first.note.list) || []).slice();
    for (let p = 2; p <= pageCount; p++) {
      const d = await get(`r=v2/getList&page=${p}&page_size=${PAGE_SIZE}`);
      list = list.concat((d.note && d.note.list) || []);
    }
    const seen = new Set();
    list = list.filter((n) => {
      const k = String(n.sync_id);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const trash = list.filter((n) => String(n.folder_type) === TRASH);
    return { total: list.length, trash: trash.length, live: list.length - trash.length, notes: list };
  };

  const isTrash = (n) => String(n.folder_type) === TRASH;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  console.log('%c读取云端便签…', 'color:#c60');
  let state = await fetchStats();
  console.log(`当前：共 ${state.total} 条，正常 ${state.live} 条，回收站 ${state.trash} 条`);

  const pick = {
    trash: (n) => !isTrash(n),
    purge: (n) => isTrash(n),
    restore: (n) => isTrash(n),
  }[CONFIG.MODE];
  if (!pick) throw new Error(`MODE 只能是 trash / purge / restore，现在是 ${CONFIG.MODE}`);

  let targets = state.notes.filter(pick).filter(CONFIG.FILTER);
  if (CONFIG.LIMIT > 0) targets = targets.slice(0, CONFIG.LIMIT);

  console.log(`\n模式 ${CONFIG.MODE}，命中 ${targets.length} 条：`);
  for (const n of targets.slice(0, 20)) console.log(`  - ${n.title}`);
  if (targets.length > 20) console.log(`  … 另外 ${targets.length - 20} 条`);
  if (!targets.length) return;

  if (CONFIG.DRY_RUN) {
    console.log('\n%c预演，没有动数据。确认后把 DRY_RUN 改 false、CONFIRM 填「确认」再跑。', 'color:#09c;font-weight:bold');
    return;
  }
  if (CONFIG.CONFIRM !== '确认') {
    console.log('\n%cCONFIRM 没填对，已中止。', 'color:#c00;font-weight:bold');
    return;
  }

  const submit = async (batch) => {
    if (CONFIG.MODE === 'purge') {
      await post('note/deleteAll', { sync_ids: batch.map((n) => String(n.sync_id)).join(',') });
    } else {
      await post('note/updateFolder', {
        sync_ids: JSON.stringify(batch.map((n, i) => ({ sync_id: String(n.sync_id), position_in_folder: i }))),
        folder_type: CONFIG.MODE === 'trash' ? 3 : 0,
        folderId: '',
      });
    }
  };

  console.log(`\n%c开始执行，每批 ${CONFIG.BATCH} 条…`, 'color:#c00;font-weight:bold');
  let done = 0;
  for (let i = 0; i < targets.length; i += CONFIG.BATCH) {
    const batch = targets.slice(i, i + CONFIG.BATCH);
    try {
      await submit(batch);
      done += batch.length;
    } catch (e) {
      console.error(`  这一批失败：${e.message}`);
    }
    await wait(700);
    state = await fetchStats();
    console.log(`  已提交 ${done}/${targets.length}，云端现在：正常 ${state.live} / 回收站 ${state.trash}`);
    if (i === 0 && done === 0) {
      console.log('%c第一批就没生效，停下来。把上面的报错发我。', 'color:#c00;font-weight:bold');
      return;
    }
  }
  console.log('%c完成。', 'color:#0a0;font-weight:bold');
})().catch((e) => console.error('%c执行失败：' + e.message, 'color:#c00;font-weight:bold'));
