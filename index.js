#!/usr/bin/env bun

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ================== 基础路径 ==================
const ROOT = path.join(process.cwd(), ".npm");
fs.mkdirSync(ROOT, { recursive: true });

const BIN = path.join(ROOT, "hysteria");
const CONF = path.join(ROOT, "config.yaml");
const CERT = path.join(ROOT, "cert.pem");
const KEY = path.join(ROOT, "private.key");

// ================== 环境变量（Northflank 注入） ==================
const PASSWORD = process.env.PASSWORD || "test-password";
const PORT = process.env.PORT || 10280;
const SERVER_IP = process.env.SERVER_IP || "127.0.0.1";

// ================== 内存日志 ==================
let logBuffer = [];
function log(msg) {
  logBuffer.push(`[${new Date().toISOString()}] ${msg}`);
}

function flushLog() {
  if (logBuffer.length > 0) {
    fs.appendFileSync(path.join(ROOT, "run.log"), logBuffer.join("\n") + "\n");
    logBuffer = [];
  }
}

// ================== 下载 Hysteria2 原生二进制 ==================
function installHysteria() {
  if (fs.existsSync(BIN)) {
    log("hysteria 已存在，跳过下载");
    return;
  }

  const url = "https://github.com/apernet/hysteria/releases/latest/download/hysteria-linux-amd64";
  const tmp = path.join(ROOT, "hysteria.tmp");

  log(`开始下载 hysteria: ${url}`);
  execSync(`curl -L -o "${tmp}" "${url}"`);

  const buf = fs.readFileSync(tmp);
  if (buf.slice(0, 2).toString() !== "\x7fE") {
    throw new Error("下载的不是 ELF 可执行文件，可能被 GitHub 重定向成 HTML 了");
  }

  fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, BIN);
  log("hysteria 安装完成");
}

// ================== 生成证书 ==================
function ensureCert() {
  if (fs.existsSync(CERT) && fs.existsSync(KEY)) {
    log("证书已存在");
    return;
  }

  execSync(`openssl ecparam -genkey -name prime256v1 -out "${KEY}"`);
  execSync(
    `openssl req -new -x509 -days 3650 -key "${KEY}" -out "${CERT}" -subj "/CN=bing.com"`
  );
  fs.chmodSync(KEY, 0o600);

  log("自签证书生成完成");
}

// ================== 生成 Hysteria2 配置 ==================
function writeConfig() {
  const cfg = `
listen: :${PORT}

auth:
  type: password
  password: ${PASSWORD}

tls:
  cert: ${CERT}
  key: ${KEY}
  disableSessionResumption: true
  alpn: []

log:
  level: warn

transport:
  udp:
    congestionControl: none
    hopInterval: 0
    recvBuffer: 524288
    sendBuffer: 524288
    mtu: 1200

server:
  workerThreads: 1
  maxConn: 5
  disableUDP: true
  udpIdleTimeout: 30s
  udpBatchSize: 1
  preferIPv6: false
`.trimStart();

  fs.writeFileSync(CONF, cfg);
  log("config.yaml 已生成");

  const share = `hysteria2://${PASSWORD}@${SERVER_IP}:${PORT}/?insecure=1&alpn=h3&peer=www.bing.com#northflank`;
  fs.writeFileSync(path.join(ROOT, "share.txt"), share);

  log(`分享链接: ${share}`);
  flushLog();
}

// ================== 启动 hysteria（前台模式） ==================
function start() {
  log("准备启动 hysteria");

  const child = spawn(
    BIN,
    ["server", "-c", CONF],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        GOMAXPROCS: "1",
        GOGC: "500",
        HY_NO_LOG_COLOR: "1",
        HY_UDP_BATCH: "0"
      }
    }
  );

  child.on("exit", (code) => {
    log(`hysteria 退出，code=${code}`);
    flushLog();
    process.exit(code);
  });

  log("hysteria 已启动（前台模式）");
  flushLog();
}

// ================== 主流程 ==================
installHysteria();
ensureCert();
writeConfig();
start();
