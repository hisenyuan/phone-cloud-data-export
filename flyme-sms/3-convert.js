#!/usr/bin/env node
/*
 * 把 5-短信备份-抓取.js 导出的 JSON 转成可读格式。
 *
 * 用法：
 *   node sms-convert.js <输出目录> <抓取结果.json> [更多分段文件...] [选项]
 *
 * 选项：
 *   --by-contact        按联系人生成 md（时间轴格式，收/发顶格）
 *   --both              额外抽出「收发都有」的会话到 收发都有/ 目录，并生成 收发都有.csv
 *   --min-msgs=N        按联系人导出时，只导消息数 ≥N 的会话（默认 1）
 *   --line-break=space  每行行尾的处理：space（默认，两个空格，标准 Markdown 也认）/ br / blank / keep
 *
 * 输出：
 *   全部短信.csv        一行一条，Excel/WPS 可直接打开
 *   短信原始.json       去重后的完整数据
 *   按联系人/*.md       可选
 *   收发都有/*.md       可选
 *   _导出报告.md
 */
'use strict';

const fs = require('fs');
const path = require('path');

const TZ = 'Asia/Shanghai';
const args = process.argv.slice(2);
const BY_CONTACT = args.includes('--by-contact');
const BOTH = args.includes('--both');
const MIN_MSGS = Number((args.find(a => a.startsWith('--min-msgs=')) || '').split('=')[1] || 1);
const LINE_BREAK = (args.find(a => a.startsWith('--line-break=')) || '').split('=')[1] || 'space';
const positional = args.filter(a => !a.startsWith('--'));
const OUT = positional[0];
const INPUTS = positional.slice(1);

if (!OUT || !INPUTS.length) {
  console.error('用法: node sms-convert.js <输出目录> <抓取结果.json> [更多文件...] [--by-contact] [--both] [--min-msgs=N]');
  process.exit(1);
}

const fmtTime = (ms) => {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(new Date(n < 1e12 ? n * 1000 : n)).replace('T', ' ');
};

// 接口字段 type：1 收件、2 发件（样本核对一致）
const direction = (m) => (m.type === 1 ? '收' : m.type === 2 ? '发' : String(m.type == null ? '' : m.type));

// ---------------- 合并多个抓取结果 ----------------
const threads = new Map();
const folderStat = new Map();
let inputFiles = 0;

