/* linux-in-html 前端：v86 虚拟机控制、串口终端、磁盘增量持久化 */
"use strict";

const DISK_SIZE = 384 * 1024 * 1024;
const DISK_CHUNK = 32 * 1024 * 1024;
const MEMORY_SIZE = 256 * 1024 * 1024;
/* v86 的 block_cache 以 256 字节为一块，磁盘增量必须按同样粒度记录 */
const BLOCK = 256;

const qs = new URLSearchParams(location.search);
const isLocal = ["localhost", "127.0.0.1", "0.0.0.0", ""].includes(location.hostname);

/* GitHub Pages 等静态托管时可用 ?assets=<镜像前缀> 指向磁盘分块所在目录 */
const A = (path) => {
    const base = (qs.get("assets") || "").replace(/\/+$/, "");
    return base ? base + "/" + path : path;
};

/* ------------------------------- 国际化 ------------------------------- */

const I18N = {
    zh: {
        start: "启动", pause: "暂停", resume: "继续", reset: "重启", full: "全屏", console: "控制台",
        bootTitle: "ttyS0 · 引导日志", skip: "跳过",
        hint: "点一下画面再用键盘输入；手机上先点输入框打字，回车发送。虚拟终端需要已登录。画面卡住时可到「控制台」看内核输出。",
        tabSerial: "串口", tabNet: "网络", tabSet: "设置", collapse: "收起", send: "发送",
        reconnect: "重连", clearDisk: "清除磁盘改动", clearLog: "清屏", serialTitle: "ttyS0 · 串口输出",
        ready: "准备就绪", netNone: "未连接", netOffline: "未连接",
        netConfigured: "已配置（WISP）", netMissing: "请填写 WISP 地址",
        wispLabel: "网络中继（WISP，WebSocket）",
        netNote: "浏览器不能直接开 TCP 连接，虚拟机里的网络需要通过这个 WISP 中继转发。本机运行时用自带的 server.js；用 GitHub Pages 打开时请填写一个公网 WISP 地址。启动后页面会自动用 root/root 在 guest 里完成 IP 配置，也可以用下面的按钮重试。",
        guestNetSetup: "配置 guest 网络",
        guestNetIdle: "guest 网络：未配置", guestNetBusy: "guest 网络：配置中…",
        guestNetOk: "guest 网络：已启用", guestNetFail: "guest 网络：配置失败",
        guestNetNA: "guest 网络：无中继",
        typePh: "点这里用手机键盘输入", serialPh: "已登录后在这里发命令",
        readyStart: "准备就绪，点击「启动」", loading: "正在加载虚拟机…", starting: "虚拟机已就绪，点击「启动」",
        running: "运行中", paused: "已暂停", restarting: "正在重启…",
        downloadFail: "镜像下载失败，检查 images/ 是否完整", vmError: "初始化失败，请刷新页面重试",
        netStatusPrefix: "网络：", memLabel: "内存 256MB",
        resetMsg: "重启虚拟机…",
        confirmReload: "重连会重新加载页面并重建虚拟机，未落盘的磁盘改动可能丢失，继续？",
        confirmClear: "清除浏览器里保存的磁盘改动？虚拟机将回到初始镜像状态。",
        mirrorLabel: "apt 镜像源", applyMirror: "应用到 guest", mirrorIdle: "未应用",
        mirrorApplied: "已发送", mirrorNeedVm: "虚拟机未就绪",
        mirrorNote: "首次进系统后以 root 登录，点“应用到 guest”会通过串口执行 mirror 脚本并跑一次 apt-get update。也可以手动执行：mirror tuna。",
        startTitle: "浏览器里的 Debian 12",
        startSub: "真的内核、真的磁盘、真的终端，全部跑在本地 WebAssembly 里。",
        startVm: "启动虚拟机",
        startTip: "登录用户 root，密码 root。首次启动要按需读取磁盘分块，慢一点是正常的。",
        overlaySaved: "磁盘改动已保存在本浏览器", storageFail: "浏览器存储不可用，本次改动不会保存",
        fileProtoError: "请用 node server.js 启动本地服务后访问 http://127.0.0.1:8080/；直接双击 index.html 时浏览器不允许读取虚拟机镜像。",
    },
    en: {
        start: "Start", pause: "Pause", resume: "Resume", reset: "Restart", full: "Fullscreen", console: "Console",
        bootTitle: "ttyS0 · boot log", skip: "Skip",
        hint: "Click the screen to type with a physical keyboard, or use the input below on phones. The guest must be logged in; switch to Console for kernel output.",
        tabSerial: "Serial", tabNet: "Network", tabSet: "Settings", collapse: "Close", send: "Send",
        reconnect: "Reconnect", clearDisk: "Reset disk", clearLog: "Clear", serialTitle: "ttyS0 · serial output",
        ready: "Ready", netNone: "Not connected", netOffline: "Not connected",
        netConfigured: "Configured (WISP)", netMissing: "Enter a WISP URL",
        wispLabel: "Network relay (WISP over WebSocket)",
        netNote: "Browsers cannot open raw TCP; guest networking is relayed through a WISP endpoint. Use the bundled server.js locally, or enter a public WISP URL when opening from GitHub Pages. After boot the page configures the guest IP automatically (root/root); the button below retries it.",
        guestNetSetup: "Set up guest network",
        guestNetIdle: "guest net: not configured", guestNetBusy: "guest net: configuring…",
        guestNetOk: "guest net: ready", guestNetFail: "guest net: failed",
        guestNetNA: "guest net: no relay",
        typePh: "Tap here to type", serialPh: "Send a command after login",
        readyStart: "Ready — press Start", loading: "Loading the VM…", starting: "VM ready — press Start",
        running: "Running", paused: "Paused", restarting: "Restarting…",
        downloadFail: "Image download failed; check images/", vmError: "Initialization failed. Refresh to retry.",
        netStatusPrefix: "Network: ", memLabel: "RAM 256MB",
        resetMsg: "Restarting VM…",
        confirmReload: "Reconnect will reload the page and recreate the VM; unsaved disk writes may be lost. Continue?",
        confirmClear: "Clear saved disk changes and return to the original image?",
        mirrorLabel: "apt mirror", applyMirror: "Apply to guest", mirrorIdle: "not applied",
        mirrorApplied: "sent", mirrorNeedVm: "VM not ready",
        mirrorNote: "Log in as root first. Apply sends the guest-side mirror command over the serial console and runs apt-get update once. Manual: mirror tuna.",
        startTitle: "Debian 12 in your browser",
        startSub: "A real kernel, a real disk and a real terminal, all running locally in WebAssembly.",
        startVm: "Start the virtual machine",
        startTip: "Log in with root / root. The first boot reads disk chunks on demand, so it can take a while.",
        overlaySaved: "Disk changes are saved in this browser", storageFail: "Browser storage unavailable; changes will not persist",
        fileProtoError: "Start the local server with node server.js and open http://127.0.0.1:8080/ — opening index.html from disk is blocked by the browser.",
    },
};

