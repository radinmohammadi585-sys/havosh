'use strict';
// Safe math engine for Kavosh: Persian/English arithmetic, percentages, powers, roots,
// factorials, big integers, linear equations. No eval(). Returns null when it is not sure,
// so the question falls through to the AI model.

const PD='۰۱۲۳۴۵۶۷۸۹', AD='٠١٢٣٤٥٦٧٨٩';
const toLatin=s=>String(s).replace(/[۰-۹]/g,c=>PD.indexOf(c)).replace(/[٠-٩]/g,c=>AD.indexOf(c));
const toFa=s=>String(s).replace(/[0-9]/g,d=>PD[d]);

class MathMsg extends Error{}           // a friendly, final answer (e.g. division by zero)
class NotBig extends Error{}            // BigInt evaluator cannot handle it

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
  [word('فاکتوریل\\s*(\\d+)'),null],
];

function normalize(raw){
  let s=toLatin(raw).replace(/‌/g,' ').replace(/٫/g,'.').replace(/٬/g,',');
  s=s.replace(/[×·⋅✕]/g,'*').replace(/÷/g,'/').replace(/[−–—]/g,'-').replace(/√/g,' sqrt ').replace(/\*\*/g,'^').replace(/π/g,' pi ');
  s=s.replace(/\d{1,3}(?:[,،]\d{3})+(?!\d)/g,m=>m.replace(/[,،]/g,''));   // 1,000,000
  s=s.replace(/[؟?:]/g,' ');
  s=s.replace(/فاکتوریل\s*(\d+)/g,'$1!').replace(/(\d+)\s*فاکتوریل/g,'$1!');
  if(!s.includes('='))s=s.replace(/(?<=\d)\s*[xX]\s*(?=\d)/g,'*');
  return s;
}

// ---- tokenizer / parser ----
function tokenize(c){
  const re=/\d+(?:\.\d+)?|\.\d+|sqrt|abs|ln|log|pi|x|[-+*\/^()!%]/y;
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
  function term(){let l=unary();while(peek()==='*'||peek()==='/'){const o=next();l={t:'bin',o,l,r:unary()}}return l}
  function unary(){
    if(peek()==='-'){next();return {t:'neg',v:unary()}}
    if(peek()==='+'){next();return unary()}
    return pow();
  }
  function pow(){const b=post();if(peek()==='^'){next();return {t:'bin',o:'^',l:b,r:unary()}}return b}
  function post(){let v=prim();while(peek()==='!'||peek()==='%'){v={t:next()==='!'?'fact':'pct',v}}return v}
  function prim(){
    const t=next();
    if(t===undefined)throw new Error('eof');
    if(/^[\d.]/.test(t))return {t:'num',v:t};
    if(t==='pi')return {t:'pi'};
    if(t==='x')return {t:'var'};
    if(t==='('){const e=expr();if(next()!==')')throw new Error('paren');return e}
    if(t==='sqrt'||t==='abs'||t==='ln'||t==='log')return {t:'fn',f:t,v:post()};
    throw new Error('bad token '+t);
  }
  const tree=expr();
  if(i!==tokens.length)throw new Error('leftover');
  return tree;
}
const hasVar=n=>n&&(n.t==='var'||(n.l&&hasVar(n.l))||(n.r&&hasVar(n.r))||(n.v&&typeof n.v==='object'&&hasVar(n.v)));
const isBare=n=>n.t==='num'||n.t==='pi';

