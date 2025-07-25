/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import rison from 'rison';
import { useState, useEffect, useCallback } from 'react';
import {
  makeApi,
  SupersetClient,
  t,
  JsonObject,
  getClientErrorObject,
} from '@superset-ui/core';

import {
  createErrorHandler,
  getAlreadyExists,
  getPasswordsNeeded,
  hasTerminalValidation,
  getSSHPasswordsNeeded,
  getSSHPrivateKeysNeeded,
  getSSHPrivateKeyPasswordsNeeded,
} from 'src/views/CRUD/utils';
import type {
  ListViewFetchDataConfig as FetchDataConfig,
  ListViewFilterValue as FilterValue,
} from 'src/components';
import Chart, { Slice } from 'src/types/Chart';
import copyTextToClipboard from 'src/utils/copy';
import { ensureAppRoot } from 'src/utils/pathUtils';
import SupersetText from 'src/utils/textUtils';
import { DatabaseObject } from 'src/features/databases/types';
import { FavoriteStatus, ImportResourceName } from './types';

interface ListViewResourceState<D extends object = any> {
  loading: boolean;
  collection: D[];
  count: number;
  permissions: string[];
  lastFetchDataConfig: FetchDataConfig | null;
  bulkSelectEnabled: boolean;
  lastFetched?: string;
}

const parsedErrorMessage = (
  errorMessage: Record<string, string[] | string> | string,
) => {
  if (typeof errorMessage === 'string') {
    return errorMessage;
  }
  return Object.entries(errorMessage)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `(${key}) ${value.join(', ')}`;
      }
      return `(${key}) ${value}`;
    })
    .join('\n');
};

export function useListViewResource<D extends object = any>(
  resource: string,
  resourceLabel: string, // resourceLabel for translations
  handleErrorMsg: (errorMsg: string) => void,
  infoEnable = true,
  defaultCollectionValue: D[] = [],
  baseFilters?: FilterValue[], // must be memoized
  initialLoadingState = true,
  selectColumns?: string[],
) {
  const [state, setState] = useState<ListViewResourceState<D>>({
    count: 0,
    collection: defaultCollectionValue,
    loading: initialLoadingState,
    lastFetchDataConfig: null,
    permissions: [],
    bulkSelectEnabled: false,
  });

  function updateState(update: Partial<ListViewResourceState<D>>) {
    setState(currentState => ({ ...currentState, ...update }));
  }

  function toggleBulkSelect() {
    updateState({ bulkSelectEnabled: !state.bulkSelectEnabled });
  }

  useEffect(() => {
    if (!infoEnable) return;
    SupersetClient.get({
      endpoint: `/api/v1/${resource}/_info?q=${rison.encode({
        keys: ['permissions'],
      })}`,
    }).then(
      ({ json: infoJson = {} }) => {
        updateState({
          permissions: infoJson.permissions,
        });
      },
      createErrorHandler(errMsg =>
        handleErrorMsg(
          t(
            'An error occurred while fetching %s info: %s',
            resourceLabel,
            errMsg,
          ),
        ),
      ),
    );
  }, []);

  function hasPerm(perm: string) {
    if (!state.permissions.length) {
      return false;
    }

    return Boolean(state.permissions.find(p => p === perm));
  }

  const fetchData = useCallback(
    ({
      pageIndex,
      pageSize,
      sortBy,
      filters: filterValues,
    }: FetchDataConfig) => {
      // set loading state, cache the last config for refreshing data.
      updateState({
        lastFetchDataConfig: {
          filters: filterValues,
          pageIndex,
          pageSize,
          sortBy,
        },
        loading: true,
      });
      const filterExps = (baseFilters || [])
        .concat(filterValues)
        .filter(
          ({ value }) => value !== '' && value !== null && value !== undefined,
        )
        .map(({ id, operator: opr, value }) => ({
          col: id,
          opr,
          value:
            value && typeof value === 'object' && 'value' in value
              ? value.value
              : value,
        }));

      const queryParams = rison.encode_uri({
        order_column: sortBy[0].id,
        order_direction: sortBy[0].desc ? 'desc' : 'asc',
        page: pageIndex,
        page_size: pageSize,
        ...(filterExps.length ? { filters: filterExps } : {}),
        ...(selectColumns?.length ? { select_columns: selectColumns } : {}),
      });

      return SupersetClient.get({
        endpoint: `/api/v1/${resource}/?q=${queryParams}`,
      })
        .then(
          ({ json = {} }) => {
            updateState({
              collection: json.result,
              count: json.count,
              lastFetched: new Date().toISOString(),
            });
          },
          createErrorHandler(errMsg =>
            handleErrorMsg(
              t(
                'An error occurred while fetching %ss: %s',
                resourceLabel,
                errMsg,
              ),
            ),
          ),
        )
        .finally(() => {
          updateState({ loading: false });
        });
    },
    [baseFilters],
  );

  return {
    state: {
      loading: state.loading,
      resourceCount: state.count,
      resourceCollection: state.collection,
      bulkSelectEnabled: state.bulkSelectEnabled,
      lastFetched: state.lastFetched,
    },
    setResourceCollection: (update: D[]) =>
      updateState({
        collection: update,
      }),
    hasPerm,
    fetchData,
    toggleBulkSelect,
    refreshData: (provideConfig?: FetchDataConfig) => {
      if (state.lastFetchDataConfig) {
        return fetchData(state.lastFetchDataConfig);
      }
      if (provideConfig) {
        return fetchData(provideConfig);
      }
      return null;
    },
  };
}

