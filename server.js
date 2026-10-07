const express=require("express");
const path=require("path");
const app=express();
const PORT=process.env.PORT||10000;
app.use(express.json({limit:"256kb"}));
app.use(express.static(path.join(__dirname,"public")));
const rules=new Map();
const chatWebhooks=new Map();
const firedScheduleKeys=new Set();
const workflowPositions=new Map();
const workflowStatus=new Map();
const norm=v=>String(v||"").trim().toLowerCase();
const id=()=>Math.random().toString(36).slice(2,10);

function workflowKey(botId,user){return botId+"|"+norm(user||"someone");}
function matchesRule(r,message){
  const a=norm(message);
  const trigger=norm(r.trigger||r.keyword||r.command);
  if(!trigger) return false;
  if(r.type==="keyword") return a.includes(trigger);
  if(r.type==="command"){
    const clean=trigger.replace(/^\//,"");
    return a===clean || a==="/"+clean;
  }
  if(r.type==="message" || r.type==="autoreply") return r.match==="contains" ? a.includes(trigger) : a===trigger;
  return false;
}

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
  const key=workflowKey(botId,user);
  let pos=workflowPositions.has(key)?workflowPositions.get(key):0;
  let waitingFor=null;

  while(pos<config.length){
    const r=config[pos];
    if(r.type==="message" || r.type==="command" || r.type==="keyword"){
      waitingFor=String(r.trigger||r.keyword||r.command||"");
      if(!matchesRule(r,message)) break;
      const reply=String(r.reply||"").replaceAll("{user}",user);
      if(reply) replies.push(reply);
      pos++;
      waitingFor=null;
      continue;
    }
    pos++;
  }

  for(const r of config){
    if(r.type==="autoreply" && matchesRule(r,message)){
      const reply=String(r.reply||"").replaceAll("{user}",user);
      if(reply) replies.push(reply);
    }
  }

  workflowPositions.set(key,pos);
  const running=pos<config.length && !!waitingFor;
  workflowStatus.set(key,{running,index:running?pos:null,waitingFor:waitingFor||null,completed:!running&&pos>=config.length});

  if(req.body?.sendToGoogleChat!==false && replies.length){
    const chatUrl=String(req.body?.googleChatWebhook||chatWebhooks.get(botId)||"");
    if(chatUrl){
      Promise.all(replies.map(text=>sendGoogleChat(chatUrl,text)))
        .catch(e=>console.error("Google Chat delivery failed:",e.message));
    }
  }
  res.json({ok:true,replies,running,index:running?pos:null,waitingFor:waitingFor||null,completed:!running&&pos>=config.length});
});

app.post("/api/workflow/:botId/start",async(req,res)=>{
  const botId=req.params.botId;
  const user=String(req.body?.user||"You");
  const config=rules.get(botId)||[];
  const requested=Number.isInteger(req.body?.index)?req.body.index:0;
  const index=Math.max(0,Math.min(requested,Math.max(config.length-1,0)));
  const key=workflowKey(botId,user);
  const first=config[index];
  workflowPositions.set(key,index);
  workflowStatus.set(key,{running:!!first,index:!!first?index:null,waitingFor:first?String(first.trigger||first.keyword||first.command||""):null,completed:!first});
  res.json({ok:true,running:!!first,index:!!first?index:null,waitingFor:first?String(first.trigger||first.keyword||first.command||""):null});
});

app.get("/api/workflow/:botId/status",(req,res)=>{
  const user=String(req.query.user||"You");
  const key=workflowKey(req.params.botId,user);
  const s=workflowStatus.get(key);
  if(!s) return res.json({ok:true,running:false,index:null,waitingFor:null,completed:false});
  res.json({ok:true,...s});
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