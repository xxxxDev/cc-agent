# CC Agent features

English · [繁體中文](FEATURES.zh-TW.md)

This is the full tour. The [README](../README.md) is the short version.

## Agents

- **Create an agent.** Give it a name, what it is for, what it should remember long-term, a model and an effort level, and a working folder. Only an admin creates agents, for themselves or for another account.
- **Agent Profile.** Every agent has a profile: what it is for, its boundaries and its current state. The agent keeps it up to date itself, and you see each change as a card in the chat. Its long-term memory sits beside it.
- **Carry on an existing session.** An admin can enter a local Claude Code session ID, and the new agent carries on that conversation. A session can also write a short JSON about itself, which you paste to fill in the create form.
- **Start, pause, restart.** Pausing interrupts a reply in progress and keeps the chat. Restarting resumes the same session. The list can pause or restart every agent at once.
- **Saving the profile.** Agent Profile saves every change with one Save button, which lights up once something changed. A new model, effort or access reconnects the agent and keeps the conversation. A setting that waits for the agent to start again is asked about once: restart now, or once the current reply is done. Closing the profile with unsaved changes asks before discarding them, and an action such as start, restart, pause or handoff asks whether to save first.
- **Subagents' model and effort.** In the Admin tab, an admin sets the model and effort that full-access Claude agents give their subagents, and can lock the model so every subagent uses it. An agent follows that or sets its own in Agent Profile. A change applies when the agent next starts.
- **Auto-compact timing.** When Claude Code compacts an agent's conversation: Claude Code's default, or at 200k, 300k, 400k, 500k or 700k tokens. An admin sets it in the Admin tab's Handoff group, and an agent follows that or sets its own in Agent Profile. Too low and it keeps compacting, since starting up alone can take over 50k. A change applies when the agent next starts.
- **Handing off to a fresh session.** A long conversation is compacted by Claude Code. After a set number of compactions (5 unless an admin changes it, 0 turns it off; an agent can set its own number in Agent Profile), CC Agent saves the agent's memory and recent messages and carries on in a new Claude Code session. You can also press **Continue** to do it by hand.
- **What a handoff carries.** The 12 most recent messages, unless an admin changes it (0 to 50). Pressing **Continue** asks how many first, unless an admin turns that off. With **After a handoff** set to **At the first message**, the new session starts only when the next message arrives, which saves the start-up of a session nobody uses.
- **Deleted agents.** A deleted agent leaves the list and can be restored with its own session. By default it is never purged; an admin can have deleted agents purged after 7 to 365 days.
- **Signing Claude in again.** When Claude's login on this computer runs out, the chat shows a card and you get a push notification. An admin signs in again from that card, or by typing `/login`, with no terminal needed. Every agent on the computer shares that login.
- **Agents that start agents.** The computer's owner can name agents by conversation id in `agent-starters.json` in the data folder (`.local/` by default), as `{"conversationIds": [...]}`. Each must be a full-access Claude agent of an admin. From its next start it can list the Claude agents of active accounts and start stopped ones, each with its own profile and access, and the started agent's chat says who started it.
- **Pictures.** Give an agent its own picture.
- **Order and groups.** Tap **Edit** and each row gets a drag handle. In **All**, the default list, drag an agent to a new place within its source, into or out of a group (an empty group shows a place to drop it), or move a whole group by its handle. Let go outside the agent's source, such as on the source's title, and it goes back with a small shake, with nothing saved. **Recent** keeps its activity order and does not drag. **New group** is in a source's own list.
- **Swipe for actions.** Outside Edit, swipe a row to the left for round buttons: pause, or start when the agent is stopped, and, for an admin, delete. Delete always asks first, and so does pausing an agent that is answering.
- **Mark all read.** In Edit, the select-all row ends with a checkmark that marks every one of your own agents read.
- **Pin.** In Edit, a tap on a row chooses it, and the pin button left of **Mark all read** pins the chosen agents. They move into a **Pinned** section at the top, in the order you pinned them, newest last, and outside Edit show a small pin after the name. When every chosen agent is already pinned, the same button is **Unpin**, and each goes back to its group and its place. Pins are kept for each account. Every account chooses its own agents, to pin them or mark them read; pausing, starting, restarting and deleting several at once stay with admins. In Edit, each row's red delete button sits at the right, before the drag handle. A long name ends in an ellipsis before it. On a phone, Edit hides the trash and + buttons so the top bar fits.
- **List on the left, chat on the right.** On by default on a computer; switch it off in Settings (this device only). In a window at least 1280px wide, a tap on an agent narrows the list into a column on the left and opens the chat on the right; a tap on another agent in the column switches the chat, and the back arrow widens the list again. Drag the column's edge to size it, as split view's dividers drag: an accent line shows on hover, the column stays at least 260px wide and always leaves 560px to the chat, the width is remembered on the device, and a double click puts it back. Edit works inside the column, with the chat still open.
- **Groups work the same way.** The Groups list narrows into the same column, with the group room on the right; a tap on another group switches the room, each room keeps its own draft, and the column shares the Agents tab's width.


