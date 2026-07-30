/** Is the lifted overlay a faithful copy of plain KaTeX? Caption excluded. */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
const HERE=dirname(fileURLToPath(import.meta.url));
const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".woff2":"font/woff2"};
const server=createServer(async(q,s)=>{try{const p=join(HERE,decodeURIComponent(q.url.split("?")[0]));s.writeHead(200,{"content-type":MIME[extname(p)]??"application/octet-stream"});s.end(await readFile(p));}catch{s.writeHead(404).end();}});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const B=`http://127.0.0.1:${server.address().port}`;
const br=await puppeteer.launch({executablePath:"/Users/neo/.cache/puppeteer/chrome-headless-shell/mac_arm-145.0.7632.46/chrome-headless-shell-mac-arm64/chrome-headless-shell",args:["--force-device-scale-factor=1","--disable-lcd-text"]});
const CLIP={x:0,y:200,width:1920,height:700};   // the equation band only
async function grab(url){const p=await br.newPage();await p.setViewport({width:1920,height:1080,deviceScaleFactor:1});await p.goto(url,{waitUntil:"networkidle0"});await p.waitForFunction("window.__built===true");if(!url.includes("control"))await p.evaluate(t=>window.__seek(t),Number(new URL(url).searchParams.get("t")));const b=await p.screenshot({clip:CLIP});await p.close();return b;}
const differ=await br.newPage();await differ.goto("about:blank");
async function diff(a,b,file){return differ.evaluate(async(a,b)=>{const L=d=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src="data:image/png;base64,"+d;});const[ia,ib]=await Promise.all([L(a),L(b)]);const P=i=>{const c=new OffscreenCanvas(i.width,i.height);const x=c.getContext("2d",{willReadFrequently:true});x.drawImage(i,0,0);return x.getImageData(0,0,i.width,i.height);};const A=P(ia),Bd=P(ib);let n=0,max=0,sum=0;const out=new Uint8ClampedArray(A.data.length);for(let i=0;i<A.data.length;i+=4){const d=Math.max(Math.abs(A.data[i]-Bd.data[i]),Math.abs(A.data[i+1]-Bd.data[i+1]),Math.abs(A.data[i+2]-Bd.data[i+2]));if(d>0){n++;sum+=d;if(d>max)max=d;}out[i]=d>0?255:0;out[i+1]=0;out[i+2]=0;out[i+3]=d>0?255:20;}const c=new OffscreenCanvas(ia.width,ia.height);c.getContext("2d").putImageData(new ImageData(out,ia.width,ia.height),0,0);const bl=await c.convertToBlob();const buf=new Uint8Array(await bl.arrayBuffer());let s2="";for(const x of buf)s2+=String.fromCharCode(x);return{pixels:n,max,mean:n?Math.round(sum/n*10)/10:0,png:btoa(s2)};},a.toString("base64"),b.toString("base64")).then(async r=>{if(file&&r.pixels)await writeFile(join(HERE,"out",file),Buffer.from(r.png,"base64"));delete r.png;return r;});}
const CASES=["swap","swapKeyed","fraction","fractionKeyed","sum","sumKeyed","derivative"];
const rows={};
for(const c of CASES){
  const ca=await grab(`${B}/page.html?case=${c}&control=a`);
  const ma=await grab(`${B}/page.html?case=${c}&t=0.5`);
  const cb=await grab(`${B}/page.html?case=${c}&control=b`);
  const mb=await grab(`${B}/page.html?case=${c}&t=2.9`);
  const h=x=>createHash("sha256").update(x).digest("hex").slice(0,12);
  rows[c]={restA:h(ca)===h(ma)?"byte-identical":await diff(ca,ma,`fid-${c}-a.png`),
           restB:h(cb)===h(mb)?"byte-identical":await diff(cb,mb,`fid-${c}-b.png`)};
  console.log(c.padEnd(15),JSON.stringify(rows[c]));
}
await writeFile(join(HERE,"out","fidelity.json"),JSON.stringify(rows,null,2));
await br.close();server.close();
