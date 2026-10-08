#!/usr/bin/env node
// 校验导出结果：条数、frontmatter、正文是否与原始 JSON 一致
'use strict';
const fs = require('fs'), path = require('path');
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3];
const notes = raw.notes;
const files = [];
(function walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})) { const p=path.join(d,e.name); if(e.isDirectory()) walk(p); else if(e.name.endsWith('.md') && !e.name.startsWith('_')) files.push(p); } })(OUT);
console.log('md 文件数:', files.length, '| 原始非删除笔记数:', notes.filter(n=>String(n.status)!=='D').length, '| 原始总数:', notes.length);

const byUuid = new Map();
for (const f of files) {
  const t = fs.readFileSync(f,'utf8');
  const m = t.match(/^uuid: "(.*)"$/m);
  if (!m) { console.log('缺 uuid:', f); continue; }
  byUuid.set(m[1], { f, t });
}
console.log('带 uuid 的 md 数:', byUuid.size);
const missing = notes.filter(n => String(n.status)!=='D' && !byUuid.has(n.uuid));
console.log('漏掉的笔记:', missing.length, missing.slice(0,3).map(n=>n.uuid));

// 与 3-convert.js 的 asDate 保持一致：空值返回空串，秒级时间戳先乘 1000
const ts = (v) => {
  if (v === undefined || v === null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(n < 1e12 ? n * 1000 : n)).replace('T',' ');
};
const tags = new Map(raw.tags.map(t=>[String(t.id), t.name]));
let bad = 0;
for (const n of notes) {
  if (String(n.status)==='D') continue;
  const rec = byUuid.get(n.uuid); if (!rec) continue;
  const fm = rec.t.slice(0, rec.t.indexOf('\n---', 4));
  // frontmatter 里的值是 YAML 双引号字符串，\" 和 \\ 要先还原，否则带引号的标题会被判成不符
  const get = (k) => {
    const m = fm.match(new RegExp('^'+k+': "(.*)"$','m'));
    return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : undefined;
  };
  // 抓取脚本落盘的字段是 createTime / modifyTime，早期样例用过 createDate / updateDate，两种都认
  const createdRaw = n.createDate != null ? n.createDate : n.createTime;
  const updatedRaw = n.updateDate != null ? n.updateDate : n.modifyTime;
  const checks = [
    ['created', get('created'), ts(createdRaw)],
    ['updated', get('updated'), ts(updatedRaw)],
    ['created_ts', get('created_ts')||Number((fm.match(/^created_ts: (\d+)$/m)||[])[1]), String(Number(createdRaw) || 0)],
    ['title', get('title'), n.title || '']
  ];
  const wantCat = ['-1',''].includes(String(n.groupStatus)) ? '' : (tags.get(String(n.groupStatus)) || String(n.groupStatus));
  const body = JSON.parse(n.body || '[]');
  const firstText = body.find(b => b && b.text);
  for (const [k, got, want] of checks) {
    if (String(got) !== String(want)) { console.log('不符', n.uuid, k, JSON.stringify(got), '!=', JSON.stringify(want)); bad++; }
  }
  if ((get('category')||'') !== wantCat) { console.log('分类不符', n.uuid, get('category'), '!=', wantCat); bad++; }
  if (firstText) {
    const strip = (x) => x.replace(/\*\*|<u>|<\/u>|~~|==|\*/g, '');
    const plainFile = strip(rec.t);
    const line = strip(firstText.text).split('\n')[0].trim();
    if (line && !plainFile.includes(line.slice(0, Math.min(12, line.length)))) { console.log('正文缺失', n.uuid, line.slice(0,30)); bad++; }
  }
}
console.log(bad === 0 ? '字段校验：全部通过' : '字段校验：' + bad + ' 处不符');

// 统计
let emptyBody = 0;
for (const [uuid, rec] of byUuid) {
  const body = rec.t.slice(rec.t.indexOf('\n---', 4) + 5).trim();
  if (!body) emptyBody++;
}
console.log('正文为空的 md:', emptyBody);
