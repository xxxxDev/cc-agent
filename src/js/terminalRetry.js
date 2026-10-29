// A terminal socket that closed stayed closed: the watchdog only tests a live one,
// and returning to the page was the only thing that attached it again. These decide
// when to try again without waiting for the reader to leave and come back.
const DELAYS=[1000,2000,4000,8000,15000];
// Enough tries to cover a server restart (about 15 s) and a sleep-and-wake, then
// stop: a page that stays visible and cannot connect should not knock forever.
export const MAX_ATTEMPTS=8;
export function retryDelay(attempt){
  return attempt>=MAX_ATTEMPTS?null:DELAYS[Math.min(attempt,DELAYS.length-1)];
}
// Losing the GPU context is normal on a phone; losing the renderer for the rest of
// the session is not. A context that lasted this long was a good device with a bad
// moment, so the next loss starts the count of consecutive failures over.
export const WEBGL_STABLE_MS=10000;
export const WEBGL_RETRY_MS=2000;
export function strikesAfterLoss(strikes,livedMs){
  return livedMs>=WEBGL_STABLE_MS?0:strikes;
}