let lang = (() => {
    try {
        const saved = localStorage.getItem("lih-lang");
        if (saved === "zh" || saved === "en") return saved;
    } catch { /* ignore */ }
    return (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
})();

const t = (key) => (I18N[lang] && I18N[lang][key]) || I18N.zh[key] || key;

/* ------------------------------- 元素 ------------------------------- */

const $ = (id) => document.getElementById(id);

const el = {
    screen: $("screen_container"),
    startScreen: $("start-screen"),
    startError: $("start-error"),
    serial: $("serial-out"),
    serialForm: $("serial-form"),
    serialIn: $("serial-in"),
    wisp: $("wisp"),
    netState: $("net-state"),
    guestNetState: $("guest-net-state"),
    btnGuestNet: $("btn-guest-net"),
    status: $("status"),
    statNet: $("stat-net"),
    statMem: $("stat-mem"),
    btnStart: $("btn-start"),
    btnStartBig: $("btn-start-big"),
    btnPause: $("btn-pause"),
    btnReset: $("btn-reset"),
    btnFull: $("btn-full"),
    btnPanel: $("btn-panel"),
    btnNet: $("btn-net"),
    btnClearDisk: $("btn-clear-disk"),
    btnClearSerial: $("btn-clear-serial"),
    btnLang: $("btn-lang"),
    btnTheme: $("btn-theme"),
    btnCloseSide: $("btn-close-side"),
    btnBootSkip: $("btn-boot-skip"),
    side: $("side"),
    keybar: $("keybar"),
    tabs: $("tabs"),
    typeForm: $("type-form"),
    typeIn: $("type-in"),
    bootLog: $("boot-log"),
    bootText: $("boot-text"),
    mirror: $("mirror"),
    mirrorBtn: $("btn-apply-mirror"),
    mirrorState: $("mirror-state"),
    panes: {
        term: $("pane-term"),
        net: $("pane-net"),
        settings: $("pane-settings"),
    },
};

/* ------------------------------- 状态 ------------------------------- */

let emulator = null;
let vmReady = false;
let vmRunning = false;
let vmPaused = false;
let everStarted = false;
let pendingStart = false;
let statusKey = "readyStart";
let netState = { cls: "", key: "netOffline" };
let guestNet = "idle"; /* idle | busy | ok | fail | na */
let mirrorKey = "mirrorIdle";
let mirrorCls = "";

let serialBuffer = "";
let paintQueued = false;
let lastSerialText = "";

let overlay = new Map();     // v86 block 序号（256B）-> Uint8Array(256)
let pendingWrites = new Set();
let flushing = false;
let flushTimer = 0;
let dbPromise = null;

let bootVisible = false;
let bootStartIndex = 0;
let bootTimer = 0;

/* ------------------------------- 文案渲染 ------------------------------- */

function setStatus(key) {
    statusKey = key;
    if (el.status) el.status.textContent = t(key);
}

function setNet(cls, key) {
    netState = { cls, key };
    if (!el.netState) return;
    el.netState.textContent = t(key);
    el.netState.className = "badge " + (cls || "");
    if (el.statNet) el.statNet.textContent = t("netStatusPrefix") + t(key);
}

function renderPause() {
    if (!el.btnPause) return;
    el.btnPause.textContent = vmPaused ? t("resume") : t("pause");
}

function renderMirror() {
    if (!el.mirrorState) return;
    el.mirrorState.textContent = t(mirrorKey);
    el.mirrorState.className = "badge " + (mirrorCls || "");
}

function renderGuestNet() {
    if (!el.guestNetState) return;
    const keys = { idle: "guestNetIdle", busy: "guestNetBusy", ok: "guestNetOk", fail: "guestNetFail", na: "guestNetNA" };
    const cls = { idle: "", busy: "", ok: "ok", fail: "bad", na: "" };
    el.guestNetState.textContent = t(keys[guestNet] || "guestNetIdle");
    el.guestNetState.className = "badge " + (cls[guestNet] || "");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sendSerialLine(line) {
    if (!emulator || typeof emulator.serial0_send !== "function") return;
    emulator.serial0_send(line + "\n");
}

function waitSerial(pattern, timeout, from) {
    const start = from || 0;
    return new Promise((resolve) => {
        const t0 = Date.now();
        const timer = setInterval(() => {
            const ok = pattern.test(serialBuffer.slice(start));
            if (ok || Date.now() - t0 > timeout) {
                clearInterval(timer);
                resolve(ok);
            }
        }, 200);
    });
}

async function waitForShellOrLogin(timeout) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        const tail = serialBuffer.slice(-600);
        if (/#\s*$/.test(tail)) return "shell";
        if (/login:\s*$/.test(tail)) return "login";
        await sleep(250);
    }
    return null;
}

async function loginRootOnSerial() {
    let from = serialBuffer.length;
    sendSerialLine("root");
    if (!(await waitSerial(/Password:\s*$/, 6000, from))) return false;
    from = serialBuffer.length;
    sendSerialLine("root");
    return waitSerial(/#\s*$/, 10000, from);
}

/* guest 里的网卡默认没有配置 IP：自动用 root/root 登录串口控制台并设置 v86 约定的静态地址 */
async function configureGuestNetwork() {
    if (!emulator || typeof emulator.serial0_send !== "function") return;
    if (!wispUrlForV86()) {
        guestNet = "na";
        renderGuestNet();
        return;
    }
    if (guestNet === "busy" || guestNet === "ok") return;
    guestNet = "busy";
    renderGuestNet();
    try {
        const state = await waitForShellOrLogin(150000);
        if (state === null) throw new Error("timeout waiting for the serial console");
        if (state === "login" && !(await loginRootOnSerial())) throw new Error("root login failed");

        const commands = [
            "IF=$(ls /sys/class/net | grep -v '^lo' | head -n1)",
            "ip link set $IF up",
            "ip addr add 192.168.86.100/24 dev $IF 2>/dev/null",
            "ip route replace default via 192.168.86.1 dev $IF",
            "printf 'nameserver 192.168.86.1\\n' > /etc/resolv.conf",
        ];
        for (const line of commands) {
            sendSerialLine(line);
            await sleep(220);
        }
        const from = serialBuffer.length;
        sendSerialLine("ip -4 addr show $IF | grep 'inet '");
        const ok = await waitSerial(/inet 192\.168\.86\.100/, 8000, from);
        guestNet = ok ? "ok" : "fail";
    } catch (err) {
        console.warn("[lih] guest network setup failed:", err);
        guestNet = "fail";
    }
    renderGuestNet();
}

/* ------------------------------- IndexedDB 磁盘增量 ------------------------------- */

function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        if (!("indexedDB" in window)) {
            reject(new Error("IndexedDB unavailable"));
            return;
        }
        const req = indexedDB.open("linux-in-html", 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("blocks")) db.createObjectStore("blocks");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
        req.onblocked = () => reject(new Error("IndexedDB blocked"));
    }).catch((err) => {
        dbPromise = null;
        throw err;
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
                if (!cur) return;
                overlay.set(Number(cur.key), new Uint8Array(cur.value));
                cur.continue();
            };
            tx.oncomplete = resolve;
            tx.onerror = resolve;
            tx.onabort = resolve;
        });
        if (overlay.size) console.info(`[lih] loaded ${overlay.size} disk blocks from IndexedDB`);
        return true;
    } catch (err) {
        console.warn("[lih] overlay load failed:", err);
        return false;
    }
}

