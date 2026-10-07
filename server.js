const express=require("express");
const path=require("path");
const app=express();
const PORT=process.env.PORT||10000;
app.use(express.json({limit:"256kb"}));
app.use(express.static(path.join(__dirname,"public")));
const rules=new Map();
const chatWebhooks=new Map();
const firedScheduleKeys=new Set();
const norm=v=>String(v||"").trim().toLowerCase();
const id=()=>Math.random().toString(36).slice(2,10);

async function sendGoogleChat(url,text){
  if(!url) throw new Error("Google Chat webhook URL is not configured.");
  const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json; charset=UTF-8"},body:JSON.stringify({text})});
  const body=await response.text();
  if(!response.ok) throw new Error("Google Chat returned "+response.status+": "+body);
  return body;
}

app.post("/webhook/:botId",async(req,res)=>{
  const botId=req.params.botId, message=String(req.body?.message||""), user=String(req.body?.user||"someone");
  const config=rules.get(botId)||[];
  const replies=[];
  for(const r of config){
    const a=norm(message);
    const trigger=norm(r.trigger||r.keyword||r.command);
    if(!trigger) continue;
    const matches=r.type==="keyword" ? a.includes(trigger) :
      (r.type==="command" ? a===trigger.replace(/^\//,"") || a===("/"+trigger.replace(/^\/+$/,"")) :
      (r.type==="message" || r.type==="autoreply") ? (r.match==="contains"?a.includes(trigger):a===trigger) : false);
    if(matches) replies.push(String(r.reply||"").replaceAll("{user}",user));
  }
  // Return the bot result immediately. Sending to Google Chat happens in the background,
  // so a slow Google Chat webhook cannot make the bot webhook feel slow.
  if(req.body?.sendToGoogleChat!==false && replies.length){
    const chatUrl=String(req.body?.googleChatWebhook||chatWebhooks.get(botId)||"");
    if(chatUrl){
      Promise.all(replies.map(text=>sendGoogleChat(chatUrl,text)))
        .catch(e=>console.error("Google Chat delivery failed:",e.message));
    }
  }
  res.json({ok:true,replies});
});

app.post("/api/test-google-chat",async(req,res)=>{
  const url=String(req.body?.url||"");
  const text=String(req.body?.text||"Hello from Webnook Command Builder!");
  if(!url) return res.status(400).json({ok:false,error:"Google Chat webhook URL is not configured."});
  // A test should feel instant; delivery is handled in the background.
  sendGoogleChat(url,text).catch(e=>console.error("Google Chat test failed:",e.message));
  res.status(202).json({ok:true,queued:true});
});

app.get("/api/rules/:botId",(req,res)=>res.json({rules:rules.get(req.params.botId)||[]}));
app.put("/api/rules/:botId",(req,res)=>{
  const list=Array.isArray(req.body?.rules)?req.body.rules:[];
  const webhook=String(req.body?.googleChatWebhook||"");
  if(webhook) chatWebhooks.set(req.params.botId,webhook);
  const clean=list.map(r=>({
    id:String(r.id||id()),
    type:["message","command","keyword","welcome","schedule"].includes(r.type)?r.type:"message",
    trigger:String(r.trigger||r.command||r.keyword||""),
    match:r.match==="contains"?"contains":"exact",
    command:String(r.command||""),
    keyword:String(r.keyword||""),
    reply:String(r.reply||r.welcome||""),
    time:String(r.time||"01:30"),
    days:String(r.days||"everyday"),
    enabled:r.enabled!==false
  }));
  rules.set(req.params.botId,clean);
  res.json({ok:true,rules:clean});
});
async function runSchedules(){
  const now=new Date();
  const hhmm=now.toTimeString().slice(0,5);
  const day=["sun","mon","tue","wed","thu","fri","sat"][now.getDay()];
  for(const [botId,config] of rules){
    for(const r of config){
      if(r.type!=="schedule" || r.enabled===false || String(r.time||"")!==hhmm) continue;
      const days=String(r.days||"everyday").toLowerCase();
      if(days!=="everyday" && days!=="daily" && !days.split(",").map(x=>x.trim()).includes(day)) continue;
      const key=botId+"|"+r.id+"|"+now.toISOString().slice(0,10)+"|"+hhmm;
      if(firedScheduleKeys.has(key)) continue;
      firedScheduleKeys.add(key);
      const text=String(r.reply||"").replaceAll("{user}","everyone");
      const url=chatWebhooks.get(botId);
      if(url && text) sendGoogleChat(url,text).catch(e=>console.error("Scheduled delivery failed:",e.message));
      console.log("Scheduled automation:",botId,r.id,text);
    }
  }
}
setInterval(runSchedules,30000);
runSchedules();

app.get("/api/schedule/:botId",(req,res)=>{
  const time=String(req.query.time||new Date().toTimeString().slice(0,5));
  const due=(rules.get(req.params.botId)||[]).filter(r=>r.type==="schedule"&&r.time===time).map(r=>({id:r.id,reply:r.reply}));
  res.json({time,due});
});
app.get("/health",(_req,res)=>res.json({ok:true}));
app.get("*",(_req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log("Webnook Command Builder on "+PORT));