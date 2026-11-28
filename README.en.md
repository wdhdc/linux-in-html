# Linux in HTML

[中文](README.md) · English · [Usage guide](usage.html)

A **real Debian 12 i386 virtual machine** inside a browser tab: real kernel, real sysvinit userland, real disk, real TCP networking. Every command you type runs inside the guest — it is not a screen recording, not a UI recreation, and not a fake shell that only echoes.

The desktop around it (top bar, dock, windows, apps) is drawn by the page on the host side and does not depend on X11 inside the guest.

- Emulator: [v86](https://github.com/copy/v86), x86 → WebAssembly JIT, rendered into a `<canvas>`
- Guest: Debian 12 bookworm i386, kernel 6.1.0-50-686, sysvinit + udev + apt
- Network: WISP over WebSocket, relayed into real TCP by the bundled `server.js`
- Disk: one 384 MB ext4 image; writes are stored in IndexedDB and survive a reload
- Desktop: plain HTML / CSS / JS, no framework, no CDN, works offline

## Quick start

```bash
cd linux-in-html
npm install          # single dependency: ws
node server.js       # http://127.0.0.1:8080/
```

`start.bat` (Windows) and `start.sh` (macOS / Linux) install the dependency automatically.

Open <http://127.0.0.1:8080/> and wait: the page boots the VM, logs in as `root/root` on the serial console, configures the guest network and shows the desktop on its own. No buttons to press.

> Do not open `index.html` from disk (`file://`): the browser will not let it read the wasm engine or the disk image, and the page tells you to use `node server.js`.

## Desktop and apps

- Top bar: activities / current window / clock / kernel / theme / network / volume / power menu.
- Dock: terminal, files, editor, camera, gallery, calculator, settings, VM screen, uploads, about & licenses, help. Clicking an icon opens or focuses its window.
- Windows drag, minimize, maximize, close; `Alt`+`Tab` cycles windows, `Ctrl`+`Alt`+`←`/`→` switches the two workspaces.
- On narrow screens the dock becomes a horizontal strip, windows fit the viewport and touch targets grow.
- A three-step first-run wizard (hostname, timezone, theme) appears once and can be skipped or re-opened from Settings.
- Files can be injected into the guest over the serial channel; uploading a `.deb` runs a real `dpkg -i`, reads its `.desktop` entry and adds a dock icon that launches the program inside the guest.

Full instructions, shortcuts and FAQ live in the standalone [`usage.html`](usage.html) page — it starts no VM and costs no CPU.

## Networking

```
guest (enp0s10) ──virtio-net──> v86 (browser / WebAssembly)
                                   │  WISP over WebSocket
                                   ▼
                               server.js (local Node)
                                   │  TCP
                                   ▼
                                 Internet
```

`server.js` serves static files, the disk chunks (HTTP Range), the `/wisp/` relay and a `/dns-query` DNS relay in one process; it listens on `127.0.0.1` by default.

Port 53 inside the guest is handed to the browser by v86; the page forwards that DoH request to `server.js`, which asks a real resolver over UDP (`223.5.5.5` first, then `114.114.114.114`, configurable with `--dns`). Name resolution therefore does not depend on the browser reaching a public DoH endpoint; on static hosting the route is missing and the page falls back to `cloudflare-dns.com`.

After boot the page configures the guest NIC for v86's built-in NAT (`192.168.86.100/24`, gateway and DNS `192.168.86.1`). The network menu in the top bar shows both relay and guest state, plus a re-run button. Manual equivalent:

```bash
IF=$(ls /sys/class/net | grep -v '^lo' | head -n1)
ip link set $IF up
ip addr add 192.168.86.100/24 dev $IF
ip route replace default via 192.168.86.1 dev $IF
printf 'nameserver 192.168.86.1\n' > /etc/resolv.conf
```

Check it inside the guest with `curl -sS http://example.com -o /dev/null -w '%{http_code}\n'` (expect 200), then `apt-get update`. The image ships without a CA bundle, so `https://` needs `apt-get install -y ca-certificates` first; plain HTTP and apt are fine. apt already points at `mirrors.aliyun.com`.

**Static hosting (GitHub Pages)**: there is no Node process, so no `/wisp/`. Enter a public `wss://your-relay/wisp/` in the network menu and reconnect, or open the page with `?wisp=…`. The VM still boots; without a relay the guest has no Internet.

**LAN**: `node server.js --host 0.0.0.0` (or `--allow-any-host`) and open `http://<host-ip>:8080/`. `--block host1,host2` blocks specific destinations.

## Persistence

Writes to the 384 MB ext4 disk are kept in IndexedDB, so packages and files survive reloads. Each browser keeps its own disk: another browser, another device or a private window sees a different (or factory) disk. Power menu → "Clear disk changes" resets it.

## Layout

```
index.html              desktop entry (desktop, dock, windows)
usage.html              usage guide (standalone page, no VM)
assets/css/desktop.css  desktop, top bar, dock, windows, app styles
assets/js/term.js       terminal renderer (ttyS0)
assets/js/wm.js         window manager, workspaces, top bar
assets/js/apps.js       terminal / files / editor / camera / gallery / calculator / settings …
assets/js/extras.js     first-run wizard, serial file injection, extra apps
assets/js/bridge.js     v86 / WISP / IndexedDB bridge
assets/js/boot.js       boot flow, serial auto-login, guest network setup
assets/js/anim.js       UI animations
assets/icons/           icon sprite and logo
server.js               static server + Range + WISP relay (hand-written, no framework)
lib/                    v86 engine, SeaBIOS / SeaVGABIOS
images/                 vmlinuz, initrd, 384 MB disk parts
licenses/               full license texts (GPL-3.0 …)
```

## Known limits

- Single core, no KVM: roughly early-2000s speed. Boot to desktop is 25–40 s; `apt install` needs patience.
- The guest NIC appears as `enp0s10` in v86 (the image's `/etc/network/interfaces` was written for `eth0`), which is why the page uses the static commands above instead of `ifup`.
- No CA bundle in the image: install `ca-certificates` before using `https://`.
- Name resolution (port 53) goes through `server.js` `/dns-query` over UDP; without a local server the page falls back to public DoH (`cloudflare-dns.com`), and if that endpoint is unreachable the guest reports `Could not resolve host` while the TCP relay itself still works (verify with a direct-IP URL).
- The serial channel is slow — keep injected files in the tens-of-KB range. The disk is 384 MB; check `df -h` before big installs.
- No GPU acceleration and no sound card pass-through. You can `apt install xorg` inside the guest, but it will not be fast.
- If memory is tight the page retries the boot at 320 / 256 / 192 / 128 MB before giving up.

## Slow networks (China)

- Every front-end asset (v86, BIOS, UI, icons) is bundled locally; no CDN is required.
- The only heavy traffic is the 384 MB disk, split into 32 MB parts. If hosting is slow, open the page with an asset mirror:
  `index.html?assets=https://ghproxy.net/https://raw.githubusercontent.com/wdhdc/linux-in-html/gh-pages/images`
- WISP is a long-lived WebSocket; on Pages you must provide a public `wss://…/wisp/`. Run `server.js` behind Nginx + TLS on a small VPS if needed.

## Licensing and attribution

- **The desktop UI, window manager, terminal renderer, bridge layer and the apps are adapted from Toy Linux (LING不道 / 凌徐鲲, GPL-3.0-or-later, <https://gitee.com/ling-xukun/toylinux>)**. That part, and the combined work, is therefore distributed under **GPL-3.0-or-later** with the original author credited. Full text: [`licenses/GPL-3.0.md`](licenses/GPL-3.0.md); provenance and changes: [`NOTICE.md`](NOTICE.md).
- `server.js`, `index.html`, `usage.html` and the start scripts are original work and are additionally available under **MIT** ([`licenses/MIT.md`](licenses/MIT.md)). The repository as a whole is distributed as a combined GPL-3.0-or-later work.
- v86 (BSD-2-Clause), SeaBIOS / SeaVGABIOS (LGPL-3.0) and the Debian kernel / rootfs binaries (their own licenses, mostly GPL) ship as separate files and keep their licenses — see [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
- GPL binaries come with `/usr/share/doc/*/copyright` inside the image, plus a written offer for corresponding source in `THIRD-PARTY-NOTICES.md`.
