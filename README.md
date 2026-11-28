# Linux in HTML

[中文](#linux-in-html) · [English](README.en.md) · [使用说明](usage.html)

在浏览器标签页里跑一台**真的 Debian 12 i386 虚拟机**：真内核、真 sysvinit 用户态、真磁盘、真 TCP 网络。
终端里敲的每条命令都在客户机里执行，不是录屏、不是 UI 复原，也不是只会 echo 的假终端。

外面那层桌面（顶栏、Dock、窗口、各个应用）是网页自己画的，运行在宿主侧，不依赖客户机里的 X11。

- 模拟器：v86（x86 → WebAssembly JIT，画面渲染在 `<canvas>`）
- 客户机：Debian 12 bookworm i386，内核 6.1.0-50-686，sysvinit + udev + apt
- 网络：WISP over WebSocket（由本项目自带的 `server.js` 转发成真实 TCP）
- 磁盘：384 MB ext4 整盘镜像，改动写进浏览器 IndexedDB，刷新后接着用
- 桌面：原生 HTML / CSS / JS，零框架、零外部 CDN，离线可用

## 快速开始

```bash
cd linux-in-html
npm install          # 只有一个依赖 ws，首次运行需要
node server.js       # 默认 http://127.0.0.1:8080/
```

Windows 直接双击 `start.bat`，macOS / Linux 执行 `./start.sh`，两者都会自动补装依赖。

打开 <http://127.0.0.1:8080/> 后会自己开机、自己在串口上用 `root/root` 登录、自己配好 guest 网络，等引导动画结束就进桌面，不需要点任何按钮。

> 不要用 `file://` 直接打开 `index.html`：浏览器不允许本地文件读 wasm 和磁盘镜像，页面会提示改用 `node server.js`。

## 桌面与内置应用

- 顶栏：活动（应用总览）、当前窗口名、时钟、内核版本、主题、网络、扬声器、电源菜单。
- Dock：终端、文件、文本编辑器、相机、图库、计算器、设置、虚拟机屏幕、已上传文件、关于与许可、帮助等，点图标开窗或切回。
- 窗口可以拖动、最小化、最大化、关闭；`Alt`+`Tab` 切换窗口，`Ctrl`+`Alt`+`←`/`→` 切换两个工作区。
- 窄屏（手机）上 Dock 变成底部横排，窗口自适应，触控目标放大。
- 首次打开会出现三步向导（主机名、时区、主题），可直接跳过；之后在「设置」里还能改，也能重新调出向导。
- 「文件」可以把本机文件通过串口注入客户机；上传 `.deb` 会走真实的 `dpkg -i`，再从包里解析 `.desktop` 在 Dock 生成图标，点图标就在客户机里启动程序。

完整的功能说明、快捷键和常见问题在独立页面 [`usage.html`](usage.html)（不占 CPU、不启动虚拟机，可以单独收藏）。

## 网络

浏览器本身不能开 TCP，所以客户机里的 socket 通过 WISP 中继出去：

```
guest（enp0s10） ──virtio-net──> v86（浏览器 / WebAssembly）
                                    │  WISP over WebSocket
                                    ▼
                                server.js（本机 Node）
                                    │  TCP
                                    ▼
                                  互联网
```

`server.js` 一个进程干四件事：静态文件、磁盘分块（HTTP Range 按需读取）、`/wisp/` 中继、`/dns-query` DNS 中转。默认只监听 `127.0.0.1`。

客户机的 53 端口由 v86 交给浏览器，页面再把这条 DoH 请求转给 `server.js` 用 UDP 问真实 DNS（默认 `223.5.5.5`，失败再试 `114.114.114.114`，可用 `--dns` 改），所以域名解析不依赖浏览器能否访问公网 DoH；Pages 上没有该路由，会自动回落到 `cloudflare-dns.com`。

开机流程会在串口里把网卡配成 v86 内置 NAT 的约定地址（`192.168.86.100/24`，网关与 DNS `192.168.86.1`）。顶栏网络图标里能看到中继与 guest 网络状态，也有「立即配置 guest 网络」按钮。等价的手动命令：

```bash
IF=$(ls /sys/class/net | grep -v '^lo' | head -n1)
ip link set $IF up
ip addr add 192.168.86.100/24 dev $IF
ip route replace default via 192.168.86.1 dev $IF
printf 'nameserver 192.168.86.1\n' > /etc/resolv.conf
```

客户机里验证：

```bash
ip -4 addr show dev enp0s10
curl -sS http://example.com -o /dev/null -w '%{http_code}\n'   # 期望 200
apt-get update
```

镜像里没有 CA 证书，`https://` 需要先 `apt-get install -y ca-certificates`；HTTP 和 apt 不受影响。apt 源默认指向阿里云，改 `/etc/apt/sources.list.d/debian.sources` 里的域名即可换源。

**GitHub Pages 等静态托管**：没有 Node 进程，也就没有 `/wisp/`。这时需要在顶栏网络菜单里填一个公网可达的 `wss://你的中继/wisp/` 再重连，或者用 `?wisp=…` 参数打开。虚拟机能照常开机，没填中继时客户机没有外网。

**局域网**：`node server.js --host 0.0.0.0`（或 `--allow-any-host`），用宿主机 IP:8080 打开即可；想屏蔽某些目标主机可以加 `--block host1,host2`。

## 磁盘持久化

客户机是一块完整的 384 MB ext4 盘，写入的块存在浏览器的 IndexedDB 里：刷新页面、关掉浏览器再打开，装过的包和写过的文件都还在。

每个浏览器一份，互不相通；换浏览器、换设备、开无痕窗口看到的都是另一份。想回到出厂状态，用电源菜单里的「清除磁盘改动」。

## 目录

```
index.html              桌面入口（桌面、Dock、窗口挂在这里）
usage.html              使用说明（独立静态页，不启动虚拟机）
assets/css/desktop.css  桌面、顶栏、Dock、窗口、各应用样式
assets/js/term.js       终端渲染器（ttyS0）
assets/js/wm.js         窗口管理器、工作区、顶栏
assets/js/apps.js       终端 / 文件 / 编辑器 / 相机 / 图库 / 计算器 / 设置等
assets/js/extras.js     首启向导、串口注入、附加应用
assets/js/bridge.js     v86 / WISP / IndexedDB 桥接
assets/js/boot.js       引导流程、串口自动登录、guest 网络配置
assets/js/anim.js       界面动效
assets/icons/           图标 sprite 与 logo
server.js               静态服务 + Range 分块 + WISP 中继（自写，零框架）
lib/                    v86 引擎、SeaBIOS / SeaVGABIOS
images/                 vmlinuz、initrd、384 MB 磁盘分块
licenses/               许可证全文（GPL-3.0 等）
```

## 已知限制

- 单核、无 KVM，性能大致相当于 2000 年代初的机器；进桌面 25–40 秒，`apt install` 要有耐心。
- 客户机网卡在 v86 里叫 `enp0s10`，镜像自带的 `/etc/network/interfaces` 写的是 `eth0`，所以配网走上面的静态配置而不是 `ifup`。
- 镜像不带 CA 证书，`https://` 先 `apt-get install -y ca-certificates`。
- 域名解析（53 端口）由 v86 交给浏览器，页面转给 `server.js` 的 `/dns-query` 用 UDP 代问；`server.js` 不在或不通时回落到公网 DoH（`cloudflare-dns.com`），后者被网络挡住时客户机会报 `Could not resolve host`，而 TCP 中继本身仍然是通的（用 IP 直连可验证）。
- 串口是慢通道，往里注入的文件几十 KB 级别最稳；只有一块 384 MB 盘，装大包前先 `df -h`。
- 没有 GPU 加速、没有声卡直通；想在客户机里装 `xorg` 可以，但不会快。
- 内存不足时页面会按 320 / 256 / 192 / 128 MB 依次重试启动，太小就起不来。

## 国内网络（慢的时候这样绕）

- 页面本体（v86、BIOS、前端、图标）全部本地自带，不依赖任何 CDN。
- 唯一的大流量是从托管站拉 384 MB 磁盘分块。慢的话用镜像前缀打开：
  `index.html?assets=https://ghproxy.net/https://raw.githubusercontent.com/wdhdc/linux-in-html/gh-pages/images`
  （把 `ghproxy.net` 换成手头可用的 GitHub 反代即可，路径部分保持不变。）
- WISP 中继是 WebSocket 长连接，Pages 上必须填公网可访问的 `wss://…/wisp/`；可以在小 VPS 上跑 `node server.js`，前面套 Nginx 反代并开 TLS。

## 许可与署名

- **本项目的桌面 UI、窗口管理器、终端渲染器、桥接层与各个应用改编自 Toy Linux（作者 LING不道 / 凌徐鲲，GPL-3.0-or-later，<https://gitee.com/ling-xukun/toylinux>）**，因此这部分及其组合作品按 **GPL-3.0-or-later** 分发，并保留原作者署名。许可证全文见 [`licenses/GPL-3.0.md`](licenses/GPL-3.0.md)，来源与改动说明见 [`NOTICE.md`](NOTICE.md)。
- `server.js`、`index.html`、`usage.html`、启动脚本为本项目原创，**逐文件按 MIT** 授权（见 [`licenses/MIT.md`](licenses/MIT.md)）。整个仓库一起分发时按组合作品标注 GPL-3.0-or-later，但 `server.js` 仍可单独取出按 MIT 使用。
- **GPL 边界**：`server.js` 是独立 Node 进程，和前端只通过 HTTP / WebSocket 通信，不 `import`、不链接同一二进制，属于独立作品而非衍生作品，GPL 不跨这条边界；反过来，单独拿走 `term.js` / `wm.js` / `apps.js` 等 8 个派生文件时必须继续遵守 GPL-3.0-or-later。展开说明见 [`NOTICE.md`](NOTICE.md) 的「许可边界」。
- v86（BSD-2-Clause）、SeaBIOS / SeaVGABIOS（LGPL-3.0）、Debian 内核与 rootfs 二进制（各包自身许可，以 GPL 为主）作为独立文件分发，保持各自许可证，详见 [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)。
- 镜像里保留 `/usr/share/doc/*/copyright`；GPL 二进制的对应源码地址与书面要约写在 `THIRD-PARTY-NOTICES.md`。

## 组件来源

- v86（copy/v86）—— x86 模拟器与 WASM JIT，BSD-2-Clause
- SeaBIOS / SeaVGABIOS —— 来自 v86 仓库
- Debian 12 i386 用户态 —— Debian 官方发行版
- 桌面与应用 —— 改编自 Toy Linux（LING不道），GPL-3.0-or-later
