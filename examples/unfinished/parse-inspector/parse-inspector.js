

if (Meteor.is_client) {
  Meteor.startup(function () {
    if (! Session.get("input"))
      Session.set("input", "var x = 3");
    if (! Session.get("output-type"))
      Session.set("output-type", "jsparse");
  });

  Template.page.input = function () {
    return Session.get("input") || '';
  };

  // lexer must have lexer.next(), which must return a token having
  // text(), type(), startPos() and endPos().  The types NEWLINE, EOF,
  // and ERROR are treated specially.  The lexer's output must
  // terminate with EOF or ERROR.
  // CSS classes on the token are "lex lex_$type $lexClassPrefix_$type"
  // where $type is the lowercase token type() and $lexClassPrefix
  // is optional.
  var lexToHtml = function (lexer, lexClassPrefix) {
    var html = "";
    var L;
    do {
      L = lexer.next();
      var content;
      if (L.type() === "NEWLINE") {
        content = '&nbsp;<br>';
      } else if (L.type() === "EOF") {
        content = Handlebars._escape("<EOF>");
      } else {
        content = Handlebars._escape(L.text() || ' ');
        content = content.replace(/(?!.)\s/g, '<br>'); // for multiline comments
        content = content.replace(/\s/g, '&nbsp;');
      }
      var classExtras = "";
      if (lexClassPrefix)
        classExtras = " " + lexClassPrefix + '_' + L.type().toLowerCase();
      html += Spark.setDataContext(
        L,
        '<span class="lex lex_' + L.type().toLowerCase() +
          classExtras + '" ' + 'title="' +
          Handlebars._escape(L.type()) + '">' + content + '</span>');
    } while (L.type() !== "ERROR" && L.type() !== "EOF");
    return html;
  };


  // Nodes must be instanceof nodeConstr and have name/children.
  // Leaves must have text(), startPos() and endPos(), and may have
  // type().
  var treeToHtmlBoxes = function (tree, nodeConstr, finalPos, ownLineTest,
                                  lexClassPrefix) {
    var html;
    var curPos = 0;
    var unclosedInfos = [];
    var toHtml = function (obj) {
      if (obj instanceof nodeConstr) {
        var head = obj.name || '';
        var children = obj.children;
        var info = { startPos: curPos };
        var getsOwnLine = (ownLineTest && ownLineTest(head));
        var html = Spark.setDataContext(
          info,
          '<div class="box named' + (getsOwnLine ? ' statement' : '') +
            '"><div class="box head">' + Handlebars._escape(head) + '</div>' +
            _.map(children, toHtml).join('') + '</div>');
        unclosedInfos.push(info);
        return html;
      } else if (obj.text) {
        // token
        _.each(unclosedInfos, function (info) {
          info.endPos = curPos;
        });
        curPos = obj.endPos();
        unclosedInfos.length = 0;
        var text = obj.text();
        var type = obj.type && obj.type();
        // insert zero-width spaces to allow wrapping
        text = text.replace(/.{20}/g, "$&\u200b");
        text = Handlebars._escape(text);
        text = text || '\u200b';
        text = text.replace(/\u200b/g, '&#8203;');
        text = text.replace(/\n/g, '<br>');
        text = text.replace(/[ \t]/g, '&nbsp;');
        var tagExtras = "", classExtras = "";
        if (type) {
          tagExtras += ' title="' + Handlebars._escape(type) + '"';
          classExtras += ' lex_' + type.toLowerCase();
          if (lexClassPrefix)
            classExtras += " " + lexClassPrefix + '_' + type.toLowerCase();
        }
        return Spark.setDataContext(
          obj,
          '<div class="box token' + classExtras +
            '"' + tagExtras + '>' + text + '</div>');
      } else {
        // other?
        return '<div class="box other">' +
          Handlebars._escape(JSON.stringify(obj)) + '</div>';
      }
    };
    html = toHtml(tree);
    curPos = finalPos;
    _.each(unclosedInfos, function (info) {
      info.endPos = curPos;
    });
    return html;
  };

  Template.page.output = function () {
    var input = Session.get("input") || "";

    var outputType = Session.get("output-type");

    if (outputType === "jslex") {
      // LEXER

      var lexer = new JSLexer(input);
      var html = lexToHtml(lexer);
      return new Handlebars.SafeString(html);

    } else if (outputType === "jsparse") {

      // PARSER
      var html;
      var tree = null;
      var parser = new JSParser(input, {includeComments: true});
      try {
        tree = parser.getSyntaxTree();
      } catch (parseError) {
        var errorLexeme = parser.lexer.lastLexeme;

        html = Handlebars._escape(
          input.substring(0, errorLexeme.startPos()));
        html += Spark.setDataContext(
          errorLexeme,
          '<span class="parseerror">' +
            Handlebars._escape(errorLexeme.text() || '<EOF>') +
            '</span>');
        html = html.replace(/(?!.)\s/g, '<br>');
        html += '<div class="parseerrormessage">' +
          Handlebars._escape(parseError.toString()) + '</div>';
      }
      if (tree) {
        html = treeToHtmlBoxes(
          tree, ParseNode, parser.lexer.pos,
          function (name) {
            return (name.indexOf('Stmnt') >= 0 ||
                    name === "comment" || name === "functionDecl");
          });
      }

      return new Handlebars.SafeString(html);
    } else if (outputType === "rockdownlex") {

      var lexer = new Rockdown.Lexer(input);
      var html = lexToHtml(lexer, 'rdlex');
      return new Handlebars.SafeString(html);

    } else if (outputType === "rockdownparse") {

      var tree = Rockdown.parse(input);
      var html = treeToHtmlBoxes(
        tree, Rockdown.Node, input.length, function (name) {
          return false;
        }, 'rdlex');

      // for manually inspecting / copying for tests
      Session.set("rockdownRep", tree.stringify());

      return new Handlebars.SafeString(html);

    } else if (outputType === "rockdownpreview") {
      var blockTags = {
        'quotedBlock': 'blockquote',
        'list': 'ul',
        'listItem': 'li',
        'listItemCompact': 'li'
      };

      var toHtml = function (obj, quoteLevel) {
        if (obj.text)
          return Handlebars._escape(obj.text());

        quoteLevel = quoteLevel || 0;
        var recurse = function (x) {
          return toHtml(x, quoteLevel);
        };

        // this code is messy
        var name = obj.name;
        var html = "";
        switch (obj.name) {
        case "document":
        case "quotedBlock":
        case "list":
        case "listItem":
        case "listItemCompact":
          var tag = blockTags[obj.name];
          if (tag)
            html += '<' + tag + '>';
          var ql = quoteLevel;
          if (obj.name === "quotedBlock")
            ql++;
          _.each(obj.children, function (c, i) {
            if (c.name === "textBlock" && obj.name !== "listItemCompact")
              html += "\n<p>" + toHtml(c, ql) + "</p>";
            else
              html += toHtml(c, ql);
          });
          if (tag)
            html += '</' + tag + '>';
          break;
        case "emdash":
          html = " &#8212; ";
          break;
        case "codeSpan":
          html += "<code>";
          for(var i = 1, N = obj.children.length - 1; i < N; i++)
            // assume children besides first and last are tokens
            html += Handlebars._escape(obj.children[i].text());
          html += "</code>";
          break;
        case "html":
        case "singleTag":
          _.each(obj.children, function (c) {
            if (c.name === ">")
              html += ">";
            else // assume c is a token
              html += c.text();
          });
          break;
        case "emSpan":
        case "strongSpan":
          var tag = obj.name.match(/^[a-z]+/)[0];
          html += "<" + tag + ">";
          for(var i = 1, N = obj.children.length - 1; i < N; i++)
            html += recurse(obj.children[i]);
          html += "</" + tag + ">";
          break;
        case "rule":
          html += '\n<hr>';
          break;
        case "hashHead":
          var headingLevel = obj.children[0].text().length;
          html += '<h' + headingLevel + '>';
          if (obj.children.length > 1)
            html += recurse(obj.children[1]);
          html += '</h' + headingLevel + '>';
          break;
        case "ruledHead":
          var headingLevel = obj.children[1].text().charAt(0) === '=' ? 2 : 1;
          html += '<h' + headingLevel + '>';
          html += recurse(obj.children[0]);
          html += '</h' + headingLevel + '>';
          break;
        case "textBlock":
          _.each(obj.children, function (c) {
            html += recurse(c);
          });
          break;
        case "fencedBlock":
          var content = obj.children[0].text().slice(3);
          if (! obj.children[1])
            content = content.slice(0, -3);
          var lines = content.split('\n');
          var fenceType = lines.shift();
          lines = _.map(lines, function (line) {
            for(var i = 0; i < quoteLevel; i++)
              line = line.match(/^(?:\s*>)?(.*)$/)[1];
            return line;
          });
          if (lines.length) {
            // strip whitespace so that first line is not indented
            var indent = lines[0].match(/^\s*/)[0].length;
            if (indent) {
              lines = _.map(lines, function (line) {
                var thisIndent = line.match(/^\s*/)[0].length;
                return line.substring(Math.min(indent, thisIndent));
              });
            }
          }
          html += "<code><pre>";
          html += Handlebars._escape(lines.join('\n'));
          html += "</pre></code>";
          break;
        case "atLink":
          html += '<a href="#">';
          html += obj.children[0].text().slice(1);
          if (obj.children[1])
            html += recurse(obj.children[1]);
          html += '</a>';
        }
        return html;
      };
      var tree = Rockdown.parse(input);
      var html = '<div class="htmlpreview">' + toHtml(tree) + '</div>';
      return new Handlebars.SafeString(html);

    } else return ''; // unknown output tab?
  };

  Template.page.events({
    'keyup #inputarea textarea': function (event) {
      var input = event.currentTarget.value;
      Session.set("input", input);
    },
    'mouseover .box.named, mouseover .box.token': function (event) {
      event.currentTarget.setAttribute('mousehover', 'mousehover');
      event.stopImmediatePropagation();
    },
    'mouseout .box.named, mouseout .box.token': function (event) {
      event.currentTarget.removeAttribute('mousehover');
      event.stopImmediatePropagation();
    },
    'click .box.token': function (event) {
      selectInputText(this.startPos(), this.endPos());
      return false;
    },
    'click .box.named': function (event) {
      selectInputText(this.startPos, this.endPos);
      return false;
    },
    'click .parseerror': function (event) {
      selectInputText(this.startPos(), this.endPos());
      return false;
    },
    'click .output-type': function (event) {
      Session.set("output-type", this.value);
    },
    'click .lex': function (event) {
      selectInputText(this.startPos(), this.endPos());
      return false;
    }
  });

  Template.page.outputTypes = [
    {name: "JS Lex", value: "jslex"},
    {name: "JS Parse", value: "jsparse"},
    {name: "Rockdown Lex", value: "rockdownlex"},
    {name: "Rockdown Parse", value: "rockdownparse"},
    {name: "Rockdown Preview", value: "rockdownpreview"}
 ];

  Template.page.is_outputtype_selected = function (which) {
    return Session.equals("output-type", which) ? "selected" : "";
  };

  var selectTextInArea = function (e, start, end){
    e.focus();
    if (e.setSelectionRange) {
      e.setSelectionRange(start, end);
    } else if (e.createTextRange) {
      var r = e.createTextRange();
      r.collapse(true);
      r.moveEnd('character', end);
      r.moveStart('character', start);
      r.select();
    }
  };

  var selectInputText = function (start, end) {
    var textarea = DomUtils.find(document, '#inputarea textarea');
    selectTextInArea(textarea, start, end);
  };

}
