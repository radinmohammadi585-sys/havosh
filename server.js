const http=require('http'),https=require('https'),fs=require('fs'),path=require('path');

// ---------- .env loader (no extra npm package needed) ----------
function loadDotEnv(){
  try{
    const raw=fs.readFileSync(path.join(__dirname,'.env'),'utf8');
    for(const line of raw.split(/\r?\n/)){
      const m=line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if(!m) continue;
      let v=m[2];
      if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
      if(process.env[m[1]]===undefined) process.env[m[1]]=v;
    }
  }catch{}
}
loadDotEnv();

// --- OpenRouter fallback key (تمیز شده، بدون کاراکتر اضافه) ---
const FALLBACK_OPENROUTER_KEY='b6bdbf0bb77ecaacdf6da8942003105e';
if(!process.env.OPENROUTER_API_KEY) process.env.OPENROUTER_API_KEY=FALLBACK_OPENROUTER_KEY;
// پاک‌سازی: حذف فاصله، نقل‌قول و هر کاراکتر غیر ASCII از کلید
process.env.OPENROUTER_API_KEY=String(process.env.OPENROUTER_API_KEY).replace(/[^\x21-\x7E]/g,'').trim();

const {solve:solveMath,plainMath,looksMath}=require('./math.js');
const PORT=Number(process.env.PORT||3000), BASE=__dirname, PUBLIC=path.join(BASE,'public');
const MEMORY=path.join(BASE,'ai-memory.json');

// ---------- providers: ONE key is enough, all editions share it ----------
const ORDER=(process.env.PROVIDER_ORDER||'openrouter,openai,anthropic,deepseek,xai,gemini,newapi_channel_conn').split(',').map(s=>s.trim()).filter(Boolean);
const MODELS={openrouter:process.env.OPENROUTER_MODEL||'openrouter/free',openai:process.env.OPENAI_MODEL||'gpt-5.6',anthropic:process.env.ANTHROPIC_MODEL||'claude-sonnet-4-5',deepseek:process.env.DEEPSEEK_MODEL||'deepseek-chat',xai:process.env.XAI_MODEL||'grok-4',gemini:process.env.GEMINI_MODEL||'gemini-2.5-flash',newapi_channel_conn:process.env.NEWAPI_CHANNEL_CONN_MODEL||'default'};
const keys={openrouter:'OPENROUTER_API_KEY',openai:'OPENAI_API_KEY',anthropic:'ANTHROPIC_API_KEY',deepseek:'DEEPSEEK_API_KEY',xai:'XAI_API_KEY',gemini:'GEMINI_API_KEY',newapi_channel_conn:'NEWAPI_CHANNEL_CONN_API_KEY'};
function newapiChannelConnUrl(){
  const base=String(process.env.NEWAPI_CHANNEL_CONN_BASE_URL||'').trim();
  if(!base)return '';
  try{
    const u=new URL(base);
    if(!/^https?:$/.test(u.protocol)||u.username||u.password||u.search||u.hash)return '';
    const path=u.pathname.replace(/\/+$/,'');
    if(/\/chat\/completions$/i.test(path))return u.href;
    if(/\/v1$/i.test(path))u.pathname=path+'/chat/completions';
    else u.pathname=path+'/v1/chat/completions';
    return u.href;
  }catch{return ''}
}
const configured=p=>p==='newapi_channel_conn'?(!!process.env[keys[p]]&&!!newapiChannelConnUrl()):!!process.env[keys[p]];

