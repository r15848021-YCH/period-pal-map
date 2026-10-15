// 判斷規則：網頁與 Worker（LINE Bot）共用這一份，改這裡兩邊一起生效
export const LEVEL={full:{t:"充足",d:"盒內還有很多",cls:"s-full"},low:{t:"剩少量",d:"只剩幾片",cls:"s-low"},empty:{t:"已用完",d:"盒子是空的",cls:"s-empty"}};
export const KINDS=["日用","夜用","護墊","棉條"];
export const STALE_H=6, CONFLICT_MIN=60, COOLDOWN_MIN=5;
export const MIN=60e3, H=60*MIN;

// 最新一筆為準；與前一筆相隔 60 分鐘內且說法不同 → 回報不一致；超過 6 小時沒人回報 → 待確認
export function status(reports,id,now=Date.now()){
  const rs=reports.filter(r=>r.loc===id).sort((a,b)=>b.at-a.at);
  if(!rs.length)return{key:"none",label:"尚無回報",cls:"s-unk",rank:3,rs};
  const [a,b]=rs, age=now-a.at;
  if(age>STALE_H*H)return{key:"stale",label:"待確認",why:"超過 "+STALE_H+" 小時沒人回報，上次是「"+LEVEL[a.lv].t+"」",cls:"s-unk",rank:2,rs};
  if(b&&a.lv!==b.lv&&a.at-b.at<CONFLICT_MIN*MIN&&(a.lv==="empty")!==(b.lv==="empty"))
    return{key:"conflict",label:"回報不一致",why:"一小時內有人說「"+LEVEL[a.lv].t+"」、有人說「"+LEVEL[b.lv].t+"」",cls:"s-unk",rank:2,rs};
  const rank={full:0,low:1,empty:4}[a.lv];
  return{key:a.lv,label:LEVEL[a.lv].t,cls:LEVEL[a.lv].cls,rank,rs};
}

export function ago(t,now=Date.now()){const m=Math.round((now-t)/MIN);if(m<1)return"剛剛";if(m<60)return m+" 分鐘前";const h=Math.floor(m/60);if(h<24)return h+" 小時前";return Math.floor(h/24)+" 天前"}
