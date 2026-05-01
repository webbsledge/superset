export type BuildQueryFn = (formData: Record<string, unknown>) => unknown;

const registry = new Map<string, BuildQueryFn>();

export function registerBuildQuery(vizType: string, fn: BuildQueryFn): void {
  registry.set(vizType, fn);
}

export function getBuildQuery(vizType: string): BuildQueryFn | undefined {
  return registry.get(vizType);
}

export function listVizTypes(): string[] {
  return Array.from(registry.keys()).sort();
}
