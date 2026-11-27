# Linux in HTML

在浏览器里跑一台**真的 Debian 12 i386 虚拟机**：真的内核、真的 systemd-free sysvinit 用户态、真的磁盘、真的 TCP 网络。
不是 UI 复原、不是视频回放，也不是只会 echo 的假终端。

- 模拟器：v86（x86 → WebAssembly JIT，跑在 `<canvas>` 里）
- guest：Debian 12 bookworm i386，内核 6.1.0-50-686，sysvinit + udev + apt
- 网络：WISP 协议（WebSocket 上多路复用真实 TCP），由本项目自带的 `server.js` 提供
- 磁盘改动：写进浏览器 IndexedDB，刷新后继续用，相当于每个浏览器一份持久化磁盘

## 快速开始

```bash
cd linux-in-html
node server.js          # 默认 http://127.0.0.1:8080
```

打开 <http://127.0.0.1:8080/>，点“启动”，等内核打印完、出现 `debian-vm login:` 即可用。

登录：用户名 `root`，密码 `root`（串口控制台或画面里都能输）。

第一次启动会看到安装日志（`/var/log/firstboot.log`），镜像出厂时已经装好，正常只会直接进系统。

## 联网

浏览器本身不能开 TCP，guest 里的 socket 通过 WISP 中继转发：

```
guest(eth0) ──virtio-net──> v86(浏览器) ──WISP/WebSocket──> server.js ──TCP──> 互联网
```

`server.js` 同时提供静态文件、磁盘按块读取（HTTP Range）和 `/wisp/` 中继。默认只监听 127.0.0.1，改 `--host 0.0.0.0` 可给局域网用。

guest 里验证：

```bash
ip a
curl -sS https://example.com | head -3
apt-get update
```

## GitHub Pages

Pages 只能放静态文件，没有 Node 进程，所以**中继要另外给一个公网 WISP 地址**：

- 打开页面右下角的“网络中继”，填 `wss://<你的中继域名>/`；
- 或者用 `?wisp=wss://host/` 直接带参数打开。

公网中继可以自己部署（任何支持 WebSocket 的 Node 服务都能跑本项目 `server.js`），或使用你信任的公共 WISP 服务。
Pages 版本没有本地服务，磁盘改动仍然保存在浏览器 IndexedDB 里。

## 目录

```
index.html      页面骨架（画面、串口终端、状态栏）
app.js          v86 控制、串口 IO、IndexedDB 磁盘增量
style.css       界面样式
server.js       静态服务 + Range + WISP 中继（自写，零框架）
lib/            v86 引擎、SeaBIOS/VGA BIOS（来自 v86 项目）
images/         vmlinuz、initrd、disk 分块镜像
```

## 已知限制

- 单核、无 KVM，性能约等于 2000 年代初的机器，`apt install` 要有耐心。
- 只保留运行必需的内核模块（virtio-net、ata、ext4 等）。要折腾其它硬件，`apt install --reinstall linux-image-6.1.0-50-686` 拿回全部模块。
- 没有 GPU 加速、没有声卡直通；图形界面可以 `apt install xorg` 自己装，跑得动但不会快。
- Pages 上如果不填公网 WISP，虚拟机可以启动，但 guest 里没有外网。

## 组件来源

- v86（copy/v86）—— x86 模拟器与 WASM JIT，BSD-2-Clause
- SeaBIOS / VGA BIOS —— 来自 v86 仓库
- Debian 12 i386 用户态 —— Debian 官方发行版
