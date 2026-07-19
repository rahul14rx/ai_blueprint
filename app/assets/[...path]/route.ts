export const runtime = "nodejs";

import { readFile } from "node:fs/promises";
import path from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function assetRoot() {
  return path.resolve(process.cwd(), "dist", "client", "assets");
}

export async function GET(_request: Request, context: { params: { path?: string[] } }) {
  const segments = context.params.path ?? [];
  if (!segments.length) return new Response("Not found", { status: 404 });

  const root = assetRoot();
  const filePath = path.resolve(root, ...segments);
  if (!filePath.startsWith(root + path.sep)) return new Response("Not found", { status: 404 });

  try {
    const data = await readFile(filePath);
    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
    return new Response(data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
