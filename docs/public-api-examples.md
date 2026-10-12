# Public API signing and usage examples

Each request signs the exact HTTP method, URL pathname, canonical query, Unix timestamp in seconds, unique nonce, and lowercase hexadecimal SHA-256 of the exact transmitted body bytes, joined with newline characters:

```text
METHOD\n/path\nkey=value&key2=value2\ntimestamp\nnonce\nbody_sha256
```

Query keys and values are URI encoded using RFC 3986 and sorted by key then value. Empty body SHA-256 is `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. Signature is lowercase hex HMAC-SHA256. Nonces may not be reused per key. Keep the Secret server-side.

## Python signing helper

```python
import hashlib, hmac, time, secrets, urllib.parse, requests

def sign(secret, method, url, body=b""):
    parsed = urllib.parse.urlsplit(url)
    pairs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    pairs.sort(key=lambda pair: (pair[0], pair[1]))
    quote = lambda value: urllib.parse.quote(value, safe="~-._")
    query = "&".join(f"{quote(k)}={quote(v)}" for k, v in pairs)
    timestamp, nonce = str(int(time.time())), secrets.token_urlsafe(24)
    digest = hashlib.sha256(body).hexdigest()
    canonical = "\n".join([method.upper(), parsed.path, query, timestamp, nonce, digest])
    signature = hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    return {"X-PFO-Key": KEY_ID, "X-PFO-Timestamp": timestamp, "X-PFO-Nonce": nonce,
            "X-PFO-Content-SHA256": digest, "X-PFO-Signature": signature}

base = "https://api.pdforchestrator.com"
```

## Upload, queue, poll, download

1. POST `/api/public/v1/uploads` with a signed body `{"filename":"invoice.pdf","sizeBytes":12345,"sha256":"<64 hex>"}`. Hash exact bytes locally. PUT the file directly to the returned Cubbit `uploadUrl`, setting every returned header, including `content-type` and `x-amz-meta-pfo-file-id`. For multipart sessions, request a signed part URL for each part and POST part numbers/ETags to `completeUrl`.
2. GET `/api/public/v1/uploads/{fileId}` until it reports `UPLOADED`.
3. POST `/api/public/v1/batches/{slug}/runs` with `{"input":{"document":"<fileId>"}}`, signed over exact JSON bytes and an `Idempotency-Key`. If the credential is scoped to specific versions, add the signed query parameter `?versionId=<publishedVersionUuid>`. The server returns 202 with `runId` and `statusUrl`. Repeating the same key and payload returns the same run.
4. Poll GET `/api/public/v1/runs/{runId}` and GET `/api/public/v1/runs/{runId}/steps`.
5. GET `/api/public/v1/runs/{runId}/outputs`, then fetch the short lived `downloadUrl` or call the signed `/outputs/{fileId}` route again after it expires.

The browser direct upload flow is currently unavailable because Cubbit's S3 gateway does not support bucket CORS configuration. Native clients can PUT directly to the signed URL.

## Webhook verification

Webhook deliveries send the exact JSON bytes with `X-PFO-Event`, `X-PFO-Event-Id`, `X-PFO-Timestamp`, and `X-PFO-Signature: sha256=<hex>`. Verify the signature as `HMAC-SHA256(webhook_secret, timestamp + "." + raw_body)` before parsing JSON. Delivery IDs remain stable across retries; return a 2xx response to stop retries. The worker rejects non-HTTPS URLs, private or local DNS answers, and redirects.
