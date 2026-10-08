// Visionneuse XML en lecture seule, bâtie sur CodeMirror 6.
// Exposée en global : window.XmlViewer.create(parent, options)
import { EditorState } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, highlightSpecialChars, Decoration, ViewPlugin,
} from "@codemirror/view";
import { xmlLanguage } from "@codemirror/lang-xml";
import {
  syntaxHighlighting, foldGutter, codeFolding, foldKeymap, foldEffect, unfoldEffect,
  foldedRanges, ensureSyntaxTree, syntaxTree,
} from "@codemirror/language";
import { search, searchKeymap, openSearchPanel, highlightSelectionMatches } from "@codemirror/search";
import { standardKeymap } from "@codemirror/commands";
import { classHighlighter } from "@lezer/highlight";

const PHRASES = {
  "Find": "Rechercher",
  "next": "suivant",
  "previous": "précédent",
  "all": "tout",
  "match case": "casse",
  "by word": "mot entier",
  "regexp": "regex",
  "close": "fermer",
  "current match": "occurrence courante",
  "on line": "à la ligne",
  "Folded lines": "Lignes repliées",
  "Unfolded lines": "Lignes dépliées",
  "Fold line": "Replier",
  "Unfold line": "Déplier",
  "to": "à",
  "folded code": "contenu replié",
  "unfold": "déplier",
};

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", color: "var(--xml-text)", backgroundColor: "var(--surface)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.5" },
  ".cm-content": { caretColor: "var(--accent)", padding: "6px 0" },
  ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  ".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--muted)", border: "none", borderRight: "1px solid var(--line)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 14px", minWidth: "44px" },
  ".cm-foldGutter .cm-gutterElement": { padding: "0 4px", cursor: "pointer", color: "var(--muted)" },
  ".cm-foldGutter .cm-gutterElement:hover": { color: "var(--accent)" },
  ".cm-activeLine": { backgroundColor: "var(--row-hover)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--row-hover)", color: "var(--ink)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "var(--sel-bg)" },
  ".cm-selectionMatch": { backgroundColor: "var(--match-soft)" },
  ".cm-searchMatch": { backgroundColor: "var(--match)", outline: "1px solid var(--match-line)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--match-strong)" },
  ".cm-tagmatch": { backgroundColor: "var(--tagmatch)", borderRadius: "2px" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--bg)", border: "1px solid var(--line)", color: "var(--ink)",
    borderRadius: "3px", padding: "0 8px", margin: "0 3px", cursor: "pointer", whiteSpace: "pre",
  },
  ".cm-foldPlaceholder:hover": { borderColor: "var(--accent)" },
  ".cm-panels": { backgroundColor: "var(--bg)", color: "var(--ink)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--line)" },
  ".cm-search": { padding: "6px 10px", fontFamily: "var(--sans)", fontSize: "13px" },
  ".cm-search label": { fontSize: "13px", marginRight: "6px" },
  ".cm-textfield": {
    backgroundColor: "var(--surface)", color: "var(--ink)", border: "1px solid var(--line)",
    borderRadius: "3px", fontSize: "13px", padding: "3px 6px", minWidth: "22em",
  },
  ".cm-button": {
    backgroundImage: "none", backgroundColor: "var(--surface)", color: "var(--ink)",
    border: "1px solid var(--line)", borderRadius: "3px", fontSize: "13px", padding: "3px 8px",
  },
  ".cm-search button[name=close]": { color: "var(--muted)", fontSize: "18px", cursor: "pointer" },
  ".tok-typeName": { color: "var(--xml-tag)" },
  ".tok-punctuation": { color: "var(--xml-punct)" },
  ".tok-propertyName": { color: "var(--xml-attr)" },
  ".tok-string": { color: "var(--xml-string)" },
  ".tok-comment": { color: "var(--muted)", fontStyle: "italic" },
  ".tok-meta": { color: "var(--muted)" },
});

// Surligne la balise ouvrante et la balise fermante de l'élément sous le curseur.
const tagMark = Decoration.mark({ class: "cm-tagmatch" });
function tagMatchDeco(view) {
  const { state } = view;
  const pos = state.selection.main.head;
  const tree = syntaxTree(state);
  for (const side of [-1, 1]) {
    for (let c = tree.resolveInner(pos, side); c; c = c.parent) {
      if (c.name === "Element") break;
      if (c.name === "OpenTag" || c.name === "CloseTag") {
        const el = c.parent;
        if (!el || el.name !== "Element") break;
        const o = el.firstChild, cl = el.lastChild;
        if (o && cl && o.name === "OpenTag" && cl.name === "CloseTag") {
          return Decoration.set([tagMark.range(o.from, o.to), tagMark.range(cl.from, cl.to)]);
        }
        break;
      }
    }
  }
  return Decoration.none;
}
const tagMatch = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = tagMatchDeco(view); }
  update(u) { if (u.selectionSet || u.docChanged) this.decorations = tagMatchDeco(u.view); }
}, { decorations: (v) => v.decorations });

