'use strict';

const TZ = 'America/St_Johns';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const $ = selector => document.querySelector(selector);
const localFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const shortFormat = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const zoneFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, timeZoneName: 'short' });
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const phaseNames = ['New moon', 'First quarter', 'Full moon', 'Last quarter'];
const phaseSymbols = ['●', '◐', '○', '◑'];
const modes = ['month', 'week', 'day'];
const dayCache = new Map();
const solarCache = new Map();
const solarObserver = new Astronomy.Observer(47.567045, -52.702311, 0);
const solarLabels = ['Sunrise', 'Sunset'];
const COD_PEAK_HOURS = 0.5;
const COD_LIMIT_HOURS = 3;
let selected = key(Date.now());
let mode = 'month';
let scoreModel = 'tide';
let events = [];
let highs = [];
let phases = [];
let minDay, maxDay, chosenTime;

function parts(t) {
  return Object.fromEntries(localFormat.formatToParts(t).filter(part => part.type !== 'literal')
    .map(part => [part.type, part.value]));
}

function key(t) {
  const { year, month, day } = parts(t);
  return `${year}-${month}-${day}`;
}

function instant(date, elapsedHours = 0) {
  // Resolve local midnight first, then add real elapsed time through DST changes.
  const midnight = Date.parse(date + 'T00:00:00Z');
  const before = parts(midnight);
  const wall = Date.parse(`${before.year}-${before.month}-${before.day}T${before.hour}:${before.minute}:00Z`);
  return midnight + (midnight - wall) + elapsedHours * HOUR;
}

function add(date, days) {
  return new Date(Date.parse(date + 'T12:00:00Z') + days * DAY).toISOString().slice(0, 10);
}

function dow(date) {
  return new Date(date + 'T12:00:00Z').getUTCDay();
}

function clock(t) {
  const { hour, minute } = parts(t);
  return hour + ':' + minute;
}

function zone(t) {
  return zoneFormat.formatToParts(t).find(part => part.type === 'timeZoneName').value;
}

function displayTime(t, info) {
  const local = clock(t);
  return info.length > 24 && local.startsWith('01:') ? `${local} ${zone(t)}` : local;
}

function shortDate(date) {
  return shortFormat.format(new Date(date + 'T12:00:00Z'));
}

function n(value) {
  return value.toFixed(1);
}

function lunar(t) {
  const nearest = phases.filter(phase => phase.kind % 2 === 0)
    .reduce((best, phase) => Math.abs(phase.t - t) < Math.abs(best.t - t) ? phase : best);
  const distance = Math.abs(nearest.t - t) / DAY;
  return { weight: Math.max(0, 1 - distance * 0.06), distance, nearest };
}

