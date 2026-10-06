'use strict';
// Kavosh Advanced Math Engine v4.0
// Persian/English arithmetic, algebra, calculus, trig, matrices, statistics.
// No eval(). Symbolic math. Returns null when unsure -> falls through to AI.

const PD='۰۱۲۳۴۵۶۷۸۹', AD='٠١٢٣٤٥٦٧٨٩';
const toLatin=s=>String(s).replace(/[۰-۹]/g,c=>PD.indexOf(c)).replace(/[٠-٩]/g,c=>AD.indexOf(c));
const toFa=s=>String(s).replace(/[0-9]/g,d=>PD[d]);

class MathMsg extends Error{}
class NotBig extends Error{}

const L='A-Za-z\\u0600-\\u06FF';
const word=(alts,flags='gi')=>new RegExp('(?<![' + L + '])(?:' + alts + ')(?![' + L + '])',flags);

const FILLERS=word('حاصل|حاصلِ|جواب|پاسخ|چند|چنده|چقدر|چقدره|می\\s?شود|می\\s?شه|میشه|میشود|است|هست|برابر|مساوی|محاسبه|حساب\\s*کن|بگو|بده|لطفا|لطفاً|را|رو|مقدار|what\\s+is|what\'s|calculate|compute|equals?|how\\s+much\\s+is|result\\s+of|the|is');
const REPL=[
  [word('تقسیم\\s*بر|تقسیم|divided\\s+by'),'/'],
  [word('ضرب\\s*در|ضربدر|ضرب|times|multiplied\\s+by'),'*'],
  [word('به\\s*علاوه|بعلاوه|جمع|پلاس|plus'),'+'],
  [word('منهای|منها|تفریق|minus'),'-'],
  [word('به\\s*توان|توان|to\\s+the\\s+power\\s+of|power'),'^'],
  [word('جذر|ریشه\\s*دوم|ریشه|square\\s+root\\s+of|sqrt'),'sqrt'],
];

// ---------------- helpers ----------------
function gcd(a,b){a=Math.abs(a);b=Math.abs(b);while(b){[a,b]=[b,a%b]}return a}
function lcm(a,b){return Math.abs(a*b)/gcd(a,b)}
function factorial(n){
  if(!Number.isInteger(n)||n<0)throw new MathMsg('فاکتوریل فقط برای عدد صحیح منفی تعریف می‌شود.');
  if(n>170)throw new MathMsg('این فاکتوریل از محدوده محاسبه بیرون است.');
  let r=1;for(let k=2;k<=n;k++)r*=k;return r;
}

// ---------------- normalize ----------------
function normalize(raw){
  let s=toLatin(raw).replace(/\u200c/g,' ').replace(/٫/g,'.').replace(/٬/g,',');
  s=s.replace(/[×·⋅✕]/g,'*').replace(/÷/g,'/').replace(/[−–—]/g,'-')
       .replace(/√/g,' sqrt ').replace(/\*\*/g,'^').replace(/π/g,' pi ');
  s=s.replace(/\d{1,3}(?:[,،]\d{3})+(?!\d)/g,m=>m.replace(/[,،]/g,''));
  s=s.replace(/[؟?:]/g,' ');
  s=s.replace(/فاکتوریل\s*(\d+)/g,'$1!').replace(/(\d+)\s*فاکتوریل/g,'$1!');
  if(!s.includes('='))s=s.replace(/(?<=\d)\s*[xX]\s*(?=\d)/g,'*');
  return s;
}

