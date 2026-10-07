const express=require("express");
const path=require("path");
const app=express();
const PORT=process.env.PORT||10000;
app.use(express.json({limit:"256kb"}));
app.use(express.static(path.join(__dirname,"public")));
const rules=new Map();
const norm=v=>String(v||"").trim().toLowerCase();
const id=()=>Math.random().toString(36).slice(2,10);

app.post("/webhook/:botId",(req,res)=>{
  const botId=req.params.botId, message=String(req.body?.message||""), user=String(req.body?.user||"someone");
  const replies=[];
  for(const r of (rules.get(botId)||[])){
    if(r.type!=="message") continue;
    const a=norm(message), b=norm(r.trigger);
    if(r.match==="contains" ? a.includes(b) : a===b) replies.push(String(r.reply||"").replaceAll("{user}",user));
  }
  res.json({ok:true,replies});
});
app.get("/api/rules/:botId",(req,res)=>res.json({rules:rules.get(req.params.botId)||[]}));
app.put("/api/rules/:botId",(req,res)=>{
  const list=Array.isArray(req.body?.rules)?req.body.rules:[];
  const clean=list.map(r=>({id:String(r.id||id()),type:r.type==="schedule"?"schedule":"message",trigger:String(r.trigger||""),match:r.match==="contains"?"contains":"exact",reply:String(r.reply||""),time:String(r.time||"01:30")}));
  rules.set(req.params.botId,clean);
  res.json({ok:true,rules:clean});
});
app.get("/api/schedule/:botId",(req,res)=>{
  const time=String(req.query.time||new Date().toTimeString().slice(0,5));
  const due=(rules.get(req.params.botId)||[]).filter(r=>r.type==="schedule"&&r.time===time).map(r=>({id:r.id,reply:r.reply}));
  res.json({time,due});
});
app.post("/api/run-schedule/:botId",(req,res)=>{
  const time=String(req.body?.time||new Date().toTimeString().slice(0,5));
  const due=(rules.get(req.params.botId)||[]).filter(r=>r.type==="schedule"&&r.time===time).map(r=>({id:r.id,reply:r.reply}));
  res.json({ok:true,time,due});
});
app.get("/health",(_req,res)=>res.json({ok:true}));
app.get("*",(_req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log("Webnook Command Builder on "+PORT));