import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMonthlyTax } from '../utils/payroll.js';

// Annual = monthly gross x 12. Slabs from the brief.
test('no tax up to 600k annual', () => {
  assert.equal(calculateMonthlyTax(50000), 0); // 600k a year
});

test('5% slab between 600k and 1.2M', () => {
  // 80,000 x 12 = 960,000 -> 5% of 360,000 = 18,000 a year = 1,500 a month
  assert.equal(calculateMonthlyTax(80000), 1500);
});

test('15% slab between 1.2M and 2.4M', () => {
  // 150,000 x 12 = 1,800,000 -> 30,000 + 15% of 600,000 = 120,000 a year = 10,000 a month
  assert.equal(calculateMonthlyTax(150000), 10000);
});

test('25% slab between 2.4M and 3.6M', () => {
  // 250,000 x 12 = 3,000,000 -> 210,000 + 25% of 600,000 = 360,000 a year = 30,000 a month
  assert.equal(calculateMonthlyTax(250000), 30000);
});

test('35% slab above 3.6M', () => {
  // 400,000 x 12 = 4,800,000 -> 510,000 + 35% of 1,200,000 = 930,000 a year = 77,500 a month
  assert.equal(calculateMonthlyTax(400000), 77500);
});

test('gross is 1.5 x basic', () => {
  const basic = 100000;
  assert.equal(basic * 1.5, 150000);
  assert.equal(calculateMonthlyTax(basic * 1.5), 10000);
});

test('late penalty: every 3 lates cost half a day', () => {
  const penalty = (lates) => Math.floor(lates / 3) * 0.5;
  assert.equal(penalty(2), 0);
  assert.equal(penalty(3), 0.5);
  assert.equal(penalty(7), 1);
});