/**
 * Unit tests for the SLA breach decision (evaluateSla).
 *
 * Why these tests: the breach rule is the one piece of Part 2 that is pure
 * business logic and has real edge cases - the exact target boundary, a ticket
 * that was answered but answered late, and a ticket with no response yet. The
 * SQL that feeds it (first-response join, UTC elapsed) is validated by running
 * against the seed; this file pins the classification so a later change to the
 * targets or the comparison can't silently flip which tickets are "breached".
 *
 * Run with:  npm test   (node --test, no extra dependencies)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSla, slaTargetHours } from './sla.js';

const H = 3600;

test('not responded and within target is not breached', () => {
  const sla = evaluateSla({ priority: 'P2', elapsedSeconds: 10 * H, responded: false });
  assert.equal(sla.breached, false);
  assert.equal(sla.responded, false);
  assert.equal(sla.targetHours, 24);
  assert.equal(sla.elapsedHours, 10);
});

test('not responded and past target is breached', () => {
  const sla = evaluateSla({ priority: 'P1', elapsedSeconds: 5 * H, responded: false });
  assert.equal(sla.breached, true); // P1 target is 4h
});

test('responded within target is not breached', () => {
  const sla = evaluateSla({ priority: 'P3', elapsedSeconds: 50 * H, responded: true });
  assert.equal(sla.breached, false); // P3 target is 72h
  assert.equal(sla.responded, true);
});

test('responded but after the target is still breached (permanent)', () => {
  const sla = evaluateSla({ priority: 'P2', elapsedSeconds: 55 * H, responded: true });
  assert.equal(sla.breached, true);
});

test('exactly at the target is not a breach (strictly greater-than)', () => {
  const sla = evaluateSla({ priority: 'P1', elapsedSeconds: 4 * H, responded: false });
  assert.equal(sla.breached, false);
});

test('each priority maps to its configured target', () => {
  assert.equal(slaTargetHours('P1'), 4);
  assert.equal(slaTargetHours('P2'), 24);
  assert.equal(slaTargetHours('P3'), 72);
});

test('missing elapsed time is treated as not breached', () => {
  const sla = evaluateSla({ priority: 'P2', elapsedSeconds: null, responded: false });
  assert.equal(sla.breached, false);
  assert.equal(sla.elapsedHours, null);
});
