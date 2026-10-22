// Build and run the production QuickJS byte extractor without installing the app.
// Usage: node scripts/image-binary-probe.mjs <OpenHarmony native SDK> <hdc> <device-id>
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const [sdk,hdc,device] = process.argv.slice(2);
if (!sdk || !hdc || !device) throw new Error('Provide native SDK, hdc and explicit device ID');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cpp = path.join(root,'quickjs/src/main/cpp');
const source = readFileSync(path.join(cpp,'script_session.cpp'),'utf8');
const extractor = source.slice(source.indexOf('bool ValueToBytes('),source.indexOf('\ndouble Millis('));
if (!extractor.startsWith('bool ValueToBytes(') || extractor.includes('napi_')) throw new Error('Extractor boundaries changed');
const dir = mkdtempSync(path.join(tmpdir(),'image-binary-probe-'));
const remote = '/data/local/tmp/legado-image-binary-probe';
try {
  const main = `#include "quickjs_headers.h"
#include <vector>
#include <cstdio>
#include <cstring>
constexpr size_t MAX_BINARY_BYTES=20*1024*1024;
${extractor}
int main() {
 JSRuntime* rt=JS_NewRuntime(); JS_SetMemoryLimit(rt,96*1024*1024); JSContext* ctx=JS_NewContext(rt);
 int failed=0;
 struct Case { const char* code; bool valid; size_t size; int first; };
 Case cases[]={
  {"new Uint8Array([99,1,2,3,88]).subarray(1,4)",true,3,1},
  {"new Int8Array([-1,2])",true,2,255},
  {"new Uint8ClampedArray([1,256])",true,2,1},
  {"new Uint8Array([1,2,3]).buffer",true,3,1},
  {"new Uint8Array(20*1024*1024)",true,20*1024*1024,0},
  {"new Uint8Array(20*1024*1024+1)",false,0,0},
  {"new ArrayBuffer(0)",true,0,0},
  {"new Uint8Array(0)",true,0,0},
  {"new Uint8Array([1,2]).subarray(2)",true,0,0},
  {"new Uint16Array([1,2])",false,0,0},
  {"new DataView(new ArrayBuffer(4))",false,0,0},
  {"[1,2,3]",false,0,0}, {"'abc'",false,0,0}, {"undefined",false,0,0}
 };
 for (const auto& c:cases) {
   JSValue value=JS_Eval(ctx,c.code,strlen(c.code),"test.js",JS_EVAL_TYPE_GLOBAL);
   std::vector<uint8_t> bytes; bool ok=ValueToBytes(ctx,value,bytes);
   bool pass=ok==c.valid && (!ok || (bytes.size()==c.size && (bytes.empty() || bytes[0]==c.first)));
   if (!pass) { failed++; printf("FAIL %s valid=%d size=%zu\\n",c.code,ok,bytes.size()); }
   JS_FreeValue(ctx,JS_GetException(ctx)); JS_FreeValue(ctx,value); JS_RunGC(rt);
 }
 JSValue detached=JS_NewArrayBufferCopy(ctx,(const uint8_t*)"abc",3);
 JS_DetachArrayBuffer(ctx,detached); std::vector<uint8_t> bytes;
 if(ValueToBytes(ctx,detached,bytes)) { failed++; printf("FAIL detached buffer accepted\\n"); }
 JS_FreeValue(ctx,JS_GetException(ctx)); JS_FreeValue(ctx,detached);
 JS_FreeContext(ctx); JS_FreeRuntime(rt);
 printf("image binary native probe: %d failures / 15 cases\\n",failed); return failed?1:0;
}`;
  const file = path.join(dir,'probe.cpp'), binary=path.join(dir,'probe');
  writeFileSync(file,main);
  const clang=path.join(sdk,'llvm/bin',process.platform==='win32'?'clang++.exe':'clang++');
  execFileSync(clang,['--target=aarch64-linux-ohos',`--sysroot=${path.join(sdk,'sysroot')}`,'-std=c++17','-static-libstdc++',
    '-I'+cpp,'-I'+path.join(cpp,'include'),file,path.join(root,'quickjs/libs/arm64-v8a/libquickjs.a'),'-lm','-o',binary],{stdio:'inherit'});
  execFileSync(hdc,['-t',device,'file','send',binary,remote],{stdio:'inherit'});
  execFileSync(hdc,['-t',device,'shell','chmod','700',remote],{stdio:'inherit'});
  const result=execFileSync(hdc,['-t',device,'shell',remote],{encoding:'utf8'});
  process.stdout.write(result);
  if(!result.includes('0 failures / 15 cases')) throw new Error('Native probe failed');
} finally {
  try { execFileSync(hdc,['-t',device,'shell','rm','-f',remote],{stdio:'pipe'}); } catch {}
  rmSync(dir,{recursive:true,force:true});
}
