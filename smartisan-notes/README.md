# 锤子便签导出（欢喜云）

把 `yun.smartisan.com` 里的锤子便签导成本地 Markdown，标题、分类、时间等元信息写进 frontmatter。

## 跑一遍

先在已登录的便签页面里跑 `1-capture.js`，得到 `smartisan-notes-raw.json`，然后：

```bash
node 3-convert.js smartisan-notes-raw.json notes --by-category
node 4-verify.js smartisan-notes-raw.json notes
```

拿 `sample-raw.json` 也能跑，不含真实数据：

```bash
node 3-convert.js sample-raw.json /tmp/out && node 4-verify.js sample-raw.json /tmp/out
```

## 文件

在浏览器控制台里跑的：

- `1-capture.js`：抓全部便签，输出 `smartisan-notes-raw.json`
- `2-download-images.js`：下载便签里的图片。文件名现从接口扫出来，不用手改清单
- `5-delete.js`：批量删云端便签。默认 `DRY_RUN = true`，只打印；支持 `trash` / `purge` / `restore` 三种模式

本地跑的：

- `3-convert.js`：原始 JSON 转 Markdown
- `4-verify.js`：逐条核对 md 与原始数据

## 转换选项

```bash
node 3-convert.js smartisan-notes-raw.json notes \
  --by-category \        # 按分类分子目录（默认）
  --include-trash \      # 连回收站一起导（默认）
  --line-break=br \      # 单换行怎么处理：br（默认）/ space / blank / keep
  --image-mode=local     # 图片怎么写：local（默认，指向 attachments/）/ cloud / keep
```

## 接口

都挂在 `https://yun.smartisan.com/apps/note/index.php` 下，用查询参数 `r=` 指定动作，同源带 Cookie，统一返回 `{code, data}`。

- 登录态：`r=account/login`
- 分类列表：`r=folder/getList`
- 便签列表：`r=v2/getList`，参数 `page`、`page_size`
- 移到回收站：`POST r=note/updateFolder`，`sync_ids`、`folder_type=3`
- 彻底删除：`POST r=note/deleteAll`，`sync_ids` 逗号拼接

## 报错对照

- `code 1701`：没登录，或 Cookie 过期。回页面刷新确认能看到便签列表
- `{"code":1,"errInfo":{"2109":"便签web标签错误"}}`：写请求没带 `tab_id`。前端每次加载页面随机生成一个 8 位值，脚本会自己生成，改脚本时别删掉
- `note/deleteAll` 执行了但没删掉任何东西：它对不在回收站的便签不生效。清空必须两步，先 `updateFolder` 移进回收站，再 `deleteAll`

## 三个需要注意的地方

创建时间拿不到。接口只返回 `modify_time`，`created` 一律写 `null`，没有拿修改时间冒充。`seqid` 和 `eseqid` 试过反推，是同步序列号，不是时间戳。排查过程写在[《锤子便签导出到本地 Markdown》](https://hisen.me/20261008-smartisan-notes-export/)里。

标题不是独立字段。服务端的 `title` 是拿正文第一行非空文字生成的，超过 80 个显示宽度截断。导出的文件名也用这个值。

图片是自定义标记：`<image w=宽度 h=高度 describe=描述 name=文件名>`。文件地址是 `https://yun.smartisan.com/apps/note/notesimage/<name>`，要登录态才取得到。
