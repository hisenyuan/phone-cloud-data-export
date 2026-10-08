# 魅族云短信导出

把 `cloud.flyme.cn` 的短信备份导成本地 CSV 和 Markdown。网页版只能一页页翻，这套脚本一次拉全。

## 跑一遍

先在已登录的短信页面跑 `2-capture.js`，得到 `flyme-sms-<时间戳>-full.json`，然后：

```bash
# CSV + 去重后的 JSON + 导出报告
node 3-convert.js sms flyme-sms-*-full.json

# 再按联系人出 md，只出消息数 >= 2 的会话
node 3-convert.js sms flyme-sms-*-full.json --by-contact --both --min-msgs=2
```

仓库里带一个构造的样例，不含真实数据：

```bash
node 3-convert.js /tmp/sms tests/sample-sms.json --by-contact --both --min-msgs=2
```

## 文件

在浏览器控制台里跑的：

- `1-probe.js`：接口探针。接口变了先跑它，把页面发出的请求地址、参数和返回结构记下来
- `2-capture.js`：全量抓取，每 200 个会话自动存一份分段文件，中断了重跑不会丢

本地跑的：

- `3-convert.js`：原始 JSON 转 CSV 和 Markdown

## 输出

- `全部短信.csv`：一行一条，列是发送时间、方向、对方号码、对方名称、文件夹、正文、uuid。带 BOM，Excel 和 WPS 直接打开不乱码
- `短信原始.json`：去重后的完整数据，字段最全
- `按联系人/*.md`：一个会话一个文件，时间正序
- `收发都有/*.md` 和 `收发都有.csv`：只挑收发都有的会话
- `_导出报告.md`：条数、会话构成、文件夹对照

## 选项

- `--by-contact`：按联系人生成 md
- `--both`：额外抽出「收发都有」的会话
- `--min-msgs=N`：按联系人导出时只导消息数不少于 N 条（默认 1）
- `--line-break=space|br|blank|keep`：每行行尾怎么处理，默认 `space`（两个空格）

## 接口

都是 POST，表单参数，URL 上要带 `tkscsrf`：

- 会话列表：`/c/browser/sms/getsmsgroups`，参数 `status=phone`、`type`、`start`、`length`
- 某个会话的消息：`/c/browser/sms/getsmsdialogs`，参数 `contact`、`status=phone`、`type`、`start`、`length`

`tkscsrf` 从页面自己发出的请求里取，取不到再读 Cookie。

## 抓取时的注意事项

标签页要留在前台。后台标签页的定时器会被浏览器降速，抓取会慢很多。

抓下来的会话记录数大于实际会话数，这是正常的。接口的 `type` 有 0 到 5 六种取值，实测 `type=0/2/4/5` 返回的是同一批会话，`type=3` 才是另一批。抓取时按 `type` 和号码两个键记录，转换时按号码合并、按 `uuId` 去重。

方向按接口的 `type` 字段判断：`1` 是收件，`2` 是发件。原始字段都留在 `短信原始.json` 里，有出入可以回去对。

短信正文里混着 `\r\n`，只按 `\n` 切会让行尾剩一个 `\r`，在部分编辑器里显示成乱码方块。转换脚本先把 `\r\n` 统一成 `\n`。
