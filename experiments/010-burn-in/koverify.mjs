import { renderCaptions, burnStyle, cueMax, splitCue } from "./kolib.mjs";
const deck = new URL("./kodeck", import.meta.url).pathname;
const style = burnStyle(1080,1920,"Noto Sans KR");
const base = "이 논문은 작게 유지되는 사고 과정을 아주 커다란 출력을 만들어야 하는 과제와 정면으로 맞붙이는 연구 결과를 정리한 것입니다";
// Worst case the pipeline can now produce: a cue at the Korean budget.
const cues = splitCue({start:0,end:8,text:base}, cueMax(base));
const b = await renderCaptions(cues, style, deck, new URL("./koverify", import.meta.url).pathname);
console.log("cues:", cues.length, "band:", b.width+"x"+b.height, "lines:", (b.height/64).toFixed(2), "overflow:", b.width>994);
