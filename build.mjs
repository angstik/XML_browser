// Construit la PWA dans dist/ : node build.mjs
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync } from "node:fs";

const { version } = JSON.parse(readFileSync("version.json", "utf8"));
if (!/^\d+$/.test(version)) throw new Error("version.json : la version doit être un nombre, par exemple \"02\".");
// Chaque version publiée doit avoir son entrée dans le journal des modifications.
if (!new RegExp("^## v" + version + "\\b", "m").test(readFileSync("CHANGELOG.md", "utf8"))) {
  throw new Error("CHANGELOG.md : il manque l'entrée « ## v" + version + " ».");
}

// node-unrar-js fabrique du code à la volée (new Function), ce que la politique de sécurité
// de la page interdit. On remplace ces deux fonctions par leurs équivalents sans évaluation
// dynamique (ceux qu'Emscripten génère lui-même avec -sDYNAMIC_EXECUTION=0).
const SAFE_INVOKER = `function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){
  var argCount=argTypes.length;
  if(argCount<2){throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!")}
  var isClassMethodFunc=argTypes[1]!==null&&classType!==null;
  var needsDestructorStack=false;
  for(var i=1;i<argTypes.length;++i){if(argTypes[i]!==null&&argTypes[i].destructorFunction===undefined){needsDestructorStack=true;break}}
  var returns=argTypes[0].name!=="void";
  var expectedArgCount=argCount-2;
  return function(){
    if(arguments.length!==expectedArgCount){throwBindingError("function "+humanName+" called with "+arguments.length+" arguments, expected "+expectedArgCount+" args!")}
    var destructors=needsDestructorStack?[]:null;
    var invokerArgs=[cppTargetFunc];
    var thisWired;
    if(isClassMethodFunc){thisWired=argTypes[1].toWireType(destructors,this);invokerArgs.push(thisWired)}
    var argsWired=new Array(expectedArgCount);
    for(var i=0;i<expectedArgCount;++i){argsWired[i]=argTypes[i+2].toWireType(destructors,arguments[i]);invokerArgs.push(argsWired[i])}
    var rv=cppInvokerFunc.apply(null,invokerArgs);
    if(needsDestructorStack){runDestructors(destructors)}
    else{for(var j=isClassMethodFunc?1:2;j<argTypes.length;j++){var param=j===1?thisWired:argsWired[j-2];if(argTypes[j].destructorFunction!==null){argTypes[j].destructorFunction(param)}}}
    if(returns){return argTypes[0].fromWireType(rv)}
  }
}`;

// Fin de la fonction qui commence à l'accolade `open`, en ignorant les accolades dans les chaînes.
function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  throw new Error("accolade fermante introuvable");
}

function patchUnrar(src) {
  const named = /function createNamedFunction\(name,body\)\{name=makeLegalFunctionName\(name\);return new Function\(/;
  const a = src.search(named);
  if (a < 0) throw new Error("node-unrar-js : createNamedFunction introuvable, le correctif est à revoir.");
  src = src.slice(0, a)
    + "function createNamedFunction(name,body){name=makeLegalFunctionName(name);return{[name]:function(){return body.apply(this,arguments)}}[name]}"
    + src.slice(matchBrace(src, src.indexOf("{", a)) + 1);
  const b = src.indexOf("function craftInvokerFunction(");
  if (b < 0) throw new Error("node-unrar-js : craftInvokerFunction introuvable, le correctif est à revoir.");
  src = src.slice(0, b) + SAFE_INVOKER + src.slice(matchBrace(src, src.indexOf("{", b)) + 1);
  if (/new Function\(|new_\(Function|\beval\(/.test(src)) throw new Error("node-unrar-js : il reste de l'évaluation dynamique après correctif.");
  return src;
}

const unrarPatch = {
  name: "unrar-sans-eval",
  setup(b) {
    b.onLoad({ filter: /node-unrar-js[\\/]esm[\\/]js[\\/]unrar\.js$/ }, (args) => ({
      contents: patchUnrar(readFileSync(args.path, "utf8")), loader: "js",
    }));
  },
};

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/icons", { recursive: true });

const common = { bundle: true, minify: true, format: "iife", target: "es2020", legalComments: "none", logLevel: "warning" };
await build({ ...common, entryPoints: ["src/viewer.js"], outfile: "dist/viewer.js" });
await build({ ...common, entryPoints: ["src/rar.js"], outfile: "dist/rar.js", plugins: [unrarPatch] });

writeFileSync("dist/app.js", readFileSync("src/app.js", "utf8").replace("__APP_VERSION__", version));
cpSync("src/charts.js", "dist/charts.js");
cpSync("src/archives.js", "dist/archives.js");
cpSync("src/style.css", "dist/app.css");
cpSync("src/index.html", "dist/index.html");
cpSync("src/manifest.webmanifest", "dist/manifest.webmanifest");
cpSync("src/icons", "dist/icons", { recursive: true });
cpSync("node_modules/node-unrar-js/esm/js/unrar.wasm", "dist/unrar.wasm");
writeFileSync("dist/version.json", JSON.stringify({ version }) + "\n");

// Tout ce que le service worker met en cache pour le hors-ligne (version.json reste sur le réseau).
const assets = ["./", "index.html", "app.css", "app.js", "viewer.js", "charts.js", "archives.js", "rar.js", "unrar.wasm", "manifest.webmanifest",
  ...readdirSync("dist/icons").map((f) => "icons/" + f)];
writeFileSync("dist/sw.js", readFileSync("src/sw.js", "utf8")
  .replace("__VERSION__", version)
  .replace("__ASSETS__", JSON.stringify(assets)));

console.log("dist/ construit, version v" + version + " (" + assets.length + " fichiers en cache hors ligne)");
