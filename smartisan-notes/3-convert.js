#!/usr/bin/env node
'use strict';

/*
 * 锤子便签原始数据 -> 本地 Markdown
 *
 * 用法：
 *   node convert.js <原始JSON> <输出目录> [选项]
 *
 * 选项：
 *   --by-category     按分类分子目录（默认）
 *   --flat            全部平铺在一个目录
 *   --include-trash   连回收站一起导出（默认）
 *   --skip-trash      跳过回收站
 *   --line-break=br|space|blank|keep   单换行怎么处理（默认 br）
 *   --image-mode=local|cloud|keep      图片怎么写（默认 local）
 *
 * 例：
 *   node convert.js smartisan-notes-raw.json notes --by-category
 */

const fs = require('fs');
const path = require('path');

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const flags = argv.filter((a) => a.startsWith('--'));

const rawPath = positional[0];
const outDir = positional[1] || 'notes';
if (!rawPath) {
  console.error('用法：node convert.js <原始JSON> <输出目录> [--flat] [--skip-trash] [--line-break=br]');
  process.exit(1);
}

const opts = {
  byCategory: !flags.includes('--flat'),
  includeTrash: !flags.includes('--skip-trash'),
  lineBreak: (flags.find((f) => f.startsWith('--line-break=')) || '').split('=')[1] || 'br',
  imageMode: (flags.find((f) => f.startsWith('--image-mode=')) || '').split('=')[1] || 'local',
};

// ---------- 工具 ----------
// 便签用的是上海时间；中国 2017 年以后没有夏令时，固定 +08:00
const TZ_OFFSET_MIN = 8 * 60;

const pad = (n) => String(n).padStart(2, '0');

function formatTime(ms) {
  const d = new Date(Number(ms) + TZ_OFFSET_MIN * 60 * 1000);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

const dateOnly = (ms) => formatTime(ms).slice(0, 10);

// YAML 双引号字符串
function yamlStr(v) {
  if (v === null || v === undefined) return 'null';
  return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// 文件名里不能出现的字符
function safeName(s, maxLen = 80) {
  let name = String(s || '')
    .replace(/[\/\\:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (name.length > maxLen) name = name.slice(0, maxLen).trim();
  return name || '无标题';
}

// 云端图片标记：<image w=宽 h=高 describe=描述 name=文件名>
const IMAGE_RE = /<image\s+w=(\d+)\s+h=(\d+)\s+describe=(.*?)\s+name=([^>]+)>/g;

function extractImages(detail) {
  const list = [];
  String(detail || '').replace(IMAGE_RE, (whole, w, h, describe, name) => {
    list.push({ name: String(name).trim(), describe: String(describe || '').trim(), width: +w, height: +h });
    return whole;
  });
  return list;
}

function convertBody(detail, relPrefix) {
  let text = String(detail || '');

  if (opts.imageMode !== 'keep') {
    text = text.replace(IMAGE_RE, (whole, w, h, describe, name) => {
      const alt = String(describe || '').trim();
      const file = String(name).trim();
      if (opts.imageMode === 'cloud') {
        return `![${alt}](https://yun.smartisan.com/apps/note/notesimage/${file})`;
      }
      return `![${alt}](${relPrefix}${file})`;
    });
  }

  // 单换行 vs 空行
  if (opts.lineBreak !== 'keep') {
    text = text.replace(/\r\n?/g, '\n');
    // 只处理夹在文字中间的单换行；首尾和空行原样保留
    if (opts.lineBreak === 'br') {
      text = text.replace(/([^\n])\n(?=[^\n])/g, '$1<br>\n');
    } else if (opts.lineBreak === 'space') {
      text = text.replace(/([^\n])\n(?=[^\n])/g, '$1  \n');
    } else if (opts.lineBreak === 'blank') {
      text = text.replace(/([^\n])\n(?=[^\n])/g, '$1\n\n');
    }
  }

  return text.replace(/\s+$/, '') + '\n';
}

// ---------- 读数据 ----------
const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
const notes = raw.notes || [];
const folders = raw.folders || [];

const folderById = new Map();
for (const f of folders) folderById.set(String(f.sync_id), f.title);

const TRASH = '3';

// ---------- 输出目录 ----------
if (fs.existsSync(outDir)) {
  // 只清掉以前生成的 md，别动用户自己放进去的东西
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== 'attachments' && ent.name !== 'notesimage') walk(p);
      } else if (ent.name.endsWith('.md') || ent.name.endsWith('.tsv')) {
        fs.unlinkSync(p);
      }
    }
  };
  walk(outDir);
} else {
  fs.mkdirSync(outDir, { recursive: true });
}

