
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

Rockdown.Token.prototype.isContent = function () {
  return this._type === "CONTENT" || this._type === "INLINESPECIAL";
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
  bullet: /\*(?!\S)|-(?!-)|\+(?!\+)/,
  tagLine: /<[^>]*>(?=[^\S\n]*$)/m, // tag can span over multiple lines
  singleRule: /---([^\S\n]*-)*(?=[^\S\n]*$)/m,
  doubleRule: /===([^\S\n]*=)*(?=[^\S\n]*$)/m,
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
  eof: /$/,
  fenceFirstLine: /[^\n]*/,
  // it's important here that inlineSpecials can't contain backticks,
  // and that the total negative look-ahead in boringContent matches
  // inlineSpecial.
  // XXX make this less fragile
  boringContent:
    /([^\*`&<\s_-]+|-(?!--)|[^\S\n]+(?!---)(?=\S)|&(?![#0-9a-z]+;)|<(?![a-z])(?!\/[a-z])|_(?!_))+/i,
  // tag can span over multiple lines
  inlineSpecial: /\*|__|`|&[#0-9a-z]+;|<\/?[a-z][^`>]*>?|[^\S\n]*---[^\S\n]*/mi
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
  var peek = function (stickyRegex) {
    return stickyRegex.matchAt(self.input, self.pos);
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
      self.mode = "[[PRECONTENT]]";
      return tok;
    }
    self.mode = "[[CONTENT]]";
    // FALL THROUGH...
  }
  if (self.mode === "[[PRECONTENT]]") {
    if ((tok = token('WHITESPACE', r.whitespace)))
      return tok;
    self.mode = "[[CONTENT]]";
    // FALL THROUGH...
  }
  if (self.mode === "[[CONTENT]]") {
    if ((tok = (token('CONTENT', r.boringContent) ||
                token('INLINESPECIAL', r.inlineSpecial))))
      return tok;

    self.mode = "[[TRAILING]]";
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
  //   textBlock [for textBlock node and any span node]
  //   quoteLevel [for textBlock node]
  //   compact [for list node]
  //   column [for listItem and listItemCompact nodes]
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

  var openTextBlock = function (quoteLevel) {
    var textBlock = {node: new Rockdown.Node('textBlock', []),
                     quoteLevel: (quoteLevel || 0)};
    textBlock.textBlock = textBlock;
    pushContainer(textBlock);
  };
  var readTextBlock = function () {
    var textBlock = containerStack[containerStack.length - 1].textBlock;
    while (newToken.isContent()) {
      if (newToken.type() === "INLINESPECIAL") {
        var text = newToken.text();
        if (topContainerName() === 'codeSpan') {
          addElement(takeToken());
          if (text === '`')
            containerStack.pop();
        } else {
          if (text.charAt(0) === '&') {
            addElement(new Rockdown.Node('html', [takeToken()]));
          } else if (text.charAt(0) === '<') {
            var htmlNode = new Rockdown.Node('html', [takeToken()]);
            if (text.indexOf('>') < 0)
              htmlNode.children.push(new Rockdown.Node('>', []));
            addElement(htmlNode);
          } else if (/^\s*---/.test(text)) {
            addElement(new Rockdown.Node('emdash', [takeToken()]));
          } else if (text === '`') {
            pushContainer({node: new Rockdown.Node('codeSpan', [takeToken()]),
                           textBlock: textBlock});
          } else if (text === '*') {
            if (topContainerName() === 'emSpan') {
              addElement(takeToken());
              containerStack.pop();
            } else {
              pushContainer({node: new Rockdown.Node('emSpan', [takeToken()]),
                             textBlock: textBlock});
            }
          } else if (text === '__') {
            if (topContainerName() === 'strongSpan') {
              addElement(takeToken());
              containerStack.pop();
            } else {
              pushContainer(
                {node: new Rockdown.Node('strongSpan', [takeToken()]),
                 textBlock: textBlock});
            }
          } else {
            // can't get here
            throw new Error("Unexpected token: " + text);
          }
        }
      } else {
        addElement(takeToken());
      }
    }
  };
  var closeTextBlock = function () {

    while (containerStack[containerStack.length - 1].textBlock) {
      var container = containerStack.pop();
      var type = container.node.name;
      var children = container.node.children;
      if (type === "codeSpan")
        children.push(new Rockdown.Node('`', []));
      else if (type === "emSpan")
        children.push(new Rockdown.Node('*', []));
      else if (type === "strongSpan")
        children.push(new Rockdown.Node('__', []));
    }
  };

  var count = 0;
  nextLine:
  while (newToken.type() !== "EOF") {
    if (++count > 1000) debugger;
    if (++count > 2000) break;

    var prevNewlineToken = null;
    if (oldToken && newToken.type() !== "NEWLINE")
      // Extra tokens on previous line
      throw getParseError();
    if (newToken.type() === "NEWLINE") {
      if (! oldToken)
        addElement(new Rockdown.Node('blankLine', []));
      prevNewlineToken = takeToken();
    }

    var starters = [];

    if (containerStack[containerStack.length - 1].textBlock) {
      // in a textBlock (possibly in a span in a textBlock)
      var textBlock = containerStack[containerStack.length - 1].textBlock;
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
      if (newToken.isContent()) {
        // this line is a continuation
        if (prevNewlineToken)
          addElement(prevNewlineToken);
        readTextBlock();
        // assume rest of line is trailing whitespace, eat it
        while (newToken.type() === "WHITESPACE")
          takeToken();
        continue nextLine;
      } else {
        closeTextBlock();
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
      // position j at next non-WHITESPACE starter, or M if none
      while (j < M && starters[j].type() === "WHITESPACE")
          j++;
      var isEndOfLine = (j === M && (newToken.type() === "NEWLINE" ||
                                     newToken.type() === "EOF"));

      var container = containerStack[i];
      var containerType = containerStack[i].node.name;
      if (containerType === "quotedBlock") {
        // must be a BLOCKQUOTE
        if (j < M && starters[j].type() === "BLOCKQUOTE") {
          j++;
        } else {
          break; // no match
        }
      } else if (containerType === "list") {
        if (container.compact && isEndOfLine) {
          // detect not-actually-compact list that has a blank line
          // as the second element of its first item
          if (container.node.children.length === 1 &&
              container.node.children[0].children.length <= 1) {
            container.compact = false;
            container.node.children[0].name = 'listItem';
          } else {
            break;
          }
        }
      } else if (containerType === "listItem" ||
                 containerType === "listItemCompact") {
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
    while (containerStack.length > openContainers)
      containerStack.pop();

    // get the rest of the WHITESPACE, BLOCKQUOTE, and BULLET tokens
    while (newToken.type() === "WHITESPACE" ||
           newToken.type() === "BLOCKQUOTE" ||
           newToken.type() === "BULLET")
      starters.push(takeToken());

    // is line blank except for leading blockquotes and bullets
    var lineIsBlank = (newToken.type() === "NEWLINE" || newToken.type() === "EOF");

    // starters that weren't matched open new containers
    for(var i = matchedStarters, N = starters.length; i < N; i++) {
      if (starters[i].type() === "BLOCKQUOTE") {
        if (topContainerName() === "list")
          containerStack.pop();
        pushContainer({node: new Rockdown.Node('quotedBlock', [])});
      } else if (starters[i].type() === "BULLET") {
        if (topContainerName() !== "list")
          pushContainer({node: new Rockdown.Node('list', []),
                         compact: ! lineIsBlank});
        var isCompact = containerStack[containerStack.length - 1].compact;
        var column = 0;
        for(var j = i-1; j >= 0 && starters[j].type() !== "BLOCKQUOTE"; j--)
          column += starters[j].text().length;
        pushContainer({node: new Rockdown.Node(isCompact ?
                                               'listItemCompact' :
                                               'listItem', []),
                       column: column});
      }
    }

    if (topContainerName() === "list")
      containerStack.pop();

    if (lineIsBlank) {
      addElement(new Rockdown.Node('blankLine', []));
      continue nextLine;
    }

    if (newToken.isContent()) {
      // open textBlock
      var quoteLevel = 0;
      for(var i = 0, N = starters.length; i < N; i++)
        if (starters[i].type() === "BLOCKQUOTE")
          quoteLevel++;
      openTextBlock(quoteLevel);
      readTextBlock();
    } else if (newToken.type() === "FENCEDBLOCK") {
      var fencedBlockToken = takeToken();
      var fencedBlockNode = new Rockdown.Node("fencedBlock",
                                              [fencedBlockToken]);
      var fencedLines = fencedBlockToken.text().split('\n');
      var isComplete =
            (fencedLines.length >= 2 &&
             /^[\s>]*```$/.test(fencedLines[fencedLines.length - 1]));
      if (! isComplete)
        fencedBlockNode.children.push(new Rockdown.Node('```', []));
      if (newToken.type() === "TRAILING")
        takeToken(); // trailing content
      addElement(fencedBlockNode);
    } else if (newToken.type() === "HASHHEAD") {
      var hashHead = new Rockdown.Node('hashHead', [takeToken()]);
      pushContainer({node: hashHead});
      while (newToken.type() === "WHITESPACE")
        takeToken();
      if (newToken.isContent()) {
        // no quoteLevel necessary, as this won't be a multi-line textBlock
        openTextBlock();
        readTextBlock();
        closeTextBlock();
      }
      containerStack.pop(); // hashHead
    } else if (newToken.type() === "SINGLERULE" ||
               newToken.type() === "DOUBLERULE") {
      var topNode = containerStack[containerStack.length - 1].node;
      var prevSibs = topNode.children;
      if (prevSibs.length &&
          prevSibs[prevSibs.length - 1] instanceof Rockdown.Node &&
          prevSibs[prevSibs.length - 1].name === "textBlock") {
        // combine rule with textBlock to make ruledHead
        var textBlock = prevSibs.pop();
        var ruledHead = new Rockdown.Node('ruledHead',
                                          [textBlock, takeToken()]);
        addElement(ruledHead);
      } else {
        var node = new Rockdown.Node('rule', [takeToken()]);
        addElement(node);
      }
    } else if (newToken.type() === "TAGLINE") {
      var node = new Rockdown.Node('singleTag', [takeToken()]);
      addElement(node);
    }

    // assume rest of line is trailing whitespace, eat it
    while (newToken.type() === "WHITESPACE")
      takeToken();
  }

  closeTextBlock();

  return containerStack[0].node;
};

})();