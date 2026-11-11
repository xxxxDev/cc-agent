<template>
  <!-- Long-term schedules: an agent proposes one, an admin approves it, and the server
       then sends its instruction into that agent's conversation when it is due. -->
  <f7-page name="schedules" class="page-large-static" @page:afterin="load">
    <f7-navbar large>
      <f7-nav-title sliding>{{ t('tabSchedules') }}</f7-nav-title>
      <f7-nav-right v-if="canEdit"><f7-link icon-only icon-f7="plus" class="schedule-add" :aria-label="ct('新增排程')" @click="openNew" /></f7-nav-right>
      <f7-nav-title-large>{{ t('tabSchedules') }}</f7-nav-title-large>
    </f7-navbar>

    <f7-block v-if="!loaded && !error" class="schedule-state"><f7-preloader /></f7-block>
    <f7-block v-else-if="!loaded" class="schedule-state schedule-error">{{ error }}</f7-block>
    <f7-block v-else-if="!schedules.length" class="schedule-empty">{{ canEdit ? ct('還沒有排程。你可以按 + 新增，或在對話中同意 Agent 建議的排程，它會出現在這裡。') : ct('還沒有排程。在對話中同意 Agent 建議的排程後，它會出現在這裡。') }}</f7-block>
    <template v-else>
      <template v-if="pending.length">
        <f7-block-title class="pending-title">{{ ct('待核准') }}<span class="badge color-orange pending-count">{{ pending.length }}</span></f7-block-title>
        <f7-list inset media-list class="schedule-list pending-list">
          <f7-list-item v-for="s in pending" :key="s.id" link="#" :data-id="s.id" :class="{ 'schedule-focused': flashed === s.id }" :text="s.reason || ''" @click.prevent="openSheet(s)">
            <template #title><i class="icon f7-icons kind-icon" :data-icon="kindIcon(s)" aria-hidden="true"></i>{{ s.name }}<i v-if="s.quiet" class="icon f7-icons quiet-icon" data-icon="moon_fill" role="img" :aria-label="quietText(s.quiet)" :title="quietText(s.quiet)"></i></template>
            <template #subtitle>{{ s.agentTitle || agentTitle(s.conversationId) }} · <template v-if="kindName(s)">{{ kindName(s) }} · </template>{{ freq(s.frequency) }}<template v-if="s.until"> · {{ untilText(s.until, zh) }}</template></template>
          </f7-list-item>
        </f7-list>
      </template>

      <template v-for="g in groups" :key="g.id">
        <f7-block-title class="agent-title">{{ g.title }}</f7-block-title>
        <f7-list inset media-list class="schedule-list">
          <f7-list-item v-for="s in g.items" :key="s.id" :swipeout="canEdit" :data-id="s.id" class="schedule-row" :class="{ 'schedule-off': s.status === 'off', 'schedule-focused': flashed === s.id }" @click="rowTap($event, s)" @swipeout="swiped">
            <template #title><i class="icon f7-icons kind-icon" :data-icon="kindIcon(s)" aria-hidden="true"></i>{{ s.name }}<i v-if="s.quiet" class="icon f7-icons quiet-icon" data-icon="moon_fill" role="img" :aria-label="quietText(s.quiet)" :title="quietText(s.quiet)"></i></template>
            <!-- The switch is on the row but is not a tap on it. -->
            <template v-if="canEdit" #after><label class="toggle" @click.stop><input type="checkbox" :aria-label="ct('啟用') + ' ' + s.name" :checked="s.status === 'active'" @change="toggle(s, $event.target.checked)" /><span class="toggle-icon"></span></label></template>
            <template #subtitle>{{ freq(s.frequency) }}<template v-if="s.until"> · {{ untilText(s.until, zh) }}</template><template v-if="s.running"> · <span class="running">{{ ct('執行中') }}</span></template><template v-else-if="s.status === 'active' && s.nextAt"> · {{ ct('下次') }} {{ shortTime(s.nextAt) }}</template><template v-else-if="s.status === 'off'"> · {{ ct('已停用') }}</template></template>
            <template #text><span v-if="kindName(s)" class="kind-line" :class="{ 'check-missing': s.check?.missing }">{{ kindLine(s) }}</span><a v-if="s.lastRun" href="#" class="last-run" :class="'outcome-' + s.lastRun.outcome" @click.prevent.stop="showRun(s)">{{ ct('上次') }} {{ shortTime(s.lastRun.at) }} · {{ outcomeText(s.lastRun.outcome) }}</a><span v-else class="last-run">{{ ct('尚未執行') }}</span></template>
            <f7-swipeout-actions v-if="canEdit" right class="schedule-swipe">
              <f7-swipeout-button close class="swipe-round edit" :aria-label="ct('編輯') + ' ' + s.name" @click="swipeEdit($event, s)"><span class="swipe-circle"><i class="icon f7-icons">pencil</i></span></f7-swipeout-button>
              <f7-swipeout-button close class="swipe-round delete" :aria-label="ct('刪除') + ' ' + s.name" @click="swipeDelete($event, s)"><span class="swipe-circle"><i class="icon f7-icons">trash_fill</i></span></f7-swipeout-button>
            </f7-swipeout-actions>
          </f7-list-item>
        </f7-list>
      </template>
    </template>

    <!-- At the app root, like the other popups here: Framework7 moves an open popup
         out of the page, which leaves Vue's page render broken after it closes. -->
    <Teleport to=".framework7-root">
      <!-- On a phone a pushed card, as Agent Profile is (sheetSwipe.js); its ✕, a backdrop
           tap and a pull down ask first about unsaved changes. -->
      <f7-popup ref="sheetPopup" :opened="sheetOpen" class="schedule-sheet" :class="{ 'sheet-swipe': sheetSwipe }" :close-by-backdrop-click="false" :swipe-to-close="sheetSwipe" :push="sheetSwipe" @popup:closed="closed">
        <div v-if="sheetSwipe" class="sheet-grabber" aria-hidden="true"></div>
        <f7-page v-if="draft">
          <f7-navbar>
            <f7-nav-left><f7-link icon-only icon-f7="xmark" class="schedule-close" :aria-label="ct('關閉')" @click="closeSheet()" /></f7-nav-left>
            <f7-nav-title>{{ sheetTitle }}</f7-nav-title>
            <f7-nav-right><f7-link v-if="editable" class="schedule-save" :class="{ disabled: !ready || saving }" @click="save">{{ mode === 'approve' ? ct('核准') : ct('保存') }}</f7-link></f7-nav-right>
          </f7-navbar>

          <!-- A script's effects first, as they stand with the sheet's changes: what the
               owner has to see before approving it. -->
          <template v-if="runsAlone">
            <f7-block-title>{{ isCheck ? ct('這個檢查會') : isFeed ? ct('這個訂閱會') : ct('這個腳本會') }}</f7-block-title>
            <div class="list inset impact-card"><ul>
              <li v-if="isCheck" class="item-content impact-check"><div class="item-media"><i class="icon f7-icons">checkmark_shield</i></div><div class="item-inner"><div class="item-title">{{ checkRunText }}</div></div></li>
              <!-- The command itself, for the owner to read before approving; a change after approval stops the schedule. -->
              <li v-if="isCheck && checkCommand" class="item-content impact-command"><div class="item-media"><i class="icon f7-icons">chevron_left_slash_chevron_right</i></div><div class="item-inner"><div class="item-title"><code>{{ checkCommand }}</code></div></div></li>
              <li v-if="isCheck && draft.check?.changed" class="item-content impact-missing"><div class="item-media"><i class="icon f7-icons">exclamationmark_triangle_fill</i></div><div class="item-inner"><div class="item-title">{{ ct('這個檢查的指令在核准後改過，排程已停止執行；重新存檔即以現在的指令核准。') }}</div></div></li>
              <li v-if="isCheck && checkMissing" class="item-content impact-missing"><div class="item-media"><i class="icon f7-icons">exclamationmark_triangle_fill</i></div><div class="item-inner"><div class="item-title">{{ ct('你的本機設定裡已經沒有這個檢查，時間到時不會執行。') }}</div></div></li>
              <li v-if="isFeed" class="item-content impact-network"><div class="item-media"><i class="icon f7-icons">globe</i></div><div class="item-inner"><div class="item-title">{{ feedUrlOk ? ct('會讀取：') + hostOf(draft.feedUrl.trim()) : ct('填好 RSS 網址後才會讀取') }}</div></div></li>
              <li v-if="isFeed" class="item-content impact-feed"><div class="item-media"><i class="icon f7-icons">sparkles</i></div><div class="item-inner"><div class="item-title">{{ ct('只把沒看過的新文章交給 Agent，第一次交最新 3 篇') }}</div></div></li>
              <li v-if="isScript" class="item-content impact-network"><div class="item-media"><i class="icon f7-icons">globe</i></div><div class="item-inner"><div class="item-title">{{ scriptDomains.domains.length ? ct('會連線：') + listJoin(scriptDomains.domains) : ct('不會連網') }}</div></div></li>
              <li class="item-content impact-result"><div class="item-media"><i class="icon f7-icons">{{ draft.onResult === 'agent' ? 'bubble_left' : 'bell' }}</i></div><div class="item-inner"><div class="item-title">{{ draft.onResult === 'agent' ? ct('結果：交給 Agent 處理') : ct('結果：推播給你') }}</div></div></li>
              <li v-if="draft.onResult !== 'agent'" class="item-content impact-quiet"><div class="item-media"><i class="icon f7-icons">moon_zzz</i></div><div class="item-inner"><div class="item-title">{{ ct('不會叫醒 Agent') }}</div></div></li>
              <li v-if="runTimeout" class="item-content impact-timeout"><div class="item-media"><i class="icon f7-icons">timer</i></div><div class="item-inner"><div class="item-title">{{ ct('時間上限：') }}{{ seconds(runTimeout) }}</div></div></li>
            </ul></div>
          </template>

          <template v-if="mode === 'approve' && draft.reason">
            <f7-block-title>{{ ct('Agent 的理由') }}</f7-block-title>
            <f7-block strong inset class="schedule-reason">{{ draft.reason }}</f7-block>
          </template>

          <f7-list inset strong-ios class="schedule-fields">
            <!-- A new schedule sends a message, or runs one of the owner's built-in checks. -->
            <f7-list-input v-if="mode === 'new'" :label="ct('種類')" type="select" class="field-kind" :value="draft.kind" @update:value="setKind">
              <option value="agent">{{ ct('傳訊息給 Agent') }}</option>
              <option value="feed">{{ ct('RSS 訂閱') }}</option>
              <option v-if="checks.length" value="check">{{ ct('內建檢查') }}</option>
            </f7-list-input>
            <f7-list-input v-if="mode === 'new'" :label="'Agent'" type="select" class="field-agent" :value="draft.conversationId" @update:value="draft.conversationId = $event">
              <option value="" disabled>{{ ct('選擇 Agent') }}</option>
              <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.title }}</option>
            </f7-list-input>
            <f7-list-item v-else :title="'Agent'" :after="agentTitle(draft.conversationId) || draft.agentTitle" />
            <f7-list-input :label="ct('名稱')" class="field-name" :value="draft.name" :readonly="!editable" maxlength="80" :placeholder="ct('例如：每天早上整理信件')" @update:value="draft.name = $event" />
            <f7-list-input v-if="!runsAlone" :label="ct('指示')" type="textarea" class="field-prompt" :value="draft.prompt" :readonly="!editable" :resizable="true" rows="4" maxlength="8000" :placeholder="ct('時間到時送進這個 Agent 對話的文字')" @update:value="draft.prompt = $event" />
          </f7-list>

          <!-- The script is shown whole and read only: the owner approves this exact
               text, and only the agent can propose another. -->
          <template v-if="isScript">
            <f7-block-title>{{ ct('腳本') }}</f7-block-title>
            <div class="block block-strong inset script-block">
              <div class="script-head">
                <span class="script-lang">{{ interpreterLabel(draft.script.interpreter) }}</span>
                <a href="#" class="link script-copy" @click.prevent="copySource"><i class="icon f7-icons">doc_on_doc</i><span>{{ ct('複製') }}</span></a>
              </div>
              <!-- Every line wraps rather than scrolling sideways, so nothing that will run
                   is out of sight; shown as it is, unchanged. -->
              <pre class="script-source" :style="{ '--line-digits': String(scriptLines.length).length }"><span v-for="(line, n) in scriptLines" :key="n" class="script-line">{{ line }}</span></pre>
              <div class="script-hash" :title="draft.script.hash">{{ ct('指紋') }} {{ shortHash(draft.script.hash) }}</div>
            </div>
            <f7-block-footer class="schedule-detail">{{ ct('腳本內容不能在這裡修改；要改請讓 Agent 重新提議。') }}</f7-block-footer>
          </template>
          <template v-if="runsAlone">
            <f7-block-title>{{ ct('執行方式') }}</f7-block-title>
            <f7-list inset strong-ios class="schedule-fields">
              <f7-list-input v-if="isCheck && mode === 'new'" :label="ct('內建檢查')" type="select" class="field-check" :value="draft.checkId" :info="checkInfo?.description || ''" @update:value="setCheck">
                <option value="" disabled>{{ ct('選擇檢查') }}</option>
                <option v-for="c in checks" :key="c.id" :value="c.id">{{ c.name }}</option>
              </f7-list-input>
              <f7-list-input v-if="isScript" :label="ct('允許連線的網站')" type="textarea" class="field-domains" :value="draft.domainsText" :readonly="!editable" :resizable="true" rows="2" :placeholder="ct('一行一個，例如 feeds.example.com；留空就不連網')" :error-message="domainError" :error-message-force="!!domainError" @update:value="draft.domainsText = $event" />
              <f7-list-input v-if="isScript" :label="ct('時間上限（秒）')" type="number" class="field-timeout" min="5" max="600" step="1" :value="draft.timeout" :readonly="!editable" :error-message="ct('須為 5–600 秒')" :error-message-force="timeoutFor(draft.timeout) === null" @update:value="draft.timeout = $event" />
 <f7-list-input v-if="isFeed" :label="ct('RSS 網址')" type="url" class="field-feed" :value="draft.feedUrl" :readonly="!editable" placeholder="https://example.com/feed.xml" :error-message="ct('要是 http 或 https 的網址')" :error-message-force="!!draft.feedUrl.trim() && !feedUrlOk" @update:value="draft.feedUrl = $event" />
              <f7-list-input v-if="!isFeed" :label="ct('結果')" type="select" class="field-result" :value="draft.onResult" :disabled="!editable" @update:value="draft.onResult = $event">
                <option value="push">{{ ct('推播給你') }}</option>
                <option value="agent">{{ ct('交給 Agent') }}</option>
              </f7-list-input>
              <f7-list-input v-if="draft.onResult === 'agent'" :label="ct('交給 Agent 時的指示')" type="textarea" class="field-prompt" :value="draft.prompt" :readonly="!editable" :resizable="true" rows="3" maxlength="4000" :placeholder="isFeed ? ct('留空就是：整理新文章的重點告訴我') : ct('Agent 收到結果後要做什麼')" @update:value="draft.prompt = $event" />
            </f7-list>
          </template>

          <f7-block-title>{{ ct('頻率') }}</f7-block-title>
          <f7-list inset strong-ios class="schedule-fields">
            <f7-list-input :label="ct('頻率')" type="select" class="field-type" :value="draft.freq.type" :disabled="!editable" @update:value="setFrequencyType">
              <option value="daily">{{ ct('每天') }}</option>
              <option value="weekdays">{{ ct('週一到週五') }}</option>
              <option value="weekly">{{ ct('每週') }}</option>
              <option value="monthly">{{ ct('每月') }}</option>
              <option value="interval">{{ ct('每隔幾小時') }}</option>
            </f7-list-input>
            <li v-if="draft.freq.type === 'weekly'" class="weekday-row">
              <div class="item-content"><div class="item-inner">
                <div class="weekday-chips" role="group" :aria-label="ct('星期')">
                  <button v-for="d in WEEK_ORDER" :key="d" type="button" class="button button-small button-round weekday" :class="{ 'button-fill': draft.freq.days.includes(d) }" :aria-pressed="String(draft.freq.days.includes(d))" :disabled="!editable" @click="toggleDay(d)">{{ weekdayLabel(d, zh) }}</button>
                </div>
              </div></div>
            </li>
            <f7-list-input v-if="draft.freq.type === 'monthly'" :label="ct('每月幾號')" type="select" class="field-day" :value="String(draft.freq.day)" :disabled="!editable" @update:value="draft.freq.day = Number($event)">
              <option v-for="n in 31" :key="n" :value="String(n)">{{ zh ? n + ' 日' : n }}</option>
            </f7-list-input>
            <!-- Several fixed times a day, up to six. -->
            <template v-if="draft.freq.type !== 'interval'">
              <li v-for="(t, i) in draft.freq.times" :key="i" class="field-time field-time-row">
                <div class="item-content item-input"><div class="item-inner">
                  <div class="item-title item-label">{{ i ? ct('時間') + ' ' + (i + 1) : ct('時間') }}</div>
                  <div class="item-input-wrap time-with-remove">
                    <input type="time" :value="t" :readonly="!editable" :aria-label="ct('時間') + ' ' + (i + 1)" @input="draft.freq.times[i] = $event.target.value" />
                    <button v-if="editable && draft.freq.times.length > 1" type="button" class="time-remove" :aria-label="ct('移除這個時間')" @click="draft.freq.times.splice(i, 1)"><i class="icon f7-icons">minus_circle_fill</i></button>
                  </div>
                </div></div>
              </li>
              <li v-if="editable && draft.freq.times.length < 6" class="time-add-row"><div class="item-content"><div class="item-inner">
                <a href="#" class="time-add" @click.prevent="draft.freq.times.push(draft.freq.times.at(-1) || '09:00')"><i class="icon f7-icons">plus_circle</i>{{ ct('再加一個時間') }}</a>
              </div></div></li>
            </template>
            <f7-list-input v-else :label="ct('每隔幾小時')" type="number" class="field-hours" min="1" max="168" step="1" :value="draft.freq.hours" :readonly="!editable" @update:value="draft.freq.hours = $event" />
          </f7-list>

          <!-- A last day, and hours when its notifications wait: both optional. -->
          <f7-list inset strong-ios class="schedule-fields">
            <f7-list-input :label="ct('到期日')" type="date" class="field-until" :value="draft.until" :readonly="!editable" :error-message="ct('日期不正確')" :error-message-force="!!draft.until && !validDate(draft.until)" @update:value="draft.until = $event || ''" />
            <li class="field-quiet"><div class="item-content"><div class="item-inner">
              <div class="item-title">{{ ct('安靜時段') }}</div>
              <div class="item-after"><label class="toggle"><input type="checkbox" :aria-label="ct('安靜時段')" :checked="draft.quietOn" :disabled="!editable" @change="draft.quietOn = $event.target.checked" /><span class="toggle-icon"></span></label></div>
            </div></div></li>
            <template v-if="draft.quietOn">
              <f7-list-input :label="ct('從')" type="time" class="field-quiet-from" :value="draft.quietFrom" :readonly="!editable" @update:value="draft.quietFrom = $event" />
              <f7-list-input :label="ct('到')" type="time" class="field-quiet-to" :value="draft.quietTo" :readonly="!editable" :error-message="ct('開始與結束要不同')" :error-message-force="draft.quietFrom === draft.quietTo" @update:value="draft.quietTo = $event" />
            </template>
          </f7-list>
          <f7-block-footer class="schedule-detail schedule-limits">{{ draft.until ? ct('到期日當天之後就不再執行。') : ct('到期日留空就不會到期。') }}<a v-if="draft.until && editable" href="#" class="clear-until" @click.prevent="draft.until = ''">{{ ct('改成不到期') }}</a><template v-if="draft.quietOn">{{ '\n' + ct('這段時間的推播會等到時段結束才送。') }}</template></f7-block-footer>

          <!-- Whether the agent is running only matters when it is sent something. -->
          <f7-list v-if="!runsAlone || draft.onResult === 'agent'" inset strong-ios class="schedule-fields">
            <f7-list-input :label="ct('Agent 沒在執行時')" type="select" class="field-paused" :value="draft.whenPaused" :disabled="!editable" @update:value="draft.whenPaused = $event">
              <option value="start">{{ ct('先啟動再送') }}</option>
              <option value="wait">{{ ct('等它上線再送') }}</option>
              <option value="skip">{{ ct('跳過這次') }}</option>
            </f7-list-input>
          </f7-list>
          <f7-block-footer v-if="!runsAlone || draft.onResult === 'agent'" class="schedule-detail">{{ ct('你手動暫停的 Agent 不會被排程叫醒，會等它上線再送。') }}</f7-block-footer>

          <!-- A trial run, before approving too: the server runs the saved script in an
               empty state and sends nothing. -->
          <template v-if="runsAlone && editable && draft.id">
            <f7-block-title>{{ ct('試跑') }}</f7-block-title>
            <f7-block class="trial">
              <p class="trial-note">{{ ct('試跑用空白的狀態，不會推播，也不會交給 Agent。') }}<template v-if="trialStale"> {{ ct('網站與時間上限用已保存的設定，不含剛才的修改。') }}</template></p>
              <f7-button round outline class="trial-run" :disabled="testing || saving" @click="trial"><f7-preloader v-if="testing" :size="18" class="trial-spinner" /><span>{{ testing ? ct('試跑中…') : ct('試跑') }}</span></f7-button>
            </f7-block>
            <div v-if="trialResult" class="block block-strong inset trial-result" :class="trialResult.ok ? 'trial-ok' : 'trial-failed'">
              <div class="trial-status"><i class="icon f7-icons">{{ trialResult.ok ? 'checkmark_circle_fill' : 'xmark_circle_fill' }}</i><span>{{ trialResult.ok ? ct('成功') : trialResult.timedOut ? ct('逾時') : ct('失敗') }}<template v-if="trialResult.durationMs != null"> · {{ seconds(trialResult.durationMs / 1000) }}</template><template v-if="!trialResult.ok && trialResult.exitCode != null"> · {{ ct('結束碼') }} {{ trialResult.exitCode }}</template></span></div>
              <pre v-if="trialResult.ok && trialResult.json != null" class="trial-json">{{ JSON.stringify(trialResult.json, null, 2) }}</pre>
              <template v-else>
                <div v-if="trialResult.error" class="trial-error">{{ trialResult.error }}</div>
                <pre v-if="trialResult.stderrTail || trialResult.stdoutTail" class="trial-tail">{{ trialResult.stderrTail || trialResult.stdoutTail }}</pre>
              </template>
            </div>
          </template>

          <!-- Every recent run, newest first: what
               happened, why, and the message it sent, which opens that conversation. -->
          <template v-if="draft.runs?.length">
            <f7-block-title>{{ ct('執行紀錄') }}</f7-block-title>
            <div class="list inset schedule-runs"><ul>
              <li v-for="(run, i) in draft.runs" :key="run.at + i" :class="'outcome-' + run.outcome">
                <a v-if="run.messageId" href="#" class="item-link item-content run-row" @click.prevent="openRun(run)"><div class="item-inner"><div class="item-title">{{ shortTime(run.at) }}{{ run.manual ? ' · ' + ct('手動') : '' }}<div v-if="run.detail" class="item-footer">{{ run.detail }}</div></div><div class="item-after">{{ outcomeText(run.outcome) }}</div></div></a>
                <div v-else class="item-content run-row"><div class="item-inner"><div class="item-title">{{ shortTime(run.at) }}{{ run.manual ? ' · ' + ct('手動') : '' }}<div v-if="run.detail" class="item-footer">{{ run.detail }}</div></div><div class="item-after">{{ outcomeText(run.outcome) }}</div></div></div>
                <!-- What the script printed last, three lines until tapped. -->
                <pre v-if="run.output" class="run-output" :class="{ open: openOutputs[run.at + i] }" @click="openOutputs[run.at + i] = !openOutputs[run.at + i]"><span>{{ run.output }}</span></pre>
              </li>
            </ul></div>
          </template>
          <f7-block v-if="mode === 'edit' && editable && draft.id" class="sheet-actions">
            <f7-button round outline class="run-now" :disabled="saving || draft.waiting || draft.running" @click="runNow">{{ draft.running ? ct('執行中') : draft.waiting ? ct('等待執行中') : ct('立即執行') }}</f7-button>
          </f7-block>
          <f7-block v-if="mode === 'approve' && editable" class="sheet-actions">
            <f7-button fill round large class="approve" :disabled="!ready || saving" @click="save">{{ ct('核准') }}</f7-button>
            <f7-button round color="red" class="reject" :disabled="saving" @click="reject">{{ ct('拒絕') }}</f7-button>
          </f7-block>
          <f7-block v-else-if="mode === 'edit' && editable" class="sheet-actions">
            <f7-button round color="red" class="remove" :disabled="saving" @click="remove(draft)">{{ ct('刪除排程') }}</f7-button>
          </f7-block>
        </f7-page>
      </f7-popup>
    </Teleport>
  </f7-page>
