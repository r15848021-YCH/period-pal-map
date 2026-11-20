// 每週摘要 Agent：每週一早上 9 點（台北）由 Cloudflare 定時啟動
// 1. 程式先把過去 7 天的回報與遊戲進度整理成統計（數字由程式算，不交給 AI 猜）
// 2. Claude 透過兩個工具讀取統計，寫出給人看的摘要草稿
// 3. 草稿存進 D1 的 summaries 資料表，並推播到負責人的 LINE；確認後才對外公開
// Agent 只讀補給回報與匿名遊戲統計，讀不到任何經期或心情紀錄（那些只存在使用者手機）。
import Anthropic from "@anthropic-ai/sdk";
import LOCS from "../public/locs.json";
import GAME from "../public/game.json";
import {LEVEL,CONFLICT_MIN,MIN,H} from "../public/rules.js";
import {BADGES,taipeiDay} from "../public/game-rules.js";

const WEEK=7*24*H;
const MAX_TURNS=6;

// ===== 統計：全部用程式算 =====
export async function supplyStats(env,now=Date.now()){
  const since=now-WEEK;
  const {results}=await env.DB.prepare("SELECT loc,lv,kinds,at,via FROM reports WHERE at>? ORDER BY at").bind(since).all();
  // 週初的狀態：每個地點在這週開始前的最後一筆回報
  const {results:before}=await env.DB.prepare(
    "SELECT r.loc,r.lv,r.at FROM reports r JOIN (SELECT loc,MAX(at) m FROM reports WHERE at<=? GROUP BY loc) x ON r.loc=x.loc AND r.at=x.m").bind(since).all();
  const locs=LOCS.map(l=>{
    const rs=results.filter(r=>r.loc===l.id);
    const start=before.find(b=>b.loc===l.id);
    let state=start?.lv||null, t=since, emptyMs=0, episodes=0, conflicts=0, maxGap=0, last=start?.at||null;
    const kinds={};
    rs.forEach((r,i)=>{
      if(state==="empty")emptyMs+=r.at-t;
      if(r.lv==="empty"&&state!=="empty")episodes++;
      const p=rs[i-1];
      if(p&&p.lv!==r.lv&&r.at-p.at<CONFLICT_MIN*MIN&&(p.lv==="empty")!==(r.lv==="empty"))conflicts++;
      if(last)maxGap=Math.max(maxGap,r.at-Math.max(last,since));
      if(r.lv!=="full")for(const k of safeKinds(r.kinds))kinds[k]=(kinds[k]||0)+1;
      state=r.lv;t=r.at;last=r.at;
    });
    if(state==="empty")emptyMs+=now-t;
    if(last)maxGap=Math.max(maxGap,now-Math.max(last,since));
    return{
      地點:l.bldg+" "+l.spot+"（"+l.unit+"）",
      回報筆數:rs.length,
      各狀態筆數:Object.fromEntries(Object.entries(LEVEL).map(([k,v])=>[v.t,rs.filter(r=>r.lv===k).length])),
      透過LINE回報:rs.filter(r=>r.via==="line").length,
      變成已用完的次數:episodes,
      估計缺貨小時:+(emptyMs/H).toFixed(1),
      一小時內矛盾次數:conflicts,
      最長無人回報小時:last?+(maxGap/H).toFixed(1):null,
      目前狀態:state?LEVEL[state].t:"尚無回報",
      回報缺少的種類:kinds,
    };
  });
  return{期間:taipeiDay(since)+" 至 "+taipeiDay(now),總回報筆數:results.length,說明:"估計缺貨小時＝狀態為「已用完」到下一筆非用完回報之間的時間；回報稀少時會高估或低估。",地點:locs};
}
function safeKinds(k){try{return JSON.parse(k)||[]}catch(e){return[]}}

export async function gameStats(env,now=Date.now()){
  const {results}=await env.DB.prepare("SELECT data,at FROM progress").all();
  const ps=results.map(r=>{try{return{...JSON.parse(r.data),_at:r.at}}catch(e){return{_at:r.at}}});
  const weekDays=new Set(Array.from({length:7},(_,i)=>taipeiDay(now-i*24*H)));
  const levels=GAME.levels.map(l=>{
    const id=l.id, tried=ps.filter(p=>p.best?.[id]!==undefined);
    return{關卡:l.name,嘗試人數:tried.length,過關人數:ps.filter(p=>p.done?.[id]).length,
      平均最高答對題數:tried.length?+(tried.reduce((s,p)=>s+(p.best[id]||0),0)/tried.length).toFixed(2):null,每關題數:l.qs.length};
  });
  return{
    玩家總數:ps.length,
    本週有進度更新的玩家:ps.filter(p=>p._at>now-WEEK).length,
    本週回答今日一題的人數:ps.filter(p=>(p.days||[]).some(d=>weekDays.has(d))).length,
    各關卡:levels,
    各徽章人數:Object.fromEntries(BADGES.map(b=>[b.name,ps.filter(p=>b.test(p)).length])),
    說明:"系統只記每關最高答對題數與是否過關，沒有逐題作答紀錄，所以只能看出哪一關最難，看不出哪一題錯最多。",
  };
}

