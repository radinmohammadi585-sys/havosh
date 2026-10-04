const http=require('http'),https=require('https'),fs=require('fs'),path=require('path'),crypto=require('crypto');
// Load a local .env file without requiring an extra npm package.
// This keeps API keys available after restarting the server.
function loadDotEnv(){
  const f=path.join(__dirname,'.env');
  try{
    const raw=fs.readFileSync(f,'utf8');
    for(const line of raw.split(/\r?\n/)){
      const m=line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if(!m||m[1].startsWith('#')) continue;
      let v=m[2];
      if((v.startsWith('\"')&&v.endsWith('\"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
      if(process.env[m[1]]===undefined) process.env[m[1]]=v;
    }
  }catch{}
}
loadDotEnv();
const PORT=Number(process.env.PORT||3000), BASE=__dirname, PUBLIC=path.join(BASE,'public');
const MEMORY=path.join(BASE,'ai-memory.json');
const EDITIONS={astara:['openrouter','openai','anthropic'],lite:['deepseek','xai'],mios:['gemini']};
const MODELS={openrouter:process.env.OPENROUTER_MODEL||'openrouter/free',openai:process.env.OPENAI_MODEL||'gpt-5.6-luna',anthropic:process.env.ANTHROPIC_MODEL||'claude-sonnet-4-5',deepseek:process.env.DEEPSEEK_MODEL||'deepseek-chat',xai:process.env.XAI_MODEL||'grok-4',gemini:process.env.GEMINI_MODEL||'gemini-2.5-flash'};
const keys={openrouter:'OPENROUTER_API_KEY',openai:'OPENAI_API_KEY',anthropic:'ANTHROPIC_API_KEY',deepseek:'DEEPSEEK_API_KEY',xai:'XAI_API_KEY',gemini:'GEMINI_API_KEY'};
function jsonFile(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}}
function save(f,d){fs.writeFileSync(f+'.tmp',JSON.stringify(d,null,2));fs.renameSync(f+'.tmp',f)}
function clean(s){return String(s??'').replace(/\0/g,'').trim().slice(0,30000)}
function faDigits(s){const fa='۰۱۲۳۴۵۶۷۸۹',ar='٠١٢٣٤٥٦٧٨٩';return String(s).replace(/[۰-۹]/g,x=>fa.indexOf(x)).replace(/[٠-٩]/g,x=>ar.indexOf(x))}
function calc(s){
 let t=faDigits(s).replace(/\s+/g,'').replace(/جمع|بعلاوه|به‌علاوه|به علاوه|plus/gi,'+').replace(/منهای|منهایِ|منها|minus/gi,'-').replace(/ضربدر|ضرب|در|times/gi,'*').replace(/تقسیمبر|تقسیم‌بر|تقسیم/gi,'/').replace(/×/g,'*').replace(/÷/g,'/').replace(/،/g,'.').replace(/,/g,'.');
 if(!/^[0-9+*/().\-]+$/.test(t) || !/[+*/\-]/.test(t)) return null;
 try{let v=Function('"use strict";return ('+t+')')(); if(typeof v==='number'&&Number.isFinite(v)) return String(Number.isInteger(v)?v:Number(v.toFixed(10)))}catch{} return null;
}
function safety(s){const t=clean(s).toLowerCase(); const bad=[/ساخت.{0,25}(بمب|مواد منفجره|سلاح)/,/build.{0,30}(bomb|explosive|weapon)/,/سرقت.{0,30}(رمز|پسورد|اکانت)/,/(steal|phish).{0,30}(password|account|token)/,/خودکشی.{0,30}(روش|چگونه|چطور)/,/(suicide|self.?harm).{0,30}(how|method|instructions)/,/پورنو.{0,20}(کودک|نوجوان)/]; return bad.some(r=>r.test(t))?{ok:false}:{ok:true,text:t}}
function configured(p){return !!process.env[keys[p]]}
function reqJson(url,opts={}){return new Promise((res,rej)=>{const u=new URL(url),lib=u.protocol==='https:'?https:http;const r=lib.request(u,{method:opts.method||'POST',headers:{'Content-Type':'application/json',...(opts.headers||{})},timeout:60000},x=>{let d='';x.setEncoding('utf8');x.on('data',c=>d+=c);x.on('end',()=>{let j;try{j=JSON.parse(d)}catch{j={raw:d}};if(x.statusCode<200||x.statusCode>=300)return rej(new Error(j?.error?.message||j?.message||('HTTP '+x.statusCode)));res(j)})});r.on('timeout',()=>r.destroy(new Error('timeout')));r.on('error',rej);r.write(JSON.stringify(opts.body||{}));r.end()})}
async function ask(p,messages){const key=process.env[keys[p]];if(!key)throw new Error('کلید '+p+' تنظیم نشده است');
 if(p==='anthropic'){const r=await reqJson('https://api.anthropic.com/v1/messages',{headers:{'x-api-key':key,'anthropic-version':'2023-06-01'},body:{model:MODELS[p],max_tokens:4096,messages:messages.filter(x=>x.role!=='system'),system:messages.find(x=>x.role==='system')?.content}});return r.content?.map(x=>x.text||'').join('')||''}
 if(p==='gemini'){const q=messages.filter(x=>x.role!=='system').map(x=>({role:x.role==='assistant'?'model':'user',parts:[{text:x.content}]}));const sys=messages.find(x=>x.role==='system')?.content;if(sys)q.unshift({role:'user',parts:[{text:sys}]});const r=await reqJson('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(MODELS[p])+':generateContent?key='+encodeURIComponent(key),{body:{contents:q,generationConfig:{temperature:.6,maxOutputTokens:4096}}});return r.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('')||''}
 if(p==='openrouter'){
   const r=await reqJson('https://openrouter.ai/api/v1/chat/completions',{headers:{Authorization:'Bearer '+key,'HTTP-Referer':'https://havosh.onrender.com','X-Title':'Kavosh'},body:{model:MODELS[p],messages,max_tokens:4096,temperature:.6}});
   return r.choices?.[0]?.message?.content||'';
 }
 const base=p==='openai'?'https://api.openai.com/v1/chat/completions':p==='deepseek'?'https://api.deepseek.com/chat/completions':'https://api.x.ai/v1/chat/completions';
 const r=await reqJson(base,{headers:{Authorization:'Bearer '+key},body:{model:MODELS[p],messages,max_tokens:4096,temperature:.6}});return r.choices?.[0]?.message?.content||'';
}
function systemPrompt(edition){return `تو دستیار عمومی هوشمند «کاوش» هستی. حوزه پاسخ‌گویی تو محدود به سلامت نیست و می‌توانی در آموزش، ریاضی، علوم، زبان، برنامه‌نویسی، تاریخ، ایده‌پردازی، نوشتن، تحلیل، فناوری و کارهای روزمره کمک کنی. فارسی را طبیعی و دقیق پاسخ بده. برای ریاضی مرحله‌به‌مرحله حل کن. اگر اطلاعات قطعی نیست، صادقانه بگو. محتوای آموزشی و مفید را بی‌دلیل سانسور نکن. فقط در درخواست‌های واقعاً خطرناک یا سوءاستفاده‌گرانه از ارائه دستور عملیاتی خودداری کن. نسخه فعال: ${edition}.`}
async function chat(body){const edition=EDITIONS[body.edition]?body.edition:'astara';const msgs=Array.isArray(body.messages)?body.messages.map(x=>({role:x.role==='assistant'?'assistant':'user',content:clean(x.content)})).slice(-20):[{role:'user',content:clean(body.message)}];const user=msgs.at(-1)?.content||'';const sec=safety(user);if(!sec.ok)return 'نمی‌توانم دستورالعمل عملی برای آسیب‌زدن یا سوءاستفاده ارائه کنم، اما می‌توانم دربارهٔ جنبهٔ آموزشی، ایمنی یا پیشگیری آن توضیح بدهم.';const c=calc(user);if(c!==null)return `نتیجه: ${c}`;const mem=jsonFile(MEMORY,[]).slice(0,30);const context=mem.length?'\nیادداشت‌های مرتبط قبلی:\n'+mem.map(x=>`- ${x.q} → ${x.a}`).join('\n'):'';const all=[{role:'system',content:systemPrompt(edition)+context},...msgs];let errors=[];for(const p of EDITIONS[edition]){if(!configured(p))continue;try{const answer=await ask(p,all);if(answer){if(body.learn!==false){const arr=jsonFile(MEMORY,[]);arr.unshift({q:user,a:clean(answer).slice(0,8000),provider:p,edition,at:new Date().toISOString()});save(MEMORY,arr.slice(0,1000))}return answer}}catch(e){errors.push(p+': '+e.message)}}
return errors.length
  ? 'هیچ سرویس هوش مصنوعی پاسخ نداد. خطاها: '+errors.join(' | ')
  : 'برای این نسخه هنوز API Key تنظیم نشده است.'}
function send(res,status,obj){const d=JSON.stringify(obj);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'});res.end(d)}
const server=http.createServer(async(req,res)=>{if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});return res.end()}
 if(req.url==='/api/health')return send(res,200,{ok:true,name:'Kavosh',version:'3.0.0',editions:Object.keys(EDITIONS)});
 if(req.url==='/api/ai-chat'&&req.method==='POST'){let b='';req.on('data',c=>{b+=c;if(b.length>500000)req.destroy()});req.on('end',async()=>{try{return send(res,200,{ok:true,answer:await chat(JSON.parse(b))})}catch(e){send(res,500,{ok:false,error:e.message})}});return}
 if(req.url==='/api/memory'&&req.method==='GET')return send(res,200,{items:jsonFile(MEMORY,[]).slice(0,100)});
 let u=new URL(req.url,'http://localhost');let file=decodeURIComponent(u.pathname);if(file==='/')file='/index.html';let p=path.normalize(path.join(PUBLIC,file));if(!p.startsWith(PUBLIC))return send(res,403,{error:'forbidden'});fs.readFile(p,(e,d)=>{if(e){res.writeHead(404);return res.end('Not found')}const ext=path.extname(p);const ct={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'}[ext]||'application/octet-stream';res.writeHead(200,{'Content-Type':ct});res.end(d)})
});
server.listen(PORT,()=>console.log(`Kavosh 3.0 running on http://localhost:${PORT}`));
