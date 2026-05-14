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
import type {
  ControlPanelConfig,
  ControlSetRow,
} from '@superset-ui/chart-controls';
import type { ChartProps } from '@superset-ui/core';
import {
  Argument,
  Select,
  Text,
  Checkbox,
  Int,
  Color,
  isSelectArg,
  isCheckboxArg,
  isIntArg,
  isColorArg,
  isMetricArg,
  isDimensionArg,
  isTemporalArg,
} from './arguments';
import type { VisibilityFn, RgbaColor } from './types';

/**
 * Configuration for a glyph argument with optional visibility control
 */
export interface GlyphArgConfig {
  arg: typeof Argument;
  visibility?: VisibilityFn;
  resetOnHide?: boolean;
}

/**
 * Arguments map - parameter name to argument class or config
 */
export type GlyphArguments = Map<string, typeof Argument | GlyphArgConfig>;

/**
 * Convert hex color string to RGBA object for Superset's ColorPickerControl
 */
function hexToRgba(hex: string): RgbaColor {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result && result[1] && result[2] && result[3]) {
    return {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
      a: 1,
    };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

/**
 * Convert RGBA object to hex color string
 */
function rgbaToHex(rgba: RgbaColor): string {
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(rgba.r)}${toHex(rgba.g)}${toHex(rgba.b)}`;
}

/**
 * Get the argument class from a config (handles both direct class and config object)
 */
function getArgClass(
  argOrConfig: typeof Argument | GlyphArgConfig,
): typeof Argument {
  return 'arg' in argOrConfig ? argOrConfig.arg : argOrConfig;
}

/**
 * Get visibility config if present
 */
function getVisibilityConfig(argOrConfig: typeof Argument | GlyphArgConfig): {
  visibility?: VisibilityFn;
  resetOnHide?: boolean;
} {
  if ('arg' in argOrConfig) {
    return {
      visibility: argOrConfig.visibility,
      resetOnHide: argOrConfig.resetOnHide,
    };
  }
  return {};
}

/**
 * Generate Superset control config from a glyph Argument class
 */
export function getControlConfig(
  argClass: typeof Argument,
  paramName: string,
): Record<string, unknown> & { type: string } {
  const label = argClass.label || paramName;
  const description = argClass.description || '';

  // Select control
  if (isSelectArg(argClass)) {
    return {
      type: 'SelectControl',
      label,
      description,
      default: argClass.default,
      options: argClass.options,
      clearable: argClass.clearable ?? false,
      renderTrigger: true,
    };
  }

  // Checkbox control
  if (isCheckboxArg(argClass)) {
    return {
      type: 'CheckboxControl',
      label,
      description,
      default: argClass.default,
      renderTrigger: true,
    };
  }

  // Int/Slider control
  if (isIntArg(argClass)) {
    return {
      type: 'SliderControl',
      label,
      description,
      default: argClass.default,
      min: argClass.min,
      max: argClass.max,
      step: argClass.step ?? 1,
      renderTrigger: true,
    };
  }

  // Color control
  if (isColorArg(argClass)) {
    // eslint-disable-next-line theme-colors/no-literal-colors
    const hexDefault = argClass.default ?? '#000000';
    return {
      type: 'ColorPickerControl',
      label,
      description,
      default: hexToRgba(hexDefault),
      renderTrigger: true,
    };
  }

  // Default to TextControl
  const textClass = argClass as typeof Text;
  return {
    type: 'TextControl',
    label,
    description,
    default: textClass.default ?? '',
    placeholder: textClass.placeholder ?? '',
    renderTrigger: true,
  };
}

/**
 * Options for control panel generation
 */
export interface ControlPanelOptions {
  /** Additional control rows for the query section */
  queryControls?: ControlSetRow[];
  /** Additional control rows for the chart options section */
  chartOptionsControls?: ControlSetRow[];
  /** Control overrides */
  controlOverrides?: Record<string, Record<string, unknown>>;
  /** Form data overrides function */
  formDataOverrides?: (
    formData: Record<string, unknown>,
  ) => Record<string, unknown>;
}

/**
 * Generate a complete ControlPanelConfig from glyph arguments
 *
 * This is the core function that converts semantic argument definitions
 * into Superset's control panel format.
 */
export function generateControlPanel(
  glyphArguments: GlyphArguments,
  options: ControlPanelOptions = {},
): ControlPanelConfig {
  const queryControls: ControlSetRow[] = [];
  const chartOptionsControls: ControlSetRow[] = [];

  // Process each argument
  for (const [paramName, argOrConfig] of glyphArguments) {
    const argClass = getArgClass(argOrConfig);
    const { visibility, resetOnHide } = getVisibilityConfig(argOrConfig);

    // Data arguments go in Query section
    if (isMetricArg(argClass)) {
      queryControls.push(['metric']);
      continue;
    }

    if (isDimensionArg(argClass)) {
      queryControls.push(['groupby']);
      continue;
    }

    if (isTemporalArg(argClass)) {
      queryControls.push(['x_axis'], ['time_grain_sqla']);
      continue;
    }

    // Style/visual arguments go in Chart Options section
    const controlConfig = getControlConfig(argClass, paramName);

    // Add visibility if specified
    if (visibility) {
      controlConfig.visibility = visibility;
      controlConfig.resetOnHide = resetOnHide ?? false;
    }

    chartOptionsControls.push([
      {
        name: paramName,
        config: controlConfig,
      },
    ]);
  }

  // Add adhoc_filters to query section
  queryControls.push(['adhoc_filters']);

  // Merge with additional controls from options
  const finalQueryControls = [
    ...queryControls,
    ...(options.queryControls || []),
  ];
  const finalChartOptionsControls = [
    ...chartOptionsControls,
    ...(options.chartOptionsControls || []),
  ];

  const config: ControlPanelConfig = {
    controlPanelSections: [
      {
        label: t('Query'),
        expanded: true,
        controlSetRows: finalQueryControls,
      },
      {
        label: t('Chart Options'),
        expanded: true,
        controlSetRows: finalChartOptionsControls,
      },
    ],
  };

  if (options.controlOverrides) {
    config.controlOverrides = options.controlOverrides;
  }

  if (options.formDataOverrides) {
    // Type assertion needed because SqlaFormData is more specific than Record<string, unknown>
    config.formDataOverrides =
      options.formDataOverrides as ControlPanelConfig['formDataOverrides'];
  }

  return config;
}

/**
 * Options for transformProps generation
 */
export interface TransformPropsOptions<TResult> {
  /** Custom transformation function that receives extracted values */
  transform?: (
    values: Record<string, unknown>,
    chartProps: ChartProps,
  ) => TResult;
  /** Additional props to pass through from chartProps */
  passthrough?: (keyof ChartProps)[];
}

/**
 * Generate a transformProps function from glyph arguments
 *
 * This extracts values from formData based on argument definitions,
 * applying type conversions as needed (e.g., RGBA to hex for colors).
 */
export function generateTransformProps<TResult = Record<string, unknown>>(
  glyphArguments: GlyphArguments,
  options: TransformPropsOptions<TResult> = {},
): (chartProps: ChartProps) => TResult {
  return (chartProps: ChartProps) => {
    const { formData, width, height, queriesData } = chartProps;
    const values: Record<string, unknown> = {
      width,
      height,
      queriesData,
    };

    // Add passthrough props
    if (options.passthrough) {
      for (const key of options.passthrough) {
        values[key] = chartProps[key];
      }
    }

    // Extract values from formData based on argument definitions
    for (const [paramName, argOrConfig] of glyphArguments) {
      const argClass = getArgClass(argOrConfig);

      // Skip data arguments (metric, dimension, temporal) - these are handled differently
      if (
        isMetricArg(argClass) ||
        isDimensionArg(argClass) ||
        isTemporalArg(argClass)
      ) {
        continue;
      }

      // Get value from formData, using default if not present
      let value = formData[paramName];

      // Color control: convert RGBA object to hex string
      if (isColorArg(argClass)) {
        const colorClass = argClass as typeof Color;
        // eslint-disable-next-line theme-colors/no-literal-colors
        const defaultRgba = hexToRgba(colorClass.default ?? '#000000');
        const colorValue = value ?? defaultRgba;

        if (
          typeof colorValue === 'object' &&
          colorValue !== null &&
          'r' in colorValue
        ) {
          value = rgbaToHex(colorValue as RgbaColor);
        } else if (typeof colorValue === 'string') {
          value = colorValue;
        } else {
          // eslint-disable-next-line theme-colors/no-literal-colors
          value = colorClass.default ?? '#000000';
        }
      }
      // Select control: use default if no value
      else if (isSelectArg(argClass)) {
        const selectClass = argClass as typeof Select;
        value = value ?? selectClass.default;
      }
      // Checkbox control: use default if no value
      else if (isCheckboxArg(argClass)) {
        const checkboxClass = argClass as typeof Checkbox;
        value = value ?? checkboxClass.default ?? false;
      }
      // Int control: use default if no value
      else if (isIntArg(argClass)) {
        const intClass = argClass as typeof Int;
        value = value ?? intClass.default ?? 0;
      }
      // Text control: use default if no value
      else {
        const textClass = argClass as typeof Text;
        value = value ?? textClass.default ?? '';
      }

      values[paramName] = value;
    }

    // Apply custom transformation if provided
    if (options.transform) {
      return options.transform(values, chartProps);
    }

    return values as TResult;
  };
}

/**
 * Combined result of creating a glyph plugin
 */
export interface GlyphPluginDef<TProps> {
  controlPanel: ControlPanelConfig;
  transformProps: (chartProps: ChartProps) => TProps;
}

/**
 * Create both controlPanel and transformProps from a single argument definition
 *
 * This is the main entry point for the single-file viz pattern.
 */
export function createGlyphPlugin<TProps = Record<string, unknown>>(
  glyphArguments: GlyphArguments,
  controlPanelOptions: ControlPanelOptions = {},
  transformPropsOptions: TransformPropsOptions<TProps> = {},
): GlyphPluginDef<TProps> {
  return {
    controlPanel: generateControlPanel(glyphArguments, controlPanelOptions),
    transformProps: generateTransformProps(
      glyphArguments,
      transformPropsOptions,
    ),
  };
}