// In the same vein as above, a hook for viewing a single instance of a resource (given id)
interface SingleViewResourceState<D extends object = any> {
  loading: boolean;
  resource: D | null;
  error: any | null;
}

export function useSingleViewResource<D extends object = any>(
  resourceName: string,
  resourceLabel: string, // resourceLabel for translations
  handleErrorMsg: (errorMsg: string) => void,
  path_suffix = '',
) {
  const [state, setState] = useState<SingleViewResourceState<D>>({
    loading: false,
    resource: null,
    error: null,
  });

  function updateState(update: Partial<SingleViewResourceState<D>>) {
    setState(currentState => ({ ...currentState, ...update }));
  }

  const fetchResource = useCallback(
    (resourceID: number) => {
      // Set loading state
      updateState({
        loading: true,
      });

      const baseEndpoint = `/api/v1/${resourceName}/${resourceID}`;
      const endpoint =
        path_suffix !== '' ? `${baseEndpoint}/${path_suffix}` : baseEndpoint;
      return SupersetClient.get({
        endpoint,
      })
        .then(
          ({ json = {} }) => {
            updateState({
              resource: json.result,
              error: null,
            });
            return json.result;
          },
          createErrorHandler((errMsg: Record<string, string[] | string>) => {
            handleErrorMsg(
              t(
                'An error occurred while fetching %ss: %s',
                resourceLabel,
                parsedErrorMessage(errMsg),
              ),
            );

            updateState({
              error: errMsg,
            });
          }),
        )
        .finally(() => {
          updateState({ loading: false });
        });
    },
    [handleErrorMsg, resourceName, resourceLabel],
  );

  const createResource = useCallback(
    (resource: D, hideToast = false) => {
      // Set loading state
      updateState({
        loading: true,
      });

      return SupersetClient.post({
        endpoint: `/api/v1/${resourceName}/`,
        body: JSON.stringify(resource),
        headers: { 'Content-Type': 'application/json' },
      })
        .then(
          ({ json = {} }) => {
            updateState({
              resource: { id: json.id, ...json.result },
              error: null,
            });
            return json.id;
          },
          createErrorHandler((errMsg: Record<string, string[] | string>) => {
            // we did not want toasts for db-connection-ui but did not want to disable it everywhere
            if (!hideToast) {
              handleErrorMsg(
                t(
                  'An error occurred while creating %ss: %s',
                  resourceLabel,
                  parsedErrorMessage(errMsg),
                ),
              );
            }

            updateState({
              error: errMsg,
            });
          }),
        )
        .finally(() => {
          updateState({ loading: false });
        });
    },
    [handleErrorMsg, resourceName, resourceLabel],
  );

  const updateResource = useCallback(
    (resourceID: number, resource: D, hideToast = false, setLoading = true) => {
      // Set loading state
      if (setLoading) {
        updateState({
          loading: true,
        });
      }

      return SupersetClient.put({
        endpoint: `/api/v1/${resourceName}/${resourceID}`,
        body: JSON.stringify(resource),
        headers: { 'Content-Type': 'application/json' },
      })
        .then(
          ({ json = {} }) => {
            updateState({
              resource: { ...json.result, id: json.id },
              error: null,
            });
            return json.result;
          },
          createErrorHandler(errMsg => {
            if (!hideToast) {
              handleErrorMsg(
                t(
                  'An error occurred while fetching %ss: %s',
                  resourceLabel,
                  JSON.stringify(errMsg),
                ),
              );
            }

            updateState({
              error: errMsg,
            });

            return errMsg;
          }),
        )
        .finally(() => {
          if (setLoading) {
            updateState({ loading: false });
          }
        });
    },
    [handleErrorMsg, resourceName, resourceLabel],
  );

  const clearError = () =>
    updateState({
      error: null,
    });

  return {
    state,
    setResource: (update: D) =>
      updateState({
        resource: update,
      }),
    fetchResource,
    createResource,
    updateResource,
    clearError,
  };
}

