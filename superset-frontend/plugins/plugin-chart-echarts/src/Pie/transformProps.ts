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
import {
  CategoricalColorNamespace,
  getColumnLabel,
  getMetricLabel,
  getNumberFormatter,
  getTimeFormatter,
  NumberFormats,
  t,
  ValueFormatter,
  getValueFormatter,
  tooltipHtml,
  DataRecord,
} from '@superset-ui/core';
import type { CallbackDataParams } from 'echarts/types/src/util/types';
import type { EChartsCoreOption } from 'echarts/core';
import type { PieSeriesOption } from 'echarts/charts';
import {
  DEFAULT_FORM_DATA as DEFAULT_PIE_FORM_DATA,
  EchartsPieChartProps,
  EchartsPieFormData,
  EchartsPieLabelType,
  PieChartDataItem,
  PieChartTransformedProps,
} from './types';
import { DEFAULT_LEGEND_FORM_DATA, OpacityEnum } from '../constants';
import {
  extractGroupbyLabel,
  getChartPadding,
  getColtypesMapping,
  getLegendProps,
  sanitizeHtml,
} from '../utils/series';
import { defaultGrid } from '../defaults';
import { convertInteger } from '../utils/convertInteger';
import { getDefaultTooltip } from '../utils/tooltip';
import { Refs } from '../types';
import { getContributionLabel } from './utils';

const percentFormatter = getNumberFormatter(NumberFormats.PERCENT_2_POINT);

export function parseParams({
  params,
  numberFormatter,
  sanitizeName = false,
}: {
  params: Pick<CallbackDataParams, 'name' | 'value' | 'percent'>;
  numberFormatter: ValueFormatter;
  sanitizeName?: boolean;
}): string[] {
  const { name: rawName = '', value, percent } = params;
  const name = sanitizeName ? sanitizeHtml(rawName) : rawName;
  const formattedValue = numberFormatter(value as number);
  const formattedPercent = percentFormatter((percent as number) / 100);
  return [name, formattedValue, formattedPercent];
}

function getTotalValuePadding({
  chartPadding,
  donut,
  width,
  height,
}: {
  chartPadding: {
    bottom: number;
    left: number;
    right: number;
    top: number;
  };
  donut: boolean;
  width: number;
  height: number;
}) {
  const padding: {
    left?: string;
    top?: string;
  } = {
    top: donut ? 'middle' : '0',
    left: 'center',
  };
  if (chartPadding.top) {
    padding.top = donut
      ? `${50 + (chartPadding.top / height / 2) * 100}%`
      : `${(chartPadding.top / height) * 100}%`;
  }
  if (chartPadding.bottom) {
    padding.top = donut
      ? `${50 - (chartPadding.bottom / height / 2) * 100}%`
      : '0';
  }
  if (chartPadding.left) {
    // When legend is on the left, shift text right to center it in the available space
    const leftPaddingPercent = (chartPadding.left / width) * 100;
    const adjustedLeftPercent = 50 + leftPaddingPercent * 0.25;
    padding.left = `${adjustedLeftPercent}%`;
  }
  if (chartPadding.right) {
    // When legend is on the right, shift text left to center it in the available space
    const rightPaddingPercent = (chartPadding.right / width) * 100;
    const adjustedLeftPercent = 50 - rightPaddingPercent * 0.75;
    padding.left = `${adjustedLeftPercent}%`;
  }
  return padding;
}

