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
// eslint-disable-next-line no-restricted-syntax
import React from 'react';
import { theme as antdThemeImport, ThemeConfig, ConfigProvider } from 'antd-v5';
import tinycolor from 'tinycolor2';
import { merge } from 'lodash';

import {
  ThemeProvider as EmotionThemeProvider,
  CacheProvider as EmotionCacheProvider,
} from '@emotion/react';
import createCache from '@emotion/cache';

/* eslint-disable theme-colors/no-literal-colors */

const DEFAULT_SYSTEM_COLORS = {
  primary: '#20a7c9',
  error: '#e04355',
  warning: '#fcc700',
  success: '#5ac189',
  info: '#66bcfe',
  grayscale: '#666666',
};

interface SystemColors {
  primary: string;
  error: string;
  warning: string;
  success: string;
  info: string;
  grayscale: string;
}

interface DeprecatedColorVariations {
  base: string;
  light1: string;
  light2: string;
  light3: string;
  light4: string;
  light5: string;
  dark1: string;
  dark2: string;
  dark3: string;
  dark4: string;
  dark5: string;
}

interface NewColorVariations {
  base: string;
  bg: string;
  bgHover: string;
  border: string;
  borderHover: string;
  hover: string;
  active: string;
  textHover: string;
  text: string;
  textActive: string;
}
interface GrayscaleVariations extends DeprecatedColorVariations {
  bgBase: string;
  bgBlur: string;
  bgContainer: string;
  bgContainerDisabled: string;
  bgElevated: string;
  bgMask: string;
  bgSpotlight: string;
  bgTextActive: string;
  bgTextHover: string;
  border: string;
  borderSecondary: string;
  highlight: string;
  text: string;
  textDescription: string;
  textDisabled: string;
  textHeading: string;
  textLabel: string;
  textLightSolid: string;
  textPlaceholder: string;
  textQuaternary: string;
  textSecondary: string;
  textTertiary: string;
}

interface ColorVariations
  extends DeprecatedColorVariations,
    NewColorVariations {}

interface ThemeColors {
  text: {
    label: string;
    help: string;
  };
  primary: ColorVariations;
  error: ColorVariations;
  warning: ColorVariations;
  success: ColorVariations;
  info: ColorVariations;
  gray: ColorVariations;
  grayscale: GrayscaleVariations;
}

interface LegacyThemeColors {
  primary: DeprecatedColorVariations;
  error: DeprecatedColorVariations;
  warning: DeprecatedColorVariations;
  success: DeprecatedColorVariations;
  info: DeprecatedColorVariations;
  grayscale: DeprecatedColorVariations;
}

interface LegacySupersetTheme {
  borderRadius: number;
  body: {
    backgroundColor: string;
    color: string;
  };
  colors: LegacyThemeColors;
  opacity: {
    light: string;
    mediumLight: string;
    mediumHeavy: string;
    heavy: string;
  };
  typography: {
    families: {
      sansSerif: string;
      monospace: string;
    };
    weights: {
      light: number;
      normal: number;
      medium: number;
      bold: number;
    };
    sizes: {
      xxs: number;
      xs: number;
      s: number;
      m: number;
      l: number;
      xl: number;
      xxl: number;
    };
  };
  zIndex: {
    aboveDashboardCharts: number;
    dropdown: number;
    max: number;
  };
  transitionTiming: number;
  gridUnit: number;
  brandIconMaxWidth: number;
}

export interface SupersetTheme extends LegacySupersetTheme {
  colors: ThemeColors;
}

export class Theme {
  private legacyTheme: LegacySupersetTheme;

  private antdTheme: Record<string, any>;

  private static readonly denyList: RegExp[] = [
    /purple.*/,
    /dragon.*/,
    /geekblue.*/,
    /magenta.*/,
    /volcano.*/,
    /gold.*/,
    /lime.*/,
    /cyan.*/,
    /blue.*/,
    /green.*/,
    /red.*/,
    /yellow.*/,
    /pink.*/,
    /orange.*/,
  ];

  public antdConfig: ThemeConfig;

  get theme(): SupersetTheme {
    return this.getTheme();
  }

