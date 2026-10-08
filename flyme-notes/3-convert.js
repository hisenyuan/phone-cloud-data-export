#!/usr/bin/env node
/*
 * 把 1-capture.js 抓下来的原始 JSON 转成 Markdown。
 *
 * 用法：
 *   node convert.js <raw.json> <输出目录> [--by-category] [--include-deleted]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const TZ = 'Asia/Shanghai';
const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const positional = args.filter(a => !a.startsWith('--'));
const RAW = positional[0];
const OUT = positional[1];
const BY_CATEGORY = flags.has('--by-category');
const INCLUDE_DELETED = flags.has('--include-deleted');
// 单个换行怎么落到 Markdown：
//   br（默认）加 <br>，任何渲染器都保得住行
//   space 行尾加两个空格（渲染器认，但容易被编辑器/格式化去掉）
//   blank 换成空行，每行独立成段
//   keep  原样保留（Obsidian 关掉「严格换行」时也是对的，但多数渲染器会并成一段）
const LINE_BREAK = (args.find(a => a.startsWith('--line-break=')) || '').split('=')[1] || 'br';
if (!['br', 'space', 'blank', 'keep'].includes(LINE_BREAK)) {
  console.error('--line-break 只支持 br / space / blank / keep');
  process.exit(1);
}

if (!RAW || !OUT) {
  console.error('用法: node convert.js <raw.json> <输出目录> [--by-category] [--include-deleted]');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(RAW, 'utf8'));
const notes = raw.notes || [];
const tags = raw.tags || [];
const tagName = new Map(tags.map(t => [String(t.id), t.name]));
// 云端把「未分类」也在分类表里叫「全部」，导出时当作未分类处理
const UNCATEGORIZED = new Set(['-1', '']);

const listImages = () => {
  const dir = path.join(OUT, 'attachments');
  try { return new Set(fs.readdirSync(dir)); } catch (e) { return new Set(); }
};
let localAttachments = null;

const attachmentHref = (name, url) => {
  if (!localAttachments) localAttachments = listImages();
  if (name && localAttachments.has(name)) return 'attachments/' + encodeURI(name).replace(/#/g, '%23');
  return url || '';
};

const now = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
}).format(new Date()).replace('T', ' ');

const asDate = (v) => {
  if (v === undefined || v === null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n < 1e12 ? n * 1000 : n);
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(d).replace('T', ' ');
};

const parseJson = (s, fallback) => {
  if (!s) return fallback;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch (e) { return fallback; }
};

// ---------------- 内联样式 ----------------
// span 是一段 JSON 字符串：[{span: 样式码, start, end, param}]
// 1 加粗 6 下划线 7 斜体 16 字号 17 链接 18 删除线 19 高亮
function renderInline(text, spanStr) {
  const s = text == null ? '' : String(text);
  if (!s) return '';
  const spans = parseJson(spanStr, []);
  if (!Array.isArray(spans) || spans.length === 0) return s;

  const sets = new Array(s.length);
  const hrefs = new Array(s.length).fill('');
  for (const sp of spans) {
    if (!sp || typeof sp !== 'object') continue;
    const start = Math.max(0, Number(sp.start) || 0);
    const end = Math.min(s.length, Number(sp.end) || 0);
    for (let i = start; i < end; i++) {
      if (!sets[i]) sets[i] = new Set();
      sets[i].add(Number(sp.span));
      if (Number(sp.span) === 17) hrefs[i] = sp.param || '';
    }
  }

  const runs = [];
  let i = 0;
  while (i < s.length) {
    const sig = sets[i] ? [...sets[i]].sort((a, b) => a - b).join(',') : '';
    const href = hrefs[i] || '';
    let j = i + 1;
    while (j < s.length) {
      const sig2 = sets[j] ? [...sets[j]].sort((a, b) => a - b).join(',') : '';
      if (sig2 !== sig || (hrefs[j] || '') !== href) break;
      j++;
    }
    let chunk = s.slice(i, j);
    if (chunk.trim()) {
      const codes = sig ? sig.split(',').map(Number) : [];
      if (codes.includes(19)) chunk = '==' + chunk + '==';
      if (codes.includes(6)) chunk = '<u>' + chunk + '</u>';
      if (codes.includes(18)) chunk = '~~' + chunk + '~~';
      if (codes.includes(7)) chunk = '*' + chunk + '*';
      if (codes.includes(1)) chunk = '**' + chunk + '**';
      if (href) chunk = '[' + chunk + '](' + href + ')';
    }
    runs.push(chunk);
    i = j;
  }
  return runs.join('');
}

// 正文里的换行是原样保留的。为了防止「- 」「1. 」「# 」这类行首被当成语法，
// 行首的 Markdown 标记加反斜杠转义。
function escapeLineStarts(text) {
  return String(text).split('\n').map(line => {
    if (/^\s*([-+*>#]|\d+[.)])\s/.test(line) || /^\s*(-{3,}|={3,})\s*$/.test(line)) {
      return line.replace(/^(\s*)/, '$1\\');
    }
    return line;
  }).join('\n');
}

const paraText = (text, span) => applyLineBreaks(escapeLineStarts(renderInline(text, span)));
const itemText = (text, span) => applyLineBreaks(escapeAfterFirstLine(renderInline(text, span)));

const escapeAfterFirstLine = (s) => {
  const parts = String(s).split('\n');
  if (parts.length === 1) return String(s);
  return parts[0] + '\n' + escapeLineStarts(parts.slice(1).join('\n'));
};

// 把正文里的单个换行变成渲染器认的硬换行，空行仍然当段落分隔
function applyLineBreaks(text) {
  // 统一换行符，避免残留的 \r 把行切坏
  text = String(text).replace(/\r\n?/g, '\n');
  if (LINE_BREAK === 'keep') return text;
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    const next = lines[i + 1];
    if (cur === '') { out.push(''); continue; }
    if (next === undefined || next === '') { out.push(cur); continue; }
    if (LINE_BREAK === 'br') out.push(cur + '<br>');
    else if (LINE_BREAK === 'space') out.push(cur + '  ');
    else out.push(cur, '');
  }
  return out.join('\n');
}

// ---------------- 正文块 ----------------
// state: 0 段落 1/2 待办 3 图片 4 录音 5 文件 50 有序列表 51 无序列表 53 列表项 60 标题
const unknownStates = new Map();

function renderItems(items, indent, ctx) {
  const out = [];
  const pad = '  '.repeat(indent);
  let idx = 0;
  while (idx < (items || []).length) {
    const it = items[idx];
    if (!it || typeof it !== 'object') { idx++; continue; }
    switch (it.state) {
      case 0:
        out.push({ type: 'para', text: paraText(it.text, it.span) });
        idx++;
        break;
      case 1:
      case 2: {
        while (idx < items.length && (items[idx].state === 1 || items[idx].state === 2)) {
          const t = items[idx];
          out.push({ type: 'list', text: pad + '- [' + (t.state === 2 ? 'x' : ' ') + '] ' + itemText(t.text, t.span) });
          idx++;
        }
        break;
      }
      case 3:
        out.push({ type: 'media', text: pad + '![' + (it.name || '图片') + '](' + attachmentHref(it.name, ctx.files[it.name]) + ')' });
        idx++;
        break;
      case 4:
        out.push({ type: 'media', text: pad + '[录音: ' + (it.name || '') + '](' + attachmentHref(it.name, ctx.files[it.name]) + ')' });
        idx++;
        break;
      case 5:
        out.push({ type: 'media', text: pad + '[附件: ' + (it.name || '') + '](' + attachmentHref(it.name, ctx.files[it.name]) + ')' });
        idx++;
        break;
      case 60: {
        const level = Math.min(6, Math.max(1, Number(it.level) || 1));
        out.push({ type: 'heading', text: '#'.repeat(level) + ' ' + itemText(it.text, it.span).replace(/<br>\n/g, ' ') });
        idx++;
        break;
      }
      case 50:
      case 51: {
        const ordered = it.state === 50;
        let n = 1;
        for (const li of it.children || []) {
          const kids = li && li.state === 53 ? (li.children || []) : [li];
          let first = true;
          for (const k of kids) {
            if (!k || typeof k !== 'object') continue;
            if (k.state === 0) {
              const bullet = first ? (ordered ? (n++) + '. ' : '- ') : '  ';
              out.push({ type: 'list', text: pad + bullet + itemText(k.text, k.span) });
              first = false;
            } else if (k.state === 50 || k.state === 51) {
              out.push(...renderItems([k], indent + 1, ctx));
              first = false;
            } else if (k.state === 1 || k.state === 2) {
              out.push({ type: 'list', text: pad + '- [' + (k.state === 2 ? 'x' : ' ') + '] ' + itemText(k.text, k.span) });
              first = false;
            } else if (k.state === 3 || k.state === 4 || k.state === 5) {
              out.push(...renderItems([k], indent + 1, ctx));
              first = false;
            } else if (k.state === 60) {
              out.push(...renderItems([k], indent + 1, ctx));
              first = false;
            } else if (k.text) {
              out.push({ type: 'list', text: pad + '  ' + itemText(k.text, k.span) });
            }
          }
          if (first) n++;
        }
        idx++;
        break;
      }
      default:
        unknownStates.set(it.state, (unknownStates.get(it.state) || 0) + 1);
        if (it.text) out.push({ type: 'para', text: renderInline(it.text, it.span) });
        idx++;
    }
  }
  return out;
}

function blocksToMarkdown(items, ctx) {
  const out = renderItems(items, 0, ctx);
  const lines = [];
  let prev = null;
  for (const b of out) {
    if (lines.length > 0 && !(b.type === 'list' && prev === 'list')) lines.push('');
    lines.push(b.text);
    prev = b.type;
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------- frontmatter / 文件名 ----------------
function yamlStr(v) {
  const s = v == null ? '' : String(v);
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"';
}

function safeName(s, max = 80) {
  let t = String(s == null ? '' : s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
  t = t.replace(/^\.+/, '').replace(/\.+$/, '');
  if (t.length > max) t = t.slice(0, max).trim();
  return t;
}

function firstLineText(bodyStr) {
  const arr = parseJson(bodyStr, []);
  if (!Array.isArray(arr)) return '';
  const walk = (items) => {
    for (const it of items || []) {
      if (!it || typeof it !== 'object') continue;
      if (it.text && String(it.text).trim()) return String(it.text).trim();
      if (it.children) {
        const r = walk(it.children);
        if (r) return r;
      }
    }
    return '';
  };
  return walk(arr).split('\n')[0];
}

// ---------------- 主流程 ----------------
const stat = { total: notes.length, written: 0, skippedDeleted: 0, noBody: 0, byCategory: new Map() };
const used = new Set();
const written = [];
const attachmentRows = [];

for (const note of notes) {
  if (!note || typeof note !== 'object') continue;
  if (!INCLUDE_DELETED && String(note.status) === 'D') { stat.skippedDeleted++; continue; }

  const categoryId = note.groupStatus != null ? note.groupStatus : (note.groupUuid != null ? note.groupUuid : note.tag);
  const isUncategorized = UNCATEGORIZED.has(String(categoryId));
  const category = isUncategorized ? '' : (tagName.get(String(categoryId)) || String(categoryId == null ? '' : categoryId));
  const bodyItems = parseJson(note.body, []);
  if (!Array.isArray(bodyItems) || bodyItems.length === 0) stat.noBody++;
  const bodyMd = Array.isArray(bodyItems) && bodyItems.length ? blocksToMarkdown(bodyItems, { files: note.files || {} }) : '';

  const createdRaw = note.createDate != null ? note.createDate : note.createTime;
  const updatedRaw = note.updateDate != null ? note.updateDate : note.modifyTime;
  const created = asDate(createdRaw);
  const updated = asDate(updatedRaw);
  const title = (note.title && String(note.title).trim()) || '';
  const fallbackTitle = firstLineText(note.body).slice(0, 30);
  const displayTitle = String(title || fallbackTitle || '无标题').replace(/\s+/g, ' ').trim();

  const fm = [
    '---',
    'title: ' + yamlStr(title),
    'uuid: ' + yamlStr(note.uuid),
    'category: ' + yamlStr(category),
    'category_id: ' + yamlStr(categoryId),
    'created: ' + yamlStr(created),
    'updated: ' + yamlStr(updated),
    'created_ts: ' + (Number(createdRaw) || 0),
    'updated_ts: ' + (Number(updatedRaw) || 0),
    'status: ' + yamlStr(note.status),
    'pinned: ' + (Number(note.topdate) ? 'true' : 'false'),
    'remind: ' + yamlStr(typeof note.remind === 'string' ? note.remind : (note.remind ? JSON.stringify(note.remind) : '')),
    'font_size: ' + (Number(note.fontSize) || 0),
    'attachments: ' + (note.files && Object.keys(note.files).length ? '\n' + Object.keys(note.files).map(k => '  - ' + yamlStr(k)).join('\n') : '[]'),
    'source: ' + yamlStr('https://notes.flyme.cn/notes'),
    'exported_at: ' + yamlStr(raw.exportedAt || now()),
    '---'
  ].join('\n');

  const datePart = created ? created.slice(0, 10) : '0000-00-00';
  const base = safeName(datePart + ' ' + displayTitle) || ('note-' + safeName(note.uuid));
  let filename = base + '.md';
  let k = 2;
  const folderName = category ? safeName(category) : '未分类';
  while (used.has((BY_CATEGORY ? folderName + '/' : '') + filename.toLowerCase())) {
    filename = base + ' (' + k + ').md';
    k++;
  }
  used.add((BY_CATEGORY ? folderName + '/' : '') + filename.toLowerCase());

  const dir = BY_CATEGORY ? path.join(OUT, folderName) : OUT;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, filename);
  fs.writeFileSync(file, fm + '\n\n' + bodyMd + '\n', 'utf8');

  stat.written++;
  const key = BY_CATEGORY ? folderName : '(未分类)';
  stat.byCategory.set(key, (stat.byCategory.get(key) || 0) + 1);
  written.push({ file: path.relative(OUT, file), title: displayTitle, category, created, uuid: note.uuid });

  for (const [name, url] of Object.entries(note.files || {})) {
    attachmentRows.push([name, url, note.uuid, displayTitle]);
  }
}

// ---------------- 报告 ----------------
const report = [];
report.push('# 魅族便签导出报告');
report.push('');
report.push('- 原始文件: `' + path.basename(RAW) + '`');
report.push('- 导出时间: ' + now());
report.push('- 源: https://notes.flyme.cn/notes');
report.push('- 原始笔记数: ' + stat.total);
report.push('- 已写出 Markdown: ' + stat.written);
report.push('- 跳过（回收站，status=D）: ' + stat.skippedDeleted);
report.push('- 正文为空的笔记: ' + stat.noBody);
report.push('- 分类数: ' + tags.length);
if (unknownStates.size) {
  report.push('- 未识别的块类型（可能是新格式，需要补转换规则）: ' +
    [...unknownStates.entries()].map(([k, v]) => k + ' x' + v).join(', '));
}
report.push('');
report.push('## 分类');
report.push('');
report.push('| 分类 | id | 云端条数 | 本地导出 |');
report.push('| --- | --- | --- | --- |');
report.push('| （未分类） | -1 | ' + (((tags.find(t => String(t.id) === '-1') || {}).count) != null ? tags.find(t => String(t.id) === '-1').count : '') + ' | ' + written.filter(w => !w.category).length + ' |');
for (const t of tags) {
  if (String(t.id) === '-1') continue;
  const n = [...written].filter(w => String(w.category) === String(t.name)).length;
  report.push('| ' + t.name + ' | ' + t.id + ' | ' + (t.count != null ? t.count : '') + ' | ' + n + ' |');
}
report.push('');
report.push('## 笔记清单');
report.push('');
report.push('| 创建时间 | 分类 | 标题 | 文件 |');
report.push('| --- | --- | --- | --- |');
for (const w of written) {
  report.push('| ' + w.created + ' | ' + w.category + ' | ' + String(w.title).replace(/\|/g, '\\|') + ' | `' + w.file + '` |');
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, '_导出报告.md'), report.join('\n') + '\n', 'utf8');

if (attachmentRows.length) {
  const tsv = ['文件名\t云端地址\t笔记 uuid\t笔记标题']
    .concat(attachmentRows.map(r => r.map(v => String(v == null ? '' : v).replace(/\t/g, ' ')).join('\t')))
    .join('\n');
  fs.writeFileSync(path.join(OUT, '_附件清单.tsv'), tsv + '\n', 'utf8');
}

console.log('原始 ' + stat.total + ' 条 -> 写出 ' + stat.written + ' 个 md；跳过回收站 ' + stat.skippedDeleted + '；空正文 ' + stat.noBody);
if (attachmentRows.length) console.log('附件/图片 ' + attachmentRows.length + ' 个，已写入 _附件清单.tsv');
if (unknownStates.size) console.log('未识别块类型: ' + [...unknownStates.entries()].map(([k, v]) => k + 'x' + v).join(', '));
console.log('输出目录: ' + path.resolve(OUT));
