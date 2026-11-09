// How close are the app's measurements to a tape measure?
// Fill in training/measurements.csv (one row per wall), then run: npm run accuracy
import { readFileSync } from 'node:fs';

const file = process.argv[2] || 'training/measurements.csv';
const rows = readFileSync(file, 'utf8').trim().split('\n').slice(1)
  .map((line) => line.split(',').map((v) => v.trim()))
  .filter((cols) => cols.length >= 5 && cols.slice(1, 5).every((v) => v !== '' && !Number.isNaN(Number(v))));

if (!rows.length) {
  console.log(`No complete rows in ${file} yet. Each row needs: wall, tape width, tape height, app width, app height.`);
  process.exit(0);
}

const pct = (app, tape) => (Math.abs(app - tape) / tape) * 100;
const errors = rows.map(([wall, tw, th, aw, ah]) => {
  const [tapeW, tapeH, appW, appH] = [tw, th, aw, ah].map(Number);
  return { wall, width: pct(appW, tapeW), height: pct(appH, tapeH), area: pct(appW * appH, tapeW * tapeH) };
});
const mean = (key) => errors.reduce((s, e) => s + e[key], 0) / errors.length;
const median = (key) => {
  const v = errors.map((e) => e[key]).sort((a, b) => a - b);
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

console.table(errors.map((e) => ({ wall: e.wall, 'width error %': e.width.toFixed(1), 'height error %': e.height.toFixed(1), 'area error %': e.area.toFixed(1) })));
console.log(`${errors.length} walls`);
console.log(`Area error: mean ${mean('area').toFixed(1)}%, median ${median('area').toFixed(1)}%`);
console.log(`Width error: mean ${mean('width').toFixed(1)}%   Height error: mean ${mean('height').toFixed(1)}%`);