function nearestHigh(t) {
  let lo = 0;
  let hi = highs.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (highs[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const before = highs[lo - 1];
  const after = highs[lo];
  if (!before) return after;
  if (!after) return before;
  return t - before.t <= after.t - t ? before : after;
}

function tideScore(hours) {
  return hours <= 1 ? 81 + hours * 9 : Math.max(0, 99 - hours * 9);
}

function score(t) {
  const high = nearestHigh(t);
  if (!high) return null;
  return tideScore(Math.abs(high.t - t) / HOUR) * lunar(t).weight;
}

function solarTimes(date) {
  if (solarCache.has(date)) return solarCache.get(date);
  const start = instant(date);
  const end = instant(add(date, 1));
  const times = [1, -1].map(direction => {
    const event = Astronomy.SearchRiseSet('Sun', solarObserver, direction, new Date(start), (end - start) / DAY);
    return event ? Math.round(event.date.getTime() / 60_000) * 60_000 : null;
  });
  solarCache.set(date, times);
  return times;
}

function solarAnchors(date) {
  return [solarTimes(add(date, -1))[1], ...solarTimes(date), solarTimes(add(date, 1))[0]]
    .filter(Number.isFinite);
}

function solarWeight(t, anchors = solarAnchors(key(t))) {
  let distance = Infinity;
  for (const anchor of anchors) distance = Math.min(distance, Math.abs(t - anchor) / HOUR);
  const progress = (distance - COD_PEAK_HOURS) / (COD_LIMIT_HOURS - COD_PEAK_HOURS);
  return 1 - Math.min(1, Math.max(0, progress));
}

function combineCodScore(tideAndMoon, sunWeight) {
  return 30 + 60 * (tideAndMoon / 90) * sunWeight;
}

function codScore(t, anchors) {
  const weight = solarWeight(t, anchors);
  return weight > 0 ? combineCodScore(score(t), weight) : 30;
}

function peakFor(date, info) {
  if (scoreModel !== 'cod' || !info.best) return info.best;
  if (info.codPeak) return info.codPeak;
  const anchors = solarAnchors(date);
  // Use the same one-minute resolution as the chart's time picker.
  let peak = { t: info.start, s: 30 };
  for (let t = info.start; t < info.end; t += 60_000) {
    const value = codScore(t, anchors);
    if (value > peak.s) peak = { t, s: value };
  }
  info.codPeak = peak;
  return peak;
}

function scoreFraction(value) {
  const floor = scoreModel === 'cod' ? 30 : 0;
  return (value - floor) / (90 - floor);
}

function activeScore(t) {
  return scoreModel === 'cod' ? codScore(t) : score(t);
}

function displayScore(value) {
  return scoreModel === 'cod' ? n(value) + ' / 90' : n(value) + '%';
}

function hasData(date) {
  return date >= minDay && date <= maxDay;
}

function dayInfo(date) {
  if (dayCache.has(date)) return dayCache.get(date);
  const start = instant(date);
  const end = instant(add(date, 1));
  const length = (end - start) / HOUR;
  const tides = events.filter(event => event.t >= start && event.t < end);
  const phaseToday = phases.find(phase => phase.t >= start && phase.t < end);
  const noon = start + (length - 12) * HOUR;
  const phaseAngle = Astronomy.MoonPhase(new Date(noon));
  const phaseName = phaseToday ? phaseNames[phaseToday.kind] :
    ['New moon phase', 'Waxing crescent', 'First quarter phase', 'Waxing gibbous',
      'Full moon phase', 'Waning gibbous', 'Last quarter phase', 'Waning crescent'][Math.floor(((phaseAngle + 22.5) % 360) / 45)];
  const illumination = Math.round((1 - Math.cos(phaseAngle * Math.PI / 180)) * 50);
  let best = null;
  if (hasData(date)) {
    const candidates = [start, end - 60_000];
    if (phaseToday && phaseToday.kind % 2 === 0) {
      candidates.push(Math.round(phaseToday.t / 60_000) * 60_000);
    }
    for (const high of highs) candidates.push(high.t - HOUR, high.t + HOUR);
    best = candidates.filter(t => t >= start && t < end)
      .map(t => ({ t, s: score(t) })).reduce((best, point) => point.s > best.s ? point : best);
  }
  const info = { start, end, length, tides, best, moon: lunar(noon), phaseToday, phaseName, illumination };
  dayCache.set(date, info);
  return info;
}

function weatherText(weather) {
  if (!weather) return 'No forecast';
  const speed = Number.isFinite(weather.speed) ? ` ${n(weather.speed)} km/h` : '';
  const gust = Number.isFinite(weather.gust) ? `, gusts ${Math.round(weather.gust)} km/h` : '';
  return `${weather.rain.label} (${weather.rain.detail}), wind ${weather.wind.label}${speed}${gust}`;
}

function weatherCompact(t, hideMissing = false) {
  const weather = FishingWeather.get(t);
  if (!weather) return hideMissing ? '' : '<span class="weather-unavailable">No forecast</span>';
  const bars = [1, 2, 3].map(level => `<i class="${level <= weather.wind.level ? 'on' : ''}"></i>`).join('');
  return `<span class="weather-compact" title="${weatherText(weather)}">
    <span aria-hidden="true">${weather.rain.symbol}</span><span class="weather-word">${weather.rain.label}</span>
    <span class="wind-bars" aria-hidden="true">${bars}</span><span class="wind-word">${weather.wind.short}</span>
  </span>`;
}

function weatherDetail(t) {
  const weather = FishingWeather.get(t);
  if (!weather) {
    const messages = {
      loading: 'Loading hourly forecast…', error: 'Weather unavailable. Use Retry to reconnect.',
      ready: 'This time is outside the hourly forecast range.',
    };
    return `<p class="weather-empty">${messages[FishingWeather.status]}</p>`;
  }
  return `<div class="weather-detail">
    <div><span class="weather-label">Rain & sky</span><strong>${weather.rain.symbol} ${weather.rain.label}</strong>
      <small>${weather.rain.detail}</small></div>
    <div><span class="weather-label">Wind · level ${weather.wind.level || '—'}</span>
      <strong>${weather.wind.label} <em>${Number.isFinite(weather.speed) ? n(weather.speed) + ' km/h' : ''}</em></strong>
      <small>${Number.isFinite(weather.gust) ? 'Gusts ' + Math.round(weather.gust) + ' km/h' : 'Gust data unavailable'}</small></div>
  </div>`;
}

function weatherStatus() {
  const element = $('#weather-status');
  if (FishingWeather.status === 'ready') {
    element.innerHTML = `<span><span class="live-dot"></span> Hourly forecast · ${shortDate(key(FishingWeather.start))}–${shortDate(key(FishingWeather.end))}</span>
      <span>Updated ${clock(FishingWeather.loadedAt)} Newfoundland time</span>`;
  } else if (FishingWeather.status === 'error') {
    element.innerHTML = '<span>Weather unavailable. Tide scores are still available.</span><button id="retry-weather" class="quiet-button">Retry</button>';
    $('#retry-weather').onclick = () => refreshWeather(true);
  } else {
    element.textContent = 'Connecting hourly weather…';
  }
}

async function refreshWeather(force = false) {
  const request = FishingWeather.load(force);
  weatherStatus();
  await request;
  const focusedId = document.activeElement?.id;
  render();
  weatherStatus();
  if (focusedId === 'retry-weather' && !$('#retry-weather')) $('#weather-status').focus();
}

function render() {
  const focus = document.activeElement?.dataset;
  $('#date-picker').value = selected;
  for (const button of document.querySelectorAll('[data-mode]')) {
    const active = button.dataset.mode === mode;
    button.setAttribute('aria-selected', active);
    button.tabIndex = active ? 0 : -1;
  }
  const weekStart = add(selected, -dow(selected));
  $('#period').textContent = {
    month: monthFormat.format(new Date(selected + 'T12:00Z')),
    week: `${shortDate(weekStart)} – ${shortDate(add(weekStart, 6))}`,
    day: `${weekdays[dow(selected)]}, ${shortDate(selected)}`,
  }[mode];
  $('#prev').disabled = !canMove(-1);
  $('#next').disabled = !canMove(1);
  $('#calendar-view').setAttribute('aria-labelledby', 'tab-' + mode);
  $('.legend-note').textContent = scoreModel === 'cod' ? 'Cod planning score · 30–90 points' : 'Relative fishing score · max 90%';
  if (mode === 'month') renderMonth();
  if (mode === 'week') renderWeek();
  if (mode === 'day') renderDay();
  renderSummary();
  if (focus?.date && mode === 'month') $(`[data-date="${focus.date}"]`)?.focus({ preventScroll: true });
}

function renderMonth() {
  const first = selected.slice(0, 7) + '-01';
  const start = add(first, -dow(first));
  const count = new Date(Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)), 0)).getUTCDate();
  const cells = Math.ceil((dow(first) + count) / 7) * 7;
  const today = key(Date.now());
  const cod = scoreModel === 'cod';
  const days = Array.from({ length: cells }, (_, index) => {
    const date = add(start, index);
    const info = dayInfo(date);
    const { phaseToday } = info;
    const best = peakFor(date, info);
    const phase = phaseToday ? phaseNames[phaseToday.kind] : '';
    const peakLabel = best ? `peak score ${displayScore(best.s)}, ${displayTime(best.t, info)}, ${weatherText(FishingWeather.get(best.t))}` : 'no tide data';
    const label = `${date}, ${info.phaseName}, ${peakLabel}`;
    return `<button class="month-cell ${date.slice(0, 7) !== first.slice(0, 7) ? 'outside' : ''} ${date === selected ? 'selected' : ''} ${date === today ? 'is-today' : ''}"
      data-date="${date}" aria-label="${label}" ${date === selected ? 'aria-pressed="true"' : 'aria-pressed="false"'}
      ${date === today ? 'aria-current="date"' : ''} ${best ? '' : 'disabled'}>
      <span class="day-number"><span class="number">${Number(date.slice(-2))}</span>
        ${phase ? `<span class="moon-tag" title="${phase}" aria-hidden="true">${phaseSymbols[phaseToday.kind]}</span>` : ''}</span>
      ${best ? `<span class="day-score">${Math.round(best.s)}${cod ? '' : '<small>%</small>'}</span>
        <span class="cell-time">${clock(best.t)}</span>${weatherCompact(best.t, true)}
        <span class="score-strip"><i style="width:${scoreFraction(best.s) * 100}%"></i></span>` : '<span class="no-data">—</span>'}
    </button>`;
  });
  $('#calendar-view').innerHTML = `<p class="view-hint">${cod ? 'Each date shows its highest combined cod score and the time it occurs. Tap for sunrise, sunset and peak weather.'
      : 'Tap a date for tides and moon details. Weather is shown at the peak time.'}</p>
    <div class="weekdays">${weekdays.map(day => `<span>${day}</span>`).join('')}</div>
    <div class="month-grid">${days.join('')}</div>
    <div class="phase-key" aria-label="Moon phase legend">${phaseNames.map((phase, i) =>
      `<span><b aria-hidden="true">${phaseSymbols[i]}</b> ${phase}</span>`).join('')}</div>
    <div class="month-actions"><span>${shortDate(selected)} selected</span><button class="detail-button" id="month-details">${cod ? 'See cod windows ↓' : 'See tides & moon ↓'}</button></div>`;
  $('#month-details').onclick = () => $('#summary-title').focus();
}

