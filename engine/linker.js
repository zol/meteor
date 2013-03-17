var fs = require('fs');
var _ = require('underscore');

// options include:
//
// inputFiles: an array of objects representing input files.
//  - source: the source code
//  - servePath: the path where it would prefer to be served if possible
//
// useGlobalNamespace: make the top level namespace be the same as the
// global namespace, so that symbols are accessible from the
// console. typically used when linking apps (as opposed to packages.)
//
// combinedServePath: if we end up combining all of the files into
// one, use this as the servePath.
//
// Output is an array of output files in the same format as
// 'inputFiles'.

var wrapFile = function (source) {
  // The newline after the source closes a '//' comment.
  //
  // The ".call(this)" allows you to do a top-level "this.foo = " to
  // define global variables; this is the only way to do it in
  // CoffeeScript.
  //
  // XXX add a line number comment to each line, in case we don't have
  // source maps, but only if we will combine the files later?
  return "(function(){" + source + "\n}).call(this);\n";
};

// file should have a 'source' attribute. Compute the global
// references and assign them to the 'globalReferences' attribute of
// file, as a map from the name of the global to true. However, if
// file already has such an attribute, do nothing.
//
// For example: if the code references 'Foo.bar.baz' and 'Quux', and
// neither are declared in a scope enclosing the point where they're
// referenced, then globalReferences would incude {Foo: true, Quux:
// true}.
var computeGlobalReferences = function (file) {
  // XXX XXX not implemented
  file.globalReferences = {};
};

var link = function (options) {
  var files = _.map(options.inputFiles, _.clone);

  if (! files.length)
    return [];

  // Wrap each file in its own namespace
  _.each(files, function (file) {
    file.source = wrapFile(file.source);
  });

  // If not using the global namespace, create a second namespace that
  // all of the files share
  if (! options.useGlobalNamespace) {
    // Find all global references in any files
    var globalReferences = {};
    _.each(files, function (file) {
      computeGlobalReferences(file);
      _.extend(globalReferences, file.globalReferences);
    });

    // Create a closure that captures those references
    var combined = "(function () {\n\n";

    if (_.keys(globalReferences).length) {
      combined += "/* Package globals */\n";
      combined += "var " + _.keys(globalReferences).join(', ') + ";\n\n";
    }

    // Emit each file
    _.each(files, function (file) {
      // XXX make banner prettier
      combined += "/* " + file.servePath + " */\n";
      combined += file.source;
      combined += "\n";
    });

    // Postlogue
    combined += "\n})();";

    // Replace all of the files with this new combined file
    files = [{
      servePath: options.combinedServePath,
      source: combined
    }];
  }

  return files;
};

var linker = module.exports = {
  link: link
};