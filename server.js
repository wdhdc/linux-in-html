#!/usr/bin/env node
/*
 * linux-in-html 本地运行服务
 *  - 静态文件服务（支持 HTTP Range，v86 磁盘按块按需读取）
 *  - WISP 网络中继（浏览器内虚拟机通过 WebSocket 访问真实 TCP 网络）
 *
 *  用法: node server.js [--port 8080] [--host 127.0.0.1] [--allow-any-host]
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const net = require("net");
const { WebSocketServer } = require("ws");

const ROOT = __dirname;
const args = process.argv.slice(2);
function arg(name, def) {
    const i = args.indexOf("--" + name);
    return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const PORT = parseInt(arg("port", "8080"), 10);
const HOST = arg("host", "127.0.0.1");
const BLOCKED = (arg("block", "") || "").split(",").filter(Boolean);

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".wasm": "application/wasm",
    ".img": "application/octet-stream",
    ".zst": "application/octet-stream",
    ".bin": "application/octet-stream",
    ".gz": "application/octet-stream",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".md": "text/markdown; charset=utf-8",
};

function safeJoin(root, urlPath) {
    const p = path.normalize(path.join(root, decodeURIComponent(urlPath)));
    if (!p.startsWith(root)) return null;
    return p;
}

function serveFile(req, res, filePath) {
    let st;
    try {
        st = fs.statSync(filePath);
    } catch {
        res.writeHead(404, { "content-type": "text/plain" });
        return res.end("404 Not Found");
    }
    if (st.isDirectory()) filePath = path.join(filePath, "index.html"), st = fs.statSync(filePath);

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    const range = req.headers.range;

    if (range && /^bytes=/.test(range)) {
        const parts = range.replace(/bytes=/, "").split("-");
        let start = parseInt(parts[0], 10);
        let end = parts[1] ? parseInt(parts[1], 10) : st.size - 1;
        if (isNaN(start)) start = 0;
        if (isNaN(end) || end > st.size - 1) end = st.size - 1;
        if (start >= st.size) {
            res.writeHead(416, { "content-range": `bytes */${st.size}` });
            return res.end();
        }
        res.writeHead(206, {
            "content-type": type,
            "content-length": end - start + 1,
            "content-range": `bytes ${start}-${end}/${st.size}`,
            "accept-ranges": "bytes",
            "cache-control": "no-store",
        });
        const stream = fs.createReadStream(filePath, { start, end });
        stream.pipe(res);
        return;
    }

    res.writeHead(200, {
        "content-type": type,
        "content-length": st.size,
        "accept-ranges": "bytes",
        "cache-control": ext === ".html" ? "no-store" : "max-age=3600",
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
    const url = req.url.split("?")[0];
    if (url === "/healthz") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: true, wisp: "/wisp/" }));
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405);
        return res.end("method not allowed");
    }
    const file = safeJoin(ROOT, url === "/" ? "/index.html" : url);
    if (!file) {
        res.writeHead(403);
        return res.end("forbidden");
    }
    serveFile(req, res, file);
});

/* ------------------------------- WISP relay ------------------------------- */

const MAX_BUFFER = 32;
const TCP_CONNECT_TIMEOUT = 15000;

function frame(type, streamId, payload) {
    const buf = Buffer.alloc(5 + (payload ? payload.length : 0));
    buf[0] = type;
    buf.writeUInt32LE(streamId >>> 0, 1);
    if (payload) payload.copy(buf, 5);
    return buf;
}

function isBlocked(host) {
    const h = host.toLowerCase();
    return BLOCKED.some(b => h === b || h.endsWith("." + b));
}

function wispSession(ws) {
    const streams = new Map();
    let alive = true;

    const sendContinue = (id, n) => {
        const payload = Buffer.alloc(4);
        payload.writeUInt32LE(n, 0);
        ws.send(frame(3, id, payload));
    };

    // 初始缓冲：stream 0 = 协议版本 1
    sendContinue(0, MAX_BUFFER);

    const closeStream = (id, reason) => {
        const s = streams.get(id);
        if (!s) return;
        streams.delete(id);
        try { ws.send(frame(4, id, Buffer.from([reason]))); } catch {}
        if (s.sock && !s.sock.destroyed) s.sock.destroy();
    };

    ws.on("message", (data) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (buf.length < 5) return;
        const type = buf[0];
        const id = buf.readUInt32LE(1);

        switch (type) {
            case 1: { // CONNECT
                if (buf.length < 8) return closeStream(id, 0x41);
                const proto = buf[5];
                const port = buf.readUInt16LE(6);
                const host = buf.slice(8).toString("utf8").trim();
                if (!host || !port) return closeStream(id, 0x41);
                if (isBlocked(host)) return closeStream(id, 0x48);

                if (proto === 2) { // UDP（v86 目前不走这条，但协议要求支持）
                    const dgram = require("dgram");
                    const sock = dgram.createSocket("udp4");
                    const s = { sock, proto, pending: 0 };
                    streams.set(id, s);
                    sock.on("message", (msg) => {
                        if (!alive) return;
                        try { ws.send(frame(2, id, msg)); } catch {}
                    });
                    sock.on("error", () => closeStream(id, 0x42));
                    sock.connect(port, host, () => sendContinue(id, MAX_BUFFER));
                    return;
                }

                const sock = net.connect({ host, port });
                const s = { sock, proto: 1, pending: 0 };
                streams.set(id, s);
                sock.setTimeout(TCP_CONNECT_TIMEOUT, () => closeStream(id, 0x43));
                sock.on("connect", () => {
                    sock.setTimeout(0);
                    s.connected = true;
                    sendContinue(id, MAX_BUFFER);
                });
                sock.on("data", (chunk) => {
                    if (!alive) return;
                    try { ws.send(frame(2, id, chunk)); } catch {}
                });
                sock.on("close", () => closeStream(id, 0x03));
                sock.on("error", (err) => {
                    const reason = err && err.code === "ECONNREFUSED" ? 0x44 : 0x42;
                    closeStream(id, reason);
                });
                return;
            }
            case 2: { // DATA
                const s = streams.get(id);
                if (!s) return;
                const payload = buf.slice(5);
                if (s.proto === 2) s.sock.send(payload);
                else if (s.sock.writable) s.sock.write(payload);
                s.pending++;
                if (s.pending >= MAX_BUFFER) {
                    s.pending = 0;
                    sendContinue(id, MAX_BUFFER);
                }
                return;
            }
            case 4: // CLOSE
                closeStream(id, 0x02);
                return;
            case 3: // CONTINUE (client -> server, not used)
                return;
        }
    });

    ws.on("close", () => {
        alive = false;
        for (const [, s] of streams) {
            if (s.sock && !s.sock.destroyed) s.sock.destroy();
        }
        streams.clear();
    });
    ws.on("error", () => {});
}

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
server.on("upgrade", (req, socket, head) => {
    const url = req.url.split("?")[0];
    if (!url.startsWith("/wisp")) {
        socket.destroy();
        return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
        wispSession(ws);
    });
});

server.listen(PORT, HOST, () => {
    const shown = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
    console.log(`linux-in-html 已启动`);
    console.log(`  页面:     http://${shown}:${PORT}/`);
    console.log(`  网络中继: ws://${shown}:${PORT}/wisp/`);
    console.log(`  停止服务: Ctrl+C`);
});
