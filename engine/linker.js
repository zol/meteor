var fs = require('fs');
var uglify = require('uglify-js');
var _ = require('underscore');

// Options:
// - preserveLineNumbers: if true, decorate minimally so that line
//   numbers don't change between input and output
// - path: a (cosmetic) path to print in the header. the first
//   character will be stripped, on the assumption that it's '/'
// - sourceWidth: width in columns to use for the source code
var wrapFile = function (source, options) {
  // The newline after the source closes a '//' comment.
  //
  // The ".call(this)" allows you to do a top-level "this.foo = " to
  // define global variables; this is the only way to do it in
  // CoffeeScript.

  if (options.preserveLineNumbers) {
    return "(function(){" + source + "\n}).call(this);\n";
  } else {
    var ret = "";

    // Prologue
    ret += "(function () {\n\n";

    // Banner
    var width = options.sourceWidth || 70;
    var bannerWidth = width + 3;
    var divider = new Array(bannerWidth + 1).join('/') + "\n";
    var spacer = "// " + new Array(bannerWidth - 6 + 1).join(' ') + " //\n";
    var padding = new Array(bannerWidth + 1).join(' ');
    var blankLine = new Array(width + 1).join(' ') + " //\n";
    ret += divider + spacer;
    ret += "// " + (options.path.slice(1) + padding).slice(0, bannerWidth - 6) +
      " //\n";
    ret += spacer + divider + blankLine;

    // Code, with line numbers
    // You might prefer your line numbers at the beginning of the
    // line, with /* .. */. Well, that requires parsing the source for
    // comments, because you have to do something different if you're
    // already inside a comment.
    var lines = source.split('\n');
    var num = 1;
    _.each(lines, function (line) {
      ret += (line + padding).slice(0, width) + " // " + num + "\n";
      num++;
    });

    // Footer
    ret += divider;

    // Epilogue
    ret += "\n}).call(this);\n\n\n\n\n\n"
    return ret;
  }
};

// file should have a 'source' attribute. Compute the global
// references and assign them to the 'globalReferences' attribute of
// file, as a map from the name of the global to true. However, if
// file already has such an attribute, do nothing.
//
// For example: if the code references 'Foo.bar.baz' and 'Quux', and
// neither are declared in a scope enclosing the point where they're
// referenced, then globalReferences would incude {Foo: true, Quux:
// true}.
var computeGlobalReferences = function (file) {
  var toplevel = uglify.parse(file.source); // instanceof uglify.AST_Toplevel
  toplevel.figure_out_scope();

  // XXX Use Uglify for now. Uglify is pretty good at returning us a
  // list of symbols that are referenced but not defined, but not good
  // at all at helping us figure out which of those are assigned to
  // rather than just referenced. Without the assignments, we have to
  // maintain an explicit list of symbols that we expect to be
  // declared in the browser, which is super bogus! Use jsparse
  // instead or maybe acorn, and rewrite uglify's scope analysis code
  // (it can't be that hard.)

  file.globalReferences = {};
  _.each(toplevel.enclosed, function (symbol) {
    if (symbol.undeclared && ! (symbol.name in blacklist))
      file.globalReferences[symbol.name] = true;
  });

  console.log(_.keys(file.globalReferences))
};

var maxLineLengthInFiles = function (files) {
  var maxInFile = [];
  _.each(files, function (file) {
    var lines = file.source.split('\n');
    maxInFile.push(_.max(_.pluck(lines, "length")));
  });

  return _.max(maxInFile);
};

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
  var files = _.map(options.inputFiles, _.clone);

  if (! files.length)
    return [];

  // Find the maximum line length
  var sourceWidth = _.max([70, maxLineLengthInFiles(files)]);

  // Wrap each file in its own namespace
  _.each(files, function (file) {
    file.source = wrapFile(file.source, {
      path: file.servePath,
      preserveLineNumbers: options.useGlobalNamespace,
      sourceWidth: sourceWidth
    });
  });

  // If not using the global namespace, create a second namespace that
  // all of the files share
  if (! options.useGlobalNamespace) {
    // Find all global references in any files
    var globalReferences = {};
    _.each(files, function (file) {
      computeGlobalReferences(file);
      _.extend(globalReferences, file.globalReferences);
    });

    // Create a closure that captures those references
    var combined = "(function () {\n\n";

    if (_.keys(globalReferences).length) {
      combined += "/* Package-scope variables */\n";
      combined += "var " + _.keys(globalReferences).join(', ') + ";\n\n";
    }

    // Emit each file
    _.each(files, function (file) {
      combined += file.source;
      combined += "\n";
    });

    // Postlogue
    combined += "\n}).call(this);";

    // Replace all of the files with this new combined file
    files = [{
      servePath: options.combinedServePath,
      source: combined
    }];
  }

  return files;
};

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