// ---- evaluators ----
function evalN(n,x){
  switch(n.t){
    case 'num':return parseFloat(n.v);
    case 'pi':return Math.PI;
    case 'var':return x;
    case 'neg':return -evalN(n.v,x);
    case 'pct':return evalN(n.v,x)/100;
    case 'fact':{const v=evalN(n.v,x);if(!Number.isInteger(v)||v<0)throw new MathMsg('فاکتوریل فقط برای عدد صحیح نامنفی تعریف می‌شود.');if(v>170)throw new MathMsg('این فاکتوریل از محدوده محاسبه بیرون است.');let r=1;for(let k=2;k<=v;k++)r*=k;return r}
    case 'fn':{
      const v=evalN(n.v,x);
      if(n.f==='sqrt'){if(v<0)throw new MathMsg('جذر عدد منفی در اعداد حقیقی تعریف نشده است.');return Math.sqrt(v)}
      if(n.f==='abs')return Math.abs(v);
      if(v<=0)throw new MathMsg('لگاریتم فقط برای عدد مثبت تعریف می‌شود.');
      return n.f==='ln'?Math.log(v):Math.log10(v);
    }
    case 'bin':{
      const a=evalN(n.l,x),b=evalN(n.r,x);
      switch(n.o){
        case '+':return a+b;case '-':return a-b;case '*':return a*b;
        case '/':if(b===0)throw new MathMsg('تقسیم بر صفر تعریف نشده است.');return a/b;
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

// ---- formatting ----
function fmtNum(v){
  if(Number.isInteger(v)&&Math.abs(v)<1e21)return String(v);
  let s=String(parseFloat(v.toPrecision(12)));
  return s;
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
const pretty=c=>c.replace(/\*/g,' × ').replace(/\//g,' ÷ ').replace(/\+/g,' + ').replace(/(?<=[\d)!%a-z])-/g,' - ').replace(/\^/g,'^').replace(/sqrt/g,'√').replace(/pi/g,'π').replace(/\s+/g,' ').trim();

// ---- main entry ----
function compact(s,eq){
  let c=s.replace(/\s+/g,'').toLowerCase();
  c=c.replace(/(\d|\))(?=\(|x|pi|sqrt|abs|ln|log)/g,'$1*').replace(/(x|pi)(?=\d|\(|x|pi|sqrt)/g,'$1*').replace(/\)(?=\d)/g,')*');
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
  for(const [re,rep] of REPL){ if(rep!==null) s=s.replace(re,` ${rep} `); }
  s=s.replace(FILLERS,' ');
  return s;
}

function solve(raw){
  const input=String(raw||'');
  if(!input.trim()||input.length>300)return null;
  const latinIn=toLatin(input);
  if(/\b\d{2,4}[-\/.]\d{1,2}[-\/.]\d{1,2}\b/.test(latinIn))return null;      // dates
  const faOut=/[۰-۹]/.test(input);
  const out=t=>faOut?toFa(t):t;
  try{
    let s=cleanText(input);

    // "20 درصد 500" / "20% of 500"
    const pm=s.match(/^\s*(\d+(?:\.\d+)?)\s*(?:درصد|%|percent)\s*(?:از|of)?\s*(\d+(?:\.\d+)?)\s*$/i);
    if(pm){
      const r=parseFloat(pm[1])/100*parseFloat(pm[2]);
      return out(`${pm[1]}٪ از ${pm[2]} = ${fmtNum(parseFloat(r.toPrecision(12)))}`);
    }

    const eqCount=(s.match(/=/g)||[]).length;
    if(eqCount===1&&/x/i.test(s)&&/[^=\s]/.test(s.split('=')[0])&&/[^=\s]/.test(s.split('=')[1])){
      // linear equation in x
      const [ls,rs]=s.split('=');
      const A=build(ls),B=build(rs);
      if(!A||!B)return null;
      const f=x=>evalN(A.tree,x)-evalN(B.tree,x);
      const f0=f(0),f1=f(1),f2=f(2);
      if(![f0,f1,f2].every(Number.isFinite))return null;
      const f3=f(3), tol=1e-9*(1+Math.abs(f0)+Math.abs(f1)+Math.abs(f2)+Math.abs(f3));
      const showNum=v=>{const d=Number.isInteger(parseFloat(v.toPrecision(12)))?fmtNum(parseFloat(v.toPrecision(12))):fmtNum(parseFloat(v.toFixed(6)));const fr=Number.isInteger(parseFloat(v.toPrecision(12)))?null:fraction(v);return fr?`${fr} ≈ ${d}`:d};
      if(Math.abs(f2-2*f1+f0)<=tol){
        const a=f1-f0;
        if(Math.abs(a)<1e-12)return Math.abs(f0)<1e-9?'این معادله بی‌شمار جواب دارد (به ازای هر x برقرار است).':'این معادله جواب ندارد.';
        return out(`x = ${showNum(-f0/a)}`);
      }
      // quadratic: a x^2 + b x + c = 0
      const qa=(f2-2*f1+f0)/2, qb=f1-f0-qa, qc=f0;
      if(Math.abs(9*qa+3*qb+qc-f3)>tol||Math.abs(qa)<1e-12)return null;
      const D=qb*qb-4*qa*qc;
      if(D<-1e-12)return 'این معادله ریشه حقیقی ندارد (دلتا منفی است).';
      const form=`Δ = ${fmtNum(parseFloat(D.toPrecision(12)))}`;
      if(Math.abs(D)<1e-12)return out(`${form}\nx = ${showNum(-qb/(2*qa))}  (ریشه مضاعف)`);
      const r1=(-qb+Math.sqrt(D))/(2*qa), r2=(-qb-Math.sqrt(D))/(2*qa);
      return out(`${form}\nx₁ = ${showNum(r1)}\nx₂ = ${showNum(r2)}`);
    }
    s=s.replace(/=/g,' ');
    if(/x/i.test(s))return null;

    const b=build(s);
    if(!b)return null;
    if(isBare(b.tree))return null;                      // just a number
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

// ---- turn LaTeX in model answers into readable plain text ----
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
  s=s.replace(/\\([A-Za-z]+)/g,(m,n)=>SYM[n]!==undefined?SYM[n]:m);
  s=s.replace(/\^\{?(-?\d{1,3})\}?(?!\d)/g,(m,d)=>[...d].map(c=>SUP[c]||c).join(''));
  if(s!==before&&/\\/.test(before)) s=s.replace(/\{([^{}\n]*)\}/g,'$1');
  return s;
}
function plainMath(text){
  return String(text||'').split(/(```[\s\S]*?```)/g).map((seg,i)=>i%2?seg:convSeg(seg)).join('');
}

// does the message look like a math problem for the AI (not trivially computable)?
const MATH_HINT=/معادله|مشتق|انتگرال|حد\s|لگاریتم|مثلثات|احتمال|ماتریس|دترمینان|هندسه|مساحت|حجم|محیط|ریاضی|سینوس|کسینوس|تانژانت|اتحاد|تجزیه|ساده\s*کن|حل\s*کن|اثبات|دنباله|سری|\bsolve\b|equation|derivative|integral|limit|probability|matrix|simplify|factor|prove|area|volume|\d\s*[-+*\/^=]\s*[\dx(]/i;
const looksMath=t=>MATH_HINT.test(toLatin(String(t||'')));

module.exports={solve,plainMath,looksMath};
