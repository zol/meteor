
(function () {

var allNodeNames = [
  "document",
  "textBlock",
  "blockquote",
  "ul",
  "li",
  "liCompact",
  "fence",
  "h",
  "hr",
  "singleTag",
  "blankLine",
  "```",
  "code",
  "em",
  "atLink",
  "strong",
  "`",
  "*",
  "__",
  "html",
  ">",
  "mdash"
];

var allNodeNamesSet = {};
_.each(allNodeNames, function (n) { allNodeNamesSet[n] = true; });

var makeTester = function (test) {
  return {
    // Parse code and make sure it matches expectedTreeString.
    goodParse: function (code, expectedTreeString) {
      var expectedTree = Rockdown.Node.unstringify(expectedTreeString);

      var actualTree = Rockdown.parse(code);

      var check = function (tree) {
        if (tree instanceof Rockdown.Node) {
          // This is a NODE (non-terminal).
          var nodeName = tree.name;
          if (! (nodeName && typeof nodeName === "string" &&
                 allNodeNamesSet[nodeName] === true))
            test.fail("Not a node name: " + nodeName);
          _.each(tree.children, check);
        } else if (typeof tree === 'object' &&
                   typeof tree.text === 'function') {
          // This is a TOKEN (terminal).
          // Nothing to check at the moment.
        } else {
          test.fail("Unknown tree part: " + tree);
        }
      };

      check(actualTree);

      test.equal(Rockdown.Node.stringify(actualTree),
                 Rockdown.Node.stringify(expectedTree), code);
    }
  };
};

var stringify = function (obj) {
  return ParseNode.stringify(obj, Rockdown.Node);
};

var unstringify = function (obj) {
  return ParseNode.unstringify(obj, Rockdown.Node);
};

Tinytest.add("rockdown - basic", function (test) {
  // sanity check
  test.equal(stringify(unstringify('foo(bar(`baz`))')), 'foo(bar(baz))');

  var tester = makeTester(test);
  var lines = function (/*args*/) {
    return Array.prototype.join.call(arguments, '\n');
  };

  tester.goodParse("foo",
                   "document(textBlock(foo))");
  tester.goodParse(lines("foo", "bar", ""),
                   "document(textBlock(foo `\n` bar) blankLine())");
  tester.goodParse(lines("foo", "bar", "---"),
                   "document(h(textBlock(foo `\n` bar) ---))");
  tester.goodParse(lines("# foo",
                         "bar",
                         "---"),
                   "document(h(# textBlock(foo)) h(textBlock(bar) ---))");
  tester.goodParse(lines("# foo",
                         "* bar",
                         "---"),
                   "document(h(# textBlock(foo)) ul(liCompact(textBlock(bar))) hr(---))");
  tester.goodParse(lines("* foo",
                         "* bar",
                         "* baz"),
                   "document(ul(liCompact(textBlock(foo)) liCompact(textBlock(bar)) liCompact(textBlock(baz))))");

});

Tinytest.add("rockdown - suite", function (test) {
  var tester = makeTester(test);

  // defined in other file
  var suite = rockdownSuite;
  for(var i = 0; i < suite.length;) {
    var input = suite[i++];
    var expectedTree = suite[i++]();
    tester.goodParse(input, expectedTree);
  }
});


Tinytest.add("rockdown - StickyRegex", function (test) {
  var testAllPositions = function (regex, source, expectedArray) {
    var sr = new Rockdown.StickyRegex(regex);
    for(var i = 0; i < source.length; i++) {
      var result = sr.matchAt(source, i);
      test.isTrue(result === expectedArray[i], i + ": " + result);
    }
  };

  testAllPositions(/a/, "banana", [null, "a", null, "a", null, "a"]);
  testAllPositions(/\b/, "ab cd", ["", null, "", "", null, ""]);
  testAllPositions(/.(?=a)/, "banana", ["b", null, "n", null, "n", null]);
  testAllPositions(/.*/, "apple", ["apple", "pple", "ple", "le", "e", ""]);
});

})();
