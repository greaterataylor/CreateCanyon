/** Runs only platform-owned parsers. Never imports or executes a seller's code. */
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,stat,copyFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import {fileTypeFromFile} from 'file-type';
const [input,output,assetType,declaredMime]=process.argv.slice(2);
if(!input||!output||!assetType||!declaredMime)throw new Error('Expected input, output, asset type and declared MIME');
await mkdir(output,{recursive:true,mode:0o700});
function command(binary,args,timeout=120000,allowed=[0]){
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{shell:false,env:{PATH:process.env.PATH??'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp',TMPDIR:'/tmp',LANG:'C.UTF-8',SEMGREP_SEND_METRICS:'off',DO_NOT_TRACK:'1'},stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
    let stdout='',stderr='',length=0,settled=false;
    const kill=()=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}};
    const timer=setTimeout(()=>{kill();finish(new Error(`${binary} timed out`));},timeout);
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
    for(const [stream,which] of [[child.stdout,'out'],[child.stderr,'err']])stream.on('data',chunk=>{length+=chunk.length;if(length>16*1024*1024){kill();finish(new Error('Processor output limit exceeded'));return;}if(which==='out')stdout+=chunk;else stderr+=chunk;});
    child.on('error',error=>finish(error));child.on('close',code=>allowed.includes(code)?finish(null,{stdout,stderr,code}):finish(new Error(`${binary} exited with ${code}: ${stderr.slice(-1500)}`)));
  });
}
async function digest(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
const type=await fileTypeFromFile(input);
let detected=type?.mime;
if(!detected){
  const size=(await stat(input)).size;if(size>10*1024*1024)throw new Error('Unrecognized binary file type');
  const bytes=await readFile(input);const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(text.includes('\u0000'))throw new Error('Binary data cannot be declared as text');
  detected='text/plain';
}
const mimeGroups=[['application/zip','application/x-zip-compressed'],['application/gzip','application/x-gzip'],['audio/wav','audio/x-wav','audio/vnd.wave'],['audio/ogg','application/ogg'],['text/plain','text/markdown','text/csv'],['audio/flac','audio/x-flac'],['font/ttf','application/font-sfnt'],['font/otf','application/vnd.ms-opentype']];
const declaredMatches=detected===declaredMime||mimeGroups.some(group=>group.includes(detected)&&group.includes(declaredMime));
if(!declaredMatches)throw new Error(`Actual MIME ${detected} does not match declared MIME ${declaredMime}`);
const supported=new Set(['image/jpeg','image/png','image/webp','image/avif','application/pdf','audio/mpeg','audio/wav','audio/x-wav','audio/vnd.wave','audio/flac','audio/x-flac','audio/ogg','application/ogg','audio/mp4','font/ttf','font/otf','font/woff','font/woff2','application/zip','application/x-tar','application/gzip','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
if(!supported.has(detected))throw new Error('Detected format is not supported');
// Nested archives are expanded beside their containing archive's tree. Scan the
// common root, not just the top-level extraction directory.
const scanRoot=path.join(output,'source-tree');
const extraction=path.join(scanRoot,'extracted');
const archiveReport=JSON.parse((await command('python3',[fileURLToPath(new URL('./archive_guard.py',import.meta.url)),input,extraction])).stdout);
const previews=[],scans=[{scanner:'archive-guard',status:'PASSED',report:{archive:archiveReport.archive,entries:archiveReport.entries,expandedBytes:archiveReport.expandedBytes}}];
const isCode=['CODE','PLUGIN','THEME','INTEGRATION','DEVELOPER_TOOL'].includes(assetType);
const codeExtensions=/\.(exe|dll|so|dylib|sh|ps1|bat|cmd|php|js|ts|py|rb|jar|class|wasm)$/i;
if(!isCode&&archiveReport.files.some(f=>codeExtensions.test(f.path)))throw new Error('Code inside archives requires a code asset type and static scanning');
if(isCode){
  if(!archiveReport.archive){await mkdir(extraction,{recursive:true});await copyFile(input,path.join(extraction,'source.txt'));}
  const configured=(process.env.CODE_SCANNERS??'').split(',').filter(Boolean);
  const supportedScanners=['gitleaks','trivy','semgrep','syft'];
  if(configured.some(s=>!supportedScanners.includes(s)))throw new Error('Unknown static scanner');
  if(process.env.REQUIRE_CODE_SCANNERS==='true'&&supportedScanners.some(s=>!configured.includes(s)))throw new Error('All four static scanners must be configured for production code submissions');
  for(const scanner of configured){
    if(scanner==='gitleaks'){
      // Findings are redacted and summarized; never return uploaded secrets in logs or UI.
      await command('gitleaks',['dir',scanRoot,'--no-banner','--redact','--exit-code','2'],180000);
      scans.push({scanner,status:'PASSED',report:{secretsDetected:false}});
    }else if(scanner==='trivy'){
      const result=await command('trivy',['fs','--offline-scan','--skip-db-update','--skip-check-update','--scanners','vuln','--severity','HIGH,CRITICAL','--exit-code','2','--format','json',scanRoot],180000);
      const report=JSON.parse(result.stdout);scans.push({scanner,status:'PASSED',report:{artifactName:report.ArtifactName??'source',highCriticalVulnerabilities:0}});
    }else if(scanner==='semgrep'){
      // A platform-owned, readonly ruleset is required; never load a seller's configuration.
      const result=await command('semgrep',['scan','--config','/opt/processor/rules','--metrics=off','--disable-version-check','--error','--json',scanRoot],180000);
      const report=JSON.parse(result.stdout);if(report.errors?.length)throw new Error('Static analysis reported parse/configuration errors');scans.push({scanner,status:'PASSED',report:{findings:report.results?.length??0}});
    }else{
      const result=await command('syft',['dir:'+scanRoot,'-o','spdx-json'],180000);const report=JSON.parse(result.stdout);
      await writeFile(path.join(output,'sbom.spdx.json'),JSON.stringify(report));scans.push({scanner,status:'PASSED',report:{packages:report.packages?.length??0}});
    }
  }
  if(!configured.length)scans.push({scanner:'static-analysis',status:'NOT_CONFIGURED',report:{notice:'Development only. ProgramPlaza production publishing is blocked until scanners are configured.'}});
}
let technical={};
if(detected.startsWith('image/')){
  const image=sharp(input,{limitInputPixels:40000000,animated:false,failOn:'warning'}).rotate();const metadata=await image.metadata();
  technical={width:metadata.width,height:metadata.height,format:metadata.format};
  const resized=await image.resize({width:1400,height:1000,fit:'inside',withoutEnlargement:true}).toBuffer({resolveWithObject:true});
  const w=resized.info.width,h=resized.info.height;
  const watermark=Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="${Math.max(0,h-48)}" width="${w}" height="48" fill="#111827" opacity="0.65"/><text x="16" y="${h-17}" fill="white" font-size="19" font-family="sans-serif">CreateCanyon · preview</text></svg>`);
  const filename='preview.webp';await sharp(resized.data).composite([{input:watermark}]).webp({quality:78}).toFile(path.join(output,filename));previews.push({filename,mime:'image/webp'});
}else if(detected.startsWith('audio/')||detected==='application/ogg'){
  if(process.env.ENABLE_AUDIO_PROCESSOR==='true'){
    const result=await command('ffprobe',['-v','error','-show_format','-show_streams','-of','json',input]);const report=JSON.parse(result.stdout);
    technical={duration:Number(report.format?.duration??0),streams:report.streams?.map(s=>({codec:s.codec_name,sampleRate:s.sample_rate,channels:s.channels}))};
    await command('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-protocol_whitelist','file,pipe','-i',input,'-t','45','-map_metadata','-1','-vn','-ac','2','-ar','44100','-b:a','96k','-y',path.join(output,'preview.mp3')]);previews.push({filename:'preview.mp3',mime:'audio/mpeg'});
    await command('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-protocol_whitelist','file,pipe','-i',path.join(output,'preview.mp3'),'-filter_complex','showwavespic=s=1200x240','-frames:v','1','-y',path.join(output,'waveform.png')]);previews.push({filename:'waveform.png',mime:'image/png'});
  }
}else if(detected==='application/pdf'||detected.startsWith('application/vnd.openxmlformats-officedocument.')){
  if(process.env.ENABLE_DOCUMENT_PROCESSOR==='true'){
    let pdf=input;
    if(detected!=='application/pdf'){
      const extension=detected.includes('wordprocessing')?'docx':detected.includes('presentation')?'pptx':'xlsx';const source=path.join(output,'document.'+extension);await copyFile(input,source);
      const profile=path.join(output,'lo-profile');await mkdir(path.join(profile,'user'),{recursive:true});
      await writeFile(path.join(profile,'user','registrymodifications.xcu'),'<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>');
      await command('libreoffice',['-env:UserInstallation=file://'+profile,'--headless','--nologo','--nodefault','--norestore','--convert-to','pdf','--outdir',output,source],120000);pdf=path.join(output,'document.pdf');
    }
    await command('qpdf',['--check',pdf],30000,[0,3]);
    const info=(await command('pdfinfo',[pdf],30000)).stdout;const pages=Number(info.match(/^Pages:\s+(\d+)/m)?.[1]??0);technical={pages};
    if(pages>1000)throw new Error('Document page limit exceeded');
    await command('pdftoppm',['-f','1','-singlefile','-scale-to','1400','-png',pdf,path.join(output,'page')],60000);
    await sharp(path.join(output,'page.png'),{limitInputPixels:4000000}).webp({quality:75}).toFile(path.join(output,'preview.webp'));previews.push({filename:'preview.webp',mime:'image/webp'});
  }
}
for(const preview of previews){const filename=path.join(output,preview.filename);preview.sha256=await digest(filename);preview.bytes=(await stat(filename)).size;}
const report={version:1,detectedMime:detected,inputSha256:await digest(input),technical,archive:archiveReport,scans,previews,
  previewStatus:previews.length?'GENERATED':'NOT_AVAILABLE',codeScannersComplete:!isCode||['gitleaks','trivy','semgrep','syft'].every(s=>scans.some(x=>x.scanner===s&&x.status==='PASSED'))};
await writeFile(path.join(output,'report.json'),JSON.stringify(report));
