// What a push notification is about, in CC Agent: an agent's reply,
// named by its reply id within its conversation (a scope report and a group reply
// travel the same way). services/pushStore.js is generic and
// asks these for what is the product's own; a delivery row keeps the fields given
// here, so they are stored data: the names and the values are not to be changed.
module.exports = Object.freeze({
  // The kinds of notification an account can have, each on unless it said otherwise.
  preferenceDefaults: Object.freeze({ reply: true }),
  // What one event is called in a delivery's keys (with the channel and device).
  eventKey: (event) => event.replyId,
  // The event's own fields on a delivery row, from the event and from a stored row.
  eventFields: (event) => ({ conversationId: event.conversationId, replyId: event.replyId }),
  storedEventFields: (row) => ({ conversationId: row.conversationId, replyId: row.replyId }),
  // Its category, which a preference can turn off.
  eventCategory: () => 'reply',
});
