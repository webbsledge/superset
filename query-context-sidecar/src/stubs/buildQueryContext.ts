import buildQueryObject from '@superset-ui/core/query/buildQueryObject';
import DatasourceKey from '@superset-ui/core/query/DatasourceKey';
import { normalizeTimeColumn } from '@superset-ui/core/query/normalizeTimeColumn';
import { isXAxisSet } from '@superset-ui/core/query/getXAxis';
import {
  QueryFieldAliases,
  QueryFormData,
} from '@superset-ui/core/query/types/QueryFormData';
import { QueryContext, QueryObject } from '@superset-ui/core/query/types/Query';

const WRAP_IN_ARRAY = (baseQueryObject: QueryObject) => [baseQueryObject];

type BuildFinalQueryObjects = (baseQueryObject: QueryObject) => QueryObject[];

export default function buildQueryContext(
  formData: QueryFormData,
  options?:
    | {
        buildQuery?: BuildFinalQueryObjects;
        queryFields?: QueryFieldAliases;
      }
    | BuildFinalQueryObjects,
): QueryContext {
  const { queryFields, buildQuery = WRAP_IN_ARRAY } =
    typeof options === 'function'
      ? { buildQuery: options, queryFields: {} }
      : options || {};

  let queries = buildQuery(buildQueryObject(formData, queryFields));

  queries.forEach(query => {
    if (Array.isArray(query.post_processing)) {
      query.post_processing = query.post_processing.filter(Boolean);
    }
  });

  if (isXAxisSet(formData)) {
    queries = queries.map(query => normalizeTimeColumn(formData, query));
  }

  return {
    datasource: new DatasourceKey(formData.datasource).toObject(),
    force: formData.force || false,
    queries,
    form_data: formData,
    result_format: formData.result_format || 'json',
    result_type: formData.result_type || 'full',
  };
}
