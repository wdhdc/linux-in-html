# Linux in HTML

A **real Debian 12 i386 virtual machine** running inside a browser tab: real kernel, real sysvinit userland, real disk, real TCP networking through a WISP relay. Not a UI recreation, not a screen recording, not a fake shell that only echoes.

- Emulator: [v86](https://github.com/copy/v86) (x86 → WebAssembly JIT, rendered into a `<canvas>`)
- Guest: Debian 12 bookworm i386, kernel 6.1.0-50-686, sysvinit + udev + apt
- Network: WISP over WebSocket, relayed by the bundled `server.js`
- Persistence: disk writes are stored in IndexedDB, so each browser keeps its own disk state

## Quick start

```bash
cd linux-in-html
node server.js        # http://127.0.0.1:8080
```

Open <http://127.0.0.1:8080/>, press **Start**, wait for `debian-vm login:`. Log in as `root` / `root`.

The disk ships fully configured; first boot only re-runs `dpkg --configure -a` (log at `/var/log/firstboot.log`) and then drops you at the login prompt. Expect roughly 1–2 minutes on desktop, longer on phones.

## Networking

```
guest(eth0) ──virtio-net──> v86(browser) ──WISP/WebSocket──> server.js ──TCP──> Internet
```

- `server.js` serves static files with HTTP Range support and implements the WISP v1 relay (`/wisp/`).
- On GitHub Pages there is no Node process, so the page asks for a public `wss://…/wisp/` endpoint. Run `server.js` behind Nginx + TLS on a small VPS if you need one.
- In the guest, apt already points at `mirrors.aliyun.com`; change the domain in `/etc/apt/sources.list.d/debian.sources` if you prefer another mirror.

## Slow networks (China)

- All front-end assets (v86, BIOS, UI) are local; no CDN is required.
- The 384 MB disk is split into 32 MB parts. If GitHub Pages is slow, open the page with an asset mirror:
  `index.html?assets=https://ghproxy.net/https://raw.githubusercontent.com/wdhdc/linux-in-html/gh-pages/images`

## UI

- Mobile first: screen on top, touch key bar (`Esc`, `Tab`, `Ctrl`, `Alt`, arrows) and a text input that feeds the guest's keyboard.
- The console/network panel becomes a bottom sheet on narrow screens.
- Light/dark themes (`☾` / `☀`), Chinese/English UI (`EN` / `中文`), both persisted in `localStorage`.
- During boot the screen shows a live ttyS0 log with a **Skip** button.

## Layout

```
index.html  style.css  app.js        front end (MIT)
server.js                            static server + WISP relay (MIT)
lib/                                 v86 + SeaBIOS + SeaVGABIOS
images/                              kernel, initrd, 32 MB disk parts
LICENSE  THIRD-PARTY-NOTICES.md      licensing
```

## Licensing

- Original code in this repository is **MIT** (`LICENSE`).
- Third-party pieces keep their own licenses: v86 (BSD-2-Clause), SeaBIOS/SeaVGABIOS (LGPL-3.0), the Debian kernel and rootfs binaries (GPL and others). They are shipped as separate files, so this is mere aggregation and does **not** relicense them under MIT or spread GPL to our code.
- GPL binaries (kernel, Debian packages) come with notices inside the image (`/usr/share/doc/*/copyright`) and a written offer for corresponding source in `THIRD-PARTY-NOTICES.md`.
