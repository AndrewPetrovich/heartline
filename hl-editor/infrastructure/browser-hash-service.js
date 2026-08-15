function bytesToHex(buffer) {
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export class BrowserHashService {
  async sha256Text(text) {
    const bytes = new TextEncoder().encode(String(text ?? ''));
    return bytesToHex(await crypto.subtle.digest('SHA-256', bytes));
  }

  async sha256Blob(blob) {
    return bytesToHex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  }
}
