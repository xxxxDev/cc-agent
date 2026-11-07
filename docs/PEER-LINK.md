# Peer link: agents on two machines

The peer link pairs two CC Agent installations on different machines. When an admin opens an agent on each side, those agents can send each other messages. The two machines can run on different Claude accounts. Messages go over SSH between your own machines, not through a third party.

Not running CC Agent? [agent-courier](https://github.com/xxxxDev/agent-courier) does the same for plain Claude Code sessions, as an MCP server.

<p align="center">
  <picture><source media="(prefers-color-scheme: dark)" srcset="../.github/assets/peer-link-dark.png"><img src="../.github/assets/peer-link-light.png" alt="How the peer link works: machine A calls machine B over SSH; a forced command hands messages to CC Agent there"></picture>
</p>

## What you get

- **Pairing in the web app.** Machine B shows a one-time code. You type it on machine A. Each side's admin then enables the pairing with their password (and two-step code, if two-step sign-in is on), or with a passkey they added with the password.
- **Agents you choose.** In an agent's Agent Profile, turn on **Peer messages**. Then tick which agents on the other machine it may exchange messages with. Both sides must tick each other.
- **Messages in the chat.** A message from the other machine is a bubble on the left, with a line under it saying which machine and agent sent it. A message the agent sent shows where it went and what became of it: queued, delivered, expired, refused or unsent.
- **@ the other machine's agents.** In the composer, @ lists the agents of the paired machine that this agent may write to, under **Another machine**, as `machine/name`.
- **Each machine's own icon.** It comes with the exchange and shows on that machine's agents.

## Set it up

You need SSH from machine A to machine B, with the host key known and pinned.

1. **On machine A, make a dedicated key.**

   ```bash
   ssh-keygen -t ed25519 -N '' -f ~/.ssh/cc-agent-peer -C cc-agent-peer
   ```

2. **On machine A, write an SSH config file for the link.** Use your own host name, user and known-hosts file. CC Agent also passes `-T`, `BatchMode=yes`, `StrictHostKeyChecking=yes` and `ClearAllForwardings=yes` itself.

   ```text
   Host peer-b
       HostName machine-b.example
       User you
       IdentityFile ~/.ssh/cc-agent-peer
       IdentitiesOnly yes
       IdentityAgent none
       UserKnownHostsFile ~/.ssh/known_hosts_peer
       StrictHostKeyChecking yes
       RequestTTY no
   ```

3. **On machine B, add the public key with a forced command.** Add one line to `~/.ssh/authorized_keys`. Use absolute paths for `node` and for this project.

   ```text
   command="/absolute/path/to/node /absolute/path/to/cc-agent/scripts/peer-exchange.mjs",restrict ssh-ed25519 AAAA… cc-agent-peer
   ```

   `restrict` turns off forwarding, the terminal and agent forwarding. With this key, the forced command is the only program SSH can run. The program ignores `SSH_ORIGINAL_COMMAND`.

4. **On machine A, tell CC Agent how to call.** Add the two settings below to `server/.env`, then restart CC Agent. A machine without these settings is the answering side.

   ```text
   CC_AGENT_PEER_SSH_CONFIG=/Users/you/.ssh/peer-b.config
   CC_AGENT_PEER_SSH_HOST=peer-b
   ```

5. **Pair.**
   1. On machine B, open **Admin → Peer link** and press **Make a pairing code**.
   2. On machine A, open the same page, press **Join a pairing** and type the code.
   3. Press **Enable** on both sides.

6. **Open agents.** In Agent Profile, turn on **Peer messages** on both sides and save. The other side's agents then appear in the list. Tick them and save again.

To revoke the link, remove the line from `authorized_keys` on machine B, or press **Remove pairing** on either side.

## Rules

- **Which agents can join.** Only full-access agents of an active admin can be opened. Each one is opened on its own, with the admin's password or a passkey added with it. A scoped agent cannot be opened.
- **Who writes first.** An agent writes first with `peer_send`, for work the owner gave it.
- **Only answers after someone else's message.** Once anything from someone else has arrived since the owner last wrote, `peer_send` is refused until the owner writes again. That includes a message from another machine, from another agent or session, or from outside. Until then the agent can only answer with `reply`.
- **Replies are drafts by default.** The agent's final `reply` to a message from the other machine is sent back once. By default it is a draft: the owner presses **Send** or **Don't send** under it. In Agent Profile, **Send replies back automatically** sends replies without that step.
- **Size and rate limits.**
  - A message holds words only, up to 8,000 characters and 12 KB. A longer reply is cut, with a note.
  - At most 30 messages an hour pass between two agents, in each direction.
  - At most 10 of an agent's messages wait at a time.
  - After 12 messages back and forth without the owner writing, the pair stops until the owner writes.
- **No attachments.** Files are not sent.
- **Expiry.** A message that waits for 24 hours expires. Pausing or removing a pairing settles what waited for it as unsent, so a new pairing never sends old words.

## What it protects, and what it does not

- **Trust is per machine.** On one machine, every full-access agent runs as the same user and can read CC Agent's files. The name of the sending agent is what the other machine says. The real gate is the receiving side's own setting: its agent must be opened and must have ticked the sender.
- **The text is advice.** The receiving agent gets the text fenced and marked as another agent's words, never the owner's authorisation. This is an instruction to the model. It does not make prompt injection impossible.
- **The SSH key and the peer key.** Anyone with the SSH key, or with the answering side's peer key (`~/.config/cc-agent/peer-key`, mode 0600), can deliver to agents that are opened and that ticked the sender. Keep both out of agents' reach, for example with sandbox rules for scoped agents.
- **Nothing travels in the clear.** Messages travel only inside SSH. `/bridge/peer/exchange` refuses requests forwarded by Cloudflare, requests from a web page, and any path spelling other than lowercase.
- **An agent keeps what it read.** Text that reached an agent stays in its session.

## Files

| File | What it does |
|---|---|
| `server/peerLink.js` | Pairing, the exchange, delivery receipts, retries and the calling loop |
| `server/agentStore.js` (Peer link) | Which agents may take part, the agent's tools, delivery into the chat, drafts and limits |
| `scripts/peer-exchange.mjs` | The forced command on the answering side |
| `<data>/peer-link.json` | Pairings and the ids already seen (0600) |
