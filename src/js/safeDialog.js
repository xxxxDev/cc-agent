// Framework7 builds its dialogs from HTML strings: a dialog's title and text are
// markup, and prompt() writes its default value into value="…" unescaped. A
// member's display name reached an admin's session that way: the admin opened the
// member, tapped 變更顯示名稱, and the name ran as script. Every dialog in this app shows plain text, so escape once, here,
// for all of them, and hand prompt() its default through the DOM instead.
const ENTITIES = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);
const plain = (value) => (typeof value === 'string' ? escapeHtml(value) : value);

export function installSafeDialogs(app) {
  // Toasts are built the same way.
  for (const method of ['create', 'show']) {
    const original = app.toast[method];
    app.toast[method] = (params = {}) => original.call(app.toast, typeof params.text === 'string' ? {...params, text: escapeHtml(params.text)} : params);
  }
  const dialog = app.dialog;
  const {alert, confirm, password, login} = dialog;
  const prompt = dialog.prompt;
  // Callbacks are functions and pass through untouched; only strings are text.
  dialog.alert = (...args) => alert.apply(dialog, args.map(plain));
  dialog.confirm = (...args) => confirm.apply(dialog, args.map(plain));
  dialog.password = (...args) => password.apply(dialog, args.map(plain));
  dialog.login = (...args) => login.apply(dialog, args.map(plain));
  dialog.prompt = (...args) => {
    // Framework7's two call shapes: (text, title, ok, cancel, value) and, when the
    // second argument is a function, (text, ok, cancel, value, title).
    let [text, title, ok, cancel, value] = args;
    if (typeof args[1] === 'function') [text, ok, cancel, value, title] = args;
    // Always the title-first shape; an undefined title still gets the default.
    const opened = prompt.call(dialog, plain(text), plain(title), ok, cancel, '');
    const input = opened?.$el?.find('.dialog-input')[0];
    if (input) input.value = value == null ? '' : String(value);
    return opened;
  };
}

// A Framework7 module, so it is in place before anything can open a dialog.
export default {name: 'safe-dialogs', create() { installSafeDialogs(this); }};
