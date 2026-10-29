import MarkdownIt from 'markdown-it';

// Model output is untrusted: raw HTML and remote image loading are disabled.
function configure() {
  const md = new MarkdownIt({html: false, linkify: true, breaks: true});
  md.disable('image');
  // A wide table scrolls sideways in its own box rather than widening the bubble.
  // Not F7's `data-table` class: that is F7's list-style data table, with 48 px rows
  // and a small grey header, which is what markdown tables used to look like. A code
  // block scrolls by itself (ConversationPage.vue).
  md.renderer.rules.table_open=()=>'<div class="md-scroll"><table>';
  md.renderer.rules.table_close=()=>'</table></div>';

  // A code block wraps rather than scrolls, and carries its own copy button; the conversation page handles the click.
  for (const rule of ['fence', 'code_block']) {
    const render = md.renderer.rules[rule];
    md.renderer.rules[rule] = (tokens, idx, options, env, self) =>
      '<div class="md-code">' + render(tokens, idx, options, env, self)
      + '<button type="button" class="md-copy" aria-label="Copy" title="Copy"><i class="icon f7-icons">doc_on_doc</i></button></div>';
  }

  const defaultLink = md.renderer.rules.link_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  // `external` lets Framework7 leave the click to the browser: otherwise it takes
  // every link for a page of the app, and a link in a reply opened nothing.
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrJoin('class', 'external');
    tokens[idx].attrSet('target', '_blank');
    tokens[idx].attrSet('rel', 'noopener noreferrer');
    return defaultLink(tokens, idx, options, env, self);
  };
  return md;
}

const markdown = configure();

// What a person types is not necessarily markdown. `3 * 4 * 5` should not turn
// into italics, a Windows path should not lose its backslashes, and an indented
// line is indentation, not a code block. So the sent bubble keeps the syntax
// people actually reach for in chat — code, links, lists, quotes, line breaks —
// and renders emphasis and headings as the literal characters that were typed.
// Its fenced blocks get the same copy button, from configure().
const typed = configure().disable(['emphasis', 'heading', 'lheading', 'code']);

// Avoid reparsing unchanged bubbles.
const CACHE_MAX = 300;
const cache = new Map();
function renderCached(engine, prefix, text) {
  const src = String(text ?? '');
  const key = `${prefix}:${src}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const html = engine.render(src);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, html);
  return html;
}

export function renderMarkdown(text) {
  return renderCached(markdown, 'm', text);
}
export function renderTypedMarkdown(text) {
  return renderCached(typed, 't', text);
}