function elementName(state, el) {
  const open = el.firstChild;
  const tn = open && open.getChild("TagName");
  return tn ? state.sliceDoc(tn.from, tn.to) : null;
}

function pathAt(state, pos) {
  const names = [];
  for (let n = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (n.name === "Element") {
      const name = elementName(state, n);
      if (name) names.push(name);
    }
  }
  return names.reverse();
}

// Plage repliable d'un élément : entre la fin de la balise ouvrante et le début de la fermante.
function foldRangeOf(state, el) {
  const o = el.firstChild, c = el.lastChild;
  if (!o || !c || o.name !== "OpenTag" || c.name !== "CloseTag") return null;
  if (state.doc.lineAt(o.to).number >= state.doc.lineAt(c.from).number) return null;
  return { from: o.to, to: c.from };
}

function create(parent, options = {}) {
  let previewTags = [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const folding = codeFolding({
    preparePlaceholder(state, range) {
      if (previewTags.length && range.to - range.from <= 6000) {
        const s = state.sliceDoc(range.from, range.to);
        const parts = [];
        for (const t of previewTags) {
          const m = s.match(new RegExp("<" + esc(t) + ">\\s*([^<]*?)\\s*</" + esc(t) + ">"));
          if (m && m[1]) parts.push(m[1]);
        }
        if (parts.length) return parts.join("   ");
      }
      const n = state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number - 1;
      return n + (n > 1 ? " lignes" : " ligne");
    },
    placeholderDOM(view, onclick, prepared) {
      const el = document.createElement("span");
      el.className = "cm-foldPlaceholder";
      el.textContent = prepared;
      el.title = "Déplier";
      el.onclick = onclick;
      return el;
    },
  });

  const extensions = [
    EditorState.readOnly.of(true),
    EditorState.phrases.of(PHRASES),
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    drawSelection(),
    highlightActiveLine(),
    xmlLanguage,
    syntaxHighlighting(classHighlighter),
    folding,
    foldGutter({ openText: "▾", closedText: "▸" }),
    search({ top: true }),
    highlightSelectionMatches(),
    tagMatch,
    theme,
    keymap.of([
      ...searchKeymap,
      ...foldKeymap,
      ...standardKeymap,
      { key: "Escape", run: () => { if (options.onClose) options.onClose(); return true; } },
    ]),
    EditorView.updateListener.of((u) => {
      if (!options.onCursor) return;
      if (u.selectionSet || u.docChanged) report(u.state);
    }),
  ];

  function report(state) {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    options.onCursor({
      line: line.number,
      col: head - line.from + 1,
      lines: state.doc.lines,
      path: pathAt(state, head),
    });
  }

  const view = new EditorView({ parent, state: EditorState.create({ doc: "", extensions }) });

  function fullTree() {
    const s = view.state;
    return ensureSyntaxTree(s, s.doc.length, 15000) || syntaxTree(s);
  }

  function unfoldEffects() {
    const eff = [];
    foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
      eff.push(unfoldEffect.of({ from, to }));
    });
    return eff;
  }

  // Replie les éléments retenus par `pick(nom, profondeur)`, sans descendre dedans.
  function foldWhere(pick) {
    const state = view.state;
    const effects = unfoldEffects();
    let depth = 0;
    fullTree().iterate({
      enter(n) {
        if (n.name !== "Element") return;
        depth++;
        const el = n.node;
        if (pick(elementName(state, el), depth)) {
          const r = foldRangeOf(state, el);
          if (r) effects.push(foldEffect.of(r));
          depth--;
          return false;
        }
      },
      leave(n) { if (n.name === "Element") depth--; },
    });
    view.dispatch({ effects });
    return effects.length;
  }

  return {
    view,
    open(text, opts = {}) {
      previewTags = opts.previewTags || [];
      view.setState(EditorState.create({ doc: text, extensions }));
      view.scrollDOM.scrollTop = 0;
      fullTree();
      if (opts.foldNames && opts.foldNames.length) this.foldNames(opts.foldNames);
      if (options.onCursor) report(view.state);
    },
    foldNames(names) { const set = new Set(names); return foldWhere((name) => set.has(name)); },
    foldDepth(level) { return foldWhere((_name, depth) => depth === level); },
    unfoldAll() { view.dispatch({ effects: unfoldEffects() }); },
    openSearch() { openSearchPanel(view); },
    findAll(regex) {
      const text = view.state.doc.toString();
      const out = [];
      let m;
      regex.lastIndex = 0;
      while ((m = regex.exec(text))) {
        out.push({ from: m.index, to: m.index + m[0].length });
        if (m[0].length === 0) regex.lastIndex++;
      }
      return out;
    },
    jump(from, to) {
      view.dispatch({
        selection: { anchor: from, head: to },
        effects: EditorView.scrollIntoView(from, { y: "center" }),
      });
      view.focus();
    },
    gotoLine(n) {
      const doc = view.state.doc;
      const line = doc.line(Math.max(1, Math.min(doc.lines, n)));
      this.jump(line.from, line.from);
    },
    cursor() { return view.state.selection.main.head; },
    focus() { view.focus(); },
  };
}

window.XmlViewer = { create };
