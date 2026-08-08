self.onmessage = async event => {
  const { id, buffer, mimeType } = event.data || {};
  try {
    const digest = await crypto.subtle.digest('SHA-256', buffer.slice(0));
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const blob = new Blob([buffer], { type: mimeType || 'application/octet-stream' });
    let width = 0, height = 0, thumbBuffer = null, thumbType = 'image/webp', thumbWidth = 0, thumbHeight = 0;
    if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {
      const bitmap = await createImageBitmap(blob);
      width = bitmap.width; height = bitmap.height;
      const scale = Math.min(1, 420 / Math.max(width, height));
      thumbWidth = Math.max(1, Math.round(width * scale)); thumbHeight = Math.max(1, Math.round(height * scale));
      const canvas = new OffscreenCanvas(thumbWidth, thumbHeight);
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bitmap, 0, 0, thumbWidth, thumbHeight); bitmap.close?.();
      const thumb = await canvas.convertToBlob({ type: 'image/webp', quality: .82 });
      thumbBuffer = await thumb.arrayBuffer();
    }
    self.postMessage({ id, ok: true, hash, width, height, thumbBuffer, thumbType, thumbWidth, thumbHeight }, thumbBuffer ? [thumbBuffer] : []);
  } catch (error) { self.postMessage({ id, ok: false, error: String(error?.message || error) }); }
};
