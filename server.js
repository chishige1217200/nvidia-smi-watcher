#!/usr/bin/env node
/**
 * nvidia-smi watcher
 * nvidia-smi の出力を JSON で公開し、Web ダッシュボードを提供する。
 * 外部依存なし（Node.js >= 18）。
 */
'use strict';

const http = require('http');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const REFRESH_MS = 2000; // nvidia-smi の再実行間隔（キャッシュ TTL）

const GPU_FIELDS = [
  'index',
  'name',
  'memory.total',
  'memory.used',
  'memory.free',
  'utilization.gpu',
  'utilization.memory',
  'temperature.gpu',
  'power.draw',
  'power.limit',
  'fan.speed',
  'clocks.current.graphics',
  'clocks.current.memory',
  'driver_version',
  'uuid',
];

function runNvidia(args) {
  return new Promise((resolve, reject) => {
    execFile('nvidia-smi', args, { timeout: 5000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

// "45 W" / "[N/A]" / "32768 MiB" などから数値を取り出す
function toNum(s) {
  if (s == null) return null;
  const m = String(s).match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function splitCsvLine(line) {
  return line.split(',').map((s) => s.trim());
}

async function fetchGpus() {
  const out = await runNvidia([
    '--query-gpu=' + GPU_FIELDS.join(','),
    '--format=csv,noheader',
  ]);
  const lines = out.trim().split('\n').filter(Boolean);
  return lines.map((line) => {
    let f = splitCsvLine(line);
    // GPU 名にカンマが含まれる場合、余分な列を name に統合する
    while (f.length > GPU_FIELDS.length) {
      const extra = f.length - GPU_FIELDS.length;
      f.splice(1, extra, f.slice(1, 1 + extra).join(', '));
    }
    const g = {};
    GPU_FIELDS.forEach((field, i) => {
      g[field] = f[i];
    });
    return {
      index: toNum(g.index),
      name: g.name || `GPU ${g.index}`,
      memTotalMiB: toNum(g['memory.total']),
      memUsedMiB: toNum(g['memory.used']),
      memFreeMiB: toNum(g['memory.free']),
      utilGpuPct: toNum(g['utilization.gpu']),
      utilMemPct: toNum(g['utilization.memory']),
      tempC: toNum(g['temperature.gpu']),
      powerW: toNum(g['power.draw']),
      powerLimitW: toNum(g['power.limit']),
      fanPct: toNum(g['fan.speed']),
      clockGraphicsMHz: toNum(g['clocks.current.graphics']),
      clockMemoryMHz: toNum(g['clocks.current.memory']),
      driverVersion: g.driver_version,
      uuid: g.uuid,
    };
  });
}

async function fetchProcesses() {
  const out = await runNvidia([
    '--query-compute-apps=pid,gpu_uuid,process_name,used_memory',
    '--format=csv,noheader',
  ]);
  const lines = out.trim().split('\n').filter(Boolean);
  return lines.map((line) => {
    const f = splitCsvLine(line);
    // pid, gpu_uuid, process_name（カンマを含む可能性あり）, used_memory
    const name = f.slice(2, -1).join(', ');
    return {
      pid: toNum(f[0]),
      gpuUuid: f[1],
      name,
      memMiB: toNum(f[f.length - 1]),
    };
  });
}

let cache = { data: null, ts: 0, error: null };

async function getStatus() {
  const now = Date.now();
  if (cache.data && now - cache.ts < REFRESH_MS) return cache;
  try {
    const [gpus, rawProcesses] = await Promise.all([fetchGpus(), fetchProcesses()]);
    const uuidToIndex = new Map(gpus.map((g) => [g.uuid, g.index]));
    const processes = rawProcesses.map((p) => ({
      ...p,
      gpuIndex: p.gpuUuid ? uuidToIndex.get(p.gpuUuid) : null,
    }));
    cache = {
      data: { timestamp: new Date().toISOString(), gpus, processes },
      ts: now,
      error: null,
    };
  } catch (err) {
    // 取得失敗時は直前のデータを保持しつつエラーを通知する
    cache = { data: cache.data, ts: now, error: String((err && err.message) || err) };
  }
  return cache;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/api/status') {
      const st = await getStatus();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(st.error ? { error: st.error, data: st.data } : st.data));
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const file = path.join(__dirname, 'public', 'index.html');
      fs.readFile(file, (err, buf) => {
        if (err) {
          res.writeHead(500);
          res.end('index.html not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(buf);
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(String((err && err.message) || err));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`nvidia-smi watcher listening on http://${HOST}:${PORT}`);
});