export default function transformProps(
  chartProps: EchartsPieChartProps,
): PieChartTransformedProps {
  const {
    formData,
    height,
    hooks,
    filterState,
    queriesData,
    width,
    theme,
    inContextMenu,
    emitCrossFilters,
    datasource,
  } = chartProps;
  const { columnFormats = {}, currencyFormats = {} } = datasource;
  const { data: rawData = [] } = queriesData[0];
  const coltypeMapping = getColtypesMapping(queriesData[0]);

  const {
    colorScheme,
    donut,
    groupby,
    innerRadius,
    labelsOutside,
    labelLine,
    labelType,
    labelTemplate,
    legendMargin,
    legendOrientation,
    legendType,
    metric = '',
    numberFormat,
    currencyFormat,
    dateFormat,
    outerRadius,
    showLabels,
    showLegend,
    showLabelsThreshold,
    sliceId,
    showTotal,
    roseType,
    thresholdForOther,
  }: EchartsPieFormData = {
    ...DEFAULT_LEGEND_FORM_DATA,
    ...DEFAULT_PIE_FORM_DATA,
    ...formData,
  };
  const refs: Refs = {};
  const metricLabel = getMetricLabel(metric);
  const contributionLabel = getContributionLabel(metricLabel);
  const groupbyLabels = groupby.map(getColumnLabel);
  const minShowLabelAngle = (showLabelsThreshold || 0) * 3.6;

  const numberFormatter = getValueFormatter(
    metric,
    currencyFormats,
    columnFormats,
    numberFormat,
    currencyFormat,
  );

  let data = rawData;
  const otherRows: DataRecord[] = [];
  const otherTooltipData: string[][] = [];
  let otherDatum: PieChartDataItem | null = null;
  let otherSum = 0;
  if (thresholdForOther) {
    let contributionSum = 0;
    data = data.filter(datum => {
      const contribution = datum[contributionLabel] as number;
      if (!contribution || contribution * 100 >= thresholdForOther) {
        return true;
      }
      otherSum += datum[metricLabel] as number;
      contributionSum += contribution;
      otherRows.push(datum);
      otherTooltipData.push([
        extractGroupbyLabel({
          datum,
          groupby: groupbyLabels,
          coltypeMapping,
          timeFormatter: getTimeFormatter(dateFormat),
        }),
        numberFormatter(datum[metricLabel] as number),
        percentFormatter(contribution),
      ]);
      return false;
    });
    const otherName = t('Other');
    otherTooltipData.push([
      t('Total'),
      numberFormatter(otherSum),
      percentFormatter(contributionSum),
    ]);
    if (otherSum) {
      otherDatum = {
        name: otherName,
        value: otherSum,
        itemStyle: {
          color: theme.colorText,
          opacity:
            filterState.selectedValues &&
            !filterState.selectedValues.includes(otherName)
              ? OpacityEnum.SemiTransparent
              : OpacityEnum.NonTransparent,
        },
        isOther: true,
      };
    }
  }

  const labelMap = data.reduce((acc: Record<string, string[]>, datum) => {
    const label = extractGroupbyLabel({
      datum,
      groupby: groupbyLabels,
      coltypeMapping,
      timeFormatter: getTimeFormatter(dateFormat),
    });
    return {
      ...acc,
      [label]: groupbyLabels.map(col => datum[col] as string),
    };
  }, {});

  const { setDataMask = () => {}, onContextMenu } = hooks;
  const colorFn = CategoricalColorNamespace.getScale(colorScheme as string);

  let totalValue = 0;

  const transformedData: PieSeriesOption[] = data.map(datum => {
    const name = extractGroupbyLabel({
      datum,
      groupby: groupbyLabels,
      coltypeMapping,
      timeFormatter: getTimeFormatter(dateFormat),
    });

    const isFiltered =
      filterState.selectedValues && !filterState.selectedValues.includes(name);
    const value = datum[metricLabel];

    if (typeof value === 'number' || typeof value === 'string') {
      totalValue += convertInteger(value);
    }

    return {
      value,
      name,
      itemStyle: {
        color: colorFn(name, sliceId),
        opacity: isFiltered
          ? OpacityEnum.SemiTransparent
          : OpacityEnum.NonTransparent,
      },
    };
  });
  if (otherDatum) {
    transformedData.push(otherDatum);
    totalValue += otherSum;
  }

  const selectedValues = (filterState.selectedValues || []).reduce(
    (acc: Record<string, number>, selectedValue: string) => {
      const index = transformedData.findIndex(
        ({ name }) => name === selectedValue,
      );
      return {
        ...acc,
        [index]: selectedValue,
      };
    },
    {},
  );

  const formatTemplate = (
    template: string,
    formattedParams: {
      name: string;
      value: string;
      percent: string;
    },
    rawParams: CallbackDataParams,
  ) => {
    // This function supports two forms of template variables:
    // 1. {name}, {value}, {percent}, for values formatted by number formatter.
    // 2. {a}, {b}, {c}, {d}, compatible with ECharts formatter.
    //
    // \n is supported to represent a new line.

    const items = {
      '{name}': formattedParams.name,
      '{value}': formattedParams.value,
      '{percent}': formattedParams.percent,
      '{a}': rawParams.seriesName || '',
      '{b}': rawParams.name,
      '{c}': `${rawParams.value}`,
      '{d}': `${rawParams.percent}`,
      '\\n': '\n',
    };

    return Object.entries(items).reduce(
      (acc, [key, value]) => acc.replaceAll(key, value),
      template,
    );
  };

  const formatter = (params: CallbackDataParams) => {
    const [name, formattedValue, formattedPercent] = parseParams({
      params,
      numberFormatter,
    });
    switch (labelType) {
      case EchartsPieLabelType.Key:
        return name;
      case EchartsPieLabelType.Value:
        return formattedValue;
      case EchartsPieLabelType.Percent:
        return formattedPercent;
      case EchartsPieLabelType.KeyValue:
        return `${name}: ${formattedValue}`;
      case EchartsPieLabelType.KeyValuePercent:
        return `${name}: ${formattedValue} (${formattedPercent})`;
      case EchartsPieLabelType.KeyPercent:
        return `${name}: ${formattedPercent}`;
      case EchartsPieLabelType.ValuePercent:
        return `${formattedValue} (${formattedPercent})`;
      case EchartsPieLabelType.Template:
        if (!labelTemplate) {
          return '';
        }
        return formatTemplate(
          labelTemplate,
          {
            name,
            value: formattedValue,
            percent: formattedPercent,
          },
          params,
        );
      default:
        return name;
    }
  };

  const defaultLabel = {
    formatter,
    show: showLabels,
    color: theme.colorText,
  };

  const chartPadding = getChartPadding(
    showLegend,
    legendOrientation,
    legendMargin,
  );

  const series: PieSeriesOption[] = [
    {
      type: 'pie',
      ...chartPadding,
      animation: false,
      roseType: roseType || undefined,
      radius: [`${donut ? innerRadius : 0}%`, `${outerRadius}%`],
      center: ['50%', '50%'],
      avoidLabelOverlap: true,
      labelLine: labelsOutside && labelLine ? { show: true } : { show: false },
      minShowLabelAngle,
      label: labelsOutside
        ? {
            ...defaultLabel,
            position: 'outer',
            alignTo: 'none',
            bleedMargin: 5,
          }
        : {
            ...defaultLabel,
            position: 'inner',
          },
      emphasis: {
        label: {
          show: true,
          fontWeight: 'bold',
          backgroundColor: theme.colorBgContainer,
        },
      },
      data: transformedData,
    },
  ];

  const echartOptions: EChartsCoreOption = {
    grid: {
      ...defaultGrid,
    },
    tooltip: {
      ...getDefaultTooltip(refs),
      show: !inContextMenu,
      trigger: 'item',
      formatter: (params: any) => {
        const [name, formattedValue, formattedPercent] = parseParams({
          params,
          numberFormatter,
          sanitizeName: true,
        });
        if (params?.data?.isOther) {
          return tooltipHtml(otherTooltipData, name);
        }
        return tooltipHtml(
          [[metricLabel, formattedValue, formattedPercent]],
          name,
        );
      },
    },
    legend: {
      ...getLegendProps(legendType, legendOrientation, showLegend, theme),
      data: transformedData.map(datum => datum.name),
    },
    graphic: showTotal
      ? {
          type: 'text',
          ...getTotalValuePadding({ chartPadding, donut, width, height }),
          style: {
            text: t('Total: %s', numberFormatter(totalValue)),
            fontSize: 16,
            fontWeight: 'bold',
            fill: theme.colorText,
          },
          z: 10,
        }
      : null,
    series,
  };

  return {
    formData,
    width,
    height,
    echartOptions,
    setDataMask,
    labelMap,
    groupby,
    selectedValues,
    onContextMenu,
    refs,
    emitCrossFilters,
    coltypeMapping,
  };
}
