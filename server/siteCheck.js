// Where a website an admin is about to grant leads now. The
// scope gate never looks up a name it refuses (channel/scope-gate.mjs), so a report suggests a
// website by its spelling alone; this is the check of its address, at the grant. One that
// resolves to a loopback, link-local, private, reserved or this machine's own address is granted
// only once the admin confirms it (as a risky folder is): the agent's WebFetch would still be
// refused there, but its Bash, held only by the sandbox's list of names, would reach it. A name
// that does not resolve is not held: there is nothing to say yet, and the gate checks every fetch.
// The address rules are the gate's own (addressBlocked, ownAddresses).
let gate = null;
const load = async () => (gate ||= await import('../channel/scope-gate.mjs'));

async function resolvesPrivately(site, resolve) {
  const g = await load();
  const host = String(site || '').toLowerCase().replace(/^\*\./, '');
  if (!host) return false;
  let addresses;
  try { addresses = await (resolve || g.systemResolve)(host, 3000); } catch { return false; }
  const own = g.ownAddresses();
  return Array.isArray(addresses) && addresses.some((a) => g.addressBlocked(a, own));
}

module.exports = { resolvesPrivately };
