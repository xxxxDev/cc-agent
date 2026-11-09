// Which files show as pictures. A sent message draws only what every browser draws (MessageList).
export const PICTURE=/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
// A file waiting in the box is drawn from the device itself, where a HEIC may draw too (Safari);
// one whose thumbnail cannot be drawn is marked (thumbFailed) and goes back to its chip.
const DRAFT_PICTURE=/\.(png|jpe?g|gif|webp|avif|bmp|svg|heic|heif)$/i;
export const isDraftPicture=item=>!!item&&!item.thumbFailed&&DRAFT_PICTURE.test(item.name||'');