</template>

<script setup>
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch, Teleport } from 'vue';
import { f7 } from 'framework7-vue';
import { api } from '../js/api.js';
import { t, lang } from '../js/i18n.js';
import { ct, listJoin } from '../js/agent-i18n.js';
import { activeTab } from '../js/tab-session.js';
import { sheetSwipe, guardSheet, closeAsking } from '../js/sheetSwipe.js';
import { MAX_DOMAINS, WEEKDAYS, WEEK_ORDER, editableFrequency, frequencyFor, frequencyText, interpreterLabel, parseDomains, scheduleFocus, shortHash, shortTime, timeoutFor, untilText, validDate, validTime, weekdayLabel } from '../js/schedules.js';

const workspace = inject('workspace', null);
const zh = computed(() => lang.value === 'zh-TW');
const freq = (f) => frequencyText(f, zh.value);
const toast = (text) => f7.toast.create({ text, closeTimeout: 1800 }).open();
const alertError = (e) => f7.dialog.alert(e?.message || String(e));
const OUTCOMES = { sent: '已送給 Agent', notified: '已推播', nothing: '沒有新結果', skipped: '已跳過', failed: '失敗' };
const outcomeText = (o) => ct(OUTCOMES[o] || o || '');
// A message to the agent, a background script, or one of the owner's built-in
// checks (f7-icons has no terminal glyph; this is the one the chat's terminal
// switch uses).
const KIND_ICONS = { script: 'chevron_left_slash_chevron_right', check: 'checkmark_shield', feed: 'dot_radiowaves_left_right' };
const kindIcon = (s) => KIND_ICONS[s.kind] || 'bubble_left';
const kindName = (s) => (s.kind === 'script' ? ct('後台腳本') : s.kind === 'check' ? ct('內建檢查') : s.kind === 'feed' ? ct('RSS 訂閱') : '');
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };
const kindLine = (s) => [kindName(s), s.kind === 'check' ? s.check?.name || s.check?.id : s.kind === 'feed' ? s.feed?.title || hostOf(s.feed?.url) : '', s.onResult === 'agent' ? ct('交給 Agent') : ct('推播給你')].filter(Boolean).join(' · ');
const quietText = (q) => ct('安靜時段') + ' ' + q.from + '–' + q.to;
// Seconds as the sheet shows them: one decimal under ten.
const seconds = (n) => {
  const v = Number(n) || 0;
  const text = v < 10 && !Number.isInteger(v) ? v.toFixed(1) : String(Math.round(v));
  return zh.value ? `${text} 秒` : `${text}s`;
};

