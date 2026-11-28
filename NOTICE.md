# NOTICE · 来源、改编范围与署名

本项目在 **Toy Linux**（作者：凌徐鲲 / LING不道，GPL-3.0-or-later，<https://gitee.com/ling-xukun/toylinux>）的基础上改造而来：桌面外壳、窗口系统、终端渲染、桥接层和各个应用的代码取自上游并做了针对 Debian 客户机的改动。

## 派生文件（GPL-3.0-or-later，带上游署名）

| 文件 | 上游文件 | 本项目的改动 |
| --- | --- | --- |
| `assets/js/term.js` | `term.js` | 改名为 `LihTerm`，接入 v86 的 ttyS0 串口字节流 |
| `assets/js/wm.js` | `wm.js` | 改名，桌面 / Dock / 顶栏接到本项目的引导流程 |
| `assets/js/anim.js` | `anim.js` | 改名，动画入口跟随本项目模块名 |
| `assets/js/bridge.js` | `toy-bridge.js` | 改名，去掉对 Toy SDK / 哔哩哔哩运行环境的硬依赖，改为可选的失败原因提示 |
| `assets/js/apps.js` | `apps.js` | 终端、文件、编辑器、设置等改为通过串口 `exec` 读写真实 Debian；新增相机 / 图库 / 计算器 / 虚拟机屏幕；网络分区改为 WISP 中继 + guest 静态配网 |
| `assets/js/extras.js` | `extras.js` | 首启向导改为写主机名 / 时区 / 主题；新增串口文件注入、`.deb` 上传与桌面图标、已上传文件应用 |
| `assets/js/boot.js` | `boot.js` | 改为引导 384 MB ext4 磁盘镜像（按块 Range 读取）、IndexedDB 磁盘增量、串口自动登录与 guest 网络配置、内存阶梯重试 |
| `assets/css/desktop.css` | `desktop.css` | 配色、字号、间距、窄屏布局与窗口样式按本项目重做 |

派生文件的头部都保留了「改编自 Toy Linux（GPL-3.0-or-later）」的署名注释；改动内容在本仓库里持续可见，本仓库即为其对应源码。

## 本项目原创（MIT，见 `licenses/MIT.md`）

| 文件 | 说明 |
| --- | --- |
| `server.js` | 静态服务、HTTP Range 分块、WISP v1 中继、`/dns-query` DNS 中转；纯 Node，只依赖 `ws` |
| `index.html` | 桌面入口页骨架，只引用外部资源 |
| `usage.html` | 使用说明页，纯静态 |
| `start.bat` / `start.sh` / `package.json` | 启动与依赖声明 |

这些文件不含任何上游代码，逐文件按 MIT 授权。

## 许可边界：为什么 GPL 不会“传染”到 `server.js`

1. **进程 / 通信边界**：`server.js` 是独立的 Node 进程，和前端只通过 HTTP（静态文件、Range、`/dns-query`）与 WebSocket（`/wisp/`）交换字节，不做共享内存、不互相 `import`、不链接同一个二进制。这种“各自独立、仅通过网络协议通信”的关系属于聚合（aggregation）或独立作品，不是衍生作品，因此 GPL 的传染性不跨过这条边界。
2. **代码来源**：`server.js`、`index.html`、`usage.html` 与启动脚本全部为本项目自写，可逐行确认没有上游代码。
3. **分发口径**：整个仓库一起分发时，作为**组合作品**标注 GPL-3.0-or-later（因为组合里含 GPL 文件）；但 `server.js` 作为著作权人自己的作品，仍可**单独按 MIT** 使用、修改、再分发（例如只取它的 WISP 中继或静态服务放进别的项目）。反过来，把 GPL 的前端文件单独拿走使用时，必须继续遵守 GPL-3.0-or-later。
4. **改动派生文件时**：改 `term.js` / `wm.js` / `apps.js` 等属于修改 GPL 作品，改完仍按 GPL 分发并保留署名；改 `server.js` 不受此限。

## 与上游的行为差异

- 客户机是完整的 384 MB ext4 磁盘，根文件系统可写，`apt` 指向真实镜像源（默认阿里云，可换清华 TUNA），不依赖上游的离线空源。
- 网络由自写的 WISP 中继（`server.js`）提供真实 TCP，而不是无网络设计。
- 前端不依赖 Toy SDK / 哔哩哔哩运行环境，可直接部署在任意静态站点或 GitHub Pages。

## 商标

Debian 是 Software in the Public Interest, Inc. 的注册商标；本项目与 Debian 项目无隶属关系。Toy Linux 的名称与署名归其作者所有。