  private constructor() {
    this.getTheme = this.getTheme.bind(this);
    this.updateTheme = this.updateTheme.bind(this);
    this.SupersetThemeProvider = this.SupersetThemeProvider.bind(this);
  }

  static fromSystemColors(
    systemColors?: Partial<SystemColors>,
    isDark = false,
  ): Theme {
    const theme = new Theme();
    theme.setThemeWithSystemColors(systemColors || {}, isDark);
    return theme;
  }

  static fromAntdConfig(themeConfig: ThemeConfig): Theme {
    const theme = new Theme();
    theme.setThemeWithAntdConfig(themeConfig);
    return theme;
  }

  getTheme(): SupersetTheme {
    const antd = this.getFilteredAntdTheme();
    const grayScale = (perc: number) =>
      tinycolor.mix('white', 'black', perc).toHexString();
    const standardColors = {
      ...Object.fromEntries(
        ['primary', 'error', 'warning', 'success', 'info'].map(k => {
          const cappedK = k.charAt(0).toUpperCase() + k.slice(1);
          return [
            k,
            {
              ...this.legacyTheme.colors[k],
              bg: antd[`color${cappedK}Bg`],
              bgBase: antd[`color${cappedK}BgBase`],
              bgHover: antd[`color${cappedK}BgHover`],
              border: antd[`color${cappedK}Border`],
              borderHover: antd[`color${cappedK}BorderHover`],
              hover: antd[`color${cappedK}Hover`],
              active: antd[`color${cappedK}Active`],
              textHover: antd[`color${cappedK}TextHover`],
              text: antd[`color${cappedK}Text`],
              textActive: antd[`color${cappedK}TextActive`],
            },
          ];
        }),
      ),
      gray: {
        base: grayScale(50),
        active: grayScale(80),
        textActive: grayScale(70),
        text: grayScale(60),
        textHover: grayScale(50),
        hover: grayScale(40),
        borderHover: grayScale(30),
        border: grayScale(20),
        bgHover: grayScale(10),
        bg: grayScale(5),
      },
    } as ThemeColors;

    const colors: ThemeColors = {
      ...standardColors,
      grayscale: {
        ...this.legacyTheme.colors.grayscale,
        bgBase: antd.colorBgBase,
        bgBlur: antd.colorBgBlur,
        bgContainer: antd.colorBgContainer,
        bgContainerDisabled: antd.colorBgContainerDisabled,
        bgElevated: antd.colorBgElevated,
        bgMask: antd.colorBgMask,
        bgSpotlight: antd.colorBgSpotlight,
        bgTextActive: antd.colorBgTextActive,
        bgTextHover: antd.colorBgTextHover,
        border: antd.colorBorder,
        borderSecondary: antd.colorBorderSecondary,
        highlight: antd.colorHighlight,
        text: antd.colorText,
        textDescription: antd.colorTextDescription,
        textDisabled: antd.colorTextDisabled,
        textHeading: antd.colorTextHeading,
        textLabel: antd.colorTextLabel,
        textLightSolid: antd.colorTextLightSolid,
        textPlaceholder: antd.colorTextPlaceholder,
        textQuaternary: antd.colorTextQuaternary,
        textSecondary: antd.colorTextSecondary,
        textTertiary: antd.colorTextTertiary,
      },
    };

    return {
      ...this.legacyTheme,
      colors,
    };
  }

  private adjustColor(
    color: string,
    percentage: number,
    target: string,
  ): string {
    return tinycolor.mix(color, target, percentage).toHexString();
  }

  private generateColorVariations(
    color: string,
    isDark: boolean,
  ): DeprecatedColorVariations {
    const colors = {
      base: color,
      light1: this.adjustColor(color, 20, 'white'),
      light2: this.adjustColor(color, 45, 'white'),
      light3: this.adjustColor(color, 70, 'white'),
      light4: this.adjustColor(color, 90, 'white'),
      light5: this.adjustColor(color, 95, 'white'),
      dark1: this.adjustColor(color, 10, 'black'),
      dark2: this.adjustColor(color, 20, 'black'),
      dark3: this.adjustColor(color, 40, 'black'),
      dark4: this.adjustColor(color, 60, 'black'),
      dark5: this.adjustColor(color, 80, 'black'),
    };
    if (isDark) {
      return this.swapLightAndDark(colors);
    }
    return colors;
  }