async function flushOverlay() {
    if (flushing || pendingWrites.size === 0) return;
    flushing = true;
    const ids = [...pendingWrites];
    pendingWrites.clear();
    try {
        const db = await openDB();
        await new Promise((resolve) => {
            const tx = db.transaction("blocks", "readwrite");
            const store = tx.objectStore("blocks");
            for (const id of ids) {
                const block = overlay.get(id);
                if (block) store.put(block, id);
            }
            tx.oncomplete = resolve;
            tx.onerror = resolve;
            tx.onabort = resolve;
        });
    } catch (err) {
        console.warn("[lih] overlay flush failed:", err);
    } finally {
        flushing = false;
        if (pendingWrites.size) scheduleFlush();
    }
}

function scheduleFlush() {
    if (flushTimer || flushing || pendingWrites.size === 0) return;
    flushTimer = setTimeout(() => {
        flushTimer = 0;
        flushOverlay();
    }, 600);
}

/* ------------------------------- 磁盘写 hook ------------------------------- */

function diskBufferOf(emu) {
    try {
        const ide = emu && emu.v86 && emu.v86.cpu && emu.v86.cpu.devices && emu.v86.cpu.devices.ide;
        const drive = ide && ide.primary && ide.primary.master;
        const buf = drive && drive.buffer;
        return buf && typeof buf.set === "function" && buf.block_cache instanceof Map ? buf : null;
    } catch {
        return null;
    }
}

