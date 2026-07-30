import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
const HERE = dirname(fileURLToPath(import.meta.url));
const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".woff2":"font/woff2"};
const server=createServer(async(req,res)=>{try{const p=join(HERE,decodeURIComponent(req.url.split("?")[0]));const b=await readFile(p);res.writeHead(200,{"content-type":MIME[extname(p)]??"application/octet-stream"});res.end(b);}catch{res.writeHead(404).end("no");}});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const BASE=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({executablePath:"/Users/neo/.cache/puppeteer/chrome-headless-shell/mac_arm-145.0.7632.46/chrome-headless-shell-mac-arm64/chrome-headless-shell",args:["--force-device-scale-factor=1","--hide-scrollbars"]});
await mkdir(join(HERE,"out"),{recursive:true});
const page=await browser.newPage();
page.on("console",m=>console.log("CONSOLE",m.text()));
page.on("pageerror",e=>console.log("PAGEERROR",e.message));
await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});
const c=process.argv[2]||"swap";
await page.goto(`${BASE}/page.html?case=${c}`,{waitUntil:"networkidle0"});
await page.waitForFunction("window.__built===true",{timeout:15000});
console.log(JSON.stringify(await page.evaluate("window.__stats")));
for (const t of [0.5,1.35,1.7,2.05,2.9]) {
  await page.evaluate(t=>window.__seek(t),t);
  await writeFile(join(HERE,"out",`smoke-${c}-${t}.png`),await page.screenshot({clip:{x:0,y:0,width:1920,height:1080}}));
}
await browser.close();server.close();