// ---------- "intelligence level" of each edition (percent) ----------
const POWER={
  lite:  Number(process.env.LITE_POWER  ||50),
  mios:  Number(process.env.MIOS_POWER  ||80),
  astara:Number(process.env.ASTARA_POWER||100)
};
function tune(edition){
  const pct=Math.max(10,Math.min(100,POWER[edition]??100)), p=pct/100;
  return {
    pct,
    maxTokens:Math.round(400+3700*p*p),
    history:Math.max(4,Math.round(20*p)),
    memory:Math.round(30*p*p),
    results:Math.max(2,Math.round(1+5*p)),
    temperature:pct>=90?0.6:pct>=60?0.5:0.4,
    style:pct>=90?"پاسخ کامل، عمیق و دقیق بده؛ در مسائل سخت مرحله‌به‌مرحله و با بررسی چند زاویه تحلیل کن."
         :pct>=60?"پاسخ متعادل، دقیق و آموزشی بده؛ توضیح کافی بده ولی طولانی نکن."
         :"پاسخ کوتاه، سریع و مستقیم بده؛ فقط نکات اصلی را بگو."
  };
}

// ---------- helpers ----------
const jsonFile=(f,d)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}};
const save=(f,d)=>{fs.writeFileSync(f+'.tmp',JSON.stringify(d,null,2));fs.renameSync(f+'.tmp',f)};
const clean=s=>String(s??'').replace(/\0/g,'').trim().slice(0,30000);
function safety(s){
  const t=clean(s).toLowerCase();
  const bad=[/ساخت.{0,25}(بمب|مواد منفجره|سلاح)/,/build.{0,30}(bomb|explosive|weapon)/,/سرقت.{0,30}(رمز|پسورد|اکانت)/,/(steal|phish).{0,30}(password|account|token)/,/خودکشی.{0,30}(روش|چگونه|چطور)/,/(suicide|self.?harm).{0,30}(how|method|instructions)/,/پورنو.{0,20}(کودک|نوجوان)/];
  return {ok:!bad.some(r=>r.test(t))};
}

// ---------- HTTP ----------
function reqJson(url,opts={}){return new Promise((res,rej)=>{
  const u=new URL(url),lib=u.protocol==='https:'?https:http;
  const r=lib.request(u,{method:opts.method||'POST',headers:{'Content-Type':'application/json',...(opts.headers||{})},timeout:opts.timeout||60000},x=>{
    let d='';x.setEncoding('utf8');x.on('data',c=>d+=c);
    x.on('end',()=>{let j;try{j=JSON.parse(d)}catch{j={raw:d}}
      if(x.statusCode<200||x.statusCode>=300)return rej(new Error(j?.error?.message||j?.message||('HTTP '+x.statusCode)));
      res(j)});
  });
  r.on('timeout',()=>r.destroy(new Error('timeout')));r.on('error',rej);
  if((opts.method||'POST')!=='GET')r.write(JSON.stringify(opts.body||{}));
  r.end();
})}
function getText(url,redirects=3){return new Promise((res,rej)=>{
  const u=new URL(url),lib=u.protocol==='https:'?https:http;
  const r=lib.get(u,{headers:{'User-Agent':'Mozilla/5.0 (compatible; KavoshBot/3.0)','Accept-Language':'fa,en;q=0.8'},timeout:9000},x=>{
    if(x.statusCode>=300&&x.statusCode<400&&x.headers.location&&redirects>0){x.resume();return res(getText(new URL(x.headers.location,u).href,redirects-1))}
    if(x.statusCode<200||x.statusCode>=300){x.resume();return rej(new Error('HTTP '+x.statusCode))}
    let d='';x.setEncoding('utf8');x.on('data',c=>{d+=c;if(d.length>1500000)r.destroy()});x.on('end',()=>res(d));
  });
  r.on('timeout',()=>r.destroy(new Error('timeout')));r.on('error',rej);
})}

