import { PNG } from 'pngjs';

export function cropPng(pngBuffer, box, padding, imageWidth, imageHeight) {
  const src = PNG.sync.read(pngBuffer);
  const x = Math.max(0, Math.floor(box.x - padding));
  const y = Math.max(0, Math.floor(box.y - padding));
  const right = Math.min(imageWidth, Math.ceil(box.x + box.width + padding));
  const bottom = Math.min(imageHeight, Math.ceil(box.y + box.height + padding));
  const width = Math.max(1, right - x);
  const height = Math.max(1, bottom - y);

  const dst = new PNG({ width, height });
  PNG.bitblt(src, dst, x, y, width, height, 0, 0);
  return PNG.sync.write(dst);
}