// =================================================================
// 1) advanced pattern detectors
// =================================================================
function tryDerivative(text){
  const m=text.match(/(?:مشتق|derivative(?:\s+of)?)\s*[:\-]?\s*(.+?)\s*$/i);
  if(!m)return null;
  const terms=parsePolynomial(m[1]);
  if(!terms)return null;
  const d=derivativePoly(terms);
  return `مشتق: ${polyToString(d)}`;
}
function tryIntegral(text){
  const m=text.match(/(?:انتگرال|integral(?:\s+of)?)\s*[:\-]?\s*(.+?)\s*(?:dx)?\s*$/i);
  if(!m)return null;
  const terms=parsePolynomial(m[1]);
  if(!terms)return null;
  const a=integralPoly(terms);
  return `انتگرال: ${polyToString(a)} + C`;
}
function tryLimit(text){
  const m=text.match(/(?:حد|limit)\s*(?:of)?\s*[:\-]?\s*(.+?)\s*(?:وقتی|هنگامی|که|as|when)\s*x\s*(?:→|->|به\s*سمت|approach(?:es)?|میل\s*کند\s*به)\s*(-?\d+(?:\.\d+)?)/i);
  if(!m)return null;
  const target=parseFloat(m[2]);
  const b=build(m[1]);
  if(!b||!hasVar(b.tree))return null;
  try{
    const eps=1e-6;
    const f=x=>evalN(b.tree,x);
    const L=f(target-eps), R=f(target+eps), M=f(target);
    let val;
    if(Number.isFinite(M))val=M;
    else if(Number.isFinite(L)&&Number.isFinite(R)&&Math.abs(L-R)<1e-3)val=(L+R)/2;
    else return null;
    return `حد: ${fmtNum(parseFloat(val.toPrecision(10)))}`;
  }catch{return null}
}
function tryStats(text){
  const m=text.match(/(میانگین|میانه|مجموع|جمع|حاصل\s*ضرب|average|mean|median|sum|product)\s*(?:اعداد|مجموعه|لیست)?\s*[:\-]?\s*([\d\s,،.+\-]+)/i);
  if(!m)return null;
  const nums=(m[2].match(/-?\d+(?:\.\d+)?/g)||[]).map(Number).filter(Number.isFinite);
  if(nums.length<2)return null;
  const op=m[1].toLowerCase();
  const sum=nums.reduce((a,b)=>a+b,0);
  const prod=nums.reduce((a,b)=>a*b,1);
  const mean=sum/nums.length;
  const sorted=[...nums].sort((a,b)=>a-b);
  const median=sorted.length%2?sorted[(sorted.length-1)/2]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2;
  if(/میانگین|average|mean/.test(op))return `میانگین: ${fmtNum(parseFloat(mean.toPrecision(10)))}`;
  if(/میانه|median/.test(op))return `میانه: ${fmtNum(parseFloat(median.toPrecision(10)))}`;
  if(/مجموع|جمع|sum/.test(op))return `مجموع: ${fmtNum(parseFloat(sum.toPrecision(10)))}`;
  if(/ضرب|product/.test(op))return `حاصل‌ضرب: ${fmtNum(parseFloat(prod.toPrecision(10)))}`;
  return null;
}
function tryGCDLCM(text){
  const m=text.match(/(ب\.?\s?م\.?\s?م|ک\.?\s?م\.?\s?م|gcd|gcf|lcm)\s*[:\-(\s]*\s*(-?\d+)\s*(?:و|,|and|\s)\s*(-?\d+)/i);
  if(!m)return null;
  const a=parseInt(m[2]),b=parseInt(m[3]);
  const op=m[1].toLowerCase().replace(/\s/g,'');
  if(/^ب|gcd|gcf/.test(op))return `ب.م.م(${a}،${b}) = ${gcd(a,b)}`;
  return `ک.م.م(${a}،${b}) = ${lcm(a,b)}`;
}
function tryBase(text){
  const m=text.match(/(-?[0-9a-fA-F]+)\s*(?:از\s*مبنای\s*(\d+)\s*)?(?:به|در|to)\s*مبنای?\s*(\d+)/i);
  if(!m)return null;
  const num=m[1], from=parseInt(m[2]||10), to=parseInt(m[3]);
  if(from<2||from>36||to<2||to>36)return null;
  const dec=parseInt(num,from);
  if(!Number.isFinite(dec))return null;
  return `${num} (مبنای ${from}) = ${dec.toString(to).toUpperCase()} (مبنای ${to})`;
}
function trySequence(text){
  const ap=text.match(/(?:دنباله\s*حسابی|arithmetic)[^\d\-]*a1\s*=\s*(-?\d+(?:\.\d+)?)\s*,?\s*d\s*=\s*(-?\d+(?:\.\d+)?)\s*,?\s*n\s*=\s*(\d+)/i);
  if(ap){
    const A=parseFloat(ap[1]),D=parseFloat(ap[2]),N=parseInt(ap[3]);
    const an=A+(N-1)*D, sn=N*(2*A+(N-1)*D)/2;
    return `جمله ${N}اُم: ${fmtNum(an)}\nمجموع ${N} جمله: ${fmtNum(sn)}`;
  }
  const gp=text.match(/(?:دنباله\s*هندسی|geometric)[^\d\-]*a1\s*=\s*(-?\d+(?:\.\d+)?)\s*,?\s*r\s*=\s*(-?\d+(?:\.\d+)?)\s*,?\s*n\s*=\s*(\d+)/i);
  if(gp){
    const A=parseFloat(gp[1]),R=parseFloat(gp[2]),N=parseInt(gp[3]);
    const an=A*Math.pow(R,N-1);
    const sn=Math.abs(R-1)<1e-12?A*N:A*(Math.pow(R,N)-1)/(R-1);
    return `جمله ${N}اُم: ${fmtNum(parseFloat(an.toPrecision(10)))}\nمجموع ${N} جمله: ${fmtNum(parseFloat(sn.toPrecision(10)))}`;
  }
  return null;
}
function tryDet(text){
  const m=text.match(/(?:دترمینان|determinant)\s*[:\-]?\s*\[([^\]]+)\]/i);
  if(!m)return null;
  const nums=(m[1].match(/-?\d+(?:\.\d+)?/g)||[]).map(Number);
  const n=Math.round(Math.sqrt(nums.length));
  if(n*n!==nums.length||(n!==2&&n!==3))return null;
  const M=[];for(let i=0;i<n;i++)M.push(nums.slice(i*n,(i+1)*n));
  let det;
  if(n===2)det=M[0][0]*M[1][1]-M[0][1]*M[1][0];
  else det=M[0][0]*(M[1][1]*M[2][2]-M[1][2]*M[2][1])
        -M[0][1]*(M[1][0]*M[2][2]-M[1][2]*M[2][0])
        +M[0][2]*(M[1][0]*M[2][1]-M[1][1]*M[2][0]);
  return `دترمینان: ${fmtNum(parseFloat(det.toPrecision(10)))}`;
}
function tryLinearSystem(text){
  if(!/و|and|,|;/.test(text))return null;
  const eqs=text.split(/\s*(?:و|and|,|;)\s*/).filter(s=>s.includes('='));
  if(eqs.length!==2)return null;
  if(!eqs.every(e=>/x/i.test(e)&&/y/i.test(e)))return null;
  function parseEq(eq){
    const [l,r]=eq.split('=');
    const body='('+l+')-('+r+')';
    let a=0,b=0,c=0;
    const cleaned=body.replace(/\s+/g,'').replace(/-/g,'+-');
    const re=/([+-]?\d*\.?\d*)\*?([xy])|([+-]?\d+\.?\d*)/gi;
    let m;
    while((m=re.exec(cleaned))){
      if(m[2]){
        const coef=m[1];
        const v=coef===''||coef==='+'?1:coef==='-'?-1:parseFloat(coef);
        if(m[2].toLowerCase()==='x')a+=v;else b+=v;
      }else if(m[3]!==undefined){
        const v=parseFloat(m[3].replace(/\s/g,''));
        if(Number.isFinite(v))c+=v;
      }
    }
    return [a,b,c];
  }
  const [a1,b1,c1]=parseEq(eqs[0]);
  const [a2,b2,c2]=parseEq(eqs[1]);
  const D=a1*b2-a2*b1;
  if(Math.abs(D)<1e-12)return null;
  const Dx=-c1*b2+c2*b1, Dy=-a1*c2+a2*c1;
  return `x = ${fmtNum(parseFloat((Dx/D).toPrecision(10)))}\ny = ${fmtNum(parseFloat((Dy/D).toPrecision(10)))}`;
}

