# phone-cloud-data-export

把旧手机云端的便签和短信导出来，存成本地的 Markdown 和 CSV。

国内几家的云服务都在收缩。锤子便签的云端还挂在欢喜云，手机端早就不更新了；魅族的云便签和云短信也只剩网页版一个入口。网页版都没有批量导出，只能一页页翻。

这三套脚本把数据一次拉下来，转成不依赖任何厂商的本地文件。

## 背景

起因是把散在各处的笔记收敛到本地一个目录。读书时记的放锤子便签，通勤路上随手写的放魅族便签，早年还有有道云笔记和 Notion，时间一长自己都说不清哪条在哪儿。短信不算笔记，但同样是散在外面的记录，顺手一起拿下来。

接口怎么摸出来的、坑怎么踩的，都写在博客里：

- [锤子便签导出到本地 Markdown](https://hisen.me/20261008-smartisan-notes-export/)
- [魅族云便签导出到本地 Markdown](https://hisen.me/20261008-flyme-notes-export/)
- [魅族云短信导出成 CSV 和 Markdown](https://hisen.me/20261008-flyme-sms-export/)

## 仓库目录

三个模块对应本仓库的三个目录，点目录名进去看各自的用法：

| 目录 | 平台 | 云端地址 |
| --- | --- | --- |
| [`smartisan-notes/`](https://github.com/hisenyuan/phone-cloud-data-export/tree/main/smartisan-notes) | 锤子便签 | [yun.smartisan.com](https://yun.smartisan.com) |
| [`flyme-notes/`](https://github.com/hisenyuan/phone-cloud-data-export/tree/main/flyme-notes) | 魅族云便签 | [notes.flyme.cn](https://notes.flyme.cn) |
| [`flyme-sms/`](https://github.com/hisenyuan/phone-cloud-data-export/tree/main/flyme-sms) | 魅族云短信 | [cloud.flyme.cn](https://cloud.flyme.cn) |

## 怎么用

三套流程一样，抓取那步都在你自己已经登录的浏览器里跑。

1. 打开对应网页版，确认能正常看到数据
2. F12 打开控制台，把该目录的抓取脚本整段粘进去，回车
3. 原始数据存到浏览器「下载」目录
4. 本地用 Node.js 跑转换脚本，生成 md 或 csv
5. 跑校验脚本，确认一条没漏

每套的具体命令看各自目录的 README，也可以拿 `sample-raw.json` 先跑通一遍再动真数据。

## 为什么在浏览器控制台里跑

另一条路是把浏览器的 Cookie 复制出来，用 curl 批量拉。Cookie 库里存着所有站点的登录态，代价远超「导出便签」这一件事。

这些脚本只用你当前的登录态调官方接口，数据从浏览器直接下载到本地。Cookie 不出本机，也不会发到任何第三方。

## 边界

- 抓取脚本只调只读接口。唯一一个写操作的脚本是 `smartisan-notes/5-delete.js`，默认 `DRY_RUN = true`，只打印清单不动数据
- 仓库里只有脚本和构造的样例数据，没有真实数据。原始 JSON 和导出的 md、csv 都在你自己机器上
- 站点接口会变。变了先看对应目录 README 的「报错对照」，再回前端 JS 里核对接口

## 环境

抓取和删除脚本在浏览器里跑，不需要任何依赖。本地脚本只用到 Node.js 的 `fs` 和 `path`。

## License

MIT