<p align="center">
  <img src="../.github/assets/screens/desktop-profile-dark.png" alt="An agent's profile panel">
</p>

<p align="center">
  <img src="../.github/assets/anim/agent-list-drag-dark.svg" width="300" alt="Edit, then an agent dragged to the top, another into a group, and one let go on the source title going back with a shake; Done">
  <img src="../.github/assets/anim/agent-swipe-actions-dark.svg" width="300" alt="A row swiped left shows pause and delete, a stopped agent's row shows start and delete; each swiped back shut">
</p>

<p align="center">
  <img src="../.github/assets/screens/phones-pins-dark.png" alt="On a phone: Edit with two agents chosen and the pin and Mark all read buttons at the end of the select-all row; then the Pinned section at the top, each pinned agent with a small pin after its name">
</p>

<p align="center">
  <img src="../.github/assets/anim/agent-pins-dark.svg" width="300" alt="Edit, a tap on two rows chooses them, the pin button pins them, Done: they stand in the Pinned section at the top">
</p>

<p align="center">
  <img src="../.github/assets/screens/desktop-list-detail-setting-dark.png" alt="Settings on a computer with List on the left, chat on the right switched on">
</p>

<p align="center">
  <img src="../.github/assets/anim/list-detail-dark.svg" alt="A click on an agent narrows the list into a column with the chat beside it, a click on another agent switches the chat, and the back arrow widens the list again">
</p>

<p align="center">
  <img src="../.github/assets/anim/list-column-resize-dark.svg" width="640" alt="The column's edge shows an accent line under the mouse, is dragged wider, then narrower, and a double click puts it back">
</p>

<p align="center">
  <img src="../.github/assets/screens/desktop-list-column-edit-dark.png" alt="Edit inside the Agents column, two agents chosen, with the chat still open beside it">
</p>

## Chat

- **Messages and files both ways.** Send text and attachments (up to 10 files a message, 95 MB each) and get files back from the agent (up to 5 a reply, 25 MB each), with previews. On a computer, drag files onto the chat to attach them.
- **Mentions, search and jump-to-latest.** Search one conversation's messages and jump to any result.
- **Reply to a message.** With a mouse, the reply button beside copy under a bubble. On a phone, swipe a bubble to the left until the round reply icon lights up, or long-press it and tap reply. The message you are answering shows in a bar over the box: the agent's words with its small picture, your own with no name. Tap the bar to see that message again, scrolled to and highlighted; the X (or Escape) cancels. The agent is told which message you reply to, with its first words, and can read the whole of it.
- **What a reply answers.** An agent's reply names the message it answers on a line above it, with its first words, when that helps: something else came between, or it answered several at once (a **+N more** chip opens the rest). The agent's words carry its small picture, an agent on another machine its name, and your own words no name at all. Your own replies always show the line. Tap it to jump to that message.
- **Long-press menu.** On a phone, a long press lifts the bubble a little over a dimmed page, with round buttons under it: copy, select text and reply. **Select text** hands the words to the phone's own selection, all selected, so its handles can pick part of them. A tap elsewhere closes it. The dim, the lift and the buttons fade in and out together.
- **Upload progress.** While a message with files goes, the send button turns into a spinner, and each file shows whether it is waiting, uploading with its percent, or done, with a line over the box such as **Uploading 2 of 3 (45%)…**. From 99% a file shows **Processing** until the server has it, since a phone's browser hands the whole file to the network at once. A file that fails is marked, and you can keep typing meanwhile.
- **Pictures waiting to send.** Pictures in the box show above it as 68px thumbnails, each with an ✕ in its corner and, once you send, its own progress. A tap opens a preview that steps through the draft's pictures.
- **The phone's file picker.** On an iPhone, the box lets go of the keyboard before the **+** file picker opens, so the keyboard no longer jumps up and away behind it. While the picker is open, a tap on the box only closes the picker; tap again to type.
- **Messages between agents** show as dashed bubbles: what agents send one another in a group, or to and from another machine, stands apart from what they say to you.
- **Slash commands.** Type `/` for Claude Code's own commands, such as `/compact`, `/context`, `/mcp`, `/usage`, `/status` and `/diff`. They run in the agent's terminal.
- **Questions from the terminal.** When Claude Code stops to ask something in its terminal, such as a permission prompt or a choice, the chat shows it as a card you can answer.
- **Stop this turn.** Interrupt a reply in progress without stopping the agent.
- **To-dos.** An agent keeps steps, to-dos and things to verify in lists under **To-dos** beside the chat. Tap an item to move it on (to do, doing, done); long-press to mark it blocked, add a note, edit or delete it. You can add your own items too.
- **Finished to-dos.** By default every list is kept. An admin can have a list whose every item is done deleted 1, 3, 7 or 30 days after its last change, with **Keep finished to-dos** in the Admin tab's Wrap-up group. A list with anything still to do, in progress or blocked is never deleted, and neither are a deleted agent's lists.
- **Wrap-up check (optional).** It is off until an admin turns it on in the Admin tab. Then an agent that has finished a task and sat idle for 10 minutes (the admin can change the wait) is asked to make sure its work is saved and its notes are current. It is not asked after a turn that only read or answered, and it is not asked while the agent still has background commands or subagents running. The admin can change the text it sends, and an agent can be left out by turning off **Automatic wrap-up check** in its Agent Profile.