// =================================================================
// 2) polynomial parse/derive/integrate/print
// =================================================================
function parsePolynomial(s){
  s=toLatin(s).replace(/\s+/g,'').replace(/\*\*/g,'^').replace(/-/g,'+-');
  if(!/^[+\-]?[\dxX^.*/()]+$/.test(s))return null;
  s=s.replace(/(?<=\d)(?=[xX])/g,'*').replace(/(?<=[xX])(?=\d)/g,'^');
  const parts=s.split('+').filter(Boolean);
  const terms={};
  for(const p of parts){
    let m;
    if((m=p.match(/^(-?\d*\.?\d*)\*?x\^(\d+)$/i))){
      const c=m[1]===''||m[1]==='+'?1:m[1]==='-'?-1:parseFloat(m[1]);
      terms[m[2]]=(terms[m[2]]||0)+c;
    }else if((m=p.match(/^(-?\d*\.?\d*)\*?x$/i))){
      const c=m[1]===''||m[1]==='+'?1:m[1]==='-'?-1:parseFloat(m[1]);
      terms[1]=(terms[1]||0)+c;
    }else if((m=p.match(/^(-?\d+\.?\d*)$/))){
      terms[0]=(terms[0]||0)+parseFloat(m[1]);
    }else return null;
  }
  return terms;
}
function derivativePoly(t){const o={};for(const k in t){const p=+k;if(p>0)o[p-1]=(o[p-1]||0)+t[k]*p}return o}
function integralPoly(t){const o={};for(const k in t){const p=+k;o[p+1]=(o[p+1]||0)+t[k]/(p+1)}return o}
function polyToString(t){
  const keys=Object.keys(t).map(Number).filter(k=>Math.abs(t[k])>1e-12).sort((a,b)=>b-a);
  if(!keys.length)return '0';
  let out='';
  keys.forEach((k,i)=>{
    const c=t[k];
    let s;
    if(k===0)s=fmtNum(c);
    else if(k===1)s=(Math.abs(c)===1?(c<0?'-':''):fmtNum(c)+'*')+'x';
    else s=(Math.abs(c)===1?(c<0?'-':''):fmtNum(c)+'*')+'x^'+k;
    if(i>0&&c>0)s=' + '+s;
    else if(i>0)s=' - '+s.replace(/^-/,'');
    else s=s;
    out+=s;
  });
  return out;
}

