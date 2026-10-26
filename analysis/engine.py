#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Runlet Static Analysis Engine  (Python 3, standard library only)
================================================================

This is the "brain" the user asked for: it looks at the whole virtual project
(HTML + CSS + JS), figures out what the code will MOST LIKELY DO when it runs,
explains it in plain Russian, and reports probable errors, risky places,
accessibility / SEO / performance / security issues and quick fixes.

Protocol
--------
  python3 analysis/engine.py                 -> read one JSON job from stdin,
                                               write one JSON report to stdout
  python3 analysis/engine.py --server       -> JSON-lines server (one job per
                                               line, one report per line)
  python3 analysis/engine.py --selftest     -> analyse a built-in demo project

Job:     {"files": {"index.html": "...", ...}, "active": "index.html",
          "deps": ["react"], "locale": "ru"}
Report:  {"ok": true, "engine": "runlet-python/1.0", "elapsed_ms": 12,
          "score": 78, "grades": {...}, "summary": {...}, "behavior": {...},
          "diagnostics": [...], "metrics": {...}, "functions": [...],
          "links": [...], "colors": [...], "glossary": [...], "markdown": "..."}

No third-party modules, no network, no filesystem writes: safe to spawn from
Electron or from a local HTTP server.
"""

import sys
import json
import re
import time
import math
import os
from html.parser import HTMLParser

# ---------------------------------------------------------------------------
# Knowledge bases
# ---------------------------------------------------------------------------

VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input",
             "link", "meta", "param", "source", "track", "wbr", "!doctype"}
DEPRECATED_TAGS = {"font", "center", "marquee", "big", "strike", "blink",
                   "frameset", "frame", "applet", "basefont", "dir", "isindex",
                   "acronym", "tt", "plaintext", "xmp", "keygen"}
SEMANTIC_TAGS = {"header", "nav", "main", "section", "article", "aside",
                 "footer", "figure", "figcaption", "time", "mark", "details"}
ARIA_ROLES = {"alert", "alertdialog", "application", "article", "banner",
              "button", "cell", "checkbox", "columnheader", "combobox",
              "complementary", "contentinfo", "definition", "dialog",
              "directory", "document", "feed", "figure", "form", "grid",
              "gridcell", "group", "heading", "img", "link", "list",
              "listbox", "listitem", "log", "main", "marquee", "math",
              "menu", "menubar", "menuitem", "meter", "navigation", "none",
              "note", "option", "presentation", "progressbar", "radio",
              "radiogroup", "region", "row", "rowgroup", "rowheader",
              "scrollbar", "search", "searchbox", "separator", "slider",
              "spinbutton", "status", "switch", "tab", "table", "tablist",
              "tabpanel", "term", "textbox", "timer", "toolbar", "tooltip",
              "tree", "treegrid", "treeitem"}

CSS_PROPERTIES = set("""
accent-color align-content align-items align-self all animation animation-delay
animation-direction animation-duration animation-fill-mode animation-iteration-count
animation-name animation-play-state animation-timing-function appearance aspect-ratio
backdrop-filter backface-visibility background background-attachment background-blend-mode
background-clip background-color background-image background-origin background-position
background-position-x background-position-y background-repeat background-size
block-size border border-block border-block-color border-block-end border-block-end-color
border-block-end-style border-block-end-width border-block-start border-block-start-color
border-block-start-style border-block-start-width border-block-style border-block-width
border-bottom border-bottom-color border-bottom-left-radius border-bottom-right-radius
border-bottom-style border-bottom-width border-collapse border-color border-end-end-radius
border-end-start-radius border-image border-image-outset border-image-repeat
border-image-slice border-image-source border-image-width border-inline border-inline-color
border-inline-end border-inline-end-color border-inline-end-style border-inline-end-width
border-inline-start border-inline-start-color border-inline-start-style
border-inline-start-width border-inline-style border-inline-width border-left
border-left-color border-left-style border-left-width border-radius border-right
border-right-color border-right-style border-right-width border-spacing
border-start-end-radius border-start-start-radius border-style border-top
border-top-color border-top-left-radius border-top-right-radius border-top-style
border-top-width border-width bottom box-decoration-break box-shadow box-sizing
break-after break-before break-inside caption-side caret-color clear clip clip-path
color color-scheme column-count column-fill column-gap column-rule column-rule-color
column-rule-style column-rule-width column-span column-width columns contain
container container-name container-type content content-visibility counter-increment
counter-reset counter-set cursor direction display empty-cells filter flex flex-basis
flex-direction flex-flow flex-grow flex-shrink flex-wrap float font font-family
font-feature-settings font-kerning font-optical-sizing font-size font-size-adjust
font-stretch font-style font-synthesis font-variant font-variant-numeric
font-variation-settings font-weight forced-color-adjust gap grid grid-area
grid-auto-columns grid-auto-flow grid-auto-rows grid-column grid-column-end
grid-column-start grid-row grid-row-end grid-row-start grid-template
grid-template-areas grid-template-columns grid-template-rows hanging-punctuation
height hyphenate-character hyphens image-rendering inline-size inset inset-block
inset-block-end inset-block-start inset-inline inset-inline-end inset-inline-start
isolation justify-content justify-items justify-self left letter-spacing
line-break line-height list-style list-style-image list-style-position
list-style-type margin margin-block margin-block-end margin-block-start
margin-bottom margin-inline margin-inline-end margin-inline-start margin-left
margin-right margin-top mask mask-border mask-clip mask-composite mask-image
mask-mode mask-origin mask-position mask-repeat mask-size mask-type
math-style max-block-size max-height max-inline-size max-width min-block-size
min-height min-inline-size min-width mix-blend-mode object-fit object-position
offset offset-anchor offset-distance offset-path offset-position offset-rotate
opacity order outline outline-color outline-offset outline-style outline-width
overflow overflow-anchor overflow-block overflow-clip-margin overflow-inline
overflow-wrap overflow-x overflow-y overscroll-behavior overscroll-behavior-block
overscroll-behavior-inline overscroll-behavior-x overscroll-behavior-y padding
padding-block padding-block-end padding-block-start padding-bottom
padding-inline padding-inline-end padding-inline-start padding-left padding-right
padding-top page-break-after page-break-before page-break-inside paint-order
perspective perspective-origin place-content place-items place-self pointer-events
position print-color-adjust quotes resize right rotate row-gap ruby-position
scale scroll-behavior scroll-margin scroll-margin-block scroll-margin-block-end
scroll-margin-block-start scroll-margin-bottom scroll-margin-inline
scroll-margin-inline-end scroll-margin-inline-start scroll-margin-left
scroll-margin-right scroll-margin-top scroll-padding scroll-padding-block
scroll-padding-block-end scroll-padding-block-start scroll-padding-bottom
scroll-padding-inline scroll-padding-inline-end scroll-padding-inline-start
scroll-padding-left scroll-padding-right scroll-padding-top scroll-snap-align
scroll-snap-stop scroll-snap-type scrollbar-color scrollbar-gutter scrollbar-width
shape-image-threshold shape-margin shape-outside tab-size table-layout text-align
text-align-last text-combine-upright text-decoration text-decoration-color
text-decoration-line text-decoration-skip-ink text-decoration-style
text-decoration-thickness text-emphasis text-emphasis-color text-emphasis-position
text-emphasis-style text-indent text-justify text-orientation text-overflow
text-rendering text-shadow text-size-adjust text-transform text-underline-offset
text-underline-position top touch-action transform transform-box transform-origin
transform-style transition transition-delay transition-duration
transition-property transition-timing-function translate unicode-bidi
user-select vertical-align visibility white-space widows width will-change
word-break word-spacing writing-mode z-index zoom
""".split())

LENGTHISH = {"width", "height", "min-width", "max-width", "min-height",
             "max-height", "margin", "margin-top", "margin-right",
             "margin-bottom", "margin-left", "padding", "padding-top",
             "padding-right", "padding-bottom", "padding-left", "top", "right",
             "bottom", "left", "gap", "row-gap", "column-gap", "font-size",
             "border-width", "border-radius", "letter-spacing",
             "inset", "flex-basis", "outline-width",
             "text-indent", "border-spacing", "background-position"}

JS_GLOBALS = set("""
window document console navigator location history screen alert confirm prompt
fetch XMLHttpRequest WebSocket Event CustomEvent EventTarget AbortController
AbortSignal FormData Headers Request Response URL URLSearchParams Blob File
FileReader Image Audio Video Option DOMParser XMLSerializer Node Element
HTMLElement HTMLDocument ShadowRoot CSS CSSStyleDeclaration MutationObserver
IntersectionObserver ResizeObserver PerformanceObserver requestAnimationFrame
cancelAnimationFrame requestIdleCallback setTimeout clearTimeout setInterval
clearInterval queueMicrotask structuredClone crypto performance localStorage
sessionStorage indexedDB caches self globalThis top parent frames opener
Math JSON Object Array String Number Boolean BigInt Symbol Date RegExp Error
TypeError RangeError SyntaxError ReferenceError URIError EvalError Promise
Proxy Reflect Map Set WeakMap WeakSet ArrayBuffer DataView Int8Array Uint8Array
Uint8ClampedArray Int16Array Uint16Array Int32Array Uint32Array Float32Array
Float64Array BigInt64Array BigUint64Array Intl decodeURI encodeURI
decodeURIComponent encodeURIComponent escape unescape parseInt parseFloat
isNaN isFinite NaN Infinity undefined eval arguments this super new typeof
void delete in instanceof yield await async static get set of let const var
function class return if else for while do switch case break continue try
catch finally throw default export import from as null true false debugger
with enum implements interface package private protected public
React Vue jQuery $$ Chart d3 THREE tailwind gsap Alpine htmx console
HTMLInputElement HTMLButtonElement HTMLFormElement HTMLImageElement
customElements getComputedStyle matchMedia innerWidth innerHeight
devicePixelRatio scrollTo scrollBy print open close stop focus blur
addEventListener removeEventListener dispatchEvent querySelector
querySelectorAll getElementById getElementsByClassName getElementsByTagName
createElement createTextNode createDocumentFragment appendChild
structuredClone queueMicrotask atob btoa TextEncoder TextDecoder
navigator.clipboard Notification SharedWorker Worker ServiceWorker
""".split())

NAMED_COLORS = {
    "white": (255, 255, 255), "black": (0, 0, 0), "red": (255, 0, 0),
    "green": (0, 128, 0), "blue": (0, 0, 255), "yellow": (255, 255, 0),
    "orange": (255, 165, 0), "purple": (128, 0, 128), "gray": (128, 128, 128),
    "grey": (128, 128, 128), "silver": (192, 192, 192), "pink": (255, 192, 203),
    "cyan": (0, 255, 255), "aqua": (0, 255, 255), "magenta": (255, 0, 255),
    "fuchsia": (255, 0, 255), "transparent": None, "currentcolor": None,
    "inherit": None, "initial": None, "unset": None, "revert": None,
    "tomato": (255, 99, 71), "gold": (255, 215, 0), "navy": (0, 0, 128),
    "teal": (0, 128, 128), "lime": (0, 255, 0), "maroon": (128, 0, 0),
    "olive": (128, 128, 0), "indigo": (75, 0, 130), "violet": (238, 130, 238),
    "coral": (255, 127, 80), "salmon": (250, 128, 114), "khaki": (240, 230, 140),
    "crimson": (220, 20, 60), "chocolate": (210, 105, 30),
}

GLOSSARY = [
    ("querySelector", "ищет первый элемент на странице по CSS-селектору. Если ничего не найдено — возвращает null и обращение к нему вызовет ошибку."),
    ("addEventListener", "подписывается на событие (клик, ввод, загрузка). Код внутри сработает, когда событие произойдёт."),
    ("innerHTML", "заменяет HTML внутри элемента. Опасно подставлять туда пользовательский текст — можно получить XSS."),
    ("textContent", "меняет текст элемента, не интерпретируя HTML — безопаснее, чем innerHTML."),
    ("fetch", "делает сетевой запрос. Работает асинхронно: результат приходит позже, поэтому нужен await или .then()."),
    ("localStorage", "хранилище в браузере, данные остаются после перезагрузки страницы."),
    ("setTimeout", "запускает код один раз через указанное число миллисекунд."),
    ("setInterval", "запускает код снова и снова с заданным интервалом, пока его не остановят clearInterval()."),
    ("CSS-селектор", "шаблон для поиска элементов: #id, .class, tag, tag:hover и другие."),
    ("DOM", "дерево элементов страницы, с которым работает JavaScript."),
    ("async/await", "способ дождаться асинхронного результата, не создавая цепочку .then()."),
    ("null", "специальное значение «ничего». Попытка прочитать у null свойство — частая ошибка TypeError."),
    ("!important", "повышает приоритет CSS-правила; злоупотребление усложняет поддержку стилей."),
    ("alt", "текстовая замена картинки: её читают скринридеры и показывают, если картинка не загрузилась."),
]

TEXT_EXT = (".html", ".htm", ".css", ".js", ".mjs", ".cjs", ".json", ".ts",
            ".jsx", ".tsx", ".scss", ".sass", ".less", ".md", ".svg", ".txt",
            ".xml", ".vue", ".pug", ".map")


# ---------------------------------------------------------------------------
# Diagnostics collector
# ---------------------------------------------------------------------------

class Collector:
    def __init__(self):
        self.items = []
        self.seen = set()

    def add(self, rid, sev, file, line, msg, *, col=1, why="", fix="",
            cat="correctness", edit=None, src="python"):
        key = (rid, file, line, msg)
        if key in self.seen:
            return
        self.seen.add(key)
        self.items.append({
            "id": rid, "sev": sev, "file": file, "line": max(1, int(line or 1)),
            "col": max(1, int(col or 1)), "msg": msg, "why": why, "fix": fix,
            "cat": cat, "edit": edit, "src": src,
        })

    def __call__(self, *args, **kwargs):
        """Allow using the collector itself as the `add` callback."""
        self.add(*args, **kwargs)


# ---------------------------------------------------------------------------
# JavaScript lexer  (strings / templates / comments / regex aware)
# ---------------------------------------------------------------------------

class Tok:
    __slots__ = ("type", "value", "line", "col", "start", "end")

    def __init__(self, t, v, line, col, start, end):
        self.type, self.value, self.line, self.col = t, v, line, col
        self.start, self.end = start, end

    def __repr__(self):
        return "Tok(%s,%r,L%d)" % (self.type, self.value[:24], self.line)


REGEX_ALLOWED = {"(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";",
                 "+", "-", "*", "/", "%", "<", ">", "=>", "==", "===", "!=",
                 "return", "case", "typeof", "in", "of", "new", "delete",
                 "void", "yield", "await", "throw", "else", "do"}


def js_tokens(code):
    """Tokenise JS enough for bracket balance, identifiers, strings and calls."""
    toks, out = [], []
    i, n, line, col = 0, len(code), 1, 1

    def consume(k):
        nonlocal i, line, col
        chunk = code[i:i + k]
        nl = chunk.count("\n")
        if nl:
            line += nl
            col = len(chunk) - chunk.rfind("\n")
        else:
            col += k
        i += k
        return chunk

    def emit(t, v, l, c, s, e):
        toks.append(Tok(t, v, l, c, s, e))

    while i < n:
        c = code[i]
        if c in " \t\r\n":
            consume(1)
            continue
        s, l, cc = i, line, col
        # comments
        if c == "/" and i + 1 < n and code[i + 1] == "/":
            j = code.find("\n", i)
            j = n if j < 0 else j
            consume(j - i)
            emit("comment", code[s:j], l, cc, s, j)
            continue
        if c == "/" and i + 1 < n and code[i + 1] == "*":
            j = code.find("*/", i + 2)
            j = n if j < 0 else j + 2
            consume(j - i)
            emit("comment", code[s:j], l, cc, s, j)
            continue
        # strings / templates
        if c in "'\"`":
            quote, j, depth_tpl = c, i + 1, 0
            while j < n:
                ch = code[j]
                if ch == "\\":
                    j += 2
                    continue
                if c == "`" and ch == "$" and j + 1 < n and code[j + 1] == "{":
                    depth_tpl += 1
                    j += 2
                    continue
                if c == "`" and ch == "}" and depth_tpl:
                    depth_tpl -= 1
                    j += 1
                    continue
                if ch == c and not depth_tpl:
                    j += 1
                    break
                j += 1
            consume(j - i)
            emit("string", code[s:j], l, cc, s, j)
            continue
        # regex literal
        if c == "/" and i + 1 < n and code[i + 1] not in "/*":
            prev = toks[-1] if toks else None
            allowed = (prev is None or prev.value in REGEX_ALLOWED or
                       (prev.type == "op" and prev.value not in (")", "]", "}", "++", "--")))
            if allowed:
                j, in_class = i + 1, False
                while j < n:
                    ch = code[j]
                    if ch == "\\":
                        j += 2
                        continue
                    if ch == "[":
                        in_class = True
                    elif ch == "]":
                        in_class = False
                    elif ch == "/" and not in_class:
                        j += 1
                        while j < n and code[j].isalpha():
                            j += 1
                        break
                    elif ch == "\n":
                        break
                    j += 1
                if j <= n and code[j - 1] != "\n":
                    consume(j - i)
                    emit("regex", code[s:j], l, cc, s, j)
                    continue
        # identifiers / keywords
        if c.isalpha() or c in "_$" or ord(c) > 127:
            j = i + 1
            while j < n and (code[j].isalnum() or code[j] in "_$" or ord(code[j]) > 127):
                j += 1
            consume(j - i)
            emit("ident", code[s:j], l, cc, s, j)
            continue
        # numbers
        if c.isdigit() or (c == "." and i + 1 < n and code[i + 1].isdigit()):
            j = i + 1
            while j < n and (code[j].isalnum() or code[j] in "._"):
                j += 1
            consume(j - i)
            emit("number", code[s:j], l, cc, s, j)
            continue
        # operators (longest first)
        op = None
        for cand in ("===", "!==", ">>>", "**=", "...", "=>", "==", "!=", "<=",
                     ">=", "&&", "||", "??", "++", "--", "+=", "-=", "*=",
                     "/=", "%=", "&=", "|=", "^=", "**", "<<", ">>", "?.",
                     "??=", "&&=", "||="):
            if code.startswith(cand, i):
                op = cand
                break
        if not op:
            op = c
        consume(len(op))
        emit("op", op, l, cc, s, i)

    # masked source: comments replaced by spaces (newlines preserved),
    # strings / templates kept intact -> safe for regex searches
    chars = list(code)
    for t in toks:
        if t.type == "comment":
            for k in range(t.start, t.end):
                if chars[k] != "\n":
                    chars[k] = " "
        elif t.type == "regex":
            for k in range(t.start, t.end):
                if chars[k] != "\n":
                    chars[k] = " "
    return toks, "".join(chars)


def check_js_balance(toks, code, file, add, offset=0):
    pairs = {")": "(", "]": "[", "}": "{"}
    opens = {"(": ")", "[": "]", "{": "}"}
    stack = []
    for t in toks:
        if t.type != "op":
            continue
        if t.value in opens:
            stack.append(t)
        elif t.value in pairs:
            if not stack:
                add("JS001", "error", file, t.line + offset,
                    "Лишняя закрывающая скобка «%s» — ей нечего закрывать." % t.value,
                    col=t.col, cat="correctness",
                    why="Скобки должны быть парными, иначе скрипт не запустится (SyntaxError).",
                    fix="Удалите эту скобку или добавьте открывающую раньше.")
            elif stack[-1].value != pairs[t.value]:
                o = stack.pop()
                add("JS002", "error", file, t.line + offset,
                    "Перепутаны скобки: открыта «%s» на строке %d, а закрывается «%s»."
                    % (o.value, o.line + offset, t.value),
                    col=t.col, cat="correctness",
                    why="Типы скобок должны совпадать.",
                    fix="Замените закрывающую скобку на «%s»." % opens[o.value])
            else:
                stack.pop()
    for t in stack[-6:]:
        add("JS003", "error", file, t.line + offset,
            "Незакрытая скобка «%s» — скорее всего, в конце не хватает «%s»."
            % (t.value, opens[t.value]),
            col=t.col, cat="correctness",
            why="Парсер дойдёт до конца файла и упадёт с «Unexpected end of input».",
            fix="Добавьте «%s» в подходящем месте." % opens[t.value])


def line_of(code, pos):
    return code.count("\n", 0, max(0, pos)) + 1


# ---------------------------------------------------------------------------
# HTML analysis
# ---------------------------------------------------------------------------

class HTMLScan(HTMLParser):
    def __init__(self, code, file, add):
        super().__init__(convert_charrefs=True)
        self.code, self.file, self.add = code, file, add
        self.stack = []
        self.tags = {}
        self.ids = {}
        self.classes = set()
        self.images = []
        self.links = []
        self.scripts = []
        self.styles = []
        self.metas = []
        self.headings = []
        self.buttons = 0
        self.inputs = []
        self.forms = 0
        self.iframes = []
        self.inline = []
        self.title = ""
        self._title_mode = False
        self._cdata = None
        self.html_lang = None
        self.doctype = False
        self.inline_handlers = []
        self.deprecated = []
        self.external_scripts = []
        self._all_refs = []

    def handle_decl(self, decl):
        if decl.lower().startswith("doctype"):
            self.doctype = True

    def handle_starttag(self, tag, attrs):
        line, col = self.getpos()
        raw = self.get_starttag_text() or ""
        d = dict((k.lower(), (v or "")) for k, v in attrs)
        self.tags[tag] = self.tags.get(tag, 0) + 1
        if tag == "html":
            self.html_lang = d.get("lang")
        if tag == "title":
            self._title_mode = True
        if tag == "meta":
            self.metas.append((line, d))
        if tag == "link" and d.get("rel", "").lower() == "stylesheet":
            self.styles.append((line, d.get("href", "")))
        if tag == "script":
            self.scripts.append((line, d))
            if d.get("src"):
                self.external_scripts.append((line, d))
        if tag == "img":
            self.images.append((line, d))
        if tag in ("a", "link", "script", "img", "iframe", "source", "video",
                   "audio", "use", "object", "embed"):
            for key in ("href", "src", "srcset", "poster", "xlink:href"):
                if d.get(key):
                    self._all_refs.append((line, key, d[key]))
        if tag == "a":
            self.links.append((line, d))
        if tag == "button":
            self.buttons += 1
        if tag == "input" or tag == "textarea" or tag == "select":
            self.inputs.append((line, tag, d))
        if tag == "form":
            self.forms += 1
        if tag == "iframe":
            self.iframes.append((line, d))
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.headings.append((line, tag))
        if "id" in d:
            self.ids.setdefault(d["id"], []).append(line)
        for cl in d.get("class", "").split():
            self.classes.add(cl)
        for k in d:
            if k.startswith("on"):
                self.inline_handlers.append((line, k, raw[:120]))
        if tag in DEPRECATED_TAGS:
            self.deprecated.append((line, tag))
        if tag in ("script", "style"):
            self._cdata = {"tag": tag, "line": line + raw.count("\n"),
                           "buf": [], "attrs": d}
        if tag not in VOID_TAGS:
            self.stack.append((tag, line, col))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if self.stack and self.stack[-1][0] == tag:
            self.stack.pop()
        self._cdata = None

    def handle_endtag(self, tag):
        line, col = self.getpos()
        if tag == "title":
            self._title_mode = False
        if self._cdata and self._cdata["tag"] == tag:
            self.inline.append({
                "tag": tag, "line": self._cdata["line"],
                "code": "".join(self._cdata["buf"]),
                "attrs": self._cdata["attrs"],
            })
            self._cdata = None
        if tag in VOID_TAGS:
            return
        if not self.stack:
            self.add("HTML010", "warning", self.file, line,
                     "Закрывающий тег </%s> без открывающего." % tag,
                     col=col, cat="correctness",
                     why="Браузер проигнорирует лишний тег, но это почти всегда опечатка.",
                     fix="Удалите </%s> или добавьте <%s>." % (tag, tag))
            return
        if self.stack[-1][0] == tag:
            self.stack.pop()
            return
        names = [x[0] for x in self.stack]
        if tag in names:
            idx = len(names) - 1 - names[::-1].index(tag)
            unclosed = ", ".join("<%s>" % x[0] for x in self.stack[idx + 1:])
            self.add("HTML011", "error", self.file, line,
                     "Нарушена вложенность: </%s> закрывает родителя, но внутри остались %s."
                     % (tag, unclosed),
                     col=col, cat="correctness",
                     why="Неправильная вложенность ломает вёрстку и ломает обход DOM в JS.",
                     fix="Закройте сначала %s, потом </%s>." % (unclosed, tag))
            self.stack = self.stack[:idx]
        else:
            self.add("HTML012", "warning", self.file, line,
                     "Закрывается </%s>, хотя ожидался </%s>." % (tag, self.stack[-1][0]),
                     col=col, cat="correctness",
                     fix="Проверьте порядок тегов.")

    def handle_data(self, data):
        if self._title_mode:
            self.title += data
        if self._cdata:
            self._cdata["buf"].append(data)

    def handle_entityref(self, name):
        if self._cdata:
            self._cdata["buf"].append("&%s;" % name)

    def handle_charref(self, name):
        if self._cdata:
            self._cdata["buf"].append("&#%s;" % name)

    def error(self, message):
        pass


def analyse_html(code, file, add, info, files):
    p = HTMLScan(code, file, add)
    try:
        p.feed(code)
        p.close()
    except Exception as e:  # pragma: no cover - HTMLParser is forgiving
        add("HTML000", "warning", file, 1, "Не удалось полностью разобрать HTML: %s" % e,
            cat="correctness")
    for tag, line, col in p.stack:
        add("HTML013", "error", file, line,
            "Незакрытый тег <%s> — в конце файла не хватает </%s>." % (tag, tag),
            col=col, cat="correctness",
            why="Браузер закроет его автоматически, но структура DOM будет не той, что ожидает скрипт.",
            fix="Добавьте </%s>." % tag)

    # --- structure / standards -------------------------------------------
    if not p.doctype and code.strip():
        add("HTML001", "warning", file, 1,
            "Нет <!DOCTYPE html> — браузер может включить режим совместимости (quirks mode).",
            cat="correctness", fix="Добавьте <!DOCTYPE html> первой строкой.",
            why="В quirks mode иначе считаются размеры блоков и отступы, вёрстка «поедет».",
            edit={"kind": "prepend", "text": "<!DOCTYPE html>\n"})
    if not p.html_lang and "<html" in code:
        add("HTML002", "warning", file, max(1, line_of(code, code.find("<html"))),
            "У <html> нет атрибута lang — скринридер не знает язык страницы.",
            cat="a11y", fix='Добавьте lang="ru" к тегу <html>.',
            why="Автопереводчики и программы чтения с экрана опираются на lang.",
            edit={"kind": "replace", "find": "<html>", "replace": '<html lang="ru">'})
    elif p.html_lang:
        info["lang"] = p.html_lang
    names = [x[1] for x in p.metas if x[1].get("name", "").lower() == "viewport"]
    charset = any("charset" in x[1] or x[1].get("http-equiv", "").lower() == "content-type"
                  for x in p.metas)
    if not names:
        add("HTML004", "warning", file, 1,
            "Нет <meta name=\"viewport\"> — на телефоне страница будет уменьшена.",
            cat="seo", fix='Добавьте <meta name="viewport" content="width=device-width, initial-scale=1">.',
            why="Без viewport мобильный браузер считает ширину 980px и масштабирует.",
            edit={"kind": "insert-after-line",
                  "line": max(1, line_of(code, code.find("<head"))),
                  "text": '  <meta name="viewport" content="width=device-width, initial-scale=1">'})
    if not charset:
        add("HTML003", "info", file, 1, "Не указана кодировка <meta charset=\"utf-8\">.",
            cat="correctness", fix="Добавьте <meta charset=\"utf-8\"> в <head>.")
    if not p.title.strip():
        add("HTML005", "warning", file, 1, "Нет <title> — вкладка будет без названия.",
            cat="seo", fix="Добавьте <title>Описание страницы</title> в <head>.")
    else:
        info["title"] = p.title.strip()[:120]
    if not any(x[1].get("name", "").lower() == "description" for x in p.metas):
        add("HTML006", "info", file, 1,
            "Нет meta description — поисковик сам выберет сниппет.",
            cat="seo", fix='Добавьте <meta name="description" content="...">.')
    if not any(x[1].get("property", "").lower().startswith("og:") for x in p.metas):
        add("HTML007", "info", file, 1, "Нет Open Graph-тегов для превью в соцсетях.",
            cat="seo", fix="Добавьте og:title, og:description, og:image.")
    if not any("application/ld+json" in x[1].get("type", "") for x in p.scripts):
        add("HTML008", "info", file, 1, "Нет микроразметки Schema.org (JSON-LD).",
            cat="seo", fix="Добавьте <script type=\"application/ld+json\">.")

    # --- a11y -------------------------------------------------------------
    for key, lines in p.ids.items():
        if len(lines) > 1:
            add("HTML020", "error", file, lines[1],
                'Дублирующийся id="%s" (ещё на строке %d).' % (key, lines[0]),
                cat="a11y",
                why="getElementById и CSS #id найдут только первый элемент — остальные «потеряются».",
                fix="Сделайте id уникальным или используйте class.")
    for line, d in p.images:
        if "alt" not in d:
            add("HTML021", "warning", file, line,
                "У <img> нет alt — скринридер не сможет описать картинку.",
                cat="a11y", fix='Добавьте alt="" (декоративная) или осмысленное описание.',
                why="Это одно из самых частых замечаний WCAG.",
                edit={"kind": "replace", "find": _img_raw(code, line),
                      "replace": _add_img_alt(_img_raw(code, line))} if _img_raw(code, line) else None)
        if not (d.get("width") or d.get("height")):
            add("HTML022", "info", file, line,
                "У <img> нет width/height — возможен сдвиг вёрстки (CLS) при загрузке.",
                cat="perf", fix="Укажите размеры или aspect-ratio.")
    for line, tag, d in p.inputs:
        if not (d.get("aria-label") or d.get("aria-labelledby") or d.get("id") and
                re.search(r'<label[^>]+for=["\']%s["\']' % re.escape(d["id"]), code, re.I)):
            add("HTML023", "warning", file, line,
                "Поле <%s> без подписи <label> — непонятно, что вводить." % tag,
                cat="a11y", fix="Добавьте <label for=\"...\"> или aria-label.")
    for line, d in p.iframes:
        if not d.get("title"):
            add("HTML024", "warning", file, line, "У <iframe> нет title.",
                cat="a11y", fix='Добавьте title="Описание фрейма".')
    for line, d in p.links:
        if d.get("target") == "_blank" and "noopener" not in d.get("rel", ""):
            add("HTML030", "warning", file, line,
                'target="_blank" без rel="noopener" — новая вкладка может управлять этой.',
                cat="security", fix='Добавьте rel="noopener noreferrer".')
        if d.get("href", "").strip().lower().startswith("javascript:"):
            add("HTML031", "error", file, line,
                "Ссылка javascript: — это дыра для XSS и она не работает при CSP.",
                cat="security", fix="Замените на кнопку с addEventListener.")
    for line, k, raw in p.inline_handlers:
        add("HTML032", "warning", file, line,
            "Встроенный обработчик %s — лучше навешивать слушатели из JS." % k,
            cat="security", why="Инлайн-обработчики блокируются Content Security Policy.",
            fix="Перенесите в element.addEventListener(...).")
    for line, tag in p.deprecated:
        add("HTML040", "warning", file, line,
            "Устаревший тег <%s> — его нет в HTML5." % tag,
            cat="correctness", fix="Замените на семантический тег + CSS.")
    prev = 0
    for line, h in p.headings:
        lvl = int(h[1])
        if prev and lvl > prev + 1:
            add("HTML041", "info", file, line,
                "Пропущен уровень заголовка: h%d сразу после h%d." % (lvl, prev),
                cat="a11y", fix="Соблюдайте порядок h1 → h2 → h3.")
        prev = lvl
    if not any(t in SEMANTIC_TAGS for t in p.tags) and p.tags.get("div", 0) > 3:
        add("HTML042", "info", file, 1,
            "Одни <div>: добавьте семантические теги <header>, <main>, <nav>, <footer>.",
            cat="a11y")
    for _, d in p.metas:
        pass
    # ARIA roles
    for m in re.finditer(r'role\s*=\s*["\']([^"\']+)["\']', code, re.I):
        roles = m.group(1).split()
        for r in roles:
            if r not in ARIA_ROLES:
                add("HTML025", "warning", file, line_of(code, m.start()),
                    'Неизвестная ARIA-роль "%s".' % r, cat="a11y",
                    fix="Проверьте список ролей WAI-ARIA.")
    # tabIndex > 0
    for m in re.finditer(r'tabindex\s*=\s*["\']([1-9]\d*)["\']', code, re.I):
        add("HTML026", "info", file, line_of(code, m.start()),
            "Положительный tabindex=%s ломает естественный порядок фокуса." % m.group(1),
            cat="a11y", fix="Используйте tabindex=\"0\" или уберите атрибут.")
    # mixed content / external scripts
    for m in re.finditer(r'(?:src|href)\s*=\s*["\'](http://[^"\']+)', code, re.I):
        add("HTML050", "warning", file, line_of(code, m.start()),
            "Ресурс по http:// — на https-странице он будет заблокирован (mixed content).",
            cat="security", fix="Замените на https://.")
    for line, d in p.external_scripts:
        if not (d.get("defer") or d.get("async") or d.get("type") == "module"):
            add("HTML051", "info", file, line,
                "Внешний скрипт без defer/async тормозит отрисовку страницы.",
                cat="perf", fix='Добавьте defer к <script src="...">.')
    # heading / structure summary
    info["html"] = {
        "tags": sum(p.tags.values()), "divs": p.tags.get("div", 0),
        "images": len(p.images), "buttons": p.buttons,
        "inputs": len(p.inputs), "forms": p.forms,
        "headings": len(p.headings), "links": len(p.links),
        "semantic": sum(p.tags.get(t, 0) for t in SEMANTIC_TAGS),
        "inline_styles": len(re.findall(r'\sstyle\s*=', code, re.I)),
    }
    info["ids"] = p.ids
    info["classes"] = p.classes
    info["tags_set"] = set(p.tags)
    info["inline"] = p.inline
    info["refs"] = p._all_refs
    info["headings"] = p.headings
    info["external_scripts"] = p.external_scripts
    # script in head without defer -> classic null bug
    head_end = code.lower().find("</head>")
    info["scripts_in_head"] = [(l, d) for l, d in p.external_scripts
                              if head_end > 0 and line_of(code, code.lower().find("<script", 0)) <= 0]
    return p


def _img_raw(code, line):
    lines = code.split("\n")
    if 0 < line <= len(lines):
        m = re.search(r"<img\b[^>]*>", lines[line - 1], re.I)
        if m:
            return m.group(0)
    return ""


def _add_img_alt(raw):
    if not raw:
        return raw
    if raw.endswith("/>"):
        return raw[:-2].rstrip() + ' alt="" />'
    if raw.endswith(">"):
        return raw[:-1].rstrip() + ' alt="">'
    return raw


# ---------------------------------------------------------------------------
# CSS analysis
# ---------------------------------------------------------------------------

def strip_css_comments(code):
    out, i, n = [], 0, len(code)
    while i < n:
        if code.startswith("/*", i):
            j = code.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append(re.sub(r"[^\n]", " ", code[i:j]))
            i = j
        else:
            out.append(code[i])
            i += 1
    return "".join(out)


def parse_css_rules(code):
    """Yield (selector, declarations_text, line, brace_depth_path)."""
    clean = strip_css_comments(code)
    rules, i, n, line = [], 0, len(code), 1
    sel, body, depth, sel_line = "", "", 0, 1
    quote = None
    while i < n:
        c = code[i]
        if c == "\n":
            line += 1
        if quote:
            if c == quote and (i == 0 or code[i - 1] != "\\"):
                quote = None
            if depth:
                body += c
            else:
                sel += c
            i += 1
            continue
        if c in "'\"":
            quote = c
            if depth:
                body += c
            else:
                sel += c
            i += 1
            continue
        if c == "{":
            if depth == 0:
                sel_line = line
                sel = sel.strip()
                body = ""
            else:
                body += c
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                rules.append((sel, body, sel_line))
                sel = ""
            elif depth > 0:
                body += c
            else:
                depth = 0
        else:
            if depth:
                body += c
            else:
                sel += c
        i += 1
    return rules, depth


def parse_declarations(body):
    out, buf, depth, quote, line = [], "", 0, None, 0
    for c in body:
        if c == "\n":
            line += 1
        if quote:
            buf += c
            if c == quote and not buf.endswith("\\" + quote):
                quote = None
            continue
        if c in "'\"":
            quote = c
            buf += c
            continue
        if c == "(":
            depth += 1
        elif c == ")":
            depth = max(0, depth - 1)
        if c == ";" and depth == 0:
            if buf.strip():
                out.append(buf.strip())
            buf = ""
        else:
            buf += c
    if buf.strip():
        out.append(buf.strip())
    res = []
    for decl in out:
        if ":" in decl:
            k, v = decl.split(":", 1)
            res.append((k.strip().lower(), v.strip()))
    return res


def color_to_rgb(value):
    v = (value or "").strip().lower()
    m = re.match(r"#([0-9a-f]{3,8})\b", v)
    if m:
        h = m.group(1)
        if len(h) in (3, 4):
            h = "".join(c * 2 for c in h[:3])
        if len(h) >= 6:
            return tuple(int(h[k:k + 2], 16) for k in (0, 2, 4))
    m = re.match(r"rgba?\(([^)]+)\)", v)
    if m:
        parts = [p.strip() for p in m.group(1).replace("/", " ").replace(",", " ").split()]
        try:
            return tuple(min(255, max(0, int(float(p)))) for p in parts[:3])
        except ValueError:
            return None
    m = re.match(r"hsla?\(\s*([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%", v)
    if m:
        h, s, l = float(m.group(1)) / 360, float(m.group(2)) / 100, float(m.group(3)) / 100
        def hue(p, q, t):
            if t < 0: t += 1
            if t > 1: t -= 1
            if t < 1 / 6: return p + (q - p) * 6 * t
            if t < 1 / 2: return q
            if t < 2 / 3: return p + (q - p) * (2 / 3 - t) * 6
            return p
        if s == 0:
            r = g = b = l
        else:
            q = l * (1 + s) if l < 0.5 else l + s - l * s
            p = 2 * l - q
            r, g, b = hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)
        return tuple(round(x * 255) for x in (r, g, b))
    return NAMED_COLORS.get(v.split()[0] if v else "")


def contrast_ratio(a, b):
    def lum(c):
        vals = []
        for x in c:
            x = x / 255
            vals.append(x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4)
        return 0.2126 * vals[0] + 0.7152 * vals[1] + 0.0722 * vals[2]
    try:
        l1, l2 = lum(a), lum(b)
        hi, lo = max(l1, l2), min(l1, l2)
        return round((hi + 0.05) / (lo + 0.05), 2)
    except Exception:
        return 21.0


def specificity(sel):
    ids = len(re.findall(r"#[\w-]+", sel))
    cls = len(re.findall(r"\.[\w-]+|\[[^\]]+\]|:[a-z-]+(?:\([^)]*\))?", sel))
    els = len(re.findall(r"(?:^|[\s>+~,(])([a-zA-Z][\w-]*)", sel))
    return (ids, cls, els)


def analyse_css(code, file, add, info, offset=0, inline=False):
    if not code.strip():
        return
    rules, unclosed = parse_css_rules(code)
    if unclosed > 0:
        add("CSS001", "error", file, max(1, len(code.split("\n")) + offset),
            "Не хватает %d закрывающей скобки } в CSS." % unclosed,
            cat="correctness",
            why="Браузер выбросит оставшиеся правила — стили применятся частично.",
            fix="Добавьте } в конце последнего правила.")
    if unclosed < 0:
        add("CSS002", "error", file, 1 + offset, "Лишняя закрывающая скобка } в CSS.",
            cat="correctness")
    seen_selectors, colors, selectors = {}, [], []
    important = imports = media = keyframes = 0
    animations = []
    cssvars = set()
    for sel, body, ln in rules:
        L = ln + offset
        s = re.sub(r"\s+", " ", sel).strip()
        if not s:
            continue
        if s.startswith("@import"):
            imports += 1
            m = re.search(r'url\(["\']?([^"\')]+)', s) or re.search(r'["\']([^"\']+)["\']', s)
            if m:
                info.setdefault("css_imports", []).append((file, L, m.group(1)))
            continue
        if s.startswith("@media"):
            media += 1
        if s.startswith("@keyframes") or s.startswith("-webkit-keyframes"):
            keyframes += 1
            animations.append(s.split()[-1])
        if s in seen_selectors:
            add("CSS010", "info", file, L,
                'Селектор "%s" уже встречался на строке %d.' % (s[:60], seen_selectors[s] + offset),
                cat="style", fix="Объедините правила в одно.")
        seen_selectors[s] = ln
        if s.startswith("@"):
            continue
        selectors.append((s, L, specificity(s)))
        decls = parse_declarations(body)
        if not decls:
            add("CSS011", "info", file, L, 'Пустое правило "%s" — его можно удалить.' % s[:60],
                cat="style")
        prev_props = set()
        color_val = bg_val = None
        for prop, val in decls:
            clean_prop = prop.replace("*", "").strip().lower()
            if clean_prop.startswith("--"):
                cssvars.add(clean_prop)
                continue
            if clean_prop.startswith("-") and clean_prop.lstrip("-") not in CSS_PROPERTIES:
                add("CSS012", "info", file, L,
                    'Вендорный префикс "%s" без обычного свойства — проверьте поддержку.' % clean_prop,
                    cat="style")
                continue
            if clean_prop not in CSS_PROPERTIES and not clean_prop.startswith("@"):
                add("CSS020", "warning", file, L,
                    'Неизвестное CSS-свойство "%s" — браузер его проигнорирует.' % clean_prop,
                    cat="correctness", fix="Проверьте написание свойства.")
            if clean_prop in prev_props:
                add("CSS013", "info", file, L,
                    'Свойство "%s" продублировано в одном правиле.' % clean_prop,
                    cat="style")
            prev_props.add(clean_prop)
            if "!important" in val:
                important += 1
                add("CSS030", "info", file, L,
                    '!important у "%s" — повышает приоритет и усложняет переопределение.' % clean_prop,
                    cat="style", fix="Попробуйте обойтись специфичностью селектора.")
            if clean_prop in LENGTHISH:
                m = re.search(r"(?<![\w.#-])(-?\d+(?:\.\d+)?)\s*(?:;|$|\s(?![a-z%]))", val)
                if m and float(m.group(1)) != 0 and not re.search(r"\d(px|rem|em|%|vw|vh|vmin|vmax|ch|ex|pt|cm|mm|fr|deg|s|ms)\b", val):
                    add("CSS021", "warning", file, L,
                        'У "%s: %s" число без единиц — свойство не сработает.' % (clean_prop, val[:30]),
                        cat="correctness", fix="Добавьте px (или rem/em/%).",
                        edit={"kind": "replace", "find": "%s: %s" % (prop, val),
                              "replace": "%s: %spx" % (prop, m.group(1))})
            if clean_prop in ("color", "background", "background-color", "border-color", "fill", "stroke"):
                cm = re.search(r"(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|\b[a-z]+\b)", val)
                if cm:
                    rgb = color_to_rgb(cm.group(0))
                    if rgb:
                        colors.append({"value": cm.group(0), "rgb": list(rgb), "file": file, "line": L})
                        if clean_prop == "color":
                            color_val = rgb
                        if clean_prop.startswith("background"):
                            bg_val = rgb
            if clean_prop in ("clip", "zoom", "ime-mode", "page-break-inside"):
                add("CSS040", "info", file, L,
                    'Устаревшее свойство "%s".' % clean_prop, cat="style",
                    fix="Используйте современный аналог (clip-path, break-inside).")
            if clean_prop == "transition" and re.search(r"\ball\b", val):
                add("CSS041", "info", file, L,
                    "transition: all анимирует всё подряд — это дорого для браузера.",
                    cat="perf", fix="Перечислите конкретные свойства.")
            if clean_prop in ("filter", "backdrop-filter", "clip-path") and not inline:
                pass
            if re.search(r"\b(oklch|lch|lab)\(", val):
                add("CSS042", "info", file, L,
                    "Современная цветовая функция — добавьте fallback для старых браузеров.",
                    cat="style")
            if clean_prop == "width" and re.search(r"\d+px", val):
                add("CSS043", "info", file, L,
                    "Ширина в px не масштабируется — подумайте о rem/% и max-width.",
                    cat="perf")
        if color_val and bg_val:
            ratio = contrast_ratio(color_val, bg_val)
            if ratio < 4.5:
                add("CSS050", "warning", file, L,
                    "Контраст текста и фона %.2f:1 — ниже нормы WCAG AA (4.5:1)." % ratio,
                    cat="a11y", fix="Сделайте текст темнее или фон светлее.",
                    why="Пользователям со слабым зрением будет тяжело прочитать текст.")
        if len(re.findall(r"[\s>+~]", s.strip())) > 4 and "*" not in s:
            add("CSS051", "info", file, L,
                "Слишком длинный селектор — медленно и хрупко.", cat="perf")
        if s.strip().startswith("*"):
            add("CSS052", "info", file, L, "Универсальный селектор * замедляет сопоставление.",
                cat="perf")
    if imports > 2:
        add("CSS060", "info", file, 1 + offset,
            "%d @import — каждый создаёт отдельный запрос и тормозит загрузку." % imports,
            cat="perf", fix="Объедините файлы или используйте <link>.")
    # unused selectors vs HTML
    ids = info.get("ids", {})
    classes = info.get("classes", set())
    tags_set = info.get("tags_set", set())
    unused = []
    for sel, L, spec in selectors:
        if sel.startswith(":"):
            continue
        tokens = re.findall(r"([.#]?[a-zA-Z][\w-]*)", sel)
        meaningful = [t for t in tokens if t and t not in
                      ("hover", "focus", "active", "before", "after", "nth-child",
                       "first-child", "last-child", "not", "root", "checked",
                       "disabled", "focus-visible", "placeholder", "nth-of-type")]
        refs = [t for t in meaningful if t.startswith(".") or t.startswith("#") or
                not t.startswith((".", "#"))]
        if refs and all((t[1:] in ids if t.startswith("#") else
                         t[1:] in classes if t.startswith(".") else
                         (t.lower() in tags_set or t.lower() in
                          {"body", "html", "*", "::selection"})) is False for t in refs):
            if len(unused) < 14:
                unused.append({"selector": sel[:70], "line": L, "file": file})
    for u in unused:
        add("CSS070", "info", u["file"], u["line"],
            'Селектор "%s" похоже ни к чему не применяется.' % u["selector"],
            cat="perf", fix="Удалите или проверьте опечатку.")
    for k, v in {"rules": 0, "decls": 0, "important": 0, "media": 0,
                 "keyframes": 0, "colors": [], "imports": 0,
                 "selectors": [], "vars": [], "animations": [], "layout": {}}.items():
        info["css"].setdefault(k, v)
    info["css"]["rules"] += len(rules)
    info["css"]["decls"] += sum(len(parse_declarations(b)) for _, b, _ in rules)
    info["css"]["important"] += important
    info["css"]["media"] += media
    info["css"]["keyframes"] += keyframes
    info["css"]["imports"] += imports
    info["css"]["colors"].extend(colors)
    info["css"]["selectors"].extend([{"selector": s, "line": L, "specificity": list(sp),
                                      "score": sp[0] * 100 + sp[1] * 10 + sp[2]}
                                     for s, L, sp in selectors])
    info["css"]["vars"] = sorted(cssvars)
    info["css"]["animations"] = animations
    info["css"]["layout"] = {
        "flex": len(re.findall(r"display\s*:\s*flex", code, re.I)),
        "grid": len(re.findall(r"display\s*:\s*grid", code, re.I)),
        "absolute": len(re.findall(r"position\s*:\s*absolute", code, re.I)),
        "animations": keyframes + len(re.findall(r"animation\s*:", code, re.I)),
    }


# ---------------------------------------------------------------------------
# JavaScript analysis
# ---------------------------------------------------------------------------

def analyse_js(code, file, add, info, offset=0, html_info=None):
    if not code.strip():
        return
    toks, masked = js_tokens(code)
    check_js_balance(toks, code, file, add, offset)
    lines = masked.split("\n")
    for k, v in {"functions": [], "events": [], "network": [], "timers": [],
                 "storage": [], "dom_writes": [], "selectors": [],
                 "imports": [], "globals_used": [], "loops": 0, "tries": 0,
                 "async_fns": 0, "complexity": 0, "lines": 0}.items():
        info["js"].setdefault(k, v)
    J = info["js"]
    J["lines"] += len(lines)

    # --- unquoted string / unterminated literal ---------------------------
    for t in toks:
        if t.type == "string":
            if len(t.value) < 2 or t.value[-1] != t.value[0]:
                add("JS004", "error", file, t.line + offset,
                    "Незакрытая строка — кавычка не имеет пары.",
                    cat="correctness", why="Будет SyntaxError: Invalid or unexpected token.",
                    fix="Закройте строку такой же кавычкой.")

    # --- declarations / undefined identifiers -----------------------------
    declared = set()
    for m in re.finditer(r"\b(?:let|const|var)\s+([A-Za-z_$][\w$]*)", masked):
        declared.add(m.group(1))
    for m in re.finditer(r"\bfunction\s+([A-Za-z_$][\w$]*)", masked):
        declared.add(m.group(1))
    for m in re.finditer(r"\bclass\s+([A-Za-z_$][\w$]*)", masked):
        declared.add(m.group(1))
    for m in re.finditer(r"\bimport\s+(.+?)\s+from", masked):
        for name in re.findall(r"[A-Za-z_$][\w$]*", m.group(1)):
            declared.add(name)
    for m in re.finditer(r"function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)", masked):
        for name in re.findall(r"[A-Za-z_$][\w$]*", m.group(1)):
            declared.add(name)
    for m in re.finditer(r"\(([^)]*)\)\s*=>", masked):
        for name in re.findall(r"[A-Za-z_$][\w$]*", m.group(1)):
            declared.add(name)
    for m in re.finditer(r"([A-Za-z_$][\w$]*)\s*=>", masked):
        declared.add(m.group(1))
    for m in re.finditer(r"\bcatch\s*\(\s*([A-Za-z_$][\w$]*)", masked):
        declared.add(m.group(1))
    # object destructuring in params
    for m in re.finditer(r"\{\s*([^}]{1,160})\}\s*(?:=>|\))", masked):
        for name in re.findall(r"[A-Za-z_$][\w$]*", m.group(1)):
            declared.add(name)

    used_unknown = {}
    for t in toks:
        if t.type != "ident" or t.value in JS_GLOBALS or t.value in declared:
            continue
        before = masked[max(0, t.start - 1):t.start]
        after = masked[t.end:t.end + 1]
        if before == "." or after == ":" and before.strip() in ("{", ","):
            continue
        if re.search(r"[A-Za-z_$][\w$]*$", masked[max(0, t.start - 30):t.start]) and before in " \t":
            pass
        # skip object literal keys and labels
        if re.match(r"\s*:", masked[t.end:t.end + 3]):
            continue
        # skip property shorthand in declarations (const x = ... handled above)
        if t.value in ("length", "prototype", "constructor", "name", "value",
                       "target", "result", "data", "message", "status"):
            continue
        used_unknown.setdefault(t.value, t.line + offset)
    for name, ln in list(used_unknown.items())[:10]:
        add("JS010", "warning", file, ln,
            'Переменная "%s" похоже не объявлена — при выполнении будет ReferenceError.' % name,
            cat="correctness",
            why="Скорее всего, опечатка или забыли let/const/import.",
            fix="Объявите переменную или проверьте написание.")

    # --- bracket/keyword level smells -------------------------------------
    for i, ln in enumerate(lines, 1):
        L = i + offset
        s = ln.strip()
        if not s:
            continue
        m = re.search(r"\bif\s*\(\s*[A-Za-z_$][\w$]*\s*=(?!=)[^=]", ln)
        if m:
            add("JS020", "error", file, L,
                "Присваивание в условии if (x = ...) — почти всегда опечатка, условие всегда истинно.",
                cat="correctness", fix="Используйте == или ===.",
                edit={"kind": "replace", "find": m.group(0).strip(),
                      "replace": m.group(0).strip().replace("=", "===", 1)})
        m2 = re.search(r"[^=!]==[^=]", ln)
        if m2 and not re.search(r"==\s*null", ln):
            frag = m2.group(0)
            add("JS021", "hint", file, L,
                "Нестрогое == — используйте ===, чтобы не было неожиданных преобразований.",
                cat="style", fix="Замените на ===",
                edit={"kind": "replace", "find": frag,
                      "replace": frag.replace("==", "===", 1)})
        if re.search(r"(?<![=!<>])!=(?!=)", ln) and not re.search(r"!=\s*null", ln):
            add("JS022", "hint", file, L, "Нестрогое != — лучше !==", cat="style")
        m = re.search(r"\bvar\s+([A-Za-z_$][\w$]*)", ln)
        if m:
            add("JS023", "hint", file, L,
                'var "%s" — лучше let/const (var всплывает и живёт в области функции).' % m.group(1),
                cat="style", fix="Замените var на let (или const, если значение не меняется).",
                edit={"kind": "replace", "find": m.group(0), "replace": m.group(0).replace("var", "let")})
        if re.search(r"\beval\s*\(", ln) or re.search(r"new\s+Function\s*\(", ln):
            add("JS030", "warning", file, L,
                "eval()/new Function выполняют строку как код — это XSS-риск.",
                cat="security", fix="Найдите способ без динамического кода.")
        if re.search(r"\bdocument\.write\s*\(", ln):
            add("JS031", "warning", file, L,
                "document.write затирает страницу, если вызван после загрузки.",
                cat="correctness", fix="Используйте textContent/appendChild.")
        m = re.search(r"\.innerHTML\s*=", ln)
        if m:
            add("JS032", "warning", file, L,
                "Присваивание innerHTML: если внутри есть пользовательские данные — XSS.",
                cat="security", fix="Используйте textContent или санитайзинг.")
            J["dom_writes"].append({"kind": "innerHTML", "line": L, "file": file})
        if re.search(r"\balert\s*\(|\bconfirm\s*\(|\bprompt\s*\(", ln):
            add("JS033", "hint", file, L,
                "alert/confirm блокируют поток; в Runlet они перехватываются и показываются тостом.",
                cat="style")
        if re.search(r"\bdebugger\b", ln):
            add("JS034", "hint", file, L, "Оставлен debugger — не забудьте убрать перед публикацией.",
                cat="style")
        if re.search(r"\bparseInt\s*\([^,)]*\)", ln):
            add("JS035", "hint", file, L, "parseInt без второго аргумента (radix=10).",
                cat="style", fix="Добавьте , 10.")
        if re.search(r"\bwhile\s*\(\s*true\s*\)", ln) and not re.search(r"\bbreak\b", masked):
            add("JS036", "warning", file, L,
                "while(true) без break — страница зависнет.", cat="perf")
        if re.search(r"for\s*\([^;]*;[^;]*<=\s*[\w.]+\.length\s*;", ln):
            add("JS037", "error", file, L,
                "Выход за границу массива: i <= arr.length даст undefined на последней итерации.",
                cat="correctness", fix="Используйте i < arr.length.",
                edit={"kind": "replace", "find": "<=", "replace": "<"})
        if re.search(r"setInterval\s*\(", ln) and "clearInterval" not in masked:
            add("JS038", "hint", file, L,
                "setInterval без clearInterval — таймер будет работать вечно.",
                cat="perf")
        if re.search(r"JSON\.parse\s*\(", ln) and "try" not in masked:
            add("JS039", "warning", file, L,
                "JSON.parse без try/catch — невалидный JSON уронит скрипт.",
                cat="correctness", fix="Оберните в try/catch.")
        if re.search(r"\bfetch\s*\(", ln) and not re.search(r"\.catch|try\s*\{|try\b", masked):
            add("JS040", "warning", file, L,
                "fetch без обработки ошибки — при обрыве сети будет необработанное исключение.",
                cat="correctness", fix="Добавьте .catch() или try/catch вокруг await.")
        if re.search(r"\bawait\b", ln) and not re.search(r"\basync\b", masked):
            add("JS041", "error", file, L,
                "await использован вне async-функции — будет SyntaxError.",
                cat="correctness", fix="Добавьте async к функции или используйте .then().")
        if re.search(r"^\s*return\b", ln) and not re.search(r"(function|=>|\{)", "\n".join(lines[:i - 1])[-400:]):
            add("JS042", "error", file, L,
                "return вне функции — так писать нельзя.", cat="correctness")
        if re.search(r"console\.log\s*\(", ln):
            add("JS050", "hint", file, L, "Отладочный console.log остался в коде.",
                cat="style", fix="Удалите перед релизом.")
        if re.search(r"\bTODO\b|\bFIXME\b", ln):
            add("JS051", "info", file, L, "В коде осталась заметка TODO/FIXME.", cat="style")

    # --- behaviour inventory ----------------------------------------------
    ids = info.get("ids", {})
    classes = info.get("classes", set())
    tags_set = info.get("tags_set", set())
    html_code = info.get("html_code", "")
    selector_re = re.compile(
        r"(?:querySelector(?:All)?|getElementById|getElementsByClassName|getElementsByTagName|closest|matches)\s*\(\s*(['\"`])([^'\"`\n]*)\1")

    def selector_exists(sel):
        sel = sel.strip()
        if not sel:
            return True
        if sel.startswith("#"):
            return sel[1:] in ids or ('id="%s"' % sel[1:]) in html_code
        if sel.startswith("."):
            return sel[1:].split()[0] in classes or ('class="%s"' % sel[1:]) in html_code
        if sel.startswith("["):
            return True
        first = re.match(r"^[a-zA-Z][\w-]*", sel)
        if first:
            return first.group(0).lower() in tags_set or ("<%s" % first.group(0)) in html_code
        return True

    for m in selector_re.finditer(masked):
        sel, ln = m.group(2), line_of(masked, m.start()) + offset
        J["selectors"].append({"selector": sel, "line": ln, "file": file,
                               "exists": selector_exists(sel)})
        if not selector_exists(sel):
            add("JS060", "error", file, ln,
                'Селектор "%s" не найден в HTML — скорее всего, будет ошибка «Cannot read properties of null».' % sel[:60],
                cat="correctness",
                why="querySelector вернёт null, а код сразу обратится к его свойствам/методам.",
                fix="Проверьте опечатку, добавьте элемент в HTML или проверку if (el).")
    # element handle without null check (only when the searched element is absent
    # -- otherwise it is just a defensive hint and would be pure noise)
    for m in re.finditer(r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.querySelector\s*\(\s*(['\"`])([^'\"`]*)\2", masked):
        name, sel = m.group(1), m.group(3)
        if selector_exists(sel):
            continue
        rest = masked[m.end():m.end() + 800]
        if re.search(r"\b%s\s*\.\s*(addEventListener|style|classList|textContent|innerHTML|value|append)" % re.escape(name), rest):
            add("JS061", "warning", file, line_of(masked, m.start()) + offset,
                'Переменная "%s" получает несуществующий элемент "%s" и сразу используется.' % (name, sel[:40]),
                cat="correctness",
                why="querySelector вернёт null, а первое же обращение к %s.xxx выбросит TypeError." % name,
                fix="Добавьте if (%s) { ... } или %s?.addEventListener(...)." % (name, name))

    for m in re.finditer(r"\.addEventListener\s*\(\s*(['\"`])(\w+)\1", masked):
        ev, ln = m.group(2), line_of(masked, m.start()) + offset
        prefix = masked[max(0, m.start() - 90):m.start()]
        target = "element"
        tm = re.search(r"([A-Za-z_$][\w$]*)\s*$", prefix)
        if tm and tm.group(1) not in ("document", "window"):
            target = tm.group(1)
        elif tm:
            target = tm.group(1)
        elif re.search(r"\bdocument\s*$", prefix):
            target = "document"
        elif re.search(r"\bwindow\s*$", prefix):
            target = "window"
        J["events"].append({"type": ev, "target": target, "line": ln, "file": file})
    for m in re.finditer(r"\bfetch\s*\(\s*(['\"`])([^'\"`]{1,180})\1", masked):
        J["network"].append({"url": m.group(2), "line": line_of(masked, m.start()) + offset,
                             "file": file, "method": "fetch"})
    for m in re.finditer(r"\.open\s*\(\s*['\"](\w+)['\"]\s*,\s*(['\"`])([^'\"`]+)\2", masked):
        J["network"].append({"url": m.group(3), "method": m.group(1),
                             "line": line_of(masked, m.start()) + offset, "file": file})
    for m in re.finditer(r"\b(setTimeout|setInterval)\s*\(", masked):
        J["timers"].append({"kind": m.group(1), "line": line_of(masked, m.start()) + offset,
                            "file": file})
    for m in re.finditer(r"\b(localStorage|sessionStorage)\.(getItem|setItem|removeItem)\s*\(\s*(['\"`])([^'\"`]*)\3", masked):
        J["storage"].append({"store": m.group(1), "key": m.group(4),
                             "line": line_of(masked, m.start()) + offset, "file": file})
    for kind in ("textContent", "classList", "appendChild", "append", "remove",
                 "setAttribute", "style", "createElement", "insertAdjacentHTML"):
        for m in re.finditer(r"\." + kind + r"\b", masked):
            J["dom_writes"].append({"kind": kind, "line": line_of(masked, m.start()) + offset,
                                    "file": file})
    for m in re.finditer(r"\bimport\s+(?:.+?from\s*)?(['\"`])([^'\"`]+)\1", masked):
        J["imports"].append({"path": m.group(2), "line": line_of(masked, m.start()) + offset,
                             "file": file})
    for m in re.finditer(r"\bimport\s*\(\s*(['\"`])([^'\"`]+)\1", masked):
        J["imports"].append({"path": m.group(2), "dynamic": True,
                             "line": line_of(masked, m.start()) + offset, "file": file})
    J["loops"] += len(re.findall(r"\b(for|while|forEach|map|reduce|filter)\s*\(", masked))
    J["complexity"] += 1 + len(re.findall(r"\b(if|for|while|case|catch)\b|&&|\|\||\?", masked))
    J["tries"] += len(re.findall(r"\btry\s*\{", masked))
    J["async_fns"] += len(re.findall(r"\basync\s+(?:function|\(|[A-Za-z_$][\w$]*\s*=>)", masked))

    # --- functions & complexity -------------------------------------------
    fn_re = re.compile(r"(?:(?P<doc>/\*\*[\s\S]*?\*/)\s*)?(?:async\s+)?function\s*\*?\s*"
                       r"(?P<name>[A-Za-z_$][\w$]*)?\s*\((?P<params>[^)]*)\)"
                       r"|(?:(?P<var>const|let|var)\s+(?P<vname>[A-Za-z_$][\w$]*)\s*=\s*"
                       r"(?:async\s*)?\((?P<vparams>[^)]*)\)\s*=>)")
    for m in fn_re.finditer(masked):
        name = m.group("name") or m.group("vname") or "anonymous"
        params = [p.strip() for p in (m.group("params") or m.group("vparams") or "").split(",") if p.strip()]
        ln = line_of(masked, m.start()) + offset
        start = m.end()
        # rough body: until matching brace (or 40 lines for arrows)
        depth, j = 0, start
        while j < len(masked) and j < start + 6000:
            ch = masked[j]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        body = masked[start:j]
        complexity = 1 + len(re.findall(r"\b(if|for|while|case|catch)\b|&&|\|\||\?", body))
        J["complexity"] += complexity
        doc = (m.group("doc") or "").strip()
        info["functions"].append({
            "name": name, "line": ln, "file": file, "params": params[:12],
            "complexity": complexity, "async": "async" in masked[max(0, m.start() - 12):m.start()],
            "jsdoc": bool(doc), "length": max(1, body.count("\n")),
        })
        if complexity > 12:
            add("JS070", "warning", file, ln,
                'Функция "%s" слишком сложная (цикломатическая сложность %d).' % (name, complexity),
                cat="style", fix="Разбейте на несколько маленьких функций.")
        if not doc and body.count("\n") > 12:
            add("JS071", "info", file, ln,
                'У функции "%s" нет JSDoc-описания.' % name, cat="style",
                fix="Добавьте комментарий /** что делает, параметры, результат */.")

    # --- duplicate declarations -------------------------------------------
    decl_positions = {}
    for m in re.finditer(r"\b(?:let|const|class)\s+([A-Za-z_$][\w$]*)", masked):
        name = m.group(1)
        if name in decl_positions:
            add("JS080", "error", file, line_of(masked, m.start()) + offset,
                'Повторное объявление "%s" (первый раз на строке %d).' % (name, decl_positions[name]),
                cat="correctness", why="Будет SyntaxError: Identifier has already been declared.")
        decl_positions[name] = line_of(masked, m.start()) + offset

    # --- script tag placement vs DOM queries --------------------------------
    if html_info:
        html_code_l = html_code.lower()
        head_end = html_code_l.find("</head>")
        if head_end > 0 and J["selectors"]:
            first_script = html_code_l.find("<script")
            if 0 <= first_script < head_end and "defer" not in html_code[first_script:html_code_l.find(">", first_script) + 1]:
                add("JS090", "error", file, 1 + offset,
                    "Скрипт подключён в <head> без defer: во время выполнения элементы ещё не существуют.",
                    cat="correctness",
                    why="Классическая причина «Cannot read properties of null» — DOM ещё не построен.",
                    fix="Перенесите <script> перед </body> или добавьте defer / DOMContentLoaded.")


# ---------------------------------------------------------------------------
# Cross-file link graph
# ---------------------------------------------------------------------------

def norm_path(base, ref):
    ref = ref.split("#")[0].split("?")[0].strip()
    if not ref or "://" in ref or ref.startswith(("data:", "blob:", "mailto:",
                                                  "javascript:", "//", "#")):
        return None
    if ref.startswith("/"):
        return ref.lstrip("/")
    parts = [p for p in (os.path.dirname(base) + "/" + ref).split("/") if p not in ("", ".")]
    stack = []
    for p in parts:
        if p == "..":
            if stack:
                stack.pop()
        else:
            stack.append(p)
    return "/".join(stack)


def build_links(files, info, add):
    keys = set(files.keys())
    aliases = set()
    for k in keys:
        aliases.add(k)
        aliases.add(k.lstrip("/"))
    links = []
    def add_link(file, line, ref, kind):
        target = norm_path(file, ref)
        if target is None:
            links.append({"from": file, "line": line, "to": ref, "kind": kind, "ok": True,
                          "external": True})
            return
        ok = any(a == target or a.endswith("/" + target) for a in aliases)
        links.append({"from": file, "line": line, "to": target, "kind": kind,
                      "ok": ok, "external": False})
        if not ok:
            add("LNK001", "error", file, line,
                'Битая ссылка: файл "%s" не найден в проекте.' % ref[:90],
                cat="correctness",
                why="Браузер получит 404 — стиль/скрипт/картинка не загрузятся.",
                fix="Загрузите файл в проект или исправьте путь.")
    for file, code in files.items():
        if not file.lower().endswith(TEXT_EXT):
            continue
        for line, key, ref in info.get("_refs", {}).get(file, []):
            for part in re.split(r",|\s+(?=\d)", ref)[:1] if key == "srcset" else [ref]:
                add_link(file, line, part.strip(), key)
        for m in re.finditer(r"@import\s+(?:url\()?\s*['\"]([^'\"]+)['\"]", code):
            add_link(file, line_of(code, m.start()), m.group(1), "@import")
        for m in re.finditer(r"\bimport\s+(?:.+?from\s*)?['\"]([^'\"]+)['\"]", code):
            p = m.group(1)
            if p.startswith(("http", "npm:", "esm.sh", "@")):
                continue
            add_link(file, line_of(code, m.start()), p, "import")
        for m in re.finditer(r"\burl\(\s*['\"]?([^'\")]+)", code):
            p = m.group(1)
            if not p.startswith(("data:", "http", "#")):
                add_link(file, line_of(code, m.start()), p, "url()")
        for m in re.finditer(r"\bfetch\s*\(\s*['\"]([^'\"]+)['\"]", code):
            p = m.group(1)
            looks_like_api = (p.startswith(("/api/", "api/", "/v1/", "https://", "http://")) or
                              re.search(r"\.(php|asp|aspx|cgi|do)$", p))
            if not p.startswith(("http", "data:")) and not looks_like_api:
                add_link(file, line_of(code, m.start()), p, "fetch")
    info["links"] = links


# ---------------------------------------------------------------------------
# Narrative, scoring, markdown
# ---------------------------------------------------------------------------

def build_narrative(files, info, diags, grades):
    J = info.get("js", {})
    C = info.get("css", {})
    H = info.get("html", {})
    title = info.get("title", "").strip()
    headings = info.get("headings", [])
    h1 = ""
    m = re.search(r"<h1[^>]*>(.*?)</h1>", info.get("html_code", ""), re.I | re.S)
    if m:
        h1 = re.sub(r"<[^>]+>", "", m.group(1)).strip()[:70]
    subject = title or h1 or "Без названия"
    events = J.get("events", [])
    net = J.get("network", [])
    writes = J.get("dom_writes", [])
    timers = J.get("timers", [])
    store = J.get("storage", [])
    sels = J.get("selectors", [])
    errors = [d for d in diags if d["sev"] == "error"]
    warns = [d for d in diags if d["sev"] == "warning"]

    kind = "статичная страница"
    if events or writes:
        kind = "интерактивная страница с JavaScript"
    if net:
        kind = "страница, которая обменивается данными с сервером"
    if info.get("functions"):
        kind += " и собственной логикой"
    headline = '«%s» — %s' % (subject[:70], kind)

    parts = []
    hsum = []
    if H.get("tags"):
        hsum.append("%d HTML-тегов" % H["tags"])
    if H.get("headings"):
        hsum.append("%d заголовков" % H["headings"])
    if H.get("buttons"):
        hsum.append("%d кнопок" % H["buttons"])
    if H.get("inputs"):
        hsum.append("%d полей ввода" % H["inputs"])
    if H.get("images"):
        hsum.append("%d картинок" % H["images"])
    if H.get("forms"):
        hsum.append("%d форм" % H["forms"])
    if hsum:
        parts.append("В разметке: " + ", ".join(hsum) + ".")
    else:
        parts.append("Разметка практически пустая.")

    cbits = []
    if C.get("rules"):
        cbits.append("%d CSS-правил" % C["rules"])
    lay = C.get("layout", {})
    if lay.get("flex"):
        cbits.append("flex-раскладка")
    if lay.get("grid"):
        cbits.append("CSS Grid")
    if C.get("keyframes") or lay.get("animations"):
        cbits.append("анимации")
    if C.get("media"):
        cbits.append("адаптивные @media")
    if C.get("colors"):
        cbits.append("%d цветов" % len(C["colors"]))
    if cbits:
        parts.append("Стили задают " + ", ".join(cbits) + ".")
    else:
        parts.append("CSS пока почти не используется.")

    fns = info.get("functions", [])
    if fns:
        parts.append("В JS объявлено %d функций (%s)." %
                     (len(fns), ", ".join(f["name"] for f in fns[:5])))
    if J.get("lines"):
        parts.append("Скрипт занимает %d строк, цикломатическая сложность ~%d." %
                     (J["lines"], J.get("complexity", 0)))
    description = " ".join(parts)

    steps = []
    steps.append({
        "icon": "load",
        "text": "Браузер прочитает %s, построит DOM и применит %d CSS-правил."
                % (info.get("entry", "index.html"), C.get("rules", 0)),
        "confidence": "точно",
    })
    if J.get("selectors"):
        found = [s["selector"] for s in sels if s.get("exists")][:4]
        missing = [s["selector"] for s in sels if not s.get("exists")][:3]
        txt = "При выполнении скрипт попытается найти элементы: %s." % (", ".join("`%s`" % x for x in found) or "—")
        if missing:
            txt += " Но %s в разметке нет — здесь, скорее всего, и произойдёт ошибка." % ", ".join("`%s`" % x for x in missing)
        steps.append({"icon": "search", "text": txt, "confidence": "скорее всего"})
    if events:
        uniq = []
        for e in events:
            key = (e["type"], e["target"])
            if key not in uniq:
                uniq.append(key)
        steps.append({
            "icon": "click",
            "text": "Будут повешены обработчики: %s. Сами действия выполнятся, когда пользователь совершит эти события."
                    % ", ".join('%s на `%s`' % (t, g) for t, g in uniq[:6]),
            "confidence": "точно",
        })
    if writes:
        kinds = sorted(set(w["kind"] for w in writes))[:8]
        steps.append({"icon": "edit",
                      "text": "Скрипт будет менять страницу (%s): текст, классы и стили элементов могут обновляться прямо во время работы."
                              % ", ".join(kinds), "confidence": "скорее всего"})
    if net:
        steps.append({"icon": "net",
                      "text": "Будут сетевые запросы: %s. Если сервер не ответит, без обработки ошибки скрипт упадёт."
                              % ", ".join("`%s`" % n["url"][:50] for n in net[:4]),
                      "confidence": "скорее всего"})
    if timers:
        steps.append({"icon": "time",
                      "text": "Запустится %d таймер(ов) — часть кода выполнится позже, а не сразу при загрузке."
                              % len(timers), "confidence": "точно"})
    if store:
        steps.append({"icon": "db",
                      "text": "Данные будут сохраняться в %s (ключи: %s) и останутся после перезагрузки страницы."
                              % (", ".join(sorted(set(s["store"] for s in store))),
                                 ", ".join(sorted(set(s["key"] for s in store))[:5])),
                      "confidence": "точно"})
    if not events and not writes and not net:
        steps.append({"icon": "info",
                      "text": "Похоже, скрипт ничего не меняет на странице: он либо только считает что-то, либо пока пуст.",
                      "confidence": "возможно"})
    if errors:
        steps.append({"icon": "error",
                      "text": "Внимание: найдено %d ошибок. Наиболее вероятная поломка — %s"
                              % (len(errors), errors[0]["msg"]),
                      "confidence": "почти наверняка"})
    elif warns:
        steps.append({"icon": "warn",
                      "text": "Серьёзных ошибок не видно, но есть %d предупреждений (в основном качество и доступность)." % len(warns),
                      "confidence": "возможно"})
    else:
        steps.append({"icon": "ok", "text": "Явных проблем не найдено — код, скорее всего, запустится с первого раза.",
                      "confidence": "возможно"})

    beginner = []
    beginner.append("Простыми словами: эта страница — как конструктор. HTML — это кирпичи (заголовки, кнопки, картинки), CSS — краска и расположение, а JavaScript — инструкции, что делать при нажатии.")
    if events:
        beginner.append('Когда человек нажимает на элемент, срабатывает «слушатель» addEventListener — это как кнопка звонка: пока не нажмёшь, код внутри не работает.')
    if net:
        beginner.append("fetch — это как сходить на кухню за данными: результат приходит не сразу, поэтому код должен уметь ждать (await).")
    if errors:
        beginner.append("Главная опасность: программа попытается взять то, чего нет (null). Представь, что ты тянешься за чашкой, а её нет на столе — рука хватает воздух. Так и здесь: нужно сначала проверить, что элемент нашёлся.")
    beginner.append("Совет: открой консоль (вкладка «Консоль» справа) — там видно всё, что выводит console.log, и все ошибки с номерами строк.")

    return {
        "headline": headline, "description": description, "steps": steps,
        "beginner": beginner, "kind": kind,
        "verdict": ("Код, скорее всего, упадёт при запуске" if errors else
                    "Код, скорее всего, работает, но есть замечания" if warns else
                    "Код выглядит рабочим"),
        "verdict_level": "error" if errors else "warn" if warns else "ok",
    }


def compute_score(diags, info):
    by_cat = {"correctness": 100, "a11y": 100, "seo": 100, "perf": 100,
              "security": 100, "style": 100}
    penalties = {"error": 9, "warning": 4, "info": 1.2, "hint": 0.4}
    for d in diags:
        c = d.get("cat", "correctness")
        by_cat[c] = by_cat.get(c, 100) - penalties.get(d["sev"], 0)
        # errors hurt correctness regardless of category
        if d["sev"] == "error" and c != "correctness":
            by_cat["correctness"] -= 5
    for k in by_cat:
        by_cat[k] = max(0, min(100, round(by_cat[k])))
    overall = round(by_cat["correctness"] * 0.40 + by_cat["a11y"] * 0.15 +
                    by_cat["seo"] * 0.10 + by_cat["perf"] * 0.10 +
                    by_cat["security"] * 0.15 + by_cat["style"] * 0.10)
    return max(0, min(100, overall)), by_cat


def markdown_report(job, report):
    s, g, n = report["summary"], report["grades"], report["metrics"]
    out = ["# Отчёт Runlet — анализ кода", "",
           "**Оценка:** %d/100 · **%s**" % (report["score"], s["verdict"]), "",
           "## Что делает этот код", "", "### %s" % s["headline"], "",
           s["description"], ""]
    out += ["### Что произойдёт при запуске", ""]
    for i, st in enumerate(s["steps"], 1):
        out.append("%d. (%s) %s" % (i, st["confidence"], st["text"]))
    out += ["", "## Найденные ошибки и замечания", ""]
    if not report["diagnostics"]:
        out.append("Замечаний нет. ✨")
    for d in report["diagnostics"]:
        icon = {"error": "🔴", "warning": "🟠", "info": "🔵", "hint": "⚪"}.get(d["sev"], "•")
        out.append("- %s **%s** — `%s:%d` — %s" % (icon, d["sev"].upper(), d["file"], d["line"], d["msg"]))
        if d["fix"]:
            out.append("  - 💡 %s" % d["fix"])
    out += ["", "## Оценки", "",
            "| Категория | Балл |", "| --- | --- |"]
    for k, v in g.items():
        out.append("| %s | %d |" % (k, v))
    out += ["", "## Метрики", "", "```json",
            json.dumps(n, ensure_ascii=False, indent=2), "```", "",
            "## Объяснение для новичка", ""]
    out += ["- " + b for b in s["beginner"]]
    out += ["", "---", "Сгенерировано движком %s за %d мс." %
            (report["engine"], report["elapsed_ms"])]
    return "\n".join(out)


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------

def analyse(job):
    t0 = time.time()
    files = job.get("files") or {}
    files = {k: v for k, v in files.items()
             if isinstance(v, str) and k.lower().endswith(TEXT_EXT)}
    add = Collector()
    info = {"functions": [], "inline": [], "css": {}, "js": {}, "html": {},
            "links": [], "_refs": {}, "ids": {}, "classes": set(),
            "tags_set": set(), "headings": [], "css_imports": []}

    html_files = [f for f in files if f.lower().endswith((".html", ".htm"))]
    entry = job.get("entry") or ("index.html" if "index.html" in files else
                                 (html_files[0] if html_files else None))
    info["entry"] = entry or "index.html"
    main_html = files.get(entry, "") if entry else ""
    info["html_code"] = main_html

    # HTML first (collects ids/classes/tags for cross-referencing)
    for f in html_files:
        p = analyse_html(files[f], f, add, info, files) if f == entry else _scan_html_side(files[f], f, add, info)
        if f == entry:
            info["_refs"][f] = p._all_refs
    if not html_files:
        add("HTML000", "info", info["entry"], 1,
            "В проекте нет HTML-файла — нечего показывать в предпросмотре.", cat="correctness")

    # inline <style> / <script> from the entry document
    for blk in info.get("inline", []):
        f = entry
        off = max(0, blk["line"] - 1)
        if blk["tag"] == "style":
            analyse_css(blk["code"], f, add, info, offset=off, inline=True)
        else:
            analyse_js(blk["code"], f, add, info, offset=off, html_info=main_html)

    # standalone CSS / JS / TS
    for f, code in files.items():
        low = f.lower()
        if low.endswith((".css", ".scss", ".less")):
            analyse_css(code, f, add, info)
        elif low.endswith((".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx", ".vue")):
            analyse_js(code, f, add, info, html_info=main_html)
        elif low.endswith(".json"):
            try:
                json.loads(code)
            except Exception as e:
                add("JSON001", "error", f, 1, "Невалидный JSON: %s" % e,
                    cat="correctness", fix="Проверьте запятые и кавычки.")

    build_links(files, info, add)

    diags = sorted(add.items, key=lambda d: (
        {"error": 0, "warning": 1, "info": 2, "hint": 3}.get(d["sev"], 4),
        d["file"], d["line"]))
    score, grades = compute_score(diags, info)
    summary = build_narrative(files, info, diags, grades)
    J, C, H = info.get("js", {}), info.get("css", {}), info.get("html", {})
    metrics = {
        "files": len(files),
        "lines": sum(c.count("\n") + 1 for c in files.values()),
        "bytes": sum(len(c.encode("utf-8")) for c in files.values()),
        "html": H, "css": {k: v for k, v in C.items() if k not in ("colors", "selectors")},
        "js": {k: (len(v) if isinstance(v, list) else v) for k, v in J.items()},
        "functions": len(info["functions"]),
        "diagnostics": {s: sum(1 for d in diags if d["sev"] == s)
                        for s in ("error", "warning", "info", "hint")},
        "broken_links": sum(1 for l in info["links"] if not l["ok"]),
        "unused_selectors": sum(1 for d in diags if d["id"] == "CSS070"),
    }
    behavior = {
        "events": J.get("events", []), "network": J.get("network", []),
        "timers": J.get("timers", []), "storage": J.get("storage", []),
        "dom_writes": J.get("dom_writes", [])[:60],
        "selectors": J.get("selectors", []), "imports": J.get("imports", []),
        "colors": C.get("colors", [])[:40],
        "animations": C.get("animations", []),
        "layout": C.get("layout", {}),
    }
    report = {
        "ok": True, "engine": "runlet-python/1.0",
        "elapsed_ms": round((time.time() - t0) * 1000, 1),
        "score": score, "grades": grades, "summary": summary,
        "behavior": behavior, "diagnostics": diags, "metrics": metrics,
        "functions": info["functions"], "links": info["links"],
        "colors": C.get("colors", [])[:40],
        "selectors": C.get("selectors", [])[:80],
        "glossary": [{"term": t, "meaning": m} for t, m in GLOSSARY],
        "entry": info["entry"],
    }
    report["markdown"] = markdown_report(job, report)
    return report


def _scan_html_side(code, file, add, info):
    """Lightweight scan of additional HTML files (no duplicate global checks)."""
    p = HTMLScan(code, file, Collector())
    try:
        p.feed(code)
        p.close()
    except Exception:
        pass
    for k, v in p.ids.items():
        info["ids"].setdefault(k, v)
    info["classes"] |= p.classes
    info["tags_set"] |= set(p.tags)
    info["_refs"][file] = p._all_refs
    return p


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

DEMO = {
    "index.html": """<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Счётчик кликов</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main class="card">
    <h1>Привет, Runlet!</h1>
    <p>Нажми на кнопку и посмотри, что будет.</p>
    <img src="logo.png">
    <button id="btn" onclick="hello()">Нажми меня</button>
    <div id="output"></div>
  </main>
  <script src="script.js"></script>
