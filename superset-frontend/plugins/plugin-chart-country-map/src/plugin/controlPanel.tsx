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
import { t } from '@apache-superset/core/translation';
import { validateNonEmpty } from '@superset-ui/core';
import {
  ControlPanelConfig,
  D3_FORMAT_DOCS,
  D3_FORMAT_OPTIONS,
  getStandardizedControls,
} from '@superset-ui/chart-controls';

// ----------------------------------------------------------------------
// Choice tables
//
// These are hardcoded for the POC. A follow-up commit will replace them
// with options pulled from the build pipeline's manifest.json so adding
// a new worldview or country only requires a build script run, not a
// plugin code change.
// ----------------------------------------------------------------------

const WORLDVIEW_CHOICES: Array<[string, string]> = [
  ['ukr', t('Ukraine (default — Crimea as Ukrainian)')],
  ['default', t('Natural Earth Default')],
  // Future: pull the rest from the build manifest. Available NE
  // worldviews include arg, bdg, bra, chn, deu, egy, esp, fra, gbr,
  // grc, idn, ind, isr, ita, jpn, kor, mar, nep, nld, pak, pol, prt,
  // pse, rus, sau, swe, tur, twn, ukr, usa, vnm.
];

const ADMIN_LEVEL_CHOICES: Array<[string, string]> = [
  [String(0), t('Countries (Admin 0)')],
  [String(1), t('Subdivisions (Admin 1)')],
  ['aggregated', t('Aggregated regions')],
];

// ISO_A3 country codes that have at least 2 subdivisions in NE Admin 1.
// Hardcoded snapshot — should come from build manifest in follow-up.
const COUNTRY_CHOICES: Array<[string, string]> = [
  ['USA', t('United States')],
  ['CAN', t('Canada')],
  ['MEX', t('Mexico')],
  ['BRA', t('Brazil')],
  ['ARG', t('Argentina')],
  ['GBR', t('United Kingdom')],
  ['FRA', t('France')],
  ['DEU', t('Germany')],
  ['ITA', t('Italy')],
  ['ESP', t('Spain')],
  ['NLD', t('Netherlands')],
  ['BEL', t('Belgium')],
  ['CHE', t('Switzerland')],
  ['AUT', t('Austria')],
  ['POL', t('Poland')],
  ['SWE', t('Sweden')],
  ['NOR', t('Norway')],
  ['FIN', t('Finland')],
  ['DNK', t('Denmark')],
  ['PRT', t('Portugal')],
  ['GRC', t('Greece')],
  ['TUR', t('Türkiye')],
  ['UKR', t('Ukraine')],
  ['RUS', t('Russia')],
  ['CHN', t('China (incl. Taiwan / HK / Macau)')],
  ['JPN', t('Japan')],
  ['KOR', t('South Korea')],
  ['IND', t('India')],
  ['IDN', t('Indonesia')],
  ['THA', t('Thailand')],
  ['VNM', t('Vietnam')],
  ['PHL', t('Philippines')],
  ['MYS', t('Malaysia')],
  ['AUS', t('Australia')],
  ['NZL', t('New Zealand')],
  ['ZAF', t('South Africa')],
  ['EGY', t('Egypt')],
  ['MAR', t('Morocco')],
  ['NGA', t('Nigeria')],
  ['KEN', t('Kenya')],
  ['ETH', t('Ethiopia')],
  ['LVA', t('Latvia')],
];

// Maps a country to its available regional aggregation sets, sourced
// from regional_aggregations.yaml. Hardcoded snapshot.
const REGION_SET_CHOICES_BY_COUNTRY: Record<string, Array<[string, string]>> = {
  TUR: [['nuts_1', t('NUTS-1 statistical regions')]],
  FRA: [['regions', t('Administrative regions')]],
  ITA: [['regions', t('Administrative regions')]],
  PHL: [['regions', t('Administrative regions')]],
};

// Composite maps from composite_maps.yaml. Each composite is an
// alternative selection for a country (sits alongside the regular
// country picker).
const COMPOSITE_CHOICES: Array<[string, string]> = [
  ['france_overseas', t('France (with overseas territories)')],
];

// NE NAME_<lang> language codes available across most features.
const NAME_LANGUAGE_CHOICES: Array<[string, string]> = [
  ['en', t('English (en)')],
  ['fr', t('French (fr)')],
  ['de', t('German (de)')],
  ['es', t('Spanish (es)')],
  ['it', t('Italian (it)')],
  ['pt', t('Portuguese (pt)')],
  ['ru', t('Russian (ru)')],
  ['zh', t('Chinese (zh)')],
  ['ja', t('Japanese (ja)')],
  ['ko', t('Korean (ko)')],
  ['vi', t('Vietnamese (vi)')],
  ['ar', t('Arabic (ar)')],
  ['hi', t('Hindi (hi)')],
  ['fa', t('Persian (fa)')],
  ['tr', t('Turkish (tr)')],
  ['nl', t('Dutch (nl)')],
  ['pl', t('Polish (pl)')],
  ['sv', t('Swedish (sv)')],
  ['el', t('Greek (el)')],
  ['he', t('Hebrew (he)')],
];

// ----------------------------------------------------------------------
// Visibility helpers
// ----------------------------------------------------------------------

const isAdminCountry = (controls: Record<string, { value?: unknown }>) =>
  controls.admin_level?.value === String(0) || controls.admin_level?.value === 0;
const isAdminSubdivision = (controls: Record<string, { value?: unknown }>) =>
  controls.admin_level?.value === String(1) || controls.admin_level?.value === 1;