function renderWeek() {
  const start = add(selected, -dow(selected));
  const dates = weekdays.map((_, i) => add(start, i));
  const cod = scoreModel === 'cod';
  const cards = dates.map((date, i) => {
    const info = dayInfo(date);
    const best = peakFor(date, info);
    const highTimes = info.tides.filter(tide => tide.type === 'high').map(tide => clock(tide.t)).join(' · ');
    const sun = cod && best ? solarTimes(date) : null;
    const solarOverview = sun ? sun.map((time, i) => `<span class="week-solar">
      <small>${solarLabels[i]}</small><strong>${clock(time)}</strong>${weatherCompact(time, true)}</span>`).join('') : '';
    return `<button class="week-card ${sun ? 'cod-week-card' : ''}" data-open-day="${date}" ${best ? '' : 'disabled'}>
      <span><strong>${weekdays[i]}, ${shortDate(date)}</strong>
        ${sun ? `<small>Peak ${n(best.s)} at ${clock(best.t)}</small>` : `<small>${info.phaseName} · ${info.illumination}% lit</small>`}</span>
      ${sun ? solarOverview : `<span><small>High tide</small><strong>${best ? highTimes || '—' : '—'}</strong></span>
      <span class="week-peak"><strong>${best ? Math.round(best.s) + '%' : '—'}</strong>
        <small>${best ? 'Peak ' + clock(best.t) : 'No tide data'}</small>${best ? weatherCompact(best.t, true) : ''}</span>`}
    </button>`;
  });

  // Match the same wall-clock hour across days and include a second 01:00 when clocks fall back.
  const hours = dates.map(date => {
    const info = dayInfo(date);
    const byClock = new Map();
    for (let t = info.start; t < info.end; t += HOUR) {
      const hour = clock(t);
      if (!byClock.has(hour)) byClock.set(hour, []);
      byClock.get(hour).push(t);
    }
    return byClock;
  });
  const rows = Array.from({ length: 24 }, (_, hour) => [String(hour).padStart(2, '0') + ':00', 0]);
  if (hours.some(day => day.get('01:00')?.length === 2)) rows.splice(2, 0, ['01:00', 1]);
  const heat = rows.map(([hour, occurrence]) => `<span class="hour-label">${hour}${occurrence ? ' ↺' : ''}</span>` +
    dates.map((date, i) => {
      const t = hours[i].get(hour)?.[occurrence];
      if (t === undefined || !hasData(date)) return '<span class="heat-cell unavailable">—</span>';
      const value = activeScore(t);
      const label = `${shortDate(date)} ${displayTime(t, dayInfo(date))}, ${displayScore(value)}, ${weatherText(FishingWeather.get(t))}`;
      return `<button class="heat-cell" data-open-day="${date}" data-time="${t}" aria-label="${label}"
        style="--heat:${Math.round(scoreFraction(value) * 62)}%">${Math.round(value)}${weatherCompact(t, true)}</button>`;
    }).join('')).join('');
  const expanded = $('.week-hourly')?.open;
  $('#calendar-view').innerHTML = `<p class="view-hint">${cod ? 'Compare peak cod scores and sunrise and sunset forecasts. Choose a day for its hourly chart.'
      : 'Compare daily peaks and high tides. Choose a day to explore its hourly forecast.'}</p>
    <div class="week-cards">${cards.join('')}</div>
    <details class="week-hourly" ${expanded ? 'open' : ''}><summary>Compare hourly scores</summary>
      <p class="view-hint">Choose a score to see the weather for that hour. Swipe the grid sideways on a small screen.</p>
      <div class="week-scroll" tabindex="0" role="region" aria-label="Scrollable hourly comparison"><div class="week-grid"><div></div>
        ${dates.map((date, i) => `<span class="week-head">${weekdays[i]}<strong>${Number(date.slice(-2))}</strong></span>`).join('')}${heat}
      </div></div></details>`;
}

