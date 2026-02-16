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
import { NumberFormats, SMART_DATE_ID, TimeFormatter } from '@superset-ui/core';
import {
  getPercentFormatter,
  getXAxisFormatter,
} from '../../src/utils/formatters';

describe('getPercentFormatter', () => {
  const value = 0.6;
  test('should format as percent if no format is specified', () => {
    expect(getPercentFormatter().format(value)).toEqual('60%');
  });
  test('should format as percent if SMART_NUMBER is specified', () => {
    expect(
      getPercentFormatter(NumberFormats.SMART_NUMBER).format(value),
    ).toEqual('60%');
  });
  test('should format using a provided format', () => {
    expect(
      getPercentFormatter(NumberFormats.PERCENT_2_POINT).format(value),
    ).toEqual('60.00%');
  });
});

describe('getXAxisFormatter', () => {
  test('should return smart date formatter for SMART_DATE_ID format', () => {
    const formatter = getXAxisFormatter(SMART_DATE_ID);
    expect(formatter).toBeDefined();
    expect(formatter).toBeInstanceOf(TimeFormatter);
    expect((formatter as TimeFormatter).id).toBe(SMART_DATE_ID);
  });

  test('should return smart date formatter for undefined format', () => {
    const formatter = getXAxisFormatter();
    expect(formatter).toBeDefined();
    expect(formatter).toBeInstanceOf(TimeFormatter);
    expect((formatter as TimeFormatter).id).toBe(SMART_DATE_ID);
  });

  test('should return custom time formatter for custom format', () => {
    const customFormat = '%Y-%m-%d';
    const formatter = getXAxisFormatter(customFormat);
    expect(formatter).toBeDefined();
    expect(formatter).toBeInstanceOf(TimeFormatter);
    expect((formatter as TimeFormatter).id).toBe(customFormat);
  });

  test('smart date formatter should be returned and not undefined', () => {
    const formatter = getXAxisFormatter(SMART_DATE_ID);
    expect(formatter).toBeDefined();
    expect(formatter).toBeInstanceOf(TimeFormatter);
    expect((formatter as TimeFormatter).id).toBe(SMART_DATE_ID);

    const undefinedFormatter = getXAxisFormatter(undefined);
    expect(undefinedFormatter).toBeDefined();
    expect(undefinedFormatter).toBeInstanceOf(TimeFormatter);
    expect((undefinedFormatter as TimeFormatter).id).toBe(SMART_DATE_ID);

    const emptyFormatter = getXAxisFormatter();
    expect(emptyFormatter).toBeDefined();
    expect(emptyFormatter).toBeInstanceOf(TimeFormatter);
    expect((emptyFormatter as TimeFormatter).id).toBe(SMART_DATE_ID);
  });
});
