import assert from "node:assert/strict";
import test from "node:test";
import { GetObjectCommand, HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { verifyStoredPdfUpload } from "@/lib/pdf-upload-verification";

const file = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", bucket: "test", objectKey: "org/input/file.pdf", sizeBytes: BigInt(5), expectedSizeBytes: BigInt(5), mimeType: "application/pdf" };

function storage(options: { size?: number; mimeType?: string; metadata?: Record<string, string>; bytes?: Uint8Array } = {}) {
  return {
    send: async (command: unknown) => {
      if (command instanceof HeadObjectCommand) return {
        ContentLength: options.size ?? 5,
        ContentType: options.mimeType ?? "application/pdf",
        Metadata: options.metadata ?? { "pfo-file-id": file.id },
      };
      if (command instanceof GetObjectCommand) return { Body: { transformToByteArray: async () => options.bytes ?? new TextEncoder().encode("%PDF-") } };
      throw new Error("Unexpected S3 command");
    },
  } as unknown as S3Client;
}

test("accepts a complete PDF matching database size, MIME, object metadata and PDF signature", async () => {
  assert.deepEqual(await verifyStoredPdfUpload(storage(), file), { valid: true, sizeBytes: 5 });
});

test("rejects upload size, MIME, metadata and PDF signature mismatches", async () => {
  assert.deepEqual(await verifyStoredPdfUpload(storage({ size: 6 }), file), { valid: false, reason: "SIZE_MISMATCH" });
  assert.deepEqual(await verifyStoredPdfUpload(storage({ mimeType: "text/plain" }), file), { valid: false, reason: "MIME_MISMATCH" });
  assert.deepEqual(await verifyStoredPdfUpload(storage({ metadata: { "pfo-file-id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } }), file), { valid: false, reason: "FILE_REFERENCE_MISMATCH" });
  assert.deepEqual(await verifyStoredPdfUpload(storage({ bytes: new TextEncoder().encode("hello") }), file), { valid: false, reason: "PDF_MAGIC_MISMATCH" });
});

test("accepts legacy dashboard objects without the metadata header but still checks PDF bytes", async () => {
  assert.deepEqual(await verifyStoredPdfUpload(storage({ metadata: {} }), file), { valid: true, sizeBytes: 5 });
  assert.deepEqual(await verifyStoredPdfUpload(storage(), { ...file, expectedSizeBytes: BigInt(6) }), { valid: false, reason: "SIZE_MISMATCH" });
});
