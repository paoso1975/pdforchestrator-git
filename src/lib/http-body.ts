export class PayloadTooLargeError extends Error {
  constructor() { super("La richiesta supera la dimensione massima consentita."); this.name = "PayloadTooLargeError"; }
}

export async function readBoundedRequestBody(request: Request, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readBoundedRequestBytes(request, maxBytes));
}

export async function readBoundedRequestBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) throw new PayloadTooLargeError();
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new PayloadTooLargeError(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
