var fs = require('fs');
var uglify = require('uglify-js');
var _ = require('underscore');

///////////////////////////////////////////////////////////////////////////////
// Module
///////////////////////////////////////////////////////////////////////////////

// options include:
//
// useGlobalNamespace: make the top level namespace be the same as the
// global namespace, so that symbols are accessible from the
// console. typically used when linking apps (as opposed to packages.)
//
// combinedServePath: if we end up combining all of the files into
// one, use this as the servePath.
var Module = function (options) {
  var self = this;

  // files in the module. array of File
  self.files = [];

  // options
  self.useGlobalNamespace = options.useGlobalNamespace;
  self.combinedServePath = options.combinedServePath;
};

_.extend(Module.prototype, {
  // source: the source code
  // servePath: the path where it would prefer to be served if possible
  addFile: function (source, servePath) {
    var self = this;
    self.files.push(new File(source, servePath));
  },

  maxLineLength: function () {
    var self = this;

    var maxInFile = [];
    _.each(self.files, function (file) {
      var lines = file.source.split('\n');
      maxInFile.push(_.max(_.pluck(lines, "length")));
    });

    return _.max(maxInFile);
  },

  // Output is a list of objects with keys 'source' and 'servePath'.
  link: function () {
    var self = this;

    if (self.useGlobalNamespace) {
      return _.map(self.files, function (file) {
        return {
          source: file.getLinkedOutput({ preserveLineNumbers: true }),
          servePath: file.servePath
        }
      });
    }

    // Find the maximum line length. The extra two are for the
    // comments that will be emitted when we skip a unit.
    var sourceWidth = _.max([68, self.maxLineLength()]) + 2;

    // Emit all of the files together in a new scope just for this
    // module
    if (! self.useGlobalNamespace) {
      // Find all global references in any files
      var globalReferences = [];
      _.each(self.files, function (file) {
        globalReferences = globalReferences.concat(file.computeGlobalReferences());
      });
      globalReferences = _.uniq(globalReferences);

      // Create a closure that captures those references
      var combined = "(function () {\n\n";

      if (globalReferences.length) {
        combined += "/* Package-scope variables */\n";
        combined += "var " + globalReferences.join(', ') + ";\n\n";
      }

      // Emit each file
      _.each(self.files, function (file) {
        combined += file.getLinkedOutput({ sourceWidth: sourceWidth });
        combined += "\n";
      });

      // Postlogue
      combined += "\n}).call(this);";

      // Replace all of the files with this new combined file
      self.files = [new File(combined, self.combinedServePath, true)];
    }

    return _.map(self.files, function (file) {
      return {
        source: file.source,
        servePath: file.servePath
      };
    });
  }
});

///////////////////////////////////////////////////////////////////////////////
// File
///////////////////////////////////////////////////////////////////////////////

var File = function (source, servePath, skipUnitize) {
  var self = this;

  // source code for this file (a string)
  self.source = source;

  // the path where this file would prefer to be served if possible
  self.servePath = servePath;

  // The individual @units in the file. Array of Unit. Concatenating
  // the source of each unit, in order, will give self.source.
  self.units = [];

  if (! skipUnitize)
    self._unitize();
};

