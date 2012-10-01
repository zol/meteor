
(function () {

Rockdown = {};

//////////

var StickyRegex = function (regex) {
  // set the regex's flags:
  // force 'g', and use 'i' or 'm' if present
  var flags = ('g' + (regex.ignoreCase ? 'i' : '') +
               (regex.multiline ? 'm' : ''));
  this._regex = new RegExp(regex.source, flags);
  // simulate "sticky" regular expression that only matches
  // at the current position.  We want /a/, for example, to test
  // whether the *next* character is an 'a', not any subsequent
  // character.  So the regex has to succeed no matter what,
  // but we treat the [\s\S] (any character) case as failure.
  // We detect this case using paren groups 1 and 2.
  this._rSticky = new RegExp(
    "((" + this._regex.source + ")|[\\S\\s])", flags);
};

// Match the regex in string `source` starting a position
// `pos`, if possible.  Returns a string of the match
// (possibly empty) on success, and `null` on failure.
StickyRegex.prototype.matchAt = function (source, pos) {
  var r = this._regex;
  var rSticky = this._rSticky;
  var result;
  if (pos === source.length) {
    // At end, no stickiness needed.  See if
    // original regex is happy here.
    r.lastIndex = pos;
    result = r.exec(source) ? "" : null;
  } else {
    rSticky.lastIndex = pos;
    var match = rSticky.exec(source); // always matches
    if (match[2])
      // matched a non-empty string
      result = match[2];
    else if (match[1])
      // failed; hit the [\S\s] case
      result = null;
    else
      // succeeded with empty match
      result = "";
  }
  return result;
};

// export for unit tests' sake
Rockdown.StickyRegex = StickyRegex;

//////////

var isArray = function (obj) {
  return obj && (typeof obj === 'object') && (typeof obj.length === 'number');
};

Rockdown.Node = function (name, children) {
  this.name = name;
  this.children = children;

  if (! isArray(children))
    throw new Error("Expected array in new ParseNode(" + name + ", ...)");
};

Rockdown.Token = function (pos, text) {
  this._pos = pos;
  this._text = text;
};

Rockdown.Token.prototype.text = function () {
  return this._text;
};

Rockdown.Token.prototype.startPos = function () {
  return this._pos;
};

Rockdown.Token.prototype.endPos = function () {
  return this._pos + this._text.length;
};

Rockdown._regexes = {
  fenceBlockquote: new StickyRegex(/\s*>/),
  rest: new StickyRegex(/.*/)
};

Rockdown.parseLines = function (input) {
  var r = Rockdown._regexes;
  var containerStack = [];

  // Set up our little token reader, reused for each physical line
  // of the input.  Calling `token(..)` tries to match `stickyRegex`
  // at `pos` in `source`.  `lineStartPos` is the index of the
  // beginning of `source` in the larger input.
  var lineStartPos, source, pos, lastPos;
  var token = function (stickyRegex) {
    lastPos = pos;
    var result = stickyRegex.matchAt(source, pos);
    if (result === null)
      return null;
    pos += result.length;
    return new Rockdown.Token(lineStartPos + lastPos,
                              result);
  };

  var docElements = [];

  var terminatedInput = input + '\n';
  var rPhysicalLine = /[^\n]*\n/g;
  rPhysicalLine.lastIndex = 0;
  var match;
  while ((match = rPhysicalLine.exec(terminatedInput))) {
    source = match[0].slice(0, -1);
    lineStartPos = match.index;
    pos = 0;

    //var stackTop = (containerStack.length ?
    //containerStack[containerStack.length - 1] : null);
    //if (stackTop && stackTop.name === 'fence') {
    //
    //}

    var lineElements = [];
    var tok;
    while ((tok = token(r.fenceBlockquote))) {
      lineElements.push(tok);
    }
    lineElements.push(token(r.rest));

    docElements.push(new Rockdown.Node('line', lineElements));


    //physicalLines.push(new Rockdown.Node('physicalLine', [
    //new Rockdown.Token(linePos, lineText)]));
  }

  return new Rockdown.Node('document', docElements);
};

})();