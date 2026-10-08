# Faster Apple notarization uploads from Beijing

`xcrun notarytool submit` uploads a 350 MB DMG from this office at
0.2–0.4 MB/s (10–13 minutes per artifact, twice per release: app.zip and DMG).
The network is not the limit: the same bytes, sent from the same Mac to the
same Apple S3 bucket with our own multipart uploader, go at ~13 MB/s.

`scripts/notarize-relay.mjs` talks to the Notary REST API directly and uploads
with `scripts/notarize-relay-upload.py` (stdlib Python, SigV4, 8 parallel
16 MB parts). It can upload from the Mac itself (`direct`) or ship the file to
a Linux host first (`relay`). `scripts/notarize.mjs` picks the path from
`NOTARIZE_UPLOADER`; `build-mac-dmg.sh` passes it through unchanged.

## Measurements (2026-10-08, OfficeDex-1.0.11-darwin-arm64.dmg, 353.5 MiB)

All Mac-side figures were taken with the Clash HTTP proxy env unset and the
system SOCKS proxy left as it was (on). Nothing below changes any network
setting.

### Mac -> Apple (the leg that matters)

| Path | Rate | 353 MiB takes |
| --- | --- | --- |
| notarytool, system SOCKS proxy on (as this Mac is configured) | 0.34 MB/s (control run: 1038 s) | 17 min |
| notarytool, proxy off | 0.33–0.44 MB/s (parent session) | 13–18 min |
| REST API uploader through Clash 127.0.0.1:7890 | 0.34 MB/s | – |
| **REST API + own multipart uploader, direct, 8 streams** | **13.0 / 15.8 MB/s** on two clean full-size runs, 3.7 MB/s on one run that stalled 50 s | **23–27 s** (98 s worst) |

Earlier "505 B/s to S3 us-west-2" figures were artefacts of timing 403/404
error bodies. Real download from a public us-west-2 object: Mac 7.6 MB/s,
officedex-us 22 MB/s.

### Relay candidates, per hop

| Host | Mac -> host | host -> Apple S3 (real multipart, 128 MB probe) |
| --- | --- | --- |
| officedex-us (Tencent US) | scp 1.66 MB/s (full DMG, 213 s) | 11.5–18.1 MB/s |
| HK jump 43.128.43.116 (Tencent HK) | scp 9.97 MB/s (64 MB) | 13.4 MB/s |
| 18.141.191.80 (AWS Singapore, via HK jump) | scp 3.55 MB/s (64 MB) | 23.2 MB/s |
| void-aliyun (Aliyun Shanghai) | scp 8.68 MB/s (64 MB) | **27 KB/s** download from S3; unusable |
| Huawei OBS cn-north-4 (route B hop) | PUT 6.1 MB/s sustained (full DMG 58 s; a 64 MB put bursts to 24 MB/s) | officedex-us pulls from OBS at 5.8–6.4 MB/s |

### End to end

Every run below is a real submission of the same DMG that Apple answered
`Accepted`; the verdict column is Apple's scan time after the upload finished.

| Route | Mac -> relay | relay/Mac -> Apple S3 | Apple verdict | Total wall |
| --- | --- | --- | --- | --- |
| C: notarytool as today (system SOCKS proxy on) | – | 1038 s (0.34 MB/s) | ~4 min | ~21 min |
| **D: direct REST upload from the Mac** | – | **27 s (13.0 MB/s)** | 221 s | **251 s** |
| D again, inside `notarize.mjs` (integration run) | – | 98 s (3.7 MB/s; a 50 s stall at part 17) | 299 s | 404 s |
| A: Mac -> officedex-us (scp) -> Apple | 213 s (1.66 MB/s) | 20 s (18.1 MB/s) | 236 s | ~490 s (*) |
| A': Mac -> HK host -> Apple (computed from hops) | ~36 s (10 MB/s) | ~27 s (13.4 MB/s) | ~4 min | ~5 min |
| B: Mac -> OBS -> officedex-us -> Apple | 53 s put + 61 s pull | 22 s (16.4 MB/s) | 251 s | 409 s |

(*) The route A end-to-end run reused a copy of the DMG that an earlier scp
had left on the relay, so rsync finished in 8.7 s and the run's wall time was
286 s; the 213 s transfer is the earlier full scp of the same file. A
standalone full-DMG put to OBS afterwards took 58 s, so route B's numbers
are representative.

Apple's own scan takes 3.5–5 minutes regardless of route and dominates every
fast path. The direct upload is the fastest leg we measured from the Mac
(13–16 MB/s; one run stalled to 3.7 MB/s and still beat every relay). Every
relay adds a hop that is slower than Mac -> Apple S3 itself. **Use
`direct`.** Keep `relay` as the fallback for a day when the Mac -> us-west-2
path degrades: the HK jump host is the best relay (10 MB/s in, 13 MB/s out),
and `VIA=obs` works when ssh to the relay is slow.

## Usage