function renderSummary() {
  const info = dayInfo(selected);
  const { moon, phaseToday } = info;
  const best = peakFor(selected, info);
  const nextPhase = phases.find(phase => phase.t >= info.end);
  const cod = scoreModel === 'cod';
  const sun = cod && best ? solarTimes(selected) : null;
  $('#day-summary').innerHTML = `<div class="summary-hero"><div class="summary-eyebrow">SELECTED DAY</div>
    <h3 class="summary-date" id="summary-title" tabindex="-1">${weekdays[dow(selected)]}, ${shortDate(selected)}</h3>
    <div class="score-label">${cod ? 'Peak cod score' : 'Peak fishing score'}</div>
    <div class="big-score">${best ? n(best.s) + (cod ? '<small>pts</small>' : '<small>%</small>') : '—'}</div>
    <div class="best-window"><i></i>${best ? displayTime(best.t, info) + ' · Peak time' : 'Tide data unavailable'}</div>
    ${sun ? sun.map((time, i) => `<div class="best-window">${solarLabels[i]} · ${clock(time)}</div>`).join('') : ''}
    ${mode !== 'day' && best ? `<button class="detail-button" data-open-day="${selected}">View hourly chart ↗</button>` : ''}</div>
    <div class="summary-section"><h3>High & low tides</h3>${info.tides.map(tide =>
      `<div class="tide-row"><span>${tide.type === 'high' ? '↗ High' : '↘ Low'}</span>
      <strong>${displayTime(tide.t, info)}</strong><span class="muted">${tide.height.toFixed(2)} m</span></div>`).join('') || '<p class="no-data">No tide data</p>'}</div>
    <div class="summary-section"><h3>Moon phase</h3><div class="moon-info">
      <span class="moon-disc" style="--phase:${100 - info.illumination}%" aria-hidden="true"></span>
      <div><p>${info.phaseName} · ${info.illumination}% lit</p>
      <small>${phaseToday ? 'Exact phase at ' + displayTime(phaseToday.t, info) : 'At local noon'}</small></div></div>
      <p class="no-data">Noon weight ${n(moon.weight * 100)}% · ${n(moon.distance)} days from ${phaseNames[moon.nearest.kind].toLowerCase()}</p>
      ${nextPhase ? `<p class="no-data">Next ${phaseNames[nextPhase.kind].toLowerCase()} · ${shortDate(key(nextPhase.t))} ${clock(nextPhase.t)}</p>` : ''}
    </div>
    ${mode !== 'day' && best ? `<div class="summary-section summary-weather">
      <h3>Weather at peak time · ${displayTime(best.t, info)}</h3>${weatherDetail(best.t)}</div>` : ''}`;
}

