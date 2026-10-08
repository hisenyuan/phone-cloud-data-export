# 魅族云便签导出

把 `notes.flyme.cn` 里的便签导成本地 Markdown，标题、分类、创建和修改时间写进 frontmatter。

## 跑一遍

先在已登录的便签页面里跑 `1-capture.js`，得到 `flyme-notes-raw.json`，然后：

```bash
node 3-convert.js flyme-notes-raw.json notes --by-category --line-break=space
node 4-verify.js flyme-notes-raw.json notes
```

仓库里带两个构造的样例，都不含真实数据：

- `sample-raw.json`：常规数据
- `tests/edge-raw.json`：边界情况，空正文、嵌套列表、六级标题、emoji、标题里有 `/ : "`、分类 id 对不上分类表

```bash
node 3-convert.js tests/edge-raw.json /tmp/edge --by-category && node 4-verify.js tests/edge-raw.json /tmp/edge
```

## 文件

在浏览器控制台里跑的：

- `1-capture.js`：按「全部」和每个分类各翻一遍页，按 uuid 去重，输出 `flyme-notes-raw.json`
- `2-download-attachments.js`：下载图片和附件，清单现从接口扫出来，不用手改

本地跑的：

- `3-convert.js`：原始 JSON 转 Markdown
- `4-verify.js`：逐条核对 md 与原始数据

## 转换选项

- `--by-category`：按分类分子目录
- `--include-deleted`：连回收站（`status=D`）一起导，默认跳过
- `--line-break=space|br|blank|keep`：单换行怎么落地，默认 `space`（行尾两个空格）

## 接口

都是 POST，同源带 Cookie，请求头要 `X-Requested-With: XMLHttpRequest`，返回 `{returnCode, returnMessage, returnValue}`。

- 分类列表：`/c/browser/note/gettags`
- 某个分类下的笔记：`/c/browser/note/getnotegroups`，参数 `start`、`length`、`groupUuid`，`-1` 表示全部
- 按内容搜索：`/c/browser/note/getnotebycontent`，参数 `content`、`start`、`limit`

## 报错对照

- 返回 302 带一个登录跳转地址：登录态过期，回页面重新登录
- `returnCode` 不是 200：看 `returnMessage`，多数是参数或分类 id 变了

## 正文的格式

`body` 是个 JSON 字符串，里面是按顺序排的块数组，每块有 `state`：

- `0` 段落
- `1` / `2` 待办，未完成和已完成
- `3` / `4` / `5` 图片、录音、附件
- `50` / `51` / `53` 有序列表、无序列表、列表项
- `60` 标题，级别在 `level` 里

文字样式单独放在 `span` 字段：`[{span: 样式码, start, end, param}]`，`start` 和 `end` 是字符下标。

样式码：`1` 加粗、`6` 下划线、`7` 斜体、`16` 字号、`17` 链接、`18` 删除线、`19` 高亮。

云端不少笔记自己没有标题，文件名取正文第一行代替，frontmatter 里的 `title` 保持云端原值，不编一个出来。

## 时间和换行

接口返回的字段是 `createTime` 和 `modifyTime`，都是毫秒时间戳（个别响应里叫 `createDate` / `updateDate`，转换和校验两个脚本都认）。

正文里如果有 `\r\n`，转换前会统一成 `\n`，否则残留的 `\r` 会把行切坏。