// =================================================================
// 3) tokenizer / parser
// =================================================================
function tokenize(c){
  const re=/\d+(?:\.\d+)?|\.\d+|sqrt|cbrt|abs|ln|log2|log|exp|sin|cos|tan|cot|sec|csc|asin|acos|atan|sinh|cosh|tanh|pi|e|x|[-+*\/^()!%,]/y;
  const out=[];let pos=0;
  while(pos<c.length){
    re.lastIndex=pos;
    const m=re.exec(c);
    if(!m)return null;
    out.push(m[0]);pos=re.lastIndex;
  }
  return out;
}
function parse(tokens){
  let i=0;
  const peek=()=>tokens[i], next=()=>tokens[i++];
  function expr(){let l=term();while(peek()==='+'||peek()==='-'){const o=next();l={t:'bin',o,l,r:term()}}return l}
  function term(){let l=unary();while(peek()==='*'||peek()==='/'||peek()==='%'){const o=next();l={t:'bin',o,l,r:unary()}}return l}
  function unary(){
    if(peek()==='-'){next();return {t:'neg',v:unary()}}
    if(peek()==='+'){next();return unary()}
    return pow();
  }
  function pow(){const b=post();if(peek()==='^'){next();return {t:'bin',o:'^',l:b,r:unary()}}return b}
  function post(){let v=prim();while(peek()==='!'){next();v={t:'fact',v}}return v}
  function prim(){
    const t=next();
    if(t===undefined)throw new Error('eof');
    if(/^[\d.]/.test(t))return {t:'num',v:t};
    if(t==='pi')return {t:'pi'};
    if(t==='e')return {t:'e'};
    if(t==='x')return {t:'var'};
    if(t==='('){const e=expr();if(next()!==')')throw new Error('paren');return e}
    if(['sqrt','cbrt','abs','ln','log','log2','exp','sin','cos','tan','cot','sec','csc','asin','acos','atan','sinh','cosh','tanh'].includes(t))
      return {t:'fn',f:t,v:post()};
    throw new Error('bad token '+t);
  }
  const tree=expr();
  if(i!==tokens.length)throw new Error('leftover');
  return tree;
}
const hasVar=n=>n&&(n.t==='var'||(n.l&&hasVar(n.l))||(n.r&&hasVar(n.r))||(n.v&&typeof n.v==='object'&&hasVar(n.v)));
const isBare=n=>n&&(n.t==='num'||n.t==='pi'||n.t==='e');