function renderDay() {
  const info = dayInfo(selected);
  const { start, end, length } = info;
  const best = peakFor(selected, info);
  if (!best) {
    $('#calendar-view').innerHTML = '<p class="empty-state">Tide data is unavailable for this date.</p>';
    return;
  }
  const cod = scoreModel === 'cod';
  const sun = cod ? solarTimes(selected) : null;
  if (!(chosenTime >= start && chosenTime < end)) chosenTime = best.t;
  const hours = Array.from({ length }, (_, hour) => {
    const t = start + hour * HOUR;
    const value = activeScore(t);
    const label = `${displayTime(t, info)}, ${displayScore(value)}, ${weatherText(FishingWeather.get(t))}`;
    return `<button class="hour-item" data-pick-time="${t}" aria-label="${label}" aria-pressed="false">
      <span>${displayTime(t, info)}</span><strong>${displayScore(value)}</strong><span class="hour-weather">${weatherCompact(t)}</span></button>`;
  });
  $('#calendar-view').innerHTML = `<div class="day-heading"><h3 id="day-title" tabindex="-1">${cod ? 'Hourly cod score' : 'Hourly fishing score'}</h3>
    <span>${info.phaseName} · ${info.illumination}% lit</span></div>
    <div id="chart-container"></div>
    <div class="chart-legend"><span class="line-mark">━ ${cod ? 'Cod score' : 'Fishing score'}</span>
      <span>${cod ? '▧ Full sun weight' : '┆ High tide'}</span><span>Newfoundland time</span></div>
    ${sun ? `<div class="solar-jumps">${sun.map((time, i) => `<button class="quiet-button" data-pick-time="${time}">
      ${solarLabels[i]} · ${clock(time)}</button>`).join('')}</div>` : ''}
    <label class="view-hint" for="hour-slider">Choose a time for its forecast</label>
    <input type="range" min="0" max="${length * 60 - 1}" step="1" id="hour-slider" class="hour-slider">
    <div id="point-detail" class="selected-point" aria-live="polite" tabindex="-1"></div><div id="selected-weather"></div>
    <h4 class="hours-title">Forecast by hour</h4><div class="hour-list">${hours.join('')}</div>`;
  $('#hour-slider').oninput = event => {
    chosenTime = start + Number(event.target.value) * 60_000;
    updatePoint();
  };
  drawChart();
  updatePoint();
}

