#!/usr/bin/env python3
"""S3 multipart uploader for Apple Notary submissions. Stdlib only.

Runs on the relay host (Linux, no Node, no aws cli) and, for measurements, on
the Mac. It takes the temporary S3 credentials that the Notary API returned for
one submission and streams a file into that submission's object with SigV4
signed, parallel multipart uploads.

Credentials arrive as one JSON object on stdin, never on the command line
(argv is visible to every user on the host via ps):

    {"awsAccessKeyId": ..., "awsSecretAccessKey": ..., "awsSessionToken": ...,
     "bucket": ..., "object": ..., "region": "us-west-2"}

Usage:
    notarize-relay-upload.py --file <path> [--parallel 8] [--part-mb 16]
                             [--probe-mb N] [--proxy host:port] [--json]

--probe-mb uploads only the first N MB and then aborts the multipart upload:
a bandwidth measurement that leaves the submission without an object (Apple
simply never processes it). Without it the upload is completed and Apple
starts scanning.

Progress goes to stderr; the final summary goes to stdout (as JSON with
--json). Exit status is non-zero if any part could not be uploaded.
"""

import argparse
import datetime as _dt
import hashlib
import hmac
import http.client
import json
import os
import socket
import ssl
import sys
import threading
import time
import urllib.parse
import xml.etree.ElementTree as ET

SERVICE = "s3"
UNSIGNED = "UNSIGNED-PAYLOAD"
MIN_PART = 5 * 1024 * 1024


def _log(msg):
    sys.stderr.write(f"[relay-upload] {msg}\n")
    sys.stderr.flush()


def _sign(key, msg):
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _signing_key(secret, date, region):
    k = _sign(("AWS4" + secret).encode("utf-8"), date)
    k = _sign(k, region)
    k = _sign(k, SERVICE)
    return _sign(k, "aws4_request")


def _uri_encode(s, encode_slash=True):
    safe = "-_.~" if encode_slash else "-_.~/"
    return urllib.parse.quote(s, safe=safe)