// =================================================================
// 4) numeric evaluator
// =================================================================
function evalN(n,x){
  switch(n.t){
    case 'num':return parseFloat(n.v);
    case 'pi':return Math.PI;
    case 'e':return Math.E;
    case 'var':return x;
    case 'neg':return -evalN(n.v,x);
    case 'fact':return factorial(evalN(n.v,x));
    case 'fn':{
      const v=evalN(n.v,x);
      switch(n.f){
        case 'sqrt':if(v<0)throw new MathMsg('جذر عدد منفی در اعداد حقیقی تعریف نشده است.');return Math.sqrt(v);
        case 'cbrt':return Math.cbrt(v);
        case 'abs':return Math.abs(v);
        case 'exp':return Math.exp(v);
        case 'ln':if(v<=0)throw new MathMsg('لگاریتم فقط برای عدد مثبت تعریف می‌شود.');return Math.log(v);
        case 'log':if(v<=0)throw new MathMsg('لگاریتم فقط برای عدد مثبت تعریف می‌شود.');return Math.log10(v);
        case 'log2':if(v<=0)throw new MathMsg('لگاریتم فقط برای عدد مثبت تعریف می‌شود.');return Math.log2(v);
        case 'sin':return Math.sin(v);
        case 'cos':return Math.cos(v);
        case 'tan':return Math.tan(v);
        case 'cot':return 1/Math.tan(v);
        case 'sec':return 1/Math.cos(v);
        case 'csc':return 1/Math.sin(v);
        case 'asin':if(v<-1||v>1)throw new MathMsg('آرک‌سینوس فقط برای [-1,1] تعریف می‌شود.');return Math.asin(v);
        case 'acos':if(v<-1||v>1)throw new MathMsg('آرک‌کسینوس فقط برای [-1,1] تعریف می‌شود.');return Math.acos(v);
        case 'atan':return Math.atan(v);
        case 'sinh':return Math.sinh(v);
        case 'cosh':return Math.cosh(v);
        case 'tanh':return Math.tanh(v);
      }
    }
    case 'bin':{
      const a=evalN(n.l,x),b=evalN(n.r,x);
      switch(n.o){
        case '+':return a+b;case '-':return a-b;case '*':return a*b;
        case '/':if(b===0)throw new MathMsg('تقسیم بر صفر تعریف نشده است.');return a/b;
        case '%':if(b===0)throw new MathMsg('باقیمانده بر صفر تعریف نشده است.');return a%b;
        case '^':{const r=Math.pow(a,b);if(Number.isNaN(r))throw new MathMsg('این توان در اعداد حقیقی تعریف نشده است.');return r}
      }
    }
  }
  throw new Error('eval');
}
function evalB(n){
  switch(n.t){
    case 'num':if(!/^\d+$/.test(n.v))throw new NotBig();return BigInt(n.v);
    case 'neg':return -evalB(n.v);
    case 'fact':{const v=evalB(n.v);if(v<0n||v>3000n)throw new NotBig();let r=1n;for(let k=2n;k<=v;k++)r*=k;return r}
    case 'bin':{
      const a=evalB(n.l),b=evalB(n.r);
      switch(n.o){
        case '+':return a+b;case '-':return a-b;case '*':return a*b;
        case '/':if(b===0n)throw new MathMsg('تقسیم بر صفر تعریف نشده است.');if(a%b!==0n)throw new NotBig();return a/b;
        case '^':{
          if(b<0n||b>5000n)throw new NotBig();
          const aa=a<0n?-a:a;
          if(aa>1n&&Number(b)*Math.log10(Number(aa>10n**15n?10n**15n:aa))>20000)throw new NotBig();
          return a**b;
        }
      }
    }
  }
  throw new NotBig();
}

