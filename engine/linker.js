var fs = require('fs');
var _ = require('underscore');

// Options:
// - preserveLineNumbers: if true, decorate minimally so that line
//   numbers don't change between input and output
// - path: a (cosmetic) path to print in the header. the first
//   character will be stripped, on the assumption that it's '/'
// - sourceWidth: width in columns to use for the source code
var wrapFile = function (source, options) {
  // The newline after the source closes a '//' comment.
  //
  // The ".call(this)" allows you to do a top-level "this.foo = " to
  // define global variables; this is the only way to do it in
  // CoffeeScript.

  if (options.preserveLineNumbers) {
    return "(function(){" + source + "\n}).call(this);\n";
  } else {
    var ret = "";

    // Prologue
    ret += "(function () {\n\n";

    // Banner
    var width = options.sourceWidth || 70;
    var bannerWidth = width + 3;
    var divider = new Array(bannerWidth + 1).join('/') + "\n";
    var spacer = "// " + new Array(bannerWidth - 6 + 1).join(' ') + " //\n";
    var padding = new Array(bannerWidth + 1).join(' ');
    var blankLine = new Array(width + 1).join(' ') + " //\n";
    ret += divider + spacer;
    ret += "// " + (options.path.slice(1) + padding).slice(0, bannerWidth - 6) +
      " //\n";
    ret += spacer + divider + blankLine;

    // Code, with line numbers
    // You might prefer your line numbers at the beginning of the
    // line, with /* .. */. Well, that requires parsing the source for
    // comments, because you have to do something different if you're
    // already inside a comment.
    var lines = source.split('\n');
    var num = 1;
    _.each(lines, function (line) {
      ret += (line + padding).slice(0, width) + " // " + num + "\n";
      num++;
    });

    // Footer
    ret += divider;

    // Epilogue
    ret += "\n}).call(this);\n\n\n\n\n\n"
    return ret;
  }
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

var maxLineLengthInFiles = function (files) {
  var maxInFile = [];
  _.each(files, function (file) {
    var lines = file.source.split('\n');
    maxInFile.push(_.max(_.pluck(lines, "length")));
  });

  return _.max(maxInFile);
};

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
var link = function (options) {
  var files = _.map(options.inputFiles, _.clone);

  if (! files.length)
    return [];

  // Find the maximum line length
  var sourceWidth = _.max([70, maxLineLengthInFiles(files)]);

  // Wrap each file in its own namespace
  _.each(files, function (file) {
    file.source = wrapFile(file.source, {
      path: file.servePath,
      preserveLineNumbers: options.useGlobalNamespace,
      sourceWidth: sourceWidth
    });
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