// ---------- 逐条转换 ----------
const stats = {
  total: notes.length,
  written: 0,
  skippedTrash: 0,
  emptyFolder: 0,
  missingFolder: 0,
  byCategory: new Map(),
  images: [],
  usedNames: new Set(),
};

const indexRows = [];

// 按修改时间排序，写文件和报告都按时间顺序
const sorted = notes.slice().sort((a, b) => Number(a.modify_time) - Number(b.modify_time));

for (const note of sorted) {
  const isTrash = String(note.folder_type) === TRASH;
  if (isTrash && !opts.includeTrash) {
    stats.skippedTrash++;
    continue;
  }

  const title = String(note.title || '').trim();
  const folderId = note.folderId ? String(note.folderId) : '';
  let category = null;
  let categoryDir = '未分类';

  // folderId 为 "" 或 "0" 表示没有归到任何分类
  const hasFolder = !!folderId && folderId !== '0';

  if (isTrash) {
    categoryDir = '回收站';
    if (hasFolder && folderById.has(folderId)) category = folderById.get(folderId);
  } else if (hasFolder && folderById.has(folderId)) {
    category = folderById.get(folderId);
    categoryDir = safeName(category);
  } else if (hasFolder) {
    // 引用了已删除或未返回的分类：不编造名字，但 id 留在 frontmatter 里
    stats.missingFolder++;
  } else {
    stats.emptyFolder++;
  }

  const dir = opts.byCategory ? path.join(outDir, categoryDir) : outDir;
  fs.mkdirSync(dir, { recursive: true });
  const relPrefix = opts.byCategory ? '../attachments/' : 'attachments/';

  const images = extractImages(note.detail);
  for (const img of images) stats.images.push({ ...img, title, sync_id: note.sync_id });

  const base = `${dateOnly(note.modify_time)} ${safeName(title)}`;
  let fileName = `${base}.md`;
  let n = 2;
  while (stats.usedNames.has(path.join(dir, fileName))) {
    fileName = `${base} -${n}.md`;
    n++;
  }
  stats.usedNames.add(path.join(dir, fileName));

  const fm = [
    '---',
    `title: ${yamlStr(title)}`,
    `sync_id: ${yamlStr(note.sync_id)}`,
    `seqid: ${yamlStr(note.seqid)}`,
    `eseqid: ${yamlStr(note.eseqid)}`,
    `category: ${category === null ? 'null' : yamlStr(category)}`,
    `category_id: ${folderId ? yamlStr(folderId) : 'null'}`,
    `folder_type: ${note.folder_type === undefined ? 'null' : note.folder_type}`,
    `trash: ${isTrash}`,
    `favorite: ${String(note.favorite) === '1'}`,
    // 云端接口不返回创建时间，这里如实写 null，不用修改时间顶替
    'created: null',
    'created_ts: null',
    `modified: ${yamlStr(formatTime(note.modify_time))}`,
    `modified_ts: ${Number(note.modify_time)}`,
    `pos: ${note.pos === undefined ? 'null' : note.pos}`,
    `formatting_mode: ${note.formatting_mode === undefined ? 'null' : note.formatting_mode}`,
    'attachments:',
    ...(images.length ? images.map((i) => `  - ${yamlStr(i.name)}`) : ['  []']),
    `source: ${yamlStr(raw.source || 'https://yun.smartisan.com/?from=snote#/notes')}`,
    `exported_at: ${yamlStr(raw.exported_at || new Date().toISOString())}`,
    '---',
    '',
  ].join('\n');

  const body = convertBody(note.detail, relPrefix);
  fs.writeFileSync(path.join(dir, fileName), fm + body, 'utf8');

  stats.written++;
  stats.byCategory.set(categoryDir, (stats.byCategory.get(categoryDir) || 0) + 1);
  indexRows.push({
    dir: path.relative(outDir, dir) || '.',
    file: fileName,
    title,
    sync_id: note.sync_id,
    category,
    isTrash,
    modified: formatTime(note.modify_time),
    modifiedTs: Number(note.modify_time),
  });
}

