/* linux-in-html 前端：v86 虚拟机控制、串口终端、磁盘增量持久化 */
"use strict";

const DISK_SIZE = 384 * 1024 * 1024;
const DISK_CHUNK = 32 * 1024 * 1024;
const MEMORY_SIZE = 256 * 1024 * 1024;
const BLOCK = 512;

const qs = new URLSearchParams(location.search);
const isLocal = ["localhost", "127.0.0.1", "0.0.0.0", ""].includes(location.hostname);

const el = {
    screen: document.getElementById("screen_container"),
    serial: document.getElementById("serial-out"),
    serialForm: document.getElementById("serial-form"),
    serialIn: document.getElementById("serial-in"),
    wisp: document.getElementById("wisp"),
    netState: document.getElementById("net-state"),
    status: document.getElementById("status"),
    statNet: document.getElementById("stat-net"),
    btnStart: document.getElementById("btn-start"),
    btnPause: document.getElementById("btn-pause"),
    btnReset: document.getElementById("btn-reset"),
    btnFull: document.getElementById("btn-full"),
    btnPanel: document.getElementById("btn-panel"),
    btnNet: document.getElementById("btn-net"),
    btnClear: document.getElementById("btn-clear-disk"),
    btnClearSerial: document.getElementById("btn-clear-serial"),
    side: document.getElementById("side"),
};

