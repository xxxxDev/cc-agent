// A file dropped or pasted on the agent's terminal (2026-11-10): kept
// in the chat's attachments where the agent can read it, and its path typed at Claude's
// prompt without Enter, as a desktop terminal does. Claude Code turns a picture's path into
// [Image #n].

// A path as macOS Terminal types a dropped file: every character a shell would read
// otherwise (a space, a quote, a bracket...) escaped with a backslash.
export function shellPath(p) {
  return String(p).replace(/[^A-Za-z0-9_\-./~+@%:,=\u0080-\uFFFF]/g, ch => '\\' + ch);
}
// Several paths as one drop types them: separated by spaces, with one after the last, so
// what is typed next does not run into it. No line break: nothing is sent. A path with a
// control character (a line break would be Enter) is left out; the server's names have none.
export function typedPaths(paths) {
  const list = (paths || []).filter(p => typeof p === 'string' && p.startsWith('/') && !/[\u0000-\u001f\u007f]/.test(p));
  return list.length ? list.map(shellPath).join(' ') + ' ' : '';
}
// Where a drag over the page would go: the terminal when it is over the terminal and the
// terminal takes files; otherwise the chat.
export function dropTarget(element, terminalTakes) {
  const over = !!element?.closest?.('.terminal-pane, .terminal-column');
  return {over: over ? 'terminal' : 'chat', to: over && terminalTakes ? 'terminal' : 'chat'};
}
// A pasted picture arrives as "image.png" every time: named by when it was pasted, as the
// chat's paste names it (attachmentDrafts.js).
export function pastedName(file, i = 0, d = new Date()) {
  if (!/^image\.\w+$/i.test(file.name)) return file.name;
  const two = n => String(n).padStart(2, '0');
  return 'pasted-' + d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds()) + (i ? '-' + (i + 1) : '') + file.name.slice(file.name.lastIndexOf('.'));
}
