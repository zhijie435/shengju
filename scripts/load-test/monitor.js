'use strict';

const os = require('os');
const { execSync } = require('child_process');

/**
 * 系统资源监控模块
 * 支持 macOS (vm_stat / iostat) 和 Linux (/proc/stat / /proc/meminfo)
 */

const platform = os.platform();
const isLinux = platform === 'linux';
const isMacOS = platform === 'darwin';

/** 获取当前时间戳（ISO格式） */
function timestamp() {
  return new Date().toISOString();
}

/** 解析 macOS vm_stat 输出，返回内存使用量（字节） */
function parseMacOSMemory() {
  try {
    const output = execSync('vm_stat', { encoding: 'utf8', timeout: 2000 });
    const pageSize = 16384; // macOS 默认页大小 16KB
    const lines = output.split('\n');
    const getValue = (key) => {
      const line = lines.find((l) => l.includes(key));
      if (!line) return 0;
      const match = line.match(/(\d+)/);
      return match ? parseInt(match[1]) * pageSize : 0;
    };

    const free = getValue('Pages free');
    const active = getValue('Pages active');
    const inactive = getValue('Pages inactive');
    const wired = getValue('Pages wired down');
    const compressed = getValue('Pages occupied by compressor');

    const total = os.totalmem();
    const used = active + wired + compressed;

    return { total, used, free, active, inactive, wired };
  } catch {
    const total = os.totalmem();
    const free = os.freemem();
    return { total, used: total - free, free };
  }
}

/** 解析 Linux /proc/meminfo */
function parseLinuxMemory() {
  try {
    const content = execSync('cat /proc/meminfo', { encoding: 'utf8', timeout: 2000 });
    const getValue = (key) => {
      const line = content.split('\n').find((l) => l.startsWith(key));
      if (!line) return 0;
      const match = line.match(/(\d+)/);
      return match ? parseInt(match[1]) * 1024 : 0; // kB -> bytes
    };

    const total = getValue('MemTotal');
    const free = getValue('MemFree');
    const available = getValue('MemAvailable');
    const buffers = getValue('Buffers');
    const cached = getValue('Cached');
    const used = total - available;

    return { total, used, free: available, buffers, cached };
  } catch {
    const total = os.totalmem();
    const free = os.freemem();
    return { total, used: total - free, free };
  }
}

/** 获取内存信息 */
function getMemoryInfo() {
  if (isMacOS) return parseMacOSMemory();
  if (isLinux) return parseLinuxMemory();
  const total = os.totalmem();
  const free = os.freemem();
  return { total, used: total - free, free };
}

/** macOS CPU 使用率（使用 top 采样一次） */
let _prevCpuTimes = null;

function getMacOSCpuUsage() {
  try {
    const output = execSync(
      "top -l 1 -n 0 | grep 'CPU usage'",
      { encoding: 'utf8', timeout: 3000 }
    );
    const match = output.match(/([\d.]+)%\s+user,\s+([\d.]+)%\s+sys/i);
    if (match) {
      return {
        user: parseFloat(match[1]),
        system: parseFloat(match[2]),
        total: parseFloat(match[1]) + parseFloat(match[2]),
      };
    }
  } catch { /* fallback */ }
  return getCpuUsageFromLoadAvg();
}

/** 通过 /proc/stat 获取 Linux CPU 使用率 */
function getLinuxCpuUsage() {
  try {
    const content = execSync('cat /proc/stat', { encoding: 'utf8', timeout: 2000 });
    const line = content.split('\n').find((l) => l.startsWith('cpu '));
    if (!line) return getCpuUsageFromLoadAvg();

    const parts = line.trim().split(/\s+/).slice(1).map(Number);
    const [user, nice, system, idle, iowait, irq, softirq] = parts;
    const total = user + nice + system + idle + (iowait || 0) + (irq || 0) + (softirq || 0);

    if (_prevCpuTimes) {
      const prevTotal = _prevCpuTimes.total;
      const prevIdle = _prevCpuTimes.idle;
      const deltaTotal = total - prevTotal;
      const deltaIdle = idle - prevIdle;
      const cpuPercent = deltaTotal > 0 ? ((deltaTotal - deltaIdle) / deltaTotal) * 100 : 0;
      _prevCpuTimes = { total, idle };
      return { total: Math.round(cpuPercent * 100) / 100, user, system };
    }

    _prevCpuTimes = { total, idle };
    return getCpuUsageFromLoadAvg();
  } catch {
    return getCpuUsageFromLoadAvg();
  }
}

/** 通过 loadavg 估算 CPU 使用率（通用 fallback） */
function getCpuUsageFromLoadAvg() {
  const cpuCount = os.cpus().length;
  const loadAvg = os.loadavg()[0];
  const estimated = Math.min((loadAvg / cpuCount) * 100, 100);
  return { total: Math.round(estimated * 100) / 100, estimated: true };
}

/** 获取 CPU 使用率 */
function getCpuUsage() {
  if (isMacOS) return getMacOSCpuUsage();
  if (isLinux) return getLinuxCpuUsage();
  return getCpuUsageFromLoadAvg();
}

/** 获取磁盘使用情况 */
function getDiskUsage() {
  try {
    const cmd = isMacOS
      ? "df -k / | tail -1 | awk '{print $2, $3, $4, $5}'"
      : "df -k / | tail -1 | awk '{print $2, $3, $4, $5}'";
    const output = execSync(cmd, { encoding: 'utf8', timeout: 2000 }).trim();
    const [total, used, available, percent] = output.split(/\s+/);
    return {
      total: parseInt(total) * 1024,
      used: parseInt(used) * 1024,
      available: parseInt(available) * 1024,
      percent: parseInt(percent),
    };
  } catch {
    return { total: 0, used: 0, available: 0, percent: 0 };
  }
}

