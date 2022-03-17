// Karma configuration
// Generated on Fri Feb 25 2022 14:56:07 GMT+0000 (Greenwich Mean Time)

process.env.EDGE_BIN = '/usr/bin/microsoft-edge'

module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['mocha'],
    files: [
      {pattern: 'dist/**/*.js', type: 'module'},
      {pattern: 'test/**/*.js', type: 'module'},
      {pattern: 'node_modules/three137/build/three.module.js', type: 'module'},
      {pattern: 'node_modules/three138/build/three.module.js', type: 'module'},
      {pattern: 'node_modules/three139/build/three.module.js', type: 'module'},
    ],
    mime: {'text/javascript': ['js']},
    exclude: [],
    reporters: ['progress'],
    karmaTypescriptConfig: {
      bundlerOptions: {
        entrypoints: /.test.ts$/,
      },
    },
    client: {mocha: {timeout: 10000}},
    port: 9876,
    colors: true,
    // config.LOG_DISABLE | config.LOG_ERROR | config.LOG_WARN | config.LOG_INFO | config.LOG_DEBUG
    logLevel: config.LOG_INFO,
    autoWatch: true,
    browsers: ['Chrome'],
    singleRun: false,
    concurrency: 100,
  })
}
