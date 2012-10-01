
(function () {

Rockdown = {};

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

Rockdown.parseLines = function (input) {
  var containerStack = [];

  var terminatedInput = input + '\n';
  var physicalLines = [];
  var rPhysicalLine = /[^\n]*\n/g;
  rPhysicalLine.lastIndex = 0;
  var match;
  while ((match = rPhysicalLine.exec(terminatedInput))) {
    var lineText = match[0].slice(0, -1);
    var linePos = match.index;

    var stackTop = (containerStack.length ?
                    containerStack[containerStack.length - 1] : null);
    if (stackTop.name === 'fence') {
      
    }

//    physicalLines.push(new Rockdown.Node('physicalLine', [
//    new Rockdown.Token(linePos, lineText)]));
  }

  return new Rockdown.Node('document', physicalLines);
};

})();