<p align="center">
  <img src="../.github/assets/screens/phones-reply-dark.png" alt="On a phone: a reply naming what it answers, the long-press menu, and the reply bar over the box">
</p>

<p align="center">
  <img src="../.github/assets/anim/swipe-reply-dark.svg" width="300" alt="Swiping a bubble to the left to reply: the reply icon lights up and the reply bar shows over the box">
  <img src="../.github/assets/anim/long-press-dark.svg" width="300" alt="A long press dims the page and lifts the bubble with copy, select text and reply under it; Select text selects its words">
</p>

<p align="center">
  <img src="../.github/assets/anim/jump-to-message-dark.svg" width="300" alt="Tapping the line over a reply scrolls up to the message it answers and highlights it">
  <img src="../.github/assets/anim/upload-progress-dark.svg" width="300" alt="Three files sent: each waits, uploads with its percent, shows Processing, then the message is in">
</p>

<p align="center">
  <img src="../.github/assets/screens/phones-upload-dark.png" alt="Upload progress on a phone: a file at 45%, a file processing, and the sent message">
</p>

<p align="center">
  <img src="../.github/assets/screens/phones-draft-pictures-dark.png" alt="Three pictures as thumbnails over the box with an ✕ each, a preview stepping through them, and each with its own progress once sent">
</p>

<p align="center">
  <img src="../.github/assets/screens/desktop-prompt-dark.png" alt="A question from the terminal answered in the chat">
</p>

## Groups

- **Group chats.** Put several agents in one room and choose a lead.
- **Who answers.** A message goes to the members it opens with `@`, to everyone with `@All`, or otherwise to the lead. What members send one another shows in the group too.
- **Notifications.** You are notified only when a member calls on you with `@` in the group, once it has a result.

<p align="center">
  <img src="../.github/assets/screens/desktop-group-dark.png" alt="A group chat with its to-do list">
</p>

## Peer link: agents on two machines

Agents on two of your computers can talk to each other, for example a build agent on a desktop and a web agent on a laptop. The two machines can be signed in to different Claude accounts. Messages go over SSH directly between them, not through a third party.

<p align="center">
  <img src="../.github/assets/peer-link-dark.png" alt="Machine A calls machine B over SSH with a dedicated key; a forced command hands the messages to CC Agent there, and each side delivers them to its own agents">
</p>

- **Pair the machines once.** One machine shows a one-time code on **Admin → Peer link**, and you type it on the other. Then an admin on each side presses **Enable** and confirms with their password (and two-step code), or with a passkey added with the password. Setup takes a dedicated SSH key restricted to one command; [PEER-LINK.md](PEER-LINK.md) walks through it.
- **Open only the agents you choose.** In an agent's Agent Profile, turn on **Peer messages** and tick which agents of the other machine it may exchange messages with. Both sides must tick each other, and only full-access agents of an admin can take part.
- **Talk in the chat you already use.** Name an agent of the other machine with `@` (listed as `machine/name` under **Another machine**), and your agent passes your words on with its `peer_send` tool; it can also write on its own for work you gave it. Its answer comes back into the same conversation. The message shows as a bubble with where it went and what became of it: queued, delivered, expired, refused or unsent. Messages from the other machine sit on the left, with that machine's icon and the agent's name.
- **Answers wait for you.** An agent's reply to the other machine is a draft with **Send** and **Don't send** under it, unless you switch on **Send replies back automatically** for that agent.
- **Built-in brakes.** After a message from someone else, an agent can only answer until you write again; it cannot start a new conversation on its own. Messages are words only, up to 8,000 characters, at most 30 an hour between two agents, and a pair stops after 12 back-and-forths without you. A message that waits 24 hours expires.

