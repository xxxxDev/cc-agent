<template>
 <!-- The iOS-style spinner, drawn as one picture that turns about its own centre, in the
      place and size of the icon it stands in for: in place
      of the send button's arrow it is that arrow's icon, the same size, with its lines turning.
      Framework7's preloader turned with its centre wandering on an iPhone (its eight lines
      placed by percentage transforms, which WebKit resolves a little off centre) and was
      smaller than the arrow. Drawn on the icon font's 56-unit grid in Framework7's own
      proportions (lines a third of the radius long and about a quarter of it wide, from a
      third of the way out), so it reads as the same spinner as the list's, at the arrow's
      size; rays out to the edge looked like a different, larger one. -->
 <i class="icon f7-icons spinner-icon-box" aria-hidden="true"><svg class="spinner-icon" viewBox="0 0 56 56">
  <line v-for="i in 8" :key="i" x1="28" y1="8.55" x2="28" y2="18.1" :transform="`rotate(${(i - 1) * 45} 28 28)`" :opacity="0.27 + (i - 1) * 0.104"/>
 </svg></i>
</template>
<style scoped>
.spinner-icon-box {display:inline-flex;align-items:center;justify-content:center;width:1em;height:1em;line-height:1;}
.spinner-icon {display:block;width:1em;height:1em;stroke:currentColor;stroke-width:5.1;stroke-linecap:round;transform-origin:50% 50%;animation:spinner-icon-turn 1s steps(8) infinite;}
@keyframes spinner-icon-turn {to {transform:rotate(360deg);}}
</style>
