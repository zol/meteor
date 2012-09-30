
// Parserlib is heavily exercised by jsparse and jsparse's tests, but we have
// some tests here as well.

Tinytest.add("parserlib - stringify", function (test) {
  var constr = function (name, children) {
    this.name = name;
    this.children = children;
  };
  var testCanonicalize = function (str, expected) {
    if (typeof expected !== "string")
      expected = str; // one-arg case, string is already canonical
    // test normal
    test.equal(ParseNode.stringify(ParseNode.unstringify(str)),
               expected);
    // test with custom constructor
    test.equal(ParseNode.stringify(ParseNode.unstringify(str, constr), constr),
               expected);
  };

  // running strings through unstringify and then stringify is a pretty good
  // way to test these functions.
  testCanonicalize("foo(bar(baz))");
  testCanonicalize("foo(bar(`baz`))", "foo(bar(baz))");
  testCanonicalize("`foo`(`bar`(`baz`))", "foo(bar(baz))");
  testCanonicalize("``(``(`` ``))");
  testCanonicalize("``");
  testCanonicalize("`(`");
  testCanonicalize("`[`", "[");
  testCanonicalize("`foo`", "foo");
  testCanonicalize("functionDecl(function foo `(` `)` { })");
  testCanonicalize("foo(`` `` bar ``)");
  testCanonicalize("foo(`bar``baz`)");
  testCanonicalize("foo(`bar` `baz`)", "foo(bar baz)");
  testCanonicalize("foo(`\n`)");
  testCanonicalize("foo(`foo\nbar`)");
  testCanonicalize("`this is a test`");
  testCanonicalize("`the function is`(`foo()`)");
  testCanonicalize("`thefunctionis`(`foo{}`)", "thefunctionis(foo{})");
});