// =================================================================
// 5) formatting
// =================================================================
function fmtNum(v){
  if(!Number.isFinite(v))return String(v);
  if(Number.isInteger(v)&&Math.abs(v)<1e21)return String(v);
  return String(parseFloat(v.toPrecision(12)));
}
function fmtBig(b){
  const s=b.toString();
  if(s.length<=40)return s;
  const neg=s[0]==='-',d=neg?s.slice(1):s;
  return `${neg?'-':''}${d[0]}.${d.slice(1,10)}×10^${d.length-1}  (عددی با ${d.length} رقم)`;
}
function fraction(v){
  for(let q=2;q<=1000;q++){const p=Math.round(v*q);if(Math.abs(v-p/q)<1e-9*Math.max(1,Math.abs(v)))return `${p}/${q}`}
  return null;
}
const pretty=c=>c.replace(/\*/g,' × ').replace(/\//g,' ÷ ').replace(/\+/g,' + ')
  .replace(/(?<=[\d)!%a-z])-/g,' - ')
  .replace(/\^/g,'^').replace(/sqrt/g,'√').replace(/cbrt/g,'∛')
  .replace(/pi/g,'π').replace(/\s+/g,' ').trim();

// =================================================================
// 6) build tree from string
// =================================================================
function compact(s){
  let c=s.replace(/\s+/g,'').toLowerCase();
  c=c.replace(/(\d|\))(?=\(|x|pi|e|sqrt|cbrt|abs|ln|log|log2|exp|sin|cos|tan|cot|sec|csc|asin|acos|atan|sinh|cosh|tanh)/g,'$1*')
     .replace(/(x|pi|e)(?=\d|\(|x|pi|e|sqrt|cbrt|sin|cos|tan)/g,'$1*')
     .replace(/\)(?=\d)/g,')*');
  return c;
}
function build(s){
  const tokens=tokenize(compact(s));
  if(!tokens||!tokens.length)return null;
  try{return {tree:parse(tokens),c:tokens.join('')}}catch{return null}
}
function cleanText(raw){
  let s=normalize(raw);
  s=' '+s+' ';
  for(const [re,rep] of REPL) s=s.replace(re,` ${rep} `);
  s=s.replace(FILLERS,' ');
  return s;
}