class S3Client:
    """One signer plus a per-thread keep-alive HTTPS connection."""

    def __init__(self, creds, region, proxy=None, timeout=120):
        self.creds = creds
        self.region = region
        self.host = f"{creds['bucket']}.s3.{region}.amazonaws.com"
        self.proxy = proxy
        self.timeout = timeout
        self.local = threading.local()
        self.ctx = ssl.create_default_context()

    def _conn(self, fresh=False):
        conn = getattr(self.local, "conn", None)
        if conn is not None and not fresh:
            return conn
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
        if self.proxy:
            phost, _, pport = self.proxy.rpartition(":")
            conn = http.client.HTTPSConnection(phost, int(pport), timeout=self.timeout, context=self.ctx)
            conn.set_tunnel(self.host, 443)
        else:
            conn = http.client.HTTPSConnection(self.host, 443, timeout=self.timeout, context=self.ctx)
        self.local.conn = conn
        return conn

    def _headers(self, method, path, query, body_len, payload_hash):
        now = _dt.datetime.now(_dt.timezone.utc)
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        date = now.strftime("%Y%m%d")
        headers = {
            "host": self.host,
            "x-amz-content-sha256": payload_hash,
            "x-amz-date": amz_date,
            "x-amz-security-token": self.creds["awsSessionToken"],
        }
        if body_len is not None:
            headers["content-length"] = str(body_len)
        signed = ";".join(sorted(headers))
        canonical_headers = "".join(f"{k}:{headers[k]}\n" for k in sorted(headers))
        canonical_query = "&".join(
            f"{_uri_encode(k)}={_uri_encode(v)}" for k, v in sorted(query.items())
        )
        canonical = "\n".join([
            method,
            _uri_encode(path, encode_slash=False),
            canonical_query,
            canonical_headers,
            signed,
            payload_hash,
        ])
        scope = f"{date}/{self.region}/{SERVICE}/aws4_request"
        string_to_sign = "\n".join([
            "AWS4-HMAC-SHA256",
            amz_date,
            scope,
            hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        ])
        sig = hmac.new(
            _signing_key(self.creds["awsSecretAccessKey"], date, self.region),
            string_to_sign.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        headers["authorization"] = (
            f"AWS4-HMAC-SHA256 Credential={self.creds['awsAccessKeyId']}/{scope}, "
            f"SignedHeaders={signed}, Signature={sig}"
        )
        return headers

    def request(self, method, query, body=b"", payload_hash=None, retries=3, fresh=False):
        """`fresh` opens a new connection first: S3 drops idle keep-alives, so
        the control calls that follow a long upload must not reuse one."""
        path = "/" + _uri_encode(self.creds["object"], encode_slash=False)
        if payload_hash is None:
            payload_hash = hashlib.sha256(body).hexdigest()
        url = path + ("?" + urllib.parse.urlencode(sorted(query.items())) if query else "")
        last = None
        for attempt in range(retries):
            headers = self._headers(method, "/" + self.creds["object"], query, len(body), payload_hash)
            conn = self._conn(fresh=fresh or attempt > 0)
            try:
                conn.request(method, url, body=body, headers=headers)
                resp = conn.getresponse()
                data = resp.read()
                return resp.status, resp.getheaders(), data
            except (OSError, http.client.HTTPException, socket.timeout) as exc:
                last = exc
                _log(f"{method} {query} attempt {attempt + 1} failed: {exc!r}")
                time.sleep(min(2 ** attempt, 8))
        raise RuntimeError(f"{method} failed after {retries} attempts: {last!r}")


def _error_region(data):
    """If S3 rejected the signature's region it says which one it wanted."""
    try:
        root = ET.fromstring(data)
        if root.findtext("Code") == "AuthorizationHeaderMalformed":
            return root.findtext("Region")
    except ET.ParseError:
        pass
    return None


def _fmt(nbytes, secs):
    mb = nbytes / 1048576
    return f"{mb:.1f} MB in {secs:.1f}s = {mb / secs if secs else 0:.2f} MB/s"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--parallel", type=int, default=8)
    ap.add_argument("--part-mb", type=int, default=16)
    ap.add_argument("--probe-mb", type=int, default=0, help="upload only this many MB, then abort")
    ap.add_argument("--proxy", default="", help="HTTP CONNECT proxy host:port")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    creds = json.load(sys.stdin)
    for k in ("awsAccessKeyId", "awsSecretAccessKey", "awsSessionToken", "bucket", "object"):
        if not creds.get(k):
            sys.exit(f"[relay-upload] credentials JSON lacks {k}")
    region = creds.get("region") or "us-west-2"

    size = os.path.getsize(args.file)
    part_size = max(args.part_mb * 1024 * 1024, MIN_PART)
    total = size if not args.probe_mb else min(size, args.probe_mb * 1024 * 1024)
    nparts = (total + part_size - 1) // part_size
    _log(f"{os.path.basename(args.file)}: {size} bytes, {nparts} parts of {part_size >> 20} MB, "
         f"{args.parallel} streams -> s3://{creds['bucket']}/{creds['object']} ({region})"
         + (f" [probe {args.probe_mb} MB]" if args.probe_mb else ""))

    client = S3Client(creds, region, proxy=args.proxy or None)

    # CreateMultipartUpload; if the region guess was wrong S3 tells us.
    for _ in range(2):
        status, _, data = client.request("POST", {"uploads": ""})
        if status == 200:
            break
        wanted = _error_region(data)
        if status == 400 and wanted and wanted != client.region:
            _log(f"S3 wants region {wanted}; re-signing")
            client = S3Client(creds, wanted, proxy=args.proxy or None)
            continue
        sys.exit(f"[relay-upload] CreateMultipartUpload HTTP {status}: {data[:500]!r}")
    upload_id = ET.fromstring(data).find("{*}UploadId").text
    _log(f"multipart upload {upload_id[:16]}... created")

    etags = {}
    done_bytes = 0
    failures = []
    lock = threading.Lock()
    next_part = 1
    t0 = time.monotonic()
    stop = threading.Event()

    def worker():
        nonlocal next_part, done_bytes
        with open(args.file, "rb") as fh:
            while not stop.is_set():
                with lock:
                    if next_part > nparts:
                        return
                    part = next_part
                    next_part += 1
                offset = (part - 1) * part_size
                length = min(part_size, total - offset)
                fh.seek(offset)
                body = fh.read(length)
                query = {"partNumber": str(part), "uploadId": upload_id}
                try:
                    status, headers, data = client.request("PUT", query, body=body, payload_hash=UNSIGNED, retries=5)
                except RuntimeError as exc:
                    with lock:
                        failures.append((part, repr(exc)))
                    stop.set()
                    return
                if status != 200:
                    with lock:
                        failures.append((part, f"HTTP {status}: {data[:300]!r}"))
                    stop.set()
                    return
                etag = dict((k.lower(), v) for k, v in headers)["etag"]
                with lock:
                    etags[part] = etag
                    done_bytes += length

    threads = [threading.Thread(target=worker, daemon=True) for _ in range(min(args.parallel, nparts))]
    for t in threads:
        t.start()
    last_report = t0
    while any(t.is_alive() for t in threads):
        time.sleep(0.5)
        now = time.monotonic()
        if now - last_report >= 5:
            last_report = now
            with lock:
                b = done_bytes
            _log(f"progress {_fmt(b, now - t0)} ({len(etags)}/{nparts} parts)")
    elapsed = time.monotonic() - t0

    if failures or args.probe_mb:
        status, _, data = client.request("DELETE", {"uploadId": upload_id}, fresh=True)
        _log(f"aborted multipart upload (HTTP {status})")
        if failures:
            for part, why in failures:
                _log(f"part {part} failed: {why}")
            sys.exit(1)
        summary = {"mode": "probe", "bytes": done_bytes, "seconds": round(elapsed, 2),
                   "mb_per_s": round(done_bytes / 1048576 / elapsed, 3), "parts": len(etags),
                   "parallel": args.parallel, "part_mb": part_size >> 20, "region": client.region}
    else:
        body = "<CompleteMultipartUpload>" + "".join(
            f"<Part><PartNumber>{n}</PartNumber><ETag>{etags[n]}</ETag></Part>" for n in sorted(etags)
        ) + "</CompleteMultipartUpload>"
        status, _, data = client.request("POST", {"uploadId": upload_id}, body=body.encode("utf-8"), fresh=True)
        if status != 200 or b"<Error>" in data:
            sys.exit(f"[relay-upload] CompleteMultipartUpload HTTP {status}: {data[:500]!r}")
        _log(f"completed: {_fmt(done_bytes, elapsed)}")
        summary = {"mode": "upload", "bytes": done_bytes, "seconds": round(elapsed, 2),
                   "mb_per_s": round(done_bytes / 1048576 / elapsed, 3), "parts": len(etags),
                   "parallel": args.parallel, "part_mb": part_size >> 20, "region": client.region}

    if args.json:
        print(json.dumps(summary))
    else:
        print(f"{summary['mode']}: {_fmt(summary['bytes'], summary['seconds'])} "
              f"({summary['parts']} parts x {summary['part_mb']} MB, {summary['parallel']} streams)")


if __name__ == "__main__":
    main()
