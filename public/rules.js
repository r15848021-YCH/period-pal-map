// 判斷規則：網頁與 Worker（LINE Bot）共用這一份，改這裡兩邊一起生效
export const LEVEL={full:{t:"充足",d:"盒內還有很多",cls:"s-full"},low:{t:"剩少量",d:"只剩幾片",cls:"s-low"},empty:{t:"已用完",d:"盒子是空的",cls:"s-empty"}};
export const KINDS=["護墊","17.5cm","23cm"]; // 公衛大樓實際放的種類；舊回報裡的日用、夜用等仍保留在資料庫
export const STALE_H=6, CONFLICT_MIN=60, COOLDOWN_MIN=5;
export const MIN=60e3, H=60*MIN;

// 回報規則（簡報〈系統怎麼判斷這筆回報〉）：
// 1. 同一裝置對同一地點 5 分鐘內只算一筆（寫入時檢查，見 src/worker.js 的 addReport）
// 2. 以最新一筆為準
// 3. 最新一筆說「已用完」，但前 60 分鐘內有人說「充足」→ 回報不一致
//    反過來（先「已用完」、後「充足」）是補貨完成，地圖直接恢復綠色，不算矛盾
// 4. 超過 6 小時沒人回報 → 待確認
// 5. 只有狀態「剛」從其他狀態變成「已用完」才通知補貨群組（見 shouldNotify）
export function status(reports,id,now=Date.now()){
  const rs=reports.filter(r=>r.loc===id).sort((a,b)=>b.at-a.at);
  if(!rs.length)return{key:"none",label:"尚無回報",cls:"s-unk",rank:3,rs};
  const a=rs[0], age=now-a.at;
  if(age>STALE_H*H)return{key:"stale",label:"待確認",why:"超過 "+STALE_H+" 小時沒人回報，上次是「"+LEVEL[a.lv].t+"」",cls:"s-unk",rank:2,rs};
  const c=conflictWith(rs);
  if(c)return{key:"conflict",label:"回報不一致",why:"一小時內有人說「充足」、又有人說「已用完」，請到現場確認",cls:"s-unk",rank:2,rs};
  const rank={full:0,low:1,empty:4}[a.lv];
  return{key:a.lv,label:LEVEL[a.lv].t,cls:LEVEL[a.lv].cls,rank,rs};
}

// rs：同一地點的回報，新到舊。最新一筆是「已用完」時，找出它前 60 分鐘內說「充足」的那筆
export function conflictWith(rs){
  const a=rs[0];
  if(!a||a.lv!=="empty")return null;
  return rs.slice(1).find(r=>r.lv==="full"&&a.at-r.at<CONFLICT_MIN*MIN)||null;
}

// 新回報 lv 送進來前，prev 是這個地點既有的回報（新到舊）。
// 上一筆已經是「已用完」而且還沒過期，代表同一次缺貨、已經通知過，就不再推播；
// 上一筆「已用完」已超過 6 小時（地圖顯示待確認），視為新的一次缺貨，再通知一次。
export function shouldNotify(prev,lv,now=Date.now()){
  if(lv!=="empty")return false;
  const p=prev[0];
  return!p||p.lv!=="empty"||now-p.at>STALE_H*H;
}

export function ago(t,now=Date.now()){const m=Math.round((now-t)/MIN);if(m<1)return"剛剛";if(m<60)return m+" 分鐘前";const h=Math.floor(m/60);if(h<24)return h+" 小時前";return Math.floor(h/24)+" 天前"}
