// A file saved from a bubble or the file list on an iPhone home-screen app is fetched before the
// share sheet can open; while it comes, a dialog says how far it got, so a large video does
// not show nothing for a long while.
import {f7} from 'framework7-vue';
import {saveFile} from './saveFile.js';
import {formatBytes} from './uploadParts.js';

export function downloadText(ct, got, total) {
  if (total > 0) return ct('已下載 {got}／{total}（{percent}%）').replace('{got}', formatBytes(got)).replace('{total}', formatBytes(total)).replace('{percent}', Math.min(100, Math.floor(got / total * 100)));
  return ct('已下載 {got}').replace('{got}', formatBytes(got));
}

// title is HTML already escaped by the caller.
export async function saveWithProgress(url, name, {title, size, ct}) {
  let dialog = null, shown = 0;
  const onProgress = (got, total) => {
    if (!dialog) {
      dialog = f7.dialog.create({title, cssClass: 'dialog-progress download-progress', content: '<div class="progressbar"><span></span></div><div class="download-progress-text"></div>'}).open();
    }
    const percent = total > 0 ? Math.min(100, Math.floor(got / total * 100)) : 0;
    if (percent !== shown || got === 0) { shown = percent; f7.progressbar.set(dialog.$el.find('.progressbar')[0], percent, 0); }
    dialog.$el.find('.download-progress-text').text(downloadText(ct, got, total));
  };
  const done = () => { dialog?.close(); dialog = null; };
  const confirm = run => f7.dialog.create({title, text: ct('檔案準備好了'), buttons: [{text: ct('取消')}, {text: ct('儲存或分享'), bold: true, onClick: run}]}).open();
  try { await saveFile(url, name, {size, onProgress, onFetched: done, confirm}); }
  finally { done(); }
}
