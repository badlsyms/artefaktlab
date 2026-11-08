const {chromium}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const base=path.resolve(__dirname,'../public');
(async()=>{
 const server=http.createServer(async(req,res)=>{
  if(req.url.startsWith('/api/')){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Test server offline'}));return}
  try{const file=path.resolve(base,'.'+decodeURIComponent(req.url.split('?')[0]));if(file!==base&&!file.startsWith(base+path.sep))throw Error();const target=file===base?path.join(base,'index.html'):file;const data=await fs.readFile(target);res.writeHead(200,{'Content-Type':({'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.html':'text/html','.webmanifest':'application/manifest+json','.json':'application/json'})[path.extname(target)]||'application/octet-stream'});res.end(data)}catch{res.writeHead(404);res.end()}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{browser=await chromium.launch({headless:true});for(const [width,height] of [[320,740],[360,800],[393,852],[412,915],[852,393],[1280,800]]){
  const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForTimeout(200);
  if(await page.locator('#freqList').count()){
   await page.locator('#freqList input').nth(0).check();await page.locator('#freqList input').nth(1).check();
   assert.equal(await page.locator('#freqList input:checked').count(),2);
   await page.locator('#customFreq').fill('440');await page.locator('#addFreq').click();await page.locator('#customFreq').fill('440');await page.locator('#addFreq').click();assert.equal(await page.locator('#freqList input[value="440"]').count(),1);
   await page.locator('#btnEnable').click();await page.locator('#btnStart').click();assert(await page.locator('#btnStop').isEnabled());await page.locator('#btnStop').click();
  }
  for(const theme of ['light','dark']){
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   for(const scale of [100,200]){
    await page.evaluate(scale=>document.documentElement.style.fontSize=scale+'%',scale);
    const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(layout.scroll<=width+2,JSON.stringify({theme,scale,layout}));
   }
  }
  await page.evaluate(()=>document.documentElement.style.fontSize='100%');await page.locator('#themeToggle').click();const stored=await page.evaluate(()=>document.documentElement.dataset.theme);await page.reload();assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),stored);
  assert.deepEqual(errors,[]);console.log('PASS UI',width,height,'both themes, text 200%, theme persistence');await page.close();
 }}finally{await browser?.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
