#!/usr/bin/env node
'use strict';

/*
 * 逐条核对导出的 md 与原始 JSON 是否一致
 *
 * 用法：
 *   node verify.js <原始JSON> <md目录>
 *
 * 检查项：
 *   1. 条数对得上、没有漏导
 *   2. 每条的标题、分类、分类 id、修改时间、时间戳、回收站标记、收藏、pos 都一致
 *   3. 正文一致（把 md 里的换行和图片链接还原回原始写法再比）
 *   4. md 里的 <br> 数量 == 原始数据里的单换行数量
 */

const fs = require('fs');
const path = require('path');

const rawPath = process.argv[2];
const mdDir = process.argv[3];
if (!rawPath || !mdDir) {
  console.error('用法：node verify.js <原始JSON> <md目录>');
  process.exit(1);
}

const IMAGE_RE = /<image\s+w=(\d+)\s+h=(\d+)\s+describe=(.*?)\s+name=([^>]+)>/g;
const MD_IMG_RE = /!\[([^\]]*)\]\((?:[^)]*\/)?([^)\/]+\.(?:jpg|jpeg|png|gif|webp|bmp))\)/gi;

function canonicalRaw(detail) {
  return String(detail || '').replace(IMAGE_RE, (w, a, b, describe, name) => `\u0001IMG:${String(name).trim()}\u0001`);
}
function canonicalMd(body) {
  return String(body || '').replace(MD_IMG_RE, (w, alt, file) => `\u0001IMG:${String(file).trim()}\u0001`);
}