interface ImportResourceState {
  loading: boolean;
  passwordsNeeded: string[];
  alreadyExists: string[];
  sshPasswordNeeded: string[];
  sshPrivateKeyNeeded: string[];
  sshPrivateKeyPasswordNeeded: string[];
  failed: boolean;
}

export function useImportResource(
  resourceName: ImportResourceName,
  resourceLabel: string, // resourceLabel for translations
  handleErrorMsg: (errorMsg: string) => void,
) {
  const [state, setState] = useState<ImportResourceState>({
    loading: false,
    passwordsNeeded: [],
    alreadyExists: [],
    sshPasswordNeeded: [],
    sshPrivateKeyNeeded: [],
    sshPrivateKeyPasswordNeeded: [],
    failed: false,
  });

  function updateState(update: Partial<ImportResourceState>) {
    setState(currentState => ({ ...currentState, ...update }));
  }

  const importResource = useCallback(
    (
      bundle: File,
      databasePasswords: Record<string, string> = {},
      sshTunnelPasswords: Record<string, string> = {},
      sshTunnelPrivateKey: Record<string, string> = {},
      sshTunnelPrivateKeyPasswords: Record<string, string> = {},
      overwrite = false,
    ) => {
      // Set loading state
      updateState({
        loading: true,
        failed: false,
      });

      const formData = new FormData();
      formData.append('formData', bundle);

      const RE_EXPORT_TEXT = t(
        'Please re-export your file and try importing again',
      );

      /* The import bundle never contains database passwords; if required
       * they should be provided by the user during import.
       */
      if (databasePasswords) {
        formData.append('passwords', JSON.stringify(databasePasswords));
      }
      /* If the imported model already exists the user needs to confirm
       * that they want to overwrite it.
       */
      if (overwrite) {
        formData.append('overwrite', 'true');
      }
      /* The import bundle may contain ssh tunnel passwords; if required
       * they should be provided by the user during import.
       */
      if (sshTunnelPasswords) {
        formData.append(
          'ssh_tunnel_passwords',
          JSON.stringify(sshTunnelPasswords),
        );
      }
      /* The import bundle may contain ssh tunnel private_key; if required
       * they should be provided by the user during import.
       */
      if (sshTunnelPrivateKey) {
        formData.append(
          'ssh_tunnel_private_keys',
          JSON.stringify(sshTunnelPrivateKey),
        );
      }
      /* The import bundle may contain ssh tunnel private_key_password; if required
       * they should be provided by the user during import.
       */
      if (sshTunnelPrivateKeyPasswords) {
        formData.append(
          'ssh_tunnel_private_key_passwords',
          JSON.stringify(sshTunnelPrivateKeyPasswords),
        );
      }

      return SupersetClient.post({
        endpoint: `/api/v1/${resourceName}/import/`,
        body: formData,
        headers: { Accept: 'application/json' },
      })
        .then(() => {
          updateState({
            passwordsNeeded: [],
            alreadyExists: [],
            sshPasswordNeeded: [],
            sshPrivateKeyNeeded: [],
            sshPrivateKeyPasswordNeeded: [],
            failed: false,
          });
          return true;
        })
        .catch(response =>
          getClientErrorObject(response).then(error => {
            updateState({
              failed: true,
            });
            if (!error.errors) {
              handleErrorMsg(
                t(
                  'An error occurred while importing %s: %s',
                  resourceLabel,
                  error.message || error.error,
                ),
              );
              return false;
            }
            if (hasTerminalValidation(error.errors)) {
              handleErrorMsg(
                t(
                  'An error occurred while importing %s: %s',
                  resourceLabel,
                  [
                    ...error.errors.map(payload => payload.message),
                    RE_EXPORT_TEXT,
                  ].join('.\n'),
                ),
              );
            } else {
              updateState({
                passwordsNeeded: getPasswordsNeeded(error.errors),
                sshPasswordNeeded: getSSHPasswordsNeeded(error.errors),
                sshPrivateKeyNeeded: getSSHPrivateKeysNeeded(error.errors),
                sshPrivateKeyPasswordNeeded: getSSHPrivateKeyPasswordsNeeded(
                  error.errors,
                ),
                alreadyExists: getAlreadyExists(error.errors),
              });
            }
            return false;
          }),
        )
        .finally(() => {
          updateState({ loading: false });
        });
    },
    [],
  );

  return { state, importResource };
}

