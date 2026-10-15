#!/usr/bin/env node
/**
 * Summarise an Artillery JSON report (and optional backend resource samples).
 *
 * Usage: node tests/load/summarize.mjs <report.json> [resources.csv] [summary.md]
 *
 * Prints latency percentiles, throughput, error rate, peak concurrency, per-endpoint
 * p95s and backend CPU/memory, and writes the same as Markdown when a path is given.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const [reportPath, resourcesPath, outPath] = process.argv.slice(2);
if (!reportPath) {
  console.error('Usage: node summarize.mjs <report.json> [resources.csv] [summary.md]');
  process.exit(2);
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const agg = report.aggregate;
const counters = agg.counters || {};
const rt = agg.summaries['http.response_time'] || {};
const durationS = (agg.lastCounterAt - agg.firstCounterAt) / 1000;
const requests = counters['http.requests'] || 0;
const ok = Object.entries(counters)
  .filter(([k]) => /^http\.codes\.[23]\d\d$/.test(k))
  .reduce((sum, [, v]) => sum + v, 0);
const errorCount = requests - ok;
const errorTypes = Object.entries(counters).filter(([k]) => k.startsWith('errors.'));
const codes = Object.entries(counters).filter(([k]) => /^http\.codes\./.test(k));

// Peak virtual users in flight, measured at the end of each 10-second bucket.
let active = 0;
let peakActive = 0;
let peakRps = 0;
for (const bucket of report.intermediate || []) {
  const c = bucket.counters || {};
  active += (c['vusers.created'] || 0) - (c['vusers.completed'] || 0) - (c['vusers.failed'] || 0);
  peakActive = Math.max(peakActive, active);
  peakRps = Math.max(peakRps, (bucket.rates || {})['http.request_rate'] || 0);
}

const endpointPrefix = 'plugins.metrics-by-endpoint.response_time.';
const endpoints = Object.entries(agg.summaries)
  .filter(([k]) => k.startsWith(endpointPrefix))
  .map(([k, s]) => ({ name: k.slice(endpointPrefix.length), ...s }))
  .sort((a, b) => b.p95 - a.p95);

function resourceStats(path) {
  if (!path || !existsSync(path)) return null;
  const rows = readFileSync(path, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/).slice(1)
    .map((line) => line.split(','))
    .map(([ts, cpu, mem]) => ({ ts, cpu: Number(cpu), mem: Number(mem) }))
    .filter((r) => Number.isFinite(r.cpu) && Number.isFinite(r.mem));
  if (!rows.length) return null;
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const cpu = rows.map((r) => r.cpu);
  const mem = rows.map((r) => r.mem);
  return {
    samples: rows.length,
    cpuAvg: avg(cpu), cpuMax: Math.max(...cpu),
    memStart: mem[0], memAvg: avg(mem), memMax: Math.max(...mem), memEnd: mem[mem.length - 1],
  };
}
const res = resourceStats(resourcesPath);

const fmt = (n, d = 1) => (n === undefined || n === null ? 'n/a' : Number(n).toFixed(d));
const lines = [
  '# Load test summary',
  '',
  `Report: \`${reportPath}\``,
  '',
  '| Metric | Value |',
  '| --- | --- |',
  `| Duration | ${fmt(durationS, 0)} s |`,
  `| Requests | ${requests} |`,
  `| Mean throughput | ${fmt(requests / durationS)} req/s (Artillery: ${agg.rates['http.request_rate']} req/s) |`,
  `| Peak throughput (10 s bucket) | ${peakRps} req/s |`,
  `| Virtual users created / failed | ${counters['vusers.created'] || 0} / ${counters['vusers.failed'] || 0} |`,
  `| Peak concurrent virtual users (approx.) | ${peakActive} |`,
  `| Latency p50 / p95 / p99 | ${fmt(rt.p50)} / ${fmt(rt.p95)} / ${fmt(rt.p99)} ms |`,
  `| Latency mean / max | ${fmt(rt.mean)} / ${fmt(rt.max)} ms |`,
  `| Errors | ${errorCount} (${fmt((100 * errorCount) / Math.max(requests, 1), 2)}%) |`,
  `| Status codes | ${codes.map(([k, v]) => `${k.replace('http.codes.', '')}: ${v}`).join(', ') || 'none'} |`,
  `| Error types | ${errorTypes.map(([k, v]) => `${k.replace('errors.', '')}: ${v}`).join(', ') || 'none'} |`,
];
if (res) {
  lines.push(
    `| Backend CPU avg / max | ${fmt(res.cpuAvg)}% / ${fmt(res.cpuMax)}% of one core (${res.samples} samples) |`,
    `| Backend memory start / avg / max / end | ${fmt(res.memStart)} / ${fmt(res.memAvg)} / ${fmt(res.memMax)} / ${fmt(res.memEnd)} MB |`,
  );
}
lines.push('', '## Per endpoint (sorted by p95)', '', '| Endpoint | Count | p50 | p95 | p99 | Max |', '| --- | --- | --- | --- | --- | --- |');
for (const e of endpoints) {
  lines.push(`| ${e.name} | ${e.count} | ${fmt(e.p50)} | ${fmt(e.p95)} | ${fmt(e.p99)} | ${fmt(e.max)} |`);
}

const text = lines.join('\n');
console.log(text);
if (outPath) writeFileSync(outPath, `${text}\n`);
