/** Where the bytes go, vanilla side, and what a single-scene bundle would cost. */
import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import * as esbuild from "esbuild";

mkdirSync("measure/variants", { recursive: true });
const common = { bundle: true, minify: true, format: "iife", globalName: "DS3D", target: "chrome120", legalComments: "none", metafile: true };

// A cloud-only entry, to compare like for like against the R3F control (also one scene).
writeFileSync("measure/variants/cloud-only.mjs", `export { mount } from "../../src/three-scenes.mjs";`);
const variants = [
  ["all-three-scenes", "src/three-scenes.mjs"],
];
for (const [name, entry] of variants) {
  const r = await esbuild.build({ ...common, entryPoints: [entry], outfile: `measure/variants/${name}.js` });
  const b = readFileSync(`measure/variants/${name}.js`);
  const inputs = r.metafile.outputs[`measure/variants/${name}.js`].inputs;
  const byPkg = {};
  for (const [f, v] of Object.entries(inputs)) {
    const m = f.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    byPkg[m ? m[1] : "(own code)"] = (byPkg[m ? m[1] : "(own code)"] || 0) + v.bytesInOutput;
  }
  console.log(name, "min", b.length, "gzip", gzipSync(b).length);
  for (const [k, v] of Object.entries(byPkg).sort((a, b) => b[1] - a[1])) console.log("   ", String(v).padStart(8), k);
}

// How much of three does each addon cost on top of core?
const probes = {
  "core-only": `import {WebGLRenderer,Scene,PerspectiveCamera,BufferGeometry,BufferAttribute,Points,PointsMaterial,Color,Vector3} from "three";
    export const x=[WebGLRenderer,Scene,PerspectiveCamera,BufferGeometry,BufferAttribute,Points,PointsMaterial,Color,Vector3];`,
  "core+meshes": `import {WebGLRenderer,Scene,PerspectiveCamera,BoxGeometry,PlaneGeometry,SphereGeometry,MeshStandardMaterial,MeshBasicMaterial,Mesh,DirectionalLight,AmbientLight,Group,EdgesGeometry,LineSegments,LineBasicMaterial,Color,Vector3} from "three";
    export const x=[WebGLRenderer,Scene,PerspectiveCamera,BoxGeometry,PlaneGeometry,SphereGeometry,MeshStandardMaterial,MeshBasicMaterial,Mesh,DirectionalLight,AmbientLight,Group,EdgesGeometry,LineSegments,LineBasicMaterial,Color,Vector3];`,
  "core+meshes+Line2": `import {WebGLRenderer,Scene,PerspectiveCamera,BoxGeometry,PlaneGeometry,SphereGeometry,MeshStandardMaterial,MeshBasicMaterial,Mesh,DirectionalLight,AmbientLight,Group,EdgesGeometry,LineSegments,LineBasicMaterial,Color,Vector3,Vector2} from "three";
    import {Line2} from "three/examples/jsm/lines/Line2.js";
    import {LineGeometry} from "three/examples/jsm/lines/LineGeometry.js";
    import {LineMaterial} from "three/examples/jsm/lines/LineMaterial.js";
    export const x=[WebGLRenderer,Scene,PerspectiveCamera,BoxGeometry,PlaneGeometry,SphereGeometry,MeshStandardMaterial,MeshBasicMaterial,Mesh,DirectionalLight,AmbientLight,Group,EdgesGeometry,LineSegments,LineBasicMaterial,Color,Vector3,Vector2,Line2,LineGeometry,LineMaterial];`,
  "whole-namespace": `import * as THREE from "three"; export const x = THREE;`,
  "core+meshes+Line2+Text": `import {WebGLRenderer,Scene,PerspectiveCamera,Mesh,MeshStandardMaterial,Vector3} from "three";
    import {Line2} from "three/examples/jsm/lines/Line2.js";
    import {CSS2DRenderer} from "three/examples/jsm/renderers/CSS2DRenderer.js";
    import {EffectComposer} from "three/examples/jsm/postprocessing/EffectComposer.js";
    import {UnrealBloomPass} from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
    export const x=[WebGLRenderer,Scene,PerspectiveCamera,Mesh,MeshStandardMaterial,Vector3,Line2,CSS2DRenderer,EffectComposer,UnrealBloomPass];`,
};
console.log("\n-- three.js, by import surface (minified / gzip) --");
for (const [name, code] of Object.entries(probes)) {
  writeFileSync(`measure/variants/p-${name}.mjs`, code);
  await esbuild.build({ ...common, entryPoints: [`measure/variants/p-${name}.mjs`], outfile: `measure/variants/p-${name}.js`, metafile: false });
  const b = readFileSync(`measure/variants/p-${name}.js`);
  console.log(name.padEnd(26), String(b.length).padStart(8), String(gzipSync(b).length).padStart(7));
}