function recordWrite(offset, data) {
    const first = Math.floor(offset / BLOCK);
    const last = Math.ceil((offset + data.length) / BLOCK);
    for (let idx = first; idx < last; idx++) {
        const blockStart = idx * BLOCK;
        const from = Math.max(0, blockStart - offset);
        const to = Math.min(data.length, blockStart + BLOCK - offset);
        if (to <= from) continue;
        let block = overlay.get(idx);
        if (!block) block = new Uint8Array(BLOCK);
        block.set(data.subarray(from, to), Math.max(0, offset - blockStart));
        overlay.set(idx, block);
        pendingWrites.add(idx);
    }
    scheduleFlush();
}

function attachDiskOverlay(emu) {
    const disk = diskBufferOf(emu);
    if (!disk) {
        console.warn("[lih] disk overlay disabled: v86 disk buffer not found");
        return false;
    }
    for (const [idx, bytes] of overlay) {
        disk.block_cache.set(idx, bytes);
        disk.block_cache_is_write.add(idx);
    }
    const originalSet = disk.set.bind(disk);
    disk.set = function (offset, data, callback) {
        originalSet(offset, data, callback);
        try {
            recordWrite(offset, data);
        } catch (err) {
            console.warn("[lih] record disk write failed:", err);
        }
    };
    console.info(`[lih] disk overlay attached (${overlay.size} blocks)`);
    return true;
}

/* ------------------------------- 串口 & 引导日志 ------------------------------- */

let serialTruncated = 0;
const SERIAL_LIMIT = 240000;
const SERIAL_KEEP = 120000;

function onSerialByte(byte) {
    serialBuffer += String.fromCharCode(byte & 0xff);
    if (serialBuffer.length > SERIAL_LIMIT) {
        const cut = serialBuffer.length - SERIAL_KEEP;
        serialBuffer = serialBuffer.slice(cut);
        serialTruncated += cut;
    }
    schedulePaint();
}

function schedulePaint() {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(paint);
}

function paint() {
    paintQueued = false;
    paintSerial();
    if (bootVisible) paintBoot();
}

