Package.describe({
  summary: "Full-featured JavaScript parser",
  internal: true
});

Package.on_use(function (api) {
  api.use('parserlib');
  api.add_files(['lexer.js', 'parser.js'],
                ['client', 'server']);
});

Package.on_test(function (api) {
  api.use('tinytest');
  api.use('jsparse', 'client');

  api.add_files('parser_tests.js',
                // Test just on client for faster running; should run
                // identically on server.
                'client');
                //['client', 'server']);
});
