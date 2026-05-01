import { getBuildQuery } from './runtimeRegistry';

export default function getChartBuildQueryRegistry() {
  return {
    get(vizType: string) {
      return getBuildQuery(vizType);
    },
  };
}
