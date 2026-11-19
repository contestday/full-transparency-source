# FollowMee integration

## How it works

`/api/cron/followmee` (scheduled) → `pollFollowMee()` (`src/lib/jobs/poll-followmee.ts`):

1. Finds the newest stored FollowMee observation and requests `historyfordevice` covering the gap plus one hour (1–72 h; the first run backfills 72 h). Gaps longer than 72 h cannot be recovered from the API. Use a FollowMee report or Timeline import for those.
2. Parses the response with `parseFollowMeeResponse()` (`src/lib/followmee.ts`). Records with invalid coordinates, with no UTC offset in the timestamp, or dated in the future are **rejected, not corrected**.
3. Inserts with `ON CONFLICT (source, source_record_id) DO NOTHING`. The record ID is `<deviceId>:<UTC ISO timestamp>`, so overlapping polls never duplicate.
4. Runs geofence evaluation on the new rows (PostGIS signed distance plus hysteresis).
5. Logs a batch row (`location_import_batches`, source `followmee`) with inserted, duplicate and rejected counts.
6. Flags the feed stale after `STALE_AFTER_MINUTES` without a new position and alerts once. A failed poll alerts at most once per hour.

`POST /api/locations/ingest` (Bearer `GPS_INGEST_SECRET`) accepts pushed observations from any other worker or bridge and runs the same pipeline.

## Live verification (17 Nov 2026)

Checked against the owner's account (1 device):

- ✅ `tracks.aspx` `historyfordevice` returns `{ "Data": [...] }` with fields `DeviceName, DeviceID, Date, Latitude, Longitude, Type, Speed(mph), Speed(km/h), Direction, Altitude(ft), Altitude(m), Accuracy, Battery`.
- ✅ `Date` includes a UTC offset (`2026-11-17T16:57:19+00:00`). The live record parsed with zero rejections.
- ✅ `info.aspx?function=devicelist&output=json` lists devices. `FOLLOWMEE_DEVICE_ID` must be the numeric `DeviceID`, not a name.
- ✅ An invalid device ID returns HTTP 200 with `{ "Error": "DeviceID parameter is not valid" }`. The parser raises this as an error, so the poll is marked failed and an admin alert is sent.
- ⚠ `Accuracy` is unlabelled (14 observed). It is assumed to be metres. Altitude is given in both ft and m.
- ✅ `history=72` is accepted (Basic Service keeps 3 days of history). Supabase holds the long-term record.
- ✅ Polling frequency: the owner has previously polled every **1 minute** without problems, so **every 2–5 minutes** is the recommended schedule. No published rate limit was found (public site and FAQ checked).

## Original assumptions

The integration follows FollowMee's published `tracks.aspx` API. I had **no access to your account or to live responses**, so confirm the following against your FollowMee API page and a real call:

| Assumption | Where | Check |
|---|---|---|
| Endpoint `https://www.followmee.com/api/tracks.aspx` with `key`, `username`, `output=json`, `function=historyfordevice`, `deviceid`, `history=<hours>` | `buildHistoryUrl` | Make one call with curl |
| Response `{ "Data": [ { "Date", "Latitude", "Longitude", "Accuracy", "DeviceID", ... } ] }` | `parseFollowMeeResponse` | Compare field names |
| `Date` includes a UTC offset | parser rejects zone-less dates | If your dates have no offset, the parser must be told the account time zone |
| `Accuracy` is in **metres** | stored as `accuracy_m` | Check the docs. If it is in feet, convert |
| Maximum `history` is 72 hours | clamped to 1–72 | ✅ accepted live |
| API rate limits | scheduling | ✅ 1-minute polling used previously without issue; 2–5 min recommended |

Manual check:

```bash
curl "https://www.followmee.com/api/tracks.aspx?key=$FOLLOWMEE_API_KEY&username=$FOLLOWMEE_USERNAME&output=json&function=historyfordevice&deviceid=$FOLLOWMEE_DEVICE_ID&history=1"
```

Then run **Poll FollowMee now** on the admin dashboard and check the batch log at `/admin/imports`.
