/**
 * Adapted from Canvas UI rect-cache.
 * Copyright (c) 2026 David Haz.
 * See THIRD_PARTY_NOTICES.md.
 */
export function createRectCache(element: Element) {
  let current = element.getBoundingClientRect();

  const refresh = () => {
    current = element.getBoundingClientRect();
  };

  const observer = new ResizeObserver(refresh);
  observer.observe(element);

  return {
    get current() {
      refresh();
      return current;
    },
    destroy() {
      observer.disconnect();
    },
  };
}
