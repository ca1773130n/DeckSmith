/** Does making KaTeX leaves inline-block (so they can be transformed) move anything? */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
const HERE=dirname(fileURLToPath(import.meta.url));
const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".woff2":"font/woff2"};
const server=createServer(async(q,s)=>{try{const p=join(HERE,decodeURIComponent(q.url.split("?")[0]));s.writeHead(200,{"content-type":MIME[extname(p)]??"application/octet-stream"});s.end(await readFile(p));}catch{s.writeHead(404).end();}});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const B=`http://127.0.0.1:${server.address().port}`;
const br=await puppeteer.launch({executablePath:"/Users/neo/.cache/puppeteer/chrome-headless-shell/mac_arm-145.0.7632.46/chrome-headless-shell-mac-arm64/chrome-headless-shell",args:["--force-device-scale-factor=1"]});
for (const c of ["swap","fraction","sum","derivative"]) {
  const p=await br.newPage();await p.setViewport({width:1920,height:1080,deviceScaleFactor:1});
  await p.goto(`${B}/page.html?case=${c}&control=a`,{waitUntil:"networkidle0"});
  await p.waitForFunction("window.__built===true");
  const before=await p.screenshot({clip:{x:0,y:200,width:1920,height:700}});
  const moved=await p.evaluate(()=>{
    const leaves=[...document.querySelectorAll('[data-morph="a"] *')].filter(e=>!e.childElementCount&&e.textContent.trim());
    const b=leaves.map(e=>e.getBoundingClientRect()).map(r=>[r.left,r.top,r.width,r.height]);
    for(const e of leaves) e.style.display="inline-block";
    document.body.offsetHeight;
    const a=leaves.map(e=>e.getBoundingClientRect()).map(r=>[r.left,r.top,r.width,r.height]);
    let max=0; for(let i=0;i<b.length;i++) for(let k=0;k<4;k++) max=Math.max(max,Math.abs(a[i][k]-b[i][k]));
    return {n:leaves.length,maxShiftPx:Math.round(max*1000)/1000};
  });
  const after=await p.screenshot({clip:{x:0,y:200,width:1920,height:700}});
  console.log(c.padEnd(12),JSON.stringify(moved),"pixelIdentical:",before.equals(after));
  await p.close();
}
await br.close();server.close();