for (const f of INPUTS) {
  let data;
  try { data = JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { console.warn('跳过读不了的文件：' + f + '（' + e.message + '）'); continue; }
  inputFiles++;
  for (const [t, v] of Object.entries(data.folders || {})) {
    const cur = folderStat.get(t) || { count: 0, fetched: 0 };
    folderStat.set(t, {
      count: Math.max(cur.count, Number(v && v.count) || 0),
      fetched: Math.max(cur.fetched, Number(v && v.fetched) || 0)
    });
  }
  for (const t of data.threads || []) {
    // 按号码合并：云端 type=0/2/4/5 是同一批会话，type=3 是另一批
    const key = t.contact || t.key || '';
    let rec = threads.get(key);
    if (!rec) {
      rec = { key, type: t.type, contact: t.contact, name: t.name || '', messages: new Map() };
      threads.set(key, rec);
    }
    if (!rec.name && t.name) rec.name = t.name;
    if (Number(t.type) < Number(rec.type)) rec.type = t.type;
    for (const m of t.messages || []) {
      const id = m.uuId || (m.id + '|' + m.senddate);
      rec.messages.set(id, m);
    }
  }
}

const allThreads = [...threads.values()].map(t => {
  const messages = [...t.messages.values()].sort((a, b) =>
    (Number(a.senddate) || Number(a.occurdate) || 0) - (Number(b.senddate) || Number(b.occurdate) || 0));
  const recv = messages.filter(m => direction(m) === '收').length;
  const sent = messages.filter(m => direction(m) === '发').length;
  return { ...t, messages, recv, sent };
});
allThreads.sort((a, b) => {
  const la = a.messages.length ? (a.messages[a.messages.length - 1].senddate || 0) : 0;
  const lb = b.messages.length ? (b.messages[b.messages.length - 1].senddate || 0) : 0;
  return (lb || 0) - (la || 0);
});

const msgCount = allThreads.reduce((s, t) => s + t.messages.length, 0);
console.log('读入 ' + inputFiles + ' 个文件；会话 ' + allThreads.length + ' 个，消息 ' + msgCount + ' 条');

fs.mkdirSync(OUT, { recursive: true });

// ---------------- CSV ----------------
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const writeCsv = (file, list) => {
  const rows = [['发送时间', '方向', '对方号码', '对方名称', '文件夹', '正文', 'uuid']];
  for (const t of list) {
    for (const m of t.messages) {
      rows.push([
        fmtTime(m.senddate || m.occurdate),
        direction(m),
        t.contact || m.uniformNumber || m.mobilenumber || '',
        t.name || m.senderName || '',
        t.type,
        String(m.body || '').replace(/\r\n?/g, '\n'),
        m.uuId || ''
      ]);
    }
  }
  fs.writeFileSync(file, '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n', 'utf8');
  return rows.length - 1;
};
const totalRows = writeCsv(path.join(OUT, '全部短信.csv'), allThreads);

// ---------------- 去重后的 JSON ----------------
fs.writeFileSync(path.join(OUT, '短信原始.json'), JSON.stringify({
  exportedAt: new Date().toISOString(),
  folders: Object.fromEntries(folderStat),
  threadCount: allThreads.length,
  messageCount: msgCount,
  threads: allThreads.map(t => ({ key: t.key, type: t.type, contact: t.contact, name: t.name, recv: t.recv, sent: t.sent, messages: t.messages }))
}, null, 1), 'utf8');

// ---------------- 时间轴 md ----------------
function safeName(s, max = 60) {
  let t = String(s == null ? '' : s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
  t = t.replace(/^\.+/, '');
  if (t.length > max) t = t.slice(0, max).trim();
  return t || '未知';
}

// 每条消息：收/发 顶格 + 时间 + 正文；正文里的换行缩进两格续写
const messageLine = (m) => {
  const when = fmtTime(m.senddate || m.occurdate);
  // 云端正文用的是 \r\n，先统一成 \n，否则残留的 \r 会把行切坏
  const body = String(m.body == null ? '' : m.body).replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  const parts = (body || '（空）').split('\n');
  const out = [direction(m) + ' ' + when + ' ' + parts[0]];
  for (const extra of parts.slice(1)) out.push('  ' + extra);
  return out.join('\n');
};

// 标准 Markdown 会把段落里的单个换行当空格，所以行尾加硬换行标记，
// 这样在 Obsidian（严格换行开或关）、VSCode 预览、GitHub 上都能正常换行。
const hardBreak = (line) => {
  if (line === '') return '';
  if (LINE_BREAK === 'space') return line + '  ';
  if (LINE_BREAK === 'br') return line + '<br>';
  return line;
};

const writeThreads = (dir, list) => {
  fs.mkdirSync(dir, { recursive: true });
  const used = new Set();
  let n = 0;
  for (const t of list) {
    if (!t.messages.length) continue;
    const label = (t.name ? t.name + ' ' : '') + (t.contact || '');
    let file = safeName(label) + '.md';
    let k = 2;
    while (used.has(file)) { file = safeName(label) + ' (' + k + ').md'; k++; }
    used.add(file);
    const first = fmtTime(t.messages[0].senddate || t.messages[0].occurdate);
    const last = fmtTime(t.messages[t.messages.length - 1].senddate || t.messages[t.messages.length - 1].occurdate);
    const lines = [
      '---',
      'contact: "' + String(t.contact || '').replace(/"/g, '\\"') + '"',
      'name: "' + String(t.name || '').replace(/"/g, '\\"') + '"',
      'messages: ' + t.messages.length,
      'received: ' + t.recv,
      'sent: ' + t.sent,
      'first: "' + first + '"',
      'last: "' + last + '"',
      'source: "https://cloud.flyme.cn/browser/sms-list.jsp"',
      '---',
      '',
      '# ' + (t.name || t.contact || '未知'),
      ''
    ];
    if (LINE_BREAK === 'blank') {
      for (const m of t.messages) {
        lines.push(messageLine(m).split('\n').map(hardBreak).join('\n'));
        lines.push('');
      }
      lines.pop();
    } else {
      for (const m of t.messages) {
        lines.push(messageLine(m).split('\n').map(hardBreak).join('\n'));
      }
    }
    lines.push('');
    fs.writeFileSync(path.join(dir, file), lines.join('\n'), 'utf8');
    n++;
  }
  return n;
};

let contactFiles = 0;
if (BY_CONTACT) contactFiles = writeThreads(path.join(OUT, '按联系人'), allThreads.filter(t => t.messages.length >= MIN_MSGS));

let bothThreads = [];
let bothFiles = 0;
if (BOTH) {
  bothThreads = allThreads.filter(t => t.recv > 0 && t.sent > 0);
  bothFiles = writeThreads(path.join(OUT, '收发都有'), bothThreads);
  writeCsv(path.join(OUT, '收发都有.csv'), bothThreads);
}

// ---------------- 报告 ----------------
const dirStat = { 收: 0, 发: 0 };
let minTs = Infinity, maxTs = 0;
for (const t of allThreads) {
  for (const m of t.messages) {
    const d = direction(m);
    if (dirStat[d] != null) dirStat[d]++;
    const ts = Number(m.senddate || m.occurdate) || 0;
    if (ts) { minTs = Math.min(minTs, ts); maxTs = Math.max(maxTs, ts); }
  }
}
const top = [...allThreads].sort((a, b) => b.messages.length - a.messages.length).slice(0, 15);
const report = [];
report.push('# 魅族云短信导出报告');
report.push('');
report.push('- 源：https://cloud.flyme.cn/browser/sms-list.jsp');
report.push('- 导出时间：' + fmtTime(Date.now()));
report.push('- 输入文件：' + inputFiles + ' 个（' + INPUTS.map(f => path.basename(f)).join('、') + '）');
report.push('- 会话数：' + allThreads.length);
report.push('- 消息数：' + msgCount + '（收 ' + dirStat.收 + ' / 发 ' + dirStat.发 + '）');
report.push('- CSV 数据行：' + totalRows);
if (minTs !== Infinity) report.push('- 时间范围：' + fmtTime(minTs) + ' ～ ' + fmtTime(maxTs));
report.push('');
report.push('## 会话构成');
report.push('');
const onlyRecv = allThreads.filter(t => t.recv > 0 && t.sent === 0).length;
const onlySent = allThreads.filter(t => t.sent > 0 && t.recv === 0).length;
report.push('| 类型 | 会话数 |');
report.push('| --- | --- |');
report.push('| 收 + 发都有 | ' + bothThreads.length + (BOTH ? '' : '（未生成目录，加 --both）') + ' |');
report.push('| 只有收 | ' + onlyRecv + ' |');
report.push('| 只有发 | ' + onlySent + ' |');
if (BOTH) report.push('');
if (BOTH) report.push('收发都有的 ' + bothThreads.length + ' 个会话已导出到 `收发都有/`（' + bothFiles + ' 个 md）和 `收发都有.csv`。');
report.push('');
report.push('## 文件夹（type）对照');
report.push('');
report.push('| type | 接口报的会话数 | 实际抓到 |');
report.push('| --- | --- | --- |');
for (const [t, v] of [...folderStat.entries()].sort()) report.push('| ' + t + ' | ' + v.count + ' | ' + v.fetched + ' |');
report.push('');
report.push('去重说明：接口的 `type=0/2/4/5` 返回的是同一批会话（号码集合完全一致，消息也一致），`type=3` 是另一批。抓取时按 `type+号码` 记录，所以原始会话记录数大于实际会话数；输出已按号码合并，同一条消息只保留一次（按 uuId 去重）。');
if (BY_CONTACT) report.push('按联系人的 md 只导出消息数 ≥ ' + MIN_MSGS + ' 的会话，共 ' + contactFiles + ' 个。');
report.push('');
report.push('## 消息最多的会话');
report.push('');
report.push('| 名称 | 号码 | 条数 | 收 / 发 | 时间范围 |');
report.push('| --- | --- | --- | --- | --- |');
for (const t of top) {
  const a = fmtTime(t.messages[0].senddate || t.messages[0].occurdate);
  const b = fmtTime(t.messages[t.messages.length - 1].senddate || t.messages[t.messages.length - 1].occurdate);
  report.push('| ' + (t.name || '').replace(/\|/g, '\\|') + ' | ' + t.contact + ' | ' + t.messages.length +
    ' | ' + t.recv + ' / ' + t.sent + ' | ' + a + ' ～ ' + b + ' |');
}
report.push('');
report.push('说明：方向（收/发）按接口字段 `type` 推断——1 判为收件、2 判为发件，样本核对一致。原始字段保留在 `短信原始.json` 里，如有出入以原始数据为准。');
fs.writeFileSync(path.join(OUT, '_导出报告.md'), report.join('\n') + '\n', 'utf8');

console.log('会话 ' + allThreads.length + '，消息 ' + msgCount + '；CSV 行 ' + totalRows);
if (BY_CONTACT) console.log('按联系人：' + contactFiles + ' 个 md');
if (BOTH) console.log('收发都有：' + bothThreads.length + ' 个会话 -> 收发都有/（' + bothFiles + ' 个 md）+ 收发都有.csv');
console.log('输出目录：' + path.resolve(OUT));

// ---------------- README（重跑会覆盖，所以由脚本生成）----------------
const br = LINE_BREAK === 'space' ? '␠␠（行尾两个空格）' : LINE_BREAK === 'br' ? '<br>' : LINE_BREAK;
const readme = [
  '# 魅族云短信备份',
  '',
  '来源：https://cloud.flyme.cn/browser/sms-list.jsp',
  '',
  '## 数量',
  '',
  '- 会话 ' + allThreads.length + ' 个，消息 ' + msgCount + ' 条（收 ' + dirStat.收 + ' / 发 ' + dirStat.发 + '）',
  '- 收 + 发都有 ' + bothThreads.length + ' 个，只有收 ' + onlyRecv + ' 个，只有发 ' + onlySent + ' 个',
  ...(minTs !== Infinity ? ['- 时间范围 ' + fmtTime(minTs) + ' ～ ' + fmtTime(maxTs)] : []),
  '- 无彩信（`photo_type` 全为 0），没有图片要另外下载',
  '',
  '## 文件说明',
  '',
  '| 文件 | 内容 |',
  '| --- | --- |',
  '| `全部短信.csv` | ' + totalRows + ' 行，一行一条。列：发送时间 / 方向 / 对方号码 / 对方名称 / 文件夹 / 正文 / uuid。带 BOM，Excel、WPS 直接打开不乱码 |',
  '| `短信原始.json` | 去重后的完整数据，字段最全（含 smsStatus、protocol、photo_type 等） |',
  ...(BY_CONTACT ? ['| `按联系人/*.md` | 消息数 ≥ ' + MIN_MSGS + ' 的 ' + contactFiles + ' 个会话，一个会话一个文件，时间正序 |'] : []),
  ...(BOTH ? ['| `收发都有/*.md` | 只有「收 + 发都有」的 ' + bothThreads.length + ' 个会话，' + bothFiles + ' 个文件 |'] : []),
  ...(BOTH ? ['| `收发都有.csv` | 上面那批会话的 CSV 子集 |'] : []),
  '| `_导出报告.md` | 统计、会话构成、文件夹对照 |',
  '',
  '## md 的时间轴格式',
  '',
  '每行一条消息，收/发顶格，正文里的换行缩进两格续写：',
  '',
  '```',
  '收 2014-07-24 04:58:43 晚上一起吃饭吗' + br,
  '发 2014-07-24 05:20:15 好，六点到' + br,
  '发 2020-04-04 10:17:04 到楼下了，下来开门' + br,
  '  顺便把伞带上' + br,
  '```',
  '',
  '行尾加了硬换行标记，原因：标准 Markdown 会把段落里的单个换行当空格，不加的话很多查看器里所有消息会挤成一整段。加了之后在 Obsidian（严格换行开或关）、VSCode 预览、GitHub 上都正常换行。',
  '',
  'frontmatter 里有 `contact / name / messages / received / sent / first / last`。',
  '',
  '## 关于 type 字段',
  '',
  '接口的 `type=0/2/4/5` 返回的是同一批会话（号码集合和消息都一致），`type=3` 是另一批。抓取时按 `type+号码` 记录，所以原始记录数大于实际会话数；输出已按号码合并，同一条消息只保留一次（按 uuId 去重）。',
  '',
  '## 方向怎么判断的',
  '',
  '接口字段 `type`：1 判为收件、2 判为发件。用几条收发方向明确的短信核对过一致。原始字段保留在 `短信原始.json` 里。',
  '',
  '## 重新生成',
  '',
  '```bash',
  '# 只生成 CSV + JSON + 报告',
  'node sms-convert.js sms flyme-sms-*-full.json',
  '',
  '# 按联系人 md + 收发都有目录',
  'node sms-convert.js sms flyme-sms-*-full.json --by-contact --both --min-msgs=2',
  '',
  '# 行尾风格：--line-break=space（默认）/ br / blank / keep',
  '```',
  ''
].join('\n');
fs.writeFileSync(path.join(OUT, 'README.md'), readme + '\n', 'utf8');