const schedules = ref([]);
const agents = ref([]);
// The built-in checks the owner has set up (admins only).
const checks = ref([]);
const canEdit = ref(false);
const loaded = ref(false);
const error = ref('');

const agentTitle = (id) => agents.value.find((a) => a.id === id)?.title || '';
const pending = computed(() => schedules.value.filter((s) => s.status === 'pending'));
// One group per agent, in the order the server lists its agents.
const groups = computed(() => {
  const byAgent = new Map();
  for (const s of schedules.value) {
    if (s.status === 'pending') continue;
    if (!byAgent.has(s.conversationId)) byAgent.set(s.conversationId, { id: s.conversationId, title: agentTitle(s.conversationId) || s.agentTitle || '', items: [] });
    byAgent.get(s.conversationId).items.push(s);
  }
  const order = agents.value.map((a) => a.id);
  const rank = (id) => (order.includes(id) ? order.indexOf(id) : order.length);
  return [...byAgent.values()].sort((a, b) => rank(a.id) - rank(b.id));
});

// A reload while one is running waits for it instead of racing it.
let loading = null;
async function load() {
  if (loading) return loading;
  loading = (async () => {
    try {
      const data = await api('/schedules');
      schedules.value = data.schedules || [];
      agents.value = data.agents || [];
      checks.value = data.checks || [];
      canEdit.value = !!data.canEdit;
      loaded.value = true;
      error.value = '';
      takeFocus();
    } catch (e) {
      // A refresh that fails keeps what is on screen; only the first load says so.
      if (!loaded.value) error.value = e.message;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

// Loaded whenever the tab is shown, when the server says something changed, and
// every 20 s while it is on screen.
const onScreen = () => activeTab.value === 'view-schedules' && !document.hidden;
let lastChanged = 0;
function onChanged() {
  if (!onScreen() || Date.now() - lastChanged < 3000) return;
  lastChanged = Date.now();
  load();
}
let timer = null;
onMounted(() => {
  load();
  window.addEventListener('cc-agent-changed', onChanged);
  timer = setInterval(() => { if (onScreen()) load(); }, 20000);
});
onUnmounted(() => { window.removeEventListener('cc-agent-changed', onChanged); clearInterval(timer); });
watch(activeTab, (tab) => { if (tab === 'view-schedules') load(); });

// A notification's schedule: a proposal opens to be approved; one already decided
// is only pointed out.
const flashed = ref(null);
watch(scheduleFocus, () => { if (loaded.value) takeFocus(); });
function takeFocus() {
  const id = scheduleFocus.value;
  if (!id) return;
  scheduleFocus.value = null;
  const s = schedules.value.find((x) => x.id === id);
  if (!s) { toast(ct('這個排程已經處理過了')); return; }
  if (s.status === 'pending' && canEdit.value) { openSheet(s); return; }
  flashed.value = id;
  nextTick(() => document.querySelector(`#view-schedules .schedule-list li[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' }));
  setTimeout(() => { if (flashed.value === id) flashed.value = null; }, 2600);
}

async function toggle(s, on) {
  const previous = s.status;
  s.status = on ? 'active' : 'off';
  try {
    replace((await api(`/schedules/${encodeURIComponent(s.id)}`, { method: 'PATCH', body: JSON.stringify({ enabled: on }) })).schedule);
  } catch (e) {
    s.status = previous;
    alertError(e);
  }
}
function replace(next) {
  if (!next?.id) return;
  const at = schedules.value.findIndex((x) => x.id === next.id);
  if (at >= 0) schedules.value.splice(at, 1, next);
  else schedules.value.push(next);
}

function showRun(s) {
  const run = s.lastRun;
  f7.dialog.alert([shortTime(run.at), run.detail].filter(Boolean).join('\n'), outcomeText(run.outcome));
}

// A mouse swipe ends in a click on the row it dragged, and a tap on a row whose
// buttons are showing closes them; neither opens the sheet (as ChatListPage does).
let lastSwipe = 0;
const swiped = () => { lastSwipe = Date.now(); };
function rowTap(event, s) {
  if (Date.now() - lastSwipe < 400 || event?.target?.closest?.('li')?.classList.contains('swipeout-opened')) return;
  openSheet(s);
}
const quiet = (e) => { e?.stopPropagation?.(); e?.preventDefault?.(); };
function swipeEdit(e, s) { quiet(e); openSheet(s); }
function swipeDelete(e, s) { quiet(e); remove(s); }

// The sheet: 'new', 'edit' or 'approve'. A member sees it with nothing to change.
const sheetOpen = ref(false);
const draft = ref(null);
const mode = ref('edit');
const saving = ref(false);
const editable = computed(() => canEdit.value);
const sheetTitle = computed(() => (mode.value === 'new' ? ct('新增排程') : mode.value === 'approve' ? ct('核准排程') : editable.value ? ct('編輯排程') : ct('排程')));
const frequency = computed(() => (draft.value ? frequencyFor(draft.value.freq) : null));
const isScript = computed(() => draft.value?.kind === 'script');
const isCheck = computed(() => draft.value?.kind === 'check');
// An RSS subscription: CC Agent reads it; new entries go to the agent.
const isFeed = computed(() => draft.value?.kind === 'feed');
const feedUrlOk = computed(() => { try { return ['http:', 'https:'].includes(new URL(draft.value?.feedUrl?.trim() || '').protocol); } catch { return false; } });
// Kinds that run on their own and push or hand over a result.
const runsAlone = computed(() => isScript.value || isCheck.value || isFeed.value);
const checkInfo = computed(() => (isCheck.value ? checks.value.find((c) => c.id === draft.value.checkId) || null : null));
const checkCommand = computed(() => { const cmd = draft.value.check?.command || checkInfo.value?.command; return Array.isArray(cmd) ? cmd.map((a) => (/[\s'"]/.test(a) ? JSON.stringify(a) : a)).join(' ') : ''; });
const checkMissing = computed(() => isCheck.value && (!!draft.value.check?.missing || (!!draft.value.checkId && checks.value.length > 0 && !checkInfo.value)));
const checkRunText = computed(() => {
  const name = checkInfo.value?.name || draft.value.check?.name || draft.value.checkId || '';
  return zh.value ? `執行：內建檢查「${name}」（由你在本機設定，不在沙盒內）` : `Runs: the built-in check "${name}" (set up by you on this machine, not in the sandbox)`;
});
const runTimeout = computed(() => (isScript.value ? timeoutFor(draft.value.timeout) ?? draft.value.script.timeoutSeconds : checkInfo.value?.timeoutSeconds || null));
const scriptLines = computed(() => (isScript.value ? draft.value.script.source.split('\n') : []));
const scriptDomains = computed(() => parseDomains(isScript.value ? draft.value.domainsText : ''));
const domainError = computed(() => {
  const { domains, bad } = scriptDomains.value;
  if (bad.length) return ct('不是網站名稱：') + listJoin(bad);
  return domains.length > MAX_DOMAINS ? ct('最多 10 個網站') : '';
});
// A script needs no instruction of its own; its settings have to be valid instead.
const ready = computed(() => {
  const d = draft.value;
  if (!d || !d.conversationId || !d.name.trim() || !frequency.value) return false;
  if (d.until && !validDate(d.until)) return false;
  if (d.quietOn && (!validTime(d.quietFrom) || !validTime(d.quietTo) || d.quietFrom === d.quietTo)) return false;
  if (isScript.value) return !domainError.value && timeoutFor(d.timeout) !== null;
  if (isCheck.value) return !!d.checkId;
  if (isFeed.value) return feedUrlOk.value;
  return !!d.prompt.trim();
});
// The expiry and quiet hours as the server takes them.
const untilValue = (d) => d.until || null;
const quietValue = (d) => (d.quietOn ? { from: d.quietFrom, to: d.quietTo } : null);
const limits = (s = {}) => ({ until: s.until || '', quietOn: !!s.quiet, quietFrom: s.quiet?.from || '22:00', quietTo: s.quiet?.to || '07:00', saved: { until: s.until || null, quiet: s.quiet || null } });

function openSheet(s) {
  mode.value = s.status === 'pending' ? 'approve' : 'edit';
  draft.value = { id: s.id, conversationId: s.conversationId, agentTitle: s.agentTitle, name: s.name || '', prompt: s.prompt || '', reason: s.reason || '', whenPaused: s.whenPaused || 'start', freq: editableFrequency(s.frequency), lastRun: s.lastRun || null, runs: s.runs || (s.lastRun ? [s.lastRun] : []), waiting: !!s.waiting, running: !!s.running, kind: 'agent', ...limits(s) };
  if (s.kind === 'feed' && s.feed) Object.assign(draft.value, { kind: 'feed', feedUrl: s.feed.url, onResult: 'agent' });
  if (s.kind === 'check' && s.check) Object.assign(draft.value, { kind: 'check', check: s.check, checkId: s.check.id, onResult: s.onResult || 'push' });
  if (s.kind === 'script' && s.script) {
    Object.assign(draft.value, { kind: 'script', script: s.script, onResult: s.onResult || 'push', domainsText: (s.script.domains || []).join('\n'), timeout: String(s.script.timeoutSeconds ?? 60) });
  }
  trialResult.value = null;
  openOutputs.value = {};
  sheetOpen.value = true;
  follow();
}
function openNew() {
  if (!canEdit.value) return;
  mode.value = 'new';
  draft.value = { id: null, kind: 'agent', checkId: '', feedUrl: '', onResult: 'push', conversationId: agents.value.length === 1 ? agents.value[0].id : '', name: '', prompt: '', reason: '', whenPaused: 'start', freq: editableFrequency(), lastRun: null, runs: [], waiting: false, ...limits() };
  sheetOpen.value = true;
}
// What the owner can change in the sheet, as it stood when it opened: a change asks before
// the sheet closes without saving. What a run brings in (its history, waiting, running) is
// not the owner's change.
const EDITED = ['conversationId', 'name', 'prompt', 'whenPaused', 'freq', 'kind', 'checkId', 'feedUrl', 'onResult', 'domainsText', 'timeout', 'until', 'quietOn', 'quietFrom', 'quietTo'];
const editedState = (d) => JSON.stringify(EDITED.map((k) => d?.[k] ?? null));
let openedState = '';
watch(sheetOpen, (open) => { if (open) openedState = editedState(draft.value); });
const sheetDirty = () => sheetOpen.value && editable.value && !!draft.value && editedState(draft.value) !== openedState;
const sheetPopup = ref(null);
const closeSheet = closeAsking(sheetDirty, () => { sheetOpen.value = false; });
guardSheet(sheetPopup, { dirty: sheetDirty, request: closeSheet });
function closed() { sheetOpen.value = false; draft.value = null; saving.value = false; testing.value = false; trialResult.value = null; stopFollowing(); }
function setKind(kind) {
  const d = draft.value;
  d.kind = ['check', 'feed'].includes(kind) ? kind : 'agent';
  if (d.kind === 'feed') { d.onResult = 'agent'; d.feedUrl = d.feedUrl || ''; } else if (d.onResult === 'agent' && d.kind === 'check') d.onResult = 'push';
}
// Picking a check names the schedule after it, unless it already has a name.
function setCheck(id) {
  const d = draft.value;
  const was = checks.value.find((c) => c.id === d.checkId)?.name;
  d.checkId = id;
  const name = checks.value.find((c) => c.id === id)?.name;
  if (name && (!d.name.trim() || d.name === was)) d.name = name;
}
// Leaving the Monday-to-Friday preset for weekly starts from those days.
function setFrequencyType(type) {
  if (type === 'weekly' && draft.value.freq.type === 'weekdays') draft.value.freq.days = [...WEEKDAYS];
  draft.value.freq.type = type;
}
function toggleDay(d) {
  const days = draft.value.freq.days;
  draft.value.freq.days = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
}

async function save() {
  if (!ready.value || saving.value) return;
  const d = draft.value;
  const fields = { name: d.name.trim(), prompt: d.prompt, frequency: frequency.value, whenPaused: d.whenPaused };
  // Only what the owner may change; the script text and language stay the agent's.
  if (isScript.value) Object.assign(fields, { onResult: d.onResult, script: { domains: scriptDomains.value.domains, timeoutSeconds: timeoutFor(d.timeout) } });
  // A check whose command changed since approval is approved again as it now is.
  if (isCheck.value) Object.assign(fields, { onResult: d.onResult }, mode.value === 'new' || d.check?.changed ? { check: d.checkId } : {});
  if (isFeed.value) fields.feed = { url: d.feedUrl.trim() };
  // The expiry and quiet hours only when they changed, so an edit that leaves them
  // alone sends what it always did.
  if (untilValue(d) !== d.saved.until) fields.until = untilValue(d);
  if (JSON.stringify(quietValue(d)) !== JSON.stringify(d.saved.quiet)) fields.quiet = quietValue(d);
  saving.value = true;
  try {
    const id = encodeURIComponent(d.id || '');
    const done = mode.value === 'new' ? await api('/schedules', { method: 'POST', body: JSON.stringify({ conversationId: d.conversationId, ...fields }) })
      : mode.value === 'approve' ? await api(`/schedules/${id}/approve`, { method: 'POST', body: JSON.stringify(fields) })
      : await api(`/schedules/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
    replace(done.schedule);
    toast(mode.value === 'approve' ? ct('排程已核准') : ct('排程已保存'));
    sheetOpen.value = false;
    load();
  } catch (e) {
    alertError(e);
  } finally {
    saving.value = false;
  }
}
function reject() {
  const d = draft.value;
  f7.dialog.confirm(ct('拒絕這個排程建議？它會被移除。'), ct('拒絕'), async () => {
    saving.value = true;
    try {
      await api(`/schedules/${encodeURIComponent(d.id)}/reject`, { method: 'POST' });
      schedules.value = schedules.value.filter((x) => x.id !== d.id);
      sheetOpen.value = false;
      load();
    } catch (e) { alertError(e); } finally { saving.value = false; }
  });
}
function remove(s) {
  f7.dialog.confirm(ct('刪除這個排程？之後不會再送出。'), ct('刪除排程'), async () => {
    saving.value = true;
    try {
      await api(`/schedules/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      schedules.value = schedules.value.filter((x) => x.id !== s.id);
      if (draft.value?.id === s.id) sheetOpen.value = false;
      load();
    } catch (e) { alertError(e); } finally { saving.value = false; }
  });
}
// The conversation a run spoke in, opened at its message.
async function openRun(run = draft.value.lastRun) {
  const { conversationId } = draft.value;
  sheetOpen.value = false;
  if (workspace && run?.messageId) await workspace.showMessage(conversationId, run.messageId);
}
// One run now, outside the schedule; the history shows how it went.
async function runNow() {
  saving.value = true;
  try {
    const { schedule } = await api(`/schedules/${encodeURIComponent(draft.value.id)}/run`, { method: 'POST', body: '{}' });
    replace(schedule);
    draft.value = { ...draft.value, lastRun: schedule.lastRun || null, runs: schedule.runs || [], waiting: !!schedule.waiting, running: !!schedule.running };
    follow();
  } catch (e) { alertError(e); } finally { saving.value = false; }
}

// A script started now runs for up to its time limit: the sheet reloads every 2 s
// until it has ended, so its run shows up in the history.
let following = null;
function stopFollowing() { clearInterval(following); following = null; }
function follow() {
  stopFollowing();
  const d = draft.value;
  if (!d?.id || !['script', 'check'].includes(d.kind) || !(d.waiting || d.running)) return;
  const limit = d.script?.timeoutSeconds || checks.value.find((c) => c.id === d.checkId)?.timeoutSeconds || 120;
  const id = d.id, until = Date.now() + (limit + 30) * 1000;
  following = setInterval(async () => {
    if (!sheetOpen.value || draft.value?.id !== id || Date.now() > until) { stopFollowing(); return; }
    await load();
    const s = schedules.value.find((x) => x.id === id);
    if (!s || draft.value?.id !== id) return;
    draft.value = { ...draft.value, lastRun: s.lastRun || null, runs: s.runs || (s.lastRun ? [s.lastRun] : []), waiting: !!s.waiting, running: !!s.running };
    if (!s.waiting && !s.running) stopFollowing();
  }, 2000);
}
onUnmounted(stopFollowing);

// A trial of the script as saved, in an empty state; nothing is sent.
const testing = ref(false);
const trialResult = ref(null);
const trialStale = computed(() => {
  const d = draft.value;
  if (!isScript.value) return false;
  const saved = d.script.domains || [];
  const now = scriptDomains.value.domains;
  return timeoutFor(d.timeout) !== d.script.timeoutSeconds || now.length !== saved.length || now.some((x) => !saved.includes(x));
});
async function trial() {
  if (testing.value) return;
  const id = draft.value.id;
  testing.value = true;
  trialResult.value = null;
  try {
    const { result } = await api(`/schedules/${encodeURIComponent(id)}/test`, { method: 'POST', body: '{}' });
    if (draft.value?.id === id) trialResult.value = result || { ok: false, error: ct('沒有結果') };
  } catch (e) { alertError(e); } finally { testing.value = false; }
}

async function copySource() {
  try { await navigator.clipboard.writeText(draft.value.script.source); toast(ct('已複製')); } catch { toast(ct('無法複製')); }
}
// Which runs' output is shown whole.
const openOutputs = ref({});
</script>

<style scoped>
.schedule-state { min-height: 140px; display: flex; align-items: center; justify-content: center; }
.schedule-error { color: #ff453a; }
.schedule-empty { opacity: 0.6; text-align: center; line-height: 1.6; }
.pending-count { margin-left: 8px; vertical-align: 2px; }
/* The rows open their sheet on a tap, as a link row does, and are not selected as text. */
.schedule-list { user-select: none; -webkit-user-select: none; }
.schedule-row :deep(.item-content) { cursor: pointer; }
.schedule-list :deep(.item-text) { -webkit-line-clamp: 2; line-clamp: 2; }
.schedule-off :deep(.item-title) { opacity: 0.55; }
.last-run { color: inherit; }
.outcome-failed, .outcome-failed :deep(.item-after) { color: #ff453a; }
.outcome-skipped, .outcome-skipped :deep(.item-after) { color: #ff9f0a; }
/* The kind before a name: a message to the agent, or a background script. The icon
   is drawn from an attribute so its ligature is not part of the row's text. */
.kind-icon { font-size: 16px; margin-right: 6px; vertical-align: -2px; opacity: 0.6; }
.kind-icon::before { content: attr(data-icon); }
.kind-line { display: block; }
.running { color: var(--cc-color-accent); }
/* Quiet hours: a small moon after the name. */
.quiet-icon { font-size: 13px; margin-left: 6px; vertical-align: 0; opacity: 0.55; }
.quiet-icon::before { content: attr(data-icon); }
.check-missing { color: #ff453a; }
/* The schedule a notification named, marked for a moment. */
.schedule-list :deep(li.schedule-focused) { animation: schedule-found 2.6s ease-out; }
@keyframes schedule-found { 0%, 40% { box-shadow: inset 0 0 0 2px #ff9f0a; } 100% { box-shadow: none; } }
/* Every row is its own rounded card; a swipeout row would otherwise keep only the
   list's first and last corners (as ChatListPage.vue notes). */
.list.schedule-list > ul > li.swipeout { border-radius: var(--cc-radius-card); }
/* The swipe's buttons as round icons on the row's own card, as on the Agents list. */
.schedule-list :deep(.swipeout-actions-right) { display: flex; align-items: center; gap: 10px; padding: 0 14px 0 6px; background: transparent; }
.schedule-list :deep(.swipeout-actions-right > a.swipe-round) { background: transparent; padding: 0; min-width: 0; width: auto; height: auto; }
.swipe-circle { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 22px; color: #fff; }
.swipe-circle .icon { font-size: 19px; }
.edit .swipe-circle { background: #8e8e93; }
.delete .swipe-circle { background: #ff3b30; }
</style>

<style>
/* Teleported out of the page, so these are not scoped. */
.schedule-sheet .weekday-row .item-inner { padding-top: 10px; padding-bottom: 10px; }
/* Seven days on one line, down to a phone's width. */
.schedule-sheet .weekday-chips { display: flex; gap: 4px; width: 100%; }
.schedule-sheet .weekday-chips .button { width: auto; min-width: 0; flex: 1 1 0; padding: 0; }
.schedule-sheet .schedule-reason { white-space: pre-line; overflow-wrap: anywhere; }
.schedule-sheet .schedule-detail { white-space: pre-line; overflow-wrap: anywhere; }
.schedule-sheet .sheet-actions { display: flex; flex-direction: column; gap: 12px; }
.schedule-sheet .outcome-failed .item-after { color: #ff453a; }
.schedule-runs .item-footer { white-space: normal; }
.schedule-sheet .outcome-skipped .item-after { color: #ff9f0a; }
.schedule-sheet pre { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; line-height: 1.5; user-select: text; -webkit-user-select: text; }
/* What a script will do, in the plain words the owner approves. */
.schedule-sheet .impact-card .item-title { white-space: normal; overflow-wrap: anywhere; line-height: 1.4; padding: 2px 0; }
.schedule-sheet .impact-card .item-media .icon { font-size: 20px; color: var(--cc-color-accent); }
.schedule-sheet .clear-until { margin-left: 8px; }
/* Several times a day: each on its own row, with a remove button after it. */
.schedule-sheet .time-with-remove { display: flex; align-items: center; gap: 8px; }
.schedule-sheet .time-with-remove input { flex: 1; min-width: 0; }
.schedule-sheet .time-remove { flex: 0 0 auto; width: auto; margin: 0; padding: 0; border: 0; background: none; color: #ff453a; cursor: pointer; }
.schedule-sheet .time-remove .icon { font-size: 20px; }
.schedule-sheet .time-add { display: inline-flex; align-items: center; gap: 6px; }
.schedule-sheet .time-add .icon { font-size: 18px; }
.schedule-sheet .impact-card .impact-missing, .schedule-sheet .impact-card .impact-missing .icon { color: #ff453a; }
.schedule-sheet .impact-card .impact-command code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
/* The whole script, read only, numbered, its long lines wrapped, scrolling down
   inside its own card. */
.schedule-sheet .script-block { padding-top: 10px; padding-bottom: 12px; }
.schedule-sheet .script-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.schedule-sheet .script-lang { font-weight: 600; }
.schedule-sheet .script-copy { gap: 4px; font-size: 15px; }
.schedule-sheet .script-copy .icon { font-size: 17px; }
.schedule-sheet .script-source { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-all; overflow-x: hidden; overflow-y: auto; max-height: 50vh; box-sizing: border-box; padding: 10px 12px; counter-reset: line; border-radius: 10px; background: color-mix(in srgb, currentColor 7%, transparent); tab-size: 4; }
.schedule-sheet .script-line { display: block; position: relative; min-height: 1.5em; padding-left: calc(var(--line-digits, 2) * 1ch + 12px); }
.schedule-sheet .script-line::before { counter-increment: line; content: counter(line); position: absolute; left: 0; width: calc(var(--line-digits, 2) * 1ch); text-align: right; color: var(--cc-color-text-tertiary); user-select: none; -webkit-user-select: none; }
.schedule-sheet .script-hash { margin-top: 8px; font-size: 13px; color: var(--cc-color-text-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.schedule-sheet .trial { margin-top: 8px; }
.schedule-sheet .trial-note { margin: 0 0 12px; font-size: 14px; color: var(--cc-color-text-secondary); }
.schedule-sheet .trial-run { gap: 8px; }
.schedule-sheet .trial-result { padding-top: 12px; padding-bottom: 12px; }
.schedule-sheet .trial-status { display: flex; align-items: center; gap: 6px; font-weight: 600; margin-bottom: 8px; }
.schedule-sheet .trial-status .icon { font-size: 20px; }
.schedule-sheet .trial-ok .trial-status .icon { color: #30d158; }
.schedule-sheet .trial-failed .trial-status { color: #ff453a; }
.schedule-sheet .trial-error { white-space: pre-line; overflow-wrap: anywhere; margin-bottom: 8px; }
.schedule-sheet .trial-json, .schedule-sheet .trial-tail { white-space: pre; overflow: auto; max-height: 40vh; padding: 10px 12px; border-radius: 10px; background: color-mix(in srgb, currentColor 7%, transparent); }
/* A run's last output, three lines until tapped. */
.schedule-sheet .run-output { white-space: pre-wrap; overflow-wrap: anywhere; margin: -4px 16px 10px calc(var(--f7-list-item-padding-horizontal) + var(--f7-safe-area-left)); padding: 6px 10px; border-radius: 8px; background: color-mix(in srgb, currentColor 7%, transparent); font-size: 12px; cursor: pointer; box-sizing: content-box; }
.schedule-sheet .run-output > span { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
.schedule-sheet .run-output.open > span { display: block; -webkit-line-clamp: unset; line-clamp: none; }
.schedule-sheet .outcome-nothing .item-after { color: var(--cc-color-text-secondary); }
</style>
