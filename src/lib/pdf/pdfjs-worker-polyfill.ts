/// <reference lib="webworker" />

const mapProto = Map.prototype as unknown as {
  getOrInsertComputed?: (key: unknown, cb: (key: unknown) => unknown) => unknown;
};
const weakMapProto = WeakMap.prototype as unknown as {
  getOrInsertComputed?: (key: object, cb: (key: object) => unknown) => unknown;
};

if (typeof Map !== "undefined" && !mapProto.getOrInsertComputed) {
  mapProto.getOrInsertComputed = function (key: unknown, cb: (key: unknown) => unknown) {
    const selfMap = this as unknown as Map<unknown, unknown>;
    if (selfMap.has(key)) return selfMap.get(key);
    const value = cb(key);
    selfMap.set(key, value);
    return value;
  };
}

if (typeof WeakMap !== "undefined" && !weakMapProto.getOrInsertComputed) {
  weakMapProto.getOrInsertComputed = function (key: object, cb: (key: object) => unknown) {
    const selfMap = this as unknown as WeakMap<object, unknown>;
    if (selfMap.has(key)) return selfMap.get(key);
    const value = cb(key);
    selfMap.set(key, value);
    return value;
  };
}

await import("pdfjs-dist/build/pdf.worker.min.mjs");

export {};