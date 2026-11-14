// Only classify the two locally authorized startup notices. Never generic Enter.
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
// during start-up as before, and after it only in its own shape (channelNoticeAlone) and while the
// channel has stopped asking for messages (channelGone), which is what a restart in the terminal
// (/restart after an update) leaves: unanswered, the session sat there with no channel. Each showing is answered once; gone from the screen, the next one
// is answered again. capture() gives the screen, keys(k) sends a key, onStarting() tells CC Agent
// a start-up is on its way (not after a restart in the terminal: the agent is ready).
export function consentWatcher({cwd,capture,keys,startupUntil,channelGone=()=>false,onStarting=()=>{},now=Date.now}){
 let answered='';
 return function look(){
  const screen=capture();if(typeof screen!=='string')return;
  const starting=now()<=startupUntil,consent=startupConsent(screen,cwd);
  if(starting&&consent?.startsWith('workspace')&&answered!=='workspace'){if(consent==='workspace-no')keys('Down');keys('Enter');answered='workspace';onStarting();return;}
  const channel=starting?consent==='channel':channelNoticeAlone(screen)&&channelGone();
  if(channel&&answered!=='channel'){keys('Enter');answered='channel';if(starting)onStarting();return;}
  if(!starting&&!channel&&consent!=='channel'&&answered)answered='';
 };
}