function paintSerial() {
    if (!el.serial) return;
    const text = displayText(serialBuffer.slice(-80000));
    if (text === lastSerialText) return;
    const nearBottom = el.serial.scrollTop + el.serial.clientHeight >= el.serial.scrollHeight - 60;
    el.serial.textContent = text;
    lastSerialText = text;
    if (nearBottom) el.serial.scrollTop = el.serial.scrollHeight;
}

/* 串口是原始字节流，去掉 ANSI 转义 / 回车等控制字符，方便阅读 */
function displayText(raw) {
    return raw
        .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
        .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
        .replace(/\u001b[()][A-Za-z0-9]/g, "")
        .replace(/\u001b[@-_]/g, "")
        .replace(/\r/g, "")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function bootTail() {
    const from = Math.max(0, bootStartIndex - serialTruncated);
    const tail = serialBuffer.slice(from);
    return tail.length > 40000 ? tail.slice(-40000) : tail;
}

function paintBoot() {
    if (!el.bootText) return;
    const tail = bootTail();
    const nearBottom = el.bootText.scrollTop + el.bootText.clientHeight >= el.bootText.scrollHeight - 60;
    el.bootText.textContent = displayText(tail);
    if (nearBottom) el.bootText.scrollTop = el.bootText.scrollHeight;
    if (/login:\s*$/.test(tail)) hideBootLog();
}

function showBootLog() {
    if (!el.bootLog) return;
    bootVisible = true;
    bootStartIndex = serialBuffer.length + serialTruncated;
    lastSerialText = "";
    paintSerial();
    paintBoot();
    el.bootLog.classList.remove("hidden");
    hideStartScreen();
    clearTimeout(bootTimer);
    bootTimer = setTimeout(hideBootLog, 240000);
}

function hideBootLog() {
    bootVisible = false;
    if (el.bootLog) el.bootLog.classList.add("hidden");
    clearTimeout(bootTimer);
    bootTimer = 0;
}

/* ------------------------------- 界面状态 ------------------------------- */

function hideStartScreen() {
    if (el.startScreen) el.startScreen.classList.add("hidden");
}

function showStartError(message) {
    if (!el.startError) return;
    if (!message) {
        el.startError.textContent = "";
        el.startError.classList.add("hidden");
        return;
    }
    el.startError.textContent = message;
    el.startError.classList.remove("hidden");
    if (el.startScreen) el.startScreen.classList.remove("hidden");
}

function setRunning(running) {
    vmRunning = running;
    vmPaused = !running && everStarted;
    if (el.btnPause) el.btnPause.disabled = !vmReady;
    if (el.btnReset) el.btnReset.disabled = !vmReady;
    if (el.btnFull) el.btnFull.disabled = !vmReady;
    if (el.btnStart) el.btnStart.disabled = running;
    if (el.btnStartBig) el.btnStartBig.disabled = running;
    renderPause();
}

/* ------------------------------- 虚拟机 ------------------------------- */

const defaultWisp = isLocal && location.protocol !== "file:"
    ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/wisp/`
    : "";

function readSavedWisp() {
    try {
        return localStorage.getItem("lih-wisp") || "";
    } catch {
        return "";
    }
}

function initWispField() {
    if (!el.wisp) return;
    const fromQuery = qs.get("wisp");
    el.wisp.value = fromQuery || readSavedWisp() || defaultWisp;
}

function normalizeWisp(raw) {
    const value = (raw || "").trim();
    if (!value) return "";
    if (!/^(wss?|wisps?):\/\//i.test(value)) return null;
    return value;
}

function wispUrlForV86() {
    const value = normalizeWisp(el.wisp && el.wisp.value);
    if (!value) return null;
    return value.replace(/^ws(s?):/i, "wisp$1:");
}

function createEmulator() {
    if (emulator) return emulator;
    if (typeof V86 !== "function") {
        setStatus("vmError");
        showStartError(t("vmError") + " (lib/v86.js)");
        return null;
    }

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
        disable_speaker: true,
    };

    const relay = wispUrlForV86();
    if (relay) config.net_device = { type: "virtio", relay_url: relay, id: 0 };

    emulator = new V86(config);

    emulator.add_listener("serial0-output-byte", onSerialByte);

    emulator.add_listener("download-error", (event) => {
        console.error("[lih] download error", event);
        setStatus("downloadFail");
        showStartError(t("downloadFail"));
    });

    emulator.add_listener("emulator-ready", () => {
        vmReady = true;
        if (el.btnStart) el.btnStart.disabled = false;
        const attached = attachDiskOverlay(emulator);
        if (!attached && overlay.size) {
            console.warn("[lih] saved disk changes could not be applied");
        }
        if (pendingStart) {
            pendingStart = false;
            startVM();
        } else {
            setStatus("starting");
        }
        setNet("", "netNone");
    });

    emulator.add_listener("emulator-loaded", () => {
        if (!vmRunning && !pendingStart) setStatus("starting");
    });

    emulator.add_listener("emulator-started", () => {
        everStarted = true;
        setRunning(true);
        setStatus("running");
        hideStartScreen();
        hideStartErrorOnly();
        setNet(relay ? "ok" : "", relay ? "netConfigured" : "netNone");
        if (relay) configureGuestNetwork();
        else { guestNet = "na"; renderGuestNet(); }
    });

    emulator.add_listener("emulator-stopped", () => {
        setRunning(false);
        setStatus("paused");
    });

    return emulator;
}

function hideStartErrorOnly() {
    if (!el.startError) return;
    el.startError.classList.add("hidden");
    el.startError.textContent = "";
}

function startVM() {
    if (!emulator) return;
    if (vmRunning) return;
    if (!vmReady) {
        pendingStart = true;
        setStatus("loading");
        showBootLog();
        return;
    }
    hideStartErrorOnly();
    /* 只有第一次启动 / 重启时才弹引导日志；从暂停恢复时直接继续 */
    if (!everStarted) showBootLog();
    else hideBootLog();
    setStatus(vmPaused ? "running" : "loading");
    try {
        emulator.run();
    } catch (err) {
        console.error("[lih] run failed", err);
        setStatus("vmError");
        showStartError(t("vmError"));
    }
}

function isRunning() {
    if (!emulator) return false;
    try {
        return typeof emulator.is_running === "function" ? !!emulator.is_running() : vmRunning;
    } catch {
        return vmRunning;
    }
}

/* ------------------------------- 主题 / 语言 ------------------------------- */

const rootEl = document.documentElement;

function applyTheme(name) {
    if (name === "light") rootEl.dataset.theme = "light";
    else delete rootEl.dataset.theme;
    if (el.btnTheme) el.btnTheme.textContent = name === "light" ? "☀" : "🌙";
    try { localStorage.setItem("lih-theme", name); } catch { /* ignore */ }
}

function applyLang(next) {
    lang = next === "en" ? "en" : "zh";
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    if (el.btnLang) el.btnLang.textContent = lang === "zh" ? "EN" : "中文";
    document.querySelectorAll("[data-i18n]").forEach((node) => {
        node.textContent = t(node.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-ph]").forEach((node) => {
        node.placeholder = t(node.dataset.i18nPh);
    });
    if (el.statMem) el.statMem.textContent = t("memLabel");
    setStatus(statusKey);
    setNet(netState.cls, netState.key);
    renderPause();
    renderMirror();
    renderGuestNet();
    try { localStorage.setItem("lih-lang", lang); } catch { /* ignore */ }
}

/* ------------------------------- 侧栏 / tab ------------------------------- */

function switchTab(name) {
    Object.entries(el.panes).forEach(([key, node]) => {
        if (node) node.classList.toggle("hidden", key !== name);
    });
    el.tabs && el.tabs.querySelectorAll(".tab").forEach((tab) => {
        tab.classList.toggle("active", tab.dataset.tab === name);
    });
}

function openSide(tab = "term") {
    if (!el.side) return;
    el.side.classList.remove("hidden");
    switchTab(tab);
}

function toggleSide() {
    if (!el.side) return;
    if (el.side.classList.contains("hidden")) openSide("term");
    else el.side.classList.add("hidden");
}

/* ------------------------------- 键盘输入 ------------------------------- */

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
    "0": 0x0b, "1": 0x02, "2": 0x03, "3": 0x04, "4": 0x05, "5": 0x06,
    "6": 0x07, "7": 0x08, "8": 0x09, "9": 0x0a, " ": 0x39, "-": 0x0c, "=": 0x0d,
    "[": 0x1a, "]": 0x1b, "\\": 0x2b, ";": 0x27, "'": 0x28, ",": 0x33,
    ".": 0x34, "/": 0x35, "`": 0x29,
};

