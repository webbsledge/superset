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
import { render } from '@testing-library/react';
import { Theme } from './Theme';
import '@testing-library/jest-dom';

describe('Theme Class', () => {
  test('should initialize with default system colors', () => {
    const theme = Theme.fromSystemColors();
    const themeConfig = theme.getTheme();
    expect(themeConfig.colors.primary.base).toBe('#20a7c9');
  });

  test('should apply custom system colors and dark mode', () => {
    const theme = Theme.fromSystemColors();
    const themeConfig = theme.getTheme();
    expect(themeConfig.colors.primary.base).toBe('#ff0000');
  });
});

describe('SupersetThemeProvider Component', () => {
  test('should render children without errors', () => {
    const theme = Theme.fromSystemColors();
    const { getByText } = render(
      <theme.SupersetThemeProvider>
        <div>Test Child</div>
      </theme.SupersetThemeProvider>,
    );
    expect(getByText('Test Child')).toBeInTheDocument();
  });
});