  private swapLightAndDark(
    colorVariations: DeprecatedColorVariations,
  ): DeprecatedColorVariations {
    return {
      ...colorVariations,
      light1: colorVariations.dark1,
      light2: colorVariations.dark2,
      light3: colorVariations.dark3,
      light4: colorVariations.dark4,
      light5: colorVariations.dark5,
      dark1: colorVariations.light1,
      dark2: colorVariations.light2,
      dark3: colorVariations.light3,
      dark4: colorVariations.light4,
      dark5: colorVariations.light5,
    };
  }

  private generateColors(
    systemColors: SystemColors,
    isDark = false,
  ): LegacyThemeColors {
    return {
      primary: this.generateColorVariations(systemColors.primary, isDark),
      error: this.generateColorVariations(systemColors.error, isDark),
      warning: this.generateColorVariations(systemColors.warning, isDark),
      success: this.generateColorVariations(systemColors.success, isDark),
      info: this.generateColorVariations(systemColors.info, isDark),
      grayscale: this.generateColorVariations(systemColors.grayscale, isDark),
    };
  }

  private getLegacySupersetTheme(
    systemColors: Partial<SystemColors>,
    isDark = false,
  ): LegacySupersetTheme {
    const allSystemColors: SystemColors = {
      ...DEFAULT_SYSTEM_COLORS,
      ...systemColors,
    };
    const colors = this.generateColors(allSystemColors, isDark);
    const theme: LegacySupersetTheme = {
      colors,
      borderRadius: 4,
      body: {
        backgroundColor: isDark ? '#000' : '#FFF',
        color: isDark ? '#FFF' : '#000',
      },
      opacity: {
        light: '10%',
        mediumLight: '35%',
        mediumHeavy: '60%',
        heavy: '80%',
      },
      typography: {
        families: {
          sansSerif: `'Inter', Helvetica, Arial`,
          monospace: `'Fira Code', 'Courier New', monospace`,
        },
        weights: {
          light: 200,
          normal: 400,
          medium: 500,
          bold: 600,
        },
        sizes: {
          xxs: 9,
          xs: 10,
          s: 12,
          m: 14,
          l: 16,
          xl: 21,
          xxl: 28,
        },
      },
      zIndex: {
        aboveDashboardCharts: 10,
        dropdown: 11,
        max: 3000,
      },
      transitionTiming: 0.3,
      gridUnit: 4,
      brandIconMaxWidth: 37,
    };
    return theme;
  }

  private getAntdSeedFromLegacyTheme(
    theme: LegacySupersetTheme,
  ): Record<string, any> {
    return {
      ...antdThemeImport.defaultSeed,

      borderRadius: theme.borderRadius,

      colorPrimary: theme.colors.primary.base,
      colorError: theme.colors.error.base,
      colorInfo: theme.colors.info.base,
      colorSuccess: theme.colors.success.base,
      colorWarning: theme.colors.warning.base,
      colorBgLayout: theme.colors.grayscale.light5,

      colorLink: theme.colors.primary.dark1,

      controlHeight: 32,
      fontFamily: theme.typography.families.sansSerif,
      fontFamilyCode: theme.typography.families.monospace,
      fontSize: theme.typography.sizes.m,
      lineType: 'solid',
      lineWidth: 1,
      sizeStep: theme.gridUnit,
      sizeUnit: theme.gridUnit,
      zIndexBase: 0,
      zIndexPopupBase: theme.zIndex.max,
    };
  }

  private getFilteredAntdTheme(): Record<string, any> {
    const theme = this.antdTheme!;
    const filteredTheme: Record<string, any> = {};

    Object.entries(theme).forEach(([key, value]) => {
      if (!Theme.denyList.some(deny => deny.test(key))) {
        filteredTheme[key] = value;
      }
    });

    return filteredTheme;
  }