let ctrlOn = false;
let altOn = false;

function sendScancodes(codes) {
    if (!emulator || typeof emulator.keyboard_send_scancodes !== "function") return;
    emulator.keyboard_send_scancodes(codes);
}

function resetModifiers() {
    if (ctrlOn) sendScancodes([0x9d]);
    if (altOn) sendScancodes([0xb8]);
    ctrlOn = false;
    altOn = false;
    el.keybar && el.keybar.querySelectorAll(".key.on").forEach((btn) => btn.classList.remove("on"));
}

function typeText(text) {
    if (!emulator || !text) return;
    if (ctrlOn || altOn) {
        const mods = [];
        if (ctrlOn) mods.push(0x1d);
        if (altOn) mods.push(0x38);
        for (const ch of text) {
            const low = ch.toLowerCase();
            const code = LETTER[low];
            if (code === undefined) continue;
            sendScancodes([...mods, code, 0x80 | code]);
        }
        resetModifiers();
        return;
    }
    try {
        Promise.resolve(emulator.keyboard_send_text(text)).catch(() => {});
    } catch {
        /* older builds: fall back to scancodes */
        for (const ch of text) {
            const code = LETTER[ch.toLowerCase()];
            if (code !== undefined) sendScancodes([code, 0x80 | code]);
        }
    }
}

