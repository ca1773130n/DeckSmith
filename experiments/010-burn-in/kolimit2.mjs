import { renderCaptions, burnStyle } from "./kolib.mjs";
const deck = new URL("./kodeck", import.meta.url).pathname;
const style = burnStyle(1080,1920,"Noto Sans KR");
const ko = "이 논문은 작게 유지되는 사고 과정을 아주 커다란 출력을 만들어야 하는 과제와 정면으로 맞붙입니다";
const en = "This paper puts a thought process that stays small up against a task whose output is";
for (const [name, text] of [["ko", ko], ["en", en]]) {
  const b = await renderCaptions([{start:0,end:1,text}], style, deck, new URL(`./lim_${name}`, import.meta.url).pathname);
  console.log(`${name}: ${text.length} chars -> band ${b.width}x${b.height}px, ${(b.height/64).toFixed(2)} lines, overflow=${b.width > 994}`);
}