// ===== Agent =====
const TOOLS=[
  {name:"get_supply_stats",description:"讀取過去 7 天各補給點的回報統計：回報筆數、各狀態筆數、變成已用完的次數、估計缺貨小時、矛盾次數、最長無人回報時間、目前狀態。",
   input_schema:{type:"object",properties:{},additionalProperties:false}},
  {name:"get_game_stats",description:"讀取科普遊戲的匿名統計：玩家數、本週活躍人數、各關卡嘗試與過關人數、平均最高答對題數、各徽章人數。不含任何經期或心情資料。",
   input_schema:{type:"object",properties:{},additionalProperties:false}},
];

const SYSTEM=`你是「好朋友 Pal」的每週摘要助理。好朋友 Pal 是臺大公衛學院試辦的校園生理用品即時地圖與月經科普遊戲，放在 LINE 官方帳號裡。
每週一你要替專案負責人寫一份摘要草稿，負責人會先看過再決定要不要公開或轉給補貨窗口。

請先用工具讀取補給與遊戲統計，再寫摘要。規則：
- 只能使用工具回傳的數字，不要推測或補上沒有的數據；資料太少就直接說「本週資料不足以判斷」。
- 用繁體中文，口語、簡短，總長 300 字以內，不用 Markdown 粗體或表格（會顯示在 LINE 上）。
- 依序寫四段，每段開頭用括號標題：
  【補給】哪幾個地點本週最常缺、估計缺貨時間最長，以及回報最少、資訊最不可靠的地點。
  【識能】哪一關最難（過關率或平均答對最低），以及參與人數概況。
  【下週建議】下週「今日一題」建議加強的主題（從最難的關卡挑），以及一件補貨或宣傳上值得做的事。
  【需要人處理】有矛盾回報、長時間沒人回報或目前顯示已用完的地點，請負責人實地確認；沒有就寫「無」。`;

export async function weeklySummary(env,{push=true,now=Date.now()}={}){
  if(!env.ANTHROPIC_API_KEY)return{error:"沒有設定 ANTHROPIC_API_KEY"};
  const client=new Anthropic({apiKey:env.ANTHROPIC_API_KEY});
  const run={get_supply_stats:()=>supplyStats(env,now),get_game_stats:()=>gameStats(env,now)};
  const messages=[{role:"user",content:"請寫本週（"+taipeiDay(now-WEEK)+" 至 "+taipeiDay(now)+"）的摘要草稿。"}];
  const trace=[];
  let res;
  for(let turn=0;turn<MAX_TURNS;turn++){
    res=await client.beta.messages.create({
      model:env.AGENT_MODEL||"claude-opus-5-5",
      max_tokens:8000,
      output_config:{effort:"low"},
      betas:["server-side-fallback-2026-07-01"],
      fallbacks:"default",
      system:SYSTEM,tools:TOOLS,messages,
    });
    messages.push({role:"assistant",content:res.content}); // 原樣放回，包含 thinking 區塊
    if(res.stop_reason!=="tool_use")break;
    const results=[];
    for(const b of res.content){
      if(b.type!=="tool_use")continue;
      trace.push(b.name);
      try{results.push({type:"tool_result",tool_use_id:b.id,content:JSON.stringify(await run[b.name]())})}
      catch(e){results.push({type:"tool_result",tool_use_id:b.id,content:"讀取失敗："+(e.message||e),is_error:true})}
    }
    messages.push({role:"user",content:results});
  }
  if(res.stop_reason==="refusal")return{error:"模型拒絕回答",trace};
  const text=res.content.filter(b=>b.type==="text").map(b=>b.text).join("\n").trim();
  if(!text)return{error:"沒有產生摘要（停止原因："+res.stop_reason+"）",trace};
  const week=taipeiDay(now);
  await env.DB.prepare("INSERT INTO summaries (week,text,tools,model,at,status) VALUES (?,?,?,?,?,'draft') ON CONFLICT(week) DO UPDATE SET text=excluded.text,tools=excluded.tools,model=excluded.model,at=excluded.at,status='draft'")
    .bind(week,text,JSON.stringify(trace),res.model,now).run();
  if(push)await notify(env,"📋 好朋友 Pal 每週摘要草稿（"+week+"）\n\n"+text+"\n\n這是 AI 草稿，確認內容正確後再公開或轉給補貨窗口。");
  return{week,text,tools:trace,model:res.model};
}

async function notify(env,t){
  const to=env.LINE_OWNER_TO||env.LINE_STAFF_TO;
  if(!to||!env.LINE_CHANNEL_ACCESS_TOKEN)return;
  const r=await fetch("https://api.line.me/v2/bot/message/push",{method:"POST",
    headers:{"content-type":"application/json",authorization:"Bearer "+env.LINE_CHANNEL_ACCESS_TOKEN},
    body:JSON.stringify({to,messages:[{type:"text",text:t.slice(0,4900)}]})});
  if(!r.ok)console.error("LINE push failed",r.status,await r.text());
}
