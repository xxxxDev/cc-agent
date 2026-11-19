// Only classify the locally authorized startup notices. Never generic Enter.
// A folder CC Agent added itself (--add-dir, the folders an admin gave a scoped agent and its own
// temp and reference folders): Claude Code 2.1.327 asks at each launch whether to trust each one it
// has not trusted, and the answer holds for that launch only, so a scoped agent waited at it with
// no one there. Answered yes for exactly those folders, as the
// admin who gave them would; nothing is written for later sessions. Any other folder is left.
export function addedFolderConsent(screen,dirs,home=''){
 if(typeof screen!=='string'||!screen.includes('Adding a new directory:')||!screen.includes('Yes, add it')||/⏺|Do you want/.test(screen))return null;
 // The path: the lines after the title's (which may be the panel's top border) up to the text
 // below it, box characters and spaces set aside; a long one wraps, a short screen has no blank
 // lines around it.
 // The rest of the title's line is taken too: on a short screen the path may share it.
 const lines=screen.split('Adding a new directory:').pop().split('\n');
 const stop=lines.findIndex(l=>/This session hasn|This directory is part of|Its settings declare/.test(l));
 if(stop<0)return null;
 const shown=lines.slice(0,stop).join('').replace(/[│┃╭╮╰╯─━\s]/g,'');
 const flat=x=>x.replace(/\s/g,'');
 const dir=dirs.find(d=>flat(d)===shown||(home&&flat(d).startsWith(flat(home)+'/')&&'~'+flat(d).slice(flat(home).length)===shown));
 if(!dir)return null;
 if(/❯\s*Yes, add it/.test(screen))return {dir,answer:'yes'};
 if(/❯\s*No, exit/.test(screen))return {dir,answer:'no'};
 return null;
}
export function startupConsent(screen,cwd){
 if(/^\s*Channels: server:executive\s*$/m.test(screen)&&screen.includes('WARNING: Loading development channels')&&screen.includes('❯ 1. I am using this for local development'))return 'channel';
 if(!screen.includes('Accessing workspace:')||!screen.includes('Yes, I trust this folder'))return null;
 const after=screen.split('Accessing workspace:')[1].replace(/^\s*\n/,'');
 const shown=after.split(/\n\s*\n/)[0].replace(/\s/g,'');
 if(shown!==cwd.replace(/\s/g,''))return null;
 if(screen.includes('❯ No, exit'))return 'workspace-no';
 if(screen.includes('❯ Yes, I trust this folder'))return 'workspace-yes';
 return null;
}

// The channel notice after start-up, held to its own shape: the loose start-up
// match also took a permission dialog or agent output carrying the three strings: its lines in
// order, close together, the two choices the last lines on the screen, and nothing of a permission
// dialog or of a conversation anywhere on it. Box borders and indents are set aside.
export function channelNoticeAlone(screen){
 if(typeof screen!=='string'||/Do you want|⏺/.test(screen))return false;
 const lines=screen.split('\n').map(l=>l.replace(/[│┃╭╮╰╯─━]/g,'').trim()).filter(Boolean);
 // Below the choices, at most two lines of key hints ("Enter to confirm · Esc to cancel").
 const hint=/^(?:(?:Enter|Esc|Tab|Space|↑\/?↓|←\/?→|Ctrl\+\w)\s+to\s+[a-z]+(?:\s+[a-z]+)?\s*(?:·\s*)?)+$/i;
 let n=lines.length;
 for(let k=0;k<2&&n&&hint.test(lines[n-1]);k++)n--;
 if(n<4||lines[n-1]!=='2. Exit'||lines[n-2]!=='❯ 1. I am using this for local development')return false;
 const isChannels=l=>l==='Channels: server:executive',isWarning=l=>l.endsWith('WARNING: Loading development channels');
 const channels=lines.slice(0,n).findLastIndex(isChannels),warning=lines.slice(0,n).findLastIndex(isWarning);
 return warning>=0&&channels>warning&&channels>=n-6&&warning>=n-12&&lines.filter(isChannels).length===1;
}