</body>
</html>""",
    "style.css": """body { margin: 0; font-family: sans-serif; background: #f4f4f5; color: #333; }
.card { max-width: 420px; margin: 40px auto; padding: 24px; border-radius: 18px;
  background: white; box-shadow: 0 10px 30px #0002; transition: all .3s; }
#btn { background: #6c5ce7; color: #fff; border: 0; padding: 12; cursor: pointer; }
#missing { color: red; }
""",
    "script.js": """const btn = document.querySelector('#btn');
const output = document.querySelector('#output');
let count = 0;

btn.addEventListener('click', () => {
  count++;
  output.innerHTML = 'Кликов: ' + count;
  console.log('click', count);
});

document.querySelector('#missing').textContent = 'привет';

fetch('/api/data.json').then(r => r.json()).then(console.log);
""",
}


def main():
    argv = sys.argv[1:]
    if "--selftest" in argv:
        r = analyse({"files": DEMO, "entry": "index.html"})
        print(json.dumps(r, ensure_ascii=False, indent=2))
        return
    if "--server" in argv:
        sys.stderr.write("runlet-engine ready\n")
        sys.stderr.flush()
        for raw in sys.stdin:
            raw = raw.strip()
            if not raw:
                continue
            try:
                job = json.loads(raw)
                rep = analyse(job)
            except Exception as e:  # keep the server alive
                rep = {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
            sys.stdout.write(json.dumps(rep, ensure_ascii=False) + "\n")
            sys.stdout.flush()
        return
    raw = sys.stdin.read()
    try:
        job = json.loads(raw or "{}")
        rep = analyse(job)
    except Exception as e:
        import traceback
        rep = {"ok": False, "error": str(e), "traceback": traceback.format_exc()}
    print(json.dumps(rep, ensure_ascii=False))


if __name__ == "__main__":
    main()