function updatePoint() {
  const slider = $('#hour-slider');
  if (!slider) return;
  const info = dayInfo(selected);
  const t = chosenTime;
  const value = activeScore(t);
  const timeLabel = displayTime(t, info);
  const factors = scoreModel === 'cod'
    ? `Tide &amp; Moon ${n(score(t))}% · Sun ${n(solarWeight(t) * 100)}%`
    : `Moon weight ${n(lunar(t).weight * 100)}%`;
  slider.value = Math.round((t - info.start) / 60_000);
  slider.setAttribute('aria-valuetext', timeLabel);
  $('#point-detail').innerHTML = `<span><b>${timeLabel}</b> <span class="muted">· ${factors}</span></span><strong>${displayScore(value)}</strong>`;
  $('#selected-weather').innerHTML = weatherDetail(t);
  for (const button of document.querySelectorAll('[data-pick-time]')) {
    button.setAttribute('aria-pressed', Number(button.dataset.pickTime) === t);
  }
  const marker = $('#selected-marker');
  if (marker) {
    const width = $('#chart-container').clientWidth;
    marker.setAttribute('cx', 37 + (t - info.start) / (info.end - info.start) * (width - 49));
    marker.setAttribute('cy', 166 - scoreFraction(value) * 130);
  }
}

function drawChart() {
  const container = $('#chart-container');
  if (!container || container.clientWidth < 100) return;
  const info = dayInfo(selected);
  const { start, end, length, tides } = info;
  const best = peakFor(selected, info);
  const width = container.clientWidth;
  const cod = scoreModel === 'cod';
  const sun = cod ? solarTimes(selected) : null;
  const x = t => 37 + (t - start) / (end - start) * (width - 49);
  const y = value => 166 - scoreFraction(value) * 130;
  const sampleTimes = new Set(Array.from({ length: length * 4 + 1 }, (_, i) => start + i * HOUR / 4));
  sampleTimes.add(best.t);
  for (const high of highs) {
    for (const offset of [-HOUR, 0, HOUR]) {
      const t = high.t + offset;
      if (t >= start && t < end) sampleTimes.add(t);
    }
  }
  if (sun) {
    for (const time of sun) {
      for (const hours of [-COD_LIMIT_HOURS, -COD_PEAK_HOURS, 0, COD_PEAK_HOURS, COD_LIMIT_HOURS]) {
        const t = time + hours * HOUR;
        if (t >= start && t <= end) sampleTimes.add(t);
      }
    }
  }
  const points = Array.from(sampleTimes).sort((a, b) => a - b).map(t => `${x(t)},${y(activeScore(t))}`).join(' ');
  const axes = (cod ? [30, 50, 70, 90] : [0, 30, 60, 90]).map(value => `<line x1="37" x2="${width - 12}" y1="${y(value)}" y2="${y(value)}" stroke="#dbe4dd"/>
    <text x="30" y="${y(value) + 4}" text-anchor="end">${value}${cod ? '' : '%'}</text>`).join('');
  const marks = sun ? sun.map((t, i) => ({ t, label: solarLabels[i] }))
    : tides.filter(tide => tide.type === 'high').map(tide => ({ t: tide.t, label: 'High' }));
  const lines = marks.map(({ t, label }) => {
    const pos = x(t);
    const anchor = pos < 76 ? 'start' : pos > width - 53 ? 'end' : 'middle';
    return `<line x1="${pos}" x2="${pos}" y1="36" y2="166" stroke="#829993" stroke-dasharray="3 4"/>
      <text class="tide-label" x="${pos}" y="20" text-anchor="${anchor}">${label} ${clock(t)}</text>`;
  }).join('');
  const bands = sun ? sun.map(t => {
    const left = x(Math.max(start, t - COD_PEAK_HOURS * HOUR));
    const right = x(Math.min(end, t + COD_PEAK_HOURS * HOUR));
    return `<rect x="${left}" y="36" width="${right - left}" height="130" fill="#f0e1b8" opacity=".7"/>`;
  }).join('') : '';
  const ticks = (width < 460 ? [0, 6, 12, 18] : [0, 4, 8, 12, 16, 20])
    .map(hour => instant(selected, hour + (hour ? length - 24 : 0)))
    .map(t => `<text x="${x(t)}" y="189" text-anchor="${t === start ? 'start' : 'middle'}">${clock(t)}</text>`).join('');
  container.innerHTML = `<svg class="chart" viewBox="0 0 ${width} 199" role="img" aria-label="${cod ? 'Cod score with sunrise and sunset' : 'Fishing score and high tides'} for ${shortDate(selected)}">
    ${axes}<polygon points="37,166 ${points} ${x(end)},166" fill="#e6efe7"/>
    ${bands}${lines}<polyline points="${points}" fill="none" stroke="#237d70" stroke-width="2.5"/>${ticks}
    <circle id="selected-marker" r="5" fill="#ca7346" stroke="#fffefa" stroke-width="2"/></svg>`;
}

