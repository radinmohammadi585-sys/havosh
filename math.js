'use strict';
// Kavosh Advanced Math Engine v4.1
// Persian/English arithmetic, algebra, calculus, trig, matrices, statistics.
// No eval(). Symbolic math. Returns null when unsure -> falls through to AI.

const PD='\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9';
const AD='\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669';
const toLatin=s=>String(s).replace(/[\u06F0-\u06F9]/g,c=>PD.indexOf(c)).replace(/[\u0660-\u0669]/g,c=>AD.indexOf(c));
const toFa=s=>String(s).replace(/[0-9]/g,d=>PD[d]);

class MathMsg extends Error{}
class NotBig extends Error{}

const L='A-Za-z\\u0600-\\u06FF';
const word=(alts,flags='gi')=>new RegExp('(?<![' + L + '])(?:' + alts + ')(?![' + L + '])',flags);

const FILLERS=word('\u062D\u0627\u0635\u0644|\u062C\u0648\u0627\u0628|\u067E\u0627\u0633\u062E|\u0686\u0646\u062F|\u0686\u0642\u062F\u0631|\u0645\u06CC\u200c\u0634\u0648\u062F|\u0645\u06CC\u0634\u0648\u062F|\u0627\u0633\u062A|\u0647\u0633\u062A|\u0628\u0631\u0627\u0628\u0631|\u0645\u0633\u0627\u0648\u06CC|\u0645\u062D\u0627\u0633\u0628\u0647|\u062D\u0633\u0627\u0628\\s*\u06A9\u0646|\u0628\u06AF\u0648|\u0628\u062F\u0647|\u0644\u0637\u0641\u0627|what\\s+is|what\'s|calculate|compute|equals?|how\\s+much\\s+is|result\\s+of|the|is');
const REPL=[
  [word('\u062A\u0642\u0633\u06CC\u0645\\s*\u0628\u0631|\u062A\u0642\u0633\u06CC\u0645|divided\\s+by'),'/'],
  [word('\u0636\u0631\u0628\\s*\u062F\u0631|\u0636\u0631\u0628\u062F\u0631|\u0636\u0631\u0628|times|multiplied\\s+by'),'*'],
  [word('\u0628\u0647\\s*\u0639\u0644\u0627\u0648\u0647|\u0628\u0639\u0644\u0627\u0648\u0647|\u062C\u0645\u0639|\u067E\u0644\u0627\u0633|plus'),'+'],
  [word('\u0645\u0646\u0647\u0627\u06CC|\u0645\u0646\u0647\u0627|\u062A\u0641\u0631\u06CC\u0642|minus'),'-'],
  [word('\u0628\u0647\\s*\u062A\u0648\u0627\u0646|\u062A\u0648\u0627\u0646|to\\s+the\\s+power\\s+of|power'),'^'],
  [word('\u062C\u0630\u0631|\u0631\u06CC\u0634\u0647\\s*\u062F\u0648\u0645|\u0631\u06CC\u0634\u0647|square\\s+root\\s+of|sqrt'),'sqrt'],
];

const BS=String.fromCharCode(92);   // backslash

// ---------------- helpers ----------------
function gcd(a,b){a=Math.abs(a);b=Math.abs(b);while(b){const t=b;b=a%b;a=t}return a}
function lcm(a,b){return Math.abs(a*b)/gcd(a,b)}
function factorial(n){
  if(!Number.isInteger(n)||n<0)throw new MathMsg('\u0641\u0627\u06A9\u062A\u0648\u0631\u06CC\u0644 \u0641\u0642\u0637 \u0628\u0631\u0627\u06CC \u0639\u062F\u062F \u0635\u062D\u06CC\u062D \u0645\u0646\u0641\u06CC \u062A\u0639\u0631\u06CC\u0641 \u0645\u06CC\u200c\u0634\u0648\u062F.');
  if(n>170)throw new MathMsg('\u0627\u06CC\u0646 \u0641\u0627\u06A9\u062A\u0648\u0631\u06CC\u0644 \u0627\u0632 \u0645\u062D\u062F\u0648\u062F\u0647 \u0645\u062D\u0627\u0633\u0628\u0647 \u0628\u06CC\u0631\u0648\u0646 \u0627\u0633\u062A.');
  let r=1;for(let k=2;k<=n;k++)r*=k;return r;
}

