
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

Rockdown.Token = function (pos, text, type) {
  this._pos = pos;
  this._text = text;
  this._type = type;
};

Rockdown.Token.prototype.text = function () {
  return this._text;
};

Rockdown.Token.prototype.type = function () {
  return this._type;
};

Rockdown.Token.prototype.startPos = function () {
  return this._pos;
};

Rockdown.Token.prototype.endPos = function () {
  return this._pos + this._text.length;
};

Rockdown._regexes = function (regexMap) {
  // replace all regex with StickyRegexes
  for (var k in regexMap)
    if (regexMap[k] instanceof RegExp)
      regexMap[k] = new StickyRegex(regexMap[k]);
  return regexMap;
}({
  whitespace: /[^\S\n]+/,
  blockquote: />/,
  bullet: /[*+-](?!\S)/,
  tagLine: /<[^>]*>(?=[^\S\n]*$)/,
  singleRule: /---([^\S\n]*-)*(?=[^\S\n]*$)/,
  doubleRule: /===([^\S\n]*=)*(?=[^\S\n]*$)/,
  fence: /```/,
  // A complete fence; includes rest of first line, then zero or more
  // complete lines, reluctantly, stopping at either a line starting
  // with some blockquotes and a fence or the end of the input.
  //
  // We are careful to allow the input to end at any time; a partial
  // fence can be considered an error later, or perhaps a warning.
  // A line starting with a fence always starts a fencedBlock.
  fencedBlock: /```[^\n]*(\n|$)([^\n]*\n)*?(([^\S\n]+|>)*```|[^\n]*$)/,
  hashHead: /#+/,
  newline: /\n/,
  // match longest possible string of one or more non-newline characters
  // ending with non-whitespace.
  restNoTrailingWhitespace: /[^\n]*\S/,
  eof: /$/
});

Rockdown.Lexer = function (input) {
  this.input = input;
  this.pos = 0;
  this.mode = "[[LINESTART]]";
};

Rockdown.Lexer.prototype.next = function () {
  var self = this;

  var token = function (type, stickyRegex) {
    var pos = self.pos;
    var result = stickyRegex.matchAt(self.input, pos);
    if (result === null)
      return null;
    self.pos += result.length;
    return new Rockdown.Token(pos, result, type);
  };
  var lookAhead = function (stickyRegex) {
    return stickyRegex.matchAt(self.input, self.pos) !== null;
  };
  var r = Rockdown._regexes;

  var tok;
  if ((tok = token('EOF', r.eof)))
    return tok;

  if (self.mode === "[[LINESTART]]") {
    if ((tok = (token('WHITESPACE', r.whitespace) ||
                token('BLOCKQUOTE', r.blockquote) ||
                token('BULLET', r.bullet))))
      return tok;
    if ((tok = (token('TAGLINE', r.tagLine) ||
                token('SINGLERULE', r.singleRule) ||
                token('DOUBLERULE', r.doubleRule)))) {
      self.mode = "[[TRAILING]]";
      return tok;
    }
    if ((tok = token('FENCEDBLOCK', r.fencedBlock))) {
      // token includes the entire fenced contents and the end fence.
      // The contents will be parsed later to interpret the first
      // line specially, strip blockquotes, and strip the first line's
      // indentation.
      // There may be trailing non-whitespace after the end fence
      // that should get mopped up by the trailing mode.
      self.mode = "[[TRAILING]]";
      return tok;
    }
    if ((tok = token('HASHHEAD', r.hashHead))) {
      self.mode = "[[CONTENT]]";
      return tok;
    }
    self.mode = "[[CONTENT]]";
    // FALL THROUGH...
  }
  if (self.mode === "[[CONTENT]]") {
    tok = token('CONTENT', r.restNoTrailingWhitespace);
    self.mode = "[[TRAILING]]";
    if (tok)
      return tok;
    // FALL THROUGH...
  }
  if (self.mode === "[[TRAILING]]") {
    if ((tok = (token('TRAILING', r.restNoTrailingWhitespace) ||
                token('WHITESPACE', r.whitespace))))
      return tok;

    if ((tok = token('NEWLINE', r.newline))) {
      self.mode = "[[LINESTART]]";
      return tok;
    }
    // we've already checked for EOF, \n, \S, and [^\S\n], which is
    // all possible characters that could come next.
    throw new Error("can't get here");
  }
  throw new Error("Unknown mode: " + self.mode);
};

Rockdown.parse = function (input) {
  var lexer = new Rockdown.Lexer(input);

  // containers on the container stack are objects with properties:
  // {
  //   node
  //   quoteLevel [for textBlock node]
  //   compact [for list node]
  //   column [for listItem node]
  // }
  var containerStack = [{node: new Rockdown.Node('document', [])}];
  var topContainerName = function () {
    return containerStack[containerStack.length - 1].node.name;
  };
  var addElement = function (element) {
    containerStack[containerStack.length - 1].node.children.push(element);
  };
  var pushContainer = function (newContainer) {
    addElement(newContainer.node);
    containerStack.push(newContainer);
  };

  var oldToken = null;
  var newToken = lexer.next();
  var takeToken = function () {
    oldToken = newToken;
    newToken = lexer.next();
    return oldToken;
  };

  // parse errors generally shouldn't happen; it probably means the
  // lexer fed us something bad
  var getParseError = function () {
    var found = newToken.type();
    if (found === "TRAILING")
      found = "trailing text";
    return new Error("Rockdown parse error: Unexpected " + found);
  };

  nextLine:
  while (newToken.type() !== "EOF") {

    var prevNewlineToken = null;
    if (oldToken) {
      if (newToken.type() !== "NEWLINE")
        // Extra tokens on previous line
        throw getParseError();
      prevNewlineToken = takeToken();
    }

    var starters = [];

    if (topContainerName() === 'textBlock') {
      var textBlock = containerStack[containerStack.length - 1];
      var quoteLevel = textBlock.quoteLevel;
      // start taking whitespace and blockquotes, up to the
      // textBlock's quoteLevel, to see if this is a continuation
      // line.
      for (var i = 0; i < quoteLevel; i++) {
        while (newToken.type() === "WHITESPACE")
          starters.push(takeToken());
        if (newToken.type() === "BLOCKQUOTE")
          starters.push(takeToken());
        else
          break;
      }
      while (newToken.type() === "WHITESPACE")
        starters.push(takeToken());

      // continue or close the textBlock
      if (newToken.type() === "CONTENT") {
        // this line is a continuation
        if (prevNewlineToken)
          addElement(prevNewlineToken);
        addElement(takeToken());
        // assume rest of line is trailing whitespace, eat it
        while (newToken.type() === "WHITESPACE")
          takeToken();
        continue nextLine;
      } else {
        containerStack.pop();
      }
    }

    // no textBlock on the stack now.
    // get the rest of the WHITESPACE and BLOCKQUOTE tokens.
    while (newToken.type() === "WHITESPACE" ||
           newToken.type() === "BLOCKQUOTE")
      starters.push(takeToken());

    var j = 0; // index into starters
    var M = starters.length;
    for(var i = 0, N = containerStack.length; i < N; i++) {
      console.log(i, containerStack[i].node.name);
      // position j at next non-WHITESPACE starter, or M if none
      while (j < M && starters[j].type() === "WHITESPACE")
          j++;
      var isEndOfLine = (j === M && (newToken.type() === "NEWLINE" ||
                                     newToken.type() === "EOF"));

      var container = containerStack[i];
      var containerType = containerStack[i].node.name;
      if (containerType === "quotedBlock") {
        // must be a BLOCKQUOTE
        if (j < M && starters[j].type() === "BLOCKQUOTE")
          j++;
        else
          break; // no match
      } else if (containerType === "list") {
        if (container.compact && isEndOfLine) {
          console.log("ZZZ");
          break; // blank line terminates compact list
        }
      } else if (containerType === "listItem") {
        var listItemColumn = container.column;
        var whitespaceLength = 0;
        // amount of whitespace since last blockquote
        for (var k = j-1; k >= 0 && starters[k].type() === "WHITESPACE"; k--)
          whitespaceLength += starters[k].text().length;
        if ((! (whitespaceLength > listItemColumn)) && ! isEndOfLine)
          break;
      }
    }

    var openContainers = i;
    var matchedStarters = j;

    // close reminaing containers
    while (containerStack.length > openContainers) {
      var closedNode = containerStack.pop().node;
      // detect compact list
      if (closedNode.name === "listItem") {
        var listItem = closedNode;
        var listContainer = containerStack[containerStack.length - 1];
        if (listContainer.node.children.length === 1) {
          if (listItem.children[0] instanceof Rockdown.Node &&
              listItem.children[0].name === "textBlock" &&
              ! (listItem.children[1] instanceof Rockdown.Node &&
                 listItem.children[1].name === "blankLine"))
            listContainer.compact = true;
        }
      }
    }

    // get the rest of the WHITESPACE, BLOCKQUOTE, and BULLET tokens
    while (newToken.type() === "WHITESPACE" ||
           newToken.type() === "BLOCKQUOTE" ||
           newToken.type() === "BULLET")
      starters.push(takeToken());

    // starters that weren't matched open new containers
    for(var i = matchedStarters, N = starters.length; i < N; i++) {
      if (starters[i].type() === "BLOCKQUOTE") {
        if (topContainerName() === "list")
          containerStack.pop();
        pushContainer({node: new Rockdown.Node('quotedBlock', [])});
      } else if (starters[i].type() === "BULLET") {
        if (topContainerName() !== "list")
          pushContainer({node: new Rockdown.Node('list', []),
                         compact: false});
        var column = 0;
        for(var j = i-1; j >= 0 && starters[j].type() !== "BLOCKQUOTE"; j--)
          column += starters[j].text().length;
        pushContainer({node: new Rockdown.Node('listItem', []),
                       column: column});
      }
    }

    if (topContainerName() === "list")
      containerStack.pop();

    if (newToken.type() === "NEWLINE" || newToken.type() === "EOF") {
      // blank line
      addElement(new Rockdown.Node('blankLine', []));
      continue nextLine;
    }

    if (newToken.type() === "CONTENT") {
      // open textBlock
      var quoteLevel = 0;
      for(var i = 0, N = starters.length; i < N; i++)
        if (starters[i].type() === "BLOCKQUOTE")
          quoteLevel++;
      pushContainer({node: new Rockdown.Node('textBlock', [takeToken()]),
                     quoteLevel: quoteLevel});
    } else if (newToken.type() === "FENCEDBLOCK") {
      var fencedBlock = new Rockdown.Node('fencedBlock', [takeToken()]);
      addElement(fencedBlock);
      // include non-whitespace trailing text in the parse tree
      while (newToken.type() === "TRAILING")
        fencedBlock.children.push(takeToken());
    } else if (newToken.type() === "HASHHEAD") {
      var hashHead = new Rockdown.Node('hashHead', [takeToken()]);
      addElement(hashHead);
      if (newToken.type() === "CONTENT")
        hashHead.children.push(takeToken());
    } else {
      // TAGLINE, SINGLERULE, DOUBLERULE
      var node = new Rockdown.Node('specialLine', [takeToken()]);
      addElement(node);
    }

    // assume rest of line is trailing whitespace, eat it
    while (newToken.type() === "WHITESPACE")
      takeToken();
  }

  return containerStack[0].node;
};

})();