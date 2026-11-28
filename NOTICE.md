# NOTICE · 来源、改编范围与署名

本项目在 **Toy Linux**（作者：凌徐鲲 / LING不道，GPL-3.0-or-later，<https://gitee.com/ling-xukun/toylinux>）的基础上改造而来：桌面外壳、窗口系统、终端渲染、桥接层和各个应用的代码取自上游并做了针对 Debian 客户机的改动。

## 派生文件（GPL-3.0-or-later）

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

派生的 JS / CSS 文件头部都保留了「改编自 Toy Linux」的署名注释。

## 本项目原创（可另按 MIT 使用）

`server.js`（静态服务 + HTTP Range 分块 + WISP v1 中继）、`index.html`、`assets/js/boot.js` 中与 v86 / IndexedDB / 网络相关的部分、`usage.html`、`start.bat` / `start.sh`、`package.json`。这些文件不含上游代码，许可证见 `licenses/MIT.md`；整个仓库作为组合作品对外分发时按 GPL-3.0-or-later。

## 与上游的行为差异

- 客户机是完整的 384 MB ext4 磁盘，根文件系统可写，`apt` 指向真实镜像源（默认阿里云，可换清华 TUNA），不依赖上游的离线空源。
- 网络由自写的 WISP 中继（`server.js`）提供真实 TCP，而不是无网络设计。
- 前端不依赖 Toy SDK / 哔哩哔哩运行环境，可直接部署在任意静态站点或 GitHub Pages。
- 桌面外壳运行在宿主侧，客户机里不需要 X11。

## 商标

Debian 是 Software in the Public Interest, Inc. 的注册商标；本项目与 Debian 项目无隶属关系。Toy Linux 的名称与署名归其作者所有。
