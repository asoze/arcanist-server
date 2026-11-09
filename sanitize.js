import sanitizeHtml from "sanitize-html";

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|inherit)$/i;

/** Matches what the client's Tiptap starter kit can produce. */
const OPTIONS = {
  allowedTags: [
    "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
    "strong", "b", "em", "i", "u", "s", "code", "pre", "blockquote",
    "ul", "ol", "li", "a", "mark", "span", "img",
    "label", "input", "div",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt", "title"],
    ol: ["start"],
    ul: ["data-type"],
    li: ["data-type", "data-checked"],
    input: ["type", "checked"],
    mark: ["style", "data-color"],
    span: ["style"],
  },
  allowedStyles: {
    "*": { color: [COLOR], "background-color": [COLOR] },
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  exclusiveFilter: (frame) => frame.tag === "input" && frame.attribs.type !== "checkbox",
};

export function sanitizeNoteHtml(html) {
  return sanitizeHtml(html, OPTIONS);
}
