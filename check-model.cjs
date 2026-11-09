const vm=require('vm'),fs=require('fs'),assert=require('node:assert/strict');const base=__dirname+'/dist/';const context=vm.createContext({console,Intl,Date,Map,Math,Number,String,Object,Array,Infinity});vm.runInContext(fs.readFileSync(base+'astronomy.js','utf8'),context);let code=fs.readFileSync(base+'app.js','utf8').replace(/init\(\);\s*$/,'');vm.runInContext(code,context);vm.runInContext(`data=${fs.readFileSync(base+'tides.json','utf8')};events=data.events.map(e=>({...e,t:Date.parse(e.time)}));highs=events.filter(e=>e.type==='high');let q=Astronomy.SearchMoonQuarter(new Date('2026-08-01T00:00Z'));while(q.time.date<new Date('2028-04-01T00:00Z')){if(q.quarter===0||q.quarter===2)phases.push({t:q.time.date.getTime(),kind:q.quarter});q=Astronomy.NextMoonQuarter(q)}`,context);
function evalc(s){return vm.runInContext(s,context)}
assert.equal(evalc("new Date(instant('2026-11-02',13)).toISOString()"),'2026-11-02T16:30:00.000Z');assert.equal(evalc("new Date(instant('2027-07-01',13)).toISOString()"),'2027-07-01T15:30:00.000Z');
assert.equal(evalc("clock(highs.find(e=>e.time==='2026-11-03T18:13:00Z').t)"),'14:43');
assert.equal(evalc("key(phases.find(p=>key(p.t)==='2026-11-09').t)"),'2026-11-09');
assert.ok(Math.abs(evalc("lunar(phases[10].t).weight")-1)<1e-9);
for(const h of [11,12,13,14,15,16]){const baseScore=evalc(`score(instant('2026-11-02',${h}))/lunar(instant('2026-11-02',${h})).weight`);assert.ok(Math.abs(baseScore-({11:81,12:90,13:81,14:90,15:81,16:72}[h]))<1e-8)}
assert.ok(evalc("highs.every(h=>score(h.t)>=0&&score(h.t)<=90)"));
for (const [hours, points] of [[0, 81], [1, 90], [2, 81], [3, 72], [4, 63], [5, 54]]) {
  assert.equal(evalc(`tideScore(${hours})`), points);
}
assert.equal(evalc("lunar(phases[10].t + DAY).weight"), 0.94);
assert.equal(evalc("(instant('2027-03-15') - instant('2027-03-14')) / HOUR"), 23);
assert.equal(evalc("(instant('2027-11-08') - instant('2027-11-07')) / HOUR"), 25);
console.log('PASS: local NST/NDT conversion, official high tide, lunar phase, weights, score peaks and bounds.');


assert.equal(evalc('combineCodScore(90, 1)'), 90);
assert.equal(evalc('combineCodScore(72, 0.5)'), 54);
assert.equal(evalc('combineCodScore(90, 0)'), 30);
assert.equal(evalc('combineCodScore(0, 1)'), 30);

for (const date of ['2026-11-09', '2027-03-14', '2027-06-21', '2027-11-07']) {
  for (const index of [0, 1]) {
    const sun = `solarTimes('${date}')`;
    const event = `${sun}[${index}]`;
    assert.equal(evalc(`key(${event})`), date);
    assert.ok(evalc(`${sun}[0] < ${sun}[1]`));
    for (const [hours, expected] of [[-3, 0], [-2, 0.4], [-0.5, 1], [0, 1], [0.5, 1], [2, 0.4], [3, 0]]) {
      assert.ok(Math.abs(evalc(`solarWeight(${event} + ${hours} * HOUR)`) - expected) < 1e-8);
      const result = evalc(`codScore(${event} + ${hours} * HOUR)`);
      assert.ok(result >= 30 && result <= 90);
    }
  }
}
assert.equal(evalc("scoreModel = 'cod'; codScore(instant('2026-11-09'))"), 30);
assert.equal(evalc("activeScore(solarTimes('2026-11-09')[0]) === combineCodScore(score(solarTimes('2026-11-09')[0]), 1)"), true);
assert.equal(evalc(`{
  minDay = '2026-11-01';
  maxDay = '2027-11-30';
  const date = '2026-11-09';
  const info = dayInfo(date);
  const peak = peakFor(date, info);
  const anchors = solarAnchors(date);
  const minuteScores = Array.from({length: info.length * 60}, (_, i) => codScore(info.start + i * 60_000, anchors));
  peak.s === Math.max(...minuteScores) && peak.s === codScore(peak.t) && peak.t !== info.best.t;
}`), true);
assert.equal(evalc("scoreModel = 'tide'; activeScore(highs[20].t) === score(highs[20].t)"), true);
console.log('PASS: local solar weights, multiplicative cod score, 30–90 bounds, daily peak and model switching.');