/** 格式化字节为人类可读 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

/** 采集当前系统快照 */
function takeSnapshot(label = 'snapshot') {
  const mem = getMemoryInfo();
  const cpu = getCpuUsage();
  const disk = getDiskUsage();
  const loadAvg = os.loadavg();

  const snapshot = {
    label,
    time: timestamp(),
    cpu: {
      usage: cpu.total,
      user: cpu.user,
      system: cpu.system,
      cores: os.cpus().length,
      loadAvg1m: loadAvg[0],
      loadAvg5m: loadAvg[1],
      loadAvg15m: loadAvg[2],
      estimated: cpu.estimated || false,
    },
    memory: {
      total: mem.total,
      used: mem.used,
      free: mem.free,
      usagePercent: Math.round((mem.used / mem.total) * 100 * 100) / 100,
      totalFormatted: formatBytes(mem.total),
      usedFormatted: formatBytes(mem.used),
      freeFormatted: formatBytes(mem.free || (mem.total - mem.used)),
    },
    disk: {
      total: disk.total,
      used: disk.used,
      available: disk.available,
      usagePercent: disk.percent,
      totalFormatted: formatBytes(disk.total),
      usedFormatted: formatBytes(disk.used),
    },
    platform: {
      os: platform,
      arch: os.arch(),
      hostname: os.hostname(),
      uptime: os.uptime(),
    },
  };

  return snapshot;
}

/** 对比两个快照，计算涨幅 */
function compareSnapshots(before, after) {
  const cpuDelta = after.cpu.usage - before.cpu.usage;
  const memDelta = after.memory.used - before.memory.used;
  const memPercentDelta = after.memory.usagePercent - before.memory.usagePercent;

  return {
    cpu: {
      before: before.cpu.usage,
      after: after.cpu.usage,
      delta: Math.round(cpuDelta * 100) / 100,
      peakLoad: after.cpu.loadAvg1m,
    },
    memory: {
      before: before.memory.used,
      after: after.memory.used,
      delta: memDelta,
      deltaFormatted: formatBytes(Math.abs(memDelta)),
      percentDelta: Math.round(memPercentDelta * 100) / 100,
      afterPercent: after.memory.usagePercent,
    },
    disk: {
      before: before.disk.usagePercent,
      after: after.disk.usagePercent,
    },
  };
}

/** 基于资源使用率推算最大并发承载量 */
function estimateCapacity(snapshot, currentConcurrency, cpuUsageUnderLoad) {
  const cpuUsage = cpuUsageUnderLoad || snapshot.cpu.usage;
  const memUsage = snapshot.memory.usagePercent;
  const cpuCores = snapshot.cpu.cores;

  // CPU 限制：假设 CPU 80% 为安全上限
  const cpuHeadroom = Math.max(0, 80 - cpuUsage);
  const cpuScaleFactor = cpuUsage > 0 ? (80 / cpuUsage) : Infinity;
  const maxByCpu = Math.floor(currentConcurrency * cpuScaleFactor);

  // 内存限制：假设内存 85% 为安全上限
  const memHeadroom = Math.max(0, 85 - memUsage);
  const memScaleFactor = memUsage > 0 ? (85 / memUsage) : Infinity;
  const maxByMem = Math.floor(currentConcurrency * memScaleFactor);

  // 取两者中的最小值
  const maxConcurrency = Math.min(maxByCpu, maxByMem, 5000);

  return {
    currentConcurrency,
    maxByCpu: maxByCpu > 5000 ? '5000+' : maxByCpu,
    maxByMem: maxByMem > 5000 ? '5000+' : maxByMem,
    estimatedMax: maxConcurrency > 5000 ? '5000+' : maxConcurrency,
    cpuUsage,
    memUsage,
    cpuCores,
    recommendation: maxConcurrency < currentConcurrency * 1.2
      ? '当前机器资源接近瓶颈，建议扩容或优化'
      : `估算可承载约 ${maxConcurrency} 并发用户`,
  };
}

/** 持续监控（每 interval ms 采集一次），返回停止函数 */
function startContinuousMonitor(interval = 2000, onSnapshot = null) {
  const snapshots = [];
  let running = true;

  const collect = async () => {
    while (running) {
      const snap = takeSnapshot('runtime');
      snapshots.push(snap);
      if (onSnapshot) onSnapshot(snap);
      await new Promise((r) => setTimeout(r, interval));
    }
  };

  collect().catch(() => {});

  return {
    stop: () => { running = false; },
    getSnapshots: () => snapshots,
    getPeak: () => ({
      cpu: Math.max(...snapshots.map((s) => s.cpu.usage)),
      memory: Math.max(...snapshots.map((s) => s.memory.usagePercent)),
      loadAvg: Math.max(...snapshots.map((s) => s.cpu.loadAvg1m)),
    }),
  };
}

/** 打印快照到控制台 */
function printSnapshot(snapshot) {
  const { cpu, memory, disk } = snapshot;
  console.log(
    `[Monitor ${snapshot.label}] CPU: ${cpu.usage.toFixed(1)}% (Load: ${cpu.loadAvg1m.toFixed(2)}) | ` +
    `MEM: ${memory.usagePercent.toFixed(1)}% (${memory.usedFormatted}/${memory.totalFormatted}) | ` +
    `DISK: ${disk.usagePercent}%`
  );
}

module.exports = {
  takeSnapshot,
  compareSnapshots,
  estimateCapacity,
  startContinuousMonitor,
  printSnapshot,
  formatBytes,
  getMemoryInfo,
  getCpuUsage,
  getDiskUsage,
};
