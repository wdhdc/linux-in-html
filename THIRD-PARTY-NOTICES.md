# Third-party notices / 第三方组件说明

本仓库自己的代码（`index.html`、`style.css`、`app.js`、`server.js`、构建脚本）采用 **MIT**（见 `LICENSE`）。
下列组件各自遵循原许可证，**不因被本仓库打包而改为 MIT/GPL**；它们以独立文件形式分发，属于聚合（aggregation），不发生许可证传染。

| 组件 | 文件 | 许可证 | 来源 |
| --- | --- | --- | --- |
| v86（x86 模拟器） | `lib/v86.js`、`lib/v86.wasm` | BSD-2-Clause | https://github.com/copy/v86 |
| SeaBIOS | `lib/seabios.bin` | LGPL-3.0 | https://github.com/copy/v86/tree/master/bios |
| SeaVGABIOS | `lib/vgabios.bin` | LGPL-3.0 | 同上 |
| Linux 内核 6.1.0-50-686（Debian 构建） | `images/vmlinuz` | GPL-2.0-only | https://deb.debian.org/debian/pool/main/l/linux/ |
| Debian 12 (bookworm) i386 用户态 | `images/disk-*.img`（ext4 镜像） | 各包自身（GPL-2.0/3.0、LGPL、MIT、BSD 等） | https://www.debian.org/ |

## GPL 相关义务（重要）

1. **本项目原创前端/服务端代码不包含任何 GPL 代码**，以 MIT 分发，不触发 GPL 传染。
2. `images/vmlinuz` 与 ext4 根文件系统镜像包含 GPL 程序。分发这些二进制时须遵守 GPL：
   - 镜像内 `/usr/share/doc/<包>/copyright` 保留了每个 Debian 包的许可证与上游地址；
   - 内核与各 Debian 包的完整对应源码可从 `https://deb.debian.org/debian/` 获取；
   - 本仓库对上述 GPL 二进制提供**书面要约**：如需对应源码，可在本仓库提 issue 索取，或直接按上述地址自行下载同版本源码。
3. 若你修改了内核或 rootfs 内的 GPL 组件，必须标注修改并继续按 GPL 分发，不能改用 MIT。
4. v86 / SeaBIOS 的许可证文件未随包内联；升级这些组件时请从其上游保留 LICENSE。

## 商标

Debian 是 Software in the Public Interest, Inc. 的注册商标；本项目与 Debian 项目无隶属关系。