Everything needs the App Store Connect API key, because the script signs its
own ES256 JWT (notarytool's keychain profile cannot be reused):

```bash
export NOTARIZE_API_KEY_PATH=~/.officedex-signing/AuthKey_XXXXXXXXXX.p8
export NOTARIZE_API_KEY_ID=XXXXXXXXXX
export NOTARIZE_API_ISSUER=<issuer uuid>
```

Normal release build, uploading directly:

```bash
NOTARIZE_UPLOADER=direct bash scripts/build-mac-dmg.sh
```

Through a relay host (any Linux box with python3 >= 3.8 and curl, reachable
by ssh without a password):

```bash
NOTARIZE_UPLOADER=relay NOTARIZE_RELAY_HOST=ubuntu@43.128.43.116 bash scripts/build-mac-dmg.sh
```

Standalone, for an already-signed artifact:

```bash
node scripts/notarize-relay.mjs submit dist-artifacts/OfficeDex-1.0.12-darwin-arm64.dmg --staple dist-artifacts/OfficeDex-1.0.12-darwin-arm64.dmg
node scripts/notarize-relay.mjs status <submission-id>
node scripts/notarize-relay.mjs log <submission-id>
```

Bandwidth probes (a real submission is created, 64 MB is uploaded, then the
multipart upload is aborted; Apple never receives a file for it):

```bash
node scripts/notarize-relay.mjs probe-local  some.dmg --mb 64
NOTARIZE_RELAY_HOST=officedex-us node scripts/notarize-relay.mjs probe-remote notarize-relay/some.dmg --mb 64
```

### Environment

| Variable | Meaning |
| --- | --- |
| `NOTARIZE_UPLOADER` | `notarytool` (default, unchanged behaviour), `direct`, `relay` |
| `NOTARIZE_RELAY_FALLBACK=0` | fail instead of retrying with notarytool after a transport error |
| `NOTARIZE_RELAY_HOST` | ssh destination of the relay (`relay` mode) |
| `NOTARIZE_RELAY_DIR` | scratch dir on the relay, relative to `$HOME` (default `notarize-relay`) |
| `NOTARIZE_RELAY_PARALLEL` / `NOTARIZE_RELAY_PART_MB` | S3 streams and part size (8 / 16) |
| `NOTARIZE_RELAY_TRANSFER` | `rsync` (default when installed; resumable) or `scp` |
| `NOTARIZE_RELAY_VIA` | `ssh` (default) or `obs`: push to Huawei OBS, relay pulls a presigned URL |
| `NOTARIZE_RELAY_OBS_BUCKET` / `_REGION` | OBS bucket for `VIA=obs` (defaults: `OBS_BUCKET` / `OBS_REGION` in `scripts/update-channel.mjs`) |
| `NOTARIZE_RELAY_KEEP=1` | leave the file on the relay |
| `NOTARIZE_RELAY_TIMEOUT` | minutes to wait for Apple (60) |

Run with the Clash proxy variables unset (`env -u HTTPS_PROXY -u HTTP_PROXY`)
or exported to nothing: Node's `fetch` and Python's `http.client` honour
`HTTPS_PROXY`, and through Clash the upload drops to 0.3 MB/s. The system
SOCKS proxy setting does not affect these tools.

## Fallback

`notarize.mjs` falls back to `notarytool submit --wait` when the fast path
fails for a transport reason (ssh, S3, API error). It does not fall back when
Apple has already answered `Invalid`/`Rejected`: the verdict would be the same
and the slow upload is wasted. `build-mac-dmg.sh`'s existing
`notarize_with_retry` loop still wraps the whole thing.

Stapling never changes: `xcrun stapler staple` runs on the Mac and only
downloads the ticket.

## Credentials and what travels where

- The `.p8` private key stays on the Mac. The relay receives nothing that
  can sign a JWT.
- The relay receives the one-off S3 credentials for one submission
  (`awsAccessKeyId` / `awsSecretAccessKey` / `awsSessionToken`), on the
  uploader's **stdin**, never in argv or a file. They are scoped by Apple to
  one object and expire with the submission.
- With `VIA=obs`, the relay receives a presigned OBS GET URL (30 minutes),
  again on stdin; OBS keys stay on the Mac and the object is deleted after
  the pull (private ACL, not public-read).
- The artifact itself is deleted from the relay after the upload unless
  `NOTARIZE_RELAY_KEEP=1`.
- The script prints submission ids and S3 object names, never secrets.

## Known gaps

- `probe-*` leaves an empty submission in the Apple history ("In Progress"
  forever, harmless). Avoid running probes casually.
- The relay path stages `notarize-relay-upload.py` with `scp` on every run;
  the relay needs python3 >= 3.8 (void-aliyun has 3.6 and is anyway cut off
  from us-west-2).
- The uploader has no resume across runs; a failed part is retried five
  times, a failed upload starts over (at 13 MB/s that costs under a minute).
- The HK relay figures are computed from per-hop measurements, not a full
  end-to-end run; officedex-us, direct and OBS were run end to end.
