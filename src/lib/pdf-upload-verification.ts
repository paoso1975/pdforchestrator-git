import { GetObjectCommand, HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { hasPdfMagicBytes } from "@/lib/pdf-signature";

export type StoredPdfReference = { id: string; bucket: string; objectKey: string; sizeBytes: bigint | number; expectedSizeBytes?: bigint | number | null; mimeType: string };
export type UploadVerification = { valid: true; sizeBytes: number } | { valid: false; reason: "SIZE_MISMATCH" | "MIME_MISMATCH" | "FILE_REFERENCE_MISMATCH" | "PDF_MAGIC_MISMATCH" | "EMPTY_OBJECT" };

/** Checks S3 metadata and reads only bytes 0-4. Content hashes are verified again by the worker before parsing. */
export async function verifyStoredPdfUpload(storage: S3Client, file: StoredPdfReference): Promise<UploadVerification> {
  if (file.expectedSizeBytes != null && Number(file.expectedSizeBytes) !== Number(file.sizeBytes)) return { valid: false, reason: "SIZE_MISMATCH" };
  const head = await storage.send(new HeadObjectCommand({ Bucket: file.bucket, Key: file.objectKey }));
  if (!head.ContentLength || head.ContentLength <= 0) return { valid: false, reason: "EMPTY_OBJECT" };
  if (head.ContentLength !== Number(file.sizeBytes)) return { valid: false, reason: "SIZE_MISMATCH" };
  if (head.ContentType !== "application/pdf" || file.mimeType !== "application/pdf") return { valid: false, reason: "MIME_MISMATCH" };
  // Older dashboard uploads did not set this metadata. Accept absence for
  // those objects, while rejecting a present metadata value bound to another ID.
  if (head.Metadata?.["pfo-file-id"] && head.Metadata["pfo-file-id"] !== file.id) return { valid: false, reason: "FILE_REFERENCE_MISMATCH" };
  const range = await storage.send(new GetObjectCommand({ Bucket: file.bucket, Key: file.objectKey, Range: "bytes=0-4" }));
  const prefix = range.Body ? await range.Body.transformToByteArray() : new Uint8Array();
  if (!hasPdfMagicBytes(prefix)) return { valid: false, reason: "PDF_MAGIC_MISMATCH" };
  return { valid: true, sizeBytes: head.ContentLength };
}
