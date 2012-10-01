
(function () {

var stringify = function (obj) {
  return ParseNode.stringify(obj, Rockdown.Node);
};

var unstringify = function (obj) {
  return ParseNode.unstringify(obj, Rockdown.Node);
};

Tinytest.add("rockdown - basic", function (test) {
  // sanity check
  test.equal(stringify(unstringify('foo(bar(`baz`))')), 'foo(bar(baz))');

//  test.equal(stringify(Rockdown.parseLines("foo\nbar\n")),
//             stringify(unstringify(
//               "document(physicalLine(foo) physicalLine(bar) physicalLine(``))")));
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