/* ------------------------------- 事件绑定 ------------------------------- */

function bindUi() {
    /* 顶栏 */
    if (el.btnStart) el.btnStart.onclick = () => startVM();
    if (el.btnStartBig) el.btnStartBig.onclick = () => startVM();

    if (el.btnPause) el.btnPause.onclick = () => {
        if (!emulator) return;
        if (isRunning()) {
            emulator.stop();
            vmPaused = true;
            renderPause();
            setStatus("paused");
        } else {
            startVM();
        }
    };

    if (el.btnReset) el.btnReset.onclick = () => {
        if (!emulator) return;
        showBootLog();
        setStatus("restarting");
        try {
            emulator.restart();
            if (!isRunning()) emulator.run();
            /* 重启时 CPU 已在运行，不会再触发 emulator-started，这里把状态收回「运行中」 */
            setTimeout(() => { if (vmRunning) setStatus("running"); }, 1500);
        } catch (err) {
            console.error("[lih] restart failed", err);
            setStatus("vmError");
        }
    };

    if (el.btnFull) el.btnFull.onclick = () => {
        const target = document.querySelector(".screen-wrap");
        if (!target) return;
        if (document.fullscreenElement) {
            document.exitFullscreen && document.exitFullscreen();
        } else if (target.requestFullscreen) {
            target.requestFullscreen().catch(() => {
                setStatus("vmError");
            });
        }
    };

    if (el.btnPanel) el.btnPanel.onclick = () => toggleSide();
    if (el.btnCloseSide) el.btnCloseSide.onclick = () => el.side && el.side.classList.add("hidden");

    /* tab */
    if (el.tabs) {
        el.tabs.addEventListener("click", (event) => {
            const tab = event.target.closest(".tab");
            if (tab && tab.dataset.tab) switchTab(tab.dataset.tab);
        });
    }

    /* 主题 / 语言 */
    if (el.btnTheme) {
        el.btnTheme.onclick = () => applyTheme(rootEl.dataset.theme === "light" ? "dark" : "light");
    }
    if (el.btnLang) {
        el.btnLang.onclick = () => applyLang(lang === "zh" ? "en" : "zh");
    }

    /* 引导日志 */
    if (el.btnBootSkip) el.btnBootSkip.onclick = () => hideBootLog();

    /* 串口 */
    if (el.serialForm) {
        el.serialForm.onsubmit = (event) => {
            event.preventDefault();
            if (!el.serialIn) return;
            const text = el.serialIn.value;
            if (!emulator || typeof emulator.serial0_send !== "function" || !text) return;
            emulator.serial0_send(text + "\n");
            el.serialIn.value = "";
        };
    }
    if (el.btnClearSerial) {
        el.btnClearSerial.onclick = () => {
            serialBuffer = "";
            serialTruncated = 0;
            lastSerialText = "";
            if (el.serial) el.serial.textContent = "";
            if (bootVisible) bootStartIndex = 0;
        };
    }

    /* 移动键盘 */
    if (el.keybar) {
        el.keybar.addEventListener("click", (event) => {
            const btn = event.target.closest("button[data-key]");
            if (!btn) return;
            const key = btn.dataset.key;
            if (key === "ctrl" || key === "alt") {
                if (key === "ctrl") {
                    ctrlOn = !ctrlOn;
                    sendScancodes(ctrlOn ? [0x1d] : [0x9d]);
                    btn.classList.toggle("on", ctrlOn);
                } else {
                    altOn = !altOn;
                    sendScancodes(altOn ? [0x38] : [0xb8]);
                    btn.classList.toggle("on", altOn);
                }
                return;
            }
            const codes = SC[key];
            if (codes) sendScancodes(codes);
        });
    }

    if (el.typeForm) {
        el.typeForm.onsubmit = (event) => {
            event.preventDefault();
            if (!emulator) {
                setStatus("readyStart");
                return;
            }
            const text = el.typeIn ? el.typeIn.value : "";
            if (!text) {
                resetModifiers();
                sendScancodes(SC.enter);
                return;
            }
            typeText(text);
            if (el.typeIn) el.typeIn.value = "";
            setTimeout(() => sendScancodes(SC.enter), 10);
        };
    }

    /* 画面点击：聚焦，便于外接键盘 */
    if (el.screen) {
        el.screen.addEventListener("mousedown", () => el.screen.focus());
        el.screen.addEventListener("click", () => el.screen.focus());
    }

    /* 网络 */
    if (el.wisp) {
        el.wisp.addEventListener("change", () => {
            try { localStorage.setItem("lih-wisp", (el.wisp.value || "").trim()); } catch { /* ignore */ }
        });
    }
    if (el.btnNet) {
        el.btnNet.onclick = async () => {
            const value = normalizeWisp(el.wisp && el.wisp.value);
            if (value === null) {
                setNet("bad", "netMissing");
                if (el.wisp) el.wisp.focus();
                return;
            }
            try { localStorage.setItem("lih-wisp", value); } catch { /* ignore */ }
            if (!confirm(t("confirmReload"))) return;
            await flushOverlay();
            location.reload();
        };
    }

    if (el.btnGuestNet) {
        el.btnGuestNet.onclick = () => {
            if (guestNet === "busy") return;
            guestNet = "idle";
            configureGuestNetwork();
        };
    }

    if (el.btnClearDisk) {
        el.btnClearDisk.onclick = async () => {
            if (!confirm(t("confirmClear"))) return;
            try {
                const db = await openDB();
                await new Promise((resolve) => {
                    const tx = db.transaction("blocks", "readwrite");
                    tx.objectStore("blocks").clear();
                    tx.oncomplete = resolve;
                    tx.onerror = resolve;
                    tx.onabort = resolve;
                });
                overlay.clear();
                pendingWrites.clear();
                location.reload();
            } catch (err) {
                alert("清除失败：" + (err && err.message ? err.message : err));
            }
        };
    }

    /* 设置：apt 镜像 */
    if (el.mirror) {
        el.mirror.onchange = () => {
            try { localStorage.setItem("lih-mirror", el.mirror.value); } catch { /* ignore */ }
            mirrorKey = "mirrorIdle";
            mirrorCls = "";
            renderMirror();
        };
    }
    if (el.mirrorBtn) {
        el.mirrorBtn.onclick = () => {
            const name = el.mirror ? el.mirror.value : "aliyun";
            try { localStorage.setItem("lih-mirror", name); } catch { /* ignore */ }
            if (!emulator || typeof emulator.serial0_send !== "function") {
                mirrorKey = "mirrorNeedVm";
                mirrorCls = "bad";
                renderMirror();
                return;
            }
            emulator.serial0_send(`mirror ${name}\n`);
            mirrorKey = "mirrorApplied";
            mirrorCls = "ok";
            renderMirror();
        };
    }

    /* 页面控制件获得焦点时，不要把按键再送进 guest（v86 监听的是 window） */
    window.addEventListener("keydown", (event) => {
        const target = event.target;
        if (target && target.tagName) {
            const tag = target.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || tag === "A")
                event.stopPropagation();
        }
    }, true);
}

/* ------------------------------- 启动流程 ------------------------------- */

function initThemeAndLang() {
    let theme = "dark";
    try { theme = localStorage.getItem("lih-theme") || "dark"; } catch { /* ignore */ }
    applyTheme(theme === "light" ? "light" : "dark");
    applyLang(lang);
}

async function boot() {
    bindUi();
    initThemeAndLang();
    initWispField();

    if (location.protocol === "file:") {
        setStatus("vmError");
        showStartError(t("fileProtoError"));
        return;
    }
    try {
        if (el.mirror) el.mirror.value = localStorage.getItem("lih-mirror") || "aliyun";
    } catch { /* ignore */ }

    if (window.matchMedia("(max-width: 900px)").matches && el.side) el.side.classList.add("hidden");

    setStatus("loading");
    const storageOk = await loadOverlay();
    if (!storageOk) console.warn("[lih]", t("storageFail"));

    setStatus("loading");
    createEmulator();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
} else {
    boot();
}

/* 离开页面时尽量把磁盘增量落盘 */
window.addEventListener("pagehide", () => { flushOverlay(); });
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushOverlay();
});
