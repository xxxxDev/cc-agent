// A reactive second, for what the page works out from the time: how long a turn or a
// background task has run, whether a reply is still settling, how long a compaction
// has gone on. Those read Date.now() from the shown answer, and once an unchanged
// answer stopped being assigned again on every poll (PR #3), nothing else made them
// move. Reading secondClock.value in a computed makes it count on; the computed
// redraws only what its own value changed.
import {ref} from 'vue';
export const secondClock = ref(Date.now());
if (typeof setInterval === 'function') setInterval(() => { secondClock.value = Date.now(); }, 1000);
