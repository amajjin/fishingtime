# TideTime — St. John's Fishing Calendar

A buildless, English-language fishing calendar for St. John's, Newfoundland. Includes month, week and day views, high and low tides, calculated moon phases and live hourly weather.

## Run locally

From the repository directory:

```sh
python3 -m http.server 8000 --directory dist
```

Open http://localhost:8000. No Node dependencies, build step or API keys are needed. An internet connection is required for live weather. Local weather results are cached for 30 minutes.

## Upload to GitHub and publish with Pages

1. Create a repository on GitHub, or open the repository you want to use. A public repository supports GitHub Pages on GitHub Free.
2. Extract the ZIP. Upload the extracted contents to the repository root on the `main` branch, keeping `dist/` and `.github/workflows/pages.yml` in place.
3. In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**.
4. In **Actions**, open **Deploy TideTime to GitHub Pages**, select **Run workflow**, and choose `main`.
5. After a successful deployment, open the site from **Settings → Pages**. A project site typically uses `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`.

GitHub Pages normally publishes a public website. Use a private repository and stop after step 2 to store the source privately. The Pages workflow publishes the static files in `dist/`, with relative asset paths that work under the project URL.

## Score model

- Tide points: 90 one hour before or after the nearest high tide, 81 at high tide and two hours away, 72 three hours away, 63 four hours away, and 54 five hours away. Values are interpolated between hours.
- Moon weight: `max(0, 1 - 0.06 × days from nearest new/full moon)`.
- Final score: `tide points × moon weight`, capped by construction at 90%.

Scores are a custom comparison model, not validated catch probabilities. They do not include weather, water temperature or daylight. Daily peak times may fall overnight.

### Cod · Sunrise & Sunset

Cod score = `30 + 60 × (Tide & Moon score / 90) × sun weight`. Sun weight is 1 within 30 minutes of local sunrise or sunset and falls linearly to 0 at three hours from the nearer event. Astronomy Engine calculates solar times at the St. John’s tide station. The daily peak is the highest combined score at one-minute resolution.

## Weather

Open-Meteo hourly forecasts, up to 16 days. Wind levels use mean speed: Light below 15 km/h, Moderate 15 to below 30 km/h, Strong 30 km/h and above. Gusts are shown separately. Precipitation is Clear, Drizzle or Rain. Clear includes rain-free overcast and fog. The forecast also flags snow, freezing conditions and thunder.

## Data & attribution

- Tides: Canadian Hydrographic Service / Fisheries and Oceans Canada, station 00905. https://www.tides.gc.ca/en/stations/905
- Bundled tide data retrieved 2026-11-02, covering complete days from 2026-10-02 to 2028-01-30. Later-year predictions may be preliminary. No tides are invented outside the bundled range.
- Moon calculations: Astronomy Engine 2.1.19 by Don Cross, MIT license included in `dist/astronomy.js`. https://github.com/cosinekitty/astronomy
- Weather: Open-Meteo, CC BY 4.0. https://open-meteo.com/ and https://creativecommons.org/licenses/by/4.0/

## Update tide data

Run `python3 fetch_tides.py` to re-download the configured date range from the CHS API, then commit the updated `dist/tides.json`. Extend the month list in that script to increase coverage. The moon calculation follows the bundled tide dates.

## Checks

```sh
node check-model.cjs
node check-weather.cjs
```
