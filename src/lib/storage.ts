import "server-only";
import { S3Client } from "@aws-sdk/client-s3";

function config() {
  const endpoint = process.env.S3_ENDPOINT ?? process.env.CUBBIT_S3_ENDPOINT;
  const region = process.env.S3_REGION ?? process.env.CUBBIT_S3_REGION;
  const bucket = process.env.S3_BUCKET ?? process.env.CUBBIT_S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? process.env.CUBBIT_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? process.env.CUBBIT_S3_SECRET_ACCESS_KEY;
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) throw new Error("Configurazione del server filesystem incompleta.");
  const forcePathStyleValue = process.env.S3_FORCE_PATH_STYLE;
  const forcePathStyle = forcePathStyleValue === undefined ? true : forcePathStyleValue.toLowerCase() === "true";
  return { endpoint, region, bucket, forcePathStyle, credentials: { accessKeyId, secretAccessKey } };
}

export function getStorageConfig() { return config(); }
export function createStorageClient() {
  const { endpoint, region, credentials, forcePathStyle } = config();
  // Cubbit accepts S3 checksum headers but does not currently evaluate them.
  // AWS SDK v3 defaults can add CRC32 query parameters to presigned URLs; keep
  // browser PUT/UploadPart URLs to the interoperable SigV4 request shape.
  return new S3Client({ endpoint, region, credentials, forcePathStyle, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
}
