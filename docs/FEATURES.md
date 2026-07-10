# 增强功能说明

本仓库在官方 vertex 的基础上新增了以下功能。

## 1. 顺序下载 (下载器配置)

添加种子时向 qBittorrent 传递顺序下载开关, 同 qBittorrent 右键菜单 - 顺序下载。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `sequentialDownload` | boolean | 开启顺序下载 |

## 2. 自动校验 (下载器配置)

定时扫描下载器内体积相同的种子, 若最快与最慢进度差超过阈值,
对进度落后的种子执行重新汇报 + 强制重新校验 (recheck)。
上传速度达到保护值、属于排除分类、或正在校验/移动中的种子不参与。
日志输出在 `logs/app-sc.log`。

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `autoRecheck` | boolean | false | 开启自动校验任务 |
| `recheckCron` | string (cron) | `*/3 * * * *` | 任务执行周期 |
| `categoryList` | string[] | `['keep']` | 排除的分类列表 |
| `minProgressDifference` | number (0~1) | 0.05 | 触发校验的最小进度差 |
| `minUploadProtection` | number (byte/s) | 52428800 | 上传速度保护阈值, 达到则不校验 |

注意: 自动校验没有可视化表单, 新增下载器时以上默认值会随表单一同保存,
如需开启或调整, 编辑下载器配置数据即可。

## 3. RSS 首选下载器调整 (RSS 任务配置)

开启后优先将种子推送到已存在同体积种子的下载器, 忽略原有的首选下载器逻辑。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `adjustFirstClient` | boolean | 开启首选下载器自动调整 |

## 4. RSS 仅辅种 (RSS 任务配置, 需先开启首选下载器调整)

开启后 RSS 只做辅种: 仅当所选下载器中已存在同体积种子且进度达到设定值时才推送,
否则拒绝该种子。配合"跳校验"选项, 已有完成的相同种子时直接跳过校验添加。
日志输出在 `logs/app-watch.log`。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `auxiliaryTorrent` | boolean | 开启仅辅种模式 |
| `auxiliaryProgress` | number (0~1) | 已有种子需达到的最低进度, 不懂填 1 |
| `autoReseed` | boolean | 跳校验: 有已完成的相同种子时跳过校验 |

## 5. 其他

- qBittorrent 客户端新增 `removeTags` (删除种子标签)、`recheck` (重新校验) 接口封装
- `lemon` 站点移出 RSS 长缓存名单 (恢复默认 40 秒缓存)

## 构建

镜像通过 GitHub Actions 构建, 需在仓库 Secrets 配置
`DOCKER_USERNAME` / `DOCKER_PASSWORD` (Docker Hub 账号)。