<p align="center">
  <img src="../.github/assets/screens/desktop-peer-chat-dark.png" alt="A conversation with a message sent to an agent on another machine, its answer, and a reply draft">
</p>

<p align="center">
  <img src="../.github/assets/screens/desktop-peer-link-dark.png" alt="The Peer link page with a paired machine">
</p>

## Schedules

- **Timed messages.** Wake an agent daily, weekly, monthly or every few hours, at one or several clock times, until a last day if you set one. Quiet hours hold notifications until they end.
- **Agents suggest, you agree.** An agent can suggest a schedule in its conversation. An admin's agent with full access can set one up at once; any other agent's suggestion waits for an admin to approve it on the Schedules page.
- **RSS and Atom feeds.** CC Agent reads the feed at each due time and hands the agent only the entries it has not seen (the newest 3 the first time), for example to sum them up.
- **Background scripts.** A small Python, Node or shell script runs at each due time without waking the agent. It runs in a sandbox, may reach only the sites you list, has no secrets, and keeps its own state folder. Its result goes to you as a notification, or to the agent. You can trial-run it first. This part needs macOS.
- **Built-in checks.** For checks a sandboxed script cannot do, the computer's owner can list read-only commands by hand in `schedule-checks.json` in the data folder (`.local/` by default); a schedule can then name one. Neither the page nor an agent can add one.
- **Paused agents are respected.** An agent you paused yourself is never started by a schedule; the run waits until it is back.


<p align="center">
  <img src="../.github/assets/screens/desktop-schedules-dark.png" alt="The Schedules page with a suggestion waiting for approval">
</p>

## Access