type FavoriteStatusResponse = {
  result: Array<{
    id: string;
    value: boolean;
  }>;
};

const favoriteApis = {
  chart: makeApi<Array<string | number>, FavoriteStatusResponse>({
    requestType: 'rison',
    method: 'GET',
    endpoint: '/api/v1/chart/favorite_status/',
  }),
  dashboard: makeApi<Array<string | number>, FavoriteStatusResponse>({
    requestType: 'rison',
    method: 'GET',
    endpoint: '/api/v1/dashboard/favorite_status/',
  }),
  tag: makeApi<Array<string | number>, FavoriteStatusResponse>({
    requestType: 'rison',
    method: 'GET',
    endpoint: '/api/v1/tag/favorite_status/',
  }),
};

export function useFavoriteStatus(
  type: 'chart' | 'dashboard' | 'tag',
  ids: Array<string | number>,
  handleErrorMsg: (message: string) => void,
) {
  const [favoriteStatus, setFavoriteStatus] = useState<FavoriteStatus>({});

  const updateFavoriteStatus = (update: FavoriteStatus) =>
    setFavoriteStatus(currentState => ({ ...currentState, ...update }));

  useEffect(() => {
    if (!ids.length) {
      return;
    }
    favoriteApis[type](ids).then(
      ({ result }) => {
        const update = result.reduce<Record<string, boolean>>(
          (acc, element) => {
            acc[element.id] = element.value;
            return acc;
          },
          {},
        );
        updateFavoriteStatus(update);
      },
      createErrorHandler(errMsg =>
        handleErrorMsg(
          t('There was an error fetching the favorite status: %s', errMsg),
        ),
      ),
    );
  }, [ids, type, handleErrorMsg]);

  const saveFaveStar = useCallback(
    (id: number, isStarred: boolean) => {
      const endpoint = `/api/v1/${type}/${id}/favorites/`;
      const apiCall = isStarred
        ? SupersetClient.delete({
            endpoint,
          })
        : SupersetClient.post({ endpoint });

      apiCall.then(
        () => {
          updateFavoriteStatus({
            [id]: !isStarred,
          });
        },
        createErrorHandler(errMsg =>
          handleErrorMsg(
            t('There was an error saving the favorite status: %s', errMsg),
          ),
        ),
      );
    },
    [type],
  );

  return [saveFaveStar, favoriteStatus] as const;
}

export const useChartEditModal = (
  setCharts: (charts: Array<Chart>) => void,
  charts: Array<Chart>,
) => {
  const [sliceCurrentlyEditing, setSliceCurrentlyEditing] =
    useState<Slice | null>(null);

  function openChartEditModal(chart: Chart) {
    setSliceCurrentlyEditing({
      slice_id: chart.id,
      slice_name: chart.slice_name,
      description: chart.description,
      cache_timeout: chart.cache_timeout,
      certified_by: chart.certified_by,
      certification_details: chart.certification_details,
      is_managed_externally: chart.is_managed_externally,
    });
  }

  function closeChartEditModal() {
    setSliceCurrentlyEditing(null);
  }

  function handleChartUpdated(edits: Chart) {
    // update the chart in our state with the edited info
    const newCharts = charts.map((chart: Chart) =>
      chart.id === edits.id ? { ...chart, ...edits } : chart,
    );
    setCharts(newCharts);
  }

  return {
    sliceCurrentlyEditing,
    handleChartUpdated,
    openChartEditModal,
    closeChartEditModal,
  };
};

export const copyQueryLink = (
  id: number,
  addDangerToast: (arg0: string) => void,
  addSuccessToast: (arg0: string) => void,
) => {
  copyTextToClipboard(() =>
    Promise.resolve(
      `${window.location.origin}${ensureAppRoot(`/sqllab?savedQueryId=${id}`)}`,
    ),
  )
    .then(() => {
      addSuccessToast(t('Link Copied!'));
    })
    .catch(() => {
      addDangerToast(t('Sorry, your browser does not support copying.'));
    });
};

export const getDatabaseImages = () => SupersetText.DB_IMAGES;

