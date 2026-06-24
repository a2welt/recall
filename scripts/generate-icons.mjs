import sharp from "sharp";
import { resolve } from "node:path";

const source = resolve("ui/public/icon.svg");
for (const size of [192, 512]) {
  await sharp(source, { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(resolve(`ui/public/icon-${size}.png`));
}
