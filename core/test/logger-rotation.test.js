const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LOG_RETENTION_MS,
  buildHourlyLogFilename,
  cleanupExpiredLogFiles
} = require('../src/services/logger');

test('builds hourly log filenames in local time', () => {
  const date = new Date(2026, 6, 11, 15, 42, 30);
  assert.equal(buildHourlyLogFilename('combined', date), 'combined-2026-07-11-15.log');
  assert.equal(buildHourlyLogFilename('error', date), 'error-2026-07-11-15.log');
});

test('removes only managed log files older than 72 hours', () => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-logs-'));
  const now = new Date(2026, 6, 11, 15).getTime();
  const oldTime = new Date(now - LOG_RETENTION_MS - 1000);
  const recentTime = new Date(now - LOG_RETENTION_MS + 1000);
  const oldCombined = path.join(logDir, 'combined-2026-07-08-14.log');
  const recentError = path.join(logDir, 'error-2026-07-08-15.log');
  const unrelated = path.join(logDir, 'custom.log');

  try {
    fs.writeFileSync(oldCombined, 'old');
    fs.writeFileSync(recentError, 'recent');
    fs.writeFileSync(unrelated, 'keep');
    fs.utimesSync(oldCombined, oldTime, oldTime);
    fs.utimesSync(recentError, recentTime, recentTime);
    fs.utimesSync(unrelated, oldTime, oldTime);

    assert.equal(cleanupExpiredLogFiles(logDir, now), 1);
    assert.equal(fs.existsSync(oldCombined), false);
    assert.equal(fs.existsSync(recentError), true);
    assert.equal(fs.existsSync(unrelated), true);
  } finally {
    fs.rmSync(logDir, { recursive: true, force: true });
  }
});
