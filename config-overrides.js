const webpack = require('webpack');

module.exports = function override(config, env) {
  // Add polyfills for Node.js core modules
  config.resolve.fallback = {
    ...config.resolve.fallback,
    "https": require.resolve("https-browserify"),
    "http": require.resolve("stream-http"),
    "stream": require.resolve("stream-browserify"),
    "crypto": require.resolve("crypto-browserify"),
    "buffer": require.resolve("buffer/"),
    "process": require.resolve("process/browser"),
    "util": require.resolve("util/"),
    "zlib": require.resolve("browserify-zlib"),
    "path": require.resolve("path-browserify"),
    "fs": false,
    "net": false,
    "tls": false,
    "child_process": false,
  };

  // Add plugins for modules
  config.plugins.push(
    new webpack.ProvidePlugin({
      process: 'process/browser',
      Buffer: ['buffer', 'Buffer'],
    }),
    // Override AWS credentials with safe placeholder values for GitHub Pages deployment
    new webpack.DefinePlugin({
      'process.env.REACT_APP_AWS_ACCESS_KEY_ID': JSON.stringify('GITHUB_PAGES_DEMO_KEY'),
      'process.env.REACT_APP_AWS_SECRET_ACCESS_KEY': JSON.stringify('GITHUB_PAGES_DEMO_SECRET'),
      'process.env.REACT_APP_MOCK_S3': JSON.stringify('true'),
      'process.env.REACT_APP_ENABLE_AWS': JSON.stringify('false'),
    })
  );

  return config;
};