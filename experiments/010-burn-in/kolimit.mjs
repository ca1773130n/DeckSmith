import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { bundleFont, renderCaptions, burnStyle } from "./kolib.mjs";
const deck = new URL("./kodeck", import.meta.url).pathname;
// A cue at exactly CUE_MAX_CHARS (84), which splitCue guarantees is the worst case.
const ko84 = "이 논문은 작게 유지되는 사고 과정을 아주 커다란 출력을 만들어야 하는 과제와 정면으로 맞붙이는 연구입니다 그리고".slice(0,84);
const en84 = "This paper puts a thought process that stays small up against a task whose output is".slice(0,84);
const cues=[{start:0,end:3,text:ko84},{start:3,end:6,text:en84}];
await mkdir(join(deck,"assets","fonts"),{recursive:true});
await bundleFont("ko", ko84, join(deck,"assets","fonts"));
const style=burnStyle(1080,1920,"Noto Sans KR");
const b=await renderCaptions(cues,style,deck,new URL("./kolim",import.meta.url).pathname);
console.log("ko chars:",ko84.length,"en chars:",en84.length);
console.log("usable:",style.width-2*style.marginX,"band:",b.width+"x"+b.height,"at x="+b.x);
console.log("lines (h/lineheight ~64):",(b.height/64).toFixed(2));
