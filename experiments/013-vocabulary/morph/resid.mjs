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
const p=await br.newPage();await p.setViewport({width:1920,height:1080,deviceScaleFactor:1});
await p.goto(`${B}/page.html?case=sum&control=a`,{waitUntil:"networkidle0"});
await p.waitForFunction("window.__built===true");
// lift into a hidden layer using the same code, then report residual anchor error
console.log(await p.evaluate(()=>{
  const host=document.getElementById("m");
  const layer=document.createElement("div");layer.className="probe-layer";layer.style.cssText="position:absolute;inset:0";host.appendChild(layer);
  const before=[...document.querySelectorAll('[data-morph="a"] *')].filter(e=>!e.childElementCount&&e.textContent.trim());
  const anch=e=>{const i=document.createElement("i");i.style.cssText="display:inline-block;width:0;height:0;vertical-align:baseline";e.appendChild(i);const r=i.getBoundingClientRect(),b=e.getBoundingClientRect();i.remove();return[b.left,r.top];};
  const want=before.map(anch);
  const items=DSMorph.lift(document.querySelector('[data-morph="a"]'),host,layer);
  const txt=items.filter(i=>i.ink);
  return txt.map((it,k)=>{const g=anch(it.el);const w=it.ink;return `${it.text.padEnd(3)} dx=${(g[0]-w[0]).toFixed(4)} dy=${(g[1]-w[1]).toFixed(4)}`;}).join("\n");
}));
await br.close();server.close();
