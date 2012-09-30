Package.describe({
  summary: "Markdown-like formatting language for Meteor documentation",
  internal: true
});

Package.on_use(function (api) {
  api.add_files(['rockdown.js'],
                ['client', 'server']);
});

Package.on_test(function (api) {
  api.use('tinytest');
  api.use('rockdown', 'client');
  // for stringify/unstringify of parse trees
  api.use('parserlib', 'client');

  api.add_files('rockdown_tests.js',
                // Test just on client for faster running; should run
                // identically on server.
                'client');
                //['client', 'server']);*/
});