export const getConnectionAlert = () => SupersetText.DB_CONNECTION_ALERTS;
export const getDatabaseDocumentationLinks = () =>
  SupersetText.DB_CONNECTION_DOC_LINKS;

export const testDatabaseConnection = (
  connection: Partial<DatabaseObject>,
  handleErrorMsg: (errorMsg: string) => void,
  addSuccessToast: (arg0: string) => void,
) => {
  SupersetClient.post({
    endpoint: 'api/v1/database/test_connection/',
    body: JSON.stringify(connection),
    headers: { 'Content-Type': 'application/json' },
  }).then(
    () => {
      addSuccessToast(t('Connection looks good!'));
    },
    createErrorHandler((errMsg: Record<string, string[] | string> | string) => {
      handleErrorMsg(t('ERROR: %s', parsedErrorMessage(errMsg)));
    }),
  );
};

export function useAvailableDatabases() {
  const [availableDbs, setAvailableDbs] = useState<JsonObject | null>(null);

  const getAvailable = useCallback(() => {
    SupersetClient.get({
      endpoint: `/api/v1/database/available/`,
    }).then(({ json }) => {
      setAvailableDbs(json);
    });
  }, [setAvailableDbs]);

  return [availableDbs, getAvailable] as const;
}

const transformDB = (db: Partial<DatabaseObject> | null) => {
  if (db && Array.isArray(db?.catalog)) {
    return {
      ...db,
      catalog: Object.assign(
        {},
        ...db.catalog.map((x: { name: string; value: string }) => ({
          [x.name]: x.value,
        })),
      ),
    };
  }
  return db;
};

export function useDatabaseValidation() {
  const [validationErrors, setValidationErrors] = useState<JsonObject | null>(
    null,
  );
  const [isValidating, setIsValidating] = useState(false);
  const [hasValidated, setHasValidated] = useState(false);

  const getValidation = useCallback(
    async (database: Partial<DatabaseObject> | null, onCreate = false) => {
      if (database?.parameters?.ssh) {
        setValidationErrors(null);
        setIsValidating(false);
        setHasValidated(true);
        return Promise.resolve([]);
      }

      setIsValidating(true);

      try {
        await SupersetClient.post({
          endpoint: '/api/v1/database/validate_parameters/',
          body: JSON.stringify(transformDB(database)),
          headers: { 'Content-Type': 'application/json' },
        });
        setValidationErrors(null);
        setIsValidating(false);
        setHasValidated(true);
        return [];
      } catch (error) {
        if (typeof error.json === 'function') {
          return error.json().then(({ errors = [] }) => {
            const parsedErrors = errors
              .filter((err: { error_type: string }) => {
                const allowed = [
                  'CONNECTION_MISSING_PARAMETERS_ERROR',
                  'CONNECTION_ACCESS_DENIED_ERROR',
                  'INVALID_PAYLOAD_SCHEMA_ERROR',
                ];
                return allowed.includes(err.error_type) || onCreate;
              })
              .reduce((acc: JsonObject, err_2: any) => {
                const { message, extra } = err_2;

                if (extra?.catalog) {
                  const { idx } = extra.catalog;
                  acc[idx] = {
                    ...acc[idx],
                    ...(extra.catalog.name ? { name: message } : {}),
                    ...(extra.catalog.url ? { url: message } : {}),
                  };
                  return acc;
                }

                if (extra?.invalid) {
                  extra.invalid.forEach((field: string) => {
                    acc[field] = message;
                  });
                }

                if (extra?.missing) {
                  extra.missing.forEach((field_1: string) => {
                    acc[field_1] = 'This is a required field';
                  });
                }

                if (extra?.issue_codes?.length) {
                  acc.description = message || extra.issue_codes[0]?.message;
                }

                return acc;
              }, {});

            setValidationErrors(parsedErrors);
            setIsValidating(false);
            setHasValidated(true);
            return parsedErrors;
          });
        }

        console.error('Unexpected error during validation:', error);
        setIsValidating(false);
        setHasValidated(true);
        return {};
      }
    },
    [setValidationErrors],
  );

  return [
    validationErrors,
    getValidation,
    setValidationErrors,
    isValidating,
    hasValidated,
    setHasValidated,
  ] as const;
}

export const reportSelector = (
  state: Record<string, any>,
  resourceType: string,
  resourceId?: number,
) => {
  if (resourceId) {
    return state.reports[resourceType]?.[resourceId];
  }
  return null;
};
