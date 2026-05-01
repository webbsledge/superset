const g = globalThis as any;

if (typeof g.window === 'undefined') {
  g.window = g;
}

g.window.featureFlags = {};

if (typeof g.document === 'undefined') {
  g.document = {
    getElementById: () => null,
    createElement: () => ({
      setAttribute: () => {},
      style: {},
      appendChild: () => {},
    }),
    createTextNode: () => ({}),
    head: { appendChild: () => {} },
    body: { appendChild: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelectorAll: () => [],
    querySelector: () => null,
  };
}

if (typeof g.navigator === 'undefined') {
  g.navigator = {
    userAgent: 'node.js',
    language: 'en',
  };
}

if (typeof g.HTMLElement === 'undefined') {
  g.HTMLElement = class HTMLElement {};
}

if (typeof g.location === 'undefined') {
  g.location = {
    href: '',
    origin: '',
    protocol: 'http:',
    host: 'localhost',
    hostname: 'localhost',
    port: '',
    pathname: '/',
    search: '',
    hash: '',
  };
}

if (typeof g.getComputedStyle === 'undefined') {
  g.getComputedStyle = () => ({});
}

if (typeof g.requestAnimationFrame === 'undefined') {
  g.requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
}

if (typeof g.matchMedia === 'undefined') {
  g.matchMedia = () => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}
