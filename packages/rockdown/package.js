Package.describe({
  summary: "Markdown-like formatting language for Meteor documentation",
  internal: true
});

Package.on_use(function (api) {
  api.add_files(['lexer.js'],
                ['client', 'server']);
});

Package.on_test(function (api) {
  api.use('tinytest');
  api.use('rockdown', 'client');

/*  api.add_files('parser_tests.js',
                // Test just on client for faster running; should run
                // identically on server.
                'client');
                //['client', 'server']);*/
});
