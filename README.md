# Short Drama Hub — Stremio Addon

Supports:
- DramaBox
- ReelShort
- ShortMax
- GoodShort
- NetShort
- Melolo
- FlickReels
- DramaWave
- FreeReels
- iDrama

## Run locally

Requires Node.js 18+.

```bash
npm install
npm start
```

Then open Stremio and install:
`http://YOUR_SERVER:7000/manifest.json`

For remote installation, deploy this project to a Node.js host with HTTPS, then use:
`https://YOUR-DOMAIN/manifest.json`

## Notes

The addon uses the public DramaBos REST API as its metadata/stream backend.
API availability, rate limits, provider endpoints, and stream URLs can change.

Use only content you are authorized to access. The addon does not bypass DRM or paid access controls.