// ---------- web search ----------
const strip=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#x27;|&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();
async function searchTavily(q,n){
  const r=await reqJson('https://api.tavily.com/search',{body:{api_key:process.env.TAVILY_API_KEY,query:q,max_results:n,search_depth:'basic'}});
  return (r.results||[]).map(x=>({title:x.title,url:x.url,snippet:clean(x.content).slice(0,500)}));
}
async function searchDDG(q,n){
  const html=await getText('https://html.duckduckgo.com/html/?q='+encodeURIComponent(q));
  const re=/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const hits=[];let m;
  while((m=re.exec(html)))hits.push({index:m.index,end:re.lastIndex,href:m[1],title:strip(m[2])});
  return hits.slice(0,n).map((h,i)=>{
    const next=hits[i+1]?hits[i+1].index:html.length;
    const sn=html.slice(h.end,next).match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    let url=h.href;
    const ud=url.match(/[?&]uddg=([^&]+)/);
    if(ud){try{url=decodeURIComponent(ud[1])}catch{}}
    if(url.startsWith('//'))url='https:'+url;
    return {title:h.title,url,snippet:strip(sn?sn[1]:'')};
  }).filter(x=>/^https?:\/\//.test(x.url));
}
async function searchWiki(q,n){
  const lang=/[؀-ۿ]/.test(q)?'fa':'en';
  const j=JSON.parse(await getText(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&utf8=1&srlimit=${n}`));
  return (j.query?.search||[]).map(x=>({title:x.title,url:`https://${lang}.wikipedia.org/wiki/${encodeURIComponent(x.title.replace(/ /g,'_'))}`,snippet:strip(x.snippet)}));
}
async function webSearch(q,n){
  q=clean(q).slice(0,250);
  const engines=[];
  if(process.env.TAVILY_API_KEY)engines.push(searchTavily);
  engines.push(searchDDG,searchWiki);
  for(const e of engines){
    try{const r=await e(q,n);if(r.length)return r}catch{}
  }
  return [];
}
const SEARCH_HINT=/امروز|الان|اکنون|اخبار|خبر|آخرین|اخیر|جدید|قیمت|نرخ|دلار|طلا|سکه|بیت‌?کوین|هوای|آب‌?و‌?هوا|نتیجه|نتایج|جستجو|سرچ|گوگل|search|latest|news|today|current|price|weather|score|release|\b20(2[4-9]|3\d)\b|۲۰۲[۴-۹]|۱۴۰[۳-۹]|۱۵\d\d/i;
function wantSearch(mode,text){
  if(mode===true||mode==='on'||mode==='always')return true;
  if(mode===false||mode==='off')return false;
  return SEARCH_HINT.test(text);
}

// ---------- LLM call ----------
async function ask(p,messages,opt){
  const key=process.env[keys[p]];
  if(!key)throw new Error('no key');
  // پاک‌سازی کلید از هر کاراکتر غیر ASCII (جلوگیری از خطای Invalid character in header)
  const safeKey=String(key).replace(/[^\x21-\x7E]/g,'').trim();
  const maxTokens=opt.maxTokens,temperature=opt.temperature;
  if(p==='anthropic'){
    const r=await reqJson('https://api.anthropic.com/v1/messages',{headers:{'x-api-key':safeKey,'anthropic-version':'2023-06-01'},body:{model:MODELS[p],max_tokens:maxTokens,temperature,messages:messages.filter(x=>x.role!=='system'),system:messages.find(x=>x.role==='system')?.content}});
    return r.content?.map(x=>x.text||'').join('')||'';
  }
  if(p==='gemini'){
    const q=messages.filter(x=>x.role!=='system').map(x=>({role:x.role==='assistant'?'model':'user',parts:[{text:x.content}]}));
    const sys=messages.find(x=>x.role==='system')?.content;
    if(sys)q.unshift({role:'user',parts:[{text:sys}]});
    const r=await reqJson('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(MODELS[p])+':generateContent?key='+encodeURIComponent(safeKey),{body:{contents:q,generationConfig:{temperature,maxOutputTokens:maxTokens}}});
    return r.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('')||'';
  }
  const url=p==='newapi_channel_conn'?newapiChannelConnUrl():p==='openrouter'?'https://openrouter.ai/api/v1/chat/completions':p==='openai'?'https://api.openai.com/v1/chat/completions':p==='deepseek'?'https://api.deepseek.com/chat/completions':'https://api.x.ai/v1/chat/completions';
  const headers={Authorization:'Bearer '+safeKey};
  if(p==='openrouter'){headers['HTTP-Referer']=process.env.SITE_URL||'https://kavosh.onrender.com';headers['X-Title']='Kavosh'}
  const r=await reqJson(url,{headers,body:{model:MODELS[p],messages,max_tokens:maxTokens,temperature}});
  return r.choices?.[0]?.message?.content||'';
}

const systemPrompt=(edition)=>`تو دستیار عمومی هوشمند «کاوش» هستی. حوزه پاسخ‌گویی تو محدود به سلامت نیست و می‌توانی در آموزش، ریاضی، علوم، زبان، برنامه‌نویسی، تاریخ، ایده‌پردازی، نوشتن، تحلیل، فناوری و کارهای روزمره کمک کنی. فارسی را طبیعی و دقیق پاسخ بده. برای ریاضی مرحله‌به‌مرحله حل کن. اگر اطلاعات قطعی نیست، صادقانه بگو. محتوای آموزشی و مفید را بی‌دلیل سانسور نکن. فقط در درخواست‌های واقعاً خطرناک یا سوءاستفاده‌گرانه از ارائه دستور عملیاتی خودداری کن. ریاضی را با متن ساده و نمادهای یونیکد بنویس (×، ÷، √، ²، ≤، π) و هرگز از LaTeX، علامت دلار یا بک‌اسلش استفاده نکن. نسخه فعال: ${edition}.`;

async function chat(body){
  const req=body.edition||body.mode;
  const edition=POWER[req]!==undefined?req:'astara';
  let t=tune(edition);
  const msgs=Array.isArray(body.messages)
    ?body.messages.map(x=>({role:x.role==='assistant'?'assistant':'user',content:clean(x.content)})).filter(x=>x.content).slice(-t.history)
    :[{role:'user',content:clean(body.message)}];
  const user=msgs.at(-1)?.content||'';
  if(!user)return {answer:'پیامی دریافت نشد.'};
  if(!safety(user).ok)return {answer:'نمی‌توانم دستورالعمل عملی برای آسیب‌زدن یا سوءاستفاده ارائه کنم، اما می‌توانم دربارهٔ جنبهٔ آموزشی، ایمنی یا پیشگیری آن توضیح بدهم.'};
  const c=solveMath(user);
  if(c!==null)return {answer:c};

  const isMath=looksMath(user);
  if(isMath){
    t={...t,temperature:0.2,maxTokens:Math.max(t.maxTokens,2400),
      style:t.style+' این یک مسئله ریاضی است: مرحله‌به‌مرحله حل کن، هر محاسبه را یک بار دوباره بررسی کن و پاسخ نهایی را در یک خط جدا با عنوان «پاسخ:» بنویس.'};
  }

  let sources=[],searchCtx='';
  if(wantSearch(isMath&&body.search!=='on'&&body.search!==true?'off':body.search,user)){
    sources=await webSearch(user,t.results);
    if(sources.length){
      searchCtx='\n\nنتایج جستجوی وب (امروز: '+new Date().toISOString().slice(0,10)+'). برای اطلاعات به‌روز از این نتایج استفاده کن، در متن به منبع اشاره کن و اگر نتایج کافی نیستند صادقانه بگو:\n'+
        sources.map((s,i)=>`[${i+1}] ${s.title}\n${s.snippet}\n${s.url}`).join('\n\n');
    }
  }

  const mem=searchCtx?[]:jsonFile(MEMORY,[]).slice(0,t.memory);
  const memCtx=mem.length?'\nیادداشت‌های مرتبط قبلی:\n'+mem.map(x=>`- ${x.q} → ${String(x.a).slice(0,300)}`).join('\n'):'';
  const all=[{role:'system',content:systemPrompt(edition)+'\nسبک پاسخ: '+t.style+searchCtx+memCtx},...msgs];

  const errors=[];
  for(const p of ORDER){
    if(!configured(p))continue;
    try{
      const answer=plainMath(await ask(p,all,t));
      if(answer){
        if(body.learn!==false&&!searchCtx){
          const arr=jsonFile(MEMORY,[]);
          arr.unshift({q:user.slice(0,300),a:clean(answer).slice(0,2000),provider:p,edition,at:new Date().toISOString()});
          save(MEMORY,arr.slice(0,500));
        }
        return {answer,sources,searched:sources.length>0,provider:p};
      }
    }catch(e){errors.push(p+': '+e.message)}
  }
  if(errors.length)return {answer:'سرویس هوش مصنوعی در دسترس نبود. دوباره تلاش کن. ('+errors.join(' | ')+')',sources};
  return {answer:'کاوش فعلاً به موتور هوش مصنوعی وصل نیست. مدیر سایت باید یک API Key در تنظیمات سرور (Environment) قرار دهد.',sources};
}

// ---------- image & video generation ----------
const IMAGE_MODEL=process.env.IMAGE_MODEL||'gpt-image-1';
const VIDEO_MODEL=process.env.VIDEO_MODEL||'minimax/video-01';
const firstChatProvider=()=>ORDER.find(configured);
async function englishPrompt(text){
  const p=firstChatProvider();
  if(!p||!/[؀-ۿ]/.test(text))return text;
  try{
    const out=await ask(p,[
      {role:'system',content:'Translate the user text into a vivid, detailed English prompt for an image/video generator. Output only the prompt, no quotes or explanations.'},
      {role:'user',content:text}],{maxTokens:300,temperature:0.4});
    return clean(out).slice(0,900)||text;
  }catch{return text}
}
async function makeImage(prompt){
  prompt=clean(prompt).slice(0,1500);
  if(!prompt)throw new Error('توضیح تصویر خالی است');
  if(!safety(prompt).ok)throw new Error('این درخواست مجاز نیست.');
  const en=await englishPrompt(prompt);
  if(configured('openai')){
    const r=await reqJson('https://api.openai.com/v1/images/generations',{headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY},timeout:120000,body:{model:IMAGE_MODEL,prompt:en,size:'1024x1024'}});
    const d=r.data?.[0];
    if(d?.b64_json)return {image:'data:image/png;base64,'+d.b64_json,provider:'openai'};
    if(d?.url)return {image:d.url,provider:'openai'};
    throw new Error('پاسخ تصویر خالی بود');
  }
  const seed=Math.floor(Math.random()*1e9);
  return {image:'https://image.pollinations.ai/prompt/'+encodeURIComponent(en)+'?width=1024&height=1024&nologo=true&seed='+seed,provider:'pollinations'};
}
async function startVideo(prompt){
  prompt=clean(prompt).slice(0,1500);
  if(!prompt)throw new Error('توضیح ویدیو خالی است');
  if(!safety(prompt).ok)throw new Error('این درخواست مجاز نیست.');
  if(!process.env.REPLICATE_API_TOKEN)throw new Error('تولید ویدیو فعال نیست: مدیر سایت باید REPLICATE_API_TOKEN را در تنظیمات سرور قرار دهد.');
  const en=await englishPrompt(prompt);
  const r=await reqJson('https://api.replicate.com/v1/models/'+VIDEO_MODEL+'/predictions',{headers:{Authorization:'Bearer '+process.env.REPLICATE_API_TOKEN},timeout:60000,body:{input:{prompt:en}}});
  if(!r.id)throw new Error('شروع تولید ویدیو ناموفق بود');
  return {id:r.id};
}
async function videoStatus(id){
  if(!/^[a-z0-9]{6,64}$/i.test(id||''))throw new Error('شناسه نامعتبر');
  if(!process.env.REPLICATE_API_TOKEN)throw new Error('REPLICATE_API_TOKEN تنظیم نشده است');
  const r=await reqJson('https://api.replicate.com/v1/predictions/'+id,{method:'GET',headers:{Authorization:'Bearer '+process.env.REPLICATE_API_TOKEN}});
  if(r.status==='succeeded'){const o=Array.isArray(r.output)?r.output[0]:r.output;return {status:'done',video:o}}
  if(r.status==='failed'||r.status==='canceled')return {status:'failed',error:String(r.error||'تولید ویدیو ناموفق بود').slice(0,200)};
  return {status:'working'};
}

// ---------- server ----------
function send(res,status,obj){
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Access-Control-Allow-Origin':'*',
    'X-Provider':(obj&&obj.provider)||'unknown'
  });
  res.end(JSON.stringify(obj));
}
const CT={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};
const server=http.createServer((req,res)=>{
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});return res.end()}
  let pn;try{pn=decodeURIComponent(new URL(req.url,'http://localhost').pathname)}catch{return send(res,400,{error:'bad url'})}
  if(pn.length>1)pn=pn.replace(/\/+$/,'');
  if(pn==='/api/health')return send(res,200,{ok:true,name:'Kavosh',version:'3.4.0',editions:Object.fromEntries(Object.keys(POWER).map(k=>[k,POWER[k]+'%'])),providers:ORDER.filter(configured),search:process.env.TAVILY_API_KEY?'tavily':'duckduckgo+wikipedia',image:configured('openai')?'openai':'pollinations',video:process.env.REPLICATE_API_TOKEN?'replicate':'off'});
  if(pn==='/api/ai-chat'){
    if(req.method!=='POST')return send(res,405,{ok:false,error:'از روش POST استفاده کنید'});
    let b='';req.on('data',c=>{b+=c;if(b.length>500000)req.destroy()});
    req.on('end',async()=>{try{send(res,200,{ok:true,...await chat(JSON.parse(b||'{}'))})}catch(e){send(res,500,{ok:false,error:e.message})}});
    return;
  }
  if(pn==='/api/image'||pn==='/api/video'){
    if(req.method!=='POST')return send(res,405,{ok:false,error:'از روش POST استفاده کنید'});
    let b='';req.on('data',c=>{b+=c;if(b.length>100000)req.destroy()});
    req.on('end',async()=>{try{
      const body=JSON.parse(b||'{}');
      send(res,200,{ok:true,...(pn==='/api/image'?await makeImage(body.prompt):await startVideo(body.prompt))});
    }catch(e){send(res,200,{ok:false,error:e.message})}});
    return;
  }
  if(pn==='/api/video-status'&&req.method==='GET'){
    const id=new URL(req.url,'http://localhost').searchParams.get('id');
    videoStatus(id).then(r=>send(res,200,{ok:true,...r})).catch(e=>send(res,200,{ok:false,error:e.message}));
    return;
  }
  if(pn==='/api/memory'&&req.method==='GET')return send(res,200,{items:jsonFile(MEMORY,[]).slice(0,100)});
  const file=pn==='/'?'/index.html':pn;
  const p=path.normalize(path.join(PUBLIC,file));
  if(!p.startsWith(PUBLIC))return send(res,403,{error:'forbidden'});
  fs.readFile(p,(e,d)=>{
    if(e){
      if(pn==='/')return fs.readFile(path.join(BASE,'index.html'),(e2,d2)=>{
        if(e2){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('index.html پیدا نشد. آن را داخل پوشه public بگذارید.')}
        res.writeHead(200,{'Content-Type':CT['.html']});res.end(d2);
      });
      res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Not found');
    }
    res.writeHead(200,{'Content-Type':CT[path.extname(p)]||'application/octet-stream'});res.end(d);
  });
});
if(require.main===module)server.listen(PORT,'0.0.0.0',()=>console.log(`Kavosh 3.4 running on http://localhost:${PORT}`));
module.exports={tune,webSearch,wantSearch,chat};