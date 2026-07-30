import { renderCaptions, burnStyle } from "./kolib.mjs";
const deck = new URL("./kodeck", import.meta.url).pathname;
const style = burnStyle(1080,1920,"Noto Sans KR");
const base = "이 논문은 작게 유지되는 사고 과정을 아주 커다란 출력을 만들어야 하는 과제와 정면으로 맞붙이는 연구 결과를 정리한 것입니다";
const cues=[];
for (let n=40; n<=Math.min(84, base.length); n+=4) cues.push({start:n,end:n+1,text:base.slice(0,n)});
for (const c of cues) {
  const b = await renderCaptions([c], style, deck, new URL(`./sw${c.start}`, import.meta.url).pathname);
  console.log(`ko ${String(c.text.length).padStart(2)} chars -> ${String(b.width).padStart(4)}px wide, ${(b.height/64).toFixed(0)} lines`);
}