const defaultWisp = isLocal
    ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/wisp/`
    : "";

el.wisp.value = qs.get("wisp") || defaultWisp;

const ASSET = (qs.get("assets") || "").replace(/\/+$/, "");
const A = (p) => (ASSET ? ASSET + "/" + p : p);

let emulator = null;
let ready = false;
let serialBuffer = "";
let overlay = new Map();      // block index -> Uint8Array(512)
let pending = new Set();
let flushing = false;
let dbPromise = null;

/* ----------------------------- IndexedDB 磁盘增量 ----------------------------- */

function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open("linux-in-html", 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("blocks")) db.createObjectStore("blocks");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

async function loadOverlay() {
    try {
        const db = await openDB();
        await new Promise((resolve) => {
            const tx = db.transaction("blocks", "readonly");
            const store = tx.objectStore("blocks");
            const req = store.openCursor();
            req.onsuccess = () => {
                const cur = req.result;
                if (cur) {
                    overlay.set(Number(cur.key), new Uint8Array(cur.value));
                    cur.continue();
                }
            };
            tx.oncomplete = resolve;
            tx.onerror = resolve;
        });
        if (overlay.size) setStatus(`已载入 ${overlay.size} 个磁盘改动块（本地持久化）`);
    } catch (e) {
        console.warn("overlay load failed", e);
    }
}

async function flushOverlay() {
    if (flushing || pending.size === 0) return;
    flushing = true;
    const ids = [...pending];
    pending.clear();
    try {
        const db = await openDB();
        await new Promise((resolve) => {
            const tx = db.transaction("blocks", "readwrite");
            const store = tx.objectStore("blocks");
            for (const id of ids) {
                const b = overlay.get(id);
                if (b) store.put(b, id);
            }
            tx.oncomplete = resolve;
            tx.onerror = resolve;
            tx.onabort = resolve;
        });
    } catch (e) {
        console.warn("overlay flush failed", e);
    } finally {
        flushing = false;
        if (pending.size) flushOverlay();
    }
}

function scheduleFlush() {
    if (flushing) return;
    setTimeout(flushOverlay, 1200);
}

function attachOverlay(emu) {
    const disk = emu.disk && emu.disk.master && emu.disk.master.buffer;
    if (!disk || typeof disk.set !== "function") return false;

    for (const [idx, bytes] of overlay) {
        disk.block_cache.set(idx, bytes);
        disk.block_cache_is_write.add(idx);
    }

    const originalSet = disk.set.bind(disk);
    disk.set = function (start, data, fn) {
        originalSet(start, data, fn);
        const count = data.length / BLOCK;
        for (let i = 0; i < count; i++) {
            const idx = start / BLOCK + i;
            const block = data.slice(i * BLOCK, (i + 1) * BLOCK);
            overlay.set(idx, block);
            pending.add(idx);
        }
        scheduleFlush();
    };
    return true;
}

/* --------------------------------- 虚拟机 --------------------------------- */

function setStatus(text) {
    el.status.textContent = text;
}

function setNet(state, text) {
    el.netState.textContent = text;
    el.netState.className = "badge " + state;
    el.statNet.textContent = "网络：" + text;
}

function wispUrlForV86() {
    const raw = el.wisp.value.trim();
    if (!raw) return null;
    return raw.replace(/^wss:/, "wisps:").replace(/^ws:/, "wisp:");
}

function createEmulator() {
    const relay = wispUrlForV86();
    const config = {
        wasm_path: "lib/v86.wasm",
        memory_size: MEMORY_SIZE,
        vga_memory_size: 2 * 1024 * 1024,
        screen_container: el.screen,
        bios: { url: "lib/seabios.bin" },
        vga_bios: { url: "lib/vgabios.bin" },
        bzimage: { url: A("images/vmlinuz") },
        initrd: { url: A("images/initrd.img") },
        hda: {
            url: A("images/disk.img"),
            size: DISK_SIZE,
            async: true,
            use_parts: true,
            fixed_chunk_size: DISK_CHUNK,
        },
        cmdline: "console=tty0 console=ttyS0,115200 root=/dev/sda rw",
        autostart: false,
    };
    if (relay) {
        config.net_device = { type: "virtio", relay_url: relay, id: 0 };
    }
    emulator = new V86(config);

    emulator.add_listener("serial0-output-byte", (byte) => {
        serialBuffer += String.fromCharCode(byte);
        if (serialBuffer.length > 200000) serialBuffer = serialBuffer.slice(-100000);
        renderSerial();
    });

    emulator.add_listener("download-error", (e) => {
        console.error(e);
        setStatus(t("downloadFail"));
    });

    emulator.add_listener("emulator-ready", () => {
        ready = true;
        el.btnStart.disabled = false;
        setStatus(t("starting"));
        attachOverlay(emulator);
    });

    emulator.add_listener("emulator-started", () => {
        setStatus(t("running"));
        el.btnPause.disabled = false;
        el.btnPause.textContent = "暂停";
        el.btnReset.disabled = false;
        el.btnFull.disabled = false;
        el.btnStart.disabled = true;
        if (config.net_device) setNet("ok", t("netConfigured"));
        else setNet("", "未配置");
    });

    emulator.add_listener("emulator-stopped", () => {
        setStatus(t("paused"));
        el.btnPause.textContent = "继续";
        el.btnStart.disabled = true;
        el.btnReset.disabled = false;
    });
}

let renderQueued = false;
function renderSerial() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
        renderQueued = false;
        const nearBottom = el.serial.scrollTop + el.serial.clientHeight >= el.serial.scrollHeight - 40;
        el.serial.textContent = serialBuffer.slice(-60000);
        if (nearBottom) el.serial.scrollTop = el.serial.scrollHeight;
    });
}

/* --------------------------------- 交互 --------------------------------- */

el.btnStart.onclick = () => {
    if (!emulator) createEmulator();
    setStatus(t("loading"));
    if (ready) emulator.run();
};

el.btnPause.onclick = () => {
    if (!emulator) return;
    if (emulator.is_running && emulator.is_running()) emulator.stop();
    else emulator.run();
};

el.btnReset.onclick = () => {
    if (!emulator) return;
    serialBuffer += "\n[r] " + t("resetMsg") + "\n";
    emulator.restart();
};

el.btnFull.onclick = () => {
    const target = el.screen.parentElement;
    if (document.fullscreenElement) document.exitFullscreen();
    else target.requestFullscreen?.();
};

el.btnPanel.onclick = () => el.side.classList.toggle("hidden");

el.btnClearSerial.onclick = () => {
    serialBuffer = "";
    renderSerial();
};

el.serialForm.onsubmit = (e) => {
    e.preventDefault();
    const text = el.serialIn.value;
    if (!emulator || !text) return;
    emulator.serial0_send(text + "\n");
    el.serialIn.value = "";
};

el.screen.addEventListener("mousedown", () => el.screen.focus());

el.btnNet.onclick = () => {
    const relay = wispUrlForV86();
    if (!relay) {
        setNet("bad", t("netMissing"));
        return;
    }
    if (!confirm(t("confirmReload"))) return;
    try { emulator && emulator.destroy && emulator.destroy(); } catch {}
    emulator = null;
    ready = false;
    serialBuffer = "";
    renderSerial();
    createEmulator();
    emulator.add_listener("emulator-ready", () => emulator.run());
};

el.btnClear.onclick = async () => {
    if (!confirm(t("confirmClear"))) return;
    try {
        const db = await openDB();
        await new Promise((resolve) => {
            const tx = db.transaction("blocks", "readwrite");
            tx.objectStore("blocks").clear();
            tx.oncomplete = resolve;
            tx.onerror = resolve;
        });
        overlay.clear();
        pending.clear();
        location.reload();
    } catch (e) {
        alert("清除失败：" + e.message);
    }
};

window.addEventListener("load", async () => {
    await loadOverlay();
    createEmulator();
    el.btnStart.disabled = false;
    setStatus(t("readyStart"));
});

/* ----------------------------- 手机键盘 & 侧栏 ----------------------------- */

const keybar = document.getElementById("keybar");
const typeForm = document.getElementById("type-form");
const typeIn = document.getElementById("type-in");
const side = el.side;
const panes = {
    term: document.getElementById("pane-term"),
    net: document.getElementById("pane-net"),
    settings: document.getElementById("pane-settings"),
};
const tabs = Array.from(document.querySelectorAll(".tab"));

const SC = {
    esc: [0x01, 0x81],
    tab: [0x0f, 0x8f],
    enter: [0x1c, 0x9c],
    left: [0xe0, 0x4b, 0xe0, 0xcb],
    up: [0xe0, 0x48, 0xe0, 0xc8],
    down: [0xe0, 0x50, 0xe0, 0xd0],
    right: [0xe0, 0x4d, 0xe0, 0xcd],
};
const LETTER = {
    a: 0x1e, b: 0x30, c: 0x2e, d: 0x20, e: 0x12, f: 0x21, g: 0x22, h: 0x23,
    i: 0x17, j: 0x24, k: 0x25, l: 0x26, m: 0x32, n: 0x31, o: 0x18, p: 0x19,
    q: 0x10, r: 0x13, s: 0x1f, t: 0x14, u: 0x16, v: 0x2f, w: 0x11, x: 0x2d,
    y: 0x15, z: 0x2c,
};

let ctrlOn = false;
let altOn = false;

function scancodes(codes) {
    if (!emulator || !emulator.keyboard_send_scancodes) return;
    emulator.keyboard_send_scancodes(codes);
}

function switchTab(name) {
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    Object.entries(panes).forEach(([k, node]) => node.classList.toggle("hidden", k !== name));
}

function openSide(tab = "term") {
    side.classList.remove("hidden");
    switchTab(tab);
}

tabs.forEach((t) => t.onclick = () => switchTab(t.dataset.tab));

document.getElementById("btn-close-side").onclick = () => side.classList.add("hidden");

keybar.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-key]");
    if (!btn) return;
    const key = btn.dataset.key;
    if (key === "ctrl" || key === "alt") {
        const on = key === "ctrl" ? !ctrlOn : !altOn;
        if (key === "ctrl") ctrlOn = on; else altOn = on;
        btn.classList.toggle("on", on);
        scancodes(on ? [key === "ctrl" ? 0x1d : 0x38] : [key === "ctrl" ? 0x9d : 0xb8]);
        return;
    }
    if (SC[key]) scancodes(SC[key]);
});

typeForm.onsubmit = (e) => {
    e.preventDefault();
    if (!emulator) return;
    const text = typeIn.value;
    if (!text) { scancodes(SC.enter); return; }

    const mods = [];
    if (ctrlOn) mods.push(0x1d);
    if (altOn) mods.push(0x38);

    if (mods.length) {
        for (const ch of text) {
            const low = ch.toLowerCase();
            const code = LETTER[low] || (ch === " " ? 0x39 : null);
            if (code) {
                const seq = [...mods, code, 0x80 | code, ...mods.map((m) => 0x80 | m)];
                scancodes(seq);
            }
        }
        ctrlOn = altOn = false;
        keybar.querySelectorAll(".key.on").forEach((b) => b.classList.remove("on"));
        scancodes([0x9d, 0xb8]);
    } else {
        emulator.keyboard_send_text(text);
        scancodes(SC.enter);
    }
    typeIn.value = "";
};

/* 移动端首屏不遮挡画面 */
if (window.matchMedia("(max-width: 900px)").matches) side.classList.add("hidden");

/* 打开控制台时默认显示串口 */
el.btnPanel.onclick = () => {
    if (side.classList.contains("hidden")) openSide("term");
    else side.classList.add("hidden");
};

/* 移动端：点画面先聚焦，便于外接键盘；同时提示串口入口 */
el.screen.addEventListener("click", () => el.screen.focus());

/* ----------------------------- 主题切换 ----------------------------- */

const themeBtn = document.getElementById("btn-theme");
const rootEl = document.documentElement;

function applyTheme(name) {
    if (name === "light") rootEl.dataset.theme = "light";
    else delete rootEl.dataset.theme;
    themeBtn.textContent = name === "light" ? "☀" : "☾";
    try { localStorage.setItem("lih-theme", name); } catch {}
}
applyTheme(localStorage.getItem("lih-theme") || "dark");
themeBtn.onclick = () => applyTheme(rootEl.dataset.theme === "light" ? "dark" : "light");

/* ----------------------------- 引导日志覆盖层 ----------------------------- */

const bootLog = document.getElementById("boot-log");
const bootText = document.getElementById("boot-text");
const bootSkip = document.getElementById("btn-boot-skip");
let bootVisible = false;

function showBootLog() {
    bootVisible = true;
    bootText.textContent = "";
    bootLog.classList.remove("hidden");
}
function hideBootLog() {
    bootVisible = false;
    bootLog.classList.add("hidden");
}
bootSkip.onclick = hideBootLog;

/* 复用串口输出：引导期把日志实时铺在画面上 */
const _renderSerial = renderSerial;
renderSerial = function () {
    _renderSerial();
    if (bootVisible) {
        const nearBottom = bootText.scrollTop + bootText.clientHeight >= bootText.scrollHeight - 40;
        bootText.textContent = serialBuffer.slice(-40000);
        if (nearBottom) bootText.scrollTop = bootText.scrollHeight;
    }
};

el.btnStart.addEventListener("click", showBootLog, true);
el.btnReset.addEventListener("click", showBootLog, true);

/* 看到 login: 或长时间无输出则收起覆盖层 */
setInterval(() => {
    if (bootVisible && /login:/.test(serialBuffer.slice(-2000))) hideBootLog();
}, 1500);
setTimeout(() => { if (bootVisible) hideBootLog(); }, 240000);

/* ----------------------------- 中英文切换 ----------------------------- */

const I18N = {
    zh: {
        start: "启动", pause: "暂停", reset: "重启", full: "全屏", console: "控制台",
        bootTitle: "ttyS0 · 引导日志", skip: "跳过", hint: "手机上先点输入框打字，回车发送；虚拟终端需要已登录。画面卡住时可到「控制台」看内核输出。",
        tabSerial: "串口", tabNet: "网络", collapse: "收起", send: "发送", reconnect: "重连", clearDisk: "清除磁盘改动",
        ready: "准备就绪", netNone: "未连接", netOffline: "网络：未连接",
        wispLabel: "网络中继（WISP，WebSocket）",
        netNote: "浏览器不能直接开 TCP 连接，虚拟机里的网络需要通过这个 WISP 中继转发。本机运行时用自带的 server.js；用 GitHub Pages 打开时请填写一个公网 WISP 地址。",
        typePh: "点这里用手机键盘输入", serialPh: "已登录后在这里发命令",
        readyStart: "准备就绪，点击「启动」", loading: "正在加载镜像（384MB，首次较慢）…",
        starting: "虚拟机已就绪，点击「启动」", running: "运行中", paused: "已暂停",
        downloadFail: "镜像下载失败，检查 images/ 是否完整",
        netConfigured: "已配置（WISP）", netMissing: "请填写 WISP 地址",
        resetMsg: "重启虚拟机…", confirmReload: "重连会重新创建虚拟机，当前未保存的进度会丢失，继续？",
        confirmClear: "清除浏览器里保存的磁盘改动？虚拟机将回到初始镜像状态。",
        tabSet: "设置", mirrorLabel: "apt 镜像源", applyMirror: "应用到 guest",
        mirrorIdle: "未应用", mirrorApplied: "已发送",
        mirrorNote: "首次进系统后以 root 登录，点“应用到 guest”会通过串口执行 mirror 脚本并跑一次 apt-get update。也可以手动执行：mirror tuna。",
    },
    en: {
        start: "Start", pause: "Pause", reset: "Restart", full: "Fullscreen", console: "Console",
        bootTitle: "ttyS0 · boot log", skip: "Skip",
        hint: "Tap the input to type with your phone keyboard. The guest must be logged in; switch to Console for kernel output.",
        tabSerial: "Serial", tabNet: "Network", collapse: "Close", send: "Send", reconnect: "Reconnect", clearDisk: "Reset disk",
        ready: "Ready", netNone: "Not connected", netOffline: "Network: offline",
        wispLabel: "Network relay (WISP over WebSocket)",
        netNote: "Browsers cannot open raw TCP; guest networking is relayed through a WISP endpoint. Use the bundled server.js locally, or enter a public WISP URL when opening from GitHub Pages.",
        typePh: "Tap here to type", serialPh: "Send a command after login",
        readyStart: "Ready — press Start", loading: "Loading image (384 MB, first boot is slow)…",
        starting: "VM ready — press Start", running: "Running", paused: "Paused",
        downloadFail: "Image download failed; check images/",
        netConfigured: "Configured (WISP)", netMissing: "Enter a WISP URL",
        resetMsg: "Restarting VM…", confirmReload: "Reconnect recreates the VM and drops unsaved progress. Continue?",
        confirmClear: "Clear saved disk changes and return to the original image?",
        tabSet: "Settings", mirrorLabel: "apt mirror", applyMirror: "Apply to guest",
        mirrorIdle: "not applied", mirrorApplied: "sent",
        mirrorNote: "Log in as root first. Apply sends the guest-side mirror command over the serial console and runs apt-get update once. Manual: mirror tuna.",
    },
};

let lang = localStorage.getItem("lih-lang") || ((navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en");
const t = (k) => (I18N[lang] && I18N[lang][k]) || I18N.zh[k] || k;

const langBtn = document.getElementById("btn-lang");

function applyLang(next) {
    lang = next;
    document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
    langBtn.textContent = next === "zh" ? "EN" : "中文";
    document.querySelectorAll("[data-i18n]").forEach((n) => { n.textContent = t(n.dataset.i18n); });
    document.querySelectorAll("[data-i18n-ph]").forEach((n) => { n.placeholder = t(n.dataset.i18nPh); });
    try { localStorage.setItem("lih-lang", next); } catch {}
}
applyLang(lang);
langBtn.onclick = () => applyLang(lang === "zh" ? "en" : "zh");

/* ----------------------------- 设置：apt 镜像 ----------------------------- */

const mirrorSel = document.getElementById("mirror");
const mirrorBtn = document.getElementById("btn-apply-mirror");
const mirrorState = document.getElementById("mirror-state");

mirrorSel.value = localStorage.getItem("lih-mirror") || "aliyun";
mirrorSel.onchange = () => {
    try { localStorage.setItem("lih-mirror", mirrorSel.value); } catch {}
    mirrorState.textContent = t("mirrorIdle");
    mirrorState.classList.remove("ok", "bad");
};

mirrorBtn.onclick = () => {
    const name = mirrorSel.value;
    try { localStorage.setItem("lih-mirror", name); } catch {}
    if (!emulator || !emulator.serial0_send) {
        mirrorState.textContent = t("mirrorIdle");
        mirrorState.classList.add("bad");
        return;
    }
    emulator.serial0_send(`mirror ${name}\n`);
    mirrorState.textContent = t("mirrorApplied");
    mirrorState.classList.add("ok");
    mirrorState.classList.remove("bad");
};
