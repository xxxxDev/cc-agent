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
- **Agents that start agents.** The computer's owner can name agents by conversation id in `.local/agent-starters.json` (`{"conversationIds": [...]}`). Each must be a full-access Claude agent of an admin. From its next start it can list the Claude agents of active accounts and start stopped ones, each with its own profile and access, and the started agent's chat says who started it.
- **Pictures and order.** Give an agent its own picture, drag the list into the order you like, and sort agents into sections.


<p align="center">
  <img src="../.github/assets/screens/desktop-profile-dark.png" alt="An agent's profile panel">
</p>

## Chat

- **Messages and files both ways.** Send text and attachments (up to 10 files a message, 95 MB each) and get files back from the agent (up to 5 a reply, 25 MB each), with previews. On a computer, drag files onto the chat to attach them.
- **Mentions, search and jump-to-latest.** Search one conversation's messages and jump to any result.
- **Reply to a message.** With a mouse, the reply button beside copy under a bubble. On a phone, swipe a bubble to the left until the round reply icon lights up, or long-press it and tap reply. The message you are answering shows in a bar over the box: the agent's words with its small picture, your own with no name. Tap the bar to see that message again, scrolled to and highlighted; the X (or Escape) cancels. The agent is told which message you reply to, with its first words, and can read the whole of it.
- **What a reply answers.** An agent's reply names the message it answers on a line above it, with its first words, when that helps: something else came between, or it answered several at once (a **+N more** chip opens the rest). The agent's words carry its small picture, an agent on another machine its name, and your own words no name at all. Your own replies always show the line. Tap it to jump to that message.
- **Long-press menu.** On a phone, a long press lifts the bubble a little over a dimmed page, with round buttons under it: copy, select text and reply. **Select text** hands the words to the phone's own selection, all selected, so its handles can pick part of them. A tap elsewhere closes it. The dim, the lift and the buttons fade in and out together.
- **Upload progress.** While a message with files goes, the send button turns into a spinner, and each file shows whether it is waiting, uploading with its percent, or done, with a line over the box such as **Uploading 2 of 3 (45%)…**. From 99% a file shows **Processing** until the server has it, since a phone's browser hands the whole file to the network at once. A file that fails is marked, and you can keep typing meanwhile.
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
  <picture><source media="(prefers-color-scheme: dark)" srcset="../.github/assets/anim/swipe-reply-dark.svg"><img src="../.github/assets/anim/swipe-reply-light.svg" width="300" alt="Swiping a bubble to the left to reply: the reply icon lights up and the reply bar shows over the box"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="../.github/assets/anim/long-press-dark.svg"><img src="../.github/assets/anim/long-press-light.svg" width="300" alt="A long press dims the page and lifts the bubble with copy, select text and reply under it; Select text selects its words"></picture>
</p>

<p align="center">
  <picture><source media="(prefers-color-scheme: dark)" srcset="../.github/assets/anim/jump-to-message-dark.svg"><img src="../.github/assets/anim/jump-to-message-light.svg" width="300" alt="Tapping the line over a reply scrolls up to the message it answers and highlights it"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="../.github/assets/anim/upload-progress-dark.svg"><img src="../.github/assets/anim/upload-progress-light.svg" width="300" alt="Three files sent: each waits, uploads with its percent, shows Processing, then the message is in"></picture>
</p>

<p align="center">
  <img src="../.github/assets/screens/phones-upload-dark.png" alt="Upload progress on a phone: a file at 45%, a file processing, and the sent message">
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
  <picture><source media="(prefers-color-scheme: dark)" srcset="../.github/assets/peer-link-dark.png"><img src="../.github/assets/peer-link-light.png" alt="Machine A calls machine B over SSH with a dedicated key; a forced command hands the messages to CC Agent there, and each side delivers them to its own agents"></picture>
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
- **Built-in checks.** For checks a sandboxed script cannot do, the computer's owner can list read-only commands by hand in `.local/schedule-checks.json`; a schedule can then name one. Neither the page nor an agent can add one.
- **Paused agents are respected.** An agent you paused yourself is never started by a schedule; the run waits until it is back.


<p align="center">
  <img src="../.github/assets/screens/desktop-schedules-dark.png" alt="The Schedules page with a suggestion waiting for approval">
