# Music Atlas — SoundCloud-First Music App

Full-length, unlimited music streaming powered entirely by **SoundCloud api-v2** (keyless — public `client_id` only). Single source of truth for search, charts, playlists, artwork and playback.

## Architecture

```
server/
  soundcloud.ts   SoundCloud engine: client_id scrape+cache, /resolve, /tracks,
                  /playlists, /search/tracks, /search/playlists, transcoding →
                  progressive mp3 (128k) + HLS (aac 160k) stream URLs
  music.ts        search / trending(per-country) / resolve (playback core) with
                  MySQL + memory caching; legacy yt/sp/dz ids remap via SC search
  db.ts           users / playlists / playlist_songs / cache_store (+ external_url)
server.ts         Express API + SoundCloud streaming proxy
```

## Playback (no limits, fast & smooth)

1. `resolve` returns two candidates:
   - **soundcloud-progressive** — direct signed 128k mp3 CDN URL (native `<audio>`, fastest, seekable)
   - **soundcloud-hls** — proxied HLS playlist
2. HLS runs through our own proxy (no CORS, no IP lock):
   - `GET /api/sc/stream/:id/playlist.m3u8` — rewrites all URIs to our proxy
   - `GET /api/sc/proxy?u=` — byte pipe (allowlist: soundcloud.com/sndcdn.com/soundcloud.cloud/snd.sc, Range passthrough)
3. Frontend (`PlayerContext`) uses **hls.js** (lazy-loaded chunk) for m3u8 on Chrome/Edge/Firefox; Safari plays natively. Automatic candidate fallback on error.

## Key API endpoints (dual-mounted `/api` + `/playlist/api`)

| Endpoint | Purpose |
|---|---|
| `GET /music/search?q=` | SoundCloud track search (also resolves pasted SC track URLs) |
| `GET /music/resolve/:id?q=` | Playback candidates for `sc_<id>` (legacy ids remap via `q`) |
| `GET /audio/:id` | 302 → best stream (legacy compatibility) |
| `GET /music/trending/:cc` | Real official SoundCloud Top-50 chart for chart regions (US/GB/DE/FR/CA/AU/IE/NL/NZ); genre-flavored search elsewhere (1h cache, hourly warmer) |
| `GET /music/featured` + `/music/charts/:packId` | Genre packs (Top, Pop, Hip-Hop, Lofi, Persian, K-Pop…) |
| `GET /music/sc/playlists?q=` | SoundCloud set discovery |
| `GET /music/soundcloud/playlist?url=|id=` | Set resolve with full track list |
| `POST /playlists/import` (auth) | Import a SoundCloud set into user library |

## DB migrations (auto-run on boot)

- `playlists.external_url VARCHAR(500)` — origin permalink of imported sets
- `playlist_songs.source` now stores `sc` for SoundCloud tracks; `video_id VARCHAR(64)`

## Frontend

- Search: paste any `soundcloud.com/...` link — track links resolve + play, set links show a Play/Import card
- Library: "☁️ Import" button imports SoundCloud sets
- Home: SoundCloud Picks packs + per-country charts; Country pages keep charts + community playlists
- TrackRow shows a `30s` badge for snippet-only (policy-locked) tracks

## Build / Run / Test

```cmd
npm install            (repo root only — npm workspaces)
npm run lint           (tsc --noEmit, from playlist/)
npm run build          (vite + esbuild → dist/ + server.cjs)
npm start              (node server.cjs, port 3000)
node test-sc-e2e.mjs   (32-check end-to-end suite against localhost:3000)
```

Deploy through the portal: `deploy-portal.cmd` (or `build-only` to verify).
