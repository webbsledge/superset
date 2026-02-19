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
  CurrencyFormatter,
  ensureIsArray,
  getNumberFormatter,
  getTimeFormatter,
  isSavedMetric,
  NumberFormats,
  QueryFormMetric,
  SMART_DATE_DETAILED_ID,
  SMART_DATE_ID,
  SMART_DATE_VERBOSE_ID,
  TimeFormatter,
  TimeGranularity,
  ValueFormatter,
} from '@superset-ui/core';

export const getSmartDateDetailedFormatter = () =>
  getTimeFormatter(SMART_DATE_DETAILED_ID);

export const getSmartDateFormatter = (timeGrain?: string) => {
  const baseFormatter = getTimeFormatter(SMART_DATE_ID);
  
  // If no time grain provided, use the standard smart date formatter
  if (!timeGrain) {
    return baseFormatter;
  }
  
  // Create a wrapper that normalizes dates based on time grain
  return new TimeFormatter({
    id: SMART_DATE_ID,
    label: baseFormatter.label,
    formatFunc: (date: Date) => {
      // Create a normalized date based on time grain to ensure consistent smart formatting
      const normalizedDate = new Date(date);
      
      // Always remove milliseconds to prevent .XXXms format
      normalizedDate.setMilliseconds(0);
      
      // For month/quarter/year grain, normalize to first of period at midnight
      // This ensures smart formatter detects the right boundary
      if (timeGrain === TimeGranularity.YEAR || timeGrain === 'P1Y') {
        // Set to January 1st at midnight - smart formatter will show year
        normalizedDate.setMonth(0, 1);
        normalizedDate.setHours(0, 0, 0, 0);
      }
      else if (timeGrain === TimeGranularity.QUARTER || timeGrain === 'P3M') {
        // Set to first month of quarter, first day, midnight
        const month = normalizedDate.getMonth();
        const quarterStartMonth = Math.floor(month / 3) * 3;
        normalizedDate.setMonth(quarterStartMonth, 1);
        normalizedDate.setHours(0, 0, 0, 0);
      }
      else if (timeGrain === TimeGranularity.MONTH || timeGrain === 'P1M') {
        // Set to first of month at midnight UTC - smart formatter will show month name or year
        // Use UTC methods to avoid timezone issues
        const year = normalizedDate.getUTCFullYear();
        const month = normalizedDate.getUTCMonth();
        const cleanDate = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
        return baseFormatter(cleanDate);
      }
      else if (timeGrain === TimeGranularity.WEEK || timeGrain === 'P1W') {
        // Set to midnight, keep the day
        normalizedDate.setHours(0, 0, 0, 0);
      }
      else if (timeGrain === TimeGranularity.DAY || timeGrain === 'P1D') {
        // Set to midnight
        normalizedDate.setHours(0, 0, 0, 0);
      }
      else if (timeGrain === TimeGranularity.HOUR || timeGrain === 'PT1H') {
        // Set to top of hour
        normalizedDate.setMinutes(0, 0, 0);
      }
      
      // Use the base formatter on the normalized date
      return baseFormatter(normalizedDate);
    },
  });
};

export const getSmartDateVerboseFormatter = () =>
  getTimeFormatter(SMART_DATE_VERBOSE_ID);

export const getPercentFormatter = (format?: string) =>
  getNumberFormatter(
    !format || format === NumberFormats.SMART_NUMBER
      ? NumberFormats.PERCENT
      : format,
  );

export const getYAxisFormatter = (
  metrics: QueryFormMetric[],
  forcePercentFormatter: boolean,
  customFormatters: Record<string, ValueFormatter>,
  defaultFormatter: ValueFormatter,
  format?: string,
) => {
  if (forcePercentFormatter) {
    return getPercentFormatter(format);
  }
  const metricsArray = ensureIsArray(metrics);
  if (
    metricsArray.every(isSavedMetric) &&
    metricsArray
      .map(metric => customFormatters[metric])
      .every(
        (formatter, _, formatters) =>
          formatter instanceof CurrencyFormatter &&
          (formatter as CurrencyFormatter)?.currency?.symbol ===
            (formatters[0] as CurrencyFormatter)?.currency?.symbol,
      )
  ) {
    return customFormatters[metricsArray[0]];
  }
  return defaultFormatter ?? getNumberFormatter();
};

export function getTooltipTimeFormatter(
  format?: string,
): TimeFormatter | StringConstructor {
  if (format === SMART_DATE_ID) {
    return getSmartDateVerboseFormatter();
  }
  if (format) {
    return getTimeFormatter(format);
  }
  return String;
}

export function getXAxisFormatter(
  format?: string,
  timeGrain?: string,
): TimeFormatter | StringConstructor | undefined {
  if (format === SMART_DATE_ID || !format) {
    return getSmartDateFormatter(timeGrain);
  }
  if (format) {
    return getTimeFormatter(format);
  }
  return String;
}