// ---------------- normalize ----------------
function normalize(raw){
  let s=toLatin(raw).replace(/\u200c/g,' ').replace(/\u066B/g,'.').replace(/\u066C/g,',');
  s=s.replace(/[\u00D7\u00B7\u22C5\u2715]/g,'*').replace(/\u00F7/g,'/').replace(/[\u2212\u2013\u2014]/g,'-')
       .replace(/\u221A/g,' sqrt ').replace(/\*\*/g,'^').replace(/\u03C0/g,' pi ');
  s=s.replace(/\d{1,3}(?:[,\u060C]\d{3})+(?!\d)/g,m=>m.replace(/[,\u060C]/g,''));
  s=s.replace(/[\u061F?:]/g,' ');
  s=s.replace(/\u0641\u0627\u06A9\u062A\u0648\u0631\u06CC\u0644\s*(\d+)/g,'$1!').replace(/(\d+)\s*\u0641\u0627\u06A9\u062A\u0648\u0631\u06CC\u0644/g,'$1!');
  if(s.indexOf('=')===-1)s=s.replace(/(?<=\d)\s*[xX]\s*(?=\d)/g,'*');
  return s;
}

// =================================================================
// 1) advanced pattern detectors
// =================================================================
function tryDerivative(text){
  const m=text.match(/(?:\u0645\u0634\u062A\u0642|derivative(?:\s+of)?)\s*[:\-]?\s*(.+?)\s*$/i);
  if(!m)return null;
  const terms=parsePolynomial(m[1]);
  if(!terms)return null;
  const d=derivativePoly(terms);
  return '\u0645\u0634\u062A\u0642: '+polyToString(d);
}
function tryIntegral(text){
  const m=text.match(/(?:\u0627\u0646\u062A\u06AF\u0631\u0627\u0644|integral(?:\s+of)?)\s*[:\-]?\s*(.+?)\s*(?:dx)?\s*$/i);
  if(!m)return null;
  const terms=parsePolynomial(m[1]);
  if(!terms)return null;
  const a=integralPoly(terms);
  return '\u0627\u0646\u062A\u06AF\u0631\u0627\u0644: '+polyToString(a)+' + C';
}
function tryLimit(text){
  const m=text.match(/(?:\u062D\u062F|limit)\s*(?:of)?\s*[:\-]?\s*(.+?)\s*(?:\u0648\u0642\u062A\u06CC|\u0647\u0646\u06AF\u0627\u0645\u06CC|\u06A9\u0647|as|when)\s*x\s*(?:\u2192|->|\u0628\u0647\s*\u0633\u0645\u062A|approach(?:es)?|\u0645\u06CC\u0644\s*\u06A9\u0646\u062F\s*\u0628\u0647)\s*(-?\d+(?:\.\d+)?)/i);
  if(!m)return null;
  const target=parseFloat(m[2]);
  const b=build(m[1]);
  if(!b||!hasVar(b.tree))return null;
  try{
    const eps=1e-6;
    const f=x=>evalN(b.tree,x);
    const Lv=f(target-eps), Rv=f(target+eps), Mv=f(target);
    let val;
    if(Number.isFinite(Mv))val=Mv;
    else if(Number.isFinite(Lv)&&Number.isFinite(Rv)&&Math.abs(Lv-Rv)<1e-3)val=(Lv+Rv)/2;
    else return null;
    return '\u062D\u062F: '+fmtNum(parseFloat(val.toPrecision(10)));
  }catch{return null}
}
function tryStats(text){
  const m=text.match(/(\u0645\u06CC\u0627\u0646\u06AF\u06CC\u0646|\u0645\u06CC\u0627\u0646\u0647|\u0645\u062C\u0645\u0648\u0639|\u062C\u0645\u0639|\u062D\u0627\u0635\u0644\s*\u0636\u0631\u0628|average|mean|median|sum|product)\s*(?:\u0627\u0639\u062F\u0627\u062F|\u0645\u062C\u0645\u0648\u0639\u0647|\u0644\u06CC\u0633\u062A)?\s*[:\-]?\s*([\d\s,\u060C.+\-]+)/i);
  if(!m)return null;
  const nums=(m[2].match(/-?\d+(?:\.\d+)?/g)||[]).map(Number).filter(Number.isFinite);
  if(nums.length<2)return null;
  const op=m[1].toLowerCase();
  const sum=nums.reduce((a,b)=>a+b,0);
  const prod=nums.reduce((a,b)=>a*b,1);
  const mean=sum/nums.length;
  const sorted=[...nums].sort((a,b)=>a-b);
  const median=sorted.length%2?sorted[(sorted.length-1)/2]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2;
  if(/\u0645\u06CC\u0627\u0646\u06AF\u06CC\u0646|average|mean/.test(op))return '\u0645\u06CC\u0627\u0646\u06AF\u06CC\u0646: '+fmtNum(parseFloat(mean.toPrecision(10)));
  if(/\u0645\u06CC\u0627\u0646\u0647|median/.test(op))return '\u0645\u06CC\u0627\u0646\u0647: '+fmtNum(parseFloat(median.toPrecision(10)));
  if(/\u0645\u062C\u0645\u0648\u0639|\u062C\u0645\u0639|sum/.test(op))return '\u0645\u062C\u0645\u0648\u0639: '+fmtNum(parseFloat(sum.toPrecision(10)));
  if(/\u0636\u0631\u0628|product/.test(op))return '\u062D\u0627\u0635\u0644\u200c\u0636\u0631\u0628: '+fmtNum(parseFloat(prod.toPrecision(10)));
  return null;
}
function tryGCDLCM(text){
  const m=text.match(/(\u0628\.?\s?\u0645\.?\s?\u0645|\u06A9\.?\s?\u0645\.?\s?\u0645|gcd|gcf|lcm)\s*[:\-(\s]*\s*(-?\d+)\s*(?:\u0648|,|and|\s)\s*(-?\d+)/i);
  if(!m)return null;
  const a=parseInt(m[2]),b=parseInt(m[3]);
  const op=m[1].toLowerCase().replace(/\s/g,'');
  if(/^\u0628|gcd|gcf/.test(op))return '\u0628.\u0645.\u0645('+a+'\u060C'+b+') = '+gcd(a,b);
  return '\u06A9.\u0645.\u0645('+a+'\u060C'+b+') = '+lcm(a,b);
}
function tryBase(text){
  const m=text.match(/(-?[0-9a-fA-F]+)\s*(?:\u0627\u0632\s*\u0645\u0628\u0646\u0627\u06CC\s*(\d+)\s*)?(?:\u0628\u0647|\u062F\u0631|to)\s*\u0645\u0628\u0646\u0627\u06CC?\s*(\d+)/i);
  if(!m)return null;
  const num=m[1], from=parseInt(m[2]||10), to=parseInt(m[3]);
  if(from<2||from>36||to<2||to>36)return null;
  const dec=parseInt(num,from);
  if(!Number.isFinite(dec))return null;
  return num+' (\u0645\u0628\u0646\u0627\u06CC '+from+') = '+dec.toString(to).toUpperCase()+' (\u0645\u0628\u0646\u0627\u06CC '+to+')';
}
function trySequence(text){
  const ap=text.match(/(?:\u062F\u0646\u0628\u0627\u0644\u0647\s*\u062D\u0633\u0627\u0628\u06CC|arithmetic)[^\d\-]*a1\s*=\s*(-?\d+(?:\.\d+)?)\s*,?\s*d\s*=\s*(-?\d+(?:\.\d+)?)\s*,?\s*n\s*=\s*(\d+)/i);
  if(ap){
    const A=parseFloat(ap[1]),D=parseFloat(ap[2]),N=parseInt(ap[3]);
    const an=A+(N-1)*D, sn=N*(2*A+(N-1)*D)/2;
    return '\u062C\u0645\u0644\u0647 '+N+'\u0627\u064F\u0645: '+fmtNum(an)+'\n\u0645\u062C\u0645\u0648\u0639 '+N+' \u062C\u0645\u0644\u0647: '+fmtNum(sn);
  }
  const gp=text.match(/(?:\u062F\u0646\u0628\u0627\u0644\u0647\s*\u0647\u0646\u062F\u0633\u06CC|geometric)[^\d\-]*a1\s*=\s*(-?\d+(?:\.\d+)?)\s*,?\s*r\s*=\s*(-?\d+(?:\.\d+)?)\s*,?\s*n\s*=\s*(\d+)/i);
  if(gp){
    const A=parseFloat(gp[1]),R=parseFloat(gp[2]),N=parseInt(gp[3]);
    const an=A*Math.pow(R,N-1);
    const sn=Math.abs(R-1)<1e-12?A*N:A*(Math.pow(R,N)-1)/(R-1);
    return '\u062C\u0645\u0644\u0647 '+N+'\u0627\u064F\u0645: '+fmtNum(parseFloat(an.toPrecision(10)))+'\n\u0645\u062C\u0645\u0648\u0639 '+N+' \u062C\u0645\u0644\u0647: '+fmtNum(parseFloat(sn.toPrecision(10)));
  }
  return null;
}
function tryDet(text){
  const m=text.match(/(?:\u062F\u062A\u0631\u0645\u06CC\u0646\u0627\u0646|determinant)\s*[:\-]?\s*\[([^\]]+)\]/i);
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
  return '\u062F\u062A\u0631\u0645\u06CC\u0646\u0627\u0646: '+fmtNum(parseFloat(det.toPrecision(10)));
}
function tryLinearSystem(text){
  if(!/[\u0648and,;]/.test(text))return null;
  const eqs=text.split(/\s*(?:\u0648|and|,|;)\s*/).filter(s=>s.indexOf('=')>=0);
  if(eqs.length!==2)return null;
  if(!eqs.every(e=>/x/i.test(e)&&/y/i.test(e)))return null;
  function parseEq(eq){
    const parts=eq.split('=');
    const body='('+parts[0]+')-('+parts[1]+')';
    let a=0,b=0,c=0;
    const cleaned=body.replace(/\s+/g,'').replace(/-/g,'+-');
    const re=/([+-]?\d*\.?\d*)\*?([xy])|([+-]?\d+\.?\d*)/gi;
    let mm;
    while((mm=re.exec(cleaned))){
      if(mm[2]){
        const coef=mm[1];
        const v=coef===''||coef==='+'?1:coef==='-'?-1:parseFloat(coef);
        if(mm[2].toLowerCase()==='x')a+=v;else b+=v;
      }else if(mm[3]!==undefined){
        const v=parseFloat(mm[3].replace(/\s/g,''));
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
  return 'x = '+fmtNum(parseFloat((Dx/D).toPrecision(10)))+'\ny = '+fmtNum(parseFloat((Dy/D).toPrecision(10)));
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
    if(['sqrt','cbrt','abs','ln','log','log2','exp','sin','cos','tan','cot','sec','csc','asin','acos','atan','sinh','cosh','tanh'].indexOf(t)>=0)
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
        case 'sqrt':if(v<0)throw new MathMsg('\u062C\u0630\u0631 \u0639\u062F\u062F \u0645\u0646\u0641\u06CC \u062F\u0631 \u0627\u0639\u062F\u0627\u062F \u062D\u0642\u06CC\u0642\u06CC \u062A\u0639\u0631\u06CC\u0641 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A.');return Math.sqrt(v);
        case 'cbrt':return Math.cbrt(v);
        case 'abs':return Math.abs(v);
        case 'exp':return Math.exp(v);
        case 'ln':if(v<=0)throw new MathMsg('\u0644\u06AF\u0627\u0631\u06CC\u062A\u0645 \u0641\u0642\u0637 \u0628\u0631\u0627\u06CC \u0639\u062F\u062F \u0645\u062B\u0628\u062A \u062A\u0639\u0631\u06CC\u0641 \u0645\u06CC\u200c\u0634\u0648\u062F.');return Math.log(v);
        case 'log':if(v<=0)throw new MathMsg('\u0644\u06AF\u0627\u0631\u06CC\u062A\u0645 \u0641\u0642\u0637 \u0628\u0631\u0627\u06CC \u0639\u062F\u062F \u0645\u062B\u0628\u062A \u062A\u0639\u0631\u06CC\u0641 \u0645\u06CC\u200c\u0634\u0648\u062F.');return Math.log10(v);
        case 'log2':if(v<=0)throw new MathMsg('\u0644\u06AF\u0627\u0631\u06CC\u062A\u0645 \u0641\u0642\u0637 \u0628\u0631\u0627\u06CC \u0639\u062F\u062F \u0645\u062B\u0628\u062A \u062A\u0639\u0631\u06CC\u0641 \u0645\u06CC\u200c\u0634\u0648\u062F.');return Math.log2(v);
        case 'sin':return Math.sin(v);
        case 'cos':return Math.cos(v);
        case 'tan':return Math.tan(v);
        case 'cot':return 1/Math.tan(v);
        case 'sec':return 1/Math.cos(v);
        case 'csc':return 1/Math.sin(v);
        case 'asin':if(v<-1||v>1)throw new MathMsg('\u0622\u0631\u06A9\u200c\u0633\u06CC\u0646\u0648\u0633 \u0641\u0642\u0637 \u0628\u0631\u0627\u06CC [-1,1] \u062A\u0639\u0631\u06CC\u0641 \u0645\u06CC\u200c\u0634\u0648\u062F.');return Math.asin(v);
        case 'acos':if(v<-1||v>1)throw new MathMsg('\u0622\u0631\u06A9\u200c\u06A9\u0633\u06CC\u0646\u0648\u0633 \u0641\u0642\u0637 \u0628\u0631\u0627\u06CC [-1,1] \u062A\u0639\u0631\u06CC\u0641 \u0645\u06CC\u200c\u0634\u0648\u062F.');return Math.acos(v);
        case 'atan':return Math.atan(v);
        case 'sinh':return Math.sinh(v);
        case 'cosh':return Math.cosh(v);
        case 'tanh':return Math.tanh(v);
      }
      throw new Error('fn');
    }
    case 'bin':{
      const a=evalN(n.l,x),b=evalN(n.r,x);
      switch(n.o){
        case '+':return a+b;case '-':return a-b;case '*':return a*b;
        case '/':if(b===0)throw new MathMsg('\u062A\u0642\u0633\u06CC\u0645 \u0628\u0631 \u0635\u0641\u0631 \u062A\u0639\u0631\u06CC\u0641 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A.');return a/b;
        case '%':if(b===0)throw new MathMsg('\u0628\u0627\u0642\u06CC\u0645\u0627\u0646\u062F\u0647 \u0628\u0631 \u0635\u0641\u0631 \u062A\u0639\u0631\u06CC\u0641 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A.');return a%b;
        case '^':{const r=Math.pow(a,b);if(Number.isNaN(r))throw new MathMsg('\u0627\u06CC\u0646 \u062A\u0648\u0627\u0646 \u062F\u0631 \u0627\u0639\u062F\u0627\u062F \u062D\u0642\u06CC\u0642\u06CC \u062A\u0639\u0631\u06CC\u0641 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A.');return r}
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
        case '/':if(b===0n)throw new MathMsg('\u062A\u0642\u0633\u06CC\u0645 \u0628\u0631 \u0635\u0641\u0631 \u062A\u0639\u0631\u06CC\u0641 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A.');if(a%b!==0n)throw new NotBig();return a/b;
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
  return (neg?'-':'')+d[0]+'.'+d.slice(1,10)+'\u00D710^'+(d.length-1)+'  (\u0639\u062F\u062F\u06CC \u0628\u0627 '+d.length+' \u0631\u0642\u0645)';
}
function fraction(v){
  for(let q=2;q<=1000;q++){const p=Math.round(v*q);if(Math.abs(v-p/q)<1e-9*Math.max(1,Math.abs(v)))return p+'/'+q}
  return null;
}
const pretty=c=>c.replace(/\*/g,' \u00D7 ').replace(/\//g,' \u00F7 ').replace(/\+/g,' + ')
  .replace(/(?<=[\d)!%a-z])-/g,' - ')
  .replace(/\^/g,'^').replace(/sqrt/g,'\u221A').replace(/cbrt/g,'\u221B')
  .replace(/pi/g,'\u03C0').replace(/\s+/g,' ').trim();

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
  for(const pair of REPL) s=s.replace(pair[0],' '+pair[1]+' ');
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
  const faOut=/[\u06F0-\u06F9]/.test(input);
  const out=t=>faOut?toFa(t):t;

  try{
    let s=normalize(input);

    const advanced=[tryDerivative,tryIntegral,tryLimit,tryStats,tryGCDLCM,tryBase,trySequence,tryDet,tryLinearSystem];
    for(const fn of advanced){
      try{
        const r=fn(s);
        if(r)return out(r);
      }catch{}
    }

    const pm=s.match(/^\s*(\d+(?:\.\d+)?)\s*(?:\u062F\u0631\u0635\u062F|%|percent)\s*(?:\u0627\u0632|of)?\s*(\d+(?:\.\d+)?)\s*$/i);
    if(pm){
      const r=parseFloat(pm[1])/100*parseFloat(pm[2]);
      return out(pm[1]+'\u066A \u0627\u0632 '+pm[2]+' = '+fmtNum(parseFloat(r.toPrecision(12))));
    }

    const eqCount=(s.match(/=/g)||[]).length;
    if(eqCount===1&&/x/i.test(s)&&/[^=\s]/.test(s.split('=')[0])&&/[^=\s]/.test(s.split('=')[1])){
      const parts=s.split('=');
      const A=build(parts[0]),B=build(parts[1]);
      if(!A||!B)return null;
      const f=x=>evalN(A.tree,x)-evalN(B.tree,x);
      const f0=f(0),f1=f(1),f2=f(2),f3=f(3);
      if(![f0,f1,f2,f3].every(Number.isFinite))return null;
      const tol=1e-9*(1+Math.abs(f0)+Math.abs(f1)+Math.abs(f2)+Math.abs(f3));
      const showNum=v=>{
        const iv=parseFloat(v.toPrecision(12));
        const d=Number.isInteger(iv)?fmtNum(iv):fmtNum(parseFloat(v.toFixed(6)));
        const fr=Number.isInteger(iv)?null:fraction(v);
        return fr?fr+' \u2248 '+d:d;
      };
      if(Math.abs(f2-2*f1+f0)<=tol){
        const a=f1-f0;
        if(Math.abs(a)<1e-12)return Math.abs(f0)<1e-9?'\u0627\u06CC\u0646 \u0645\u0639\u0627\u062F\u0644\u0647 \u0628\u06CC\u200c\u0634\u0645\u0627\u0631 \u062C\u0648\u0627\u0628 \u062F\u0627\u0631\u062F.':'\u0627\u06CC\u0646 \u0645\u0639\u0627\u062F\u0644\u0647 \u062C\u0648\u0627\u0628 \u0646\u062F\u0627\u0631\u062F.';
        return out('x = '+showNum(-f0/a));
      }
      const qa=(f2-2*f1+f0)/2, qb=f1-f0-qa, qc=f0;
      if(Math.abs(9*qa+3*qb+qc-f3)>tol||Math.abs(qa)<1e-12)return null;
      const D=qb*qb-4*qa*qc;
      if(D<-1e-12)return '\u0627\u06CC\u0646 \u0645\u0639\u0627\u062F\u0644\u0647 \u0631\u06CC\u0634\u0647 \u062D\u0642\u06CC\u0642\u06CC \u0646\u062F\u0627\u0631\u062F (\u062F\u0644\u062A\u0627 \u0645\u0646\u0641\u06CC \u0627\u0633\u062A).';
      const form='\u0394 = '+fmtNum(parseFloat(D.toPrecision(12)));
      if(Math.abs(D)<1e-12)return out(form+'\nx = '+showNum(-qb/(2*qa))+'  (\u0631\u06CC\u0634\u0647 \u0645\u0636\u0627\u0639\u0641)');
      const r1=(-qb+Math.sqrt(D))/(2*qa), r2=(-qb-Math.sqrt(D))/(2*qa);
      return out(form+'\nx\u2081 = '+showNum(r1)+'\nx\u2082 = '+showNum(r2));
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
    return out(pretty(b.c)+' = '+text);
  }catch(e){
    if(e instanceof MathMsg)return e.message;
    return null;
  }
}

// =================================================================
// 8) LaTeX -> plain text (for AI answers) - SAFE, no raw backslash in regex
// =================================================================
const SUP={};
SUP['0']='\u2070';SUP['1']='\u00b9';SUP['2']='\u00b2';SUP['3']='\u00b3';SUP['4']='\u2074';
SUP['5']='\u2075';SUP['6']='\u2076';SUP['7']='\u2077';SUP['8']='\u2078';SUP['9']='\u2079';
SUP['-']='\u207b';SUP['+']='\u207a';

const SYM={
  times:'\u00d7',cdot:'\u00b7',div:'\u00f7',pm:'\u00b1',mp:'\u2213',
  le:'\u2264',leq:'\u2264',ge:'\u2265',geq:'\u2265',ne:'\u2260',neq:'\u2260',approx:'\u2248',
  infty:'\u221e',pi:'\u03c0',theta:'\u03b8',alpha:'\u03b1',beta:'\u03b2',gamma:'\u03b3',
  delta:'\u03b4',lambda:'\u03bb',mu:'\u03bc',sigma:'\u03c3',omega:'\u03c9',
  Delta:'\u0394',Sigma:'\u03a3',sum:'\u03a3',int:'\u222b',
  Rightarrow:'\u21d2',rightarrow:'\u2192',to:'\u2192',leftrightarrow:'\u2194',
  ldots:'\u2026',cdots:'\u2026',degree:'\u00b0',circ:'\u00b0',
  in:'\u2208',cup:'\u222a',cap:'\u2229',
  sin:'sin',cos:'cos',tan:'tan',log:'log',ln:'ln',lim:'lim'
};

function convSeg(s){
  const before=s;

  // $$...$$
  s=s.replace(/\$\$([\s\S]+?)\$\$/g,function(m,a){return a.indexOf(BS)>=0?a:m;});
  // \[...\]
  s=s.replace(new RegExp(BS+BS+'\\[([\\s\\S]+?)'+BS+BS+'\\]','g'),'$1');
  // \(...\)
  s=s.replace(new RegExp(BS+BS+'\\(([\\s\\S]+?)'+BS+BS+'\\)','g'),'$1');
  // $...$
  s=s.replace(/\$([^$\n]+?)\$/g,function(m,a){return a.indexOf(BS)>=0?a:m;});

  for(let k=0;k<3;k++){
    // \frac{a}{b} or \dfrac / \tfrac
    s=s.replace(new RegExp(BS+BS+'[dt]?frac\\s*\\{([^{}]*)\\}\\s*\\{([^{}]*)\\}','g'),'($1)/($2)');
    // \sqrt[n]{x}
    s=s.replace(new RegExp(BS+BS+'sqrt\\s*\\[([^\\]]*)\\]\\s*\\{([^{}]*)\\}','g'),'\u0631\u06cc\u0634\u0647 $1\u0627\u0645($2)');
    // \sqrt{x}
    s=s.replace(new RegExp(BS+BS+'sqrt\\s*\\{([^{}]*)\\}','g'),'\u221a($1)');
    // \text{...}
    s=s.replace(new RegExp(BS+BS+'text(?:bf|it|rm)?\\s*\\{([^{}]*)\\}','g'),'$1');
    // \mathbf{...} etc
    s=s.replace(new RegExp(BS+BS+'(?:mathbf|mathrm|boxed|overline|bar)\\s*\\{([^{}]*)\\}','g'),'$1');
  }

  // \left \right \big \Big \quad \qquad
  s=s.replace(new RegExp(BS+BS+'(?:left|right|big|Big|quad|qquad)\\b','g'),'');
  // \, \; \!
  s=s.replace(new RegExp(BS+BS+'[,;!]','g'),' ');
  // \<space>
  s=s.replace(new RegExp(BS+BS+' ','g'),' ');

  // named symbols
  s=s.replace(new RegExp(BS+BS+'([A-Za-z]+)','g'),function(m,n){return SYM[n]!==undefined?SYM[n]:m;});

  // ^2 -> superscript
  s=s.replace(/\^\{?(-?\d{1,3})\}?(?!\d)/g,function(m,d){
    let r='';
    for(let i=0;i<d.length;i++) r+= (SUP[d[i]]||d[i]);
    return r;
  });

  if(s!==before&&before.indexOf(BS)>=0){
    s=s.replace(/\{([^{}\n]*)\}/g,'$1');
  }
  return s;
}
function plainMath(text){
  return String(text||'').split(/(```[\s\S]*?```)/g).map(function(seg,i){return i%2?seg:convSeg(seg)}).join('');
}

// does the message look like a math problem for the AI?
const MATH_HINT=/\u0645\u0639\u0627\u062F\u0644\u0647|\u0645\u0634\u062A\u0642|\u0627\u0646\u062A\u06AF\u0631\u0627\u0644|\u062D\u062F\s|\u0644\u06AF\u0627\u0631\u06CC\u062A\u0645|\u0645\u062B\u0644\u062B\u0627\u062A|\u0627\u062D\u062A\u0645\u0627\u0644|\u0645\u0627\u062A\u0631\u06CC\u0633|\u062F\u062A\u0631\u0645\u06CC\u0646\u0627\u0646|\u0647\u0646\u062F\u0633\u0647|\u0645\u0633\u0627\u062D\u062A|\u062D\u062C\u0645|\u0645\u062D\u06CC\u0637|\u0631\u06CC\u0627\u0636\u06CC|\u0633\u06CC\u0646\u0648\u0633|\u06A9\u0633\u06CC\u0646\u0648\u0633|\u062A\u0627\u0646\u0698\u0627\u0646\u062A|\u0627\u062A\u062D\u0627\u062F|\u062A\u062C\u0632\u06CC\u0647|\u0633\u0627\u062F\u0647\s*\u06A9\u0646|\u062D\u0644\s*\u06A9\u0646|\u0627\u062B\u0628\u0627\u062A|\u062F\u0646\u0628\u0627\u0644\u0647|\u0633\u0631\u06CC|\u062F\u0633\u062A\u06AF\u0627\u0647|\u0645\u062C\u0647\u0648\u0644|\bsolve\b|equation|derivative|integral|limit|probability|matrix|simplify|factor|prove|area|volume|\d\s*[-+*\/^=]\s*[\dx(]/i;
const looksMath=t=>MATH_HINT.test(toLatin(String(t||'')));

module.exports={solve,plainMath,looksMath};