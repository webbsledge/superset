const path = require('path');
const webpack = require('webpack');

const FRONTEND_DIR = path.resolve(__dirname, '../superset-frontend');

module.exports = {
  target: 'node',
  mode: 'production',
  entry: './src/index.ts',
  output: {
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist'),
    libraryTarget: 'commonjs2',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    modules: [path.join(FRONTEND_DIR, 'node_modules'), FRONTEND_DIR, 'node_modules'],
    alias: {
      '@superset-ui/core': path.join(FRONTEND_DIR, 'packages/superset-ui-core/src'),
      '@superset-ui/chart-controls': path.join(
        FRONTEND_DIR,
        'packages/superset-ui-chart-controls/src',
      ),
      '@superset-ui/switchboard': path.join(
        FRONTEND_DIR,
        'packages/superset-ui-switchboard/src',
      ),
      '@apache-superset/core': path.join(FRONTEND_DIR, 'packages/superset-core/src'),
      '@superset-ui/plugin-chart-echarts': path.join(
        FRONTEND_DIR,
        'plugins/plugin-chart-echarts/src',
      ),
      '@superset-ui/plugin-chart-table': path.join(
        FRONTEND_DIR,
        'plugins/plugin-chart-table/src',
      ),
      '@superset-ui/plugin-chart-pivot-table': path.join(
        FRONTEND_DIR,
        'plugins/plugin-chart-pivot-table/src',
      ),
      '@superset-ui/plugin-chart-handlebars': path.join(
        FRONTEND_DIR,
        'plugins/plugin-chart-handlebars/src',
      ),
      '@superset-ui/plugin-chart-word-cloud': path.join(
        FRONTEND_DIR,
        'plugins/plugin-chart-word-cloud/src',
      ),
      '@superset-ui/plugin-chart-cartodiagram': path.join(
        FRONTEND_DIR,
        'plugins/plugin-chart-cartodiagram/src',
      ),
      '@superset-ui/plugin-chart-ag-grid-table': path.join(
        FRONTEND_DIR,
        'plugins/plugin-chart-ag-grid-table/src',
      ),
      '@superset-ui/plugin-chart-point-cluster-map': path.join(
        FRONTEND_DIR,
        'plugins/plugin-chart-point-cluster-map/src',
      ),
      '@superset-ui/preset-chart-deckgl': path.join(
        FRONTEND_DIR,
        'plugins/preset-chart-deckgl/src',
      ),
    },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
            configFile: path.resolve(__dirname, 'tsconfig.json'),
          },
        },
        exclude: /node_modules/,
      },
      {
        test: /\.(png|jpe?g|gif|svg|ico)$/i,
        use: 'null-loader',
      },
      {
        test: /\.(css|less|scss|sass)$/i,
        use: 'null-loader',
      },
    ],
  },
  plugins: [
    new webpack.NormalModuleReplacementPlugin(
      /^@superset-ui\/core$/,
      path.resolve(__dirname, 'src/stubs/superset-ui-core.ts'),
    ),
    new webpack.NormalModuleReplacementPlugin(
      /^@superset-ui\/chart-controls$/,
      path.resolve(__dirname, 'src/stubs/superset-ui-chart-controls.ts'),
    ),
    new webpack.NormalModuleReplacementPlugin(
      /react-markdown/,
      path.resolve(__dirname, 'src/stubs/empty.ts'),
    ),
    new webpack.NormalModuleReplacementPlugin(
      /remark-rehype/,
      path.resolve(__dirname, 'src/stubs/empty.ts'),
    ),
    new webpack.NormalModuleReplacementPlugin(
      /remark-gfm/,
      path.resolve(__dirname, 'src/stubs/empty.ts'),
    ),
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production'),
    }),
  ],
  optimization: {
    minimize: false,
  },
};