- **Full access.** The agent can do anything your user can do on this computer. Turn it on only for agents you would trust with your terminal.
- **Scoped agents.** By default an agent reaches only its own workspace. You list the folders it may use (and folders inside them to keep out), the websites it may reach, and the MCP servers it may use. It runs in Claude Code's sandbox and auto mode. When a folder typed for a grant is a link, the confirmation shows where it leads, for information; what was typed is what is granted. Three limits: for a linked folder, grant its real path, since a link works for the file tools but not for shell commands; avoid giving one agent a read-write folder inside a folder another scoped agent can write; and excluding goes by path, so an excluded folder moved or renamed after it was set is no longer excluded, and excluding is no substitute for not granting the folder above it.
- **Websites and MCP servers.** A scoped agent reaches only the websites you list, and uses only the MCP servers you tick, claude.ai connectors included; this holds for an admin's own scoped agents too. A gate CC Agent runs before Claude Code's permission decision refuses anything else and files a scope report. An unlisted name is refused before anything is looked up, so the agent cannot use the lookup to send anything out; it is suggested for granting by its spelling alone (a name with a dot, not an IP address, not a home or office network's such as .local, .lan, .internal, .home or .arpa, not this computer's name), and when an admin grants a website the server checks where it leads: one that resolves to a local or private address needs a second confirmation, since the agent's shell commands could then reach that address. With no website listed, the agent has no web fetch at all. "example.com" is that host only; "*.example.com" is any name under it, but not example.com itself; letter case, a trailing dot and the port do not matter; only http and https. Never reached, listed or not: an IP address typed as the host, localhost, this computer's own names, or a listed name that now resolves to a loopback, link-local or cloud metadata, private (including 100.64.0.0/10 and 198.18.0.0/15), multicast, unspecified (0.0.0.0/8) or documentation address, to an IPv6 form carrying one of those (IPv4-mapped, NAT64, 6to4) or a range that is never a website (::/96, the local-use NAT64 range, Teredo), or to this computer's own address; a listed name that does not resolve is refused. Redirects: Claude Code follows by itself only a redirect to the same host (with or without a leading "www."), same protocol and port; a redirect to another host comes back to the agent as a new fetch, which the gate checks. Limits: the gate checks the address a name resolves to when it checks, and Claude Code resolves it again when it fetches; a listed site can change where its name resolves after the check (DNS rebinding); a gate that does not answer within 15 seconds lets the call run. Shell commands keep using the sandbox's own network list, which has no private-address refusal: a listed name that resolves to a private address is still reachable with curl. Web search is unchanged. The gate costs about 60 to 95 ms per web fetch or MCP call, and 10 to 30 ms for a call to CC Agent's own chat tools, which the shell passes without starting node. Claude Code shows the agent a refusal headed by the hook's command, which names a file in the agent's control folder (the agent can neither read nor write it).
- **Plugins and other ways in.** A tool a Claude Code plugin registers is listed like an MCP server's but does not go through the gate, so a scoped agent runs with Claude Code's built-in plugins (such as its chart, diff and plugin-authoring ones), plugins synced from claude.ai and the owner's own plugins switched off. Claude Code has no setting that switches every plugin off, so the built-in ones are read from the Claude Code program about to start (every built-in plugin name it holds, read once per program file) and each is switched off by name and its tools denied; if they cannot be read (a launcher whose program is not known, or a build that names them differently), the ones known today are switched off and admins get a notice for that agent. The built-in security and privacy guards, and telemetry, which carries no tool, stay on, since switching off a guard would weaken what the agent is held to. Synced plugins need the user settings, which a scoped agent does not read. Of the owner's own plugins, each installed or enabled one is switched off, plugin folders named in the environment are emptied, and every plugin's tools, a plugin's own MCP servers and every MCP server on this computer that was not ticked are denied by name in the agent's settings. CC Agent's own plugin stays. A plugin kept somewhere CC Agent does not read, or installed after the agent started, is not denied by name. With no claude.ai connector ticked, the agent also uses only the MCP servers CC Agent gives it (`--strict-mcp-config`); with one ticked that flag is left out, as it would drop the connectors. Other ways a tool could come in: user-level settings (a scoped agent reads none), managed settings (an organisation's policy, which CC Agent cannot override), a `.mcp.json` in the workspace (the agent does not start) or in a granted folder (its servers are denied, and no project server is approved by itself), and skills (a skill brings tools only as a plugin in its folder, handled as a plugin).
- **Programs outside the sandbox.** For a program that cannot run inside the sandbox (one that opens a browser, for example), an admin can list it with its project folder. CC Agent runs it in that folder with a cleared environment, and the folder is read-only to the agent.
- **Scope reports.** The sandbox and the agent's scoped access are what stop an action; a scope report is a best-effort notice so an admin knows the agent was stopped. When a scoped agent tries something outside its access and Claude Code or its sandbox refuses it, a report usually lands on the Scope reports page (Admin tab). Dismiss it, or widen that agent's access from there; granting reconnects the agent. The suggested folder or website is the target of the refused call (a built-in file tool's path, WebFetch's address), a folder only if it exists and never a path with a control or format character, which the report shows as its code; check that it is what you mean to allow. The grant asks again, naming the agent, the exact value and that the agent may then read and also change what is there; a refused read offers read-only access as the main choice, and a folder too broad, or one whose files the shell, the system or a tool runs (one on the server's PATH, a `bin`, `shims`, `hooks`, `.git`, `.husky` or `node_modules/.bin` folder, `~/.cargo`, `~/.npm/_npx`, Docker CLI plugins, IPython startup, Vim and Neovim plugins, editor extensions), judged as typed and as it is on disk (through links, case aside), is never filled in for you and needs a second confirmation, also when typed; the confirmation is in the audit log. A call that Claude Code's auto-mode safety check blocked is filed as **Blocked by the safety check**, with no grant: a wider scope would not let it through; that kind is taken only from Claude Code's own denial, never from a command's output. Other refusals are filed as **Refused by its access**.
- **Blocked, in the chat.** The same refusal shows in that agent's own chat as a one-line **Blocked** card under the turn it came from: the tool and what it tried, and what became of the report. A tap opens the report in a card over the chat, without leaving it: an admin gets the report itself, with its actions; anyone else gets whether a permission prompt was refused, its access blocked it or the safety check did, the agent's explanation, and **The admins have been told** once the push service has accepted a notification for it, and **Recorded** until then (also when no admin has a device to notify). The card is a CC Agent notice: it is not unread, not sent to the agent and not pushed.
- **The agent explains.** CC Agent asks a scoped agent to explain each report with `explain_report` (a full-access agent has no scope to widen: a permission prompt refused in its session, such as a restricted subagent's, files no report; it is logged in the audit log, and the agent is told if the turn is still running): why it needed that action, what it did instead, and whether it still needs it. The explanation is only a label: nothing the agent says closes a report or changes its notification, and every report waits for an admin. One the agent says it no longer needs shows **The agent says it is not needed**; admins can dismiss those together, after a confirmation that lists each of them, in a scrolling list, by agent, tool and first line. Only the reports shown are dismissed, and only if they still carry the label that was shown; reports an admin reopened, reports of agents that talk to people outside, and reports that carry more refusals of the same turn are left for one by one. Reports that were once closed by an agent's own word under an earlier design are open again, marked as such, do not count toward an agent's limit of open reports, and have a bulk dismissal of their own, with the same listing confirmation. Each dismissal is recorded. Each explanation is kept, with a count, until an admin acts on the report.
- **What the scope refused, and how it is found.** Claude Code reports it through hooks that run outside the sandbox and write each event into a folder of the agent's that its sandbox and file tools cannot reach, so the agent's own tools cannot write or remove one. This needs Claude Code 2.1.322 or later. Admins get a **Scope reports may be incomplete** notice for that agent on the Scope reports page when the Claude Code it starts is older or of unknown version (older than 2.1.318, it starts without the hooks; 2.1.318 to 2.1.321 may not report everything), when no hook event arrives after it starts, when it was already running before an update and needs reconnecting, when events were cut short or dropped while nothing read them, when its event folder was not a plain folder of its own (unsafe), when events whose filing kept failing were set aside, when a stretch the earlier transcript scan left unread remains, or when the reports file could not be read, held items that are not reports, or cannot be written. A file tool's refusal is Claude Code's own only when the call did not succeed and its result is exactly one of Claude Code's refusal sentences for the call's own path, including a path reached through a symlink (the report then shows both ends, and suggests the real folder only when Claude Code printed it in full) and a long path Claude Code shortened; one that still names `--restricted` in no known form is filed as **matched by wording**, with no suggestion. A failed Bash command is matched by its wording too, so its report is marked **matched by wording** and suggests no grant, as the command could have printed that text. A refusal the command swallows (`| head`, `|| true`, or `curl … | sh`, so it exits 0) looks like success and is not caught; `npm run` and similar first fail on their own registry fetch, so that is what is reported; and a successful file tool call is remembered until its batch is read (at most 20000 waiting), past that a call is judged by the sentence alone. Not tested yet: a subagent a skill starts with `context: fork`. The hooks always keep the safety check's denials, keep other events only when they carry a refusal, and keep the ids of successful file-tool calls whose results carry one (so those are never taken for refusals); the server reads them in the background, one file at a time, and removes them only once the reports are on disk; writing the reports file takes the server about 15 to 27 ms, once a second at most for what the hooks bring; an admin's decision is written at once. Scoped agents pay for the hooks, measured on a real run: about 10 to 20 ms per file-tool call, and about 10 to 20 ms more per batch of calls (every batch has one, shell commands included). A batch event is kept up to its first 256 KiB: one that carries a refusal is read to its last whole call and admins get a **Scope reports may be incomplete** notice for that agent, but one whose first 256 KiB hold no refusal at all is dropped by the hook without being counted, so a refusal past that point in a very large batch is missed silently. An admin's decision on a report (dismiss, reopen, the bulk dismiss, a grant) is answered only once it is on disk, and an error says when it could not be written; a grant writes the report first and then the agent's access, so a forced stop in between can leave a report marked granted whose access was not saved, never access widened with its report still open. A forced stop (the process killed) can lose the latest reports that did not come from the hooks (a refused permission prompt's), about a second of them while writes succeed and longer while a failing write is retried, and can send a batched notification a second time; the hooks' events are read again at the next start. An unreadable reports file is moved aside, never written over, with a notice; items in it that are not reports are set aside on their own and the rest kept. An admin's decision is made only on the report as the page showed it: if it changed since (another admin, the agent's explanation), the page is asked to refresh. A page from before this check, still cached in a browser, is checked on the report's status only. If the reports file cannot be fixed on disk, nothing more is saved until the server restarts, and its notice says so. Past five refusals in each fifty events read, or twenty a minute, the rest are counted on the last report and listed up to 50, past that only the first and last 25, and once the report is decided only their count is kept; when an agent is at its limit of open reports, admins get one **Reports full** notice for it instead.
- **Notifications.** Admins are notified of an agent's first report at once, and of the ones after it together, once every ten minutes at most. A report counts as notified only once the push service has accepted a notification for it; until then it is offered again every hour, up to 24 times, and not at all when no admin has a device that takes notifications; the report stays open either way. Accepted means sent, not received by a device.
- **To review and Record.** The Scope reports page has **To review** and **Record** views and an agent picker; each agent shows how many reports it had, how many are open, how many of those it says it no longer needs, and how many were granted, and the tools or commands it runs into most. An admin opens one agent's reports from its Agent Profile. Each scoped agent's workspace CLAUDE.md sums up the agent's access and asks it not to attempt anything outside its access but to use an in-scope way: after a refusal, a different in-scope approach is fine, but not another route to the same thing (another tool, a copy elsewhere, another command on the same path or site), and every refusal is explained with `explain_report`.
- **Permission prompts.** Claude Code's own permission questions can be answered from the chat; no agent tool can answer them.


<p align="center">
  <img src="../.github/assets/screens/desktop-reports-dark.png" alt="Scope reports for refused requests">
</p>

## Seeing what an agent does

- **Live progress** in the chat: the tool the agent is using, which step it is on and how long it has worked, and whether it is still working in the background.
- **Terminal view.** Switch to the agent's real Claude Code terminal, beside the chat on a computer. An admin turns the switch on in the Admin tab.
- **Terminal and chat in step.** With the terminal open beside the chat on a computer (admins):
  - **Where a file goes.** While you drag a file, the overlay shows two places, **Drop into the chat** and **Drop into the terminal**. A file let go on the terminal is saved where the agent can read it, and its path is typed at Claude's prompt without pressing Enter. If the agent cannot read that folder, the overlay says so and the file goes to the chat.
  - **What you type there shows in the chat.** What you type straight into the terminal, and the agent's answer to it, also show in the chat, marked **from the terminal**.
  - **/model and /effort.** A `/model` or `/effort` typed in the terminal updates Agent Profile. A model change Claude Code makes by itself is only shown, not saved.
- **Transcript inspector.** Tap any message to see what that exchange sent to the model and got back, with tool calls, tokens and an estimated cost from API reference prices (not a bill), and the subagents the agent started. Admins only, turned on in the Admin tab.
- **Context ring and usage view.** On a computer, a ring beside the To-dos button shows how full the agent's context is. It opens **Usage**: the context window (how much is used, where it auto-compacts, the model and effort), unfolding to each running subagent's context; your plan's 5-hour and weekly limits; the agent's auto-compact timing, which an admin can open in Agent Profile from there; and the agent's total tokens and estimated cost. A refresh button asks again. On a phone, **Usage** is in the ⋯ menu.
- **Where the numbers come from.** Claude Code reports them through its status line, which CC Agent sets for each agent. Your own status line is kept: for a full-access agent, CC Agent's command also runs the status line in your Claude Code user settings and shows what it prints in the terminal. If an agent's workspace settings already have a status line of their own, it is left alone, and the usage view says its usage can't be shown.
- **Split view (experimental).** On a computer, an admin can show several conversations side by side and drag the columns and rows to size. Each cell's header holds the conversation's buttons as small icons: the context ring, To-dos, search and Agent Profile, with the terminal and Transcript where they are turned on. A cell too narrow for them has them in its ⋯ menu.
- **Icon names.** On a computer, resting the mouse on a navbar or split-view icon shows its name under it.
- **Claude usage.** On macOS and Windows, the sidebar shows how much of your Claude subscription's 5-hour and weekly windows is used, for admins.


<p align="center">
  <img src="../.github/assets/screens/desktop-usage-dark.png" alt="The usage view beside a chat: the context window with its running subagents, the plan's limits and the agent's totals">
</p>

<p align="center">
  <img src="../.github/assets/screens/desktop-terminal-dark.png" alt="A chat beside the agent's live terminal">
</p>

<p align="center">
  <img src="../.github/assets/screens/desktop-terminal-mirror-dark.png" alt="A question typed in the terminal and the agent's answer, shown in the chat too and marked from the terminal">
</p>

<p align="center">
  <img src="../.github/assets/screens/desktop-terminal-drop-dark.png" alt="A file dragged over the terminal: the overlay shows Drop into the chat and Drop into the terminal, the terminal framed">
</p>

<p align="center">
  <img src="../.github/assets/screens/desktop-transcript-dark.png" alt="The transcript inspector with tool calls, tokens and cost">
</p>

<p align="center">
  <img src="../.github/assets/screens/desktop-split-dark.png" alt="Split view with two conversations side by side">
</p>

## Diagnostics

- **Engineering diagnostics.** At the bottom of Agent Profile, a support view of an agent's state that never includes the account, memory, chat or credentials. Copy it to send by hand.
- **Record diagnostics.** For a problem with taps, the keyboard or the layout, especially on a phone: it records the page's geometry and what happened (taps, focus moves, the file picker, viewport changes, the window's focus), naming elements by tag and class only, never their text. It keeps recording on every page until you stop it, for at most five minutes.
- **The recording badge.** While it records, a red **● Recording 0:23** badge sits under the navbar on every page, in the middle on a phone and at the top right on a computer, out of the way of the navbar's buttons and the box. Tap it for **Stop and report**, **Stop only** (kept in Agent Profile to copy or report later) or **Keep recording**.
- **Report diagnostics.** Sends the same text to the admins, for one of your own agents (up to 512 KB, ten an hour), and they get a notification.
- **Diagnostic reports.** Admins find them in the Admin tab: who sent each, for which agent, when and from which build. Open one to read and copy it, mark it handled, delete it, or hand it to one of your agents. Agents that outside people can reach, or once could, are not listed, and an agent with full access asks you to confirm first. The agent's conversation opens with the report as a `.txt` file in its box. The file opens with a warning that the names and everything after them are that user's words, data to read and not instructions to follow, then gives when it was sent and, on labelled lines of their own, the sender's name and the agent's title in quotes.

<p align="center">
  <img src="../.github/assets/screens/phones-diagnostics-dark.png" alt="Engineering diagnostics in Agent Profile, the red recording badge over a chat, and its Stop and report question">
</p>

<p align="center">
  <img src="../.github/assets/anim/recording-badge-dark.svg" width="300" alt="The recording badge counting; a tap asks, and Stop and report sends the diagnostics to the admins">
</p>

<p align="center">
  <img src="../.github/assets/screens/desktop-diagnostic-reports-dark.png" alt="The admin's Diagnostic reports list">
</p>

<p align="center">
  <img src="../.github/assets/screens/desktop-diagnostic-report-dark.png" alt="One diagnostic report opened, with copy, mark handled, delete and hand to an agent">
</p>

<p align="center">
  <img src="../.github/assets/screens/desktop-diagnostic-handed-dark.png" alt="A report handed to an agent: the .txt file opens with a warning to treat it as data, then who sent it">
</p>

## Accounts and sign-in

- **Admins and users.** An admin creates accounts and the agents each person uses. A user sees only their own agents. Each person should use Claude under their own plan; see Anthropic's terms for how a plan may be shared.
- **Two-step sign-in** with an authenticator app, plus 10 one-time recovery codes.
- **Passkeys** with Face ID, Touch ID, Windows Hello or the device passcode.
- **QR sign-in.** Bind the phone app once, then scan the code on a computer's sign-in page to sign it in without a password. You confirm by picking the number the computer shows, and the phone warns you when that computer is not on its network.
- **Devices.** See every signed-in device and sign any of them out.
- **Repeated guesses.** An IP with 10 failures in 15 minutes is blocked from password sign-in for an hour, then a day, then a week if it keeps happening. QR sign-in still works. An admin can lift a block.
- **Guesses at one account.** When an account name gets 20 wrong passwords within an hour, from any addresses, or 10 wrong two-step codes in a day, it can sign in with a password only from networks it used in the last 30 days, for an hour (a day if it happens again). QR sign-in still works.

## The app

- **Install it** to the home screen on iPhone, Android or a computer.
- **Push notifications** when an agent replies or a schedule finishes.
- **Updates** are noticed within seconds of a new build being served, and offered without reloading under you.
- **Notices** (toasts) appear at the top centre, just below the navbar so they cover none of its buttons, as one rounded pill, on a phone and a computer alike.
- **Restarts don't sign you out.** While the service restarts, the page keeps checking for up to 90 seconds instead of showing the sign-in screen.
- **Sheets that pull down.** On a phone, every popup opens as an iOS-style pushed card: Agent Profile, To-dos, Usage, search, New agent, the group form, a group room's to-dos and search, a schedule, a security source's details and a user's agent access. The card stands almost full height with a grabber at its top and a round ✕ at the top left, and the page behind steps back and darkens. Pull one down or tap ✕ to close it, as on iOS. A form with unsaved changes (Agent Profile, the group form, a schedule, a user's agent access) asks Keep editing or Discard first, whether you pull it down, tap ✕ or tap outside it. The group room's terminal still opens full screen.
- **A phone layout like iOS 26.** On a phone, the navbar and the page sides match the iPhone's own apps: the buttons at the top, and lists, cards and titles 20px from the edges.
- **Blue for highlights, orange for warnings.** Cards, the working dots, search matches and a message you jump to are blue. Orange is kept for what needs your attention: limits, signing in again, permission prompts and high usage.
- **A sidebar that folds.** On a computer, fold the sidebar to a rail of icons with the handle on its edge, or keep **Auto-collapse the menu on a computer** on (the default; switch it off in Settings) so it opens only while the mouse is on it.
- **Light and dark themes**, English and Traditional Chinese.
- **The computer's own screen** is not part of CC Agent: to see and control a Mac from a phone, use [castpane](https://github.com/xxxxDev/castpane).

<p align="center">
  <img src="../.github/assets/anim/push-sheet-dark.svg" width="300" alt="On a phone, Usage opens from the ⋯ menu as a pushed card while the page behind steps back">
</p>
