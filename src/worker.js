// 好朋友地圖 Cloudflare Worker
// - 網頁：public/ 底下的檔案由 Cloudflare 直接提供
// - /api/reports      GET 最近 7 天回報；POST 新增一筆回報
// - /api/export.csv   下載全部回報（需 ?key=ADMIN_KEY），給系辦與評鑑用
// - /api/line         LINE Bot webhook：查詢各樓層狀態、在 LINE 裡回報
import LOCS from "../public/locs.json";
import {LEVEL,KINDS,COOLDOWN_MIN,MIN,status,ago} from "../public/rules.js";

const WINDOW_D=7;
const DOT={full:"🟢",low:"🟡",empty:"🔴"};

const json=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});

export default {
  async fetch(req,env,ctx){
    const url=new URL(req.url), p=url.pathname;
    if(p==="/api/reports"&&req.method==="GET")return json({reports:await recent(env)});
    if(p==="/api/reports"&&req.method==="POST")return postReport(req,env,ctx);
    if(p==="/api/export.csv"&&req.method==="GET")return exportCsv(url,env);
    if(p==="/api/line"&&req.method==="POST")return lineWebhook(req,env,ctx,url.origin);
    if(p.startsWith("/api/"))return json({error:"not found"},404);
    return env.ASSETS.fetch(req);
  }
};

async function recent(env){
  const {results}=await env.DB.prepare("SELECT loc,lv,kinds,at FROM reports WHERE at>? ORDER BY at")
    .bind(Date.now()-WINDOW_D*24*60*MIN).all();
  return results.map(r=>({...r,kinds:JSON.parse(r.kinds)}));
}

async function postReport(req,env,ctx){
  let b;try{b=await req.json()}catch(e){return json({error:"格式錯誤"},400)}
  if(typeof b.device!=="string"||!/^[A-Za-z0-9-]{8,64}$/.test(b.device))return json({error:"缺少匿名代碼"},400);
  const r=await addReport(env,ctx,{loc:b.loc,lv:b.lv,kinds:b.kinds,device:"web:"+b.device,via:"web"});
  return json(r.error?{error:r.error}:{ok:true,report:r.report},r.status||200);
}

// 網頁與 LINE 共用的寫入流程：檢查 → 5 分鐘冷卻 → 寫入 → 剛變成「已用完」就通知補貨群組
async function addReport(env,ctx,{loc,lv,kinds,device,via}){
  const l=LOCS.find(x=>x.id===loc);
  if(!l)return{error:"找不到這個地點",status:400};
  if(!LEVEL[lv])return{error:"狀態不正確",status:400};
  kinds=Array.isArray(kinds)?[...new Set(kinds)].filter(k=>KINDS.includes(k)):[];
  const now=Date.now();
  const dup=await env.DB.prepare("SELECT 1 FROM reports WHERE device=? AND loc=? AND at>? LIMIT 1")
    .bind(device,loc,now-COOLDOWN_MIN*MIN).first();
  if(dup)return{error:"你剛剛回報過這裡，"+COOLDOWN_MIN+" 分鐘後可以再回報。",status:429};
  const prev=await env.DB.prepare("SELECT lv FROM reports WHERE loc=? ORDER BY at DESC LIMIT 1").bind(loc).first();
  await env.DB.prepare("INSERT INTO reports (loc,lv,kinds,at,device,via) VALUES (?,?,?,?,?,?)")
    .bind(loc,lv,JSON.stringify(kinds),now,device,via).run();
  if(lv==="empty"&&prev?.lv!=="empty")
    ctx.waitUntil(linePush(env,"🔴 "+l.bldg+" "+l.spot+" 有人回報已用完，請協助補貨。\n補完後掃同一張 QR Code（或在 LINE 回報）選「充足」就完成標記。"));
  return{report:{loc,lv,kinds,at:now}};
}