_.extend(File.prototype, {
  // Return the union of the global references in all of the units in
  // this file that we are actually planning to use. Array of string.
  computeGlobalReferences: function () {
    var self = this;

    var globalReferences = [];
    _.each(self.units, function (unit) {
      if (unit.include)
        globalReferences = globalReferences.concat(unit.computeGlobalReferences());
    });
    return globalReferences;
  },

  // Options:
  // - preserveLineNumbers: if true, decorate minimally so that line
  //   numbers don't change between input and output. In this case,
  //   sourceWidth is ignored.
  // - sourceWidth: width in columns to use for the source code
  getLinkedOutput: function (options) {
    var self = this;

    // The newline after the source closes a '//' comment.
    //
    // The ".call(this)" allows you to do a top-level "this.foo = " to
    // define global variables; this is the only way to do it in
    // CoffeeScript.

    if (options.preserveLineNumbers) {
      // Ugly version
      return "(function(){" + self.source + "\n}).call(this);\n";
    }

    // Pretty version
    var buf = "";

    // Prologue
    buf += "(function () {\n\n";

    // Banner
    var width = options.sourceWidth || 70;
    var bannerWidth = width + 3;
    var divider = new Array(bannerWidth + 1).join('/') + "\n";
    var spacer = "// " + new Array(bannerWidth - 6 + 1).join(' ') + " //\n";
    var padding = new Array(bannerWidth + 1).join(' ');
    var blankLine = new Array(width + 1).join(' ') + " //\n";
    buf += divider + spacer;
    buf += "// " + (self.servePath.slice(1) + padding).slice(0, bannerWidth - 6) +
      " //\n";
    buf += spacer + divider + blankLine;

    // Code, with line numbers
    // You might prefer your line numbers at the beginning of the
    // line, with /* .. */. Well, that requires parsing the source for
    // comments, because you have to do something different if you're
    // already inside a comment.
    var lines = self.source.split('\n');
    var num = 1;
    _.each(lines, function (line) {
      buf += (line + padding).slice(0, width) + " // " + num + "\n";
      num++;
    });

    // Footer
    buf += divider;

    // Epilogue
    buf += "\n}).call(this);\n\n\n\n\n\n"
    return buf;
  },

  // Split file and populate self.units
  // XXX it is an error to declare a @unit not at toplevel (eg, inside a
  // function or object..) We don't detect this but we might have to to
  // give an acceptable user experience..
  _unitize: function () {
    var self = this;
    var lines = self.source.split("\n");
    var buf = "";
    var unit = new Unit(null, true);
    self.units.push(unit);

    var firstLine = true;
    _.each(lines, function (line) {
      // XXX overly permissive. should detect errors
      var match = /^\s*\/\/\s*@unit(\s+([^\s]+))?/.exec(line);
      if (match) {
        unit.source = buf;
        buf = line;
        unit = new Unit(match[2] || null, false);
        self.units.push(unit);
        return;
      }

      // XXX overly permissive. should detect errors
      match = /^\s*\/\/\s*@(export|require|provide|weak)(\s+.*)$/.exec(line);
      if (match) {
        var what = match[1];
        var symbols = _.map(match[2].split(/,/), function (s) {
          return s.replace(/^\s+|\s+$/g, ''); // trim leading/trailing whitespace
        });

        _.each(symbols, function (s) {
          unit[what][s] = true;
        });

        /* fall through */
      }

      if (firstLine)
        firstLine = false;
      else
        buf += "\n";
      buf += line;
    });
    unit.source = buf;
  }
});

///////////////////////////////////////////////////////////////////////////////
// Unit
///////////////////////////////////////////////////////////////////////////////

var Unit = function (name, mandatory) {
  var self = this;

  // name of the unit, or null if none provided
  self.name = name;

  // source code for this unit (a string)
  self.source = null;

  // true if this unit is to always be included
  self.mandatory = !! mandatory;

  // true if we should include this unit in the linked output
  self.include = self.mandatory;

  // symbols mentioned in @export, @require, @provide, or @weak
  // directives. each is a map from the symbol (given as a string) to
  // true.
  self.export = {};
  self.require = {};
  self.provide = {};
  self.weak = {};
};

_.extend(Unit.prototype, {
  // Return the globals in unit file as an array of symbol names.  For
  // example: if the code references 'Foo.bar.baz' and 'Quux', and
  // neither are declared in a scope enclosing the point where they're
  // referenced, then globalReferences would include ["Foo", "Quux"].
  computeGlobalReferences: function () {
    var self = this;

    var toplevel = uglify.parse(self.source); // instanceof uglify.AST_Toplevel
    toplevel.figure_out_scope();

    // XXX Use Uglify for now. Uglify is pretty good at returning us a
    // list of symbols that are referenced but not defined, but not
    // good at all at helping us figure out which of those are
    // assigned to rather than just referenced. Without the
    // assignments, we have to maintain an explicit list of symbols
    // that we expect to be declared in the browser, which is super
    // bogus! Use jsparse instead or maybe acorn, and rewrite uglify's
    // scope analysis code (it can't be that hard.)

    // XXX XXX as configured, on parse error, uglify throws an
    // exception and writes warnings to the console! that's clearly
    // not going to fly.

    globalReferences = [];
    _.each(toplevel.enclosed, function (symbol) {
      if (symbol.undeclared && ! (symbol.name in blacklist))
        globalReferences.push(symbol.name);
    });

    return globalReferences;
  }
});

