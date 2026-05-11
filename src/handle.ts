/**
 * Time-prefixed lower-hex handle. The microsecond prefix keeps
 * ordering stable for log diff-ing; the random tail prevents
 * collisions when two instances are constructed back-to-back.
 * Avoids pulling in `uuid` for one ID.
 */
export function newHandle(): string {
  const now = (Date.now() * 1000).toString(16).padStart(16, "0");
  return `${now}-${randomTail()}`;
}

/**
 * 16 lower-hex chars of randomness. Prefers `crypto.getRandomValues`
 * (Hermes / JSC ship it; Node has it in `globalThis`); falls back to
 * `Math.random` on runtimes that lack the WebCrypto shim. The handle
 * isn't a security boundary — it's looked up by exact match within
 * the process — so the fallback is acceptable.
 */
function randomTail(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(8);
    cryptoObj.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  let tail = "";
  for (let i = 0; i < 16; i++) {
    tail += Math.floor(Math.random() * 16).toString(16);
  }
  return tail;
}