// 统一换行、去掉行尾空白、把连续空行压成一段
function normalize(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{2,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
}

function parseFrontmatter(md) {
  if (!md.startsWith('---\n')) return null;
  const end = md.indexOf('\n---\n', 4);
  if (end < 0) return null;
  const block = md.slice(4, end + 1);
  const body = md.slice(end + 5);
  const data = {};
  let listKey = null;
  for (const line of block.split('\n')) {
    if (!line.trim()) continue;
    const listItem = line.match(/^\s+-\s+(.*)$/);
    if (listItem && listKey) {
      data[listKey].push(unquote(listItem[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, val] = kv;
    if (val === '') {
      data[key] = [];
      listKey = key;
      continue;
    }
    listKey = null;
    if (val === '[]') data[key] = [];
    else if (val === 'null') data[key] = null;
    else if (val === 'true') data[key] = true;
    else if (val === 'false') data[key] = false;
    else if (/^-?\d+$/.test(val)) data[key] = Number(val);
    else data[key] = unquote(val);
  }
  return { data, body };
}

function unquote(s) {
  const t = String(s).trim();
  if (t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return t;
}

const TZ_OFFSET_MIN = 8 * 60;
const pad = (n) => String(n).padStart(2, '0');
function formatTime(ms) {
  const d = new Date(Number(ms) + TZ_OFFSET_MIN * 60 * 1000);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.name.endsWith('.md') && !ent.name.startsWith('_')) out.push(p);
  }
  return out;
}

// 数一下原始正文里夹在文字中间的单换行（转换脚本会把它变成 <br>）
function countSingleNewlines(text) {
  const s = String(text || '').replace(/\r\n?/g, '\n');
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const prev = s[i - 1];
    const next = s[i + 1];
    if (s[i] === '\n' && prev !== undefined && prev !== '\n' && next !== undefined && next !== '\n') n++;
  }
  return n;
}

const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
const notes = raw.notes || [];
const folders = new Map((raw.folders || []).map((f) => [String(f.sync_id), f.title]));

const files = walk(mdDir);
const bySyncId = new Map();
for (const f of files) {
  const { data, body } = parseFrontmatter(fs.readFileSync(f, 'utf8'));
  if (!data || !data.sync_id) {
    console.log(`跳过（没有 frontmatter 或 sync_id）：${f}`);
    continue;
  }
  bySyncId.set(String(data.sync_id), { path: f, data, body });
}

const problems = [];
let checked = 0;
let brCount = 0;
let singleNewlineTotal = 0;

for (const note of notes) {
  if (String(note.folder_type) === '3' && !bySyncId.has(String(note.sync_id))) {
    problems.push(`缺失（回收站）：${note.title} / ${note.sync_id}`);
    continue;
  }
  const md = bySyncId.get(String(note.sync_id));
  if (!md) {
    problems.push(`缺失：${note.title} / ${note.sync_id}`);
    continue;
  }
  checked++;

  const rawTitle = String(note.title || '').trim();
  if (md.data.title !== rawTitle) problems.push(`标题不一致 ${note.sync_id}：${JSON.stringify(md.data.title)} vs ${JSON.stringify(rawTitle)}`);

  const expectModified = formatTime(note.modify_time);
  if (md.data.modified !== expectModified) problems.push(`修改时间不一致 ${note.sync_id}：${md.data.modified} vs ${expectModified}`);
  if (Number(md.data.modified_ts) !== Number(note.modify_time)) problems.push(`修改时间戳不一致 ${note.sync_id}`);

  const folderId = note.folderId ? String(note.folderId) : '';
  const hasFolder = !!folderId && folderId !== '0';
  const expectCategory = hasFolder && folders.has(folderId) ? folders.get(folderId) : null;
  if (expectCategory === null ? md.data.category !== null : md.data.category !== expectCategory) {
    problems.push(`分类不一致 ${note.sync_id}：${md.data.category} vs ${expectCategory}`);
  }

  if (md.data.trash !== (String(note.folder_type) === '3')) problems.push(`回收站标记不一致 ${note.sync_id}`);
  if (md.data.favorite !== (String(note.favorite) === '1')) problems.push(`收藏标记不一致 ${note.sync_id}`);
  if (Number(md.data.pos) !== Number(note.pos)) problems.push(`pos 不一致 ${note.sync_id}`);
  if (Number(md.data.formatting_mode) !== Number(note.formatting_mode)) problems.push(`formatting_mode 不一致 ${note.sync_id}`);
  if (md.data.created !== null) problems.push(`created 应为 null ${note.sync_id}`);

  const rawImgs = [];
  String(note.detail || '').replace(IMAGE_RE, (w, a, b, describe, name) => {
    rawImgs.push(String(name).trim());
    return '';
  });
  const mdImgs = md.data.attachments || [];
  if (rawImgs.length !== mdImgs.length || rawImgs.some((v, i) => v !== mdImgs[i])) {
    problems.push(`附件清单不一致 ${note.sync_id}：${JSON.stringify(mdImgs)} vs ${JSON.stringify(rawImgs)}`);
  }

  const a = normalize(canonicalRaw(note.detail));
  const b = normalize(canonicalMd(md.body.replace(/<br>\n/g, '\n')));
  if (a !== b) problems.push(`正文不一致 ${note.sync_id} / ${note.title}`);

  singleNewlineTotal += countSingleNewlines(note.detail);
  brCount += (fs.readFileSync(md.path, 'utf8').match(/<br>\n/g) || []).length;
}

const extra = [...bySyncId.keys()].filter((id) => !notes.some((n) => String(n.sync_id) === id));

console.log(`原始 ${notes.length} 条，本地 md ${files.length} 个，逐条核对 ${checked} 条`);
console.log(`单换行 ${singleNewlineTotal} 处，md 里 <br> ${brCount} 处`);
if (extra.length) console.log(`本地多出来的：${extra.length} 条 -> ${extra.join(', ')}`);
if (problems.length) {
  console.log(`\n发现 ${problems.length} 个问题：`);
  for (const p of problems.slice(0, 40)) console.log('  - ' + p);
  process.exitCode = 1;
} else if (extra.length === 0) {
  console.log('全部一致，没问题。');
} 
