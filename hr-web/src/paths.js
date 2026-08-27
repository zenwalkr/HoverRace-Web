function applicationRoot() {
  return new URL('./', document.baseURI);
}

export function assetUrl(...parts) {
  const path = parts.map((part) => encodeURIComponent(part)).join('/');
  return new URL(`assets/${path}`, applicationRoot()).href;
}

export function apiUrl(route, parameters = {}) {
  const url = new URL('api.php', applicationRoot());
  url.searchParams.set('route', route);
  for (const [name, value] of Object.entries(parameters)) {
    if (value != null) url.searchParams.set(name, String(value));
  }
  return url.href;
}
