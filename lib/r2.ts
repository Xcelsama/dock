import { AwsClient } from "aws4fetch";

// Cloudflare R2 (S3-compatible). Server-only: these keys never reach the browser.
const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET;

export const r2Configured = Boolean(accountId && accessKeyId && secretAccessKey && bucket);

const aws = r2Configured
  ? new AwsClient({
      accessKeyId: accessKeyId as string,
      secretAccessKey: secretAccessKey as string,
      service: "s3",
      region: "auto",
    })
  : null;

const base = r2Configured ? `https://${accountId}.r2.cloudflarestorage.com/${bucket}` : "";

export const SIGNED_URL_TTL_SECONDS = 60 * 60;

export async function r2Put(key: string, bytes: Uint8Array, contentType?: string): Promise<void> {
  if (!aws) throw new Error("File storage isn't configured.");
  const res = await aws.fetch(`${base}/${key}`, {
    method: "PUT",
    body: bytes,
    headers: {
      "Content-Type": contentType || "application/octet-stream",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status}) ${await res.text().catch(() => "")}`.trim());
  }
}

export async function r2Delete(key: string): Promise<void> {
  if (!aws) return;
  await aws.fetch(`${base}/${key}`, { method: "DELETE" }).catch(() => {});
}

export async function r2SignedGetUrl(
  key: string,
  opts: { downloadName?: string; contentType?: string | null } = {}
): Promise<string> {
  if (!aws) throw new Error("File storage isn't configured.");
  const url = new URL(`${base}/${key}`);
  url.searchParams.set("X-Amz-Expires", String(SIGNED_URL_TTL_SECONDS));
  if (opts.downloadName) {
    url.searchParams.set(
      "response-content-disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(opts.downloadName)}`
    );
  }
  if (opts.contentType) url.searchParams.set("response-content-type", opts.contentType);
  const signed = await aws.sign(url.toString(), { method: "GET", aws: { signQuery: true } });
  return signed.url;
}