function moveTarget(direction) {
  if (mode !== 'month') return add(selected, direction * (mode === 'week' ? 7 : 1));
  const [year, month, day] = selected.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1 + direction, 1));
  const last = new Date(Date.UTC(year, month + direction, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, last));
  return next.toISOString().slice(0, 10);
}

function canMove(direction) {
  const target = moveTarget(direction);
  if (mode === 'month') return target.slice(0, 7) >= minDay.slice(0, 7) && target.slice(0, 7) <= maxDay.slice(0, 7);
  if (mode === 'week') {
    const start = add(target, -dow(target));
    return add(start, 6) >= minDay && start <= maxDay;
  }
  return hasData(target);
}

function selectDate(date) {
  selected = date < minDay ? minDay : date > maxDay ? maxDay : date;
  chosenTime = undefined;
  render();
}

async function init() {
  try {
    const response = await fetch('tides.json');
    if (!response.ok) throw Error('Tide data unavailable');
    const data = await response.json();
    events = data.events.map(event => ({ ...event, t: Date.parse(event.time) }));
    highs = events.filter(event => event.type === 'high');
    minDay = add(key(events[0].t), 1);
    maxDay = add(key(events.at(-1).t), -1);
    let quarter = Astronomy.SearchMoonQuarter(new Date(instant(minDay) - 40 * DAY));
    while (quarter.time.date.getTime() < instant(maxDay) + 40 * DAY) {
      phases.push({ t: quarter.time.date.getTime(), kind: quarter.quarter });
      quarter = Astronomy.NextMoonQuarter(quarter);
    }
    $('#loading').hidden = true;
    $('#coverage').textContent = `Tides ${minDay} – ${maxDay}`;
    $('#source-date').textContent = `Tide predictions retrieved ${data.retrieved}. Later-year predictions are preliminary.`;
    $('#date-picker').min = minDay;
    $('#date-picker').max = maxDay;
    $('#date-picker').onchange = event => {
      if (event.target.value) selectDate(event.target.value);
    };
    $('.score-model').addEventListener('change', event => {
      scoreModel = event.target.value;
      chosenTime = undefined;
      render();
    });
    $('#prev').onclick = () => selectDate(moveTarget(-1));
    $('#next').onclick = () => selectDate(moveTarget(1));
    $('#today').onclick = () => selectDate(key(Date.now()));
    for (const button of document.querySelectorAll('[data-mode]')) {
      button.onclick = () => { mode = button.dataset.mode; render(); };
      button.onkeydown = event => {
        const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
        if (!step) return;
        event.preventDefault();
        mode = modes[(modes.indexOf(mode) + step + modes.length) % modes.length];
        render();
        $('#tab-' + mode).focus();
      };
    }
    $('.planner-body').addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.date) selectDate(button.dataset.date);
      if (button.dataset.openDay) {
        selected = button.dataset.openDay;
        chosenTime = button.dataset.time ? Number(button.dataset.time) : undefined;
        mode = 'day';
        render();
        $('#day-title')?.focus();
      }
      if (button.dataset.pickTime) {
        chosenTime = Number(button.dataset.pickTime);
        updatePoint();
        $('#point-detail').focus();
      }
    });
    selectDate(selected);
    let lastWidth;
    new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width === lastWidth) return;
      lastWidth = width;
      if (mode === 'day') { drawChart(); updatePoint(); }
    }).observe($('#calendar-view'));
    refreshWeather();
    setInterval(refreshWeather, 30 * 60_000);
  } catch {
    $('#loading').hidden = false;
    $('#loading').className = 'error';
    $('#loading').textContent = 'Tide data could not load. Please refresh to try again.';
  }
}
init();
