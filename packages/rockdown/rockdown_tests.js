
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

  test.equal(stringify(Rockdown.parseLines("foo\nbar\n")),
             stringify(unstringify(
               "document(physicalLine(foo) physicalLine(bar) physicalLine(``))")));
});

})();