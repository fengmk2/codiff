const getViewedKey = (root: string) => `codiff:viewed:${root}`;

export const readViewed = (root: string): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(getViewedKey(root)) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
};

export const writeViewed = (root: string, viewed: Record<string, string>) => {
  localStorage.setItem(getViewedKey(root), JSON.stringify(viewed));
};