  private setAntdThemeFromLegacyTheme(
    legacyTheme: LegacySupersetTheme,
    isDark: boolean,
  ): void {
    const seed = this.getAntdSeedFromLegacyTheme(legacyTheme);
    const algorithm = isDark
      ? antdThemeImport.darkAlgorithm
      : antdThemeImport.defaultAlgorithm;

    this.antdConfig = {
      token: seed,
      algorithm,
    };

    this.antdTheme = antdThemeImport.getDesignToken(this.antdConfig);
  }

  private updateTheme(legacyTheme: LegacySupersetTheme, isDark: boolean): void {
    this.legacyTheme = legacyTheme;
    this.setAntdThemeFromLegacyTheme(legacyTheme, isDark);
    this.updateProviders(
      this.theme,
      this.antdConfig,
      createCache({ key: 'superset' }),
    );
  }

  setThemeWithSystemColors(
    systemColors: Partial<SystemColors>,
    isDark: boolean,
  ): void {
    const legacyTheme = this.getLegacySupersetTheme(systemColors, isDark);
    this.updateTheme(legacyTheme, isDark);
  }

  setThemeWithAntdConfig(themeConfig: ThemeConfig): void {
    this.antdConfig = themeConfig;
    const tokens = antdThemeImport.getDesignToken(this.antdConfig);
    this.antdTheme = tokens;
    const isDark = tinycolor(tokens.colorBgBase).isDark();

    this.legacyTheme = {
      colors: {
        primary: this.generateColorVariations(tokens.colorPrimary, isDark),
        error: this.generateColorVariations(tokens.colorError, isDark),
        warning: this.generateColorVariations(tokens.colorWarning, isDark),
        success: this.generateColorVariations(tokens.colorSuccess, isDark),
        info: this.generateColorVariations(tokens.colorInfo, isDark),
        grayscale: this.generateColorVariations('#888', isDark),
      },
      borderRadius: tokens.borderRadius,
      body: {
        backgroundColor: tokens.colorBgLayout,
        color: tokens.colorTextBase,
      },
      opacity: {
        light: '10%',
        mediumLight: '35%',
        mediumHeavy: '60%',
        heavy: '80%',
      },
      typography: {
        families: {
          sansSerif: tokens.fontFamily,
          monospace: tokens.fontFamilyCode,
        },
        weights: {
          light: 200,
          normal: 400,
          medium: 500,
          bold: 600,
        },
        sizes: {
          xxs: tokens.fontSizeSM - 3,
          xs: tokens.fontSizeSM - 2,
          s: tokens.fontSizeSM,
          m: tokens.fontSize,
          l: tokens.fontSizeLG,
          xl: tokens.fontSizeXL,
          xxl: tokens.fontSizeXL + 4,
        },
      },
      zIndex: {
        aboveDashboardCharts: 10,
        dropdown: 11,
        max: 3000,
      },
      transitionTiming: 0.3,
      gridUnit: 4,
      brandIconMaxWidth: 37,
    };
    this.updateProviders(
      this.theme,
      this.antdConfig,
      createCache({ key: 'superset' }),
    );
  }

  mergeTheme(partialTheme: Partial<LegacySupersetTheme>): void {
    const mergedTheme = merge({}, this.legacyTheme, partialTheme);
    const isDark = tinycolor(this.antdTheme.colorBgBase).isDark();
    this.updateTheme(mergedTheme, isDark);
  }

  private updateProviders(
    theme: SupersetTheme,
    antdConfig: ThemeConfig,
    emotionCache: any,
  ): void {}

  SupersetThemeProvider({ children }: { children: React.ReactNode }) {
    if (!this.legacyTheme || !this.antdConfig) {
      throw new Error('Theme is not initialized.');
    }

    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [themeState, setThemeState] = React.useState({
      theme: this.theme,
      antdConfig: this.antdConfig,
      emotionCache: createCache({ key: 'superset' }),
    });

    this.updateProviders = (theme, antdConfig, emotionCache) => {
      setThemeState({ theme, antdConfig, emotionCache });
    };
    return (
      <EmotionCacheProvider value={themeState.emotionCache}>
        <EmotionThemeProvider theme={themeState.theme}>
          <ConfigProvider theme={themeState.antdConfig} prefixCls="antd5">
            {children}
          </ConfigProvider>
        </EmotionThemeProvider>
      </EmotionCacheProvider>
    );
  }
}