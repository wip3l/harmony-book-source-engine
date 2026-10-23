import { image } from '@kit.ImageKit';

/** Source-defined geometry only: no website IDs, keys, network or file access. */
export class ImageStripOptions {
  count: number = 1;
  order: number[] = [];
  remainder: string = 'last';
  format: string = 'image/png';
  quality: number = 95;
}

export class ImageStripRange {
  sourceY: number = 0;
  targetY: number = 0;
  height: number = 0;
}

export class NativeImageTransform {
  static readonly MAX_BYTES: number = 20 * 1024 * 1024;
  static readonly MAX_PIXELS: number = 4 * 1024 * 1024;

  static options(json: string): ImageStripOptions {
    if (!json || json.length > 16384) throw new Error('reorderStrips 参数超过限制');
    const value = JSON.parse(json) as ImageStripOptions;
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !Number.isInteger(value.count) || value.count < 1 || value.count > 256) {
      throw new Error('reorderStrips.count 必须为 1 到 256 的整数');
    }
    const options = new ImageStripOptions();
    options.count = value.count;
    if (value.remainder !== undefined) options.remainder = value.remainder;
    if (!['first', 'last'].includes(options.remainder)) throw new Error('reorderStrips.remainder 必须为 first 或 last');
    if (value.format !== undefined) options.format = value.format;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(options.format)) throw new Error('reorderStrips.format 不支持');
    if (value.quality !== undefined) options.quality = value.quality;
    if (!Number.isInteger(options.quality) || options.quality < 0 || options.quality > 100) {
      throw new Error('reorderStrips.quality 必须为 0 到 100 的整数');
    }
    if (value.order !== undefined) {
      if (!Array.isArray(value.order) || value.order.length !== options.count ||
        value.order.some(index => !Number.isInteger(index) || index < 0 || index >= options.count) ||
        new Set(value.order).size !== options.count) throw new Error('reorderStrips.order 必须是完整且不重复的分片序号');
      options.order = value.order;
    } else {
      for (let index = options.count - 1; index >= 0; index--) options.order.push(index);
    }
    return options;
  }

  /** Input strips are numbered top to bottom; order lists the desired output sequence. */
  static ranges(height: number, options: ImageStripOptions): ImageStripRange[] {
    if (!Number.isInteger(height) || height < options.count || height > 16384) {
      throw new Error('reorderStrips 图片高度或分片数无效');
    }
    const base = Math.floor(height / options.count);
    const extra = height % options.count;
    const extraIndex = options.remainder === 'first' ? 0 : options.count - 1;
    const ranges: ImageStripRange[] = [];
    let targetY = 0;
    for (const index of options.order) {
      const range = new ImageStripRange();
      range.sourceY = index * base + (index > extraIndex ? extra : 0);
      range.targetY = targetY;
      range.height = base + (index === extraIndex ? extra : 0);
      targetY += range.height;
      ranges.push(range);
    }
    return ranges;
  }

  static async reorderStrips(input: Uint8Array, json: string): Promise<Uint8Array> {
    const options = this.options(json);
    if (!input.length || input.length > this.MAX_BYTES) throw new Error('reorderStrips 图片超过 20 MiB');
    if (options.count === 1) return input;
    const source = image.createImageSource(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
    let pixels: image.PixelMap | null = null;
    try {
      const info = await source.getImageInfo();
      if (info.size.width <= 0 || info.size.width > 16384 || info.size.height <= 0 ||
        info.size.width * info.size.height > this.MAX_PIXELS) throw new Error('reorderStrips 图片超过 4 Mi 像素或尺寸限制');
      const ranges = this.ranges(info.size.height, options);
      if (await source.getFrameCount() !== 1) throw new Error('reorderStrips 不处理动图');
      pixels = await source.createPixelMap({ desiredPixelFormat: image.PixelMapFormat.RGBA_8888, editable: true });
      const stride = pixels.getBytesNumberPerRow();
      const size = stride * info.size.height;
      if (stride < info.size.width * 4 || size > this.MAX_BYTES) throw new Error('reorderStrips 像素缓冲区超过限制');
      const inputPixels = new ArrayBuffer(size);
      await pixels.readPixelsToBuffer(inputPixels);
      const original = new Uint8Array(inputPixels);
      const reordered = new Uint8Array(size);
      for (const range of ranges) {
        reordered.set(original.subarray(range.sourceY * stride, (range.sourceY + range.height) * stride), range.targetY * stride);
      }
      await pixels.writeBufferToPixels(reordered.buffer);
      const packer = image.createImagePacker();
      try {
        const output = await packer.packToData(pixels, { format: options.format, quality: options.quality });
        if (!output.byteLength || output.byteLength > this.MAX_BYTES) throw new Error('reorderStrips 输出超过 20 MiB');
        return new Uint8Array(output);
      } finally { await packer.release(); }
    } finally {
      try { if (pixels) await pixels.release(); } finally { await source.release(); }
    }
  }
}
