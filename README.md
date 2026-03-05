# Ferry

Bridge messy data into Google products — optimally.

Ferry is a suite of tools that monitor, transform, and stream data between websites, CRMs, and Google's marketing and analytics platforms (GA4, Google Ads, BigQuery).

## Repository Structure

```
packages/
  extension/    Chrome DevTools extension — data quality inspector
  core/         Shared schemas, validators, and transforms
  cloud/        Cloud platform (GCP) — ingestion, transform, export
  web/          Web dashboard
```

## Getting Started

### Chrome Extension (Development)

1. Open `chrome://extensions` in Chrome
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `packages/extension/` directory

Open DevTools on any page → click the "Ferry" tab → Start recording.

### Core Library

```bash
cd packages/core
npm test
```

## Status

Early development. Currently building the Chrome Extension with data layer capture, GA4 network hit parsing, and lint rules engine.
