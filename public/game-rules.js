// 科普遊戲的徽章與進度規則：網頁與 Worker（LINE Bot 每日一題、進度同步）共用這一份
// 進度格式：{done:{L1:true}, best:{L1:4}, sim:3, myth:8, reports:2, days:["2026-10-26"]}
//   done/best 闖關是否過關與最高答對題數；sim 模擬最佳選擇數（-1 = 沒玩過）；myth 迷思最高答對數；
//   reports 回報補給點次數；days 在 LINE 回答「今日一題」的日期（最多留 60 天）
export const PASS=3;
export const BADGES=[
  {id:"L1",icon:"🌙",name:"週期達人",desc:"通過「認識週期」",test:p=>!!p.done?.L1},
  {id:"L2",icon:"🩺",name:"就醫判斷",desc:"通過「經痛何時看醫生」",test:p=>!!p.done?.L2},
  {id:"L3",icon:"🧺",name:"用品專家",desc:"通過「生理用品怎麼選」",test:p=>!!p.done?.L3},
  {id:"L4",icon:"🏃",name:"生活高手",desc:"通過「經期生活」",test:p=>!!p.done?.L4},
  {id:"L5",icon:"🤝",name:"好朋友",desc:"通過「站在朋友旁邊」",test:p=>!!p.done?.L5},
  {id:"sim",icon:"📅",name:"陪小月過一個月",desc:"完成一個月模擬",test:p=>(p.sim??-1)>=0},
  {id:"myth",icon:"🔍",name:"迷思破解王",desc:"迷思是真是假 10 題全對",test:p=>(p.myth||0)>=10},
  {id:"report",icon:"🗺️",name:"補給守護者",desc:"在地圖回報一次補給點狀況",test:p=>(p.reports||0)>=1},
  {id:"daily",icon:"💬",name:"每日一題 7 天",desc:"在 LINE 回答 7 天的今日一題",test:p=>(p.days||[]).length>=7},
];
export const earned=p=>BADGES.filter(b=>b.test(p||{}));

// 兩份進度合併成一份（只會變多，不會變少），手機與伺服器各自有進度時用
export function merge(a={},b={}){
  const keys=o=>Object.keys(o||{});
  const done={},best={};
  for(const k of new Set([...keys(a.done),...keys(b.done)]))if(a.done?.[k]||b.done?.[k])done[k]=true;
  for(const k of new Set([...keys(a.best),...keys(b.best)]))best[k]=Math.max(a.best?.[k]||0,b.best?.[k]||0);
  return{done,best,
    sim:Math.max(a.sim??-1,b.sim??-1),
    myth:Math.max(a.myth||0,b.myth||0),
    reports:Math.max(a.reports||0,b.reports||0),
    days:[...new Set([...(a.days||[]),...(b.days||[])])].filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(-60)};
}

// 今日一題：依台北日期輪流出闖關題庫裡的題目，網頁與 LINE Bot 同一天出同一題
export function taipeiDay(t=Date.now()){return new Date(t+8*3600e3).toISOString().slice(0,10)}
export function dailyQuestion(game,day=taipeiDay()){
  const all=game.levels.flatMap(l=>l.qs);
  const n=Math.floor(Date.parse(day+"T00:00:00Z")/864e5);
  return all[((n%all.length)+all.length)%all.length];
}