// ---------- 附件清单 ----------
if (stats.images.length) {
  const lines = ['文件名\t所属便签\tsync_id\t云端地址'];
  for (const img of stats.images) {
    lines.push(
      `${img.name}\t${img.title.replace(/\t/g, ' ')}\t${img.sync_id}\thttps://yun.smartisan.com/apps/note/notesimage/${img.name}`
    );
  }
  fs.writeFileSync(path.join(outDir, '_附件清单.tsv'), lines.join('\n') + '\n', 'utf8');
}

// ---------- 导出报告 ----------
const byDate = indexRows.slice().sort((a, b) => a.modifiedTs - b.modifiedTs);
const report = [];
report.push('# 锤子便签导出报告');
report.push('');
report.push(`- 导出时间：${raw.exported_at || new Date().toISOString()}`);
report.push(`- 云端便签总数：${stats.total} 条`);
report.push(`- 本地写出：${stats.written} 个 md`);
if (stats.skippedTrash) report.push(`- 跳过回收站：${stats.skippedTrash} 条（加了 --skip-trash）`);
report.push(`- 时间跨度：${byDate[0] ? byDate[0].modified : '-'} ~ ${byDate[byDate.length - 1] ? byDate[byDate.length - 1].modified : '-'}（按修改时间）`);
report.push(`- 附件/图片：${stats.images.length} 个`);
report.push('');
report.push('> **关于「创建时间」**：欢喜云网页版接口（`v2/getList`）只返回修改时间 `modify_time`，不返回创建时间。');
report.push('> 全部 370 条便签的返回字段里都没有 `create_time` 一类的字段，所以 frontmatter 里的 `created` 一律写 `null`。');
report.push('> 没有拿修改时间去冒充创建时间，也没有用 `seqid`、`pos` 去反推——那些字段推不出可信的创建时间。');
report.push('');
report.push('## 分类对照');
report.push('');
report.push('| 目录 | 条数 |');
report.push('| --- | --- |');
for (const [k, v] of [...stats.byCategory.entries()].sort((a, b) => b[1] - a[1])) {
  report.push(`| ${k} | ${v} |`);
}
report.push('');
report.push('说明：');
report.push(`- 云端共 ${folders.length} 个分类：${folders.map((f) => f.title).join('、')}`);
report.push(`- 没有归到任何分类的便签 ${stats.emptyFolder} 条，进「未分类」`);
if (stats.missingFolder) {
  report.push(`- 另有 ${stats.missingFolder} 条指向云端已不存在（或未返回）的分类，也进「未分类」，原始 id 留在 frontmatter 的 \`category_id\` 里`);
}
report.push(`- 回收站 ${indexRows.filter((r) => r.isTrash).length} 条，单独放「回收站」目录`);
report.push('');
report.push('## 全部便签清单');
report.push('');
report.push('| 修改时间 | 分类 | 标题 | 文件 |');
report.push('| --- | --- | --- | --- |');
for (const r of byDate) {
  const cat = r.isTrash ? '回收站' : r.category || '未分类';
  report.push(`| ${r.modified} | ${cat} | ${r.title.replace(/\|/g, '\\|')} | ${path.join(r.dir, r.file)} |`);
}
report.push('');
fs.writeFileSync(path.join(outDir, '_导出报告.md'), report.join('\n'), 'utf8');

console.log(`写出 ${stats.written} 个 md -> ${outDir}`);
console.log(`回收站 ${indexRows.filter((r) => r.isTrash).length} 条，未分类 ${stats.emptyFolder + stats.missingFolder} 条，图片 ${stats.images.length} 个`);
console.log('分类分布：', [...stats.byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('，'));