// What answers them (runner.mjs): the workspace prompt only during start-up; the channel notice
// only in its own shape (channelNoticeAlone), during start-up and, after it, while the channel has
// stopped asking for messages (channelGone), which is what a restart in the terminal
// (/restart after an update) leaves: unanswered, the session sat there with no channel. Each showing is answered once; gone from the screen, the next one
// is answered again. capture() gives the screen, keys(k) sends a key, onStarting() tells CC Agent
// a start-up is on its way (not after a restart in the terminal: the agent is ready).
// An answer that did not take (the notice still there 10 s on) is given again, three times at most;
// a screen with the notice's words but not its shape for 20 s is said once (onStuck), never left
// to sit silently: a newer Claude Code drawing it differently would otherwise leave the agent at
// it with no channel.
const ANSWER_AGAIN_MS=10000,ANSWER_TRIES=3,STUCK_MS=20000,ADDED_TRIES=8,ADDED_LOOKS=40;
export function consentWatcher({cwd,addedDirs=[],home='',capture,keys,startupUntil,channelGone=()=>false,onStarting=()=>{},onStuck=()=>{},onAddedStuck=()=>{},now=Date.now}){
 let answered='',answeredAt=0,tries=0,looseSince=0,stuckSaid=false;
 const addedState=new Map();let addedStuckSaid=false;
 return function look(){
  const screen=capture();if(typeof screen!=='string')return;
  const starting=now()<=startupUntil,consent=startupConsent(screen,cwd);
  const strict=channelNoticeAlone(screen);
  // Only while there is no channel (before its first poll, or gone): words an agent prints while its
  // channel works are not a notice, at start-up either.
  if(consent==='channel'&&!strict&&channelGone()){if(!looseSince)looseSince=now();else if(!stuckSaid&&now()-looseSince>=STUCK_MS){stuckSaid=true;onStuck();}}
  else looseSince=0;
  // Three answers and the notice still there: said too, not left silently.
  if(answered==='channel'&&strict&&tries>=ANSWER_TRIES&&!stuckSaid&&now()-answeredAt>=ANSWER_AGAIN_MS&&channelGone()){stuckSaid=true;onStuck();}
  if(answered==='channel'&&strict&&tries<ANSWER_TRIES&&now()-answeredAt>=ANSWER_AGAIN_MS)answered='';
  if(starting&&consent?.startsWith('workspace')&&answered!=='workspace'){if(consent==='workspace-no')keys('Down');keys('Enter');answered='workspace';onStarting();return;}
  // An added folder, during start-up only. Its choices wrap round, and
  // Claude Code takes Enter only straight after a move: so after each key two passes with the
  // question unchanged before the next (a Down not drawn yet would carry the mark back to No);
  // Down on "No, exit"; Enter only when "Yes, add it" is marked; and an Enter that
  // did not take is followed by Up and Down, so the next Enter comes straight after a move.
  // A question that stays is said once (onAddedStuck), with what was on the screen.
  const added=starting?addedFolderConsent(screen,addedDirs,home):null;
  // Start-up over with one still on the screen: said, not left to sit there silently.
  if(!starting&&!addedStuckSaid&&addedFolderConsent(screen,addedDirs,home)){addedStuckSaid=true;onAddedStuck(screen);return;}
  if(added){
   const st=addedState.get(added.dir)||{sends:0,looks:0,last:'',same:0,sent:''};addedState.set(added.dir,st);
   // The question's own part of the screen, so what else moves there does not count as a change.
   const part=screen.slice(screen.lastIndexOf('Adding a new directory:'));
   st.same=part===st.last?st.same+1:0;st.last=part;st.looks++;
   if(st.sends>=ADDED_TRIES||st.looks>ADDED_LOOKS){if(!addedStuckSaid){addedStuckSaid=true;onAddedStuck(screen);}return;}
   // After any key, two passes with the question unchanged before the next: what was sent has
   // been drawn by then.
   if(st.sent&&st.same<2)return;
   if(added.answer==='no'){keys('Down');st.sent='Down';st.sends++;st.same=0;return;}
   if(!st.sent&&st.same<1)return;
   if(st.sent==='Enter'){keys('Up');keys('Down');st.sent='Down';st.sends++;st.same=0;return;}
   keys('Enter');st.sent='Enter';st.sends++;st.same=0;onStarting();return;
  }
  // Held to its own shape at start-up too, as checked against Claude Code's real start-up screen:
  // the loose words alone could take another dialog carrying them.
  const channel=strict&&(starting||channelGone());
  if(channel&&answered!=='channel'){keys('Enter');if(answeredAt&&now()-answeredAt<ANSWER_AGAIN_MS*2)tries++;else tries=1;answered='channel';answeredAt=now();if(starting)onStarting();return;}
  if(!starting&&!channel&&consent!=='channel'&&answered)answered='';
 };
}