///////////////////////////////////////////////////////////////////////////////
// Top-level entry point
///////////////////////////////////////////////////////////////////////////////

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
  var module = new Module({
    useGlobalNamespace: options.useGlobalNamespace,
    combinedServePath: options.combinedServePath
  });

  if (! options.inputFiles.length)
    return [];

  _.each(options.inputFiles, function (f) {
    module.addFile(f.source, f.servePath);
  });

  return module.link();
};

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

// From Chome. Open a console on an empty tab and call:
//   Object.getOwnPropertyNames(this).join('", "')
//   Object.getOwnPropertyNames(Object.getPrototypeOf(this)).join('", "')
// I'm not sure why window has a prototype, but it does, and that
// prototype contains important stuff like setTimeout.
// Additionally I manually added a few symbols at the bottom.
var blacklistedSymbols = [
  // Object.getOwnPropertyNames(this).join('", "')
  "eval", "$", "ntp", "findAncestorByClass", "escape", "undefined",
  "decodeURI", "eventLog", "url", "isRTL", "encodeURIComponent",
  "getRequiredElement", "chromeSend", "getFaviconURL", "logEvent",
  "parseHtmlSubset", "isNaN", "preventDefaultOnPoundLinkClicks",
  "Date", "window", "Math", "RangeError", "i18nTemplate", "NaN",
  "cr", "appendParam", "String", "decodeURIComponent",
  "findAncestor", "external", "unescape", "SyntaxError", "isFinite",
  "v8Intl", "RegExp", "location", "TypeError", "Function", "toCssPx",
  "document", "assert", "Object", "ReferenceError", "loadTimeData",
  "parseInt", "chrome", "EventTracker", "disableTextSelectAndDrag",
  "EvalError", "parseQueryParams", "Infinity", "swapDomNodes",
  "encodeURI", "top", "Intl", "global", "Error", "Array", "URIError",
  "parseFloat", "JSON", "Number", "Boolean", "WebSocket",
  "webkitRTCPeerConnection", "webkitMediaStream",
  "webkitOfflineAudioContext", "webkitAudioContext",
  "webkitSpeechGrammarList", "webkitSpeechGrammar",
  "webkitSpeechRecognitionEvent", "webkitSpeechRecognitionError",
  "webkitSpeechRecognition", "webkitNotifications",
  "WebKitSourceBufferList", "WebKitSourceBuffer",
  "WebKitMediaSource", "SharedWorker", "DeviceOrientationEvent",
  "MediaController", "HTMLSourceElement", "TimeRanges", "MediaError",
  "HTMLVideoElement", "HTMLMediaElement", "HTMLAudioElement",
  "Audio", "TrackEvent", "TextTrackList", "TextTrackCueList",
  "TextTrackCue", "TextTrack", "HTMLTrackElement",
  "HTMLShadowElement", "HTMLContentElement", "WebKitShadowRoot",
  "localStorage", "sessionStorage", "applicationCache", "CloseEvent",
  "MediaStreamEvent", "RTCIceCandidate", "RTCSessionDescription",
  "OfflineAudioCompletionEvent", "AudioProcessingEvent",
  "webkitAudioPannerNode", "SQLException", "IDBVersionChangeEvent",
  "IDBTransaction", "IDBRequest", "IDBOpenDBRequest",
  "IDBObjectStore", "IDBKeyRange", "IDBIndex", "IDBFactory",
  "IDBDatabase", "IDBCursorWithValue", "IDBCursor", "indexedDB",
  "webkitIDBTransaction", "webkitIDBRequest", "webkitIDBObjectStore",
  "webkitIDBKeyRange", "webkitIDBIndex", "webkitIDBFactory",
  "webkitIDBDatabase", "webkitIDBCursor", "webkitIndexedDB",
  "webkitStorageInfo", "Notification", "WebKitMutationObserver",
  "webkitURL", "URL", "FileReader", "FileError", "FormData",
  "SVGFilterElement", "SVGFETurbulenceElement", "SVGFETileElement",
  "SVGFESpotLightElement", "SVGFESpecularLightingElement",
  "SVGFEPointLightElement", "SVGFEOffsetElement",
  "SVGFEMorphologyElement", "SVGFEMergeNodeElement",
  "SVGFEMergeElement", "SVGFEImageElement",
  "SVGFEGaussianBlurElement", "SVGFEFuncRElement",
  "SVGFEFuncGElement", "SVGFEFuncBElement", "SVGFEFuncAElement",
  "SVGFEFloodElement", "SVGFEDropShadowElement",
  "SVGFEDistantLightElement", "SVGFEDisplacementMapElement",
  "SVGFEDiffuseLightingElement", "SVGFEConvolveMatrixElement",
  "SVGFECompositeElement", "SVGFEComponentTransferElement",
  "SVGFEColorMatrixElement", "SVGFEBlendElement",
  "SVGComponentTransferFunctionElement", "SVGVKernElement",
  "SVGMissingGlyphElement", "SVGHKernElement", "SVGGlyphRefElement",
  "SVGGlyphElement", "SVGFontFaceUriElement",
  "SVGFontFaceSrcElement", "SVGFontFaceNameElement",
  "SVGFontFaceFormatElement", "SVGFontFaceElement", "SVGFontElement",
  "SVGAltGlyphItemElement", "SVGAltGlyphElement",
  "SVGAltGlyphDefElement", "SVGSetElement", "SVGMPathElement",
  "SVGAnimateTransformElement", "SVGAnimateMotionElement",
  "SVGAnimateElement", "SVGAnimateColorElement", "SVGZoomAndPan",
  "SVGViewSpec", "SVGViewElement", "SVGUseElement", "SVGUnitTypes",
  "SVGTSpanElement", "SVGTRefElement", "SVGTransformList",
  "SVGTransform", "SVGTitleElement", "SVGTextPositioningElement",
  "SVGTextPathElement", "SVGTextElement", "SVGTextContentElement",
  "SVGSymbolElement", "SVGSwitchElement", "SVGSVGElement",
  "SVGStyleElement", "SVGStringList", "SVGStopElement",
  "SVGScriptElement", "SVGRenderingIntent", "SVGRectElement",
  "SVGRect", "SVGRadialGradientElement", "SVGPreserveAspectRatio",
  "SVGPolylineElement", "SVGPolygonElement", "SVGPointList",
  "SVGPoint", "SVGPatternElement", "SVGPathSegMovetoRel",
  "SVGPathSegMovetoAbs", "SVGPathSegList",
  "SVGPathSegLinetoVerticalRel", "SVGPathSegLinetoVerticalAbs",
  "SVGPathSegLinetoRel", "SVGPathSegLinetoHorizontalRel",
  "SVGPathSegLinetoHorizontalAbs", "SVGPathSegLinetoAbs",
  "SVGPathSegCurvetoQuadraticSmoothRel",
  "SVGPathSegCurvetoQuadraticSmoothAbs",
  "SVGPathSegCurvetoQuadraticRel", "SVGPathSegCurvetoQuadraticAbs",
  "SVGPathSegCurvetoCubicSmoothRel",
  "SVGPathSegCurvetoCubicSmoothAbs", "SVGPathSegCurvetoCubicRel",
  "SVGPathSegCurvetoCubicAbs", "SVGPathSegClosePath",
  "SVGPathSegArcRel", "SVGPathSegArcAbs", "SVGPathSeg",
  "SVGPathElement", "SVGPaint", "SVGNumberList", "SVGNumber",
  "SVGMetadataElement", "SVGMatrix", "SVGMaskElement",
  "SVGMarkerElement", "SVGLineElement", "SVGLinearGradientElement",
  "SVGLengthList", "SVGLength", "SVGImageElement",
  "SVGGradientElement", "SVGGElement", "SVGException",
  "SVGForeignObjectElement", "SVGEllipseElement",
  "SVGElementInstanceList", "SVGElementInstance", "SVGElement",
  "SVGDocument", "SVGDescElement", "SVGDefsElement",
  "SVGCursorElement", "SVGColor", "SVGClipPathElement",
  "SVGCircleElement", "SVGAnimatedTransformList",
  "SVGAnimatedString", "SVGAnimatedRect",
  "SVGAnimatedPreserveAspectRatio", "SVGAnimatedNumberList",
  "SVGAnimatedNumber", "SVGAnimatedLengthList", "SVGAnimatedLength",
  "SVGAnimatedInteger", "SVGAnimatedEnumeration",
  "SVGAnimatedBoolean", "SVGAnimatedAngle", "SVGAngle",
  "SVGAElement", "SVGZoomEvent", "XPathException", "XPathResult",
  "XPathEvaluator", "Storage", "ClientRectList", "ClientRect",
  "MimeTypeArray", "MimeType", "PluginArray", "Plugin",
  "MessageChannel", "MessagePort", "XSLTProcessor",
  "XMLHttpRequestException", "XMLHttpRequestUpload",
  "XMLHttpRequest", "XMLSerializer", "DOMParser", "XMLDocument",
  "EventSource", "RangeException", "Range", "NodeFilter", "Blob",
  "FileList", "File", "Worker", "Clipboard", "WebKitPoint",
  "WebKitCSSMatrix", "WebKitCSSKeyframesRule",
  "WebKitCSSKeyframeRule", "EventException", "WebGLContextEvent",
  "SpeechInputEvent", "StorageEvent", "TouchEvent",
  "XMLHttpRequestProgressEvent", "WheelEvent",
  "WebKitTransitionEvent", "WebKitAnimationEvent", "UIEvent",
  "TextEvent", "ProgressEvent", "PageTransitionEvent",
  "PopStateEvent", "OverflowEvent", "MutationEvent", "MouseEvent",
  "MessageEvent", "KeyboardEvent", "HashChangeEvent", "ErrorEvent",
  "CustomEvent", "CompositionEvent", "BeforeLoadEvent", "Event",
  "DataView", "Float64Array", "Float32Array", "Uint32Array",
  "Int32Array", "Uint16Array", "Int16Array", "Uint8ClampedArray",
  "Uint8Array", "Int8Array", "ArrayBufferView", "ArrayBuffer",
  "DOMStringMap", "WebGLUniformLocation", "WebGLTexture",
  "WebGLShaderPrecisionFormat", "WebGLShader",
  "WebGLRenderingContext", "WebGLRenderbuffer", "WebGLProgram",
  "WebGLFramebuffer", "WebGLBuffer", "WebGLActiveInfo",
  "TextMetrics", "ImageData", "CanvasRenderingContext2D",
  "CanvasGradient", "CanvasPattern", "Option", "Image",
  "HTMLUnknownElement", "HTMLOptionsCollection",
  "HTMLFormControlsCollection", "HTMLAllCollection",
  "HTMLCollection", "HTMLUListElement", "HTMLTitleElement",
  "HTMLTextAreaElement", "HTMLTableSectionElement",
  "HTMLTableRowElement", "HTMLTableElement", "HTMLTableColElement",
  "HTMLTableCellElement", "HTMLTableCaptionElement",
  "HTMLStyleElement", "HTMLSpanElement", "HTMLSelectElement",
  "HTMLScriptElement", "HTMLQuoteElement", "HTMLProgressElement",
  "HTMLPreElement", "HTMLParamElement", "HTMLParagraphElement",
  "HTMLOutputElement", "HTMLOptionElement", "HTMLOptGroupElement",
  "HTMLObjectElement", "HTMLOListElement", "HTMLModElement",
  "HTMLMeterElement", "HTMLMetaElement", "HTMLMenuElement",
  "HTMLMarqueeElement", "HTMLMapElement", "HTMLLinkElement",
  "HTMLLegendElement", "HTMLLabelElement", "HTMLLIElement",
  "HTMLKeygenElement", "HTMLInputElement", "HTMLImageElement",
  "HTMLIFrameElement", "HTMLHtmlElement", "HTMLHeadingElement",
  "HTMLHeadElement", "HTMLHRElement", "HTMLFrameSetElement",
  "HTMLFrameElement", "HTMLFormElement", "HTMLFontElement",
  "HTMLFieldSetElement", "HTMLEmbedElement", "HTMLDivElement",
  "HTMLDirectoryElement", "HTMLDataListElement", "HTMLDListElement",
  "HTMLCanvasElement", "HTMLButtonElement", "HTMLBodyElement",
  "HTMLBaseFontElement", "HTMLBaseElement", "HTMLBRElement",
  "HTMLAreaElement", "HTMLAppletElement", "HTMLAnchorElement",
  "HTMLElement", "HTMLDocument", "Window", "Selection",
  "ProcessingInstruction", "EntityReference", "Entity", "Notation",
  "DocumentType", "CDATASection", "Comment", "Text", "Element",
  "Attr", "CharacterData", "NamedNodeMap", "NodeList", "Node",
  "Document", "DocumentFragment", "DOMTokenList",
  "DOMSettableTokenList", "DOMImplementation", "DOMStringList",
  "DOMException", "StyleSheetList", "RGBColor", "Rect",
  "CSSRuleList", "Counter", "MediaList", "CSSStyleDeclaration",
  "CSSStyleRule", "CSSPageRule", "CSSMediaRule", "CSSImportRule",
  "CSSFontFaceRule", "CSSCharsetRule", "CSSRule",
  "WebKitCSSFilterValue", "WebKitCSSMixFunctionValue",
  "WebKitCSSTransformValue", "CSSValueList", "CSSPrimitiveValue",
  "CSSValue", "CSSStyleSheet", "StyleSheet", "performance",
  "console", "devicePixelRatio", "styleMedia", "parent", "opener",
  "frames", "self", "defaultstatus", "defaultStatus", "status",
  "name", "length", "closed", "pageYOffset", "pageXOffset",
  "scrollY", "scrollX", "screenTop", "screenLeft", "screenY",
  "screenX", "innerWidth", "innerHeight", "outerWidth",
  "outerHeight", "offscreenBuffering", "frameElement", "event",
  "crypto", "clientInformation", "navigator", "toolbar", "statusbar",
  "scrollbars", "personalbar", "menubar", "locationbar", "history",
  "screen",

  // Object.getOwnPropertyNames(Object.getPrototypeOf(this)).join('", "')
  "toString", "postMessage", "close", "blur", "focus",
  "ondeviceorientation", "onwebkittransitionend",
  "onwebkitanimationstart", "onwebkitanimationiteration",
  "onwebkitanimationend", "onsearch", "onreset", "onwaiting",
  "onvolumechange", "onunload", "ontimeupdate", "onsuspend",
  "onsubmit", "onstorage", "onstalled", "onselect", "onseeking",
  "onseeked", "onscroll", "onresize", "onratechange", "onprogress",
  "onpopstate", "onplaying", "onplay", "onpause", "onpageshow",
  "onpagehide", "ononline", "onoffline", "onmousewheel", "onmouseup",
  "onmouseover", "onmouseout", "onmousemove", "onmousedown",
  "onmessage", "onloadstart", "onloadedmetadata", "onloadeddata",
  "onload", "onkeyup", "onkeypress", "onkeydown", "oninvalid",
  "oninput", "onhashchange", "onfocus", "onerror", "onended",
  "onemptied", "ondurationchange", "ondrop", "ondragstart",
  "ondragover", "ondragleave", "ondragenter", "ondragend", "ondrag",
  "ondblclick", "oncontextmenu", "onclick", "onchange",
  "oncanplaythrough", "oncanplay", "onblur", "onbeforeunload",
  "onabort", "getSelection", "print", "stop", "open",
  "showModalDialog", "alert", "confirm", "prompt", "find",
  "scrollBy", "scrollTo", "scroll", "moveBy", "moveTo", "resizeBy",
  "resizeTo", "matchMedia", "setTimeout", "clearTimeout",
  "setInterval", "clearInterval", "requestAnimationFrame",
  "cancelAnimationFrame", "webkitRequestAnimationFrame",
  "webkitCancelAnimationFrame", "webkitCancelRequestAnimationFrame",
  "atob", "btoa", "addEventListener", "removeEventListener",
  "captureEvents", "releaseEvents", "getComputedStyle",
  "getMatchedCSSRules", "webkitConvertPointFromPageToNode",
  "webkitConvertPointFromNodeToPage", "dispatchEvent",
  "webkitRequestFileSystem", "webkitResolveLocalFileSystemURL",
  "openDatabase", "TEMPORARY", "PERSISTENT", "constructor",

  // Additional, manually added symbols.

  // We're going to need 'arguments'
  "arguments",

  // Meteor provides these at runtime
  "Npm", "__meteor_runtime_config__", "__meteor_bootstrap__",

  // A node-ism (and needed by the 'meteor' package to read the
  // environment to bootstrap __meteor_runtime_config__, though
  // probably we should find a better way to do that)
  "process",

  // These are used by sockjs. (XXX before this
  // goes out the door, it needs to switch to detecting assignment
  // rather than using a blacklist, or at the very very least it needs
  // to have a blacklist that includes all the major browsers.)
  "ActiveXObject", "CollectGarbage", "XDomainRequest"
];

var blacklist = {}
_.each(blacklistedSymbols, function (name) {
  blacklist[name] = true;
});

var linker = module.exports = {
  link: link
};