// =================================================================
// 7) main entry
// =================================================================
function solve(raw){
  const input=String(raw||'');
  if(!input.trim()||input.length>400)return null;
  const latinIn=toLatin(input);
  if(/\b\d{2,4}[-\/.]\d{1,2}[-\/.]\d{1,2}\b/.test(latinIn))return null;
  const faOut=/[۰-۹]/.test(input);
  const out=t=>faOut?toFa(t):t;

  try{
    let s=normalize(input);

    // advanced detectors first
    const advanced=[tryDerivative,tryIntegral,tryLimit,tryStats,tryGCDLCM,tryBase,trySequence,tryDet,tryLinearSystem];
    for(const fn of advanced){
      try{
        const r=fn(s);
        if(r)return out(r);
      }catch{}
    }

    // percent
    const pm=s.match(/^\s*(\d+(?:\.\d+)?)\s*(?:درصد|%|percent)\s*(?:از|of)?\s*(\d+(?:\.\d+)?)\s*$/i);
    if(pm){
      const r=parseFloat(pm[1])/100*parseFloat(pm[2]);
      return out(`${pm[1]}٪ از ${pm[2]} = ${fmtNum(parseFloat(r.toPrecision(12)))}`);
    }

    // equation in x (single =)
    const eqCount=(s.match(/=/g)||[]).length;
    if(eqCount===1&&/x/i.test(s)&&/[^=\s]/.test(s.split('=')[0])&&/[^=\s]/.test(s.split('=')[1])){
      const [ls,rs]=s.split('=');
      const A=build(ls),B=build(rs);
      if(!A||!B)return null;
      const f=x=>evalN(A.tree,x)-evalN(B.tree,x);
      const f0=f(0),f1=f(1),f2=f(2),f3=f(3);
      if(![f0,f1,f2,f3].every(Number.isFinite))return null;
      const tol=1e-9*(1+Math.abs(f0)+Math.abs(f1)+Math.abs(f2)+Math.abs(f3));
      const showNum=v=>{
        const iv=parseFloat(v.toPrecision(12));
        const d=Number.isInteger(iv)?fmtNum(iv):fmtNum(parseFloat(v.toFixed(6)));
        const fr=Number.isInteger(iv)?null:fraction(v);
        return fr?`${fr} ≈ ${d}`:d;
      };
      if(Math.abs(f2-2*f1+f0)<=tol){
        const a=f1-f0;
        if(Math.abs(a)<1e-12)return Math.abs(f0)<1e-9?'این معادله بی‌شمار جواب دارد (به ازای هر x برقرار است).':'این معادله جواب ندارد.';
        return out(`x = ${showNum(-f0/a)}`);
      }
      const qa=(f2-2*f1+f0)/2, qb=f1-f0-qa, qc=f0;
      if(Math.abs(9*qa+3*qb+qc-f3)>tol||Math.abs(qa)<1e-12)return null;
      const D=qb*qb-4*qa*qc;
      if(D<-1e-12)return 'این معادله ریشه حقیقی ندارد (دلتا منفی است).';
      const form=`Δ = ${fmtNum(parseFloat(D.toPrecision(12)))}`;
      if(Math.abs(D)<1e-12)return out(`${form}\nx = ${showNum(-qb/(2*qa))}  (ریشه مضاعف)`);
      const r1=(-qb+Math.sqrt(D))/(2*qa), r2=(-qb-Math.sqrt(D))/(2*qa);
      return out(`${form}\nx₁ = ${showNum(r1)}\nx₂ = ${showNum(r2)}`);
    }

    s=cleanText(input);
    s=s.replace(/=/g,' ');
    if(/x/i.test(s))return null;

    const b=build(s);
    if(!b)return null;
    if(isBare(b.tree))return null;

    let text;
    try{text=fmtBig(evalB(b.tree))}catch(e){
      if(e instanceof MathMsg)throw e;
      const v=evalN(b.tree,0);
      if(!Number.isFinite(v))return null;
      text=fmtNum(v);
    }
    return out(`${pretty(b.c)} = ${text}`);
  }catch(e){
    if(e instanceof MathMsg)return e.message;
    return null;
  }
}

// =================================================================
// 8) LaTeX -> plain text (for AI answers)
// =================================================================
const SUP={'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','-':'⁻','+':'⁺'};
const SYM={times:'×',cdot:'·',div:'÷',pm:'±',mp:'∓',le:'≤',leq:'≤',ge:'≥',geq:'≥',ne:'≠',neq:'≠',approx:'≈',infty:'∞',pi:'π',theta:'θ',alpha:'α',beta:'β',gamma:'γ',delta:'δ',lambda:'λ',mu:'μ',sigma:'σ',omega:'ω',Delta:'Δ',Sigma:'Σ',sum:'Σ',int:'∫',Rightarrow:'⇒',rightarrow:'→',to:'→',leftrightarrow:'↔',ldots:'…',cdots:'…',degree:'°',circ:'°',in:'∈',cup:'∪',cap:'∩',sin:'sin',cos:'cos',tan:'tan',log:'log',ln:'ln',lim:'lim'};

function convSeg(s){
  const before=s;
  s=s.replace(/\$\$([\s\S]+?)\$\$/g,(m,a)=>/\\/.test(a)?a:m)
     .replace(/\\\[([\s\S]+?)\\\]/g,'$1').replace(/\\\(([\s\S]+?)\\\)/g,'$1')
     .replace(/\$([^$\n]+?)\$/g,(m,a)=>/\\/.test(a)?a:m);
  for(let k=0;k<3;k++){
    s=s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,'($1)/($2)')
       .replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g,'ریشه $1ام($2)')
       .replace(/\\sqrt\s*\{([^{}]*)\}/g,'√($1)')
       .replace(/\\text(?:bf|it|rm)?\s*\{([^{}]*)\}/g,'$1')
       .replace(/\\(?:mathbf|mathrm|boxed|overline|bar)\s*\{([^{}]*)\}/g,'$1');
  }
  s=s.replace(/\\(?:left|right|big|Big|quad|qquad)\b/g,'').replace(/\\[,;!]/g,' ').replace(/\\ /g,' ');
  s=s.replace(/\