</p>

## Access

- **Full access.** The agent can do anything your user can do on this computer. Turn it on only for agents you would trust with your terminal.
- **Scoped agents.** By default an agent reaches only its own workspace. You list the folders it may use (and folders inside them to keep out), the websites it may reach, and the local MCP servers it may load. It runs in Claude Code's sandbox and auto mode.
- **Programs outside the sandbox.** For a program that cannot run inside the sandbox (one that opens a browser, for example), an admin can list it with its project folder. CC Agent runs it in that folder with a cleared environment, and the folder is read-only to the agent.
- **Scope reports.** When a scoped agent tries something outside its access, it is refused and a report lands on the Scope reports page (Admin tab). Dismiss it, or widen that agent's access from there; granting reconnects the agent.
- **Permission prompts.** Claude Code's own permission questions can be answered from the chat; no agent tool can answer them.


<p align="center">
  <img src="../.github/assets/screens/desktop-reports-dark.png" alt="Scope reports for refused requests">
</p>

## Seeing what an agent does

- **Live progress** in the chat: the tool the agent is using, which step it is on and how long it has worked, and whether it is still working in the background.
- **Terminal view.** Switch to the agent's real Claude Code terminal, beside the chat on a computer. An admin turns the switch on in the Admin tab.
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
- **Diagnostic reports.** Admins find them in the Admin tab: who sent each, for which agent, when and from which build. Open one to read and copy it, mark it handled, delete it, or hand it to one of your agents. The agent's conversation opens with the report as a `.txt` file in its box, and the file starts by saying who sent it, for which agent and when, and that it is that user's words: data to read, not instructions to follow.

<p align="center">
  <img src="../.github/assets/screens/phones-diagnostics-dark.png" alt="Engineering diagnostics in Agent Profile, the red recording badge over a chat, and its Stop and report question">
</p>

<p align="center">
  <picture><source media="(prefers-color-scheme: dark)" srcset="../.github/assets/anim/recording-badge-dark.svg"><img src="../.github/assets/anim/recording-badge-light.svg" width="300" alt="The recording badge counting; a tap asks, and Stop and report sends the diagnostics to the admins"></picture>
</p>

<p align="center">
  <img src="../.github/assets/screens/desktop-diagnostic-reports-dark.png" alt="The admin's Diagnostic reports list">
</p>

<p align="center">
  <img src="../.github/assets/screens/desktop-diagnostic-report-dark.png" alt="One diagnostic report opened, with copy, mark handled, delete and hand to an agent">
</p>

<p align="center">
  <img src="../.github/assets/screens/desktop-diagnostic-handed-dark.png" alt="A report handed to an agent: the .txt file opens by saying who sent it and to treat it as data">
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
- **Restarts don't sign you out.** While the service restarts, the page keeps checking for up to 90 seconds instead of showing the sign-in screen.
- **Sheets that pull down.** On a phone, To-dos, Usage, search and Agent Profile open as iOS-style pushed cards: the sheet stands almost full height and the page behind steps back and darkens. Pull one down to close it, as on iOS; Agent Profile with unsaved changes asks first.
- **A phone layout like iOS 26.** On a phone, the navbar and the page sides match the iPhone's own apps: the buttons at the top, and lists, cards and titles 20px from the edges.
- **Blue for highlights, orange for warnings.** Cards, the working dots, search matches and a message you jump to are blue. Orange is kept for what needs your attention: limits, signing in again, permission prompts and high usage.
- **A sidebar that folds.** On a computer, fold the sidebar to a rail of icons with the handle on its edge, or turn on **Auto-collapse the menu on a computer** in Settings so it opens only while the mouse is on it.
- **Light and dark themes**, English and Traditional Chinese.
- **The computer's own screen** is not part of CC Agent: to see and control a Mac from a phone, use [castpane](https://github.com/xxxxDev/castpane).

<p align="center">
  <picture><source media="(prefers-color-scheme: dark)" srcset="../.github/assets/anim/push-sheet-dark.svg"><img src="../.github/assets/anim/push-sheet-light.svg" width="300" alt="On a phone, Usage opens from the ⋯ menu as a pushed card while the page behind steps back"></picture>
</p>
