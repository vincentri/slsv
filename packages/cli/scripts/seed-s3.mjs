import { S3Client, CreateBucketCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import zlib from "zlib";

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeB = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcVal = Buffer.alloc(4);
  crcVal.writeUInt32BE(crc32(Buffer.concat([typeB, data])));
  return Buffer.concat([len, typeB, data, crcVal]);
}

function makePng(width, height, r, g, b) {
  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(height * rowSize);
  for (let y = 0; y < height; y++) {
    const off = y * rowSize;
    raw[off] = 0; // filter None
    for (let x = 0; x < width; x++) {
      raw[off + 1 + x * 3] = r;
      raw[off + 2 + x * 3] = g;
      raw[off + 3 + x * 3] = b;
    }
  }
  const idat = zlib.deflateSync(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const s3 = new S3Client({
  region: "us-east-1",
  endpoint: "http://localhost:4566",
  forcePathStyle: true,
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});

const bucket = "media-assets";

async function put(key, body, contentType = "text/plain") {
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
  console.log(`  ✓ ${key}`);
}

// 200x150 black PNG
const PNG_BLACK = makePng(200, 150, 0, 0, 0);
// 200x150 dark-gray PNG (slightly different so thumbnails look distinct)
const PNG_GRAY = makePng(200, 150, 40, 40, 40);

await s3.send(new CreateBucketCommand({ Bucket: bucket })).catch((e) => {
  if (e.name !== "BucketAlreadyOwnedByYou") throw e;
});
console.log(`bucket: ${bucket}`);

// root
await put("readme.txt", "Hello from slsv!");
await put("config.json", JSON.stringify({ version: 1, env: "dev" }, null, 2), "application/json");

// images/2026/
await put("images/2026/photo.jpg", PNG_BLACK, "image/png");
await put("images/2026/banner.png", PNG_GRAY, "image/png");
await put("images/2026/notes.txt", "exif: camera=iPhone, location=Paris");

// images/thumbnails/
await put("images/thumbnails/photo_thumb.jpg", PNG_BLACK, "image/png");
await put("images/thumbnails/banner_thumb.jpg", PNG_GRAY, "image/png");

// docs/
await put("docs/README.md", "# Project docs\n\nWelcome to slsv.");
await put("docs/CHANGELOG.md", "## v0.1.0\n- initial release");
await put("docs/LICENSE.txt", "MIT License");

console.log("done");
