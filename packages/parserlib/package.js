Package.describe({
  summary: "Small library for building parsers and syntax trees",
  internal: true
});

Package.on_use(function (api) {
  api.add_files(['parserlib.js', 'stringify.js'],
                ['client', 'server']);
});

Package.on_test(function (api) {
  api.add_files(['parserlib_tests.js'], 'client');
});
