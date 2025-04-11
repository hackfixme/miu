// Return a deep copy of obj data, excluding functions. I would rather use
// structuredClone, but it fails for Proxy objects and functions.
function deepCopy(obj) {
  if (obj === null || typeof obj !== 'object' || typeof obj === 'function') {
    return typeof obj === 'function' ? undefined : obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.valueOf());
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deepCopy(item));
  }

  if (obj instanceof Map) {
    return new Map(
      Array.from(obj.entries())
        .filter(([_, v]) => typeof v !== 'function')
        .map(([k, v]) => [k, deepCopy(v)])
    );
  }

  return Object.fromEntries(
    Object.entries(obj)
      .filter(([_, v]) => typeof v !== 'function')
      .map(([k, v]) => [k, deepCopy(v)])
  );
}

export { deepCopy };