const isAdminAggregated = (controls: Record<string, { value?: unknown }>) =>
  controls.admin_level?.value === 'aggregated';

const config: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Map'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'worldview',
            config: {
              type: 'SelectControl',
              label: t('Worldview'),
              description: t(
                'Cartographic perspective for disputed regions. ' +
                  'Defaults to Ukraine worldview (Crimea shown as Ukrainian); ' +
                  'override per-deployment in superset_config.COUNTRY_MAP.default_worldview.',
              ),
              choices: WORLDVIEW_CHOICES,
              default: 'ukr',
              renderTrigger: true,
              clearable: false,
            },
          },
        ],
        [
          {
            name: 'admin_level',
            config: {
              type: 'SelectControl',
              label: t('Admin level'),
              description: t(
                'Choose the geographic level: countries (world map), ' +
                  'subdivisions of one country, or an aggregated regional layer.',
              ),
              choices: ADMIN_LEVEL_CHOICES,
              default: String(0),
              renderTrigger: true,
              clearable: false,
            },
          },
        ],
        [
          {
            name: 'country',
            config: {
              type: 'SelectControl',
              label: t('Country'),
              description: t('Which country to plot subdivisions for.'),
              choices: COUNTRY_CHOICES,
              default: null,
              renderTrigger: true,
              clearable: false,
              validators: [validateNonEmpty],
              visibility: ({ controls }: any) =>
                !isAdminCountry(controls) && !controls.composite?.value,
            },
          },
        ],
        [
          {
            name: 'region_set',
            config: {
              type: 'SelectControl',
              label: t('Aggregated region set'),
              description: t(
                'Which administrative region layer to dissolve into. ' +
                  'Available sets depend on the selected country.',
              ),
              choices: ({ controls }: any) =>
                REGION_SET_CHOICES_BY_COUNTRY[
                  String(controls.country?.value || '')
                ] || [],
              default: null,
              renderTrigger: true,
              clearable: true,
              visibility: ({ controls }: any) => isAdminAggregated(controls),
            },
          },
        ],
        [
          {
            name: 'composite',
            config: {
              type: 'SelectControl',
              label: t('Composite map'),
              description: t(
                'Multi-country composite (e.g. France with overseas territories). ' +
                  'When set, overrides admin level + country.',
              ),
              choices: COMPOSITE_CHOICES,
              default: null,
              renderTrigger: true,
              clearable: true,
            },
          },
        ],
        [
          {
            name: 'region_includes',
            config: {
              type: 'SelectControl',
              multi: true,
              freeForm: true,
              label: t('Include only regions'),
              description: t(
                'Comma-separated ISO codes (iso_3166_2 or adm0_a3). ' +
                  'When set, only these features are rendered. Projection ' +
                  'auto-fits to the included set.',
              ),
              choices: [],
              default: [],
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'region_excludes',
            config: {
              type: 'SelectControl',
              multi: true,
              freeForm: true,
              label: t('Exclude regions'),
              description: t(
                'Comma-separated ISO codes to drop from the rendered map.',
              ),
              choices: [],
              default: [],
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'show_flying_islands',
            config: {
              type: 'CheckboxControl',
              label: t('Show flying islands'),
              description: t(
                'When on, far-flung territories (e.g. US Hawaii/Alaska) are ' +
                  'shown — usually repositioned into insets near the mainland. ' +
                  'When off, they are dropped entirely and the viewport tightens ' +
                  'to the remaining mainland.',
              ),
              default: true,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'name_language',
            config: {
              type: 'SelectControl',
              label: t('Name language'),
              description: t(
                'Which language to use for displayed region names. ' +
                  "Falls back to English when the requested language isn't " +
                  'available for a feature.',
              ),
              choices: NAME_LANGUAGE_CHOICES,
              default: 'en',
              renderTrigger: true,
              clearable: false,
            },
          },
        ],
      ],
    },
    {
      label: t('Query'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'entity',
            config: {
              type: 'SelectControl',
              label: t('ISO code column'),
              description: t(
                'Column in your dataset containing ISO codes that match ' +
                  'features in the chosen map (iso_3166_2 for subdivisions, ' +
                  'adm0_a3 for countries).',
              ),
              mapStateToProps: (state: any) => ({
                choices: (state.datasource?.columns ?? []).map((c: any) => [
                  c.column_name,
                  c.column_name,
                ]),
              }),
              validators: [validateNonEmpty],
            },
          },
        ],
        ['metric'],
        ['adhoc_filters'],
        ['row_limit'],
      ],
    },
    {
      label: t('Chart Options'),
      expanded: true,
      tabOverride: 'customize',
      controlSetRows: [
        [
          {
            name: 'number_format',
            config: {
              type: 'SelectControl',
              freeForm: true,
              label: t('Number format'),
              renderTrigger: true,
              default: 'SMART_NUMBER',
              choices: D3_FORMAT_OPTIONS,
              description: D3_FORMAT_DOCS,
            },
          },
        ],
        ['linear_color_scheme'],
      ],
    },
  ],
  controlOverrides: {
    entity: {
      label: t('ISO code column'),
      description: t(
        'Column containing ISO codes of region/province/department in your dataset.',
      ),
    },
    linear_color_scheme: {
      renderTrigger: true,
    },
  },
  formDataOverrides: formData => ({
    ...formData,
    entity: getStandardizedControls().shiftColumn(),
    metric: getStandardizedControls().shiftMetric(),
  }),
};

export default config;
