<template>
  <!--
    Generic anchored glass dropdown for text items. Teleported to <body>, centered on the click point,
    12px below it, clamped to a 10px viewport guard; modalInAnimation from skin.css.
  -->
  <Teleport to="body">
    <div v-if="visible" class="dropdown-backdrop" @click="close" @contextmenu.prevent="passContextMenu">
      <div
        ref="contentRef"
        class="dropdown-content"
        :class="{ 'modal-out': closing }"
        :style="contentStyle"
        @click.stop
        @contextmenu.prevent.stop
      >
        <div class="list no-hairlines no-hairlines-between search-apps-ui__sources-list no-margin">
          <ul>
            <!-- Items with an icon are sources, as a source picker shows them:
                 the selected one's icon ringed. The ring sits outside the icon, so every
                 name lines up. -->
            <li v-for="item in ordered" :key="item.value" class="no-chevron">
              <a class="item-link" href="#" :data-value="item.value" @click.prevent="select(item)">
                <div class="item-content">
                  <div v-if="item.icon" class="item-media">
                    <img class="search-apps-ui__sources-list__source-icon" :class="{'source-selected': item.value === selected}" :src="item.icon" alt=""/>
                  </div>
                  <div v-else class="item-media">
                    <i class="icon f7-icons" style="font-size: 20px;">
                      {{ item.f7 || (item.value === selected ? 'checkmark_alt' : '') }}
                    </i>
                  </div>
                  <div class="item-inner">
                    <div class="item-title">{{ item.label }}</div>
                  </div>
                </div>
              </a>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  // Click point (viewport coords) of the trigger row; the dropdown anchors to it.
  point: { type: Object, default: () => ({ clientX: 0, clientY: 0 }) },
  items: { type: Array, default: () => [] },
  selected: { type: String, default: '' },
});
const emit = defineEmits(['close', 'select']);

// Items keep their order; the selected one is only ringed.
const ordered = computed(() => props.items);
const visible = ref(false);
const closing = ref(false);
const contentRef = ref(null);
const contentStyle = ref({ top: '0px', left: '0px', position: 'absolute', transformOrigin: '50% 0' });

function positionContent() {
  const el = contentRef.value;
  if (!el) return;
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const guard = 10;
  const gap = 12;
  const x = props.point?.clientX ?? 0;
  const y = props.point?.clientY ?? 0;

  let left = x - width / 2;
  let top = y + gap;
  let originX = width / 2;
  let originY = 0;

  if (left < guard) {
    left = guard;
    originX = x - left;
  } else if (left + width > vw - guard) {
    left = vw - width - guard;
    originX = x - left;
  }
  if (top + height > vh - guard) {
    top = y - height - gap;
    originY = height;
  }
  if (top < guard) {
    top = guard;
    originY = y - top;
  }

  contentStyle.value = {
    top: `${top}px`,
    left: `${left}px`,
    position: 'absolute',
    transformOrigin: `${originX}px ${originY}px`,
  };
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      clearTimeout(closeTimer);
      closeTimer = null;
      closing.value = false;
      visible.value = true;
      await nextTick();
      positionContent();
      return;
    }
    if (visible.value) close();
  },
  { immediate: true },
);

// Items that arrive after it opened (a list still loading) keep it inside the window.
watch(() => props.items.length, () => { if (visible.value && !closing.value) nextTick(positionContent); });

let closeTimer = null;
function close() {
  if (!visible.value || closing.value) return;
  closing.value = true;
  emit('close');
  closeTimer = setTimeout(() => {
    closeTimer = null;
    visible.value = false;
    closing.value = false;
  }, 230);
}

// A right-click while the menu is open lands on its backdrop, not on the page, so the
// browser's own menu came up. The click is handed to what
// lies under the backdrop: a row with a menu of its own opens it there in the same
// right-click (the same menu moves to the new point); anywhere else the menu just closes.
// The browser's menu never comes up while ours is open.
async function passContextMenu(event) {
  const backdrop = event.currentTarget;
  const before = props.point;
  backdrop.style.pointerEvents = 'none';
  const under = document.elementFromPoint(event.clientX, event.clientY);
  backdrop.style.pointerEvents = '';
  let taken = false;
  if (under) {
    const again = new MouseEvent('contextmenu', {bubbles: true, cancelable: true, composed: true, clientX: event.clientX, clientY: event.clientY, screenX: event.screenX, screenY: event.screenY, button: 2, buttons: event.buttons});
    taken = !under.dispatchEvent(again);
  }
  await nextTick();
  if (taken && props.open && props.point !== before && !closing.value) positionContent();
  else close();
}

function select(item) {
  emit('select', item.value);
  close();
}
</script>