async function exportCsv(url,env){
  if(!env.ADMIN_KEY||url.searchParams.get("key")!==env.ADMIN_KEY)return new Response("需要正確的 key",{status:401});
  const {results}=await env.DB.prepare("SELECT id,loc,lv,kinds,at,via,device FROM reports ORDER BY at").all();
  const q=v=>'"'+String(v).replace(/"/g,'""')+'"';
  const name=id=>{const l=LOCS.find(x=>x.id===id);return l?l.bldg+" "+l.spot:id};
  const rows=results.map(r=>[r.id,new Date(r.at).toLocaleString("sv-SE",{timeZone:"Asia/Taipei"}),name(r.loc),LEVEL[r.lv].t,JSON.parse(r.kinds).join("、"),r.via,r.device].map(q).join(","));
  const csv="﻿"+["編號,時間（台北）,地點,狀態,種類,來源,匿名代碼",...rows].join("\r\n");
  return new Response(csv,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":'attachment; filename="period-pal-reports.csv"',"cache-control":"no-store"}});
}

// ===== LINE Bot =====
async function lineWebhook(req,env,ctx,origin){
  const body=await req.text();
  if(!env.LINE_CHANNEL_SECRET||!await validSignature(body,req.headers.get("x-line-signature"),env.LINE_CHANNEL_SECRET))
    return new Response("bad signature",{status:401});
  const {events=[]}=JSON.parse(body);
  for(const ev of events){
    try{const msgs=await handleEvent(ev,env,ctx,origin);if(msgs&&ev.replyToken)await lineReply(env,ev.replyToken,msgs)}
    catch(e){console.error("LINE event failed",e)}
  }
  return new Response("ok");
}

async function handleEvent(ev,env,ctx,origin){
  const inGroup=ev.source?.type==="group"||ev.source?.type==="room";
  if(ev.type==="follow")return[text("你好！這裡是好朋友地圖，可以查公衛學院大樓 1 到 7 樓哪裡有生理用品，也可以直接在這裡回報。\n不會記錄你的身分。"),await summary(env,origin)];
  if(ev.type==="join")return[text("大家好！之後補給點被回報用完時，我會在這個群組通知。\n請管理者傳「群組ID」給我，把回覆的 ID 設定到 LINE_STAFF_TO。")];
  if(ev.type==="message"&&ev.message.type==="text"){
    const t=ev.message.text.trim();
    if(t==="群組ID")return[text(ev.source.groupId||ev.source.roomId||"這裡不是群組，請在補貨群組裡傳。")];
    if(t.includes("回報"))return[pickFloor()];
    if(inGroup&&!t.includes("查詢"))return null; // 群組裡只回應指令，避免洗版
    return[await summary(env,origin)];
  }
  if(ev.type==="postback"){
    const d=new URLSearchParams(ev.postback.data), loc=d.get("loc"), lv=d.get("lv");
    if(loc&&!lv)return[pickLevel(loc)];
    if(loc&&lv){
      const r=await addReport(env,ctx,{loc,lv,kinds:[],device:"line:"+await anonId(ev.source.userId||"",env.LINE_CHANNEL_SECRET),via:"line"});
      if(r.error)return[text(r.error)];
      const l=LOCS.find(x=>x.id===loc);
      return[text("謝謝你的回報！"+l.bldg+" "+l.spot+" 現在顯示「"+LEVEL[lv].t+"」，下一位同學查得到了。",quick())];
    }
  }
  return null;
}

async function summary(env,origin){
  const rs=await recent(env), now=Date.now();
  const lines=LOCS.map(l=>{const s=status(rs,l.id,now);return(DOT[s.key]||"⚪")+" "+l.bldg+" "+l.spot+"："+s.label+(s.rs.length?"（"+ago(s.rs[0].at,now)+"）":"")});
  return text("公衛學院大樓生理用品現況\n\n"+lines.join("\n")+"\n\n⚪ 代表待確認或還沒人回報\n網頁版："+origin+"/",quick());
}

const text=(t,quickReply)=>quickReply?{type:"text",text:t,quickReply}:{type:"text",text:t};
const quick=()=>({items:[
  {type:"action",action:{type:"message",label:"查詢現況",text:"查詢"}},
  {type:"action",action:{type:"message",label:"我要回報",text:"回報"}}]});
const pickFloor=()=>text("要回報哪一層？",{items:LOCS.map(l=>({type:"action",action:{type:"postback",label:(l.bldg+" "+l.spot).slice(0,20),data:"loc="+l.id,displayText:"回報 "+l.bldg+" "+l.spot}}))});
function pickLevel(loc){
  const l=LOCS.find(x=>x.id===loc);
  if(!l)return text("找不到這個地點。");
  return text(l.bldg+" "+l.spot+" 現在的狀況？",{items:Object.entries(LEVEL).map(([k,v])=>({type:"action",action:{type:"postback",label:v.t,data:"loc="+loc+"&lv="+k,displayText:v.t}}))});
}

async function lineReply(env,replyToken,messages){
  await lineApi(env,"reply",{replyToken,messages});
}
async function linePush(env,t){
  if(!env.LINE_STAFF_TO)return;
  await lineApi(env,"push",{to:env.LINE_STAFF_TO,messages:[text(t)]});
}
async function lineApi(env,kind,payload){
  if(!env.LINE_CHANNEL_ACCESS_TOKEN)return;
  const r=await fetch("https://api.line.me/v2/bot/message/"+kind,{method:"POST",
    headers:{"content-type":"application/json",authorization:"Bearer "+env.LINE_CHANNEL_ACCESS_TOKEN},body:JSON.stringify(payload)});
  if(!r.ok)console.error("LINE "+kind+" failed",r.status,await r.text());
}

async function hmac(secret,data){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(data)));
}
async function validSignature(body,sig,secret){
  if(!sig)return false;
  const want=btoa(String.fromCharCode(...await hmac(secret,body)));
  if(want.length!==sig.length)return false;
  let d=0;for(let i=0;i<want.length;i++)d|=want.charCodeAt(i)^sig.charCodeAt(i);
  return d===0;
}
// LINE 帳號只轉成加鹽雜湊，用來做 5 分鐘冷卻，資料庫裡不會有原本的 LINE ID
async function anonId(userId,secret){
  return[...(await hmac(secret,"anon:"+userId)).slice(0,8)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
