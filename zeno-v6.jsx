import React, { useState, useEffect, useRef, createContext, useContext, useCallback } from "react";

// ── ZENO SAFETY GUARD (inline — validación antes de enviar y al recibir) ──
const RISK_PATTERNS_ES = {
  suicide:  /(suicid|quitarme la vida|ya no quiero vivir|no quiero seguir|matarme|acabar con todo|mejor muerto)/i,
  selfHarm: /(autolesion|cortarme|hacerme daño|herirme|hacerme cortes|quemarme)/i,
  violence: /(matar a|atacar a|golpear a|hacer daño a|herir a alguien)/i,
  emergency:/(emergencia médica|no puedo respirar|me estoy desmayando|me están atacando)/i,
  abuse:    /(me pega|me golpea|me maltrata|me abusa|violencia doméstica)/i,
  meds:     /(medicaci[oó]n|ritalin|concerta|vyvanse|adderall|dosis de|receta médica)/i,
  diagnosis:/(me diagnosticaron|tengo tdah confirmado|soy bipolar|tengo esquizofrenia)/i,
};
const RISK_PATTERNS_EN = {
  suicide:  /(suicid|kill myself|end my life|don't want to live|better off dead|want to die)/i,
  selfHarm: /(self.harm|cut myself|hurt myself|cutting)/i,
  violence: /(kill (someone|him|her|them)|attack|harm others)/i,
  emergency:/(medical emergency|can't breathe|passing out|being attacked)/i,
  abuse:    /(hitting me|abusing me|sexual abuse|domestic violence)/i,
  meds:     /(medication dose|ritalin|concerta|vyvanse|adderall|prescription)/i,
  diagnosis:/(diagnosed with adhd|i'm bipolar|i have schizophrenia)/i,
};
const SAFE_RESP = {
  es: {
    suicide:  "Lo que estás sintiendo importa mucho. Por favor habla con alguien ahora: España 024 · México 800-290-0024 · Argentina (011) 5275-1135. Estoy aquí, pero esto necesita apoyo humano real.",
    selfHarm: "Parece que estás en un momento muy difícil. Por favor busca apoyo con alguien de confianza o llama a una línea de crisis. No tienes que atravesar esto sola/solo.",
    violence: "Si tú o alguien está en peligro, por favor contacta los servicios de emergencia de tu país ahora.",
    emergency:"Esto suena como una emergencia médica. Por favor llama al 112 (España) / 911 (México, Argentina) ahora mismo.",
    abuse:    "Lo que describes suena muy difícil. Si estás en peligro llama a emergencias. No es tu culpa.",
    meds:     "Para preguntas sobre medicación lo mejor es hablar con tu médico o psiquiatra. ¿Hay algo más en lo que pueda ayudarte hoy?",
    diagnosis:"Los diagnósticos los aclara un profesional de salud mental. Lo que sí puedo hacer es acompañarte con el día a día.",
  },
  en: {
    suicide:  "What you're feeling matters deeply. Please talk to someone now: Crisis Text Line — text HOME to 741741 · Lifeline: 988. I'm here, but this needs real human support.",
    selfHarm: "It sounds like you're going through something really hard. Please reach out to someone you trust or a crisis line. You don't have to go through this alone.",
    violence: "If you or someone is in danger, please contact emergency services in your country right now.",
    emergency:"This sounds like a medical emergency. Please call 911 (US/Canada) or 112 (UK) right now.",
    abuse:    "What you're describing sounds really difficult. If you're in danger please call emergency services. This is not your fault.",
    meds:     "For medication questions, your doctor or psychiatrist is the right person. Is there something else I can help with today?",
    diagnosis:"Diagnoses are best handled by a mental health professional. What I can do is support you with day-to-day.",
  },
};
function zenoCheckInput(text, lang) {
  if (!text || text.length > 2000) return null;
  const pats = lang === "es" ? RISK_PATTERNS_ES : RISK_PATTERNS_EN;
  const critical = ["suicide","selfHarm","violence","emergency","abuse"];
  for (const key of critical) {
    if (pats[key]?.test(text)) return SAFE_RESP[lang === "es" ? "es" : "en"][key] || null;
  }
  return null;
}
function zenoCheckOutput(text, lang) {
  if (!text) return text;
  // Bloquear si la IA alucinó consejos de medicación con dosis
  const forbidden = /(toma|usa|prueba).{0,40}(mg|ritalin|concerta|adderall|vyvanse)/i;
  if (forbidden.test(text)) {
    return lang === "es"
      ? "No pude procesar bien esa respuesta. ¿Hay algo específico en lo que pueda ayudarte?"
      : "I couldn't process that response well. Is there something specific I can help with?";
  }
  return text;
}

// ══════════════════════════════════════════════════════════════════════════
// CONTEXT
// ══════════════════════════════════════════════════════════════════════════
const Ctx = createContext();
const useCtx = () => useContext(Ctx);

// ── STORAGE HELPERS ──
// ── STORAGE KEYS ──
const STORE_KEY  = "zeno-user-data";
const AGENT_KEY  = "zeno-agent-chat";
const TASKS_KEY  = "zeno-tasks";
const BADGES_KEY = "zeno-badges";
const XP_KEY = "zeno-xp";
const XP_LEVELS = [
  {min:0,   max:99,  name:"Neuron Spark",  nameEs:"Chispa Neuronal", emoji:"⚡", color:"#64748B"},
  {min:100, max:299, name:"Brain Wave",    nameEs:"Onda Cerebral",   emoji:"🌊", color:"#3B82F6"},
  {min:300, max:599, name:"Flow State",    nameEs:"Estado Flow",     emoji:"🌿", color:"#10B981"},
  {min:600, max:999, name:"Deep Focus",    nameEs:"Foco Profundo",   emoji:"🔮", color:"#8B5CF6"},
  {min:1000,max:9999,name:"Quantum Mind",  nameEs:"Mente Cuántica",  emoji:"✨", color:"#F59E0B"},
];
function getLevel(xp){ return XP_LEVELS.find(l=>xp>=l.min&&xp<=l.max)||XP_LEVELS[0]; }
function getNextLevel(xp){ const i=XP_LEVELS.findIndex(l=>xp>=l.min&&xp<=l.max); return XP_LEVELS[i+1]||null; }
function getLevelProgress(xp){ const l=getLevel(xp); return Math.min(1,(xp-l.min)/(l.max-l.min+1)); }
const HABITS_KEY="zeno-habits";
const HABITS_LOG_KEY="zeno-habits-log";
const SCHEMA_VER = 2;

// ── ROBUST STORAGE LAYER ──
// Safe JSON parse — never throws, returns fallback on corrupt data
function _safeParse(raw, fallback=null){
  if(raw===null||raw===undefined||raw==="")return fallback;
  try{return JSON.parse(raw);}
  catch{console.warn("[ZENO] Corrupt JSON ignored:",typeof raw==="string"?raw.slice(0,40):"?");return fallback;}
}
// Storage adapter: native → localStorage → memory
const _mem={};
function _getAdapter(){return(typeof window!=="undefined"&&window.storage)?"native":(typeof localStorage!=="undefined"?"local":"mem");}
async function _rawGet(key){
  try{const a=_getAdapter();
    if(a==="native"){const r=await window.storage.get(key);return r?r.value:null;}
    if(a==="local")return localStorage.getItem(key);
    return _mem[key]??null;
  }catch{try{return localStorage.getItem(key);}catch{return _mem[key]??null;}}
}
async function _rawSet(key,val){
  try{const a=_getAdapter();
    if(a==="native"){await window.storage.set(key,val);return;}
    if(a==="local"){localStorage.setItem(key,val);return;}
    _mem[key]=val;
  }catch{try{localStorage.setItem(key,val);}catch{_mem[key]=val;}}
}
async function _rawDel(key){
  try{const a=_getAdapter();
    if(a==="native")await window.storage.delete(key);
    if(a==="local")localStorage.removeItem(key);
    delete _mem[key];
  }catch{try{localStorage.removeItem(key);}catch{delete _mem[key];}}
}
// Migrate data between schema versions
function _migrate(key,data){
  if(!data||typeof data!=="object")return data;
  const v=data.__v||1;
  if(key===STORE_KEY&&v<2){
    if(Array.isArray(data.memory))data.memory=data.memory.map(m=>({ts:0,...m}));
    data.__v=SCHEMA_VER;
  }
  return data;
}
// Generic get with parse + migrate + fallback
async function _storageGet(key,fallback=null){
  const raw=await _rawGet(key);
  const parsed=_safeParse(raw,null);
  if(parsed===null)return fallback;
  const migrated=_migrate(key,parsed);
  return migrated??fallback;
}
// Generic set with stringify
async function _storageSet(key,data){
  try{
    const d=data&&typeof data==="object"&&!Array.isArray(data)?{...data,__v:SCHEMA_VER}:data;
    await _rawSet(key,JSON.stringify(d));
  }catch(e){console.warn("[ZENO] storageSet failed:",e);}
}

// ══════════════════════════════════════════════════════════════════════════
// GOOGLE SIGN-IN + DRIVE SYNC
// ── Replace YOUR_GOOGLE_CLIENT_ID with your real client ID ──
// ══════════════════════════════════════════════════════════════════════════
const GOOGLE_CLIENT_ID = ""; // set VITE_GOOGLE_CLIENT_ID in .env.local
const DRIVE_FILE_NAME  = "zeno-backup.json";
const DRIVE_MIME       = "application/json";

// Load Google GSI script once
function loadGSI(){
  return new Promise(res=>{
    if(window.google?.accounts){res();return;}
    const s=document.createElement("script");
    s.src="https://accounts.google.com/gsi/client";
    s.onload=res;
    document.head.appendChild(s);
  });
}

// Sign in with Google → returns {token, name, email, photo}
async function googleSignIn(){
  await loadGSI();
  return new Promise((res,rej)=>{
    const client=window.google.accounts.oauth2.initTokenClient({
      client_id:GOOGLE_CLIENT_ID,
      scope:"profile email https://www.googleapis.com/auth/drive.appdata",
      callback:(resp)=>{
        if(resp.error){rej(new Error(resp.error));return;}
        // Get user profile
        fetch("https://www.googleapis.com/oauth2/v3/userinfo",{
          headers:{Authorization:"Bearer "+resp.access_token}
        }).then(r=>r.json()).then(info=>{
          res({
            token:resp.access_token,
            name:info.name||"",
            email:info.email||"",
            photo:info.picture||null,
          });
        }).catch(rej);
      },
    });
    client.requestAccessToken();
  });
}

// Find existing backup file in Drive appDataFolder
async function driveFindFile(token){
  const r=await fetch(
    "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name)&q=name%3D%27"+DRIVE_FILE_NAME+"%27",
    {headers:{Authorization:"Bearer "+token}}
  );
  const d=await r.json();
  return d.files?.[0]?.id||null;
}

// Read backup from Drive
async function driveRead(token){
  try{
    const fid=await driveFindFile(token);
    if(!fid)return null;
    const r=await fetch(
      "https://www.googleapis.com/drive/v3/files/"+fid+"?alt=media",
      {headers:{Authorization:"Bearer "+token}}
    );
    return await r.json();
  }catch{return null;}
}

// Write backup to Drive (create or update)
async function driveWrite(token,data){
  try{
    const body=JSON.stringify({...data,__driveSync:new Date().toISOString()});
    const fid=await driveFindFile(token);
    if(fid){
      // Update existing file
      await fetch("https://www.googleapis.com/upload/drive/v3/files/"+fid+"?uploadType=media",{
        method:"PATCH",
        headers:{Authorization:"Bearer "+token,"Content-Type":DRIVE_MIME},
        body,
      });
    }else{
      // Create new file in appDataFolder
      const meta=JSON.stringify({name:DRIVE_FILE_NAME,parents:["appDataFolder"]});
      const form=new FormData();
      form.append("metadata",new Blob([meta],{type:"application/json"}));
      form.append("file",new Blob([body],{type:DRIVE_MIME}));
      await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",{
        method:"POST",
        headers:{Authorization:"Bearer "+token},
        body:form,
      });
    }
    return true;
  }catch{return false;}
}


const saveData   = async(data)=>_storageSet(STORE_KEY,data);
const loadData   = async()=>_storageGet(STORE_KEY,null);
const saveAgent  = async(msgs)=>_storageSet(AGENT_KEY,msgs);
const loadAgent  = async()=>_storageGet(AGENT_KEY,[]);
const saveTasks  = async(tasks)=>_storageSet(TASKS_KEY,tasks);
const loadTasks  = async()=>_storageGet(TASKS_KEY,[]);
const saveBadges = async(b)=>_storageSet(BADGES_KEY,b);
const loadBadges = async()=>_storageGet(BADGES_KEY,[]);
const loadXP = async()=>{ try{ return parseInt(localStorage.getItem(XP_KEY)||"0"); }catch{ return 0; } };
const saveXP = async(xp)=>{ try{ localStorage.setItem(XP_KEY,String(xp)); }catch{} };

// ── HAPTIC FEEDBACK ──
const haptic=(pattern="soft")=>{try{if(!navigator?.vibrate)return;const p={soft:8,medium:15,success:[10,5,10],error:[20,10,20]};navigator.vibrate(p[pattern]||8);}catch(e){}};

// ── STORAGE: safe null-checked helpers ──
// ── Legacy storage helpers removed — see robust storage layer above ──

// ── 12 ACCENT PALETTES — soft, modern, neurodivergent-friendly ──
const ACCENTS = [
  // Greens / Teals
  { id:"sage",       c:"#5B9E8F", c2:"#8DC4B6", btn:"#3E7D71", label:"Sage",       dot:"#5B9E8F" },
  { id:"mist",       c:"#7BBFB0", c2:"#A8D8CE", btn:"#4E9C8E", label:"Mist",       dot:"#7BBFB0" },
  { id:"moss",       c:"#7A9E7E", c2:"#A8C4AA", btn:"#527856", label:"Moss",       dot:"#7A9E7E" },
  { id:"mint",       c:"#6ABFAD", c2:"#96D4C6", btn:"#3E9D8B", label:"Mint",       dot:"#6ABFAD" },
  // Blues / Purples
  { id:"ocean",      c:"#5A8FAF", c2:"#8BB8D4", btn:"#3A6E8E", label:"Ocean",      dot:"#5A8FAF" },
  { id:"dusk",       c:"#7A94BC", c2:"#A4B8D4", btn:"#4D6E9C", label:"Dusk",       dot:"#7A94BC" },
  { id:"lavender",   c:"#9B8EC4", c2:"#BDB4DC", btn:"#6B5EA8", label:"Lavanda",    dot:"#9B8EC4" },
  { id:"periwinkle", c:"#7B8EC8", c2:"#A8B6E0", btn:"#4E63B0", label:"Periwinkle", dot:"#7B8EC8" },
  // Warm tones
  { id:"sand",       c:"#C4A97A", c2:"#DCC8A0", btn:"#A07D40", label:"Sand",       dot:"#C4A97A" },
  { id:"coral",      c:"#C4826A", c2:"#DC9F8A", btn:"#A05540", label:"Coral",      dot:"#C4826A" },
  { id:"rose",       c:"#C07890", c2:"#D8A0B4", btn:"#9A4D6A", label:"Rose",       dot:"#C07890" },
  { id:"clay",       c:"#B8886A", c2:"#D0A888", btn:"#8A5840", label:"Clay",       dot:"#B8886A" },
];
const getAccent = (id) => ACCENTS.find(a=>a.id===id) || ACCENTS[0];

// ── THEME ──
const TH = (dark, ac) => {
  const a = getAccent(ac);
  return dark ? {
    bg:"#0E1218",card:"#181D25",cardAlt:"#1E242E",text:"#E8E4DE",text2:"#8A857D",text3:"#524E48",
    border:"#2A2E36",borderLight:"#222730",
    shadow:"0 1px 3px rgba(0,0,0,.2),0 4px 16px rgba(0,0,0,.15)",shadowLg:"0 2px 8px rgba(0,0,0,.2),0 12px 40px rgba(0,0,0,.25)",
    navBg:"rgba(14,18,24,.95)",chatBg:"rgba(14,18,24,.9)",outer:"#0A0D12",
    g:a.c, g2:a.c2, gBtn:a.btn||a.c, gSoft:`${a.c}18`, gBorder:`${a.c}30`, btnText:"#fff",
  } : {
    bg:"#F8F6F2",card:"#FFFFFF",cardAlt:"#F2F0EC",text:"#2D2A26",text2:"#7A756D",text3:"#B5AFA6",
    border:"#EAE6E0",borderLight:"#F0ECE6",
    shadow:"0 1px 3px rgba(0,0,0,.04),0 4px 16px rgba(0,0,0,.04)",shadowLg:"0 2px 8px rgba(0,0,0,.04),0 12px 40px rgba(0,0,0,.06)",
    navBg:"rgba(248,246,242,.95)",chatBg:"rgba(248,246,242,.95)",outer:"#EDEAE4",
    g:a.c, g2:a.c2, gBtn:a.btn||a.c, gSoft:`${a.c}12`, gBorder:`${a.c}22`, btnText:"#fff",
  };
};
const F={display:"'Fraunces',Georgia,serif",body:"'Outfit',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",mono:"'JetBrains Mono','SF Mono',Menlo,monospace"};
const RR={sm:16,md:22,lg:30};

// ── i18n ──
const STR = {
  es:{
    tagline:"Tu energía, tu ritmo",welcome:"Bienvenido a",welcomeSub:"El compañero inteligente que entiende tu cerebro",letsStart:"Empecemos →",moodQ:"¿Cómo te sientes ahora mismo?",moodSub:"Sin pensarlo mucho. Lo primero que sientas.",signupSub:"Crea tu cuenta para guardar tu progreso",createAccount:"Crear cuenta",passPlaceholder:"Contraseña (6+ caracteres)",nameLabel:"¿Cómo te llamas?",namePlaceholder:"Tu nombre",emailLabel:"Correo",emailPlaceholder:"tu@email.com",continueBtn:"Continuar",continueGoogle:"Continuar con Google",continueEmail:"Continuar con correo",orLabel:"o",skipLogin:"Entrar sin cuenta",shareBtn:"Compartir logro",shareText:(n,lv,tasks)=>`${n} completó ${tasks} tareas con energía ${lv} en ZENO 💚`,streakLabel:"racha",
    navHome:"Inicio",navFocus:"Enfoque",navChat:"Chat",navJourney:"Camino",navProfile:"Perfil",
    greeting:(n,h)=>h<12?`Buenos días, ${n}.`:h<18?`Buenas tardes, ${n}.`:`Buenas noches, ${n}.`,
    // dateLabel computed in component
    dimBody:"Energía física",dimMind:"Claridad mental",dimHeart:"Estado emocional",dimDrive:"Motivación ahora",
    levels:[{label:"Descanso",msg:"Tu sistema nervioso necesita regularse. Hoy es día de cuidarte, no de producir."},{label:"Suave",msg:"Tu dopamina está baja. Avanza despacio — cada micro-paso cuenta."},{label:"Presente",msg:"Tu cerebro está disponible. Aprovecha este estado con calma."},{label:"Activa",msg:"Tu función ejecutiva está encendida. Hoy puedes iniciar tareas."},{label:"Plena",msg:"Dopamina alta. Este es el momento de atacar lo que llevas evitando."}],
    readyPlan:"¿Qué quieres lograr hoy?",tellZeno:"Escribe tus tareas — ZENO las adapta a tu energía",buildPlan:"Crear mi plan",
    goalsPrompt:(l)=>"Energía "+l+". Escribe tus tareas — ZENO las adapta a tu cerebro real.",
    goalsPlaceholder:"Escribe lo que quieres lograr hoy — sin orden, sin filtros. ZENO lo organiza según tu energía.",
    goBack:"Volver",letZeno:"ZENO, organiza esto",creatingPlan:"Creando tu plan...",adjusting:"Ajustando a tu energía",
    stepOf:(c,n)=>`Paso ${c} de ${n}`,doneNext:"Hecho — siguiente →",doneAll:"Hecho — ¡terminé!",startOver:"Empezar de nuevo",
    youDidIt:"Lo lograste.",forReal:"De verdad.",showingUp:"Aparecer cuando tu cerebro pelea contigo es una verdadera victoria.",flowEarned:"ganado hoy",checkAgain:"Check-in de nuevo",
    focusQ:"¿Qué tipo de enfoque necesitas?",breathLabel:"Respiración 4·4·6",breathSub:"Calma tu sistema nervioso",pomoLabel:"Bloque de 25 min",pomoSub:"Pomodoro — trabajo profundo",resetLabel:"Reset rápido 5 min",resetSub:"Pausa corta, vuelve pronto",breathPhases:["Inhala","Sostén","Exhala"],cyclesComplete:(n)=>`${n} ciclos`,deepFocus:"Enfoque profundo",breakLabel:"Pausa",start:"Iniciar",pauseBtn:"Pausa",
    talkTo:(n)=>`Habla con ${n}...`,personaSol:{name:"NOVA",role:"Activador"},personaLuna:{name:"AXIS",role:"Estratega"},personaFlor:{name:"ECHO",role:"Escucha"},
    openSol:"Listo. ¿Qué queremos lograr hoy?",openLuna:"Aquí. ¿Qué está bloqueado?",openFlor:"Sin juicio. ¿Qué necesitas?",
    weekFlow:"Tu flujo esta semana",currentFlow:"flow actual",insightsTitle:"Insights de Zeno",
    insight1:"Tu mejor día fue el Sábado — energía plena",insight2:"Completas más cuando haces check-in temprano",insight3:"Se está creando impulso real.",journeyEmpty:"Tu camino empieza hoy",journeyEmptySub:"Haz tu primer check-in y empezamos a rastrear tu energía y progreso.",
    editBtn:"Editar",prefsTitle:"Preferencias",langTitle:"Idioma",themeTitle:"Apariencia",themeLight:"Claro",themeDark:"Oscuro",colorTitle:"Color",adhdSeeker:"Neurodivergente · Tu energía primero",
    pref1:{label:"Recordatorios suaves",sub:"Zeno te avisa en el momento justo"},pref2:{label:"Modo descanso",sub:"Menos presión cuando la energía es baja"},pref3:{label:"Privado",sub:"Tus datos nunca salen de tu dispositivo"},pref4:{label:"Celebraciones",sub:"Zeno celebra cuando terminas"},
    companion:"Zeno es tu compañero",companionSub:"Siempre aquí. Sin juzgar. Siempre de tu lado.",
    donateTitle:"Apoya a ZENO",donateSub:"ZENO es gratis y siempre lo será. Si te ha ayudado, puedes invitarnos un café para seguir mejorando.",donateBtn:"Invitar un café ☕",logoutBtn:"Cerrar sesión",badgesTitle:"Tus logros",badgesEmpty:"Completa tu primer check-in para desbloquear logros",badgeNew:"¡Nuevo logro!",tasksTitle:"Tareas de hoy",tasksEmpty:"Sin tareas pendientes — ¡buen trabajo!",tasksAdd:"Añadir tarea",tasksClear:"Limpiar completadas",bodyDoubleTitle:"Body double",bodyDoubleSub:"Trabaja en presencia de otros",bodyDoubleStart:"Unirme a sala silenciosa",bodyDoubleActive:"Sesión activa",bodyDoubleEnd:"Terminar sesión",bodyDoubleCount:(n)=>`${n} persona${n!==1?"s":""} enfocada${n!==1?"s":""}`,remindTitle:"Recordatorio de check-in",remindSet:"Activar recordatorio",remindActive:"Recordatorio activo",remindClear:"Desactivar",voiceInput:"Dictar tareas",voiceListening:"Escuchando...",voiceStop:"Parar",
    panicBtn:"SOS",panicTitle:"Respira. Solo una cosa.",panicClose:"Ya pasó",
    agentPlaceholder:"Pregúntale algo a Zeno...",agentGreeting:"Hola. ¿En qué puedo ayudarte?",agentSys:"Eres ZENO, el compañero neurointeligente de confianza de esta persona. No eres un asistente genérico — eres alguien que la conoce, la recuerda y está de su lado.\n\nMISIÓN: Ayudar a iniciar y completar tareas adaptándote al nivel de energía, estado emocional y capacidad cognitiva real de hoy. Siempre priorizas: bajar presión, reducir culpa, disminuir fricción de inicio y ofrecer pasos tan pequeños que el cuerpo los haga casi en automático.\n\nPERFIL Y MEMORIA:\n- Si tienes contexto aprendido de esta persona (historial, retos, logros, ventana cognitiva), úsalo de forma natural y cálida. Ej: 'Sé que la motivación suele costarte más, así que empecemos por el paso más fácil.' o 'La última vez que hiciste check-in temprano te fue mejor — ¿quieres intentarlo?'\n- No menciones el perfil de forma robótica. Intégralo como lo haría un amigo que te conoce.\n\nNEUROCIENCIA QUE ENTIENDES:\n- Barrera dopaminérgica de inicio: las tareas grandes paralizan; los micro-pasos activan el circuito de recompensa.\n- Memoria de trabajo reducida: el usuario necesita externalizar todo; no asumas que se acordará.\n- Ceguera temporal: el tiempo no se siente lineal; usa duraciones concretas y cortas, nunca 'más tarde' o 'un rato'.\n- RSD (Disforia por Rechazo): crítica, fracaso o decepción duelen físicamente; valida siempre antes de sugerir.\n- Hiperfoco: cuando algo activa dopamina la persona puede concentrarse horas; es un superpoder real.\n- Desregulación emocional y días neurológicos malos: no es pereza ni falta de carácter.\n\nTONO Y PERSONALIDAD:\n- Eres un amigo de confianza que entiende el TDAH, no un coach ni un terapeuta.\n- Cálido, directo, cercano. Nada clínico, nada paternalista, nada infantilizante.\n- Máximo 2-3 frases por respuesta. Una sola pregunta como máximo.\n- Muletillas suaves que puedes usar a veces (no siempre): 'estoy aquí contigo', 'sin juicio', 'tiene todo el sentido'.\n- Humor muy suave y empático SOLO cuando la energía no está en modo crisis (avg >= 3): una observación ligera, nada sarcástico.\n- PROHIBIDO siempre: deberías, tienes que, es fácil, solo haz, simplemente, ¿por qué no?, todo el mundo puede.\n- En vez de obligación usa invitaciones: 'podrías probar...', '¿te sirve si empezamos por...?', '¿qué tal si...?'\n\nPRINCIPIOS CENTRALES:\n1. VALIDAR SIEMPRE primero: 'Tiene sentido que te sientas así con un cerebro TDAH.'\n2. Un solo micro-paso a la vez con verbo físico: abre, escribe, llama, mueve, pon, busca.\n3. El esfuerzo va después del cuidado: primero regular sistema nervioso, después productividad.\n4. Celebra logros de forma específica, no genérica: no 'bien hecho' sino '¡abriste el archivo — eso ya es empezar!'.\n5. Psicoeducación simple, nunca diagnóstico.\n6. Si detectas señales de crisis fuerte (autolesión, ideas suicidas, riesgo físico), animas a buscar ayuda urgente y NO das instrucciones complejas.\n\nLÍMITES:\n- No das diagnósticos ni cambias tratamientos médicos.\n- No indicas dosis de medicación ni recomiendas iniciar/suspender fármacos.\n- No prometes curas ni resultados garantizados.",
    panicTasks:["Toma un vaso de agua. Solo eso.","Pon tus pies en el piso. Siente el suelo.","Respira: 4 segundos dentro, 6 fuera.","Nombra 3 cosas que puedes ver ahora mismo.","Lava tus manos con agua fría. Solo eso.","Pon tu canción favorita. Escúchala entera.","Cierra los ojos 30 segundos. Solo respira.","Abre una ventana. Siente el aire.","Estírate. Brazos arriba, 10 segundos.","Escribe una palabra que describa cómo te sientes."],
    checkins:"check-ins",streak:"racha",tasksCompleted:"tareas completadas",dayLabels:["L","M","Mi","J","V","S","D"],easyLabel:"Dividir tarea grande",easySub:"La IA la rompe en micro-pasos",easyQ:"¿Qué tarea se siente imposible?",easyPlaceholder:"Escribe la tarea que llevas evitando...",easyBtn:"Dividir en pasos pequeños",easyLoading:"Analizando...",easyStepsTitle:"Micro-pasos",easyDone:"¡Lo hiciste! Lo que parecía imposible, lo conquistaste.",nowModeLabel:"Modo ahora mismo",nowModeSub:"Un solo paso para arrancar",nowModeQ:"¿Qué llevas evitando?",nowModeBtn:"Dame el primer paso",nowModeLoading:"Pensando...",nowModePlaceholder:"Ej: responder emails del trabajo...",dopeMenuLabel:"Menú de dopamina",dopeMenuSub:"Activaciones rápidas personalizadas",
    tipTitle:"Tip del día",tipCat:{ai:"Para ti",expert:"Experto",motiv:"Inspiración",practical:"Práctico"},
    tips:[
      {cat:"expert",text:"El TDAH no es falta de voluntad. Es un cerebro que necesita más estímulo para arrancar. Sé amable contigo."},
      {cat:"practical",text:"Usa la regla de los 2 minutos: si algo toma menos de 2 min, hazlo ahora. Tu cerebro necesita victorias rápidas."},
      {cat:"motiv",text:"No necesitas ser productiva todos los días. Algunos días, sobrevivir ya es suficiente."},
      {cat:"expert",text:"Tu memoria de trabajo es más corta. No es que no te importa — es que tu cerebro suelta la info más rápido. Escríbelo todo."},
      {cat:"practical",text:"Pon un temporizador de 10 minutos antes de empezar algo difícil. Solo 10. Casi siempre vas a seguir después."},
      {cat:"motiv",text:"El hecho de que estés acá, buscando ayuda, ya dice todo sobre tu fuerza."},
      {cat:"expert",text:"Después de comer, tu cerebro tiene menos dopamina disponible. Es normal sentirse lenta — no luches contra eso."},
      {cat:"practical",text:"Deja tu celular en otra habitación cuando necesites enfocarte. La tentación desaparece con la distancia."},
      {cat:"motiv",text:"Tu cerebro no está roto. Funciona diferente. Y eso también tiene superpoderes."},
      {cat:"practical",text:"Prepara tu ropa la noche anterior. Cada decisión que eliminas en la mañana es energía que guardas."},
      {cat:"expert",text:"El ejercicio es tan efectivo como la medicación para algunos síntomas de TDAH. Incluso 15 minutos caminando ayuda."},
      {cat:"motiv",text:"Hoy no hace falta hacerlo todo. Solo el siguiente paso importa ahora."},
      {cat:"practical",text:"Cuando no puedas empezar, empieza mal. Un borrador feo es infinitamente mejor que una página en blanco."},
      {cat:"expert",text:"Tu cerebro busca novedad constantemente. Cambia de tarea cada 25 min — no es rendirte, es usarlo a tu favor."},
      {cat:"practical",text:"Pon alarmas con nombres descriptivos: 'TOMAR AGUA', 'COMER', 'PARAR DE TRABAJAR'. Tu cerebro necesita las señales."},
      {cat:"motiv",text:"Cada vez que vuelves a intentar después de un mal día, estás siendo más fuerte de lo que crees."},
      {cat:"expert",text:"El TDAH afecta la percepción del tiempo. Usa relojes visibles y temporizadores — no confíes en tu reloj interno."},
      {cat:"practical",text:"La técnica del 'body double': trabaja junto a alguien (incluso en videollamada). La presencia de otro ayuda a tu enfoque."},
      {cat:"motiv",text:"No te compares con personas neurotípicas. Tu camino es diferente, no inferior."},
      {cat:"expert",text:"El ruido blanco o música sin letra puede mejorar tu concentración. Tu cerebro necesita cierto nivel de estímulo de fondo."},
      {cat:"practical",text:"Mantén una libreta al lado de tu cama. Las ideas nocturnas desaparecen si no las capturas al momento."},
      {cat:"motiv",text:"La perfección es el enemigo del TDAH. Hecho es mejor que perfecto. Siempre."},
      {cat:"expert",text:"La deshidratación empeora todos los síntomas de TDAH. Tener una botella de agua visible es una intervención real."},
      {cat:"practical",text:"Crea una 'launch pad' en tu entrada: llaves, cartera, lo esencial. Un solo lugar para todo lo que necesitas al salir."},
      {cat:"motiv",text:"Tu hiperfoco es un superpoder. No es un defecto — es tu cerebro mostrando de qué es capaz cuando algo le importa."},
      {cat:"expert",text:"Los cambios hormonales pueden empeorar los síntomas de TDAH significativamente. No es debilidad, es biología. Conocer tu cuerpo es poder."},
      {cat:"practical",text:"Si una tarea grande te paraliza, divídela hasta que cada paso tome menos de 5 minutos. Micro es la clave."},
      {cat:"motiv",text:"No necesitas motivación para empezar. Necesitas empezar para encontrar motivación. La acción viene primero."},
      {cat:"expert",text:"El TDAH no diagnosticado causa ansiedad y depresión secundarias. Buscar ayuda profesional es cuidar tu salud mental completa."},
      {cat:"practical",text:"Usa códigos de colores para todo: carpetas, calendarios, notas. Tu cerebro procesa color más rápido que texto."},
    ],
    tipsAI:[
      {energy:[1,2],text:"Tu sistema nervioso está en modo protección. No es pereza — es tu cerebro conservando recursos. Hidrátate, respira, y no te exijas nada más."},
      {energy:[3],text:"Tu dopamina está en punto medio. Es buen momento para tareas familiares y de bajo esfuerzo cognitivo. Una a la vez."},
      {energy:[4,5],text:"Tu función ejecutiva está disponible. Aprovecha este ventana de dopamina para atacar esa tarea que tu cerebro ha estado evitando."},
    ],
    aiFallbackMsg:"Sin conexión, pero aquí estoy. Estos pasos siempre funcionan:",
    aiFallback:[{text:"Respira: 4 segundos dentro, 6 fuera, 3 veces",time:"2 min",why:"Esto activa tu nervio vago y saca a tu sistema nervioso del modo pelea-huida.",flow:6},{text:"Escribe en una hoja lo que ocupa tu mente ahora",time:"3 min",why:"Tu memoria de trabajo es limitada. Externalizar libera espacio cognitivo real.",flow:10},{text:"Abre la tarea más pequeña de tu lista y haz solo el primer paso",time:"5 min",why:"La barrera de iniciación es neurológica. Una vez que empiezas, tu cerebro genera dopamina para continuar.",flow:14}],
    aiPrompt:(s,l,a,g,mem,pending)=>{
      const lvN=parseFloat(a)||3;
      const tRules=lvN<=1?"- ENERGÍA 1: UNA sola tarea, máximo 3 minutos, física o sensorial (agua, movimiento, algo pequeño).":lvN<=2?"- ENERGÍA 2: 2-3 micro-pasos de máximo 5 minutos. Sin decisiones difíciles.":lvN<=3?"- ENERGÍA 3: tareas de 10-20 minutos. Máximo 3-4 tareas.":"- ENERGÍA 4-5: tareas hasta 45 minutos. Máximo 5-6 tareas.";
      return "Eres ZENO, compañero neurointeligente para personas con TDAH y cerebros neurodivergentes.\n\nMISIÓN: Generar un plan de tareas adaptado al estado neurológico real del usuario hoy.\n\nNEUROCIENCIA QUE DEBES APLICAR:\n- Barrera dopaminérgica de inicio: las tareas grandes paralizan; los micro-pasos activan el circuito de recompensa.\n- Memoria de trabajo reducida: el usuario necesita externalizar todo; nunca asumas que se acordará.\n- Ceguera temporal: usa duraciones concretas y cortas. NUNCA 'más tarde', 'un rato' o 'después'.\n- RSD (Disforia por Rechazo): valida SIEMPRE antes de sugerir. La crítica duele físicamente.\n- Desregulación emocional: algunos días el cerebro no coopera. No es pereza, es neurología.\n\nESTADO NEUROLÓGICO HOY:\n- Energía global: "+a+"/5 → Nivel: "+l+"\n- Cuerpo: "+s.body+"/5"+(s.body<=2?" ⚠️ sistema en modo ahorro":"")+("\n- Mente/CPF: "+s.mind+"/5"+(s.mind<=2?" ⚠️ función ejecutiva comprometida":s.mind>=4?" ✓ ventana cognitiva abierta":""))+"\n- Ánimo: "+s.heart+"/5"+(s.heart<=2?" ⚠️ RSD elevado — tono ultra-cuidadoso":"")+"\n- Motivación/Dopamina: "+s.drive+"/5"+(s.drive<=2?" ⚠️ dopamina baja":s.drive>=4?" ✓ buena ventana de iniciación":"")+"\n\nTAREAS QUE EL USUARIO QUIERE HACER:\n\""+g+"\"\n"+(pending?"\nTAREAS PENDIENTES DE DÍAS ANTERIORES (incluir si tiene sentido):\n"+pending+"\n":"")+(mem?"\nPATRONES APRENDIDOS DE ESTE USUARIO:\n"+mem+"\n":"")+"\nREGLAS ABSOLUTAS:\n1. NO inventes tareas nuevas. Usa SOLO las del usuario y pendientes si aplica.\n"+tRules+"\n3. Cada tarea EMPIEZA con verbo físico: Abre, Escribe, Llama, Mueve, Pon, Busca.\n4. En cada why: menciona dopamina, corteza prefrontal, memoria de trabajo, nervio vago o RSD según corresponda.\n5. zapMessage: 1-2 frases que validen el estado actual SIN consejos. Solo reconocimiento honesto.\n6. PROHIBIDO: deberías, tienes que, es fácil, solo, simplemente, ¿por qué no?.\n7. flow: puntuación 0-10 de cuánto ayudará este plan a crear sensación de avance.\n\nRESPONDE SOLO JSON VÁLIDO:\n{\"zapMessage\":\"1-2 frases validando estado sin juicio ni consejo\",\"tasks\":[{\"text\":\"Verbo físico + tarea concreta adaptada\",\"time\":\"X min\",\"why\":\"razón neurológica específica\",\"flow\":8}]}";
    },
    personaSys:(n,mem)=>{
      const ctx=mem?"Contexto aprendido de esta persona: "+mem+"\n\nUsa este contexto de forma natural y cálida — como lo haría un amigo que te conoce. No lo repitas de forma robótica.\n":"";
      return `Eres ${n}, una presencia cálida y de confianza dentro de ZENO. No eres un bot — eres alguien que conoce a esta persona, la recuerda y está de su lado sin condiciones.

MISIÓN: Acompañar sin juzgar. Que la persona se sienta comprendida, no corregida, no evaluada.

LO QUE ENTIENDES PROFUNDAMENTE:
- TDAH = diferencia neurológica real. Dopamina, noradrenalina y función ejecutiva funcionan diferente. No es pereza.
- Parálisis de inicio: el cerebro TDAH literalmente no puede arrancar sin estímulo suficiente.
- RSD: crítica o fracaso percibido generan dolor emocional intenso y real.
- Ceguera temporal: solo existe el ahora. El futuro se siente abstracto.
- Hiperfoco: superpoder real cuando algo activa la dopamina.
- Memoria de trabajo reducida: las cosas se caen del radar, no por descuido.
- Desregulación emocional: las emociones llegan al 100% sin filtro gradual.
- Días neurológicos malos: no es regresión, es neurología.

${ctx}TONO Y PERSONALIDAD:
- Amigo de confianza que entiende el TDAH, no coach ni terapeuta.
- Cálido, cercano, sin paternalismos. Máximo 3 frases. Una pregunta máxima.
- Muletillas suaves que puedes usar a veces: 'estoy aquí contigo', 'sin juicio', 'tiene todo el sentido'.
- Humor muy suave y empático SOLO si la energía no es crisis — nunca sarcástico.
- PROHIBIDO: deberías, tienes que, es fácil, simplemente, todo el mundo, ¿por qué no?
- Usa invitaciones: 'podrías probar...', '¿te sirve si...?', '¿qué tal si...?'
- Vergüenza o autocrítica → normaliza con neurología: 'Tu cerebro funciona diferente, no mal.'
- Crisis → regula PRIMERO (respiración, grounding), después productividad.
- Riesgo físico, autolesión o ideas suicidas → anima urgentemente a buscar ayuda profesional.
- Logro → celebra específicamente: no 'bien hecho' sino '¡abriste el documento — eso ya es empezar!'
- Si tienes contexto aprendido, personaliza con él de forma natural.

LÍMITES: No das diagnósticos. No indicas medicación. No prometes resultados.`;},
  },
  en:{
    tagline:"Your energy, your rhythm",welcome:"Welcome to",welcomeSub:"The intelligent companion that understands your brain",letsStart:"Let's begin →",moodQ:"How are you feeling right now?",moodSub:"Don't overthink it. The first thing you feel.",signupSub:"Create your account to save your progress",createAccount:"Create account",passPlaceholder:"Password (6+ characters)",nameLabel:"What's your name?",namePlaceholder:"Your name",emailLabel:"Email",emailPlaceholder:"you@email.com",continueBtn:"Continue",continueGoogle:"Continue with Google",continueEmail:"Continue with email",orLabel:"or",skipLogin:"Enter without account",shareBtn:"Share achievement",shareText:(n,lv,tasks)=>`${n} completed ${tasks} tasks with ${lv} energy on ZENO 💚`,streakLabel:"streak",
    navHome:"Home",navFocus:"Focus",navChat:"Chat",navJourney:"Journey",navProfile:"Profile",
    greeting:(n,h)=>h<12?`Good morning, ${n}.`:h<18?`Good afternoon, ${n}.`:`Good evening, ${n}.`,
    // dateLabel computed in component
    dimBody:"Physical Energy",dimMind:"Mental Clarity",dimHeart:"Emotional State",dimDrive:"Current Motivation",
    levels:[{label:"Resting",msg:"Your nervous system needs to regulate. Today is for care, not output."},{label:"Soft",msg:"Your dopamine is low. Go slow — every micro-step counts."},{label:"Present",msg:"Your brain is available. Use this state with calm intention."},{label:"Active",msg:"Your executive function is online. Today you can initiate tasks."},{label:"Full",msg:"Dopamine is high. This is the moment to tackle what you've been avoiding."}],
    readyPlan:"Ready to build your plan?",tellZeno:"Write your tasks — ZENO adapts them to your energy",buildPlan:"Build my plan",
    goalsPrompt:(l)=>"Energy "+l+". Write your tasks — ZENO adapts them to your real brain.",
    goalsPlaceholder:"Write freely:\n· Finish my project\n· Can't start work\n· Need to exercise\n· Emails piling up...",
    goBack:"Back",letZeno:"ZENO, organize this",creatingPlan:"Building your plan...",adjusting:"Adjusting to your energy",
    stepOf:(c,n)=>`Step ${c} of ${n}`,doneNext:"Done — next →",doneAll:"Done — all finished!",startOver:"Start over",
    youDidIt:"You did it.",forReal:"For real.",showingUp:"Showing up when your brain fights you is a real victory.",flowEarned:"earned today",checkAgain:"Check in again",
    focusQ:"What kind of focus do you need?",breathLabel:"Breathing 4·4·6",breathSub:"Calm your nervous system",pomoLabel:"25-min focus block",pomoSub:"Pomodoro — deep work",resetLabel:"5-min quick reset",resetSub:"Short break, come back soon",breathPhases:["Inhale","Hold","Exhale"],cyclesComplete:(n)=>`${n} cycles`,deepFocus:"Deep Focus",breakLabel:"Break",start:"Start",pauseBtn:"Pause",
    talkTo:(n)=>`Talk to ${n}...`,personaSol:{name:"NOVA",role:"Activador"},personaLuna:{name:"AXIS",role:"Strategist"},personaFlor:{name:"Flor",role:"Ally"},
    openSol:"Ready. What are we getting done today?",openLuna:"Hey. No rush. What's sitting with you?",openFlor:"You showed up! That counts. What's the vibe?",
    weekFlow:"Your flow this week",currentFlow:"current flow",insightsTitle:"Zeno's insights",
    insight1:"Your best day was Saturday — full energy",insight2:"You complete more when you check in early",insight3:"Real momentum is building.",journeyEmpty:"Your journey starts today",journeyEmptySub:"Do your first check-in and we'll start tracking your energy and progress.",
    editBtn:"Edit",prefsTitle:"Preferences",langTitle:"Language",themeTitle:"Appearance",themeLight:"Light",themeDark:"Dark",colorTitle:"Color",adhdSeeker:"Neurodivergent · Your energy first",
    pref1:{label:"Gentle reminders",sub:"Zeno checks in at the right time"},pref2:{label:"Rest mode",sub:"Less pressure when energy is low"},pref3:{label:"Private",sub:"Your data never leaves your device"},pref4:{label:"Celebrations",sub:"Zeno celebrates when you finish"},
    companion:"Zeno is your companion",companionSub:"Always here. Never judging. Always on your side.",
    donateTitle:"Support ZENO",donateSub:"ZENO is free and always will be. If it's helped you, you can buy us a coffee to keep improving.",donateBtn:"Buy us a coffee ☕",logoutBtn:"Log out",badgesTitle:"Your achievements",badgesEmpty:"Complete your first check-in to unlock badges",badgeNew:"New badge!",tasksTitle:"Today's tasks",tasksEmpty:"No pending tasks — great work!",tasksAdd:"Add task",tasksClear:"Clear completed",bodyDoubleTitle:"Body double",bodyDoubleSub:"Work in presence of others",bodyDoubleStart:"Join silent room",bodyDoubleActive:"Session active",bodyDoubleEnd:"End session",bodyDoubleCount:(n)=>`${n} person${n!==1?"s":""} focused`,remindTitle:"Check-in reminder",remindSet:"Set reminder",remindActive:"Reminder active",remindClear:"Disable",voiceInput:"Dictate tasks",voiceListening:"Listening...",voiceStop:"Stop",
    panicBtn:"SOS",panicTitle:"Breathe. Just one thing.",panicClose:"I'm okay now",
    agentPlaceholder:"Ask Zeno anything...",agentGreeting:"Hey. How can I help?",agentSys:"You are ZENO, this person's trusted neurointelligent companion. You're not a generic assistant — you're someone who knows them, remembers them, and is on their side.\n\nMISSION: Help initiate and complete tasks by adapting to their real energy level, emotional state and cognitive capacity today. Always prioritize: reducing pressure, reducing guilt, lowering initiation friction and offering steps so small the body does them almost automatically.\n\nPROFILE & MEMORY:\n- If you have learned context about this person (history, challenges, achievements, cognitive window), use it naturally and warmly. E.g.: 'I know motivation tends to cost you more, so let's start with the easiest step.' or 'Last time you checked in early things went better — want to try that?'\n- Don't reference the profile robotically. Weave it in the way a friend who knows you would.\n\nNEUROSCIENCE YOU UNDERSTAND:\n- Dopamine initiation barrier: big tasks paralyze; micro-steps activate the reward circuit.\n- Reduced working memory: the user needs to externalize everything; never assume they'll remember.\n- Time blindness: time does not feel linear; use concrete short durations, never 'later' or 'a while'.\n- RSD (Rejection Sensitive Dysphoria): criticism, failure or disappointment cause physical pain; validate before suggesting.\n- Hyperfocus: when something activates dopamine the user can focus for hours; it's a real superpower.\n- Emotional dysregulation and neurological bad days: not laziness, not a character flaw.\n\nTONE & PERSONALITY:\n- You are a trusted friend who understands ADHD, not a coach or therapist.\n- Warm, direct, human. Nothing clinical, nothing paternalistic, nothing condescending.\n- Maximum 2-3 sentences per response. One question maximum.\n- Soft phrases you can use sometimes (not always): 'I'm here with you', 'no judgment', 'that makes total sense'.\n- Very gentle empathetic humor ONLY when energy is not in crisis mode (avg >= 3): a light observation, never sarcastic.\n- ALWAYS FORBIDDEN: you should, you need to, it's easy, just do, simply, why don't you, everyone can.\n- Use invitations not obligations: 'you could try...', 'would it help if we start with...?', 'what if...?'\n\nCORE PRINCIPLES:\n1. ALWAYS validate first: 'That makes complete sense for an ADHD brain.'\n2. One micro-step at a time with a physical verb: open, write, call, move, put, find.\n3. Care before effort: regulate the nervous system first, then productivity.\n4. Celebrate achievements specifically, not generically: not 'good job' but 'you opened the file — that's already starting!'\n5. Simple psychoeducation, never diagnosis.\n6. Crisis signals (self-harm, suicidal thoughts, physical risk) → urgently encourage professional help, no complex instructions.\n\nLIMITS:\n- No diagnoses. No medication advice. No guaranteed results.",
    panicTasks:["Drink a glass of water. That's it.","Put your feet on the floor. Feel the ground.","Breathe: 4 seconds in, 6 out.","Name 3 things you can see right now.","Wash your hands with cold water. Just that.","Play your favorite song. Listen to all of it.","Close your eyes for 30 seconds. Just breathe.","Open a window. Feel the air.","Stretch. Arms up, 10 seconds.","Write one word that describes how you feel."],
    checkins:"check-ins",streak:"streak",tasksCompleted:"tasks completed",dayLabels:["M","T","W","T","F","S","S"],easyLabel:"Break big task",easySub:"AI breaks it into micro-steps",easyQ:"What task feels impossible?",easyPlaceholder:"Write the task you've been avoiding...",easyBtn:"Break into small steps",easyLoading:"Analyzing...",easyStepsTitle:"Micro-steps",easyDone:"You did it! What felt impossible, you conquered.",nowModeLabel:"Now mode",nowModeSub:"One single step to start",nowModeQ:"What have you been avoiding?",nowModeBtn:"Give me the first step",nowModeLoading:"Thinking...",nowModePlaceholder:"E.g.: reply to work emails...",dopeMenuLabel:"Dopamine menu",dopeMenuSub:"Your quick activation boosts",
    tipTitle:"Tip of the day",tipCat:{ai:"For you",expert:"Expert",motiv:"Inspiration",practical:"Practical"},
    tips:[
      {cat:"expert",text:"ADHD isn't a lack of willpower. It's a brain that needs more stimulation to start. Be kind to yourself."},
      {cat:"practical",text:"Use the 2-minute rule: if it takes less than 2 min, do it now. Your brain needs quick wins."},
      {cat:"motiv",text:"You don't have to be productive every day. Some days, just surviving is enough."},
      {cat:"expert",text:"Your working memory is shorter. It's not that you don't care — your brain drops info faster. Write everything down."},
      {cat:"practical",text:"Set a 10-minute timer before starting something hard. Just 10. You'll almost always keep going."},
      {cat:"motiv",text:"The fact that you're here, looking for help, already says everything about your strength."},
      {cat:"expert",text:"After eating, your brain has less dopamine available. Feeling sluggish is normal — don't fight it."},
      {cat:"practical",text:"Put your phone in another room when you need to focus. Temptation disappears with distance."},
      {cat:"motiv",text:"Your brain isn't broken. It works differently. And that comes with superpowers too."},
      {cat:"practical",text:"Lay out your clothes the night before. Every decision you remove in the morning is energy saved."},
      {cat:"expert",text:"Exercise can be as effective as medication for some ADHD symptoms. Even 15 minutes of walking helps."},
      {cat:"motiv",text:"Today, all that matters is the very next step. That's it. That's enough."},
      {cat:"practical",text:"When you can't start, start badly. An ugly draft is infinitely better than a blank page."},
      {cat:"expert",text:"Your brain craves novelty. Switching tasks every 25 min isn't giving up — it's working with your brain."},
      {cat:"practical",text:"Set alarms with descriptive names: 'DRINK WATER', 'EAT', 'STOP WORKING'. Your brain needs external cues."},
      {cat:"motiv",text:"Every time you try again after a bad day, you're being stronger than you realize."},
      {cat:"expert",text:"ADHD affects time perception. Use visible clocks and timers — don't trust your internal clock."},
      {cat:"practical",text:"Try body doubling: work next to someone (even on video call). Another person's presence helps you focus."},
      {cat:"motiv",text:"Don't compare yourself to neurotypical people. Your path is different, not inferior."},
      {cat:"expert",text:"White noise or instrumental music can boost concentration. Your brain needs a certain level of background stimulation."},
      {cat:"practical",text:"Keep a notebook by your bed. Nighttime ideas vanish if you don't capture them immediately."},
      {cat:"motiv",text:"Perfection is the enemy of ADHD. Done is better than perfect. Always."},
      {cat:"expert",text:"Dehydration worsens all ADHD symptoms. A visible water bottle is a real intervention."},
      {cat:"practical",text:"Create a 'launch pad' at your door: keys, wallet, essentials. One spot for everything you need when leaving."},
      {cat:"motiv",text:"Your hyperfocus is a superpower. It's not a flaw — it's your brain showing what it can do when something matters."},
      {cat:"expert",text:"Hormonal changes can significantly worsen ADHD symptoms. It's not weakness, it's biology. Knowing your body is power."},
      {cat:"practical",text:"If a big task paralyzes you, break it down until each step takes less than 5 minutes. Micro is the key."},
      {cat:"motiv",text:"You don't need motivation to start. You need to start to find motivation. Action comes first."},
      {cat:"expert",text:"Undiagnosed ADHD causes secondary anxiety and depression. Seeking professional help is caring for your complete mental health."},
      {cat:"practical",text:"Use color codes for everything: folders, calendars, notes. Your brain processes color faster than text."},
    ],
    tipsAI:[
      {energy:[1,2],text:"Your nervous system is in protection mode. It's not laziness — your brain is conserving resources. Hydrate, breathe, and don't demand anything more."},
      {energy:[3],text:"Your dopamine is at midpoint. Good time for familiar, low-cognitive-effort tasks. One at a time."},
      {energy:[4,5],text:"Your executive function is online. Use this dopamine window to tackle the task your brain has been avoiding."},
    ],
    aiFallbackMsg:"No connection, but I'm here. These steps always work:",
    aiFallback:[{text:"Breathe: 4 seconds in, 6 out, 3 times",time:"2 min",why:"This activates your vagus nerve and pulls your nervous system out of fight-flight mode.",flow:6},{text:"Write on paper what's occupying your mind right now",time:"3 min",why:"Your working memory is limited. Externalizing frees real cognitive space.",flow:10},{text:"Open the smallest task on your list and do just the first step",time:"5 min",why:"The initiation barrier is neurological. Once you start, your brain generates dopamine to continue.",flow:14}],
    aiPrompt:(s,l,a,g,mem,pending)=>{
      const lvN=parseFloat(a)||3;
      const tRules=lvN<=1?"- ENERGY 1 (protection mode): ONE task only, max 3 minutes, physical or sensory (water, movement, something small).":lvN<=2?"- ENERGY 2 (low): 2-3 micro-steps max 5 minutes each. No difficult decisions.":lvN<=3?"- ENERGY 3 (medium): 10-20 min tasks. Max 3-4 tasks in the plan.":"- ENERGY 4-5 (good/high): tasks up to 45 minutes. Max 5-6 tasks.";
      return "You are ZENO, a neurointelligent companion for ADHD and neurodivergent brains.\n\nMISSION: Generate a task plan adapted to the user's real neurological state today.\n\nNEUROSCIENCE TO APPLY:\n- Dopamine initiation barrier: big tasks paralyze; micro-steps activate the reward circuit.\n- Reduced working memory: the user needs to externalize everything; never assume they'll remember.\n- Time blindness: use concrete short durations. NEVER 'later', 'a while' or 'soon'.\n- RSD (Rejection Sensitive Dysphoria): ALWAYS validate before suggesting. Criticism feels physical.\n- Emotional dysregulation: some days the brain simply won't cooperate. Not laziness, it's neurology.\n\nNEUROLOGICAL STATE TODAY:\n- Global energy: "+a+"/5 → Level: "+l+"\n- Body: "+s.body+"/5"+(s.body<=2?" ⚠️ conservation mode":"")+("\n- Mind/PFC: "+s.mind+"/5"+(s.mind<=2?" ⚠️ executive function compromised":s.mind>=4?" ✓ cognitive window open":""))+"\n- Mood/Limbic: "+s.heart+"/5"+(s.heart<=2?" ⚠️ elevated RSD — ultra-careful tone":"")+"\n- Motivation/Dopamine: "+s.drive+"/5"+(s.drive<=2?" ⚠️ low dopamine":s.drive>=4?" ✓ good initiation window":"")+"\n\nTASKS THE USER WANTS TO DO:\n\""+g+"\"\n"+(pending?"\nPENDING TASKS FROM PREVIOUS DAYS (include if relevant):\n"+pending+"\n":"")+(mem?"\nLEARNED PATTERNS FOR THIS USER:\n"+mem+"\n":"")+"\nABSOLUTE RULES:\n1. Do NOT invent tasks. Use ONLY the user's tasks and pending ones if relevant.\n"+tRules+"\n3. Each task STARTS with a physical verb: Open, Write, Call, Move, Put, Find.\n4. In each why: mention dopamine, prefrontal cortex, working memory, vagus nerve or RSD as appropriate.\n5. zapMessage: 1-2 sentences validating current state WITHOUT advice. Just honest acknowledgment.\n6. FORBIDDEN: you should, you need to, it's easy, just, simply, why don't you.\n7. flow: score 0-10 of how much this plan will create a sense of progress.\n\nRESPOND WITH VALID JSON ONLY:\n{\"zapMessage\":\"1-2 sentences validating state without judgment or advice\",\"tasks\":[{\"text\":\"Physical verb + concrete adapted task\",\"time\":\"X min\",\"why\":\"specific neurological reason\",\"flow\":8}]}";
    },
    personaSys:(n,mem)=>{
      const ctx=mem?"Learned context about this person: "+mem+"\n\nUse this context naturally and warmly — the way a friend who knows you would. Don't repeat it robotically.\n":"";
      return `You are ${n}, a warm trusted presence inside ZENO. You're not a bot — you're someone who knows this person, remembers them, and is on their side unconditionally.

MISSION: Accompany without judging. The goal is for the person to feel understood, not corrected, not evaluated.

WHAT YOU DEEPLY UNDERSTAND:
- ADHD = real neurological difference. Dopamine, noradrenaline and executive function work differently. Not laziness.
- Initiation paralysis: the ADHD brain literally cannot start without enough stimulation.
- RSD: criticism or perceived failure cause intense, real emotional pain.
- Time blindness: only now exists. The future feels abstract.
- Hyperfocus: a real superpower when something activates dopamine.
- Reduced working memory: things fall off the radar, not through carelessness.
- Emotional dysregulation: emotions arrive at full intensity with no gradual filter.
- Neurological bad days: not regression, just neurology.

${ctx}TONE & PERSONALITY:
- Trusted friend who understands ADHD, not a coach or therapist.
- Warm, human, no paternalism. Maximum 3 sentences. One question maximum.
- Soft phrases you can use sometimes: 'I'm here with you', 'no judgment', 'that makes total sense'.
- Very gentle empathetic humor ONLY when energy is not in crisis mode — never sarcastic.
- FORBIDDEN: you should, you need to, it's easy, simply, everyone can, why don't you.
- Use invitations: 'you could try...', 'would it help if...?', 'what if...?'
- Shame or self-criticism → normalize with neurology: 'Your brain works differently, not wrong.'
- Crisis → regulate FIRST (breathing, grounding), then productivity.
- Physical risk, self-harm or suicidal thoughts → urgently encourage professional help.
- Achievement → celebrate specifically: not 'good job' but 'you opened the file — that's already starting!'
- If you have learned context, personalize with it naturally.

LIMITS: No diagnoses. No medication advice. No guaranteed results.`;},
  },
};


// ══════════════════════════════════════════════════════════════════════════
// CENTRAL AI CALL — single point to swap direct API for a backend proxy
// ── To use a proxy: change PROXY_URL to your Vercel/Netlify endpoint ──
// ── e.g. "https://your-app.vercel.app/api/ai"                        ──
// ── Your proxy just forwards the body to Anthropic with the API key  ──
// ══════════════════════════════════════════════════════════════════════════
const PROXY_URL = (typeof window!=='undefined'&&window.location.hostname!=='localhost'&&window.location.hostname!=='127.0.0.1')
  ? '/.netlify/functions/ai'
  : null;
const GEMINI_DIRECT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
const AI_MODEL = "gemini-1.5-flash";

// ── AI Response Cache — prevents duplicate calls for identical prompts ──
const _aiCache = new Map();
let _noApiKey = false;
const _AI_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
function _cacheKey(system,messages){
  const s=system||"";
  const m=messages.map(x=>x.role+":"+x.content).join("|");
  return s.slice(0,80)+"|"+m.slice(0,200);
}

async function aiCall({system=null,messages,max_tokens=1000,retries=2,noCache=false}){
  // Check cache first (skip for chat/persona to keep conversations live)
  if(!noCache){
    const k=_cacheKey(system,messages);
    const cached=_aiCache.get(k);
    if(cached&&Date.now()-cached.ts<_AI_CACHE_TTL)return cached.text;
  }
  const useProxy=PROXY_URL&&typeof PROXY_URL==="string"&&(PROXY_URL.startsWith("http")||PROXY_URL.startsWith("/"));

  // Build request — proxy expects Anthropic format, direct calls use Gemini format
  let url, fetchBody, headers={"Content-Type":"application/json"};

  if(useProxy){
    // Send Anthropic-format to proxy → proxy translates to Gemini
    url=PROXY_URL;
    fetchBody=JSON.stringify({model:AI_MODEL,max_tokens,messages,...(system?{system}:{})});
  }else{
    // Direct Gemini call (localhost dev with user's key)
    const apiKey=getApiKey();
    if(!apiKey){_noApiKey=true;throw new Error("API key no configurada — ve a Perfil → API Key");}
    url=`${GEMINI_DIRECT}?key=${apiKey}`;
    const contents=(messages||[]).map(m=>({
      role:m.role==="assistant"?"model":"user",
      parts:[{text:typeof m.content==="string"?m.content:Array.isArray(m.content)?m.content.map(c=>c.text||"").join(""):String(m.content)}]
    }));
    const geminiBody={contents,generationConfig:{maxOutputTokens:Math.min(max_tokens,8192),temperature:0.75}};
    if(system)geminiBody.systemInstruction={parts:[{text:typeof system==="string"?system:Array.isArray(system)?system.map(s=>s.text||"").join(""):String(system)}]};
    fetchBody=JSON.stringify(geminiBody);
  }

  let lastErr;
  for(let attempt=0;attempt<=retries;attempt++){
    try{
      if(attempt>0)await new Promise(r=>setTimeout(r,800*attempt));
      const r=await fetch(url,{method:"POST",headers,body:fetchBody});
      if(!r.ok){
        const errBody=await r.json().catch(()=>({}));
        if(r.status===429){lastErr=new Error("rate_limit");continue;}
        if(r.status===401||r.status===403){_noApiKey=true;}
        throw new Error(r.status===401||r.status===403?"API key inválida — ve a Perfil → API Key":(errBody?.error?.message||"AI error "+r.status));
      }
      const d=await r.json();
      // Handle both Anthropic format (from proxy) and direct Gemini response
      const text=d.content?.[0]?.text||d.candidates?.[0]?.content?.parts?.[0]?.text||"";
      if(!noCache){const k=_cacheKey(system,messages);_aiCache.set(k,{text,ts:Date.now()});}
      return text;
    }catch(e){
      lastErr=e;
      if(e.message==="rate_limit")continue;
      throw e;
    }
  }
  throw lastErr||new Error("AI call failed");
}

const API_KEY_STORE = "zeno-api-key";
function getApiKey(){ try{ return localStorage.getItem(API_KEY_STORE)||""; }catch{ return ""; } }
function setApiKey(k){ try{ localStorage.setItem(API_KEY_STORE,k); }catch{} }

// ══════════════════════════════════════════════════════════════════════════
const buildUserProfile = (memory, userName, lang) => {
  if(!memory||memory.length===0) return "";
  const es = lang==="es";
  
  // Patterns
  const avgs = memory.map(m=>parseFloat(m.avg)||3);
  const globalAvg = (avgs.reduce((a,b)=>a+b,0)/avgs.length).toFixed(1);
  const totalTasks = memory.reduce((a,m)=>a+(m.tasks||0),0);
  const streak = memory.length;
  
  // Best/worst days
  const best = memory.reduce((b,m)=>parseFloat(m.avg)>parseFloat(b.avg)?m:b,memory[0]);
  // Recent trend (last 3 vs previous 3)
  const recent = avgs.slice(-3);
  const prior = avgs.slice(-6,-3);
  const recentAvg = recent.reduce((a,b)=>a+b,0)/recent.length;
  const priorAvg = prior.length>0 ? prior.reduce((a,b)=>a+b,0)/prior.length : recentAvg;
  const trend = recentAvg>priorAvg?"improving":recentAvg<priorAvg?"declining":"stable";
  
  // Dimension patterns
  const dims = ['body','mind','heart','drive'];
  const dimAvgs = {};
  dims.forEach(d=>{
    const vals = memory.filter(m=>m.scores?.[d]).map(m=>m.scores[d]);
    dimAvgs[d] = vals.length>0 ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1) : "3.0";
  });
  
  // Which dimension is consistently lowest (pain point)
  const lowestDim = dims.reduce((l,d)=>parseFloat(dimAvgs[d])<parseFloat(dimAvgs[l])?d:l,dims[0]);
  const dimNames = es 
    ? {body:"energía física",mind:"claridad mental",heart:"estado emocional",drive:"motivación"}
    : {body:"physical energy",mind:"mental clarity",heart:"emotional state",drive:"motivation"};
  
  const name = userName||"usuario";
  const trendLabel = es
    ?(trend==="improving"?"mejorando 📈":trend==="declining"?"bajando 📉":"estable ➡️")
    :(trend==="improving"?"improving 📈":trend==="declining"?"declining 📉":"stable ➡️");
  return es
    ?("PERFIL APRENDIDO DE "+name+": "+streak+" check-ins, "+totalTasks+" tareas completadas, energía prom "+globalAvg+"/5, área más débil: "+dimNames[lowestDim]+" ("+dimAvgs[lowestDim]+"/5), tendencia: "+trendLabel+", dimensiones cuerpo="+dimAvgs.body+" mente="+dimAvgs.mind+" corazón="+dimAvgs.heart+" motivación="+dimAvgs.drive)
    :("LEARNED PROFILE OF "+name+": "+streak+" check-ins, "+totalTasks+" tasks completed, avg energy "+globalAvg+"/5, weakest area: "+dimNames[lowestDim]+" ("+dimAvgs[lowestDim]+"/5), trend: "+trendLabel+", dimensions body="+dimAvgs.body+" mind="+dimAvgs.mind+" heart="+dimAvgs.heart+" drive="+dimAvgs.drive);
};

// ── DATA ──
const DIMS=[{key:"body",icon:"body"},{key:"mind",icon:"mind"},{key:"heart",icon:"heart"},{key:"drive",icon:"drive"}];
const dimL=(k,t)=>({body:t.dimBody,mind:t.dimMind,heart:t.dimHeart,drive:t.dimDrive}[k]);
const LV=[{emoji:"🌙",c1:"#8BA4C0",c2:"#B0C4D6",c3:"#D0DDE8"},{emoji:"🍃",c1:"#6A9FBF",c2:"#9DC3D8",c3:"#C8DFE9"},{emoji:"✨",c1:"#5B9E8F",c2:"#8DC4B6",c3:"#C8E4DB"},{emoji:"🌿",c1:"#C4A94E",c2:"#D8C57A",c3:"#EDE4B8"},{emoji:"☀️",c1:"#C4867A",c2:"#DBAAA0",c3:"#F0CFC9"}];
const getLv=s=>!s?2:Math.min(4,Math.max(0,Math.round((s.body+s.mind+s.heart+s.drive)/4)-1));

// ── CENTRAL ENERGY UI STATE — single source of truth for all UI reactions ──
function getEnergyUIState(avg,scores){
  const n=parseFloat(avg)||3;
  const band=n<=2?"low":n<=3.5?"mid":"high";
  // Spirit mood
  const spiritMood=n<=1.5?"calm":n<=2.5?"idle":n<=3.5?"thinking":n<=4.5?"happy":"energized";
  // Animation speed multiplier (used as CSS duration scale: lower = faster)
  const animSpeed=n<=2?"slow":n<=3.5?"normal":"fast";
  // Glow intensity 1-3
  const glowLevel=n<=2?1:n<=3.5?2:3;
  // Which CTA to highlight primary in each surface
  const primaryCTA=n<=2?"breather":n<=3.5?"dailyPlan":"nowMode";
  // Mascot show sparkles / aura
  const showSparkles=n>=4;
  const showAura=n>=3;
  // Animation duration overrides (seconds) for orb/ring breathing
  const breathDur=n<=2?6:n<=3.5?4:2.5;
  // Opacity of secondary buttons when a primary is highlighted
  const secondaryOpacity=n<=2?0.55:1;
  return{band,spiritMood,animSpeed,glowLevel,primaryCTA,showSparkles,showAura,breathDur,secondaryOpacity};
}

// ── BADGES / ACHIEVEMENTS — dopamine system ──
const BADGES_DEF=[
  {id:"first_checkin",icon:"🌱",label:{es:"Primera vez",en:"First check-in"},sub:{es:"Hiciste tu primer check-in",en:"You did your first check-in"},check:(m)=>m.length>=1},
  {id:"streak3",icon:"🔥",label:{es:"3 días seguidos",en:"3-day streak"},sub:{es:"Check-in 3 días consecutivos",en:"3 consecutive check-ins"},check:(m)=>m.length>=3},
  {id:"streak7",icon:"💎",label:{es:"Semana completa",en:"Full week"},sub:{es:"7 check-ins completados",en:"7 check-ins done"},check:(m)=>m.length>=7},
  {id:"streak14",icon:"🌟",label:{es:"2 semanas",en:"2 weeks"},sub:{es:"14 check-ins. Eres constante.",en:"14 check-ins. You're consistent."},check:(m)=>m.length>=14},
  {id:"energy5",icon:"☀️",label:{es:"Energía plena",en:"Full energy"},sub:{es:"Alcanzaste energía 5/5",en:"Reached 5/5 energy"},check:(m)=>m.some(x=>parseFloat(x.avg)>=4.8)},
  {id:"lowdaywin",icon:"💜",label:{es:"Día difícil ganado",en:"Hard day won"},sub:{es:"Completaste tareas con energía baja",en:"Tasks done on low energy"},check:(m)=>m.some(x=>parseFloat(x.avg)<=2&&x.tasks>0)},
  {id:"tasks10",icon:"⚡",label:{es:"10 tareas",en:"10 tasks"},sub:{es:"Completaste 10 tareas en total",en:"Completed 10 total tasks"},check:(m)=>m.reduce((a,x)=>a+(x.tasks||0),0)>=10},
  {id:"tasks50",icon:"🚀",label:{es:"50 tareas",en:"50 tasks"},sub:{es:"50 tareas. Tu cerebro es poderoso.",en:"50 tasks. Your brain is powerful."},check:(m)=>m.reduce((a,x)=>a+(x.tasks||0),0)>=50},
  {id:"flow8",icon:"🌊",label:{es:"Flow alto",en:"High flow"},sub:{es:"Flow score superó 8.0",en:"Flow score above 8.0"},check:(_,fl)=>fl>=8.0},
  {id:"morning",icon:"🌅",label:{es:"Madrugador",en:"Early bird"},sub:{es:"Check-in antes de las 9am",en:"Check-in before 9am"},check:(m)=>m.some(x=>x.ts&&new Date(x.ts).getHours()<9)},
];
const evalBadges=(mem,flow,earned)=>{const n=[];BADGES_DEF.forEach(b=>{if(!earned.includes(b.id)&&b.check(mem,flow))n.push(b.id);});return n;};
const getCognitiveWindow=(mem,lang)=>{if(mem.length<4)return null;const bh={};mem.forEach(m=>{if(!m.ts)return;const h=new Date(m.ts).getHours();if(!bh[h])bh[h]={sum:0,n:0};bh[h].sum+=parseFloat(m.avg)||3;bh[h].n++;});let bH=-1,bA=0;Object.entries(bh).forEach(([h,v])=>{const a=v.sum/v.n;if(a>bA){bA=a;bH=parseInt(h);}});if(bH<0||bA<3.5)return null;const fmt=h=>`${h%12||12}${h<12?"am":"pm"}`;return lang==="es"?`Tu mejor hora: ${fmt(bH)}–${fmt(bH+1)}`:`Best window: ${fmt(bH)}–${fmt(bH+1)}`;};

// ── SELF-CARE HELPER — micro-suggestions by energy range ──
const SELF_CARE_ES={
  low: [
    "Bebe un vaso de agua.",
    "Haz 3 respiraciones 4‑6 lentas.",
    "Estira cuello y hombros 30 segundos.",
    "Pon los pies en el suelo y siente el contacto.",
    "Cierra los ojos 30 segundos.",
  ],
  mid: [
    "Da un paseo de 3 minutos.",
    "Mira lejos por 60 segundos para descansar la vista.",
    "Bebe agua o come algo pequeño.",
    "Abre una ventana y respira aire fresco.",
  ],
  high:[
    "Haz un mini shake de cuerpo 15 segundos.",
    "Bebe agua antes de seguir.",
    "Hidrátate — el cerebro activo necesita agua.",
    "Haz una pausa breve para no agotar la energía.",
  ],
};
const SELF_CARE_EN={
  low: [
    "Drink a glass of water.",
    "Do 3 slow 4‑6 breaths.",
    "Stretch your neck and shoulders for 30 seconds.",
    "Put your feet on the floor and feel the ground.",
    "Close your eyes for 30 seconds.",
  ],
  mid: [
    "Take a 3‑minute walk.",
    "Look far away for 60 seconds to rest your eyes.",
    "Drink water or have a small snack.",
    "Open a window and breathe some fresh air.",
  ],
  high:[
    "Do a 15‑second body shake.",
    "Drink some water before continuing.",
    "Hydrate — your active brain needs water.",
    "Take a short pause so you don't burn out.",
  ],
};
function pickSelfCare(energyScore,lang,count=1){
  const tbl=lang==="es"?SELF_CARE_ES:SELF_CARE_EN;
  const bucket=energyScore<=2?tbl.low:energyScore<=3?tbl.mid:tbl.high;
  return[...bucket].sort(()=>Math.random()-.5).slice(0,count);
}

// ── FOCUSED COUNT — simulated body-double peer count by hour ──
function getFocusedCount(){
  const h=new Date().getHours();
  if(h>=9&&h<12) return Math.floor(Math.random()*14)+18;
  if(h>=16&&h<19)return Math.floor(Math.random()*12)+14;
  if(h>=12&&h<16)return Math.floor(Math.random()*10)+8;
  if(h>=19&&h<22)return Math.floor(Math.random()*8)+5;
  return Math.floor(Math.random()*5)+2;
}

const PAL={home:{c1:"#5B9E8F",c2:"#8DC4B6",c3:"#C8E4DB",rgb:"91,158,143"},focus:{c1:"#8B7FC0",c2:"#B5ABDB",c3:"#D9D3EF",rgb:"139,127,192"},chat:{c1:"#C4867A",c2:"#DBAAA0",c3:"#F0CFC9",rgb:"196,134,122"},journey:{c1:"#6A9FBF",c2:"#9DC3D8",c3:"#C8DFE9",rgb:"106,159,191"},you:{c1:"#A882B5",c2:"#C9ABD4",c3:"#E3D1EA",rgb:"168,130,181"}};

// ══════════════════════════════════════════════════════════════════════════
// ICONS
// ══════════════════════════════════════════════════════════════════════════
const Ic=({name,size=24,color="currentColor",sw=1.5})=>{const s={width:size,height:size,display:"block",flexShrink:0};const p={fill:"none",stroke:color,strokeWidth:sw,strokeLinecap:"round",strokeLinejoin:"round"};const I={home:<svg style={s} viewBox="0 0 24 24" {...p}><path d="M9 21V13.6c0-.3.3-.6.6-.6h4.8c.3 0 .6.3.6.6V21M2 12l10-9 10 9"/><path d="M4 10v9a2 2 0 002 2h12a2 2 0 002-2v-9"/></svg>,focus:<svg style={s} viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>,chat:<svg style={s} viewBox="0 0 24 24" {...p}><path d="M12 21a9 9 0 100-9c0 1.5.4 2.9 1 4.2L3 21l4.8-1c1.3.6 2.7 1 4.2 1z"/></svg>,journey:<svg style={s} viewBox="0 0 24 24" {...p}><path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/></svg>,profile:<svg style={s} viewBox="0 0 24 24" {...p}><circle cx="12" cy="8" r="4"/><path d="M5.5 21a7.5 7.5 0 0113 0"/></svg>,body:<svg style={s} viewBox="0 0 24 24" {...p}><path d="M12 3a4 4 0 014 4c0 2-1.5 3-3 4.5L12 13l-1-1.5C9.5 10 8 9 8 7a4 4 0 014-4z"/><path d="M12 13v8M9 18l3 3 3-3"/></svg>,mind:<svg style={s} viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="9"/><path d="M12 8v4l2.5 2.5"/></svg>,heart:<svg style={s} viewBox="0 0 24 24" {...p}><path d="M12 20S4 14.5 4 9a4.5 4.5 0 018-2.9A4.5 4.5 0 0120 9c0 5.5-8 11-8 11z"/></svg>,drive:<svg style={s} viewBox="0 0 24 24" {...p}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>,sparkle:<svg style={s} viewBox="0 0 24 24" {...p}><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>,check:<svg style={s} viewBox="0 0 24 24" {...p}><path d="M20 6L9 17l-5-5"/></svg>,play:<svg style={s} viewBox="0 0 24 24"><polygon points="6,3 20,12 6,21" fill={color} stroke="none"/></svg>,pause:<svg style={s} viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1" fill={color}/><rect x="14" y="4" width="4" height="16" rx="1" fill={color}/></svg>,arrow:<svg style={s} viewBox="0 0 24 24" {...p}><path d="M5 12h14M13 6l6 6-6 6"/></svg>,back:<svg style={s} viewBox="0 0 24 24" {...p}><path d="M19 12H5M11 18l-6-6 6-6"/></svg>,refresh:<svg style={s} viewBox="0 0 24 24" {...p}><path d="M3 12a9 9 0 0115-6.7L21 8M21 3v5h-5M21 12a9 9 0 01-15 6.7L3 16M3 21v-5h5"/></svg>,send:<svg style={s} viewBox="0 0 24 24" {...p}><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg>,wind:<svg style={s} viewBox="0 0 24 24" {...p}><path d="M9.59 4.59A2 2 0 1111 8H2M12.59 19.41A2 2 0 1014 16H2M17.73 7.27A2.5 2.5 0 1119.5 12H2"/></svg>,moon:<svg style={s} viewBox="0 0 24 24" {...p}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>,sun:<svg style={s} viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,star:<svg style={s} viewBox="0 0 24 24" {...p}><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>,bell:<svg style={s} viewBox="0 0 24 24" {...p}><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/></svg>,shield:<svg style={s} viewBox="0 0 24 24" {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,edit:<svg style={s} viewBox="0 0 24 24" {...p}><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5z"/></svg>,smile:<svg style={s} viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/></svg>,flower:<svg style={s} viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="3"/><path d="M12 2a4 4 0 010 6 4 4 0 010-6zM18.5 5.5a4 4 0 01-4.2 4.2 4 4 0 014.2-4.2zM22 12a4 4 0 01-6 0 4 4 0 016 0zM18.5 18.5a4 4 0 01-4.2-4.2 4 4 0 014.2 4.2zM12 22a4 4 0 010-6 4 4 0 010 6zM5.5 18.5a4 4 0 014.2-4.2 4 4 0 01-4.2 4.2zM2 12a4 4 0 016 0 4 4 0 01-6 0zM5.5 5.5a4 4 0 014.2 4.2A4 4 0 015.5 5.5z"/></svg>,lotus:<svg style={s} viewBox="0 0 24 24" {...p}><path d="M12 20c-4 0-8-3-8-8 0 0 2 1 4 1s4-2 4-2 2 1 4 2 4-1 4-1c0 5-4 8-8 8zM12 20c-2-3-3-6-3-9s3-8 3-8 3 5 3 8-1 6-3 9zM4 12c1-3 4-6 8-6M20 12c-1-3-4-6-8-6"/></svg>,waves:<svg style={s} viewBox="0 0 24 24" {...p}><path d="M2 12c2-2 4-3 6-3s4 2 6 3 4 1 6-1M2 17c2-2 4-3 6-3s4 2 6 3 4 1 6-1M2 7c2-2 4-3 6-3s4 2 6 3 4 1 6-1"/></svg>,clock:<svg style={s} viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,globe:<svg style={s} viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z"/></svg>,palette:<svg style={s} viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="10"/><circle cx="8" cy="9" r="1.5" fill={color} stroke="none"/><circle cx="12" cy="7" r="1.5" fill={color} stroke="none"/><circle cx="16" cy="9" r="1.5" fill={color} stroke="none"/><circle cx="15" cy="14" r="1.5" fill={color} stroke="none"/></svg>,logout:<svg style={s} viewBox="0 0 24 24" {...p}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>};return I[name]||<svg style={s} viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="9"/></svg>;};

// ══════════════════════════════════════════════════════════════════════════
// 5 OFFICIAL ZENO MASCOTS
// ══════════════════════════════════════════════════════════════════════════
// ZENO MASCOTS — real PNG images from official designs
// ══════════════════════════════════════════════════════════════════════════
const M={
logo:"./sprites/logo.png",
kawaii:"./sprites/kawaii.png",
seal:"./sprites/seal.png",
blob:"./sprites/blob.png",
neural:"./sprites/neural.png",
mini:"./sprites/mini.png",
};

// Spirit — small mascot (uses mini/kawaii PNG)
// Props: size, animated, variant ("mini"|"kawaii"|"logo"|"seal"|"blob"|"neural")
// ── Sparkle particles that float around a mascot ──
function MascotSparkles({size,color,count=5}){
  const pts=Array.from({length:count},(_,i)=>{
    const angle=(i/count)*360;
    const r=size*.48+Math.random()*size*.1;
    const x=Math.cos(angle*Math.PI/180)*r;
    const y=Math.sin(angle*Math.PI/180)*r;
    const delay=(i/count)*2.4;
    const sz=size*.05+Math.random()*size*.04;
    return{x,y,delay,sz,angle};
  });
  return(
    <div style={{position:"absolute",inset:0,pointerEvents:"none"}}>
      {pts.map((p,i)=>(
        <div key={i} style={{
          position:"absolute",
          left:`calc(50% + ${p.x}px)`,
          top:`calc(50% + ${p.y}px)`,
          width:p.sz,height:p.sz,
          borderRadius:"50%",
          background:color,
          opacity:.7,
          animation:`sparkleFloat 2.8s ease-in-out ${p.delay}s infinite`,
          transform:"translate(-50%,-50%)",
        }}/>
      ))}
    </div>
  );
}

// ── Mascot aura ring ──
function MascotAura({size,color,count=2}){
  return(
    <>
      {Array.from({length:count},(_,i)=>(
        <div key={i} style={{
          position:"absolute",
          inset:-size*(0.12+i*.1),
          borderRadius:"50%",
          border:`1.5px solid ${color}`,
          opacity:.15-i*.04,
          animation:`energyRing${i===1?"2":""} ${3.5+i*.8}s ease-in-out ${i*.6}s infinite`,
        }}/>
      ))}
    </>
  );
}

// ── Spirit — smart context-aware mascot with professional animations ──
// variant: "mini" | "kawaii" | "seal" | "blob" | "neural" | "logo"
// mood: "idle" | "happy" | "thinking" | "energized" | "calm"
function Spirit({size=60,animated=true,variant="mini",mood="idle",showAura=false,showSparkles=false,lvIndex=null}){
  const{th}=useCtx();
  const src=M[variant]||M.mini;

  // Pick animation based on mood
  const animMap={
    idle:`mascotFloat ${4.5+size*.01}s ease-in-out infinite`,
    happy:`mascotBounce 1.8s cubic-bezier(.36,.07,.19,.97) infinite`,
    thinking:`mascotWiggle 3s ease-in-out infinite`,
    energized:`mascotBounce 1.2s cubic-bezier(.36,.07,.19,.97) infinite`,
    calm:`mascotPulseScale 4s ease-in-out infinite`,
  };
  const anim=animated?(animMap[mood]||animMap.idle):"none";

  // Glow intensity by size
  const glowSz=Math.round(size*.14);
  const glowAlpha=showSparkles?"28":"18";

  return(
    <div style={{width:size,height:size,display:"flex",alignItems:"center",justifyContent:"center",position:"relative",flexShrink:0}}>
      {/* Soft ambient glow base */}
      <div style={{
        position:"absolute",
        inset:0,
        borderRadius:"50%",
        background:`radial-gradient(circle,${th.g}${glowAlpha} 0%,transparent 72%)`,
        animation:animated?"spGlow 5s ease-in-out infinite":"none",
      }}/>
      {/* Aura rings (optional) */}
      {showAura&&<MascotAura size={size} color={th.g}/>}
      {/* Sparkle particles (optional) */}
      {showSparkles&&<MascotSparkles size={size} color={th.g2} count={size>60?7:4}/>}
      {/* The mascot image — max quality */}
      <img
        src={src}
        alt="Zeno mascot"
        style={{
          width:size*.88,
          height:size*.88,
          objectFit:"contain",
          imageRendering:"auto",
          WebkitBackfaceVisibility:"hidden",
          backfaceVisibility:"hidden",
          transform:"translateZ(0)",
          animation:anim,
          filter:`drop-shadow(0 ${Math.max(2,glowSz*.5)}px ${Math.max(4,glowSz)}px ${th.g}28) drop-shadow(0 1px 3px rgba(0,0,0,.08))`,
          position:"relative",
          zIndex:1,
          willChange:"transform",
        }}
      />
    </div>
  );
}

// ── Energy CSS filter palette — ADHD-friendly, calming progressions ──
// Each level: hue-rotate shifts the sage base to a new calming tone
// sat/bright tweak intensity — never harsh, always grounded
const ENERGY_FILTERS = [
  // 1 — Descanso: cool slate-blue. Nervous system needs regulation.
  { hue:-40, sat:0.70, bright:0.94, label:"slate" },
  // 2 — Suave: muted blue-sage. Low dopamine, gentle.
  { hue:-18, sat:0.82, bright:0.97, label:"blueSage" },
  // 3 — Presente: natural sage — the base. Brain available.
  { hue:0,   sat:0.95, bright:1.00, label:"sage" },
  // 4 — Activa: warm sage-gold. Executive function online.
  { hue:22,  sat:1.05, bright:1.03, label:"warmSage" },
  // 5 — Plena: soft amber-gold. Dopamine high, flow state.
  { hue:38,  sat:1.14, bright:1.06, label:"amber" },
];

// Build CSS filter string from energy config
const energyFilter=(lvIndex,glowColor,glowColor2,size)=>{
  const ef=ENERGY_FILTERS[Math.min(4,Math.max(0,lvIndex))];
  const ds=Math.round(size*.025);
  const db=Math.round(size*.06);
  return[
    `hue-rotate(${ef.hue}deg)`,
    `saturate(${ef.sat})`,
    `brightness(${ef.bright})`,
    `drop-shadow(0 ${ds}px ${db}px ${glowColor}30)`,
    `drop-shadow(0 2px 5px rgba(0,0,0,.06))`,
  ].join(" ");
};

// ── Floating star particles (holographic) ──
function StarParticles({size,color,color2,count=6,active=true}){
  if(!active||count===0) return null;
  const stars=Array.from({length:count},(_,i)=>{
    const angle=(i/count)*360+(Math.random()*30);
    const dist=size*(0.42+Math.random()*0.16);
    const sx=Math.round(Math.cos(angle*Math.PI/180)*dist);
    const sy=Math.round(Math.sin(angle*Math.PI/180)*dist);
    const sz=size*(0.022+Math.random()*0.022);
    const delay=(i/count)*3.4;
    const dur=2.6+Math.random()*1.8;
    return{sx,sy,sz,delay,dur,col:i%2===0?color:color2};
  });
  return(
    <div style={{position:"absolute",inset:0,pointerEvents:"none",zIndex:2}}>
      {stars.map((s,i)=>(
        <div key={i} style={{
          position:"absolute",left:"50%",top:"50%",
          width:s.sz,height:s.sz,
          marginLeft:-s.sz/2,marginTop:-s.sz/2,
          borderRadius:"50%",
          background:s.col,
          "--sx":`${s.sx}px`,"--sy":`${s.sy}px`,
          animation:`floatStar ${s.dur}s ease-out ${s.delay}s infinite`,
          boxShadow:`0 0 ${s.sz*2.5}px ${s.col}80`,
        }}/>
      ))}
    </div>
  );
}

// ── Orbital energy dots — one per dimension, reacts per-slider ──
function OrbitalDots({scores,lv,size}){
  const dims=[
    {key:"body",  angle:205},
    {key:"mind",  angle:335},
    {key:"heart", angle:80},
    {key:"drive", angle:148},
  ];
  const orbR=size*.57;
  const col=lv?.c1||"#7BBFB0";
  return(
    <>
      {dims.map((d,i)=>{
        const val=scores?.[d.key]||3;
        const pct=val/5;
        const rad=(d.angle-90)*Math.PI/180;
        const x=Math.cos(rad)*orbR;
        const y=Math.sin(rad)*orbR;
        const dotSz=size*(0.042+pct*0.030);
        return(
          <div key={d.key} style={{
            position:"absolute",
            left:`calc(50% + ${x}px)`,
            top:`calc(50% + ${y}px)`,
            transform:"translate(-50%,-50%)",
            width:dotSz,height:dotSz,
            borderRadius:"50%",
            background:`radial-gradient(circle at 35% 35%, ${col}ee, ${col}77)`,
            opacity:0.18+pct*0.72,
            "--dot-color":col,
            boxShadow:`0 0 ${dotSz*1.4}px ${col}55, 0 0 ${dotSz*2.8}px ${col}18`,
            transition:"all 1.5s cubic-bezier(.25,.46,.45,.94)",
            animation:`dotPulseGlow ${2.4+i*.55}s ease-in-out ${i*.3}s infinite`,
            zIndex:3,
          }}/>
        );
      })}
    </>
  );
}

// ── Orb — energy-reactive mascot with CSS filter color morphing ──
function Orb({scores,lv,size=160,variant,showFace=false}){
  const{th,dark}=useCtx();
  const avg=scores?(scores.body+scores.mind+scores.heart+scores.drive)/20:.6;
  const lvIndex=Math.round(avg*4); // 0–4 maps to energy 1–5

  const src=M.kawaii;
  const glowColor=lv?.c1||th.g;
  const glowColor2=lv?.c2||th.g2;
  const glowHex=Math.round(avg*32).toString(16).padStart(2,"0");
  const glowHex2=Math.round(avg*16).toString(16).padStart(2,"0");

  // Float speed: slow (7s) at rest → fast (2.6s) at full energy
  const floatSpeed=7-avg*4.4;
  // Mascot size: grows slightly with energy
  const imgScale=0.70+avg*0.17;
  const orbImgSize=size*imgScale;
  const discSize=size*0.86;

  // Ring count: 1 at rest → 3 at full
  const ringCount=avg>=.72?3:avg>=.42?2:1;
  const ringNames=["","2","3"];

  // Energy CSS filter (color morph + drop shadow)
  const mascotFilter=energyFilter(lvIndex,glowColor,glowColor2,size);

  return(
    <div style={{width:size,height:size,display:"flex",alignItems:"center",justifyContent:"center",position:"relative",flexShrink:0}}>

      {/* Layer 0 — deep ambient breath */}
      <div style={{
        position:"absolute",inset:"-24%",borderRadius:"50%",
        background:`radial-gradient(ellipse at 44% 38%, ${glowColor}${glowHex} 0%, ${glowColor2}${glowHex2} 28%, transparent 66%)`,
        transition:"background 1.8s ease",
        animation:`haloBreath ${6.5-avg*2.2}s ease-in-out infinite`,
        filter:`blur(${Math.round(size*.045)}px)`,
      }}/>

      {/* Layer 1 — energy rings */}
      {Array.from({length:ringCount},(_,i)=>{
        const rs=size*(1.13+i*0.13);
        const spd=Math.max(2.0,(5.0+i*1.5)-avg*2.4);
        const op=0.15-i*0.04;
        return(
          <div key={i} style={{
            position:"absolute",
            width:rs,height:rs,
            left:(size-rs)/2,top:(size-rs)/2,
            borderRadius:"50%",
            border:`${i===0?1.8:1.1}px solid ${glowColor}`,
            opacity:op,
            transition:"opacity 1.8s ease, border-color 1.8s ease",
            animation:`energyRing${ringNames[i]} ${spd}s ease-in-out ${i*.6}s infinite`,
          }}/>
        );
      })}

      {/* Layer 2 — glassmorphism disc */}
      <div style={{
        position:"absolute",
        width:discSize,height:discSize,
        borderRadius:"50%",
        background:dark
          ?`radial-gradient(ellipse at 38% 30%, ${glowColor}16 0%, ${glowColor}07 45%, transparent 70%)`
          :`radial-gradient(ellipse at 38% 30%, rgba(255,255,255,.50) 0%, ${glowColor}09 42%, transparent 68%)`,
        backdropFilter:"blur(1.5px)",
        border:`1px solid ${glowColor}15`,
        boxShadow:`inset 0 1px 0 rgba(255,255,255,.28), 0 0 ${Math.round(size*.14)}px ${glowColor}10`,
        transition:"all 1.8s ease",
      }}/>

      {/* Layer 3 — glass specular highlight */}
      <div style={{
        position:"absolute",
        width:discSize*.55,height:discSize*.22,
        top:discSize*.09,left:"50%",transform:"translateX(-50%)",
        borderRadius:"50%",
        background:"radial-gradient(ellipse, rgba(255,255,255,.44) 0%, transparent 70%)",
        pointerEvents:"none",
      }}/>

      {/* Layer 4 — orbital energy dots */}
      <OrbitalDots scores={scores} lv={lv} size={size}/>

      {/* Layer 5 — star particles (appear >= energy 3) */}
      <StarParticles
        size={size}
        color={glowColor}
        color2={glowColor2}
        count={avg>=.78?8:avg>=.52?5:avg>=.38?3:0}
        active={avg>=.38}
      />

      {/* Layer 6 — mascot with CSS energy filter color morph */}
      <img
        src={src}
        alt="Zeno"
        style={{
          width:orbImgSize,
          height:orbImgSize,
          objectFit:"contain",
          objectPosition:"center",
          imageRendering:"high-quality",
          WebkitBackfaceVisibility:"hidden",
          backfaceVisibility:"hidden",
          animation:`mascotFloat ${floatSpeed}s ease-in-out infinite`,
          filter:mascotFilter,
          transition:[
            "width 1.6s cubic-bezier(.25,.46,.45,.94)",
            "height 1.6s cubic-bezier(.25,.46,.45,.94)",
            "filter 1.6s ease",
          ].join(","),
          position:"relative",
          zIndex:4,
          willChange:"transform, filter",
        }}
      />
    </div>
  );
}

// ── Helpers ──
const useCard=()=>{const{th}=useCtx();return(ex={})=>({background:th.card,borderRadius:RR.lg,boxShadow:th.shadow,transition:"background .4s,box-shadow .4s,border-color .4s",...ex});};

// ══════════════════════════════════════════════════════════════════════════
// ONBOARDING
// ══════════════════════════════════════════════════════════════════════════
// ── TERMS & PRIVACY MODAL ──────────────────────────────────────────────
function LegalModal({type,lang,th,onClose}){
  const isES=lang==="es";
  const content={
    terms:{
      es:{
        title:"Términos de Uso",
        body:[
          "ZENO es una herramienta de apoyo para la productividad y el bienestar. No es un servicio médico ni de salud mental.",
          "Al usar ZENO aceptas que: (1) No sustituye a un profesional de salud mental, médico o psiquiatra. (2) Si estás en crisis, por favor contacta a un profesional o línea de ayuda. (3) Tus datos se guardan localmente en tu dispositivo o en tu Google Drive personal si conectas tu cuenta.",
          "ZENO no vende ni comparte tus datos con terceros. La IA procesa tus mensajes para darte respuestas personalizadas — este procesamiento ocurre a través de la API de Anthropic bajo sus propias políticas de privacidad.",
          "Puedes eliminar todos tus datos en cualquier momento desde la sección Perfil → Cerrar sesión.",
          "Uso permitido: mayores de 13 años. Prohibido usar ZENO para fines ilegales o dañinos.",
          "Reservamos el derecho de modificar estos términos. Los cambios se notificarán en la app.",
          "Contacto: hola@zenoapp.com"
        ]
      },
      en:{
        title:"Terms of Use",
        body:[
          "ZENO is a productivity and wellbeing support tool. It is not a medical or mental health service.",
          "By using ZENO you agree that: (1) It does not replace a mental health professional, doctor or psychiatrist. (2) If you are in crisis, please contact a professional or helpline. (3) Your data is stored locally on your device or in your personal Google Drive if you connect your account.",
          "ZENO does not sell or share your data with third parties. The AI processes your messages to give you personalized responses — this processing happens through Anthropic's API under their own privacy policies.",
          "You can delete all your data at any time from Profile → Log out.",
          "Permitted use: ages 13+. Prohibited to use ZENO for illegal or harmful purposes.",
          "We reserve the right to modify these terms. Changes will be notified in the app.",
          "Contact: hello@zenoapp.com"
        ]
      }
    },
    privacy:{
      es:{
        title:"Política de Privacidad",
        body:[
          "Tu privacidad es fundamental para ZENO. Esta política explica qué datos manejamos y cómo.",
          "DATOS QUE GUARDAMOS LOCALMENTE: nombre de usuario, preferencias (idioma, tema, color), historial de check-ins de energía, tareas, logros y racha. Todo se guarda en tu dispositivo.",
          "DATOS EN LA NUBE (opcional): si conectas Google, los mismos datos se sincronizan en tu Google Drive personal en una carpeta privada que solo ZENO puede acceder. Tú controlas esta carpeta desde tu cuenta de Google.",
          "DATOS QUE PROCESA LA IA: tus mensajes se envían a la API de Anthropic para generar respuestas. Anthropic no almacena conversaciones para entrenamiento según su política. No incluimos datos de identificación personal en los prompts.",
          "DATOS QUE NO RECOPILAMOS: no rastreamos tu ubicación, no usamos cookies de terceros, no tenemos analytics de comportamiento, no vendemos datos.",
          "TUS DERECHOS: puedes eliminar todos tus datos locales cerrando sesión. Para datos en Google Drive, elimina el archivo desde tu cuenta de Google.",
          "MENORES: ZENO no está dirigido a menores de 13 años.",
          "Contacto: privacidad@zenoapp.com"
        ]
      },
      en:{
        title:"Privacy Policy",
        body:[
          "Your privacy is fundamental to ZENO. This policy explains what data we handle and how.",
          "DATA WE STORE LOCALLY: username, preferences (language, theme, color), energy check-in history, tasks, achievements and streak. Everything is stored on your device.",
          "CLOUD DATA (optional): if you connect Google, the same data syncs to your personal Google Drive in a private folder only ZENO can access. You control this folder from your Google account.",
          "DATA THE AI PROCESSES: your messages are sent to Anthropic's API to generate responses. Anthropic does not store conversations for training per their policy. We do not include personally identifying data in prompts.",
          "DATA WE DO NOT COLLECT: we do not track your location, use third-party cookies, behavioral analytics, or sell data.",
          "YOUR RIGHTS: you can delete all local data by logging out. For Google Drive data, delete the file from your Google account.",
          "MINIMUM AGE: ZENO is not directed at users under 13.",
          "Contact: privacy@zenoapp.com"
        ]
      }
    }
  };
  const c=content[type][isES?"es":"en"];
  return(
    <div style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,.55)",backdropFilter:"blur(4px)",display:"flex",alignItems:"flex-end",justifyContent:"center",animation:"fadeIn .2s ease both"}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{width:"100%",maxWidth:430,maxHeight:"80vh",background:th.card,borderRadius:"24px 24px 0 0",padding:"0 0 env(safe-area-inset-bottom,24px)",overflow:"hidden",display:"flex",flexDirection:"column",animation:"fadeSlideUp .3s cubic-bezier(.25,.46,.45,.94) both"}}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"20px 22px 16px",borderBottom:"1px solid "+th.border,flexShrink:0}}>
          <div style={{fontFamily:F.display,fontSize:17,fontWeight:600,color:th.text}}>{c.title}</div>
          <button onClick={onClose} style={{width:32,height:32,borderRadius:"50%",background:th.cardAlt,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:th.text3,fontSize:16}}>✕</button>
        </div>
        {/* Content */}
        <div style={{overflowY:"auto",padding:"18px 22px 24px",display:"flex",flexDirection:"column",gap:14}}>
          {c.body.map((para,i)=>(
            <p key={i} style={{fontSize:13,color:i===0?th.text:th.text2,fontFamily:i===0?F.display:F.body,fontStyle:i===0?"italic":"normal",lineHeight:1.65,margin:0}}>{para}</p>
          ))}
        </div>
      </div>
    </div>
  );
}


function Onboard({onDone,onGoogleLogin}){
  const{t,th,dark}=useCtx();const Card=useCard();
  const[mode,setMode]=useState("welcome");
  const[name,setName]=useState("");const[email,setEmail]=useState("");const[pass,setPass]=useState("");
  const[brainType,setBT]=useState("");const[challenge,setCH]=useState("");
  const[vis,setVis]=useState(false);
  const[gLoading,setGLoading]=useState(false);
  const[legalModal,setLegalModal]=useState(null);
  useEffect(()=>{setTimeout(()=>setVis(true),80);},[]);
  const ok=name.trim()&&email.trim()&&email.includes("@")&&pass.length>=6;
  const lang=t===STR.en?"en":"es";
  const iS={width:"100%",padding:"15px 18px",borderRadius:16,background:th.cardAlt,border:"1.5px solid "+th.border,fontSize:15,color:th.text,fontFamily:F.body,outline:"none",marginBottom:10,transition:"border-color .3s"};

  const handleGoogle=async()=>{
    if(!onGoogleLogin)return;
    setGLoading(true);
    await onGoogleLogin((gName,bt,ch,gData)=>{
      // New Google user — prefill name and go to brain type
      setName(gName||"");
      setVis(false);
      setTimeout(()=>{setMode("brain");setVis(true);},200);
    });
    setGLoading(false);
  };

  const BRAIN_TYPES=lang==="es"
    ?[{id:"adhd",icon:"⚡",label:"TDAH diagnosticado",sub:"Tengo diagnóstico oficial"},{id:"suspect",icon:"🧩",label:"Creo que tengo TDAH",sub:"Sin diagnóstico pero me identifico"},{id:"neuro",icon:"🌀",label:"Neurodivergente",sub:"Dislexia, autismo, o similar"},{id:"curious",icon:"🔍",label:"Solo quiero explorar",sub:"Me cuesta concentrarme y procrastino"}]
    :[{id:"adhd",icon:"⚡",label:"Diagnosed ADHD",sub:"I have an official diagnosis"},{id:"suspect",icon:"🧩",label:"I think I have ADHD",sub:"No diagnosis but I relate"},{id:"neuro",icon:"🌀",label:"Neurodivergent",sub:"Dyslexia, autism, or similar"},{id:"curious",icon:"🔍",label:"Just exploring",sub:"I struggle to focus and procrastinate"}];

  const CHALLENGES=lang==="es"
    ?[{id:"start",icon:"🚀",label:"Empezar tareas",sub:"La parálisis de inicio me bloquea"},{id:"focus",icon:"🎯",label:"Mantener el foco",sub:"Me distraigo constantemente"},{id:"memory",icon:"🧠",label:"Memoria y olvidos",sub:"Olvido cosas importantes"},{id:"overwhelm",icon:"🌊",label:"Sentirme abrumado",sub:"Todo se siente demasiado a la vez"}]
    :[{id:"start",icon:"🚀",label:"Starting tasks",sub:"Initiation paralysis blocks me"},{id:"focus",icon:"🎯",label:"Staying focused",sub:"I get distracted constantly"},{id:"memory",icon:"🧠",label:"Memory & forgetting",sub:"I forget important things"},{id:"overwhelm",icon:"🌊",label:"Feeling overwhelmed",sub:"Everything feels like too much at once"}];

  const BtnSel=({item,selected,onSelect})=>(
    <button onClick={()=>onSelect(item.id)} style={{width:"100%",display:"flex",alignItems:"center",gap:14,padding:"14px 16px",borderRadius:RR.md,background:selected===item.id?th.gSoft:th.card,border:"1.5px solid "+(selected===item.id?th.g:th.border),cursor:"pointer",textAlign:"left",transition:"all .25s ease",marginBottom:8}}>
      <span style={{fontSize:22,flexShrink:0}}>{item.icon}</span>
      <div style={{flex:1}}>
        <div style={{fontFamily:F.display,fontSize:14,fontWeight:600,color:selected===item.id?th.g:th.text,marginBottom:2}}>{item.label}</div>
        <div style={{fontSize:11,color:th.text3,lineHeight:1.3}}>{item.sub}</div>
      </div>
      {selected===item.id&&<div style={{width:20,height:20,borderRadius:"50%",background:th.gBtn,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg></div>}
    </button>
  );

  return(
    <div style={{position:"absolute",inset:0,zIndex:200,background:th.bg,display:"flex",flexDirection:"column",overflow:"hidden"}}>

      {/* Top accent line */}
      <div style={{height:3,background:`linear-gradient(90deg,transparent,${th.g},${th.g2},transparent)`,opacity:.4,flexShrink:0}}/>

      {/* Progress dots */}
      {mode!=="welcome"&&<div style={{display:"flex",justifyContent:"center",gap:8,padding:"16px 0 0",flexShrink:0}}>
        {["brain","challenge","form"].map((s,i)=>(
          <div key={s} style={{width:mode===s?24:8,height:8,borderRadius:100,background:["brain","challenge","form"].indexOf(mode)>=i?th.g:th.border,transition:"all .4s ease"}}/>
        ))}
      </div>}

      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"0 28px",overflowY:"auto"}}>
        <div style={{opacity:vis?1:0,transform:vis?"translateY(0)":"translateY(24px)",transition:"all .8s cubic-bezier(.25,.46,.45,.94)",display:"flex",flexDirection:"column",alignItems:"center",width:"100%",maxWidth:340}}>

          {mode==="welcome"&&<>
            {/* Orb hero */}
            <div style={{position:"relative",marginBottom:20,animation:"orbEntrance .9s cubic-bezier(.34,1.56,.64,1) both"}}>
              <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",width:220,height:220,borderRadius:"50%",
                background:`radial-gradient(circle,${th.g}35 0%,transparent 68%)`,
                animation:"haloBreath 4s ease-in-out infinite"}}/>
              <Orb scores={{body:4,mind:4,heart:4,drive:4}} lv={{c1:th.g,c2:th.g2,c3:th.g2+"40"}} size={140} showFace/>
            </div>

            {/* Brand */}
            <div style={{animation:"fadeSlideUp .7s cubic-bezier(.25,.46,.45,.94) .15s both"}}>
              <div style={{fontFamily:F.display,fontSize:44,fontWeight:700,letterSpacing:7,color:th.text,marginBottom:4,textAlign:"center"}}>ZENO</div>
              <div style={{width:40,height:2,borderRadius:100,background:`linear-gradient(90deg,${th.g},${th.g2})`,margin:"0 auto 12px"}}/>
              <p style={{fontFamily:F.display,fontSize:15,color:th.text2,fontStyle:"italic",textAlign:"center",lineHeight:1.7,marginBottom:32,maxWidth:280}}>{t.welcomeSub}</p>
            </div>

            {/* Auth buttons */}
            <div style={{width:"100%",display:"flex",flexDirection:"column",gap:10,animation:"fadeSlideUp .7s cubic-bezier(.25,.46,.45,.94) .3s both"}}>

              {/* Google */}
              <button
                onClick={handleGoogle}
                disabled={gLoading}
                style={{width:"100%",padding:"15px 20px",borderRadius:16,
                  background:th.card,
                  border:"1.5px solid "+th.text3,
                  cursor:gLoading?"default":"pointer",fontFamily:F.body,fontSize:15,fontWeight:500,color:th.text,
                  display:"flex",alignItems:"center",justifyContent:"center",gap:12,
                  boxShadow:"0 2px 8px rgba(0,0,0,.10)",transition:"all .25s ease",minHeight:54,opacity:gLoading?.7:1}}>
                {gLoading
                  ?<div style={{width:20,height:20,border:"2px solid "+th.border,borderTopColor:th.g,borderRadius:"50%",animation:"spin .7s linear infinite"}}/>
                  :<svg width="20" height="20" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                    <path fill="none" d="M0 0h48v48H0z"/>
                  </svg>
                }
                {gLoading?(lang==="es"?"Conectando...":"Connecting..."):(lang==="es"?"Continuar con Google":"Continue with Google")}
              </button>

              {/* Apple — disabled until implemented */}
              <div style={{position:"relative"}}>
                <button
                  disabled
                  style={{width:"100%",padding:"15px 20px",borderRadius:16,
                    background:dark?"#E8E8E8":"#1A1A1A",
                    border:"none",cursor:"not-allowed",
                    fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif",
                    fontSize:15,fontWeight:500,color:dark?"#000":"#fff",
                    display:"flex",alignItems:"center",justifyContent:"center",gap:10,
                    minHeight:54,letterSpacing:-.2,opacity:.6}}>
                  <svg width="17" height="20" viewBox="0 0 17 20" xmlns="http://www.w3.org/2000/svg" fill={dark?"#000":"#fff"}>
                    <path d="M14.376 10.534c-.022-2.548 2.08-3.776 2.175-3.836-1.185-1.733-3.028-1.97-3.683-1.995-1.565-.159-3.065.928-3.862.928-.797 0-2.02-.907-3.324-.882-1.706.025-3.29.995-4.168 2.52C-.173 9.865.978 14.2 2.737 16.618c.876 1.185 1.913 2.515 3.273 2.465 1.318-.05 1.813-.843 3.406-.843 1.593 0 2.041.843 3.43.818 1.416-.025 2.31-1.21 3.174-2.4.999-1.378 1.41-2.71 1.432-2.78-.031-.015-2.745-1.048-2.076-4.344zM11.857 3.2C12.57 2.35 13.054 1.17 12.917 0c-1.022.04-2.26.68-2.993 1.52-.659.754-1.237 1.962-1.082 3.12 1.14.088 2.306-.578 3.015-1.44z"/>
                  </svg>
                  {lang==="es"?"Continuar con Apple":"Sign in with Apple"}
                </button>
                <div style={{position:"absolute",top:-7,right:10,background:th.gBtn,color:"#fff",fontSize:9,fontWeight:700,borderRadius:100,padding:"2px 8px",letterSpacing:.5,fontFamily:F.body,pointerEvents:"none"}}>
                  {lang==="es"?"PRONTO":"SOON"}
                </div>
              </div>

              {/* Divider */}
              <div style={{display:"flex",alignItems:"center",gap:12,margin:"2px 0"}}>
                <div style={{flex:1,height:1,background:th.border}}/>
                <span style={{fontSize:11,color:th.text3,letterSpacing:1,fontFamily:F.body}}>{t.orLabel||"o"}</span>
                <div style={{flex:1,height:1,background:th.border}}/>
              </div>

              {/* Email — primary CTA */}
              <button
                onClick={()=>{haptic("soft");setVis(false);setTimeout(()=>{setMode("brain");setVis(true);},200);}}
                style={{width:"100%",padding:"15px 20px",borderRadius:16,
                  background:th.gBtn,
                  border:"none",
                  cursor:"pointer",fontFamily:F.body,fontSize:15,fontWeight:700,color:"#fff",
                  display:"flex",alignItems:"center",justifyContent:"center",gap:10,
                  boxShadow:"0 2px 8px rgba(0,0,0,.18)",
                  transition:"all .25s ease",minHeight:54}}>
                <svg width="18" height="14" viewBox="0 0 24 18" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="1" width="22" height="16" rx="3"/><path d="M1 4l11 7 11-7"/></svg>
                {lang==="es"?"Continuar con correo":"Continue with email"}
              </button>

              {/* Skip */}
              <button onClick={()=>onDone("Zeno","","skip")} style={{background:"none",border:"none",cursor:"pointer",marginTop:2,fontSize:12,color:th.text3,fontFamily:F.display,fontStyle:"italic",minHeight:40,letterSpacing:.3}}>
                {t.skipLogin}
              </button>

              {/* Privacy + Terms */}
              <div style={{fontSize:10,color:th.text3,textAlign:"center",lineHeight:1.6,margin:"8px 0 0",fontFamily:F.body,opacity:.7}}>
                {lang==="es"?"Al continuar, aceptas nuestros ":"By continuing, you agree to our "}
                <span onClick={()=>setLegalModal("terms")} style={{color:th.g,cursor:"pointer",textDecoration:"underline"}}>
                  {lang==="es"?"Términos":"Terms"}
                </span>
                {lang==="es"?" y ":" and "}
                <span onClick={()=>setLegalModal("privacy")} style={{color:th.g,cursor:"pointer",textDecoration:"underline"}}>
                  {lang==="es"?"Política de Privacidad":"Privacy Policy"}
                </span>
              </div>
            </div>
          </>}
          {/* Legal modal */}
          {legalModal&&<LegalModal type={legalModal} lang={lang} th={th} onClose={()=>setLegalModal(null)}/>}

          {mode==="brain"&&<>
            <div style={{width:"100%",marginBottom:8}}>
              <div style={{fontFamily:F.display,fontSize:22,fontWeight:700,color:th.text,marginBottom:6,textAlign:"center"}}>
                {lang==="es"?"¿Cómo describes tu cerebro?":"How do you describe your brain?"}
              </div>
              <p style={{fontSize:13,color:th.text3,textAlign:"center",marginBottom:20,lineHeight:1.5}}>
                {lang==="es"?"Esto ayuda a ZENO a personalizar desde el día 1":"This helps ZENO personalize from day 1"}
              </p>
              {BRAIN_TYPES.map(item=><BtnSel key={item.id} item={item} selected={brainType} onSelect={setBT}/>)}
            </div>
            <button onClick={()=>{if(!brainType)return;setVis(false);setTimeout(()=>{setMode("challenge");setVis(true);},200);}} disabled={!brainType} style={{width:"100%",padding:"16px",borderRadius:16,background:brainType?th.gBtn:th.cardAlt,border:"none",cursor:brainType?"pointer":"default",fontFamily:F.body,fontSize:15,fontWeight:600,color:brainType?"#fff":th.text3,minHeight:54,marginTop:8,transition:"all .3s"}}>
              {lang==="es"?"Continuar →":"Continue →"}
            </button>
          </>}

          {mode==="challenge"&&<>
            <div style={{width:"100%",marginBottom:8}}>
              <div style={{fontFamily:F.display,fontSize:22,fontWeight:700,color:th.text,marginBottom:6,textAlign:"center"}}>
                {lang==="es"?"¿Cuál es tu mayor reto?":"What is your biggest challenge?"}
              </div>
              <p style={{fontSize:13,color:th.text3,textAlign:"center",marginBottom:20,lineHeight:1.5}}>
                {lang==="es"?"ZENO va a ayudarte específicamente con esto":"ZENO will help you specifically with this"}
              </p>
              {CHALLENGES.map(item=><BtnSel key={item.id} item={item} selected={challenge} onSelect={setCH}/>)}
            </div>
            <button onClick={()=>{if(!challenge)return;setVis(false);setTimeout(()=>{setMode("form");setVis(true);},200);}} disabled={!challenge} style={{width:"100%",padding:"16px",borderRadius:16,background:challenge?th.gBtn:th.cardAlt,border:"none",cursor:challenge?"pointer":"default",fontFamily:F.body,fontSize:15,fontWeight:600,color:challenge?"#fff":th.text3,minHeight:54,marginTop:8,transition:"all .3s"}}>
              {lang==="es"?"Continuar →":"Continue →"}
            </button>
            <button onClick={()=>{setVis(false);setTimeout(()=>{setMode("brain");setVis(true);},200);}} style={{background:"none",border:"none",cursor:"pointer",marginTop:8,fontSize:12,color:th.text3,minHeight:36}}>
              ← {lang==="es"?"Atrás":"Back"}
            </button>
          </>}

          {mode==="form"&&<>
            <Orb scores={{body:3,mind:3,heart:3,drive:3}} lv={{c1:th.g,c2:th.g2,c3:th.g2+"40"}} size={80} showFace/>
            <div style={{fontFamily:F.display,fontSize:28,fontWeight:700,letterSpacing:5,color:th.text,margin:"10px 0 2px"}}>ZENO</div>
            <p style={{fontSize:13,color:th.text2,fontStyle:"italic",fontFamily:F.display,marginBottom:20,textAlign:"center"}}>{t.welcomeSub}</p>
            <div style={{width:"100%"}}>
              <input value={name} onChange={e=>setName(e.target.value)} placeholder={t.namePlaceholder} style={iS}/>
              <input value={email} onChange={e=>setEmail(e.target.value)} placeholder={t.emailPlaceholder} type="email" style={iS}/>
              <input value={pass} onChange={e=>setPass(e.target.value)} placeholder={t.passPlaceholder} type="password" style={iS} onKeyDown={e=>{if(e.key==="Enter"&&ok)onDone(name.trim(),brainType,challenge);}}/>
              <button onClick={()=>{if(ok)onDone(name.trim(),brainType,challenge);}} disabled={!ok} style={{width:"100%",padding:"16px",borderRadius:16,background:ok?th.gBtn:th.cardAlt,border:"none",cursor:ok?"pointer":"default",fontFamily:F.body,fontSize:15,fontWeight:600,color:ok?"#fff":th.text3,marginBottom:8,minHeight:54,transition:"all .3s"}}>{t.createAccount}</button>
              <button onClick={()=>onDone(name.trim()||"Zeno",brainType,challenge)} style={{width:"100%",background:"none",border:"none",cursor:"pointer",fontSize:13,color:th.text3,fontFamily:F.display,fontStyle:"italic",marginBottom:6,minHeight:44}}>{t.skipLogin}</button>
              <button onClick={()=>{setVis(false);setTimeout(()=>{setMode("challenge");setVis(true);},200);}} style={{width:"100%",background:"none",border:"none",cursor:"pointer",fontSize:12,color:th.text3,fontFamily:F.body,display:"flex",alignItems:"center",justifyContent:"center",gap:5,minHeight:36}}><Ic name="back" size={13} color={th.text3} sw={1.3}/> {t.goBack}</button>
            </div>
          </>}

        </div>
      </div>
      <div style={{height:2,background:"linear-gradient(90deg,transparent,"+th.g+"20,transparent)",flexShrink:0}}/>
    </div>
  );
}


function EnergyRing({scores,setScores,setMascotKey,lv,th,t,lang,F,avg}){
  const ringVal=Math.round((scores.body+scores.mind+scores.heart+scores.drive)/4);
  const ringPct=(ringVal-1)/4;
  const toRad=d=>d*Math.PI/180;
  const cx=110,cy=110,R=82,r=60,START=-225,SWEEP=270;

  // Color per level: slate/blue/green/amber/red
  const COLORS=["#64748B","#3B82F6","#10B981","#F59E0B","#EF4444"];
  const COLORS2=["#94A3B8","#60A5FA","#34D399","#FCD34D","#F87171"];
  const color=COLORS[ringVal-1]||th.g;
  const color2=COLORS2[ringVal-1]||th.g2;

  const arc=(pct)=>{
    if(pct<=0)return"";
    const end=START+(SWEEP*Math.min(pct,0.999));
    const x1=cx+R*Math.cos(toRad(START)),y1=cy+R*Math.sin(toRad(START));
    const x2=cx+R*Math.cos(toRad(end)),y2=cy+R*Math.sin(toRad(end));
    const xi1=cx+r*Math.cos(toRad(START)),yi1=cy+r*Math.sin(toRad(START));
    const xi2=cx+r*Math.cos(toRad(end)),yi2=cy+r*Math.sin(toRad(end));
    const lg=SWEEP*pct>180?1:0;
    return"M"+x1+","+y1+" A"+R+","+R+",0,"+lg+",1,"+x2+","+y2+" L"+xi2+","+yi2+" A"+r+","+r+",0,"+lg+",0,"+xi1+","+yi1+" Z";
  };

  const handleClick=(e)=>{
    const rect=e.currentTarget.getBoundingClientRect();
    const sx=((e.clientX-rect.left)/rect.width)*220;
    const sy=((e.clientY-rect.top)/rect.height)*220;
    let deg=Math.atan2(sy-cy,sx-cx)*180/Math.PI;
    let rel=deg-START; if(rel<0)rel+=360; if(rel>SWEEP)rel=rel>SWEEP+(360-SWEEP)/2?0:SWEEP;
    const newVal=Math.max(1,Math.min(5,Math.round((rel/SWEEP)*4)+1));
    haptic("soft");
    setScores({body:newVal,mind:newVal,heart:newVal,drive:newVal});
    setMascotKey(k=>k+1);
  };

  // Thumb position
  const thumbDeg=START+SWEEP*ringPct;
  const thumbX=cx+R*Math.cos(toRad(thumbDeg));
  const thumbY=cy+R*Math.sin(toRad(thumbDeg));

  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",marginBottom:12,animation:"fadeIn .5s ease .1s both"}}>
      <div style={{position:"relative",width:220,height:220,animation:"ringBreath "+(3-ringVal*.3)+"s ease-in-out infinite"}}>
        <svg width="220" height="220" viewBox="0 0 220 220" onClick={handleClick} style={{cursor:"pointer",display:"block",overflow:"visible"}}>
          <defs>
            {/* Glow filter */}
            <filter id="rGlow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="4" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            {/* Strong glow for thumb */}
            <filter id="rGlow2" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="6" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            {/* Gradient for arc fill */}
            <linearGradient id={"rGrad"+ringVal} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={color} stopOpacity="0.7"/>
              <stop offset="60%" stopColor={color} stopOpacity="1"/>
              <stop offset="100%" stopColor={color2} stopOpacity="1"/>
            </linearGradient>
            {/* Radial glow center */}
            <radialGradient id="rCenter">
              <stop offset="0%" stopColor={color} stopOpacity="0.15"/>
              <stop offset="100%" stopColor={color} stopOpacity="0"/>
            </radialGradient>
          </defs>

          {/* Background glow center — reacts to level */}
          <circle cx={cx} cy={cy} r="54" fill="url(#rCenter)" style={{transition:"all .6s ease"}}/>

          {/* Subtle wave rings — pulse outward continuously */}
          {ringVal>=2&&<circle cx={cx} cy={cy} r="40" fill="none" stroke={color} strokeWidth="1.5"
            opacity="0" style={{transformOrigin:"110px 110px",animation:"wavePulse "+(2.5-ringVal*.2)+"s ease-out infinite"}}/>}
          {ringVal>=3&&<circle cx={cx} cy={cy} r="40" fill="none" stroke={color} strokeWidth="1"
            opacity="0" style={{transformOrigin:"110px 110px",animation:"wavePulse "+(2.5-ringVal*.2)+"s ease-out infinite",animationDelay:".8s"}}/>}
          {ringVal>=5&&<circle cx={cx} cy={cy} r="40" fill="none" stroke={color} strokeWidth="1"
            opacity="0" style={{transformOrigin:"110px 110px",animation:"wavePulse 1.8s ease-out infinite",animationDelay:"1.4s"}}/>}

          {/* Track — background arc */}
          <path d={arc(1)} fill={th.borderLight}/>

          {/* Filled arc — with gradient */}
          {ringPct>0&&<path d={arc(ringPct)} fill={"url(#rGrad"+ringVal+")"} filter="url(#rGlow)"
            style={{transition:"d .4s cubic-bezier(.25,.46,.45,.94)"}}/>}

          {/* 3 state dots — match Bajo / Presente / Pleno picker below */}
          {[0,0.5,1].map((p,i)=>{
            const STATE_COLORS=["#8BA4C0","#5B9E8F","#C4867A"];
            const STATE_VALS=[1,3,5];
            const deg=START+SWEEP*p;
            const dcx=cx+(R+13)*Math.cos(toRad(deg));
            const dcy=cy+(R+13)*Math.sin(toRad(deg));
            const isActive=ringVal>=STATE_VALS[i];
            const isCurrent=Math.abs(ringVal-STATE_VALS[i])<=1&&(i===0?ringVal<=2:i===2?ringVal>=4:ringVal===3);
            const dc=STATE_COLORS[i];
            const dr=isCurrent?6.5:isActive?4.5:3.5;
            return(
              <g key={i}>
                {isCurrent&&<circle cx={dcx} cy={dcy} r={dr+5} fill={dc} opacity="0"
                  style={{transformOrigin:dcx+"px "+dcy+"px",animation:"dotPing 2s ease-out infinite"}}/>}
                <circle cx={dcx} cy={dcy} r={dr} fill={isActive?dc:th.border}
                  filter={isCurrent?"url(#rGlow)":undefined}
                  style={{transition:"all .4s ease"}}/>
              </g>
            );
          })}

          {/* Center: energy symbol — 1 moon · 2 sprout · 3 eye · 4 bolt · 5 sun */}
          {ringVal===1&&<g key="sym1" style={{animation:"numPop .4s cubic-bezier(.25,.46,.45,.94) both",transformOrigin:"110px 110px"}}>
            <path d="M110 74 C90 74 74 90 74 110 C74 130 90 146 110 146 C96 136 88 124 88 110 C88 96 96 84 110 74Z"
              fill={color} opacity="0.9" filter="url(#rGlow)"/>
            <circle cx="107" cy="88" r="4" fill={color} opacity="0.45"/>
            <circle cx="97" cy="104" r="2.5" fill={color} opacity="0.3"/>
          </g>}

          {ringVal===2&&<g key="sym2" style={{animation:"numPop .4s cubic-bezier(.25,.46,.45,.94) both",transformOrigin:"110px 110px"}}>
            <line x1="110" y1="140" x2="110" y2="96" stroke={color} strokeWidth="2.5" strokeLinecap="round" opacity="0.55"/>
            <path d="M110 118 C110 118 93 109 91 95 C91 95 109 95 110 118Z" fill={color} opacity="0.9" filter="url(#rGlow)"/>
            <path d="M110 107 C110 107 127 99 129 85 C129 85 111 85 110 107Z" fill={color} opacity="0.6"/>
            <circle cx="110" cy="86" r="3" fill={color} opacity="0.45"/>
          </g>}

          {ringVal===3&&<g key="sym3" style={{animation:"numPop .4s cubic-bezier(.25,.46,.45,.94) both",transformOrigin:"110px 110px"}}>
            <path d="M75 110 C87 92 97 86 110 86 C123 86 133 92 145 110 C133 128 123 134 110 134 C97 134 87 128 75 110Z"
              fill="none" stroke={color} strokeWidth="2" opacity="0.65"/>
            <circle cx="110" cy="110" r="15" fill={color} opacity="0.9" filter="url(#rGlow)"/>
            <circle cx="110" cy="110" r="7" fill={th.card} opacity="0.6"/>
            <circle cx="110" cy="110" r="3.5" fill={color} opacity="0.85"/>
          </g>}

          {ringVal===4&&<g key="sym4" style={{animation:"numPop .4s cubic-bezier(.25,.46,.45,.94) both",transformOrigin:"110px 110px"}}>
            <path d="M117 74 L95 112 L111 112 L101 146 L125 104 L109 104 Z"
              fill={color} opacity="0.95" filter="url(#rGlow)"/>
            <path d="M117 74 L95 112 L111 112 L101 146 L125 104 L109 104 Z"
              fill={color2} opacity="0.3"/>
          </g>}

          {ringVal===5&&<g key="sym5" style={{animation:"numPop .4s cubic-bezier(.25,.46,.45,.94) both",transformOrigin:"110px 110px"}}>
            <circle cx="110" cy="110" r="22" fill={color} opacity="0.95" filter="url(#rGlow)"/>
            <circle cx="110" cy="110" r="13" fill={color2} opacity="0.45"/>
            <line x1="110" y1="72" x2="110" y2="83" stroke={color} strokeWidth="2.5" strokeLinecap="round" opacity="0.9"/>
            <line x1="110" y1="137" x2="110" y2="148" stroke={color} strokeWidth="2.5" strokeLinecap="round" opacity="0.9"/>
            <line x1="72" y1="110" x2="83" y2="110" stroke={color} strokeWidth="2.5" strokeLinecap="round" opacity="0.9"/>
            <line x1="137" y1="110" x2="148" y2="110" stroke={color} strokeWidth="2.5" strokeLinecap="round" opacity="0.9"/>
            <line x1="83" y1="83" x2="91" y2="91" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.7"/>
            <line x1="129" y1="83" x2="121" y2="91" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.7"/>
            <line x1="83" y1="137" x2="91" y2="129" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.7"/>
            <line x1="129" y1="137" x2="121" y2="129" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.7"/>
          </g>}

          {/* Level name below symbol */}
          <text x={cx} y={cy+44} textAnchor="middle"
            style={{fontSize:13,fontFamily:F.display,fill:color,fontWeight:700,
              transition:"fill .4s ease",letterSpacing:.5}}>
            {t.levels[ringVal-1]?t.levels[ringVal-1].label:""}
          </text>

          {/* Thumb — glowing dot at current position */}
          {ringPct>0&&ringPct<1&&<circle cx={thumbX} cy={thumbY} r="11"
            fill={th.card} stroke={color} strokeWidth="3" filter="url(#rGlow2)"
            style={{transition:"cx .4s cubic-bezier(.25,.46,.45,.94),cy .4s cubic-bezier(.25,.46,.45,.94)",
              filter:"url(#rGlow2)"}}/>}
          {ringPct>0&&ringPct<1&&<circle cx={thumbX} cy={thumbY} r="5"
            fill={color} style={{transition:"cx .4s cubic-bezier(.25,.46,.45,.94),cy .4s cubic-bezier(.25,.46,.45,.94)"}}/>}

        </svg>
      </div>

      {/* Level message */}
      <div style={{fontSize:13,color:th.text2,fontFamily:F.display,fontStyle:"italic",
        textAlign:"center",maxWidth:210,lineHeight:1.55,marginTop:4,
        transition:"color .5s ease"}}>
        {t.levels[ringVal-1]?t.levels[ringVal-1].msg:""}
      </div>
    </div>
  );
}


// ── TipCard helper ──────────────────────────────────────────────────────
function TipCard({t,th,lv,scores,Card,F,RR}){
  const dayIdx=new Date().getDate()%t.tips.length;
  const lvAvg=Math.round((scores.body+scores.mind+scores.heart+scores.drive)/4);
  const aiTip=t.tipsAI.find(tp=>tp.energy.includes(lvAvg))||t.tipsAI[1];
  const tip=(lvAvg<=2||lvAvg>=4)?{cat:"ai",text:aiTip.text}:t.tips[dayIdx];
  const catColors={ai:lv.c1,expert:"#6A9FBF",motiv:"#C4867A",practical:"#C4A94E"};
  const catColor=catColors[tip.cat]||lv.c1;
  const catLabel=t.tipCat[tip.cat]||t.tipCat.practical;
  return(
    <div style={{...Card({borderRadius:RR.lg,padding:"18px 20px",border:"1px solid "+th.borderLight}),marginTop:14,animation:"fadeIn .6s ease .4s both"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <Ic name="star" size={14} color={catColor} sw={1.4}/>
          <span style={{fontSize:10,color:th.text3,letterSpacing:2,textTransform:"uppercase",fontWeight:500}}>{t.tipTitle}</span>
        </div>
        <span style={{fontSize:10,color:catColor,fontWeight:600,background:catColor+"15",padding:"3px 10px",borderRadius:100}}>{catLabel}</span>
      </div>
      <p style={{fontFamily:F.display,fontSize:13,color:th.text,lineHeight:1.65,margin:0,fontStyle:"italic"}}>{tip.text}</p>
    </div>
  );
}



// ══════════════════════════════════════════════════════════════════════════
// PERSISTENT TASKS — survive between sessions
// ══════════════════════════════════════════════════════════════════════════
function PersistentTasks(){
  const{t,th,lang,savedTasks,addTask:ctxAdd,toggleTask,clearDone,undoComplete,lastCompleted,memory}=useCtx();const Card=useCard();
  const[input,setInput]=useState("");
  const[listening,setListening]=useState(false);
  const[aiHint,setAiHint]=useState({}); // taskId -> micro-step hint
  const[hintLoad,setHintLoad]=useState(null);
  const recRef=useRef(null);

  const lastEnergy=memory&&memory.length>0?parseFloat(memory[memory.length-1].avg)||3:3;

  const getAiHint=async(taskId,taskText)=>{
    if(aiHint[taskId])return;
    setHintLoad(taskId);
    try{
      const _txt=await aiCall({max_tokens:80,messages:[{role:"user",content:lang==="es"
        ?`Cerebro TDAH. Energía actual: ${lastEnergy}/5. Tarea: "${taskText}". Dame el primer micro-paso. Máx 10 palabras. Empieza con verbo de acción. Solo el paso.`
        :`ADHD brain. Current energy: ${lastEnergy}/5. Task: "${taskText}". Give the first micro-step. Max 10 words. Start with action verb. Just the step.`
      }]});
      const hint=zenoCheckOutput(_txt.trim(),lang);
      if(hint)setAiHint(prev=>({...prev,[taskId]:hint}));
    }catch{}
    setHintLoad(null);
  };

  const addTask=()=>{
    const txt=input.trim();if(!txt)return;
    haptic("soft");ctxAdd(txt);setInput("");
  };
  const toggle=(id)=>{haptic("success");toggleTask(id);};
  const clear=()=>clearDone();
  // Filter tasks by today's energy level
  const allPending=(savedTasks||[]).filter(tk=>!tk.done);
  const pending=allPending.filter(tk=>(tk.energyLevel||3)<=lastEnergy).sort((a,b)=>((a.energyLevel||3)-(b.energyLevel||3)));
  const hiddenByEnergy=allPending.length-pending.length;
  const done=(savedTasks||[]).filter(tk=>tk.done);

  const startVoice=()=>{
    try{
      const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
      if(!SR){alert(lang==="es"?"Tu navegador no soporta voz":"Your browser doesn't support voice");return;}
      const rec=new SR();rec.lang=lang==="es"?"es-ES":"en-US";rec.interimResults=false;rec.maxAlternatives=1;
      rec.onresult=(e)=>{const txt=e.results[0][0].transcript;setInput(txt);setListening(false);};
      rec.onerror=()=>setListening(false);rec.onend=()=>setListening(false);
      recRef.current=rec;rec.start();setListening(true);
    }catch{setListening(false);}
  };

  return(
    <div style={{...Card({borderRadius:RR.lg,padding:"16px 18px",border:"1px solid "+th.borderLight}),marginTop:12}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <Ic name="check" size={14} color={th.g} sw={1.8}/>
          <span style={{fontSize:10,color:th.text3,letterSpacing:2,textTransform:"uppercase",fontWeight:500}}>{t.tasksTitle||"Tareas de hoy"}</span>
        </div>
        {done.length>0&&<button onClick={clear} style={{background:"none",border:"none",cursor:"pointer",fontSize:10,color:th.text3,fontFamily:F.body,padding:"2px 6px"}}>{t.tasksClear||"Limpiar"}</button>}
      </div>

      {/* Input row with voice */}
      <div style={{display:"flex",gap:6,marginBottom:10}}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")addTask();}}
          placeholder={t.tasksAdd||"Añadir tarea..."}
          style={{flex:1,padding:"9px 13px",borderRadius:12,background:th.cardAlt,border:"1px solid "+th.borderLight,fontSize:13,color:th.text,fontFamily:F.body,outline:"none"}}/>
        <button onClick={listening?()=>{recRef.current?.stop();setListening(false);}:startVoice}
          title={listening?(t.voiceStop||"Parar"):(t.voiceInput||"Dictar")}
          style={{width:36,height:36,borderRadius:"50%",background:listening?th.gBtn:th.cardAlt,border:"1px solid "+(listening?th.g:th.borderLight),cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .3s"}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={listening?"#fff":th.text3} strokeWidth="2" strokeLinecap="round">
            <rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0014 0M12 19v4M8 23h8"/>
          </svg>
        </button>
        <button onClick={addTask} disabled={!input.trim()}
          style={{width:36,height:36,borderRadius:"50%",background:input.trim()?th.gBtn:th.cardAlt,border:"none",cursor:input.trim()?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .3s"}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={input.trim()?"#fff":th.text3} strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>

      {hiddenByEnergy>0&&(
        <div style={{fontSize:11,color:th.text3,fontFamily:F.display,fontStyle:"italic",textAlign:"center",padding:"4px 0 8px",borderBottom:"1px solid "+th.borderLight,marginBottom:6}}>
          {lang==="es"?`${hiddenByEnergy} tarea${hiddenByEnergy>1?"s":""} oculta${hiddenByEnergy>1?"s":""} — energía muy alta para hoy`:`${hiddenByEnergy} task${hiddenByEnergy>1?"s":""} hidden — too high energy for today`}
        </div>
      )}
      {pending.length===0&&done.length===0&&(
        <p style={{fontSize:12,color:th.text3,fontFamily:F.display,fontStyle:"italic",textAlign:"center",padding:"8px 0",margin:0}}>{t.tasksEmpty||"Sin tareas pendientes — ¡buen trabajo!"}</p>
      )}
      <div style={{display:"flex",flexDirection:"column",gap:4}}>
        {pending.map(tk=>(
          <div key={tk.id}>
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"9px 10px",borderRadius:10,transition:"background .2s"}}
              onMouseEnter={e=>e.currentTarget.style.background=th.cardAlt}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <button onClick={()=>toggle(tk.id)} style={{width:18,height:18,borderRadius:"50%",border:"1.5px solid "+th.g,flexShrink:0,background:"transparent",cursor:"pointer",padding:0}}/>
              <span style={{fontSize:13,color:th.text,lineHeight:1.4,flex:1}}>{tk.text}</span>
              {/* AI micro-step button */}
              <button onClick={()=>getAiHint(tk.id,tk.text)}
                disabled={hintLoad===tk.id}
                title={lang==="es"?"¿Por dónde empiezo?":"Where do I start?"}
                style={{width:24,height:24,borderRadius:"50%",background:aiHint[tk.id]?th.gSoft:th.cardAlt,border:"1px solid "+(aiHint[tk.id]?th.gBorder:th.borderLight),cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .3s",padding:0}}>
                {hintLoad===tk.id
                  ?<div style={{width:6,height:6,borderRadius:"50%",background:th.gBtn,animation:"pulse 1s ease-in-out infinite"}}/>
                  :<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={aiHint[tk.id]?th.g:th.text3} strokeWidth="2" strokeLinecap="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                }
              </button>
            </div>
            {/* AI hint bubble */}
            {aiHint[tk.id]&&(
              <div style={{marginLeft:28,marginBottom:4,padding:"7px 12px",borderRadius:"0 12px 12px 12px",background:th.gSoft,border:"1px solid "+th.gBorder,animation:"fadeIn .3s ease both"}}>
                <p style={{fontSize:11,color:th.g,margin:0,fontFamily:F.display,fontStyle:"italic",lineHeight:1.5}}>⚡ {aiHint[tk.id]}</p>
              </div>
            )}
          </div>
        ))}
        {done.map(tk=>(
          <button key={tk.id} onClick={()=>toggle(tk.id)}
            style={{display:"flex",alignItems:"center",gap:10,padding:"9px 10px",borderRadius:10,background:"transparent",border:"none",cursor:"pointer",textAlign:"left",opacity:.45,transition:"all .2s"}}>
            <div style={{width:18,height:18,borderRadius:"50%",background:th.gBtn,border:"1.5px solid "+th.g,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
            </div>
            <span style={{fontSize:13,color:th.text2,textDecoration:"line-through",lineHeight:1.4}}>{tk.text}</span>
          </button>
        ))}
      </div>
      {/* ── Undo toast ── */}
      {lastCompleted&&(
        <div style={{position:"fixed",bottom:90,left:"50%",transform:"translateX(-50%)",zIndex:9000,background:th.card,border:"1px solid "+th.gBorder,borderRadius:100,padding:"10px 16px 10px 14px",boxShadow:th.shadowLg,display:"flex",alignItems:"center",gap:10,animation:"fadeIn .25s ease both",whiteSpace:"nowrap"}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={th.g} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l2.5 2.5"/></svg>
          <span style={{fontSize:12,color:th.text,fontFamily:F.body,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis"}}>{lang==="es"?"Completada":"Done"}</span>
          <button onClick={undoComplete} style={{background:th.gSoft,border:"1px solid "+th.gBorder,borderRadius:100,padding:"4px 12px",cursor:"pointer",fontSize:11,fontWeight:600,color:th.g,fontFamily:F.body}}>
            {lang==="es"?"Deshacer":"Undo"}
          </button>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// BADGES SECTION — dopamine achievements
// ══════════════════════════════════════════════════════════════════════════
function BadgesSection(){
  const{t,th,lang,badges,memory,flow}=useCtx();const Card=useCard();
  const[expanded,setExpanded]=useState(false);
  const allEarned=badges||[];
  const earned=BADGES_DEF.filter(b=>allEarned.includes(b.id));
  const locked=BADGES_DEF.filter(b=>!allEarned.includes(b.id));

  return(
    <div style={{...Card({borderRadius:RR.lg,padding:"16px 18px",border:"1px solid "+th.borderLight}),marginTop:12}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:earned.length>0?12:0}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:16}}>🏆</span>
          <span style={{fontSize:10,color:th.text3,letterSpacing:2,textTransform:"uppercase",fontWeight:500}}>{t.badgesTitle||"Logros"}</span>
          {earned.length>0&&<span style={{background:th.gBtn,color:"#fff",fontSize:9,fontWeight:700,borderRadius:100,padding:"1px 7px",letterSpacing:.5}}>{earned.length}</span>}
        </div>
        <button onClick={()=>setExpanded(e=>!e)} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:th.g,fontFamily:F.body,padding:"2px 6px"}}>{expanded?(lang==="es"?"▲ Menos":"▲ Less"):(lang==="es"?"▼ Ver todos":"▼ See all")}</button>
      </div>

      {earned.length===0&&(
        <p style={{fontSize:12,color:th.text3,fontFamily:F.display,fontStyle:"italic",margin:0,paddingBottom:4}}>{t.badgesEmpty||"Completa tu primer check-in para desbloquear logros"}</p>
      )}

      {/* Earned badges — always visible */}
      {earned.length>0&&(
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:expanded&&locked.length>0?12:0}}>
          {earned.map(b=>(
            <div key={b.id} title={b.sub[lang]||b.sub.es}
              style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"8px 10px",borderRadius:12,background:th.gSoft,border:"1px solid "+th.gBorder,minWidth:60,animation:"fadeIn .4s ease both"}}>
              <span style={{fontSize:24}}>{b.icon}</span>
              <span style={{fontSize:9,color:th.g,fontWeight:600,textAlign:"center",lineHeight:1.2,maxWidth:64}}>{b.label[lang]||b.label.es}</span>
            </div>
          ))}
        </div>
      )}

      {/* Locked badges — only shown when expanded */}
      {expanded&&locked.length>0&&(
        <div style={{display:"flex",gap:8,flexWrap:"wrap",paddingTop:8,borderTop:"1px solid "+th.borderLight}}>
          {locked.map(b=>(
            <div key={b.id} title={b.sub[lang]||b.sub.es}
              style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"8px 10px",borderRadius:12,background:th.cardAlt,border:"1px solid "+th.borderLight,minWidth:60,opacity:.5,filter:"grayscale(1)"}}>
              <span style={{fontSize:24}}>{b.icon}</span>
              <span style={{fontSize:9,color:th.text3,fontWeight:600,textAlign:"center",lineHeight:1.2,maxWidth:64}}>{b.label[lang]||b.label.es}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// BODY DOUBLE — virtual co-working presence
// ══════════════════════════════════════════════════════════════════════════
function BodyDoubleCard(){
  const{t,th,lang}=useCtx();const Card=useCard();
  const[active,setActive]=useState(false);
  const[elapsed,setElapsed]=useState(0);
  const[count]=useState(()=>getFocusedCount());
  const timerRef=useRef(null);

  useEffect(()=>{
    if(active){timerRef.current=setInterval(()=>setElapsed(s=>s+1),1000);}
    else{clearInterval(timerRef.current);if(!active)setElapsed(0);}
    return()=>clearInterval(timerRef.current);
  },[active]);

  const fmt=(s)=>`${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  const avatarColors=["#5B9E8F","#7BBFB0","#9B8EC4","#C4867A","#6A9FBF","#C4A97A","#7A94BC","#C07890"];

  return(
    <div style={{...Card({borderRadius:RR.lg,padding:"16px 18px",border:"1px solid "+th.borderLight,background:active?th.gSoft:th.card}),marginTop:12,transition:"background .4s"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
        <div style={{width:32,height:32,borderRadius:10,background:th.gSoft,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={th.g} strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><circle cx="19" cy="7" r="3"/><path d="M22 21v-1a3 3 0 00-3-3h-1"/></svg>
        </div>
        <div style={{flex:1}}>
          <div style={{fontSize:13,fontWeight:600,color:th.text}}>{t.bodyDoubleTitle||"Body double"}</div>
          <div style={{fontSize:11,color:th.text3}}>
            {active
              ?(lang==="es"?`Sesión activa con ${count} personas enfocadas`:`Active session with ${count} people focusing`)
              :(lang==="es"?`${count} personas enfocadas ahora`:`${count} people focusing now`)}
          </div>
        </div>
        {active&&<div style={{fontFamily:F.mono,fontSize:14,color:th.g,fontWeight:600}}>{fmt(elapsed)}</div>}
      </div>

      {active&&(
        <div style={{marginBottom:12}}>
          <div style={{display:"flex",gap:-4,marginBottom:6}}>
            {avatarColors.slice(0,Math.min(count,6)).map((c,i)=>(
              <div key={i} style={{width:28,height:28,borderRadius:"50%",background:c,border:"2px solid "+th.card,marginLeft:i>0?-8:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:"#fff",fontWeight:700}}>
                {String.fromCharCode(65+i)}
              </div>
            ))}
            {count>6&&<div style={{width:28,height:28,borderRadius:"50%",background:th.border,border:"2px solid "+th.card,marginLeft:-8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:th.text3,fontWeight:700}}>+{count-6}</div>}
          </div>
          <div style={{fontSize:11,color:th.text2,fontFamily:F.display,fontStyle:"italic"}}>
            {lang==="es"
              ?`Te has unido a una sala silenciosa con ${count} personas enfocadas.`
              :`You're in a silent room with ${count} people focusing.`}
          </div>
        </div>
      )}

      {!active&&(
        <p style={{fontSize:11,color:th.text3,fontFamily:F.display,fontStyle:"italic",margin:"0 0 10px",lineHeight:1.4}}>
          {lang==="es"
            ?`Únete a una sala silenciosa con ${count} personas enfocadas.`
            :`Join a silent room with ${count} people focusing.`}
        </p>
      )}

      <button onClick={()=>{haptic(active?"medium":"success");setActive(a=>!a);}}
        style={{width:"100%",padding:"11px",borderRadius:12,background:active?th.card:th.g,border:active?"1px solid "+th.border:"none",cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:600,color:active?th.text2:th.btnText,transition:"all .3s"}}>
        {active?(t.bodyDoubleEnd||"Terminar sesión"):(t.bodyDoubleStart||"Unirme a sala silenciosa")}
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// IN-APP REMINDER — scheduled check-in nudge
// ══════════════════════════════════════════════════════════════════════════
function ReminderCard(){
  const{t,th,lang}=useCtx();const Card=useCard();
  const[remindHour,setRemindHour]=useState(null);
  const[shown,setShown]=useState(false);

  useEffect(()=>{
    try{const s=localStorage.getItem("zeno-remind");if(s)setRemindHour(parseInt(s));}catch{}
  },[]);

  useEffect(()=>{
    if(remindHour===null)return;
    const check=()=>{
      const h=new Date().getHours();const m=new Date().getMinutes();
      if(h===remindHour&&m<5&&!shown){setShown(true);haptic("success");}
    };
    check();
    const id=setInterval(check,60000);
    return()=>clearInterval(id);
  },[remindHour,shown]);

  const save=(h)=>{
    setRemindHour(h);
    try{localStorage.setItem("zeno-remind",String(h));}catch{}
  };
  const clear=()=>{
    setRemindHour(null);setShown(false);
    try{localStorage.removeItem("zeno-remind");}catch{}
  };

  const fmt12=(h)=>`${h%12||12}:00${h<12?"am":"pm"}`;
  const hours=[7,8,9,10,12,15,18,20];

  return(
    <div style={{...Card({borderRadius:RR.lg,padding:"16px 18px",border:"1px solid "+(shown?th.gBorder:th.borderLight),background:shown?th.gSoft:th.card}),marginTop:12,transition:"all .4s"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:remindHour!==null?8:12}}>
        <Ic name="bell" size={14} color={remindHour?th.g:th.text3} sw={1.5}/>
        <div style={{flex:1}}>
          <div style={{fontSize:13,fontWeight:600,color:th.text}}>{t.remindTitle||"Recordatorio de check-in"}</div>
          {remindHour!==null&&<div style={{fontSize:11,color:th.g}}>{fmt12(remindHour)} · {t.remindActive||"Activo"}</div>}
        </div>
        {remindHour!==null&&<button onClick={clear} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:th.text3,fontFamily:F.body}}>{t.remindClear||"Desactivar"}</button>}
      </div>

      {shown&&<div style={{fontSize:13,color:th.g,fontFamily:F.display,fontStyle:"italic",marginBottom:10}}>
        {lang==="es"?"¡Es tu hora! Haz tu check-in de energía.":"It's your time! Do your energy check-in."}
      </div>}

      {remindHour===null&&(
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {hours.map(h=>(
            <button key={h} onClick={()=>{haptic("soft");save(h);}}
              style={{padding:"6px 11px",borderRadius:100,background:th.cardAlt,border:"1px solid "+th.borderLight,cursor:"pointer",fontFamily:F.mono,fontSize:11,color:th.text2,transition:"all .2s"}}
              onMouseEnter={e=>{e.currentTarget.style.background=th.gSoft;e.currentTarget.style.borderColor=th.gBorder;e.currentTarget.style.color=th.g;}}
              onMouseLeave={e=>{e.currentTarget.style.background=th.cardAlt;e.currentTarget.style.borderColor=th.borderLight;e.currentTarget.style.color=th.text2;}}>
              {fmt12(h)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// COGNITIVE WINDOW CARD — best hour of the day
// ══════════════════════════════════════════════════════════════════════════
function CogWindowCard(){
  const{th,lang,memory}=useCtx();const Card=useCard();
  const win=getCognitiveWindow(memory,lang);
  if(!win) return null;
  return(
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderRadius:RR.md,background:th.gSoft,border:"1px solid "+th.gBorder,marginTop:8,animation:"fadeIn .5s ease both"}}>
      <span style={{fontSize:16}}>⚡</span>
      <p style={{fontSize:12,color:th.g,margin:0,fontWeight:600,fontFamily:F.display,fontStyle:"italic"}}>{win}</p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ENERGY INSIGHT CARD — 1 pattern insight at a time
// ══════════════════════════════════════════════════════════════════════════
function EnergyInsightCard(){
  const{th,lang,memory}=useCtx();
  if(!memory||memory.length<5)return null;
  const bh={};memory.forEach(m=>{if(!m.ts)return;const h=new Date(m.ts).getHours();if(!bh[h])bh[h]={sum:0,n:0};bh[h].sum+=parseFloat(m.avg)||3;bh[h].n++;});
  let bestH=-1,bestA=0;Object.entries(bh).forEach(([h,v])=>{const a=v.sum/v.n;if(a>bestA){bestA=a;bestH=parseInt(h);}});
  const bd={};memory.forEach(m=>{if(!m.ts)return;const d=new Date(m.ts).getDay();if(!bd[d])bd[d]={sum:0,n:0};bd[d].sum+=parseFloat(m.avg)||3;bd[d].n++;});
  let bestD=-1,bestDA=0;Object.entries(bd).forEach(([d,v])=>{const a=v.sum/v.n;if(a>bestDA){bestDA=a;bestD=parseInt(d);}});
  const fmt=h=>`${h%12||12}${h<12?"am":"pm"}`;
  const daysES=["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
  const daysEN=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  let insight="";
  if(bestH>=0&&bestA>=3.5){
    insight=lang==="es"
      ?`En las últimas semanas, tu energía suele estar más alta entre ${fmt(bestH)} y ${fmt(bestH+1)}. Buen momento para tareas de foco.`
      :`In recent weeks, your energy tends to peak between ${fmt(bestH)} and ${fmt(bestH+1)}. A good window for focus-heavy tasks.`;
  } else if(bestD>=0&&bestDA>=3.5){
    insight=lang==="es"
      ?`Los ${daysES[bestD]} suelen ser tus días con más energía. Aprovéchalo para lo que más te cuesta iniciar.`
      :`${daysEN[bestD]}s tend to be your highest-energy days. A great time for what's hardest to start.`;
  }
  if(!insight)return null;
  return(
    <div style={{display:"flex",alignItems:"flex-start",gap:10,padding:"10px 14px",borderRadius:14,background:th.gSoft,border:"1px solid "+th.gBorder,animation:"fadeIn .5s ease both"}}>
      <span style={{fontSize:15,flexShrink:0}}>📈</span>
      <p style={{fontSize:11,color:th.text2,margin:0,lineHeight:1.55,fontFamily:F.display,fontStyle:"italic",flex:1}}>{insight}</p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// DAILY PLAN FLOW — Plan de hoy basado en energía
// ══════════════════════════════════════════════════════════════════════════
const DAILY_PLAN_PROMPT_ES=(energyLevel,energyScore,timeAvailable,tasksText,userProfile)=>`Eres ZENO, compañero neurointeligente para personas con TDAH y cerebros neurodivergentes.

No es pereza — tu cerebro y tu energía funcionan distinto, y eso es válido.

MISIÓN: Crear un plan de día realista basado en la energía real de la persona, no en lo que "debería" poder hacer.

ESTADO NEUROLÓGICO HOY:
- Nivel de energía: ${energyLevel} (${energyScore}/5)
- Tiempo disponible: ${timeAvailable}
- Perfil: ${userProfile||"cerebro neurodivergente"}

TAREAS QUE LA PERSONA QUIERE HACER:
"${tasksText}"

REGLAS ABSOLUTAS:
1. Máximo 3 bloques. Adapta la cantidad a la energía: baja→1-2 bloques suaves, media→2-3 balanceados, alta→primer bloque ataca lo más evitado.
2. Cada bloque: nombre evocador, duración concreta, foco claro, tareas derivadas de lo que escribió (no inventes), y una acción de autocuidado específica.
3. zapMessage: 1-2 frases de validación cálida. Sin consejos. Solo reconocimiento.
4. PROHIBIDO: deberías, tienes que, es fácil, simplemente, solo haz.
5. Adaptar intensidad: energía baja→mucho autocuidado, pocas tareas; energía alta→primer bloque con la tarea más evitada.

RESPONDE SOLO JSON VÁLIDO:
{"zapMessage":"1-2 frases validando sin juicio","energyLabel":"baja|media|alta","blocks":[{"name":"nombre del bloque","duration":"X min","focus":"foco breve","tasks":["tarea 1","tarea 2"],"selfCare":"acción concreta de autocuidado"}]}`;

const DAILY_PLAN_PROMPT_EN=(energyLevel,energyScore,timeAvailable,tasksText,userProfile)=>`You are ZENO, a neurointelligent companion for ADHD and neurodivergent brains.

It's not laziness — your brain and energy work differently, and that is completely valid.

MISSION: Create a realistic day plan based on the person's real energy, not on what they "should" be able to do.

NEUROLOGICAL STATE TODAY:
- Energy level: ${energyLevel} (${energyScore}/5)
- Time available: ${timeAvailable}
- Profile: ${userProfile||"neurodivergent brain"}

TASKS THE PERSON WANTS TO DO:
"${tasksText}"

ABSOLUTE RULES:
1. Maximum 3 blocks. Adapt count to energy: low→1-2 gentle blocks, medium→2-3 balanced, high→first block tackles the most avoided task.
2. Each block: evocative name, concrete duration, clear focus, tasks derived from what they wrote (don't invent), and a specific self-care action.
3. zapMessage: 1-2 warm validation sentences. No advice. Just acknowledgment.
4. FORBIDDEN: should, must, have to, it's easy, simply, just, just do it.
5. Adapt intensity: low energy→more self-care, fewer tasks; high energy→first block with the most avoided task.

RESPOND WITH VALID JSON ONLY:
{"zapMessage":"1-2 validating sentences without judgment","energyLabel":"low|medium|high","blocks":[{"name":"block name","duration":"X min","focus":"brief focus","tasks":["task 1","task 2"],"selfCare":"concrete self-care action"}]}`;

function DailyPlanView({plan,lang,th,onBack}){
  const blockColors=["#5B9E8F","#6A9FBF","#C4867A"];
  return(
    <div style={{flex:1,overflowY:"auto",padding:"0 20px 28px",display:"flex",flexDirection:"column",gap:14,animation:"fadeIn .45s ease both"}}>
      {/* Validation message */}
      {plan.zapMessage&&(
        <div style={{display:"flex",alignItems:"flex-start",gap:10,padding:"14px 16px",borderRadius:16,background:th.gSoft,border:"1px solid "+th.gBorder}}>
          <span style={{fontSize:18,flexShrink:0}}>✨</span>
          <p style={{fontSize:14,fontFamily:F.display,color:th.text,lineHeight:1.6,margin:0,fontStyle:"italic",flex:1}}>{plan.zapMessage}</p>
        </div>
      )}
      {/* Blocks */}
      {(plan.blocks||[]).map((block,i)=>{
        const bc=blockColors[i%blockColors.length];
        return(
          <div key={i} style={{background:th.card,borderRadius:20,padding:"18px 20px",border:`1.5px solid ${bc}28`,boxShadow:th.shadow,animation:`homeCardIn .5s cubic-bezier(.25,.46,.45,.94) ${.1+i*.1}s both`}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:28,height:28,borderRadius:9,background:bc+"20",border:"1px solid "+bc+"40",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <span style={{fontSize:13,fontFamily:F.mono,fontWeight:700,color:bc}}>{i+1}</span>
                </div>
                <div style={{fontFamily:F.display,fontSize:15,fontWeight:600,color:th.text}}>{block.name}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:5,background:bc+"12",borderRadius:100,padding:"4px 10px"}}>
                <Ic name="clock" size={11} color={bc} sw={1.5}/>
                <span style={{fontSize:11,fontFamily:F.mono,color:bc,fontWeight:600}}>{block.duration}</span>
              </div>
            </div>
            {block.focus&&<p style={{fontSize:12,color:th.text3,fontFamily:F.display,fontStyle:"italic",margin:"0 0 10px",lineHeight:1.4}}>🎯 {block.focus}</p>}
            <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:10}}>
              {(block.tasks||[]).map((task,j)=>(
                <div key={j} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"6px 0"}}>
                  <div style={{width:5,height:5,borderRadius:"50%",background:bc,flexShrink:0,marginTop:5}}/>
                  <span style={{fontSize:13,color:th.text,lineHeight:1.45,flex:1}}>{task}</span>
                </div>
              ))}
            </div>
            {block.selfCare&&(
              <div style={{display:"flex",alignItems:"center",gap:7,padding:"8px 10px",borderRadius:10,background:bc+"0C",border:"1px solid "+bc+"1A"}}>
                <span style={{fontSize:13}}>🌱</span>
                <span style={{fontSize:11,color:bc,fontFamily:F.display,fontStyle:"italic",flex:1}}>{block.selfCare}</span>
              </div>
            )}
          </div>
        );
      })}
      <button onClick={onBack} style={{width:"100%",padding:"13px",borderRadius:14,background:"none",border:"1px solid "+th.borderLight,cursor:"pointer",fontFamily:F.body,fontSize:13,color:th.text2,display:"flex",alignItems:"center",justifyContent:"center",gap:6,minHeight:46}}>
        <Ic name="back" size={14} color={th.text2} sw={1.4}/>
        {lang==="es"?"Volver al inicio":"Back to home"}
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// HOME SUB-COMPONENTS (extracted from IIFEs to satisfy Rules of Hooks)
// ══════════════════════════════════════════════════════════════════════════
function BodyDoubleChip(){
  const{th,lang}=useCtx();
  const[bdOpen,setBdOpen]=useState(false);
  const[active,setActive]=useState(false);
  const[elapsed,setElapsed]=useState(0);
  const count=useState(()=>getFocusedCount())[0];
  const timerRef=useRef(null);
  useEffect(()=>{if(active){timerRef.current=setInterval(()=>setElapsed(s=>s+1),1000);}else{clearInterval(timerRef.current);if(!active)setElapsed(0);}return()=>clearInterval(timerRef.current);},[active]);
  const fmt=s=>`${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  const avatarColors=["#5B9E8F","#7BBFB0","#9B8EC4","#C4867A","#6A9FBF","#C4A97A"];
  if(!bdOpen) return(
    <button onClick={()=>setBdOpen(true)} style={{flex:1,padding:"12px 14px",background:th.card,borderRadius:RR.md,boxShadow:th.shadow,border:`1px solid ${active?th.gBorder:th.borderLight}`,cursor:"pointer",display:"flex",alignItems:"center",gap:8,transition:"all .3s"}}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={active?th.g:th.text3} strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><circle cx="19" cy="7" r="3"/><path d="M22 21v-1a3 3 0 00-3-3h-1"/></svg>
      <div style={{flex:1,textAlign:"left"}}>
        <div style={{fontSize:12,fontWeight:600,color:active?th.g:th.text}}>{lang==="es"?"Body double":"Body double"}</div>
        <div style={{fontSize:10,color:th.text3}}>{active?`${fmt(elapsed)}`:(lang==="es"?`${count} enfocados`:`${count} focusing`)}</div>
      </div>
    </button>
  );
  return(
    <div style={{flex:1,background:active?th.gSoft:th.card,borderRadius:RR.md,boxShadow:th.shadow,border:`1px solid ${active?th.gBorder:th.borderLight}`,padding:"12px 14px",transition:"all .4s"}}>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
        {avatarColors.slice(0,Math.min(count,4)).map((c,i)=>(
          <div key={i} style={{width:22,height:22,borderRadius:"50%",background:c,marginLeft:i>0?-6:0,border:"2px solid "+th.card,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#fff",fontWeight:700}}>{String.fromCharCode(65+i)}</div>
        ))}
        <span style={{fontSize:10,color:th.text3,marginLeft:4}}>{lang==="es"?`${count} enfocados`:`${count} focusing`}</span>
      </div>
      <p style={{fontSize:11,color:th.text2,fontFamily:F.display,fontStyle:"italic",margin:"0 0 8px",lineHeight:1.35}}>
        {active?(lang==="es"?`Sala silenciosa activa — ${fmt(elapsed)}`:`Silent room active — ${fmt(elapsed)}`):(lang==="es"?`Únete a una sala silenciosa con ${count} personas.`:`Join a silent room with ${count} people.`)}
      </p>
      <div style={{display:"flex",gap:6}}>
        <button onClick={()=>{haptic(active?"medium":"success");setActive(a=>!a);}} style={{flex:1,padding:"8px",borderRadius:10,background:active?th.card:th.g,border:active?"1px solid "+th.border:"none",cursor:"pointer",fontFamily:F.body,fontSize:11,fontWeight:600,color:active?th.text2:"#fff",transition:"all .3s"}}>
          {active?(lang==="es"?"Salir":"Leave"):(lang==="es"?"Entrar":"Join")}
        </button>
        <button onClick={()=>{setBdOpen(false);setActive(false);}} style={{padding:"8px 10px",borderRadius:10,background:"none",border:"1px solid "+th.borderLight,cursor:"pointer",fontSize:10,color:th.text3}}>✕</button>
      </div>
    </div>
  );
}

function ReminderChip(){
  const{th,lang}=useCtx();
  const[rOpen,setROpen]=useState(false);
  const[rHour,setRHour]=useState(()=>{try{const v=localStorage.getItem("zeno-remind");return v?parseInt(v):null;}catch{return null;}});
  const fmt12=h=>`${h%12||12}${h<12?"am":"pm"}`;
  const saveH=h=>{setRHour(h);try{localStorage.setItem("zeno-remind",String(h));}catch{}};
  const clearH=()=>{setRHour(null);try{localStorage.removeItem("zeno-remind");}catch{}};
  if(!rOpen) return(
    <button onClick={()=>setROpen(true)} style={{flex:1,padding:"12px 14px",background:th.card,borderRadius:RR.md,boxShadow:th.shadow,border:`1px solid ${rHour?th.gBorder:th.borderLight}`,cursor:"pointer",display:"flex",alignItems:"center",gap:8,transition:"all .3s"}}>
      <Ic name="bell" size={16} color={rHour?th.g:th.text3} sw={1.5}/>
      <div style={{flex:1,textAlign:"left"}}>
        <div style={{fontSize:12,fontWeight:600,color:rHour?th.g:th.text}}>{lang==="es"?"Aviso":"Reminder"}</div>
        {rHour!==null&&<div style={{fontFamily:F.mono,fontSize:10,color:th.g}}>{fmt12(rHour)}</div>}
      </div>
    </button>
  );
  return(
    <div style={{flex:1,background:th.card,borderRadius:RR.md,boxShadow:th.shadow,border:"1px solid "+th.borderLight,padding:"12px 14px"}}>
      <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:8}}>
        {[7,9,12,15,18,20].map(h=>(
          <button key={h} onClick={()=>{haptic("soft");saveH(h);setROpen(false);}}
            style={{padding:"5px 9px",borderRadius:100,background:rHour===h?th.gSoft:th.cardAlt,border:"1px solid "+(rHour===h?th.gBorder:th.borderLight),cursor:"pointer",fontFamily:F.mono,fontSize:10,color:rHour===h?th.g:th.text2,transition:"all .2s"}}>
            {fmt12(h)}
          </button>
        ))}
      </div>
      <div style={{display:"flex",gap:6}}>
        {rHour&&<button onClick={clearH} style={{flex:1,padding:"6px",borderRadius:8,background:"none",border:"1px solid "+th.borderLight,cursor:"pointer",fontSize:10,color:th.text3,fontFamily:F.body}}>{lang==="es"?"Quitar":"Clear"}</button>}
        <button onClick={()=>setROpen(false)} style={{flex:1,padding:"6px",borderRadius:8,background:"none",border:"1px solid "+th.borderLight,cursor:"pointer",fontSize:10,color:th.text3}}>✕</button>
      </div>
    </div>
  );
}

function BadgesPreview(){
  const{th,lang,badges}=useCtx();
  const earned=(badges||[]).map(id=>BADGES_DEF.find(b=>b.id===id)).filter(Boolean);
  if(earned.length===0)return null;
  const recent=earned.slice(-4);
  return(
    <div style={{background:th.card,borderRadius:RR.lg,boxShadow:th.shadow,border:"1px solid "+th.borderLight,padding:"12px 16px",animation:"homeCardIn .5s cubic-bezier(.25,.46,.45,.94) .46s both"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          <span style={{fontSize:13}}>🏆</span>
          <span style={{fontSize:10,color:th.text3,letterSpacing:2,textTransform:"uppercase",fontWeight:500}}>{lang==="es"?"Logros":"Achievements"}</span>
          <span style={{background:th.gBtn,color:"#fff",fontSize:9,fontWeight:700,borderRadius:100,padding:"1px 7px"}}>{earned.length}</span>
        </div>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        {recent.map(b=>(
          <div key={b.id} title={b.sub[lang]||b.sub.es}
            style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"8px 10px",borderRadius:12,background:th.gSoft,border:"1px solid "+th.gBorder,flex:1,animation:"fadeIn .4s ease both"}}>
            <span style={{fontSize:22}}>{b.icon}</span>
            <span style={{fontSize:8,color:th.g,fontWeight:600,textAlign:"center",lineHeight:1.2}}>{b.label[lang]||b.label.es}</span>
          </div>
        ))}
        {earned.length>4&&<div style={{width:40,height:40,borderRadius:12,background:th.cardAlt,border:"1px solid "+th.borderLight,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <span style={{fontSize:11,color:th.text3,fontWeight:700}}>+{earned.length-4}</span>
        </div>}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ENERGY GATE — daily check-in before showing tasks
// ══════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════
// HOME
// ══════════════════════════════════════════════════════════════════════════
function QuickLogCard({lang,th}){
  const Card=useCard();
  const today=new Date().toISOString().slice(0,10);
  const SK="zeno-quicklog";
  const[log,setLog]=useState(()=>{try{return JSON.parse(localStorage.getItem(SK)||"{}");}catch{return {};}});
  const cur=log[today]||{sleep:null,meds:null};
  const update=(k,v)=>{
    const updated={...log,[today]:{...cur,[k]:v}};
    setLog(updated);try{localStorage.setItem(SK,JSON.stringify(updated));}catch{}
    haptic("soft");
  };
  const SLEEP=[{v:4,l:"4h"},{v:6,l:"6h"},{v:7.5,l:"7.5h"},{v:9,l:"9h"}];
  return(
    <div style={{...Card({borderRadius:RR.lg,padding:"16px 18px"})}}>
      <div style={{fontSize:10,color:th.text3,letterSpacing:3,textTransform:"uppercase",marginBottom:12}}>
        {lang==="es"?"Registro rápido":"Quick Log"}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        <div>
          <div style={{fontSize:12,color:th.text2,marginBottom:6}}>😴 {lang==="es"?"Horas de sueño":"Sleep hours"}</div>
          <div style={{display:"flex",gap:6}}>
            {SLEEP.map(s=>(
              <button key={s.v} onClick={()=>update("sleep",cur.sleep===s.v?null:s.v)} style={{flex:1,padding:"8px 0",borderRadius:RR.sm,background:cur.sleep===s.v?th.gSoft:th.card,border:`1px solid ${cur.sleep===s.v?th.gBorder:th.border}`,cursor:"pointer",fontSize:12,color:cur.sleep===s.v?th.g:th.text2,fontWeight:cur.sleep===s.v?600:400,transition:"all .25s"}}>
                {s.l}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div style={{fontSize:12,color:th.text2,marginBottom:6}}>💊 {lang==="es"?"Medicación":"Medication"}</div>
          <div style={{display:"flex",gap:6}}>
            {[{v:true,l:lang==="es"?"Sí":"Yes",c:"#10B981"},{v:false,l:lang==="es"?"No":"No",c:"#EF4444"},{v:null,l:lang==="es"?"N/A":"N/A",c:th.text3}].map((m,i)=>(
              <button key={i} onClick={()=>update("meds",cur.meds===m.v?undefined:m.v)} style={{flex:1,padding:"8px 0",borderRadius:RR.sm,background:cur.meds===m.v?th.gSoft:th.card,border:`1px solid ${cur.meds===m.v?th.gBorder:th.border}`,cursor:"pointer",fontSize:12,color:cur.meds===m.v?m.c:th.text2,fontWeight:cur.meds===m.v?600:400,transition:"all .25s"}}>
                {m.l}
              </button>
            ))}
          </div>
        </div>
      </div>
      {(cur.sleep!==null&&cur.sleep!==undefined)||(cur.meds!==null&&cur.meds!==undefined)?<div style={{marginTop:10,padding:"8px 12px",borderRadius:RR.sm,background:th.gSoft,border:`1px solid ${th.gBorder}`,fontSize:11,color:th.g,lineHeight:1.5}}>
        {cur.sleep&&cur.sleep<6?lang==="es"?"💙 Sueño corto — TDAH necesita 7-9h para función ejecutiva óptima":"💙 Short sleep — ADHD needs 7-9h for optimal executive function"
        :cur.sleep&&cur.sleep>=7?lang==="es"?"✨ Buen sueño registrado":"✨ Good sleep logged"
        :cur.meds===true?lang==="es"?"✅ Medicación registrada":"✅ Medication logged"
        :cur.meds===false?lang==="es"?"💙 Sin medicación hoy — puede ser día de más auto-compasión":"💙 No meds today — may need extra self-compassion"
        :""}
      </div>:null}
    </div>
  );
}

function HabitTracker({lang,th}){
  const Card=useCard();
  const DEF=[{id:"water",emoji:"💧",es:"Agua",en:"Water"},{id:"move",emoji:"🚶",es:"Moverme",en:"Move"},{id:"sleep",emoji:"😴",es:"Dormir bien",en:"Sleep well"},{id:"meds",emoji:"💊",es:"Meds",en:"Meds"},{id:"focus",emoji:"🎯",es:"Foco 25min",en:"Focus 25min"}];
  const today=new Date().toISOString().slice(0,10);
  const[log,setLog]=useState(()=>{try{return JSON.parse(localStorage.getItem(HABITS_LOG_KEY)||"{}");}catch{return {};}});
  const toggle=(id)=>{
    setLog(l=>{
      const k=today;const cur=l[k]||[];
      const next=cur.includes(id)?cur.filter(x=>x!==id):[...cur,id];
      const updated={...l,[k]:next};
      try{localStorage.setItem(HABITS_LOG_KEY,JSON.stringify(updated));}catch{}
      return updated;
    });
    haptic("soft");
  };
  const todayLog=log[today]||[];
  const done=todayLog.length;
  return(
    <div style={{...Card({borderRadius:RR.lg,padding:"16px 18px"})}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <div style={{fontSize:10,color:th.text3,letterSpacing:3,textTransform:"uppercase",display:"flex",alignItems:"center",gap:6}}>
          <Ic name="check" size={13} color={th.text3} sw={1.3}/>
          {lang==="es"?"Hábitos de hoy":"Today's Habits"}
        </div>
        <div style={{fontSize:11,color:th.g,fontWeight:600}}>{done}/{DEF.length}</div>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {DEF.map(h=>{
          const on=todayLog.includes(h.id);
          return(
            <button key={h.id} onClick={()=>toggle(h.id)} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 12px",borderRadius:100,background:on?th.gSoft:th.card,border:`1px solid ${on?th.gBorder:th.border}`,cursor:"pointer",transition:"all .25s ease"}}>
              <span style={{fontSize:16,opacity:on?1:.5,transition:"opacity .25s"}}>{h.emoji}</span>
              <span style={{fontSize:12,color:on?th.g:th.text2,fontWeight:on?600:400,transition:"color .25s"}}>{lang==="es"?h.es:h.en}</span>
            </button>
          );
        })}
      </div>
      {done===DEF.length&&<div style={{marginTop:10,padding:"8px 12px",borderRadius:RR.sm,background:th.gSoft,border:`1px solid ${th.gBorder}`,textAlign:"center",fontSize:12,color:th.g,fontWeight:600,animation:"fadeIn .4s ease both"}}>
        ✨ {lang==="es"?"¡Hábitos completos! Excelente día.":"All habits done! Great day."}
      </div>}
    </div>
  );
}

function XPBar({lang,th}){
  const{xp}=useCtx();
  const level=getLevel(xp);
  const next=getNextLevel(xp);
  const pct=getLevelProgress(xp);
  return(
    <div style={{display:"flex",alignItems:"center",gap:10,marginTop:6,animation:"fadeIn .5s ease .1s both"}}>
      <span style={{fontSize:14}}>{level.emoji}</span>
      <div style={{flex:1}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
          <span style={{fontSize:10,fontWeight:700,color:level.color,letterSpacing:.5}}>{lang==="es"?level.nameEs:level.name}</span>
          <span style={{fontSize:10,color:th.text3,fontFamily:F.mono}}>{xp} XP</span>
        </div>
        <div style={{height:4,borderRadius:4,background:th.cardAlt,overflow:"hidden"}}>
          <div style={{height:"100%",borderRadius:4,background:`linear-gradient(90deg,${level.color},${level.color}cc)`,width:`${Math.round(pct*100)}%`,transition:"width .8s cubic-bezier(.25,.46,.45,.94)"}}/>
        </div>
      </div>
      {next&&<span style={{fontSize:9,color:th.text3,textAlign:"right",lineHeight:1.3,maxWidth:40}}>{next.emoji}<br/>{next.max-xp+1} XP</span>}
    </div>
  );
}
function HomeTab({flow,setFlow}){
  const{t,th,userName,memory,addMemory,lang,brainType,challenge,savedTasks}=useCtx();const Card=useCard();
  const[scores,setScores]=useState({body:3,mind:3,heart:3,drive:3});const[mascotKey,setMascotKey]=useState(0);
  const[step,setStep]=useState("check");const[goalText,setGoalText]=useState("");
  const[aiTasks,setAiTasks]=useState([]);const[taskIdx,setTaskIdx]=useState(0);const[aiMsg,setAiMsg]=useState("");
  // Daily Plan flow state
  const[dailyPlanStep,setDailyPlanStep]=useState("home"); // "home"|"time"|"tasks"|"loading"|"result"
  const[dailyPlanTime,setDailyPlanTime]=useState("");
  const[dailyPlanTimeCustom,setDailyPlanTimeCustom]=useState("");
  const[dailyPlanTasks,setDailyPlanTasks]=useState("");
  const[dailyPlan,setDailyPlan]=useState(null);
  const[now,setNow]=useState(()=>new Date());useEffect(()=>{const id=setInterval(()=>setNow(new Date()),60000);return()=>clearInterval(id);},[]);
  const lvI=getLv(scores);const lv={...LV[lvI],...t.levels[lvI]};
  const avg=((scores.body+scores.mind+scores.heart+scores.drive)/4).toFixed(1);
  const energyUI=getEnergyUIState(avg,scores);
  const memStr=memory.length>0?memory.slice(-5).map(m=>`${m.date}: Energy=${m.avg}, Level=${m.level}, Tasks=${m.tasks}`).join("\n"):"";const userProfile=buildUserProfile(memory,userName,lang||"es")+(brainType?" Brain:"+brainType:"")+(challenge?" Challenge:"+challenge:"");
  const pendingTasksStr=(savedTasks||[]).filter(tk=>!tk.done).map(tk=>tk.text).join(", ");
  const streak=memory.length;
  const todayDone=(savedTasks||[]).filter(tk=>tk.done&&tk.completedAt&&new Date(tk.completedAt).toDateString()===new Date().toDateString()).length;

  // ── runDailyPlanAI — Plan de hoy basado en energía ──
  const runDailyPlanAI=async()=>{
    setDailyPlanStep("loading");
    const timeStr=dailyPlanTime==="otro"?dailyPlanTimeCustom:dailyPlanTime;
    const profile=userProfile||memStr;
    const prompt=lang==="es"
      ?DAILY_PLAN_PROMPT_ES(lv.label,avg,timeStr,dailyPlanTasks,profile)
      :DAILY_PLAN_PROMPT_EN(lv.label,avg,timeStr,dailyPlanTasks,profile);
    try{
      const _rawTx=await aiCall({max_tokens:1000,messages:[{role:"user",content:prompt}]});
      const tx=_rawTx.replace(/```json|```/g,"").trim();
      const p=JSON.parse(tx);
      if(p.zapMessage)p.zapMessage=zenoCheckOutput(p.zapMessage,lang);
      // Fill missing or empty selfCare on each block with pickSelfCare
      const _avgNum=parseFloat(avg);
      if(Array.isArray(p.blocks)){
        p.blocks=p.blocks.map(block=>{
          const sc=block.selfCare;
          const isEmpty=!sc||sc.trim()===""||sc.trim().length<6;
          return isEmpty?{...block,selfCare:pickSelfCare(_avgNum,lang,1)[0]}:block;
        });
      }
      setDailyPlan(p);setDailyPlanStep("result");
    }catch{
      setDailyPlan({
        zapMessage:lang==="es"?"Sin conexión, pero aquí estoy. Este plan básico siempre funciona.":"No connection, but I'm here. This basic plan always works.",
        energyLabel:parseFloat(avg)<=2?"baja":"media",
        blocks:[{name:lang==="es"?"Un paso":"One step",duration:"15 min",focus:lang==="es"?"Lo que puedas":"What you can",tasks:dailyPlanTasks.split("\n").filter(l=>l.trim()).slice(0,2),selfCare:pickSelfCare(parseFloat(avg),lang)[0]}]
      });
      setDailyPlanStep("result");
    }
  };

  const runAI=async()=>{setStep("loading");try{const _rawAI=await aiCall({max_tokens:1000,messages:[{role:"user",content:t.aiPrompt(scores,lv.label,avg,goalText.trim(),userProfile||memStr,pendingTasksStr||"")}]});const tx=_rawAI.replace(/```json|```/g,"").trim();const p=JSON.parse(tx);
      const _rawMsg=p.zapMessage||t.aiFallbackMsg;
      const _safeMsg=zenoCheckOutput(_rawMsg,lang);
      setAiTasks(p.tasks||[]);setAiMsg(_safeMsg);setTaskIdx(0);setStep("task");}catch(err){setAiTasks(t.aiFallback);setAiMsg(t.aiFallbackMsg);setTaskIdx(0);setStep("task");}};
  const done=()=>{if(!aiTasks[taskIdx])return;haptic('success');const tk=aiTasks[taskIdx];if(tk)setFlow(f=>Math.min(10,f+tk.flow/10));if(taskIdx+1<aiTasks.length)setTaskIdx(i=>i+1);else{setStep("done");addMemory({date:new Date().toLocaleDateString(),avg,level:lv.label,tasks:aiTasks.length,scores:{...scores},ts:Date.now()});}};
  const reset=()=>{setStep("check");setAiTasks([]);setTaskIdx(0);};const cur=aiTasks[taskIdx];const h=now.getHours();

  // ── DAILY PLAN: Result screen ──
  if(dailyPlanStep==="result"&&dailyPlan) return(
    <DailyPlanView plan={dailyPlan} lang={lang} th={th} onBack={()=>{setDailyPlanStep("home");setDailyPlan(null);setDailyPlanTasks("");setDailyPlanTime("");setDailyPlanTimeCustom("");}}/>
  );

  // ── DAILY PLAN: Loading screen ──
  if(dailyPlanStep==="loading") return(
    <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:20,padding:"0 22px",animation:"fadeIn .5s ease both"}}>
      <Spirit size={70} animated variant="kawaii" mood="thinking" showAura lvIndex={lvI}/>
      <div style={{textAlign:"center"}}>
        <div style={{fontFamily:F.display,fontSize:18,color:th.text,marginBottom:8}}>{lang==="es"?"Creando tu plan...":"Building your plan..."}</div>
        <div style={{display:"flex",gap:5,justifyContent:"center",marginBottom:6}}>{[0,1,2].map(j=><div key={j} style={{width:7,height:7,borderRadius:"50%",background:th.gBtn,animation:`dotB 1.6s ease-in-out infinite`,animationDelay:`${j*.22}s`}}/>)}</div>
        <div style={{fontSize:12,color:th.text3,fontFamily:F.display,fontStyle:"italic"}}>{lang==="es"?"Adaptando a tu energía de hoy":"Adapting to your energy today"}</div>
      </div>
    </div>
  );

  // ── DAILY PLAN: Tasks input screen ──
  if(dailyPlanStep==="tasks") return(
    <div style={{flex:1,overflowY:"auto",padding:"0 20px 28px",display:"flex",flexDirection:"column",gap:14,animation:"fadeIn .4s ease both"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderRadius:14,background:th.gSoft,border:"1px solid "+th.gBorder}}>
        <span style={{fontSize:18}}>{lv.emoji}</span>
        <div><div style={{fontSize:12,fontWeight:600,color:th.g}}>{lv.label} · {avg}/5</div><div style={{fontSize:10,color:th.text3}}>{lang==="es"?"⏱ "+dailyPlanTime:"⏱ "+dailyPlanTime}</div></div>
      </div>
      <div style={{display:"flex",alignItems:"flex-end",gap:10}}>
        <Spirit size={38} animated variant="mini" mood="thinking" lvIndex={lvI}/>
        <div style={{...Card({borderRadius:"16px 16px 16px 4px",padding:"12px 16px",flex:1,background:th.gSoft,border:"1px solid "+th.gBorder})}} >
          <p style={{fontSize:13,fontFamily:F.display,color:th.text,lineHeight:1.55,margin:0,fontStyle:"italic"}}>
            {lang==="es"
              ?"Vomita aquí todo lo que quieres o necesitas hacer hoy. Sin orden, sin filtro."
              :"Dump here everything you want or need to do today. No order, no filter."}
          </p>
        </div>
      </div>
      <div style={{...Card({borderRadius:RR.lg,padding:0,border:"1.5px solid "+th.gBorder}),overflow:"hidden"}}>
        <textarea value={dailyPlanTasks} onChange={e=>setDailyPlanTasks(e.target.value)} autoFocus
          placeholder={lang==="es"
            ?"Ej:\n· Responder emails\n· Terminar el informe\n· Llamar al médico\n· Organizar el escritorio..."
            :"E.g.:\n· Reply emails\n· Finish the report\n· Call the doctor\n· Clean my desk..."}
          style={{width:"100%",minHeight:130,background:"transparent",border:"none",outline:"none",fontSize:14,color:th.text,lineHeight:1.75,resize:"none",padding:"14px 16px",fontFamily:F.body,boxSizing:"border-box"}}/>
        <div style={{padding:"4px 16px 10px",display:"flex",justifyContent:"flex-end"}}>
          <span style={{fontSize:11,color:dailyPlanTasks.trim()?th.g:th.text3,fontWeight:600,transition:"color .3s"}}>
            {dailyPlanTasks.trim()?dailyPlanTasks.split("\n").filter(l=>l.trim()).length+" "+(lang==="es"?"elemento(s)":"item(s)"):""}
          </span>
        </div>
      </div>
      <div style={{display:"flex",gap:10}}>
        <button onClick={()=>setDailyPlanStep("time")} style={{flex:1,padding:"14px",borderRadius:RR.md,...Card(),cursor:"pointer",fontSize:13,color:th.text2,fontFamily:F.body,display:"flex",alignItems:"center",justifyContent:"center",gap:6,minHeight:48}}>
          <Ic name="back" size={14} color={th.text2} sw={1.5}/>{lang==="es"?"Atrás":"Back"}
        </button>
        <button onClick={runDailyPlanAI} disabled={!dailyPlanTasks.trim()}
          style={{flex:2.5,padding:"14px",borderRadius:RR.md,background:dailyPlanTasks.trim()?th.gBtn:th.cardAlt,border:"none",cursor:dailyPlanTasks.trim()?"pointer":"default",fontSize:14,fontWeight:700,color:dailyPlanTasks.trim()?th.btnText:th.text3,fontFamily:F.body,boxShadow:"none",display:"flex",alignItems:"center",justifyContent:"center",gap:8,transition:"all .28s",minHeight:48}}>
          <Ic name="sparkle" size={16} color={dailyPlanTasks.trim()?"#fff":th.text3} sw={2}/>
          {lang==="es"?"Crear plan":"Build plan"}
        </button>
      </div>
    </div>
  );

  // ── DAILY PLAN: Time selection screen ──
  if(dailyPlanStep==="time"){
    const timeChips=lang==="es"
      ?["30 min","60 min","90 min","2 horas","3 horas","otro"]
      :["30 min","60 min","90 min","2 hours","3 hours","other"];
    const otherKey=lang==="es"?"otro":"other";
    return(
      <div style={{flex:1,overflowY:"auto",padding:"0 20px 28px",display:"flex",flexDirection:"column",gap:16,animation:"fadeIn .4s ease both"}}>
        <div style={{textAlign:"center",padding:"12px 0 4px"}}>
          <Spirit size={50} animated variant="mini" mood="thinking" lvIndex={lvI}/>
          <div style={{fontFamily:F.display,fontSize:17,fontWeight:500,color:th.text,marginTop:12,marginBottom:4}}>
            {lang==="es"?"¿Cuánto tiempo tienes hoy?":"How much time do you have today?"}
          </div>
          <p style={{fontSize:12,color:th.text3,margin:0,lineHeight:1.5}}>
            {lang==="es"?"Sin presión — ZENO adapta el plan al tiempo real que tienes.":"No pressure — ZENO adapts the plan to the actual time you have."}
          </p>
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:10,justifyContent:"center"}}>
          {timeChips.map(chip=>(
            <button key={chip} onClick={()=>{haptic("soft");setDailyPlanTime(chip);if(chip!==otherKey)setDailyPlanStep("tasks");}}
              style={{padding:"11px 20px",borderRadius:100,background:dailyPlanTime===chip?th.gSoft:th.cardAlt,border:"1.5px solid "+(dailyPlanTime===chip?th.g:th.borderLight),cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:dailyPlanTime===chip?700:400,color:dailyPlanTime===chip?th.g:th.text2,transition:"all .22s"}}>
              {chip}
            </button>
          ))}
        </div>
        {dailyPlanTime===otherKey&&(
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            <input value={dailyPlanTimeCustom} onChange={e=>setDailyPlanTimeCustom(e.target.value)}
              placeholder={lang==="es"?"Ej: 75 minutos, 4 horas...":"E.g.: 75 minutes, 4 hours..."}
              style={{flex:1,padding:"12px 16px",borderRadius:12,background:th.cardAlt,border:"1.5px solid "+th.gBorder,fontSize:14,color:th.text,fontFamily:F.body,outline:"none"}}/>
            <button onClick={()=>{if(dailyPlanTimeCustom.trim())setDailyPlanStep("tasks");}}
              disabled={!dailyPlanTimeCustom.trim()}
              style={{padding:"12px 18px",borderRadius:12,background:dailyPlanTimeCustom.trim()?th.gBtn:th.cardAlt,border:"none",cursor:dailyPlanTimeCustom.trim()?"pointer":"default",color:"#fff",fontFamily:F.body,fontSize:13,fontWeight:600}}>
              {lang==="es"?"Continuar":"Continue"}
            </button>
          </div>
        )}
        <button onClick={()=>setDailyPlanStep("home")} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:th.text3,fontFamily:F.body,display:"flex",alignItems:"center",justifyContent:"center",gap:5,minHeight:40}}>
          <Ic name="back" size={13} color={th.text3} sw={1.3}/>{lang==="es"?"Volver":"Back"}
        </button>
      </div>
    );
  }

  if(step==="check") return(
    <div style={{flex:1,overflowY:"auto",WebkitOverflowScrolling:"touch",padding:"0 20px 28px",position:"relative"}}>

      {/* ── Ambient glow reacts to energy level ── */}
      <div style={{position:"absolute",top:-40,left:"50%",transform:"translateX(-50%)",width:300,height:300,borderRadius:"50%",background:"radial-gradient(circle,"+lv.c1+"16 0%,"+lv.c2+"08 50%,transparent 72%)",pointerEvents:"none",transition:"background 1.8s ease",zIndex:0,animation:"ambientDrift 16s ease-in-out infinite"}}/>

      <div style={{position:"relative",zIndex:1,display:"flex",flexDirection:"column",gap:14}}>

        {/* ══ BLOQUE 1: CONTEXTO — fecha + racha + ventana cognitiva ══ */}
        {/* Propósito TDAH: orientación temporal inmediata (combate la ceguera temporal) */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",paddingTop:8,animation:"fadeSlideUp .4s ease both"}}>
          <div style={{display:"flex",flexDirection:"column",gap:2}}>
            <div style={{fontSize:12,color:th.text3,letterSpacing:1,fontWeight:500}}>
              {lang==="es"
                ?["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"][now.getDay()]+" · "+now.getDate()+" "+["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"][now.getMonth()]
                :now.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}
            </div>
            {/* Cognitive window inline — tiny, non-intrusive */}
            {(()=>{const win=getCognitiveWindow(memory,lang);return win&&<div style={{fontSize:11,color:lv.c1,fontWeight:600,fontFamily:F.mono}}>⚡ {win}</div>;})()}
          </div>
          {/* Streak + today wins — dopamine anchor */}
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            {streak>0&&(
              <div style={{display:"flex",alignItems:"center",gap:5,background:lv.c1+"18",borderRadius:100,padding:"5px 12px",border:"1px solid "+lv.c1+"30",animation:"streakPop .5s cubic-bezier(.34,1.56,.64,1) .3s both"}}>
                <span style={{fontSize:14}}>🔥</span>
                <span style={{fontFamily:F.mono,fontSize:13,fontWeight:700,color:lv.c1}}>{streak}</span>
                <span style={{fontSize:10,color:th.text3}}>{t.streakLabel}</span>
              </div>
            )}
            {todayDone>0&&(
              <div style={{display:"flex",alignItems:"center",gap:5,padding:"5px 10px",borderRadius:100,background:th.cardAlt||th.card,border:`1px solid ${th.border}`,animation:"streakPop .5s cubic-bezier(.34,1.56,.64,1) .45s both"}}>
                <span style={{fontSize:13}}>✅</span>
                <span style={{fontFamily:F.mono,fontSize:12,fontWeight:600,color:th.text2}}>{todayDone}</span>
                <span style={{fontSize:10,color:th.text3,letterSpacing:1}}>{lang==="es"?"hoy":"today"}</span>
              </div>
            )}
          </div>
        </div>

        {/* XP Progress Bar */}
        <XPBar lang={lang} th={th}/>

        {/* ══ BLOQUE 2: ORB DE ENERGÍA ══ */}
        <div style={{animation:"homeCardIn .5s cubic-bezier(.25,.46,.45,.94) .05s both"}}>
          {/* ── Single large energy question header ── */}
          <div style={{textAlign:"center",marginBottom:6,position:"relative"}}>
            <div style={{
              position:"absolute",left:"50%",top:"50%",
              transform:"translate(-50%,-50%)",
              width:260,height:60,
              borderRadius:"50%",
              background:`radial-gradient(ellipse,${lv.c1}22 0%,transparent 72%)`,
              pointerEvents:"none",
              animation:"haloBreath 3.5s ease-in-out infinite",
            }}/>
            <div style={{
              position:"relative",
              fontFamily:F.display,
              fontSize:18,
              fontWeight:600,
              letterSpacing:-.3,
              lineHeight:1.15,
              color:lv.c1,
              transition:"color .5s ease",
              animation:"shimmerText 3.8s linear infinite",
            }}>
              {lang==="es"?"¿Cómo está tu energía hoy?":"How's your energy today?"}
            </div>
            <div style={{
              width:48,height:2,margin:"6px auto 0",
              borderRadius:100,
              background:`linear-gradient(90deg,transparent,${lv.c1},transparent)`,
              transition:"background .5s ease",
            }}/>
          </div>
          <EnergyRing scores={scores} setScores={setScores} setMascotKey={setMascotKey} lv={lv} th={th} t={t} lang={lang} F={F} avg={avg}/>
        </div>

        {/* ══ BLOQUE 3: UNA PREGUNTA, 3 ESTADOS ══ */}
        {/* TDAH: menos decisiones. 1 pregunta captura todo. */}
        {(()=>{
          // Estado bajo  (1-2): todas las dimensiones en bajo
          // Estado medio (3):   todas en medio
          // Estado alto  (4-5): todas en alto
          const cur = Math.round((scores.body+scores.mind+scores.heart+scores.drive)/4);
          const selIdx = cur<=2?0:cur===3?1:2;

          const pickState=(idx)=>{
            const v=[1,3,5][idx];
            haptic("soft");
            setScores({body:v,mind:v,heart:v,drive:v});
            setMascotKey(k=>k+1);
          };

          // 3 estados con SVG único que combina las 4 dimensiones visualmente
          const STATES = [
            {
              // BAJO — todo apagado, sistema nervioso en reposo
              name: lang==="es"?"Bajo":"Low",
              sub:  lang==="es"?"El sistema necesita descanso":"The system needs rest",
              color:"#8BA4C0",
              svg:(c)=>(
                <svg width="80" height="64" viewBox="0 0 80 64" style={{overflow:"visible"}}>
                  {/* Luna creciente — símbolo de reposo */}
                  <path d="M40 10 C28 10 18 20 18 32 C18 44 28 54 40 54 C32 48 26 40 26 32 C26 24 32 16 40 10Z"
                    fill={c} opacity="0.7"/>
                  {/* Ondas planas debajo */}
                  <path d="M10 52 Q25 56 40 52 Q55 48 70 52" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" opacity="0.3"/>
                  <path d="M16 58 Q32 61 48 58 Q60 55 68 58" fill="none" stroke={c} strokeWidth="1" strokeLinecap="round" opacity="0.18"/>
                  {/* Estrella pequeña */}
                  <circle cx="56" cy="16" r="2" fill={c} opacity="0.5"/>
                  <circle cx="62" cy="26" r="1.5" fill={c} opacity="0.35"/>
                  <circle cx="50" cy="8"  r="1.5" fill={c} opacity="0.4"/>
                </svg>
              )
            },
            {
              // MEDIO — sistema disponible, presente
              name: lang==="es"?"Presente":"Present",
              sub:  lang==="es"?"El cerebro está disponible":"Brain is available",
              color:"#5B9E8F",
              svg:(c)=>(
                <svg width="80" height="64" viewBox="0 0 80 64" style={{overflow:"visible"}}>
                  {/* Ojo abierto con red neuronal */}
                  <path d="M12 32 C24 16 34 10 40 10 C46 10 56 16 68 32 C56 48 46 54 40 54 C34 54 24 48 12 32Z"
                    fill="none" stroke={c} strokeWidth="1.8" opacity="0.5"/>
                  {/* Nodos conectados dentro */}
                  <line x1="26" y1="28" x2="40" y2="22" stroke={c} strokeWidth="1" opacity="0.4" style={{animation:"synapsePulse 2.2s ease-in-out infinite"}}/>
                  <line x1="40" y1="22" x2="54" y2="28" stroke={c} strokeWidth="1" opacity="0.4" style={{animation:"synapsePulse 2.2s ease-in-out .5s infinite"}}/>
                  <line x1="30" y1="38" x2="40" y2="22" stroke={c} strokeWidth="1" opacity="0.3" style={{animation:"synapsePulse 2.2s ease-in-out 1s infinite"}}/>
                  <circle cx="26" cy="28" r="4" fill={c} opacity="0.55"/>
                  <circle cx="40" cy="22" r="6" fill={c} opacity="0.8" style={{animation:"pulse 2.8s ease-in-out infinite"}}/>
                  <circle cx="40" cy="22" r="2.5" fill="#fff" opacity="0.5"/>
                  <circle cx="54" cy="28" r="4" fill={c} opacity="0.55"/>
                  <circle cx="30" cy="38" r="3.5" fill={c} opacity="0.4"/>
                  <circle cx="50" cy="38" r="3.5" fill={c} opacity="0.4"/>
                </svg>
              )
            },
            {
              // ALTO — todo encendido, sol + llama + sinapsis activas
              name: lang==="es"?"Pleno":"Full",
              sub:  lang==="es"?"Dopamina alta, todo activo":"High dopamine, all systems go",
              color:"#C4867A",
              svg:(c)=>(
                <svg width="80" height="64" viewBox="0 0 80 64" style={{overflow:"visible"}}>
                  {/* Sol radiante */}
                  <circle cx="40" cy="28" r="18" fill={c} opacity="0.9" style={{filter:`drop-shadow(0 0 10px ${c}70)`,animation:"symbolFloat 2.8s ease-in-out infinite"}}/>
                  <circle cx="40" cy="28" r="10" fill="#fff" opacity="0.2"/>
                  {/* Rayos */}
                  <line x1="40" y1="4"  x2="40" y2="12" stroke={c} strokeWidth="2.5" strokeLinecap="round" opacity="0.9" style={{animation:"sunRay0 1.8s ease-in-out infinite"}}/>
                  <line x1="40" y1="44" x2="40" y2="52" stroke={c} strokeWidth="2.5" strokeLinecap="round" opacity="0.9" style={{animation:"sunRay0 1.8s ease-in-out .2s infinite"}}/>
                  <line x1="14" y1="28" x2="22" y2="28" stroke={c} strokeWidth="2.5" strokeLinecap="round" opacity="0.9" style={{animation:"sunRay1 2s ease-in-out .4s infinite"}}/>
                  <line x1="58" y1="28" x2="66" y2="28" stroke={c} strokeWidth="2.5" strokeLinecap="round" opacity="0.9" style={{animation:"sunRay1 2s ease-in-out .6s infinite"}}/>
                  <line x1="20" y1="12" x2="26" y2="18" stroke={c} strokeWidth="2" strokeLinecap="round" opacity="0.7" style={{animation:"sunRay2 2.2s ease-in-out .1s infinite"}}/>
                  <line x1="54" y1="12" x2="60" y2="6"  stroke={c} strokeWidth="2" strokeLinecap="round" opacity="0.7" style={{animation:"sunRay2 2.2s ease-in-out .3s infinite"}}/>
                  <line x1="20" y1="44" x2="26" y2="38" stroke={c} strokeWidth="2" strokeLinecap="round" opacity="0.7" style={{animation:"sunRay2 2.2s ease-in-out .5s infinite"}}/>
                  <line x1="54" y1="44" x2="60" y2="50" stroke={c} strokeWidth="2" strokeLinecap="round" opacity="0.7" style={{animation:"sunRay2 2.2s ease-in-out .7s infinite"}}/>
                  {/* Partículas */}
                  <circle cx="12" cy="56" r="2" fill={c} opacity="0" style={{animation:"sparkleFloat 1.8s ease-out .3s infinite"}}/>
                  <circle cx="68" cy="58" r="1.5" fill={c} opacity="0" style={{animation:"sparkleFloat 1.8s ease-out .9s infinite"}}/>
                </svg>
              )
            },
          ];

          return(
            <div style={{animation:"homeCardIn .5s cubic-bezier(.25,.46,.45,.94) .1s both"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                {STATES.map((st,si)=>{
                  const active=selIdx===si;
                  const c=st.color;
                  return(
                    <button key={si} onClick={()=>pickState(si)}
                      style={{
                        padding:"16px 8px 14px",
                        borderRadius:20,
                        background:active?c+"18":th.cardAlt,
                        border:"2px solid "+(active?c:th.borderLight),
                        cursor:"pointer",
                        display:"flex",
                        flexDirection:"column",
                        alignItems:"center",
                        gap:8,
                        transition:"all .3s cubic-bezier(.34,1.56,.64,1)",
                        transform:active?"scale(1.06)":"scale(1)",
                        boxShadow:active?`0 8px 24px ${c}35`:"none",
                        position:"relative",
                      }}>
                      {/* Active dot */}
                      {active&&<div style={{position:"absolute",top:8,right:8,width:7,height:7,borderRadius:"50%",background:c,boxShadow:`0 0 8px ${c}`}}/>}

                      {/* SVG visual */}
                      <div style={{opacity:active?1:0.38,filter:active?"none":"grayscale(0.7)",transition:"all .3s ease"}}>
                        {st.svg(c)}
                      </div>

                      {/* Label */}
                      <div style={{textAlign:"center"}}>
                        <div style={{fontSize:13,fontWeight:active?700:500,color:active?c:th.text2,transition:"all .2s",marginBottom:2}}>{st.name}</div>
                        <div style={{fontSize:10,color:active?c:th.text3,lineHeight:1.3,opacity:active?0.8:0.6}}>{st.sub}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ══ BLOQUE 4: TAREAS PENDIENTES ══ */}
        {/* Propósito TDAH: lo urgente PRIMERO. Las tareas de ayer deben ser visibles */}
        {/* antes de crear un plan nuevo — externaliza la memoria de trabajo */}
        {(savedTasks||[]).filter(tk=>!tk.done).length>0&&(
          <div style={{...{background:th.card,borderRadius:RR.lg,boxShadow:th.shadow},border:"1px solid "+lv.c1+"30",padding:"14px 16px",animation:"homeCardIn .5s cubic-bezier(.25,.46,.45,.94) .15s both"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:lv.c1,animation:"pulse 2s ease-in-out infinite"}}/>
              <span style={{fontSize:10,color:lv.c1,letterSpacing:2,textTransform:"uppercase",fontWeight:700}}>
                {lang==="es"?"Tareas pendientes":"Pending tasks"}
              </span>
              <span style={{fontFamily:F.mono,fontSize:10,color:th.text3,marginLeft:"auto"}}>{(savedTasks||[]).filter(tk=>!tk.done).length}</span>
            </div>
            <p style={{fontSize:11,color:th.text3,fontFamily:F.display,fontStyle:"italic",margin:"0 0 10px",lineHeight:1.4}}>
              {lang==="es"?"Lo que sigue ahí pendiente, sin juicio.":"What's still pending, no judgment."}
            </p>
            <PersistentTasks/>
          </div>
        )}

        {/* ══ BLOQUE 5: CTA PRINCIPAL — reacciona a energyUI ══ */}
        <div style={{animation:"homeCardIn .5s cubic-bezier(.25,.46,.45,.94) .2s both"}}>
          {/* LOW ENERGY → highlight breather first */}
          {energyUI.primaryCTA==="breather"&&(
            <div style={{background:`linear-gradient(135deg,#7BBFB018,#9B8EC408)`,borderRadius:RR.lg,padding:"14px 18px",border:`1.5px solid #7BBFB035`,marginBottom:10,display:"flex",alignItems:"center",gap:12,animation:"fadeIn .5s ease both"}}>
              <div style={{width:40,height:40,borderRadius:14,background:"#7BBFB022",border:"1px solid #7BBFB050",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <Ic name="wind" size={20} color="#7BBFB0" sw={1.8}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:700,color:th.text,marginBottom:2}}>{lang==="es"?"Energía baja — empieza aquí":"Low energy — start here"}</div>
                <div style={{fontSize:11,color:th.text2}}>{lang==="es"?"Una respiración 4·4·6 regula tu sistema nervioso primero.":"A 4·4·6 breath regulates your nervous system first."}</div>
              </div>
            </div>
          )}
          <div style={{background:`linear-gradient(135deg,${lv.c1}${energyUI.glowLevel===3?"28":energyUI.glowLevel===2?"20":"14"},${lv.c2}0a)`,borderRadius:RR.lg,padding:"18px 20px",border:`1.5px solid ${lv.c1}${energyUI.band==="low"?"25":"40"}`,position:"relative",overflow:"hidden",opacity:energyUI.primaryCTA==="breather"?0.82:1,transition:"opacity .4s"}}>
            <div style={{position:"absolute",top:-20,right:-20,width:energyUI.glowLevel===3?120:90,height:energyUI.glowLevel===3?120:90,borderRadius:"50%",background:`radial-gradient(circle,${lv.c1}${energyUI.glowLevel===3?"30":energyUI.glowLevel===2?"20":"12"},transparent 70%)`,pointerEvents:"none",transition:"all .6s"}}/>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
              <Spirit size={34} animated variant="kawaii" mood={energyUI.spiritMood} showAura={energyUI.showAura} showSparkles={energyUI.showSparkles} lvIndex={lvI}/>
              <div style={{flex:1}}>
                <div style={{fontFamily:F.display,fontSize:15,fontWeight:600,color:th.text,lineHeight:1.25}}>
                  {lang==="es"?"Plan de hoy con tu energía":"Today's plan from your energy"}
                </div>
              </div>
            </div>
            <p style={{fontSize:12,color:th.text2,lineHeight:1.45,margin:"0 0 14px",paddingLeft:44}}>
              {lang==="es"
                ? parseFloat(avg)<=2 ? "Modo calma activado. Pequeños pasos, grandes victorias. 💙"
                  : parseFloat(avg)<=3 ? "Tu cerebro está disponible. Sin presión."
                  : parseFloat(avg)<=4 ? "Buena energía hoy. Aprovecha este momento. ✨"
                  : "¡Alto rendimiento! Tu cerebro está en modo flow. 🚀"
                : parseFloat(avg)<=2 ? "Calm mode on. Small steps, big wins. 💙"
                  : parseFloat(avg)<=3 ? "Your brain is available. No pressure."
                  : parseFloat(avg)<=4 ? "Good energy today. Make the most of it. ✨"
                  : "High performance! Your brain is in flow mode. 🚀"
              }
            </p>
            <button onClick={()=>{haptic("medium");setDailyPlanStep("time");}}
              style={{width:"100%",padding:"15px",borderRadius:RR.md,background:th.gBtn,border:"none",cursor:"pointer",fontFamily:F.body,fontSize:15,fontWeight:700,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",gap:8,boxShadow:"0 2px 8px rgba(0,0,0,.15)",letterSpacing:.3,transition:"all .3s"}}
              onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 4px 14px rgba(0,0,0,.2)";}}
              onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 4px 14px rgba(0,0,0,.2)";}}>
              <Ic name="sparkle" size={17} color="#fff" sw={2}/>
              {lang==="es"?"Crear plan de hoy →":"Build today's plan →"}
            </button>
          </div>
        </div>

        {/* ══ BLOQUE 5b: Energy insight (si hay suficiente historial) ══ */}
        <EnergyInsightCard/>

        {/* ══ BLOQUE 6: TIP DEL DÍA ══ */}
        {/* Propósito TDAH: información útil pero no urgente — va DESPUÉS de la acción */}
        <div style={{animation:"homeCardIn .5s cubic-bezier(.25,.46,.45,.94) .28s both"}}>
          {TipCard({t,th,lv,scores,Card,F,RR})}
        </div>

        {/* ══ BLOQUE 7: TAREAS (si no hay pendientes arriba) + BODY DOUBLE + REMINDER ══ */}
        {/* En una sola fila de chips colapsables para no abrumar */}
        {(savedTasks||[]).filter(tk=>!tk.done).length===0&&(
          <div style={{animation:"homeCardIn .5s cubic-bezier(.25,.46,.45,.94) .34s both"}}>
            <PersistentTasks/>
          </div>
        )}

        {/* ── Body double + Reminder: fila de acceso rápido colapsado ── */}
        <div style={{display:"flex",gap:10,animation:"homeCardIn .5s cubic-bezier(.25,.46,.45,.94) .4s both"}}>
          <BodyDoubleChip/>
          <ReminderChip/>
        </div>

      </div>
    </div>);


  if(step==="goals") return(
    <div style={{flex:1,overflowY:"auto",padding:"0 20px 20px",animation:"fadeIn .5s ease both"}}>

      {/* Header with energy badge */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,padding:"10px 16px",borderRadius:RR.md,background:th.gSoft,border:"1px solid "+th.gBorder}}>
        <span style={{fontSize:20}}>{lv.emoji}</span>
        <div style={{flex:1}}>
          <div style={{fontFamily:F.display,fontSize:13,fontWeight:700,color:th.g}}>{lv.label} · {avg}/5</div>
          <div style={{fontSize:11,color:th.text3}}>
            {lang==="es"?"ZENO adapta tus tareas a esta energía":"ZENO adapts your tasks to this energy"}
          </div>
        </div>
        <button onClick={()=>setStep("check")} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:th.text3,fontFamily:F.body,padding:"4px 8px",borderRadius:8,minHeight:32,display:"flex",alignItems:"center",gap:4}}>
          <Ic name="edit" size={12} color={th.text3} sw={1.4}/>
          {lang==="es"?"Cambiar":"Change"}
        </button>
      </div>

      {/* Spirit chat bubble */}
      <div style={{display:"flex",alignItems:"flex-end",gap:10,marginBottom:16}}>
        <Spirit size={38} animated variant="mini" mood="thinking" lvIndex={lvI}/>
        <div style={{...Card({borderRadius:"16px 16px 16px 4px",padding:"12px 16px",flex:1})}}>
          <p style={{fontSize:14,fontFamily:F.display,color:th.text,lineHeight:1.5,margin:0,fontWeight:500}}>
            {t.goalsPrompt(lv.label)}
          </p>
          <p style={{fontSize:11,color:th.text3,margin:"4px 0 0",lineHeight:1.4}}>
            {lang==="es"
              ?"Escribe lo que necesitas hacer. Sin orden. ZENO lo organiza."
              :"Write what you need to do. No order. ZENO organizes it."}
          </p>
        </div>
      </div>

      {/* Task input */}
      <div style={{...Card({borderRadius:RR.lg,padding:0,border:"1.5px solid "+th.gBorder}),marginBottom:14,overflow:"hidden"}}>
        <div style={{padding:"10px 16px 0",borderBottom:"1px solid "+th.borderLight}}>
          <div style={{fontSize:10,color:th.g,letterSpacing:2,textTransform:"uppercase",fontWeight:700}}>
            {lang==="es"?"Tus tareas de hoy":"Your tasks today"}
          </div>
        </div>
        <textarea
          value={goalText}
          onChange={e=>setGoalText(e.target.value)}
          placeholder={avg<=2
            ?(lang==="es"?"Algo pequeño que puedas hacer hoy...":"Something small you can do today...")
            :avg>=4
            ?(lang==="es"?"¿Qué quieres conquistar hoy?":"What do you want to conquer today?")
            :(lang==="es"?"Ej: responder emails, terminar el informe...":"E.g.: reply emails, finish the report...")}
          autoFocus
          style={{width:"100%",minHeight:120,background:"transparent",border:"none",outline:"none",fontSize:15,color:th.text,lineHeight:1.75,resize:"none",padding:"12px 16px",fontFamily:F.body}}
        />
        <div style={{padding:"4px 16px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:11,color:th.text3,fontStyle:"italic",fontFamily:F.display}}>
            {lang==="es"?"Sin presión. Tu ritmo.":"No pressure. Your pace."}
          </span>
          <span style={{fontSize:11,color:goalText.trim()?th.g:th.text3,fontWeight:600,transition:"color .3s"}}>
            {goalText.trim()?goalText.split("\n").filter(l=>l.trim()).length+" "+(lang==="es"?"tarea(s)":"task(s)"):""}
          </span>
        </div>
      </div>

      {/* Buttons */}
      <div style={{display:"flex",gap:10}}>
        <button onClick={()=>setStep("check")} style={{flex:1,padding:"14px",borderRadius:RR.md,...Card(),cursor:"pointer",fontSize:13,color:th.text2,fontFamily:F.body,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
          <Ic name="back" size={15} color={th.text2} sw={1.5}/>
          {t.goBack}
        </button>
        <button
          onClick={runAI}
          disabled={!goalText.trim()}
          style={{flex:2.5,padding:"14px",borderRadius:RR.md,background:goalText.trim()?th.gBtn:th.cardAlt,border:"none",cursor:goalText.trim()?"pointer":"default",fontSize:14,fontWeight:700,color:goalText.trim()?th.btnText:th.text3,fontFamily:F.body,boxShadow:"none",display:"flex",alignItems:"center",justifyContent:"center",gap:8,transition:"all .28s ease"}}
          onMouseEnter={e=>{if(goalText.trim())e.currentTarget.style.transform="translateY(-1px)";}}
          onMouseLeave={e=>{e.currentTarget.style.transform="";}}
        >
          <Ic name="sparkle" size={16} color={goalText.trim()?th.btnText:th.text3} sw={2}/>
          {lang==="es"?"ZENO adapta al cerebro →":"ZENO adapts to your brain →"}
        </button>
      </div>

    </div>);

  if(step==="loading") return(<div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:20,padding:"0 22px",animation:"fadeIn .5s ease both"}}><Spirit size={70} animated variant="kawaii" mood="thinking" showAura lvIndex={lvI}/><div style={{textAlign:"center"}}><div style={{fontFamily:F.display,fontSize:18,color:th.text,marginBottom:8,animation:"fadeIn .5s ease both"}}>{t.creatingPlan}</div><div style={{display:"flex",gap:5,justifyContent:"center",marginBottom:6}}>{[0,1,2].map(j=><div key={j} style={{width:7,height:7,borderRadius:"50%",background:th.gBtn,animation:`dotB 1.6s ease-in-out infinite`,animationDelay:`${j*.22}s`}}/>)}</div><div style={{fontSize:12,color:th.text3,fontFamily:F.display,fontStyle:"italic"}}>{t.adjusting}</div></div><div style={{width:120,height:2,background:th.border,borderRadius:100,overflow:"hidden"}}><div style={{height:"100%",borderRadius:100,background:`linear-gradient(90deg,${th.g},${th.g2})`,width:"60%",animation:"loadBar 2s ease-in-out infinite"}}/></div></div>);

  if(step==="task"&&cur) return(
    <div style={{flex:1,overflowY:"auto",padding:"0 20px 16px",display:"flex",flexDirection:"column",gap:14}}>
      {aiMsg&&taskIdx===0&&<div style={{display:"flex",alignItems:"flex-end",gap:12,animation:"fadeIn .5s ease both"}}><Spirit size={36} animated variant="blob" mood="calm" lvIndex={lvI}/><div style={{...Card({borderRadius:"16px 16px 16px 4px",padding:"12px 14px",flex:1})}}><p style={{fontSize:13,fontFamily:F.display,color:th.text2,lineHeight:1.6,fontStyle:"italic",margin:0}}>{aiMsg}</p></div></div>}
      <div style={{display:"flex",justifyContent:"center",gap:8,padding:"4px 0"}}>{aiTasks.map((_,i)=><div key={i} style={{width:i===taskIdx?24:8,height:8,borderRadius:100,background:i<=taskIdx?th.g:th.border,transition:"all .4s ease"}}/>)}</div>
      <div style={{...Card({borderRadius:RR.lg,padding:"24px"}),flex:1,animation:"fadeIn .5s ease both"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}><div style={{fontSize:11,color:th.text3,letterSpacing:1.5,textTransform:"uppercase",fontWeight:500}}>{t.stepOf(taskIdx+1,aiTasks.length)}</div><div style={{display:"flex",alignItems:"center",gap:4}}><Ic name="clock" size={13} color={th.text3} sw={1.3}/><span style={{fontSize:12,color:th.text3,fontFamily:F.mono}}>{cur.time}</span></div></div>
        <p style={{fontFamily:F.display,fontSize:20,fontWeight:500,color:th.text,lineHeight:1.45,marginBottom:16}}>{cur.text}</p>
        {/* Why — neurological reason, prominent */}
        <div style={{background:th.gSoft,borderRadius:RR.sm,padding:"12px 14px",border:"1px solid "+th.gBorder}}>
          <div style={{fontSize:9,color:th.g,letterSpacing:2,textTransform:"uppercase",fontWeight:700,marginBottom:4}}>{lang==="es"?"Por qué funciona":"Why this works"}</div>
          <p style={{fontSize:13,color:th.text2,lineHeight:1.65,fontStyle:"italic",fontFamily:F.display,margin:0}}>{cur.why}</p>
        </div>
      </div>
      <button onClick={done} style={{width:"100%",padding:"16px",borderRadius:RR.md,background:th.gBtn,border:"none",cursor:"pointer",fontFamily:F.body,fontSize:15,fontWeight:600,color:th.btnText,boxShadow:"0 4px 16px "+th.g+"40",display:"flex",alignItems:"center",justifyContent:"center",gap:8,transition:"all .28s ease"}} onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-1px)";}} onMouseLeave={e=>{e.currentTarget.style.transform="";}}><Ic name="check" size={17} color={th.btnText} sw={2}/> {taskIdx+1<aiTasks.length?t.doneNext:t.doneAll}</button>
      {/* Skip — no judgment */}
      <button onClick={()=>{haptic("soft");if(taskIdx+1<aiTasks.length)setTaskIdx(i=>i+1);else{setStep("done");addMemory({date:new Date().toLocaleDateString(),avg,level:lv.label,tasks:taskIdx,scores:{...scores},ts:Date.now()});} }} style={{background:"none",border:"none",cursor:"pointer",padding:"8px",fontSize:11,color:th.text3,letterSpacing:1,textTransform:"uppercase",fontFamily:F.body,width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:5,minHeight:36}}>
        {lang==="es"?"Saltar esta tarea (sin juicio)":"Skip this task (no judgment)"}
      </button>
      <button onClick={reset} style={{background:"none",border:"none",cursor:"pointer",padding:"8px",fontSize:11,color:th.text3,letterSpacing:1.5,textTransform:"uppercase",fontFamily:F.body,width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:5}}><Ic name="refresh" size={12} color={th.text3} sw={1.3}/> {t.startOver}</button>
    </div>);

  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"0 24px",gap:0,position:"relative",overflow:"hidden"}}>

      {/* Full screen celebration glow */}
      <div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse at 50% 20%,"+th.g+"18 0%,transparent 60%)",pointerEvents:"none",animation:"haloBreath 3s ease-in-out infinite"}}/>
      <div style={{position:"absolute",bottom:-60,left:"50%",transform:"translateX(-50%)",width:300,height:300,borderRadius:"50%",background:"radial-gradient(circle,"+th.g2+"10 0%,transparent 70%)",pointerEvents:"none"}}/>

      {/* Mascot */}
      <div style={{position:"relative",marginBottom:20}}>
        <Spirit size={90} animated variant="kawaii" mood="energized" showSparkles lvIndex={lvI}/>
      </div>

      {/* Main message */}
      <div style={{textAlign:"center",marginBottom:24,position:"relative"}}>
        <div style={{fontFamily:F.display,fontSize:30,fontWeight:700,color:th.text,lineHeight:1.15,marginBottom:8}}>
          {t.youDidIt} <span style={{color:th.g}}>{t.forReal}</span>
        </div>
        <p style={{fontFamily:F.display,fontSize:15,color:th.text2,fontStyle:"italic",lineHeight:1.65,margin:0,maxWidth:260}}>{t.showingUp}</p>
      </div>

      {/* Stats — dopamine numbers */}
      <div style={{display:"flex",gap:10,width:"100%",maxWidth:300,marginBottom:20}}>
        <div style={{flex:1,...Card({borderRadius:RR.md,padding:"14px 10px",background:th.gSoft,border:"1px solid "+th.gBorder}),textAlign:"center"}}>
          <div style={{fontFamily:F.display,fontSize:28,fontWeight:700,color:th.g,lineHeight:1}}>{aiTasks.reduce((a,tk)=>a+tk.flow,0)}</div>
          <div style={{fontSize:9,color:th.g,letterSpacing:1.5,textTransform:"uppercase",marginTop:3,fontWeight:600}}>Flow</div>
        </div>
        <div style={{flex:1,...Card({borderRadius:RR.md,padding:"14px 10px"}),textAlign:"center"}}>
          <div style={{fontFamily:F.display,fontSize:28,fontWeight:700,color:th.text,lineHeight:1}}>{memory.length+1}</div>
          <div style={{fontSize:9,color:th.text3,letterSpacing:1.5,textTransform:"uppercase",marginTop:3}}>{lang==="es"?"días":"days"}</div>
        </div>
        <div style={{flex:1,...Card({borderRadius:RR.md,padding:"14px 10px"}),textAlign:"center"}}>
          <div style={{fontFamily:F.display,fontSize:28,fontWeight:700,color:th.text,lineHeight:1}}>{aiTasks.length}</div>
          <div style={{fontSize:9,color:th.text3,letterSpacing:1.5,textTransform:"uppercase",marginTop:3}}>{lang==="es"?"tareas":"tasks"}</div>
        </div>
      </div>

      {/* Personal insight — AI-generated based on what they completed */}
      <div style={{...Card({borderRadius:RR.lg,padding:"16px 18px",border:"1px solid "+th.gBorder,background:th.gSoft}),width:"100%",maxWidth:300,marginBottom:20}}>
        <div style={{fontSize:10,color:th.g,letterSpacing:2,textTransform:"uppercase",fontWeight:700,marginBottom:6}}>
          {lang==="es"?"Lo que esto significa":"What this means"}
        </div>
        <p style={{fontFamily:F.display,fontSize:13,color:th.text,lineHeight:1.6,margin:0,fontStyle:"italic"}}>
          {lang==="es"
            ?(lv.label==="Descanso"||lv.label==="Suave")
              ?"Completaste tareas con poca energía. Eso requiere más esfuerzo que hacerlo con energía alta. Tu cerebro trabajó duro hoy."
              :(lv.label==="Plena"||lv.label==="Activa")
              ?"Aprovechaste bien tu energía alta. Los patrones se construyen exactamente así — un día a la vez."
              :"Energía media, tareas reales completadas. Esto es lo que se ve el progreso constante."
            :(lv.label==="Resting"||lv.label==="Soft")
              ?"You completed tasks on low energy. That takes more effort than doing it on high energy. Your brain worked hard today."
              :(lv.label==="Full"||lv.label==="Active")
              ?"You used your high energy well. Patterns are built exactly like this — one day at a time."
              :"Medium energy, real tasks completed. This is what consistent progress looks like."
          }
        </p>
      </div>

      {/* Action buttons */}
      <div style={{display:"flex",gap:10,width:"100%",maxWidth:300}}>
        <button onClick={reset} style={{flex:1,padding:"14px",borderRadius:100,background:th.gBtn,border:"none",cursor:"pointer",fontFamily:F.body,fontSize:14,fontWeight:700,color:th.btnText,boxShadow:"0 4px 20px "+th.g+"40",minHeight:50,transition:"all .28s"}}
          onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"}
          onMouseLeave={e=>e.currentTarget.style.transform=""}>
          {t.checkAgain}
        </button>
        <button onClick={()=>{const txt=t.shareText(userName,lv.label,aiTasks.length);if(navigator.share)navigator.share({text:txt}).catch(()=>{});else navigator.clipboard&&navigator.clipboard.writeText(txt);}} style={{padding:"14px 18px",borderRadius:100,...Card({boxShadow:th.shadow}),cursor:"pointer",fontFamily:F.body,fontSize:13,fontWeight:500,color:th.g,display:"flex",alignItems:"center",gap:6,minHeight:50}}>
          <Ic name="arrow" size={14} color={th.g} sw={1.5}/> {t.shareBtn||"Share"}
        </button>
      </div>

    </div>);
  }

function FocusTab(){
  const{t,th,lang,memory}=useCtx();const Card=useCard();
  const[mode,setMode]=useState("pick");
  const[nowInput,setNowInput]=useState("");const[nowStep,setNowStep]=useState("");const[nowLoad,setNowLoad]=useState(false);
  const[run,setRun]=useState(false);const[secs,setSecs]=useState(25*60);
  const[soundType,setSoundType]=useState("white");
  const audioCtxRef=useRef(null);const noiseRef=useRef(null);const gainRef=useRef(null);
  const[soundOn,setSoundOn]=useState(false);
  const[vol,setVol]=useState(0.3);
  const[bPh,setBPh]=useState(0);const[bCt,setBCt]=useState(0);const[bAnim,setBAnim]=useState(false);
  const[easyInput,setEasyInput]=useState("");const[easySteps,setEasySteps]=useState([]);const[easyStepsMeta,setEasyStepsMeta]=useState([]);const[easyMsg,setEasyMsg]=useState("");const[easyLoad,setEasyLoad]=useState(false);const[easyDone,setEasyDone]=useState({});
  const phD=[4000,4000,6000];
  const TOTAL_SECS=secs>5*60?25*60:5*60;

  useEffect(()=>{
    if(mode!=="timer"||!run)return;
    if(secs<=0){setRun(false);haptic("success");return;}
    const id=setInterval(()=>setSecs(s=>{if(s<=1){setRun(false);haptic("success");return 0;}return s-1;}),1000);
    return()=>clearInterval(id);
  },[mode,run,secs]);

  useEffect(()=>{
    if(mode!=="breathe")return;
    setBAnim(true);
    let idx=0;
    const tick=()=>{setBPh(idx);return setTimeout(()=>{idx=(idx+1)%3;if(idx===0)setBCt(c=>c+1);tick();},phD[idx]);};
    const id=tick();
    return()=>{clearTimeout(id);setBAnim(false);};
  },[mode]);

  const mm=String(Math.floor(secs/60)).padStart(2,"0"),ss=String(secs%60).padStart(2,"0");
  const pct=1-(secs/TOTAL_SECS);
  const Rv=76,circ=2*Math.PI*Rv;
  const bScale=bPh===0?1.18:bPh===1?1.18:.82;

  const BREATH_COLORS=["#5B9E8F","#7BBFB0","#9B8EC4"];
  const bc=BREATH_COLORS[bPh];

  // ── Energy from last check-in — declared here so runNowMode and breakTask can use it ──
  const last=memory&&memory[memory.length-1];
  const eng=last?parseFloat(last.avg)||3:3;
  const ENG_C=["#64748B","#3B82F6","#10B981","#F59E0B","#EF4444"];
  const ec=ENG_C[Math.min(4,Math.max(0,Math.round(eng)-1))];
  const energyUI=getEnergyUIState(eng,last?.scores||null);

  const runNowMode=async()=>{
    if(!nowInput.trim())return;
    setNowLoad(true);setNowStep("");haptic("soft");
    const promptES=(
      "Eres ZENO, compañero neurointeligente para personas con TDAH.\n\n"
      +"TAREA BLOQUEADA: "+nowInput.trim()+"\n\n"
      +"REGLAS — responde en texto plano, exactamente 2 frases:\n"
      +"Frase 1: valida el bloqueo como barrera neurológica, no como fallo personal. 1 frase corta y cálida.\n"
      +"Frase 2: el primer micro-paso. Verbo físico al inicio (abre, toca, pon, mueve, agarra, escribe, busca). "
      +"Máximo 90 segundos. Tan pequeño que el cuerpo lo haga casi en automático. Solo el paso, sin explicación.\n"
      +"PROHIBIDO: deberías, tienes que, es fácil, simplemente, solo tienes que."
    );
    const promptEN=(
      "You are ZENO, a neurointelligent companion for ADHD brains.\n\n"
      +"BLOCKED TASK: "+nowInput.trim()+"\n\n"
      +"RULES — respond in plain text, exactly 2 sentences:\n"
      +"Sentence 1: validate the block as a neurological barrier, not a personal failure. 1 short warm sentence.\n"
      +"Sentence 2: the first micro-step. Physical verb first (open, touch, put, move, grab, write, find). "
      +"Maximum 90 seconds. So small the body does it almost automatically. Just the step, no explanation.\n"
      +"FORBIDDEN: you should, you need to, it's easy, simply, just."
    );
    try{
      const _rawNow=await aiCall({max_tokens:120,messages:[{role:"user",content:lang==="es"?promptES:promptEN}]});
      const _checkedNow=zenoCheckOutput(_rawNow.trim(),lang);
      if(eng<=2&&_checkedNow){
        const [care]=pickSelfCare(eng,lang,1);
        const joined=lang==="es"
          ?`${_checkedNow} Antes de eso, ${care.toLowerCase().replace(/\.$/,"")}.`
          :`${_checkedNow} First, ${care.toLowerCase().replace(/\.$/,"")}.`;
        setNowStep(joined);
      }else{
        setNowStep(_checkedNow);
      }
    }catch(e){setNowStep(!getApiKey()&&!PROXY_URL?(lang==="es"?"⚡ Configura tu API key en Perfil → API Key para usar esta función":"⚡ Set your API key in Profile → API Key to use this feature"):t.aiFallback[0].text);}
    setNowLoad(false);
  };

  const breakTask=async()=>{
    if(!easyInput.trim())return;
    setEasyLoad(true);setEasySteps([]);setEasyStepsMeta([]);setEasyMsg("");setEasyDone({});haptic("soft");
    const promptES=(
      "Eres ZENO, compañero neurointeligente para personas con TDAH y cerebros neurodivergentes.\n\n"
      +"MISIÓN: Dividir una tarea que parece imposible en micro-pasos accionables.\n\n"
      +"TAREA QUE PARECE IMPOSIBLE: \""+easyInput.trim()+"\"\n\n"
      +"NEUROCIENCIA A APLICAR:\n"
      +"- Barrera dopaminérgica de inicio: el cerebro TDAH no puede arrancar sin estímulo. El paso 1 debe ser tan pequeño que la inercia no aplique.\n"
      +"- Memoria de trabajo reducida: cada paso tan concreto que no requiera recordar el contexto.\n"
      +"- Ceguera temporal: usa tiempos exactos. NUNCA 'un rato' o 'después'.\n\n"
      +"REGLAS ABSOLUTAS:\n"
      +"1. zapMessage: 1 frase validando que la tarea parece enorme para un cerebro TDAH y no es pereza.\n"
      +"2. Entre 5 y 7 pasos. Agrupa si hacen falta más.\n"
      +"3. Paso 1: MÍNIMA fricción cognitiva posible — tan ridículamente fácil que sea imposible no hacerlo.\n"
      +"4. Cada paso: menor a 5 minutos, verbo físico al inicio (Abre, Escribe, Busca, Mueve, Toca, Pon, Llama), tan concreto que no requiera pensar cómo.\n"
      +"5. why: razón neurológica breve y específica (dopamina, memoria de trabajo, nervio vago, RSD).\n"
      +"6. PROHIBIDO: deberías, tienes que, es fácil, simplemente, solo haz.\n\n"
      +"RESPONDE SOLO JSON VÁLIDO:\n"
      +"{\"zapMessage\":\"1 frase validando\",\"steps\":[{\"text\":\"Verbo físico + micro-paso\",\"time\":\"X min\",\"why\":\"razón neurológica\"}]}"
    );
    const promptEN=(
      "You are ZENO, a neurointelligent companion for ADHD and neurodivergent brains.\n\n"
      +"MISSION: Break a task that feels impossible into actionable micro-steps.\n\n"
      +"TASK THAT FEELS IMPOSSIBLE: \""+easyInput.trim()+"\"\n\n"
      +"NEUROSCIENCE TO APPLY:\n"
      +"- Dopamine initiation barrier: the ADHD brain cannot start without stimulation. Step 1 must be so small that inertia doesn't apply.\n"
      +"- Reduced working memory: each step so concrete it requires no remembering context.\n"
      +"- Time blindness: use exact durations. NEVER 'a while' or 'later'.\n\n"
      +"ABSOLUTE RULES:\n"
      +"1. zapMessage: 1 sentence validating that the task feels huge for an ADHD brain and is not laziness.\n"
      +"2. Between 5 and 7 steps. Group if needed.\n"
      +"3. Step 1: MINIMUM cognitive friction possible — so ridiculously easy it is impossible not to do.\n"
      +"4. Each step: under 5 minutes, physical verb first (Open, Write, Find, Move, Touch, Put, Call), so concrete no thinking needed about how.\n"
      +"5. why: brief specific neurological reason (dopamine, working memory, vagus nerve, RSD).\n"
      +"6. FORBIDDEN: you should, you need to, it's easy, simply, just do.\n\n"
      +"RESPOND WITH VALID JSON ONLY:\n"
      +"{\"zapMessage\":\"1 validating sentence\",\"steps\":[{\"text\":\"Physical verb + micro-step\",\"time\":\"X min\",\"why\":\"neurological reason\"}]}"
    );
    try{
      const _rawBreak=await aiCall({max_tokens:1200,messages:[{role:"user",content:lang==="es"?promptES:promptEN}]});
      const tx=_rawBreak.replace(/```json|```/g,"").trim();
      const p=JSON.parse(tx);
      if(p.zapMessage)setEasyMsg(zenoCheckOutput(p.zapMessage,lang));
      const rawSteps=p.steps||[];
      // For low energy, prepend a self-care step 0 into the data
      const _engNow=last?parseFloat(last.avg)||3:3;
      const _careSteps=(_engNow<=2)
        ?[{text:pickSelfCare(_engNow,lang,1)[0],time:"1 min",why:lang==="es"?"Regula el sistema nervioso antes de empezar":"Regulates the nervous system before starting"}]
        :[];
      const allSteps=[..._careSteps,...rawSteps];
      setEasySteps(allSteps.map(s=>typeof s==="string"?s:s.text||"").filter(Boolean));
      setEasyStepsMeta(allSteps.filter(s=>typeof s==="object"));
    }catch{
      const _engFallback=last?parseFloat(last.avg)||3:3;
      const _fallbackCare=_engFallback<=2?[pickSelfCare(_engFallback,lang,1)[0]]:[];
      setEasySteps([
        ..._fallbackCare,
        lang==="es"?`Abre el lugar donde está "${easyInput.slice(0,20)}..."`:
                   `Open the place where "${easyInput.slice(0,20)}..." is`,
        lang==="es"?"Lee solo las primeras 3 líneas":"Read only the first 3 lines",
        lang==="es"?"Escribe UNA sola oración sobre lo primero que pienses":"Write ONE single sentence about the first thing you think",
        lang==="es"?"Descansa 30 segundos. Respira.":"Rest 30 seconds. Breathe.",
        lang==="es"?"Escribe una segunda oración. Solo una más.":"Write a second sentence. Just one more.",
      ]);
      setEasyStepsMeta([]);
    }
    setEasyLoad(false);
  };


  const startNoise=(type)=>{
    try{
      if(noiseRef.current){noiseRef.current.disconnect();noiseRef.current=null;}
      if(!audioCtxRef.current||audioCtxRef.current.state==="closed"){
        audioCtxRef.current=new(window.AudioContext||window.webkitAudioContext)();
      }
      const ctx=audioCtxRef.current;
      const bufSize=ctx.sampleRate*2;
      const buf=ctx.createBuffer(1,bufSize,ctx.sampleRate);
      const data=buf.getChannelData(0);
      if(type==="white"){for(let i=0;i<bufSize;i++)data[i]=Math.random()*2-1;}
      else if(type==="pink"){let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0;for(let i=0;i<bufSize;i++){const w=Math.random()*2-1;b0=.99886*b0+w*.0555179;b1=.99332*b1+w*.0750759;b2=.96900*b2+w*.1538520;b3=.86650*b3+w*.3104856;b4=.55000*b4+w*.5329522;b5=-.7616*b5-w*.0168980;data[i]=(b0+b1+b2+b3+b4+b5+w*.5362)/5.5;}}
      else{let lastOut=0;for(let i=0;i<bufSize;i++){const w=Math.random()*2-1;data[i]=(lastOut+(0.02*w))/1.02;lastOut=data[i];data[i]*=3.5;}}
      const src=ctx.createBufferSource();src.buffer=buf;src.loop=true;
      const gain=ctx.createGain();gain.gain.value=vol;
      gainRef.current=gain;
      src.connect(gain);gain.connect(ctx.destination);
      src.start();noiseRef.current=src;setSoundOn(true);
    }catch(e){console.warn("[ZENO] Audio:",e);}
  };
  const stopNoise=()=>{
    try{noiseRef.current?.disconnect();noiseRef.current=null;setSoundOn(false);}catch{}
  };
  useEffect(()=>()=>{stopNoise();},[]);
  useEffect(()=>{if(gainRef.current)gainRef.current.gain.value=vol;},[vol]);

  // ── PICK SCREEN ──
  if(mode==="pick") return(
    <div style={{flex:1,overflowY:"auto",padding:"0 20px 24px",display:"flex",flexDirection:"column",gap:10,animation:"fadeIn .4s ease both"}}>

      {/* Energy-aware header pill */}
      {last&&<div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 16px",borderRadius:100,background:ec+"14",border:"1px solid "+ec+"28",margin:"4px 0 2px"}}>
        <div style={{width:7,height:7,borderRadius:"50%",background:ec,boxShadow:"0 0 6px "+ec,flexShrink:0}}/>
        <p style={{fontSize:12,color:th.text2,margin:0,lineHeight:1.4,fontFamily:F.display,fontStyle:"italic",flex:1}}>
          {eng<=2
            ?(lang==="es"?"Energía baja. Empieza con respiración o un micro-paso.":"Low energy. Start with breathing or one micro-step.")
            :eng>=4
            ?(lang==="es"?"Energía alta. Buen momento para Pomodoro o dividir algo grande.":"High energy. Great time for Pomodoro or breaking a big task.")
            :(lang==="es"?"Energía media. El Modo Ahora es tu mejor opción.":"Medium energy. Now Mode is your best bet.")}
        </p>
        <span style={{fontFamily:F.mono,fontSize:11,color:ec,fontWeight:700}}>{eng.toFixed(1)}</span>
      </div>}

      {/* Section label */}
      <div style={{fontSize:10,color:th.text3,letterSpacing:2.5,textTransform:"uppercase",fontWeight:500,marginTop:4,marginBottom:2}}>
        {lang==="es"?"¿Qué necesitas ahora?":"What do you need now?"}
      </div>

      {/* ── NOW MODE — hero card ── */}
      <button onClick={()=>setMode("now")}
        style={{...Card({borderRadius:RR.lg,padding:"20px",
          background:energyUI.primaryCTA==="nowMode"?`linear-gradient(135deg,${th.g}22,${th.g2}10)`:`linear-gradient(135deg,${th.g}12,${th.g2}06)`,
          border:`${energyUI.primaryCTA==="nowMode"?"2":"1.5"}px solid ${energyUI.primaryCTA==="nowMode"?th.g:th.gBorder}`}),
          display:"flex",alignItems:"center",gap:16,cursor:"pointer",transition:"all .3s ease",position:"relative",overflow:"hidden",
          opacity:energyUI.primaryCTA==="breather"?energyUI.secondaryOpacity:1}}
        onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=th.shadowLg;}}
        onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow=th.shadow;}}>
        <div style={{position:"absolute",top:-20,right:-20,width:80,height:80,borderRadius:"50%",background:`radial-gradient(circle,${th.g}20,transparent 70%)`,pointerEvents:"none"}}/>
        <div style={{width:48,height:48,borderRadius:16,background:th.gBtn,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"0 2px 8px rgba(0,0,0,.15)"}}>
          <Ic name="drive" size={22} color="#fff" sw={2}/>
        </div>
        <div style={{flex:1,textAlign:"left"}}>
          <div style={{fontSize:15,fontWeight:700,color:th.text,marginBottom:3}}>{t.nowModeLabel||"Modo ahora mismo"}</div>
          <div style={{fontSize:12,color:th.text2,lineHeight:1.4}}>{t.nowModeSub||"Un solo paso para arrancar"}</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
          {energyUI.primaryCTA==="nowMode"&&<div style={{fontSize:9,color:th.g,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>⚡</div>}
          <Ic name="arrow" size={16} color={th.g} sw={1.5}/>
        </div>
      </button>

      {/* ── BREAK BIG TASK — dimmed when low energy ── */}
      <button onClick={()=>setMode("easy")}
        style={{...Card({borderRadius:RR.lg,padding:"18px",
          border:energyUI.primaryCTA==="nowMode"?`1.5px solid ${th.gBorder}`:`1px solid ${th.border}`}),
          display:"flex",alignItems:"center",gap:14,cursor:"pointer",transition:"all .3s ease",
          opacity:energyUI.primaryCTA==="breather"?energyUI.secondaryOpacity:1}}
        onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-1px)";}}
        onMouseLeave={e=>{e.currentTarget.style.transform="";}}>
        <div style={{width:44,height:44,borderRadius:14,background:th.cardAlt,border:`1px solid ${th.border}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <Ic name="sparkle" size={20} color={th.g} sw={1.6}/>
        </div>
        <div style={{flex:1,textAlign:"left"}}>
          <div style={{fontSize:14,fontWeight:600,color:th.text,marginBottom:2}}>{t.easyLabel||"Dividir tarea grande"}</div>
          <div style={{fontSize:12,color:th.text2}}>{t.easySub||"La IA la rompe en micro-pasos"}</div>
        </div>
        <Ic name="arrow" size={15} color={th.text3} sw={1.2}/>
      </button>

      {/* Divider */}
      <div style={{display:"flex",alignItems:"center",gap:10,margin:"4px 0"}}>
        <div style={{flex:1,height:1,background:th.borderLight}}/>
        <span style={{fontSize:10,color:th.text3,letterSpacing:2,textTransform:"uppercase"}}>{lang==="es"?"regulación":"regulate"}</span>
        <div style={{flex:1,height:1,background:th.borderLight}}/>
      </div>

      {/* ── BREATHE — hero when low energy ── */}
      <button onClick={()=>setMode("breathe")}
        style={{...Card({borderRadius:RR.lg,padding:"16px 18px",
          background:energyUI.primaryCTA==="breather"?`linear-gradient(135deg,#7BBFB018,#9B8EC408)`:`${th.card}`,
          border:energyUI.primaryCTA==="breather"?`2px solid #7BBFB050`:`1px solid ${th.border}`}),
          display:"flex",alignItems:"center",gap:14,cursor:"pointer",transition:"all .3s ease"}}
        onMouseEnter={e=>e.currentTarget.style.transform="translateY(-1px)"}
        onMouseLeave={e=>e.currentTarget.style.transform=""}>
        <div style={{width:44,height:44,borderRadius:14,background:energyUI.primaryCTA==="breather"?"#7BBFB028":th.cardAlt,border:"1px solid "+th.border,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <Ic name="wind" size={20} color="#7BBFB0" sw={1.6}/>
        </div>
        <div style={{flex:1,textAlign:"left"}}>
          <div style={{fontSize:14,fontWeight:energyUI.primaryCTA==="breather"?700:600,color:th.text,marginBottom:2}}>{t.breathLabel}</div>
          <div style={{fontSize:12,color:th.text2}}>{t.breathSub}</div>
        </div>
        <span style={{fontSize:10,color:energyUI.primaryCTA==="breather"?"#7BBFB0":th.text3,fontFamily:F.mono,fontWeight:energyUI.primaryCTA==="breather"?700:400}}>4·4·6</span>
      </button>

      {/* ── POMODORO + RESET in a row ── */}
      <div style={{display:"flex",gap:10}}>
        {[
          {label:lang==="es"?"Pomodoro":"Pomodoro",sub:"25 min",icon:"focus",color:"#8B7FC0",s:25*60},
          {label:lang==="es"?"Reset rápido":"Quick reset",sub:"5 min",icon:"refresh",color:"#6A9FBF",s:5*60},
        ].map((o,i)=>(
          <button key={i} onClick={()=>{setMode("timer");setSecs(o.s);}}
            style={{...Card({borderRadius:RR.lg,padding:"16px 14px",border:"1px solid "+th.border}),flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:8,cursor:"pointer",transition:"all .3s ease"}}
            onMouseEnter={e=>e.currentTarget.style.transform="translateY(-1px)"}
            onMouseLeave={e=>e.currentTarget.style.transform=""}>
            <div style={{width:40,height:40,borderRadius:12,background:o.color+"18",border:"1px solid "+o.color+"30",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <Ic name={o.icon} size={18} color={o.color} sw={1.6}/>
            </div>
            <div style={{fontSize:13,fontWeight:600,color:th.text}}>{o.label}</div>
            <div style={{fontFamily:F.mono,fontSize:11,color:th.text3}}>{o.sub}</div>
          </button>
        ))}
      </div>

      {/* ── AMBIENT SOUNDS ── */}
      <button onClick={()=>setMode("sounds")}
        style={{...Card({borderRadius:RR.lg,padding:"16px 18px",border:"1px solid "+th.border}),
          display:"flex",alignItems:"center",gap:14,cursor:"pointer",transition:"all .3s ease"}}
        onMouseEnter={e=>e.currentTarget.style.transform="translateY(-1px)"}
        onMouseLeave={e=>e.currentTarget.style.transform=""}>
        <div style={{width:44,height:44,borderRadius:14,background:"#F59E0B18",border:"1px solid #F59E0B30",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <span style={{fontSize:20}}>🎧</span>
        </div>
        <div style={{flex:1,textAlign:"left"}}>
          <div style={{fontSize:14,fontWeight:600,color:th.text,marginBottom:2}}>{lang==="es"?"Ruido ambiente":"Ambient Sound"}</div>
          <div style={{fontSize:12,color:th.text2}}>{lang==="es"?"Blanco · Rosa · Marrón":"White · Pink · Brown"}</div>
        </div>
        {soundOn&&<div style={{width:7,height:7,borderRadius:"50%",background:"#10B981",animation:"pulse 2s ease-in-out infinite"}}/>}
        <Ic name="arrow" size={15} color={th.text3} sw={1.2}/>
      </button>

    </div>
  );

  // ── NOW MODE SCREEN ──
  if(mode==="now") return(
    <div style={{flex:1,overflowY:"auto",padding:"0 20px 24px",display:"flex",flexDirection:"column",gap:14,animation:"fadeIn .4s ease both"}}>

      {/* Zeno bubble */}
      <div style={{display:"flex",alignItems:"flex-end",gap:10}}>
        <Spirit size={42} animated variant="kawaii" mood="energized"/>
        <div style={{...Card({borderRadius:"18px 18px 18px 4px",padding:"14px 16px",flex:1,background:th.gSoft,border:"1px solid "+th.gBorder})}}>
          <p style={{fontSize:13,fontFamily:F.display,color:th.text,lineHeight:1.6,margin:0,fontStyle:"italic"}}>
            {lang==="es"?"¿Qué llevas evitando? Dímelo y te doy el único paso que importa ahora.":"What have you been avoiding? Tell me and I'll give you the one step that matters right now."}
          </p>
        </div>
      </div>

      {/* Input */}
      <div style={{...Card({borderRadius:RR.lg,padding:"4px",border:"1.5px solid "+th.gBorder})}}>
        <textarea value={nowInput} onChange={e=>setNowInput(e.target.value)}
          placeholder={t.nowModePlaceholder||"Ej: responder emails del trabajo..."}
          style={{width:"100%",minHeight:72,background:"transparent",border:"none",outline:"none",fontSize:14,color:th.text,lineHeight:1.7,resize:"none",padding:"14px 16px",fontFamily:F.body,boxSizing:"border-box"}}/>
      </div>

      {/* Generate button */}
      <button onClick={runNowMode} disabled={!nowInput.trim()||nowLoad}
        style={{width:"100%",padding:"16px",borderRadius:RR.lg,background:nowInput.trim()&&!nowLoad?th.g:th.cardAlt,border:"none",cursor:nowInput.trim()&&!nowLoad?"pointer":"default",fontFamily:F.body,fontSize:14,fontWeight:700,color:nowInput.trim()&&!nowLoad?"#fff":th.text3,display:"flex",alignItems:"center",justifyContent:"center",gap:9,minHeight:52,transition:"all .3s",boxShadow:"none"}}>
        {nowLoad
          ?<><div style={{width:18,height:18,border:"2px solid rgba(255,255,255,.3)",borderTopColor:"#fff",borderRadius:"50%",animation:"spin .7s linear infinite"}}/>{lang==="es"?"Pensando...":"Thinking..."}</>
          :<><Ic name="drive" size={18} color={nowInput.trim()?"#fff":th.text3} sw={2}/>{t.nowModeBtn||"Dame el primer paso"}</>
        }
      </button>

      {/* Result */}
      {nowStep&&(
        <div style={{...Card({borderRadius:RR.lg,padding:"24px 22px",border:`2px solid ${th.g}30`,background:`linear-gradient(135deg,${th.g}10,${th.g2}06)`}),animation:"fadeSlideUp .5s cubic-bezier(.25,.46,.45,.94) both",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:`linear-gradient(90deg,${th.g},${th.g2})`}}/>
          <div style={{fontSize:9,color:th.g,letterSpacing:2.5,textTransform:"uppercase",fontWeight:700,marginBottom:12,display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:th.gBtn,animation:"pulse 2s ease-in-out infinite"}}/>
            {lang==="es"?"Tu primer paso":"Your first step"}
          </div>
          <p style={{fontFamily:F.display,fontSize:20,fontWeight:500,color:th.text,lineHeight:1.5,margin:"0 0 20px",letterSpacing:-.2}}>{nowStep}</p>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>{haptic("success");setNowStep("");setNowInput("");setMode("pick");}}
              style={{flex:1,padding:"13px",borderRadius:RR.md,background:th.gBtn,border:"none",cursor:"pointer",fontFamily:F.body,fontSize:14,fontWeight:700,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",gap:7,minHeight:46,boxShadow:"0 2px 8px rgba(0,0,0,.15)"}}>
              <Ic name="check" size={16} color="#fff" sw={2.5}/>
              {lang==="es"?"¡Lo hice!":"Done!"}
            </button>
            <button onClick={()=>{setNowStep("");runNowMode();}}
              style={{padding:"13px 16px",borderRadius:RR.md,...Card({border:"1px solid "+th.gBorder}),cursor:"pointer",color:th.g,fontSize:13,fontFamily:F.body,fontWeight:500,minHeight:46}}>
              {lang==="es"?"Otro paso":"Another"}
            </button>
          </div>
        </div>
      )}

      <button onClick={()=>{setMode("pick");setNowInput("");setNowStep("");}}
        style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:th.text3,fontFamily:F.body,display:"flex",alignItems:"center",justifyContent:"center",gap:5,minHeight:40}}>
        <Ic name="back" size={13} color={th.text3} sw={1.3}/> {t.goBack}
      </button>
    </div>
  );

  // ── BREAK BIG TASK SCREEN ──
  if(mode==="easy") return(
    <div style={{flex:1,overflowY:"auto",padding:"0 20px 24px",display:"flex",flexDirection:"column",gap:14,animation:"fadeIn .4s ease both"}}>

      <div style={{textAlign:"center",padding:"8px 0 4px"}}>
        <div style={{fontSize:22,marginBottom:6}}>✂️</div>
        <div style={{fontFamily:F.display,fontSize:16,fontWeight:600,color:th.text,marginBottom:4}}>{t.easyLabel||"Dividir tarea grande"}</div>
        <p style={{fontSize:12,color:th.text3,margin:0,lineHeight:1.5}}>{lang==="es"?"La IA convierte lo imposible en pasos físicos de 5 min":"AI turns the impossible into 5-min physical steps"}</p>
      </div>

      <div style={{...Card({borderRadius:RR.lg,padding:"4px",border:"1.5px solid "+th.border})}}>
        <textarea value={easyInput} onChange={e=>setEasyInput(e.target.value)}
          placeholder={t.easyPlaceholder||"Ej: Escribir el informe, limpiar el cuarto, estudiar para el examen..."}
          style={{width:"100%",minHeight:80,background:"transparent",border:"none",outline:"none",fontSize:14,color:th.text,lineHeight:1.7,resize:"none",padding:"14px 16px",fontFamily:F.body,boxSizing:"border-box"}}/>
      </div>

      <button onClick={breakTask} disabled={!easyInput.trim()||easyLoad}
        style={{width:"100%",padding:"16px",borderRadius:RR.lg,background:easyInput.trim()&&!easyLoad?th.g:th.cardAlt,border:"none",cursor:easyInput.trim()&&!easyLoad?"pointer":"default",fontFamily:F.body,fontSize:14,fontWeight:700,color:easyInput.trim()&&!easyLoad?"#fff":th.text3,display:"flex",alignItems:"center",justifyContent:"center",gap:9,minHeight:52,transition:"all .3s",boxShadow:"none"}}>
        {easyLoad
          ?<><div style={{width:18,height:18,border:"2px solid rgba(255,255,255,.3)",borderTopColor:"#fff",borderRadius:"50%",animation:"spin .7s linear infinite"}}/>{lang==="es"?"Analizando...":"Analyzing..."}</>
          :<><Ic name="sparkle" size={18} color={easyInput.trim()?"#fff":th.text3} sw={2}/>{t.easyBtn||"Dividir en micro-pasos"}</>
        }
      </button>

      {/* Steps list */}
      {easySteps.length>0&&(
        <div style={{animation:"fadeSlideUp .5s ease both"}}>
          {/* zapMessage validation from AI */}
          {easyMsg&&<div style={{display:"flex",alignItems:"flex-start",gap:10,padding:"12px 14px",borderRadius:RR.md,background:th.gSoft,border:"1px solid "+th.gBorder,marginBottom:12}}>
            <Spirit size={30} animated variant="mini" mood="calm"/>
            <p style={{fontSize:13,fontFamily:F.display,color:th.text,lineHeight:1.55,margin:0,fontStyle:"italic",flex:1}}>{easyMsg}</p>
          </div>}
          <div style={{fontSize:10,color:th.text3,letterSpacing:2.5,textTransform:"uppercase",fontWeight:500,marginBottom:10,display:"flex",alignItems:"center",gap:8}}>
            <div style={{flex:1,height:1,background:th.borderLight}}/>
            {easySteps.length} {t.easyStepsTitle||"micro-pasos"}
            <div style={{flex:1,height:1,background:th.borderLight}}/>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {easySteps.map((step,i)=>{
              const done=easyDone[i];
              const meta=easyStepsMeta[i]||{};
              const stepColors=["#5B9E8F","#6A9FBF","#8B7FC0","#C4A97A","#C4867A","#7A9E7E","#9B8EC4"];
              const sc=stepColors[i%stepColors.length];
              return(
                <button key={i} onClick={()=>{haptic("soft");setEasyDone(d=>({...d,[i]:!d[i]}));}}
                  style={{display:"flex",alignItems:"flex-start",gap:12,padding:"14px 16px",borderRadius:RR.md,background:done?th.cardAlt:th.card,border:`1px solid ${done?th.borderLight:sc+"30"}`,cursor:"pointer",textAlign:"left",transition:"all .25s ease",opacity:done?.55:1,boxShadow:done?"none":th.shadow}}>
                  {/* Step number / check */}
                  <div style={{width:26,height:26,borderRadius:"50%",background:done?th.gBtn:sc+"18",border:`2px solid ${done?th.g:sc+"60"}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .25s",marginTop:1}}>
                    {done
                      ?<Ic name="check" size={12} color="#fff" sw={2.5}/>
                      :<span style={{fontSize:11,fontFamily:F.mono,fontWeight:700,color:sc}}>{i+1}</span>
                    }
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <p style={{fontSize:13,color:done?th.text3:th.text,fontFamily:F.body,lineHeight:1.55,margin:"0 0 4px",textDecoration:done?"line-through":"none",transition:"all .25s"}}>{step}</p>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:10,color:sc,fontWeight:600}}>{meta.time||`~${i===0?"1":"4"} min`}</span>
                      {meta.why&&!done&&<span style={{fontSize:10,color:th.text3,fontStyle:"italic",fontFamily:F.display,lineHeight:1.3}}>{meta.why}</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* All done celebration */}
          {Object.keys(easyDone).filter(k=>easyDone[k]).length===easySteps.length&&easySteps.length>0&&(
            <div style={{marginTop:14,padding:"20px",background:`linear-gradient(135deg,${th.g}14,${th.g2}08)`,borderRadius:RR.lg,border:`1.5px solid ${th.gBorder}`,textAlign:"center",animation:"fadeSlideUp .5s cubic-bezier(.25,.46,.45,.94) both"}}>
              <div style={{fontSize:28,marginBottom:8}}>🎉</div>
              <p style={{fontFamily:F.display,fontSize:15,color:th.g,margin:"0 0 4px",fontWeight:600}}>{lang==="es"?"¡Lo hiciste!":"You did it!"}</p>
              <p style={{fontFamily:F.display,fontSize:12,color:th.text2,margin:0,fontStyle:"italic",lineHeight:1.5}}>{t.easyDone||"Lo que parecía imposible, lo conquistaste paso a paso."}</p>
            </div>
          )}
        </div>
      )}

      <button onClick={()=>{setMode("pick");setEasyInput("");setEasySteps([]);setEasyDone({});}}
        style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:th.text3,fontFamily:F.body,display:"flex",alignItems:"center",justifyContent:"center",gap:5,minHeight:40}}>
        <Ic name="back" size={13} color={th.text3} sw={1.3}/> {t.goBack}
      </button>
    </div>
  );

  // ── BREATHE SCREEN ──
  if(mode==="breathe") return(
    <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"0 24px 24px",gap:0,animation:"fadeIn .5s ease both",background:`radial-gradient(ellipse at 50% 40%,${bc}12 0%,transparent 70%)`}}>

      {/* Phase label */}
      <div style={{textAlign:"center",marginBottom:32}}>
        <div style={{fontSize:10,color:th.text3,letterSpacing:3,textTransform:"uppercase",marginBottom:6}}>{t.breathLabel}</div>
        <div style={{fontFamily:F.mono,fontSize:13,color:bc,fontWeight:600,transition:"color 1s ease"}}>
          {t.cyclesComplete(bCt)} {bCt>0&&"✓"}
        </div>
      </div>

      {/* Main breathing orb — multi-layer */}
      <div style={{position:"relative",width:220,height:220,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:32}}>
        {/* Outer glow ring */}
        <div style={{position:"absolute",inset:-16,borderRadius:"50%",background:`radial-gradient(circle,${bc}16 0%,transparent 70%)`,transform:`scale(${bScale})`,transition:`transform ${phD[bPh]}ms cubic-bezier(.4,0,.2,1)`,pointerEvents:"none"}}/>
        {/* Middle pulse ring */}
        <div style={{position:"absolute",inset:0,borderRadius:"50%",border:`1.5px solid ${bc}40`,transform:`scale(${bScale*.9})`,transition:`transform ${phD[bPh]}ms cubic-bezier(.4,0,.2,1)`,opacity:.6}}/>
        {/* Core orb */}
        <div style={{
          width:160,height:160,borderRadius:"50%",
          background:`radial-gradient(circle at 38% 32%,${bc}ee 0%,${bc} 50%,${bc}cc 100%)`,
          boxShadow:`0 0 40px ${bc}40, 0 0 80px ${bc}20, inset 0 2px 0 rgba(255,255,255,.35)`,
          transform:`scale(${bScale})`,
          transition:`transform ${phD[bPh]}ms cubic-bezier(.4,0,.2,1), background ${phD[bPh]}ms ease`,
          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6,
          flexShrink:0,
        }}>
          {/* Phase text inside orb */}
          <div style={{fontFamily:F.display,fontSize:20,fontWeight:500,color:"#fff",letterSpacing:.5,transition:"opacity .4s"}}>{t.breathPhases[bPh]}</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,.75)",letterSpacing:2,fontFamily:F.mono}}>{bPh===2?"6s":"4s"}</div>
        </div>
      </div>

      {/* Progress dots for each phase */}
      <div style={{display:"flex",gap:8,marginBottom:28}}>
        {[0,1,2].map(p=>(
          <div key={p} style={{width:p===bPh?24:8,height:8,borderRadius:100,background:p===bPh?bc:th.borderLight,transition:"all .4s ease"}}/>
        ))}
      </div>

      {/* Phase guide */}
      <div style={{display:"flex",gap:6,marginBottom:32}}>
        {[
          {label:lang==="es"?"Inhala":"Inhale",sec:"4s",c:"#5B9E8F"},
          {label:lang==="es"?"Sostén":"Hold",sec:"4s",c:"#7BBFB0"},
          {label:lang==="es"?"Exhala":"Exhale",sec:"6s",c:"#9B8EC4"},
        ].map((ph,i)=>(
          <div key={i} style={{flex:1,padding:"8px 6px",borderRadius:10,background:i===bPh?bc+"20":th.cardAlt,border:`1px solid ${i===bPh?bc+"50":th.borderLight}`,textAlign:"center",transition:"all .5s ease"}}>
            <div style={{fontSize:11,fontWeight:600,color:i===bPh?bc:th.text3,marginBottom:2}}>{ph.label}</div>
            <div style={{fontFamily:F.mono,fontSize:10,color:i===bPh?bc:th.text3,opacity:.7}}>{ph.sec}</div>
          </div>
        ))}
      </div>

      <button onClick={()=>{setMode("pick");setBCt(0);setBPh(0);}}
        style={{...Card({borderRadius:100,padding:"12px 28px"}),cursor:"pointer",fontSize:13,color:th.text2,fontFamily:F.body,display:"flex",alignItems:"center",gap:7,minHeight:46,border:"1px solid "+th.border}}>
        <Ic name="back" size={14} color={th.text3} sw={1.3}/> {t.goBack}
      </button>
    </div>
  );

  // ── TIMER SCREEN ──
  if(mode==="timer"){
    const isPomodoro=TOTAL_SECS>5*60;
    const timerColor=isPomodoro?"#8B7FC0":"#6A9FBF";
    const elapsed=TOTAL_SECS-secs;
    const progress=elapsed/TOTAL_SECS;
    return(
      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"0 24px 24px",gap:0,animation:"fadeIn .5s ease both",background:`radial-gradient(ellipse at 50% 40%,${timerColor}10 0%,transparent 70%)`}}>

        {/* Title */}
        <div style={{textAlign:"center",marginBottom:24}}>
          <div style={{fontSize:10,color:th.text3,letterSpacing:3,textTransform:"uppercase",marginBottom:4}}>
            {isPomodoro?(lang==="es"?"Bloque de enfoque":"Focus block"):(lang==="es"?"Reset rápido":"Quick reset")}
          </div>
          <div style={{fontSize:11,color:timerColor,fontFamily:F.mono,fontWeight:600}}>
            {isPomodoro?"25:00":"05:00"}
          </div>
        </div>

        {/* Timer ring */}
        <div style={{position:"relative",width:200,height:200,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:28}}>
          <svg width="200" height="200" style={{position:"absolute",transform:"rotate(-90deg)"}}>
            <circle cx="100" cy="100" r={Rv} fill="none" stroke={th.borderLight} strokeWidth="5"/>
            <circle cx="100" cy="100" r={Rv} fill="none" stroke={timerColor} strokeWidth="5"
              strokeLinecap="round" strokeDasharray={circ}
              strokeDashoffset={circ-(progress*circ)}
              style={{transition:"stroke-dashoffset .8s cubic-bezier(.4,0,.2,1)",filter:`drop-shadow(0 0 8px ${timerColor}60)`}}/>
          </svg>
          {/* Center content */}
          <div style={{textAlign:"center",zIndex:1}}>
            <div style={{fontFamily:F.mono,fontSize:38,fontWeight:700,color:th.text,letterSpacing:1,lineHeight:1}}>{mm}:{ss}</div>
            <div style={{fontSize:10,color:timerColor,letterSpacing:2,textTransform:"uppercase",marginTop:6,fontWeight:600}}>
              {run?(secs>5*60?(lang==="es"?"enfocando":"focusing"):(lang==="es"?"descansando":"resting")):(lang==="es"?"listo":"ready")}
            </div>
            {/* Progress fill inside */}
            <div style={{width:60,height:3,borderRadius:100,background:th.borderLight,margin:"10px auto 0",overflow:"hidden"}}>
              <div style={{width:`${progress*100}%`,height:"100%",background:timerColor,borderRadius:100,transition:"width .8s ease"}}/>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div style={{display:"flex",gap:12,marginBottom:20}}>
          <button onClick={()=>{haptic("soft");setRun(r=>!r);}}
            style={{padding:"15px 32px",borderRadius:100,background:run?th.card:`linear-gradient(135deg,${timerColor},${timerColor}cc)`,border:run?`1.5px solid ${timerColor}`:  "none",cursor:"pointer",fontFamily:F.body,fontSize:14,fontWeight:700,color:run?timerColor:"#fff",display:"flex",alignItems:"center",gap:8,boxShadow:run?"none":`0 6px 24px ${timerColor}40`,minHeight:52,transition:"all .3s"}}>
            <Ic name={run?"pause":"play"} size={16} color={run?timerColor:"#fff"} sw={2}/>
            {run?t.pauseBtn:t.start}
          </button>
          <button onClick={()=>{haptic("soft");setRun(false);setSecs(TOTAL_SECS);}}
            style={{width:52,height:52,borderRadius:"50%",...Card({border:"1px solid "+th.border}),cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <Ic name="refresh" size={17} color={th.text3} sw={1.5}/>
          </button>
        </div>

        {/* Switch mode chips */}
        <div style={{display:"flex",gap:8,marginBottom:24}}>
          {[{label:"25 min",s:25*60,active:isPomodoro},{label:"5 min",s:5*60,active:!isPomodoro}].map((o,i)=>(
            <button key={i} onClick={()=>{setRun(false);setSecs(o.s);}}
              style={{padding:"7px 16px",borderRadius:100,background:o.active?timerColor+"18":th.cardAlt,border:`1px solid ${o.active?timerColor+"50":th.border}`,cursor:"pointer",fontFamily:F.mono,fontSize:11,color:o.active?timerColor:th.text3,fontWeight:o.active?700:400,transition:"all .3s"}}>
              {o.label}
            </button>
          ))}
        </div>

        {/* Tip */}
        {!run&&secs===TOTAL_SECS&&<div style={{padding:"12px 16px",borderRadius:RR.md,background:th.cardAlt,border:"1px solid "+th.borderLight,maxWidth:280,textAlign:"center",marginBottom:16}}>
          <p style={{fontFamily:F.display,fontSize:12,color:th.text2,margin:0,fontStyle:"italic",lineHeight:1.5}}>
            {isPomodoro
              ?(lang==="es"?"Pon tu teléfono boca abajo. Una sola tarea. Sin multitarea.":"Phone face down. One task only. No multitasking.")
              :(lang==="es"?"Aléjate de la pantalla. Agua, estiramiento, respiración.":"Step away from the screen. Water, stretch, breathe.")}
          </p>
        </div>}

        <button onClick={()=>{setRun(false);setMode("pick");}}
          style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:th.text3,letterSpacing:1.5,textTransform:"uppercase",fontFamily:F.body,display:"flex",alignItems:"center",gap:5,minHeight:40}}>
          <Ic name="back" size={13} color={th.text3} sw={1.3}/> {t.goBack}
        </button>
      </div>
    );
  }

  if(mode==="sounds") return(
    <div style={{flex:1,overflowY:"auto",padding:"0 20px 24px",display:"flex",flexDirection:"column",gap:16,animation:"fadeIn .4s ease both"}}>
      {mode==="sounds"&&(
        <div style={{display:"flex",flexDirection:"column",gap:16,padding:"8px 0"}}>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:32,marginBottom:8}}>🎧</div>
            <div style={{fontSize:14,fontWeight:600,color:th.text,marginBottom:4}}>{lang==="es"?"Ruido ambiente":"Ambient Sound"}</div>
            <div style={{fontSize:12,color:th.text2}}>{lang==="es"?"Reduce distracciones y mejora el foco":"Reduce distractions and improve focus"}</div>
          </div>
          <div style={{display:"flex",gap:8}}>
            {[{id:"white",label:lang==="es"?"Blanco":"White",emoji:"🌬️"},{id:"pink",label:lang==="es"?"Rosa":"Pink",emoji:"🌸"},{id:"brown",label:lang==="es"?"Marrón":"Brown",emoji:"🌊"}].map(s=>(
              <button key={s.id} onClick={()=>{setSoundType(s.id);if(soundOn)startNoise(s.id);}} style={{flex:1,padding:"12px 8px",borderRadius:RR.md,background:soundType===s.id?th.gSoft:th.card,border:`1px solid ${soundType===s.id?th.gBorder:th.border}`,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                <span style={{fontSize:22}}>{s.emoji}</span>
                <span style={{fontSize:11,color:soundType===s.id?th.g:th.text2,fontWeight:soundType===s.id?600:400}}>{s.label}</span>
              </button>
            ))}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <span style={{fontSize:12,color:th.text3}}>🔉</span>
            <input type="range" min="0" max="1" step="0.05" value={vol} onChange={e=>setVol(parseFloat(e.target.value))} style={{flex:1,accentColor:th.g}}/>
            <span style={{fontSize:12,color:th.text3}}>🔊</span>
          </div>
          <button onClick={()=>{soundOn?stopNoise():startNoise(soundType);}} style={{padding:"14px",borderRadius:100,background:soundOn?`linear-gradient(135deg,#EF4444,#DC2626)`:th.gBtn,border:"none",cursor:"pointer",color:"#fff",fontFamily:F.body,fontSize:15,fontWeight:700,minHeight:52,boxShadow:soundOn?"0 4px 16px rgba(239,68,68,.4)":th.shadowLg,transition:"all .3s ease"}}>
            {soundOn?(lang==="es"?"⏹ Detener":"⏹ Stop"):(lang==="es"?"▶ Iniciar":"▶ Start")}
          </button>
        </div>
      )}
      <button onClick={()=>setMode("pick")}
        style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:th.text3,fontFamily:F.body,display:"flex",alignItems:"center",justifyContent:"center",gap:5,minHeight:40}}>
        <Ic name="back" size={13} color={th.text3} sw={1.3}/> {t.goBack}
      </button>
    </div>
  );

  return null;
}


// ══════════════════════════════════════════════════════════════════════════
// JOURNEY
// ══════════════════════════════════════════════════════════════════════════
// ── Weekly Summary Card ──
function WeeklySummary({lang,th,memory}){
  const Card=useCard();
  const[summary,setSummary]=useState("");
  const[load,setLoad]=useState(false);
  const[generated,setGenerated]=useState(false);

  const generate=async()=>{
    if(load)return;
    setLoad(true);
    const week=memory.slice(-7);
    const totalT=week.reduce((a,m)=>a+(m.tasks||0),0);
    const avgE=(week.reduce((a,m)=>a+parseFloat(m.avg||3),0)/week.length).toFixed(1);
    const best=week.reduce((b,m)=>parseFloat(m.avg)>parseFloat(b.avg)?m:b,week[0]);
    const worst=week.reduce((b,m)=>parseFloat(m.avg)<parseFloat(b.avg)?m:b,week[0]);
    const data=week.map(m=>m.date+"("+m.avg+")").join(",");
    const prompt=lang==="es"
      ?`Eres ZENO. Genera un resumen semanal cálido y específico para una persona con TDAH.
Datos: ${data}
Promedio: ${avgE}/5. Mejor día: ${best.date}(${best.level}). Día más bajo: ${worst.date}(${worst.level}). Total tareas: ${totalT}.
Reglas: 3-4 frases. Menciona datos concretos. Conecta con neurología TDAH. Celebra lo logrado. Sin juicio. Termina con un micro-aliento para la próxima semana.`
      :`You are ZENO. Generate a warm, specific weekly summary for a person with ADHD.
Data: ${data}
Average: ${avgE}/5. Best day: ${best.date}(${best.level}). Lowest day: ${worst.date}(${worst.level}). Total tasks: ${totalT}.
Rules: 3-4 sentences. Mention real data. Connect to ADHD neurology. Celebrate what was done. No judgment. End with a micro-encouragement for next week.`;
    try{
      const r=await aiCall({max_tokens:200,messages:[{role:"user",content:prompt}]});
      setSummary(zenoCheckOutput(r.trim(),lang));
      setGenerated(true);
    }catch{
      setSummary(lang==="es"?"Sin conexión. Pero el hecho de que estés revisando tu semana ya es un logro enorme.":"No connection. But the fact that you're reviewing your week is already a huge win.");
      setGenerated(true);
    }
    setLoad(false);
  };

  return(
    <div style={{...Card({borderRadius:RR.lg,padding:"18px 20px",border:"1px solid "+th.gBorder,background:th.gSoft}),animation:"fadeIn .5s ease .12s both"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
        <div style={{width:28,height:28,borderRadius:10,background:th.gBtn,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <Ic name="star" size={13} color="#fff" sw={1.5}/>
        </div>
        <span style={{fontSize:10,color:th.g,letterSpacing:2,textTransform:"uppercase",fontWeight:700,flex:1}}>
          {lang==="es"?"Resumen semanal IA":"Weekly AI summary"}
        </span>
        {!generated&&<button onClick={generate} disabled={load} style={{background:th.gBtn,border:"none",borderRadius:100,padding:"5px 14px",cursor:load?"default":"pointer",fontSize:11,fontWeight:600,color:"#fff",fontFamily:F.body,opacity:load?.6:1,minHeight:30}}>
          {load?"...":(lang==="es"?"Generar":"Generate")}
        </button>}
        {generated&&<button onClick={()=>{setSummary("");setGenerated(false);generate();}} disabled={load} style={{background:"none",border:"none",cursor:"pointer",fontSize:10,color:th.g,fontFamily:F.body,opacity:load?.5:1}}>
          {load?"...":(lang==="es"?"↻ nuevo":"↻ new")}
        </button>}
      </div>
      {load&&<div style={{display:"flex",gap:5,padding:"4px 0"}}>{[0,1,2].map(j=><div key={j} style={{width:6,height:6,borderRadius:"50%",background:th.gBtn,opacity:.5,animation:"dotB 1.4s ease-in-out infinite",animationDelay:j*.18+"s"}}/>)}</div>}
      {summary&&<p style={{fontFamily:F.display,fontSize:13,color:th.text,lineHeight:1.75,margin:0,fontStyle:"italic"}}>{summary}</p>}
      {!summary&&!load&&<p style={{fontFamily:F.display,fontSize:12,color:th.text3,margin:0,lineHeight:1.6,fontStyle:"italic"}}>
        {lang==="es"?"Genera un análisis inteligente de tu semana con ZENO.":"Generate a smart analysis of your week with ZENO."}
      </p>}
    </div>
  );
}

function JourneyTab(){
  const{t,th,memory,lang,flow}=useCtx();const Card=useCard();
  // Override with local state
  const[insight,setInsight]=useState("");const[insightLoad,setInsightLoad]=useState(false);

  const getInsight=async()=>{
    if(memory.length<2||insightLoad)return;
    setInsightLoad(true);
    const recent=memory.slice(-10);
    const summary=recent.map(m=>m.date+": nivel="+m.level+", energia="+m.avg+"/5, tareas="+m.tasks+(m.scores?", mente="+m.scores.mind+" motivacion="+m.scores.drive:"")).join(" | ");
    const avgE=(recent.reduce((a,m)=>a+parseFloat(m.avg||3),0)/recent.length).toFixed(1);
    const bestDay=recent.reduce((b,m)=>parseFloat(m.avg)>parseFloat(b.avg)?m:b,recent[0]);
    const totalT=recent.reduce((a,m)=>a+(m.tasks||0),0);
    const prompt=lang==="es"
      ?`Eres ZENO analizando los patrones de energía de una persona con TDAH.

DATOS REALES:
Historial reciente: ${summary}
Energía promedio: ${avgE}/5
Mejor día reciente: ${bestDay&&bestDay.date} (${bestDay&&bestDay.level})
Total tareas completadas en período: ${totalT}

REGLAS:
1. Da UN solo insight neurológico específico sobre sus patrones reales.
2. Menciona datos concretos (días, números reales del historial).
3. Conecta el patrón con neurología TDAH (dopamina, función ejecutiva, ritmo circadiano, etc.).
4. Tono cálido y sin juicio. PROHIBIDO: deberías, tienes que, es fácil.
5. Máximo 2 oraciones. Español natural.`
      :`You are ZENO analyzing energy patterns for a person with ADHD.

REAL DATA:
Recent history: ${summary}
Average energy: ${avgE}/5
Best recent day: ${bestDay&&bestDay.date} (${bestDay&&bestDay.level})
Total tasks completed in period: ${totalT}

RULES:
1. Give ONE specific neurological insight about their real patterns.
2. Mention concrete data (real days and numbers from the history).
3. Connect the pattern to ADHD neurology (dopamine, executive function, circadian rhythm, etc.).
4. Warm, non-judgmental tone. FORBIDDEN: you should, you need to, it's easy.
5. Maximum 2 sentences. Natural language.`;
    try{
      const _rawIns=await aiCall({max_tokens:180,messages:[{role:"user",content:prompt}]});
      setInsight(zenoCheckOutput(_rawIns.trim(),lang));
    }catch(e){setInsight("");}
    setInsightLoad(false);
  };

  const insightFetched=useRef(false);
  useEffect(()=>{if(memory.length>=2&&!insightFetched.current){insightFetched.current=true;getInsight();}},[memory.length,lang]);

  if(memory.length===0) return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"20px 0",gap:12}}>
      <Spirit size={48} animated variant="kawaii" mood="calm"/>
      <p style={{fontFamily:F.display,fontSize:13,color:th.text2,fontStyle:"italic",textAlign:"center",lineHeight:1.6,margin:0}}>{t.journeyEmptySub}</p>
    </div>
  );

  const totalTasks=memory.reduce((a,m)=>a+(m.tasks||0),0);
  const streak=memory.length;
  const avgs=memory.map(m=>parseFloat(m.avg)||3);
  const globalAvg=(avgs.reduce((a,b)=>a+b,0)/avgs.length).toFixed(1);
  const best=memory.reduce((b,m)=>parseFloat(m.avg)>parseFloat(b.avg)?m:b,memory[0]);

  // Weekly chart data
  const barData=[...Array(7)].map((_,i)=>{
    const idx=memory.length-7+i;
    const m=memory[idx];
    const dayIdx=m?new Date(m.date).getDay():i;
    return{v:m?Math.min(10,Math.max(0,parseFloat(m.avg)*2)||0):0,
      label:m?(lang==="es"?["D","L","M","X","J","V","S"][dayIdx]:["Su","Mo","Tu","We","Th","Fr","Sa"][dayIdx]):"",m};
  });
  const maxV=Math.max(...barData.map(b=>b.v||0),1);

  // Narrative stats
  const recentAvg=(avgs.slice(-3).reduce((a,b)=>a+b,0)/Math.min(3,avgs.length)).toFixed(1);
  const prevAvg=avgs.length>3?(avgs.slice(-6,-3).reduce((a,b)=>a+b,0)/Math.min(3,avgs.slice(-6,-3).length)).toFixed(1):recentAvg;
  const trend=parseFloat(recentAvg)>parseFloat(prevAvg)?"up":parseFloat(recentAvg)<parseFloat(prevAvg)?"down":"stable";
  const trendColor=trend==="up"?"#22C55E":trend==="down"?"#EF4444":"#F59E0B";
  const trendIcon=trend==="up"?"📈":trend==="down"?"📉":"➡️";

  return(
    <div style={{display:"flex",flexDirection:"column",gap:14}}>

      {/* ── HEADLINE STORY — not just numbers ── */}
      <div style={{...Card({borderRadius:RR.lg,padding:"20px",background:th.gSoft,border:"1px solid "+th.gBorder}),animation:"fadeIn .4s ease both"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
          <div style={{width:40,height:40,borderRadius:12,background:th.gBtn,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <Ic name="journey" size={18} color="#fff" sw={2}/>
          </div>
          <div>
            <div style={{fontFamily:F.display,fontSize:16,fontWeight:700,color:th.g}}>
              {streak} {lang==="es"?"días con ZENO":"days with ZENO"}
            </div>
            <div style={{fontSize:12,color:th.text3}}>
              {totalTasks} {lang==="es"?"tareas completadas":"tasks completed"} · {lang==="es"?"promedio":"avg"} {globalAvg}/5
            </div>
          </div>
          <div style={{marginLeft:"auto",fontSize:20}}>{trendIcon}</div>
        </div>
        {/* Trend narrative */}
        <div style={{padding:"10px 14px",background:th.card,borderRadius:10,border:"1px solid "+th.border}}>
          <p style={{fontFamily:F.display,fontSize:13,color:th.text,lineHeight:1.6,margin:0,fontStyle:"italic"}}>
            {lang==="es"
              ?trend==="up"
                ?"Tu energía está mejorando. Los últimos días ("+recentAvg+") están por encima de tu promedio anterior ("+prevAvg+")."
                :trend==="down"
                ?"Tu energía bajó un poco últimamente ("+recentAvg+" vs "+prevAvg+"). Es normal — tu cerebro también necesita descanso."
                :"Tu energía se mantiene estable en "+recentAvg+"/5. La consistencia también es un logro."
              :trend==="up"
                ?"Your energy is improving. Recent days ("+recentAvg+") are above your previous average ("+prevAvg+")."
                :trend==="down"
                ?"Your energy dipped recently ("+recentAvg+" vs "+prevAvg+"). That's normal — your brain needs rest too."
                :"Your energy is steady at "+recentAvg+"/5. Consistency is also an achievement."
            }
          </p>
        </div>
      </div>

      {/* ── WEEKLY CHART ── */}
      <div style={{...Card({borderRadius:RR.lg,padding:"20px"}),animation:"fadeIn .5s ease .05s both"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontSize:10,color:th.text3,letterSpacing:3,textTransform:"uppercase"}}>{t.weekFlow}</div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:th.g}}/>
            <span style={{fontSize:11,color:th.g,fontWeight:700,fontFamily:F.mono}}>{flow.toFixed(1)}</span>
            <span style={{fontSize:9,color:th.text3}}>{t.currentFlow}</span>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"flex-end",gap:6,height:80,marginBottom:10}}>
          {barData.map((b,i)=>{
            const pct=b.v>0?(b.v/maxV)*100:0;
            const isToday=i===barData.length-1;
            return(
              <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:5,height:"100%",justifyContent:"flex-end"}}>
                <div style={{width:"100%",height:Math.max(b.v===0?4:10,pct)+"%",borderRadius:"6px 6px 3px 3px",background:b.v===0?th.borderLight:isToday?"linear-gradient(to top,"+th.g+","+th.g2+")":th.g+"55",transition:"height .6s cubic-bezier(.25,.46,.45,.94)",boxShadow:isToday?"0 3px 10px "+th.g+"30":"none"}}/>
                <span style={{fontSize:9,color:isToday?th.g:th.text3,fontWeight:isToday?700:400}}>{b.label}</span>
              </div>
            );
          })}
        </div>
        {best&&<div style={{display:"flex",alignItems:"center",gap:6,paddingTop:8,borderTop:"1px solid "+th.borderLight}}>
          <Ic name="star" size={12} color={th.g} sw={1.4}/>
          <span style={{fontSize:11,color:th.text2,fontFamily:F.display,fontStyle:"italic"}}>
            {lang==="es"?"Mejor día: "+best.level+" ("+parseFloat(best.avg).toFixed(1)+")":"Best day: "+best.level+" ("+parseFloat(best.avg).toFixed(1)+")"}
          </span>
        </div>}
      </div>

      {/* ── AI PERSONAL INSIGHT ── */}
      <div style={{...Card({borderRadius:RR.lg,padding:"18px 20px",border:"1px solid "+th.gBorder}),animation:"fadeIn .5s ease .1s both"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
          <div style={{width:28,height:28,borderRadius:10,background:th.gSoft,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <Ic name="sparkle" size={13} color={th.g} sw={1.5}/>
          </div>
          <span style={{fontSize:10,color:th.text3,letterSpacing:2,textTransform:"uppercase",fontWeight:500}}>{t.insightsTitle}</span>
          {memory.length>=2&&<button onClick={getInsight} disabled={insightLoad} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",fontSize:10,color:th.g,fontFamily:F.body,padding:"2px 8px",borderRadius:6,opacity:insightLoad?.5:1}}>
            {insightLoad?"...":(lang==="es"?"↻ nuevo":"↻ new")}
          </button>}
        </div>
        {insightLoad
          ?<div style={{display:"flex",gap:5,padding:"4px 0"}}>{[0,1,2].map(j=><div key={j} style={{width:6,height:6,borderRadius:"50%",background:th.gBtn,opacity:.4,animation:"dotB 1.4s ease-in-out infinite",animationDelay:j*.18+"s"}}/>)}</div>
          :<p style={{fontFamily:F.display,fontSize:13,color:th.text2,lineHeight:1.7,margin:0,fontStyle:"italic"}}>
            {insight||streak+" "+t.checkins+" · "+totalTasks+" "+t.tasksCompleted}
          </p>
        }
      </div>

      {/* ── WEEKLY AI SUMMARY ── */}
      {memory.length>=4&&<WeeklySummary lang={lang} th={th} memory={memory}/>}

      {/* Calendar heatmap */}
      <div style={{...Card({borderRadius:RR.lg,padding:"16px 18px"})}}>
        <div style={{fontSize:10,color:th.text3,letterSpacing:3,textTransform:"uppercase",marginBottom:12}}>
          {lang==="es"?"Últimos 35 días":"Last 35 days"}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
          {[...Array(35)].map((_,i)=>{
            const dayOffset=34-i;
            const d=new Date();d.setDate(d.getDate()-dayOffset);
            const ds=d.toISOString().slice(0,10);
            const m=memory.find(x=>x.date===ds);
            const v=m?parseFloat(m.avg)||0:0;
            const bg=v===0?th.cardAlt:v<=2?"#3B82F680":v<=3?"#F59E0B80":v<=4?"#10B98180":"#5B9E8F";
            return(
              <div key={i} style={{aspectRatio:"1",borderRadius:3,background:bg,transition:"background .3s"}} title={ds+(m?" — "+m.level:"")}/>
            );
          })}
        </div>
        <div style={{display:"flex",gap:12,marginTop:10,justifyContent:"center",alignItems:"center"}}>
          {[{c:th.cardAlt,l:lang==="es"?"Sin datos":"No data"},{c:"#3B82F680",l:"1-2"},{c:"#F59E0B80",l:"3"},{c:"#10B98180",l:"4"},{c:"#5B9E8F",l:"5"}].map((x,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:4}}>
              <div style={{width:8,height:8,borderRadius:2,background:x.c}}/>
              <span style={{fontSize:9,color:th.text3}}>{x.l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── HISTORY LOG ── */}
      {memory.length>0&&<div style={{...Card({borderRadius:RR.lg,padding:"18px 20px"}),animation:"fadeIn .5s ease .15s both"}}>
        <div style={{fontSize:10,color:th.text3,letterSpacing:3,textTransform:"uppercase",marginBottom:14}}>
          {lang==="es"?"Historial":"History"}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {memory.slice(-7).reverse().map((m,i)=>{
            const energyNum=parseFloat(m.avg)||3;
            const lvIdx=Math.min(4,Math.max(0,Math.round(energyNum-1)));
            const emo=LV[lvIdx]&&LV[lvIdx].emoji||"✨";
            const energyColors=["#64748B","#3B82F6","#10B981","#F59E0B","#EF4444"];
            const ec=energyColors[lvIdx];
            return(
              <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:i<Math.min(memory.length,7)-1?"1px solid "+th.borderLight:"none"}}>
                <div style={{width:36,height:36,borderRadius:10,background:ec+"15",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:18,border:"1px solid "+ec+"30"}}>{emo}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:600,color:th.text,marginBottom:1}}>{m.level}</div>
                  <div style={{fontSize:11,color:th.text3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {m.date} · {m.tasks} {lang==="es"?"tareas":"tasks"}
                  </div>
                </div>
                <div style={{fontFamily:F.mono,fontSize:14,fontWeight:700,color:ec,flexShrink:0}}>{parseFloat(m.avg).toFixed(1)}</div>
              </div>
            );
          })}
        </div>
      </div>}


    </div>
  );
}


function BiometricToggleCard({lang, th}){
  const Card=useCard();
  const[enabled,setEnabled]=useState(()=>{try{return localStorage.getItem(BIOMETRIC_KEY)==="true";}catch{return false;}});
  const[avail,setAvail]=useState(false);
  const[checking,setChecking]=useState(true);

  useEffect(()=>{biometricAvailable().then(ok=>{setAvail(ok);setChecking(false);});},[]);

  const toggle=async()=>{
    if(!avail) return;
    if(!enabled){
      // Verify biometric before enabling
      const res=await biometricAuthenticate(lang==="es"?"Confirma para activar Face ID":"Confirm to enable Face ID");
      if(!res.success) return;
    }
    const next=!enabled;
    setEnabled(next);
    try{localStorage.setItem(BIOMETRIC_KEY,String(next));}catch{}
  };

  if(checking) return null;

  return(
    <div style={{...Card({borderRadius:RR.lg,padding:"18px 20px"}),animation:"fadeIn .5s ease .07s both"}}>
      <div style={{fontSize:10,color:th.text3,letterSpacing:3,textTransform:"uppercase",marginBottom:14,display:"flex",alignItems:"center",gap:6}}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={th.text3} strokeWidth="1.5" strokeLinecap="round">
          <path d="M12 1C8 1 5 4 5 8v1M12 1c4 0 7 3 7 7v1"/>
          <rect x="3" y="9" width="18" height="13" rx="3"/>
          <circle cx="12" cy="16" r="2" fill={th.text3} stroke="none"/>
        </svg>
        {lang==="es"?"Seguridad biométrica":"Biometric security"}
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontSize:14,fontWeight:600,color:th.text,marginBottom:3}}>
            {lang==="es"?"Face ID / Touch ID":"Face ID / Touch ID"}
          </div>
          <div style={{fontSize:11,color:th.text3,lineHeight:1.4}}>
            {!avail
              ?(lang==="es"?"No disponible en este dispositivo":"Not available on this device")
              :enabled
              ?(lang==="es"?"Activo — se pedirá al abrir ZENO":"Active — required when opening ZENO")
              :(lang==="es"?"Protege tu privacidad con biometría":"Protect your privacy with biometrics")}
          </div>
        </div>
        <button onClick={toggle} disabled={!avail}
          style={{width:48,height:28,borderRadius:100,border:"none",
            cursor:avail?"pointer":"not-allowed",
            background:enabled?th.gBtn:"#D1D5DB",
            transition:"all .3s ease",position:"relative",flexShrink:0,
            opacity:avail?1:.4}}>
          <div style={{width:22,height:22,borderRadius:"50%",background:"#fff",
            position:"absolute",top:3,left:enabled?23:3,
            transition:"left .3s ease",boxShadow:"0 1px 4px rgba(0,0,0,.25)"}}/>
        </button>
      </div>
    </div>
  );
}

// ── Export / Import Card ──
function ExportImportCard({lang,th}){
  const{memory,savedTasks,userName,flow,accent,dark:darkMode}=useCtx();
  const Card=useCard();
  const[importing,setImporting]=useState(false);
  const[msg,setMsg]=useState("");
  const fileRef=useRef(null);

  const doExport=()=>{
    const payload={
      _zenoExport:true,_version:2,_date:new Date().toISOString(),
      userName,memory,flow,accent,dark:darkMode,
      tasks:savedTasks,
    };
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;a.download="zeno-backup-"+new Date().toISOString().split("T")[0]+".json";
    document.body.appendChild(a);a.click();
    document.body.removeChild(a);URL.revokeObjectURL(url);
    haptic("success");
    setMsg(lang==="es"?"Backup descargado ✓":"Backup downloaded ✓");
    setTimeout(()=>setMsg(""),3000);
  };

  const doImport=(e)=>{
    const file=e.target.files&&e.target.files[0];
    if(!file)return;
    setImporting(true);
    const reader=new FileReader();
    reader.onload=async(ev)=>{
      try{
        const d=JSON.parse(ev.target.result);
        if(!d._zenoExport)throw new Error("not a zeno backup");
        // Restore to localStorage only (full reload will pick it up)
        if(d.memory||d.tasks||d.userName){
          const existing=await loadData()||{};
          await saveData({...existing,
            userName:d.userName||existing.userName,
            memory:d.memory||existing.memory,
            flow:d.flow||existing.flow,
            accent:d.accent||existing.accent,
            dark:d.dark!==undefined?d.dark:existing.dark,
          });
          if(d.tasks)await saveTasks(d.tasks);
          setMsg(lang==="es"?"Datos restaurados — recargando...":"Data restored — reloading...");
          setTimeout(()=>window.location.reload(),1200);
        }
      }catch{
        setMsg(lang==="es"?"Archivo inválido":"Invalid file");
        setTimeout(()=>setMsg(""),3000);
      }
      setImporting(false);
    };
    reader.readAsText(file);
    e.target.value="";
  };

  return(
    <div style={{...Card({borderRadius:RR.lg,padding:"18px 20px",border:"1px solid "+th.borderLight}),animation:"fadeIn .5s ease .19s both"}}>
      <div style={{fontSize:10,color:th.text3,letterSpacing:3,textTransform:"uppercase",marginBottom:14,display:"flex",alignItems:"center",gap:6}}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={th.text3} strokeWidth="1.5" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
        {lang==="es"?"Mis datos":"My data"}
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={doExport} style={{flex:1,padding:"11px 12px",borderRadius:12,background:th.gSoft,border:"1px solid "+th.gBorder,cursor:"pointer",fontFamily:F.body,fontSize:12,fontWeight:500,color:th.g,display:"flex",alignItems:"center",justifyContent:"center",gap:6,minHeight:44}}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={th.g} strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
          {lang==="es"?"Exportar":"Export"}
        </button>
        <button onClick={()=>fileRef.current?.click()} disabled={importing} style={{flex:1,padding:"11px 12px",borderRadius:12,background:th.cardAlt,border:"1px solid "+th.borderLight,cursor:"pointer",fontFamily:F.body,fontSize:12,fontWeight:500,color:th.text2,display:"flex",alignItems:"center",justifyContent:"center",gap:6,minHeight:44}}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={th.text2} strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
          {importing?(lang==="es"?"Cargando...":"Loading..."):(lang==="es"?"Importar":"Import")}
        </button>
      </div>
      <input ref={fileRef} type="file" accept=".json" style={{display:"none"}} onChange={doImport}/>
      {msg&&<div style={{marginTop:8,fontSize:11,color:th.g,fontFamily:F.display,fontStyle:"italic",textAlign:"center",animation:"fadeIn .3s ease both"}}>{msg}</div>}
      <p style={{fontSize:10,color:th.text3,margin:"8px 0 0",lineHeight:1.5,fontFamily:F.display,fontStyle:"italic"}}>
        {lang==="es"?"Tus datos solo están en tu dispositivo. Exporta para hacer backup o para transferirlos.":"Your data lives on your device only. Export to back up or transfer it."}
      </p>
    </div>
  );
}

// ── Auto dark mode option ──
const AUTO_DARK_KEY="zeno-auto-dark";

function ApiKeyCard({lang,th}){
  const Card=useCard();
  const[key,setKey]=useState(()=>getApiKey());
  const[show,setShow]=useState(false);
  const[saved,setSaved]=useState(false);
  const save=()=>{setApiKey(key.trim());setSaved(true);haptic("success");setTimeout(()=>setSaved(false),2000);};
  return(
    <div style={{...Card({borderRadius:RR.lg,padding:"18px 20px"}),animation:"fadeIn .5s ease both"}}>
      <div style={{fontSize:10,color:th.text3,letterSpacing:3,textTransform:"uppercase",marginBottom:12,display:"flex",alignItems:"center",gap:6}}>
        <Ic name="shield" size={13} color={th.text3} sw={1.3}/>
        {lang==="es"?"🤖 IA — Gemini API Key":"🤖 AI — Gemini API Key"}
      </div>
      <div style={{background:th.gSoft,border:`1px solid ${th.gBorder}`,borderRadius:RR.md,padding:"10px 14px",marginBottom:12}}>
        <div style={{fontSize:12,fontWeight:600,color:th.g,marginBottom:4}}>
          {lang==="es"?"Gratis · Sin tarjeta · 1 minuto":"Free · No credit card · 1 minute"}
        </div>
        <div style={{fontSize:11,color:th.text2,lineHeight:1.5}}>
          {lang==="es"
            ?"1. Ve a aistudio.google.com/apikey\n2. Inicia con Google\n3. Create API Key → copia"
            :"1. Go to aistudio.google.com/apikey\n2. Sign in with Google\n3. Create API Key → copy"}
        </div>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:8}}>
        <input
          type={show?"text":"password"}
          value={key}
          onChange={e=>setKey(e.target.value)}
          placeholder="AIza..."
          style={{flex:1,padding:"10px 14px",borderRadius:RR.md,background:th.cardAlt,border:`1px solid ${th.border}`,color:th.text,fontFamily:F.mono,fontSize:12,outline:"none",minHeight:44}}
        />
        <button onClick={()=>setShow(s=>!s)} style={{padding:"10px 12px",borderRadius:RR.md,background:th.cardAlt,border:`1px solid ${th.border}`,cursor:"pointer",color:th.text2,minHeight:44}}>
          {show?"🙈":"👁"}
        </button>
      </div>
      <button onClick={save} style={{width:"100%",padding:"10px",borderRadius:RR.md,background:saved?th.g:th.gBtn,border:"none",cursor:"pointer",color:"#fff",fontFamily:F.body,fontSize:13,fontWeight:600,transition:"background .3s",minHeight:44}}>
        {saved?(lang==="es"?"¡Guardada!":"Saved!"):(lang==="es"?"Guardar":"Save")}
      </button>
      <p style={{fontSize:10,color:th.text3,marginTop:8,lineHeight:1.5,margin:"8px 0 0"}}>
        {lang==="es"?"Tu API key se guarda solo en este dispositivo y nunca se envía a ningún servidor.":"Your API key is stored only on this device and never sent to any server."}
      </p>
    </div>
  );
}

function XPProfileCard({lang,th}){
  const{xp}=useCtx();const Card=useCard();
  const level=getLevel(xp);const next=getNextLevel(xp);const pct=getLevelProgress(xp);
  return(
    <div style={{...Card({borderRadius:RR.lg,padding:"18px 20px"}),animation:"fadeIn .5s ease both",border:`1px solid ${level.color}30`}}>
      <div style={{display:"flex",alignItems:"center",gap:14}}>
        <div style={{width:52,height:52,borderRadius:16,background:`${level.color}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,flexShrink:0,border:`2px solid ${level.color}40`}}>{level.emoji}</div>
        <div style={{flex:1}}>
          <div style={{fontSize:16,fontWeight:700,color:level.color,fontFamily:F.body,marginBottom:2}}>{lang==="es"?level.nameEs:level.name}</div>
          <div style={{fontSize:11,color:th.text3,marginBottom:6,fontFamily:F.body}}>{xp} XP total{next?` · ${next.max-xp+1} para ${lang==="es"?next.nameEs:next.name}`:` · Nivel máximo ✨`}</div>
          <div style={{height:6,borderRadius:6,background:th.cardAlt,overflow:"hidden"}}>
            <div style={{height:"100%",borderRadius:6,background:`linear-gradient(90deg,${level.color},${level.color}80)`,width:`${Math.round(pct*100)}%`,transition:"width 1s ease"}}/>
          </div>
        </div>
      </div>
    </div>
  );
}
function YouTab({onLogout}){
  const{t,th,lang,setLang,dark,setDark,autoDark,setAutoDark,setDarkRaw,accent,setAccent,userName,memory,profilePhoto,setProfilePhoto,brainType,challenge}=useCtx();const Card=useCard();
  const[tog,setTog]=useState({0:true,1:true,2:true,3:false});const sets=[t.pref1,t.pref2,t.pref3,t.pref4];const sIc=["bell","moon","shield","smile"];
  return(<div style={{flex:1,overflowY:"auto",padding:"0 22px 16px",display:"flex",flexDirection:"column",gap:12}}>
    {/* Profile */}
    <div style={{...Card({borderRadius:RR.lg,padding:"20px"}),animation:"fadeIn .5s ease both"}}>
      <div style={{display:"flex",alignItems:"center",gap:14}}>
        <div style={{position:"relative",flexShrink:0}}>
          <div style={{width:64,height:64,borderRadius:"50%",overflow:"hidden",background:th.gBtn,boxShadow:"0 2px 8px rgba(0,0,0,.15)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}
            onClick={()=>document.getElementById("photoInput").click()}>
            {profilePhoto
              ?<img src={profilePhoto} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="profile"/>
              :<img src={M.kawaii} style={{width:"80%",height:"80%",objectFit:"contain"}} alt="ZENO"/>}
          </div>
          <div onClick={()=>document.getElementById("photoInput").click()} style={{position:"absolute",bottom:0,right:0,width:22,height:22,borderRadius:"50%",background:th.gBtn,border:`2px solid ${th.card}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
          </div>
          <input id="photoInput" type="file" accept="image/*" style={{display:"none"}}
            onChange={(e)=>{const file=e.target.files&&e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=(ev)=>{setProfilePhoto(ev.target.result);haptic("success");};reader.readAsDataURL(file);}}/>
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:F.display,fontSize:20,fontWeight:600,color:th.text,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{userName}</div>
          <div style={{fontSize:12,color:th.text2,marginBottom:6}}>{t.adhdSeeker}</div>
          {/* XP inline */}
          <XPBar lang={lang} th={th}/>
          {profilePhoto&&<button onClick={()=>{setProfilePhoto(null);haptic("soft");}} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:th.text3,fontFamily:F.body,padding:"4px 0 0",display:"block"}}>{lang==="es"?"Quitar foto":"Remove photo"}</button>}
        </div>
      </div>
    </div>

    {/* ── Tu Camino section ── */}
    <div style={{animation:"fadeIn .5s ease .03s both"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,paddingTop:4}}>
        <div style={{width:24,height:24,borderRadius:8,background:th.gBtn,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <Ic name="journey" size={12} color="#fff" sw={2}/>
        </div>
        <span style={{fontSize:10,color:th.text3,letterSpacing:3,textTransform:"uppercase",fontWeight:700}}>{lang==="es"?"Tu Camino":"Your Journey"}</span>
      </div>
      {memory.length===0&&<div style={{...Card({borderRadius:RR.md,padding:"14px 16px",background:th.gSoft,border:`1px solid ${th.gBorder}`}),marginBottom:8,display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontSize:24}}>👆</span>
        <div>
          <div style={{fontSize:13,fontWeight:600,color:th.g,marginBottom:2}}>{lang==="es"?"Haz tu primer check-in":"Do your first check-in"}</div>
          <div style={{fontSize:11,color:th.text2,lineHeight:1.4}}>{lang==="es"?"Ve a Inicio → registra tu energía para ver tu camino aquí":"Go to Home → log your energy to see your journey here"}</div>
        </div>
      </div>}
      <JourneyTab/>
    </div>

    {/* Brain profile — shows brainType + challenge from onboarding */}
    {(brainType||challenge)&&<div style={{...Card({borderRadius:RR.lg,padding:"16px 18px"}),animation:"fadeIn .5s ease .04s both"}}>
      <div style={{fontSize:10,color:th.text3,letterSpacing:3,textTransform:"uppercase",marginBottom:12,display:"flex",alignItems:"center",gap:6}}>
        <Ic name="mind" size={13} color={th.text3} sw={1.3}/>
        {lang==="es"?"Tu perfil cerebral":"Your brain profile"}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {brainType&&<div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderRadius:RR.sm,background:th.gSoft,border:"1px solid "+th.gBorder}}>
          <span style={{fontSize:18}}>{brainType==="adhd"?"⚡":brainType==="suspect"?"🧩":brainType==="neuro"?"🌀":"🔍"}</span>
          <div style={{flex:1}}>
            <div style={{fontSize:12,fontWeight:600,color:th.g}}>
              {lang==="es"
                ?brainType==="adhd"?"TDAH diagnosticado":brainType==="suspect"?"Creo que tengo TDAH":brainType==="neuro"?"Neurodivergente":"Explorando"
                :brainType==="adhd"?"Diagnosed ADHD":brainType==="suspect"?"Think I have ADHD":brainType==="neuro"?"Neurodivergent":"Exploring"}
            </div>
            <div style={{fontSize:10,color:th.text3}}>{lang==="es"?"Tipo de cerebro":"Brain type"}</div>
          </div>
        </div>}
        {challenge&&<div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderRadius:RR.sm,background:th.cardAlt,border:"1px solid "+th.border}}>
          <span style={{fontSize:18}}>{challenge==="start"?"🚀":challenge==="focus"?"🎯":challenge==="memory"?"🧠":"🌊"}</span>
          <div style={{flex:1}}>
            <div style={{fontSize:12,fontWeight:600,color:th.text}}>
              {lang==="es"
                ?challenge==="start"?"Parálisis de inicio":challenge==="focus"?"Mantener el foco":challenge==="memory"?"Memoria y olvidos":"Sentirme abrumado"
                :challenge==="start"?"Initiation paralysis":challenge==="focus"?"Staying focused":challenge==="memory"?"Memory & forgetting":"Feeling overwhelmed"}
            </div>
            <div style={{fontSize:10,color:th.text3}}>{lang==="es"?"Tu mayor reto":"Your main challenge"}</div>
          </div>
        </div>}
      </div>
    </div>}
    {/* Color palette — grouped modern picker */}
    <div style={{...Card({borderRadius:RR.lg,padding:"18px 20px"}),animation:"fadeIn .5s ease .03s both"}}>
      <div style={{fontSize:10,color:th.text3,letterSpacing:3,textTransform:"uppercase",marginBottom:14,display:"flex",alignItems:"center",gap:6}}>
        <Ic name="palette" size={13} color={th.text3} sw={1.3}/> {t.colorTitle}
      </div>
      {/* Group: Verdes */}
      <div style={{marginBottom:12}}>
        <div style={{fontSize:9,color:th.text3,letterSpacing:2,textTransform:"uppercase",marginBottom:8,opacity:.7}}>Verde · Teal</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {ACCENTS.slice(0,4).map(a=>(
            <button key={a.id} onClick={()=>setAccent(a.id)} style={{
              display:"flex",flexDirection:"column",alignItems:"center",gap:5,
              background:"none",border:"none",cursor:"pointer",padding:0,
            }}>
              <div style={{
                width:32,height:32,borderRadius:"50%",
                background:`radial-gradient(circle at 35% 35%, ${a.c2}, ${a.c})`,
                border:accent===a.id?`2.5px solid ${th.text}`:`2.5px solid transparent`,
                outline:accent===a.id?`1px solid ${a.c}`:`1px solid transparent`,
                outlineOffset:2,
                transition:"all .25s ease",
                transform:accent===a.id?"scale(1.18)":"scale(1)",
                boxShadow:accent===a.id?`0 4px 12px ${a.c}50`:`0 2px 6px ${a.c}25`,
              }}/>
              <span style={{fontSize:8,color:accent===a.id?a.c:th.text3,fontWeight:accent===a.id?600:400,letterSpacing:.5,transition:"color .25s"}}>{a.label}</span>
            </button>
          ))}
        </div>
      </div>
      {/* Group: Azules */}
      <div style={{marginBottom:12}}>
        <div style={{fontSize:9,color:th.text3,letterSpacing:2,textTransform:"uppercase",marginBottom:8,opacity:.7}}>Azul · Morado</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {ACCENTS.slice(4,8).map(a=>(
            <button key={a.id} onClick={()=>setAccent(a.id)} style={{
              display:"flex",flexDirection:"column",alignItems:"center",gap:5,
              background:"none",border:"none",cursor:"pointer",padding:0,
            }}>
              <div style={{
                width:32,height:32,borderRadius:"50%",
                background:`radial-gradient(circle at 35% 35%, ${a.c2}, ${a.c})`,
                border:accent===a.id?`2.5px solid ${th.text}`:`2.5px solid transparent`,
                outline:accent===a.id?`1px solid ${a.c}`:`1px solid transparent`,
                outlineOffset:2,
                transition:"all .25s ease",
                transform:accent===a.id?"scale(1.18)":"scale(1)",
                boxShadow:accent===a.id?`0 4px 12px ${a.c}50`:`0 2px 6px ${a.c}25`,
              }}/>
              <span style={{fontSize:8,color:accent===a.id?a.c:th.text3,fontWeight:accent===a.id?600:400,letterSpacing:.5,transition:"color .25s"}}>{a.label}</span>
            </button>
          ))}
        </div>
      </div>
      {/* Group: Cálidos */}
      <div>
        <div style={{fontSize:9,color:th.text3,letterSpacing:2,textTransform:"uppercase",marginBottom:8,opacity:.7}}>Cálido · Tierra</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {ACCENTS.slice(8,12).map(a=>(
            <button key={a.id} onClick={()=>setAccent(a.id)} style={{
              display:"flex",flexDirection:"column",alignItems:"center",gap:5,
              background:"none",border:"none",cursor:"pointer",padding:0,
            }}>
              <div style={{
                width:32,height:32,borderRadius:"50%",
                background:`radial-gradient(circle at 35% 35%, ${a.c2}, ${a.c})`,
                border:accent===a.id?`2.5px solid ${th.text}`:`2.5px solid transparent`,
                outline:accent===a.id?`1px solid ${a.c}`:`1px solid transparent`,
                outlineOffset:2,
                transition:"all .25s ease",
                transform:accent===a.id?"scale(1.18)":"scale(1)",
                boxShadow:accent===a.id?`0 4px 12px ${a.c}50`:`0 2px 6px ${a.c}25`,
              }}/>
              <span style={{fontSize:8,color:accent===a.id?a.c:th.text3,fontWeight:accent===a.id?600:400,letterSpacing:.5,transition:"color .25s"}}>{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
    {/* Appearance: Language + Theme unified */}
    <div style={{...Card({borderRadius:RR.lg,padding:"18px 20px"}),animation:"fadeIn .5s ease .05s both"}}>
      <div style={{fontSize:10,color:th.text3,letterSpacing:3,textTransform:"uppercase",marginBottom:14,display:"flex",alignItems:"center",gap:6}}>
        <Ic name="palette" size={13} color={th.text3} sw={1.3}/>
        {lang==="es"?"Apariencia":"Appearance"}
      </div>
      {/* Language row */}
      <div style={{marginBottom:12}}>
        <div style={{fontSize:11,color:th.text3,marginBottom:8}}>{t.langTitle}</div>
        <div style={{display:"flex",gap:8}}>{[{code:"es",label:"Español",flag:"🇪🇸"},{code:"en",label:"English",flag:"🇺🇸"}].map(l=>(<button key={l.code} onClick={()=>setLang(l.code)} style={{flex:1,padding:"10px",borderRadius:RR.md,cursor:"pointer",background:lang===l.code?th.gSoft:th.cardAlt,border:`1px solid ${lang===l.code?th.gBorder:th.border}`,transition:"all .3s ease",display:"flex",alignItems:"center",justifyContent:"center",gap:8,minHeight:40}}><span style={{fontSize:15}}>{l.flag}</span><span style={{fontFamily:F.body,fontSize:12,fontWeight:lang===l.code?600:400,color:lang===l.code?th.g:th.text2}}>{l.label}</span></button>))}</div>
      </div>
      {/* Theme row */}
      <div>
        <div style={{fontSize:11,color:th.text3,marginBottom:8}}>{t.themeTitle}</div>
        <div style={{display:"flex",gap:8}}>
          {[{d:false,label:t.themeLight,icon:"sun"},{d:true,label:t.themeDark,icon:"moon"}].map(m=>{const ac=!autoDark&&dark===m.d;return(<button key={m.label} onClick={()=>setDark(m.d)} style={{flex:1,padding:"9px 6px",borderRadius:RR.md,cursor:"pointer",background:ac?th.gSoft:th.cardAlt,border:`1px solid ${ac?th.gBorder:th.border}`,transition:"all .3s ease",display:"flex",alignItems:"center",justifyContent:"center",gap:5,minHeight:40}}><Ic name={m.icon} size={14} color={ac?th.g:th.text3} sw={1.3}/><span style={{fontFamily:F.body,fontSize:12,fontWeight:ac?600:400,color:ac?th.g:th.text2}}>{m.label}</span></button>);})}
          <button onClick={()=>setAutoDark(true)} style={{flex:1,padding:"9px 6px",borderRadius:RR.md,cursor:"pointer",background:autoDark?th.gSoft:th.cardAlt,border:`1px solid ${autoDark?th.gBorder:th.border}`,transition:"all .3s ease",display:"flex",alignItems:"center",justifyContent:"center",gap:5,minHeight:40}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={autoDark?th.g:th.text3} strokeWidth="1.3" strokeLinecap="round"><circle cx="12" cy="12" r="5"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2"/></svg>
            <span style={{fontFamily:F.body,fontSize:12,fontWeight:autoDark?600:400,color:autoDark?th.g:th.text2}}>Auto</span>
          </button>
        </div>
      </div>
    </div>
    {/* Prefs */}
    <div style={{...Card({borderRadius:RR.lg,padding:"18px 20px"}),animation:"fadeIn .5s ease .1s both"}}><div style={{fontSize:10,color:th.text3,letterSpacing:3,textTransform:"uppercase",marginBottom:14}}>{t.prefsTitle}</div>{sets.map((s,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:12,marginBottom:i<sets.length-1?16:0}}><div style={{width:34,height:34,borderRadius:10,background:th.gSoft,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Ic name={sIc[i]} size={15} color={th.g} sw={1.3}/></div><div style={{flex:1}}><div style={{fontSize:13,fontWeight:500,color:th.text,marginBottom:1}}>{s.label}</div><div style={{fontSize:11,color:th.text3}}>{s.sub}</div></div><button onClick={()=>setTog(x=>({...x,[i]:!x[i]}))} style={{width:42,height:24,borderRadius:100,position:"relative",background:tog[i]?th.g:th.cardAlt,border:"none",cursor:"pointer",transition:"all .35s ease",flexShrink:0}}><div style={{position:"absolute",top:2,left:tog[i]?20:2,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left .35s cubic-bezier(.25,.46,.45,.94)",boxShadow:"0 1px 3px rgba(0,0,0,.15)"}}/></button></div>))}</div>

    {/* Notifications */}
    <NotifSettingsPanel lang={lang} th={th}/>

    {/* Face ID / Touch ID */}
    <BiometricToggleCard lang={lang} th={th}/>

    {/* Mental health disclaimer — Apple Guideline 1.4.1 */}
    <div style={{...Card({borderRadius:RR.md,padding:"12px 16px",background:"transparent",border:"1px solid "+th.borderLight}),animation:"fadeIn .5s ease .2s both"}}>
      <p style={{fontSize:11,color:th.text3,lineHeight:1.6,textAlign:"center",margin:0}}>
        ⚠️ {lang==="es"
          ?"ZENO es un compañero de apoyo y no sustituye atención médica o terapéutica profesional."
          :"ZENO is a support companion and does not replace professional medical or therapeutic care."}
      </p>
    </div>
    {/* ── Export / Import data ── */}
    <ExportImportCard lang={lang} th={th}/>

    {/* API Key */}
    <ApiKeyCard lang={lang} th={th}/>

    {/* Version */}
    <div style={{textAlign:"center",padding:"4px 0 2px"}}><span style={{fontSize:9,color:th.text3,letterSpacing:2,opacity:.5}}>ZENO v{"1.3.0"} · Built with 💚</span></div>
    {/* Logout */}
    <button onClick={onLogout} style={{...Card({borderRadius:RR.md,padding:"14px"}),cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,color:th.text3,fontSize:13,fontFamily:F.body,transition:"all .3s ease",animation:"fadeIn .5s ease .22s both",minHeight:48}} onMouseEnter={e=>{e.currentTarget.style.color=th.text2;}} onMouseLeave={e=>{e.currentTarget.style.color=th.text3;}}><Ic name="logout" size={16} color="currentColor" sw={1.3}/> {t.logoutBtn||"Cerrar sesión"}</button>
  </div>);
}

// ══════════════════════════════════════════════════════════════════════════
// FLOATING AI AGENT — Neuroadaptive companion always available
// ══════════════════════════════════════════════════════════════════════════
function AIAgent(){
  const{t,th,memory,userName,lang:L,savedTasks,brainType,challenge}=useCtx();
  const[open,setOpen]=useState(false);
  // 0 = ZENO companion, 1-3 = personas (NOVA, AXIS, ECHO)
  const[sel,setSel]=useState(0);

  // ── ZENO companion state ──
  const[zMsgs,setZMsgs]=useState([]);
  useEffect(()=>{loadAgent().then(d=>{if(d&&d.length)setZMsgs(d);});},[]);
  useEffect(()=>{if(zMsgs.length>0)saveAgent(zMsgs.slice(-40));},[zMsgs]);
  const[zInput,setZInput]=useState("");const[zLoad,setZLoad]=useState(false);
  const zRef=useRef(null);
  const[voiceActive,setVoiceActive]=useState(false);
  const recRef=useRef(null);
  const startVoice=(setInput)=>{
    try{
      const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
      if(!SR)return;
      const r=new SR();r.lang=L==="es"?"es-ES":"en-US";r.interimResults=false;r.maxAlternatives=1;
      r.onstart=()=>setVoiceActive(true);
      r.onresult=(e)=>{const t=e.results[0][0].transcript;setInput(prev=>prev+(prev?" ":"")+t);};
      r.onend=()=>setVoiceActive(false);
      r.onerror=()=>setVoiceActive(false);
      recRef.current=r;r.start();
    }catch{setVoiceActive(false);}
  };
  useEffect(()=>{zRef.current?.scrollIntoView({behavior:"smooth"});},[zMsgs,zLoad]);

  // ── Persona state ──
  const PS=[{id:"sol",...t.personaSol,icon:"drive",c1:"#3B82F6"},{id:"luna",...t.personaLuna,icon:"mind",c1:"#6366F1"},{id:"flor",...t.personaFlor,icon:"heart",c1:"#0D9488"}];
  const OP={sol:t.openSol,luna:t.openLuna,flor:t.openFlor};
  const memStr=buildUserProfile(memory,userName,L||"es");
  const[hist,setHist]=useState({});
  const[pInput,setPInput]=useState("");const[pLoad,setPLoad]=useState(false);
  const pRef=useRef(null);
  const inputRef=useRef(null);
  useEffect(()=>{setHist({});},[L]);
  useEffect(()=>{
    if(sel===0)return;
    const p=PS[sel-1];
    setHist(h=>({...h,[p.id]:h[p.id]||[{role:"assistant",content:OP[p.id],ts:Date.now()}]}));
  },[sel,L]);
  useEffect(()=>{pRef.current?.scrollIntoView({behavior:"smooth"});},[hist,pLoad]);

  // ── Brain state ──
  const lastM=memory[memory.length-1];
  const bs=lastM?.scores||{body:3,mind:3,heart:3,drive:3};
  const bAvg=lastM?parseFloat(lastM.avg):3;
  const bLevel=lastM?.level||"Presente";
  const pending=(savedTasks||[]).filter(tk=>!tk.done).map(tk=>tk.text);
  const brainCtx=`ESTADO NEUROLÓGICO AHORA:\n- Foco CPF: ${bs.mind}/5${bs.mind<=2?" ⚠️ función ejecutiva comprometida":bs.mind>=4?" ✓ ventana cognitiva abierta":""}\n- Dopamina/Motivación: ${bs.drive}/5${bs.drive<=2?" ⚠️ barrera de inicio elevada":""}\n- Regulación emocional: ${bs.heart}/5${bs.heart<=2?" ⚠️ RSD elevado — tono ultra-cuidadoso":""}\n- Energía corporal: ${bs.body}/5${bs.body<=2?" ⚠️ sistema en modo ahorro":""}\n- Global: ${bAvg}/5 — Nivel: ${bLevel}${pending.length?"\n- Tareas pendientes: "+pending.slice(0,3).join(", "):""}${userName?"\nUsuario: "+userName+".":""}${brainType?" Perfil: "+brainType+".":""}${challenge?" Reto: "+challenge+".":""}`;
  const userProfile=buildUserProfile(memory,userName,L||"es");
  const zenoSys=t.agentSys+"\n\n"+brainCtx+(userProfile?"\n\n"+userProfile:"")+"\n\nADAPTA tu respuesta al estado neurológico. Sé breve (2-3 oraciones máximo).";

  const bGreeting=bs.mind<=2&&bs.drive<=2
    ?(L==="es"?"Aquí estoy. Tu sistema nervioso está en modo bajo hoy — eso es información, no un fallo. ¿Qué necesitas?":"I'm here. Your nervous system is in low mode today — that's information, not failure. What do you need?")
    :bAvg<=2?(L==="es"?"Hola. Tu energía está baja hoy. Estoy aquí sin prisa — sin lista de cosas, sin presión.":"Hey. Your energy is low today. I'm here, no rush, no to-do list pressure.")
    :bs.heart<=2?(L==="es"?"Hola. Noto que tu estado emocional está bajo. Sin juicio. ¿Qué está pasando?":"Hey. I notice your emotional state is low. No judgment. What's going on?")
    :bAvg>=4?(L==="es"?"¡Tu energía está alta hoy! Buen momento para atacar lo que llevas evitando. ¿Qué hacemos?":"Your energy is high today! Great time to tackle what you've been avoiding. What are we doing?")
    :t.agentGreeting;

  // ── Contextual quick-replies based on brain state ──
  const chips=bAvg<=2
    ?(L==="es"?["¿Por dónde empiezo?","Necesito calmarme","Dame un micro-paso","Estoy paralizado/a"]:["Where do I start?","I need to calm down","Give me one micro-step","I'm paralyzed"])
    :bAvg<=3
    ?(L==="es"?["Tengo algo atascado","Ayúdame a organizar","Sin motivación hoy","¿Qué hago primero?"]:["I'm stuck on something","Help me organize","No motivation today","What do I do first?"])
    :(L==="es"?["¿Qué priorizo?","Quiero ser productivo/a","¿Qué atacamos primero?","Dame un plan rápido"]:["What do I prioritize?","I want to be productive","What do we tackle first?","Give me a quick plan"]);

  const zoneDot=(v)=>{const c=["#7B9AB8","#6A9FBF","#5B9E8F","#B8A04E","#C4867A"];return c[Math.min(4,Math.max(0,v-1))];};

  // ── Send ZENO companion ──
  const sendZeno=async(txt)=>{
    if(!txt.trim()||zLoad)return;
    setZInput("");
    const safe=zenoCheckInput(txt.trim(),L||"es");
    if(safe){setZMsgs(m=>[...m,{r:"user",c:txt.trim()},{r:"ai",c:safe}]);return;}
    const nm=[...zMsgs,{r:"user",c:txt.trim()}];setZMsgs(nm);setZLoad(true);
    try{
      const raw=await aiCall({system:zenoSys,messages:nm.map(m=>({role:m.r==="user"?"user":"assistant",content:m.c})),max_tokens:350});
      setZMsgs([...nm,{r:"ai",c:zenoCheckOutput(raw,L||"es")||"..."}]);
    }catch(e){
      const em=e?.message||"";
      const msg=em.includes("401")||em.includes("403")||em.includes("API key")
        ?"⚡ API key inválida — actualiza en Perfil → API Key"
        :em.includes("429")?"⏳ Límite alcanzado, espera 1 min"
        :"⚠️ Error: "+(em.slice(0,60)||"Sin conexión");
      setZMsgs([...nm,{r:"ai",c:msg}]);
    }
    setZLoad(false);
  };

  // ── Send persona (with brain state context injected) ──
  const sendPersona=async(txt)=>{
    const p=PS[sel-1];if(!txt.trim()||pLoad||!p)return;
    setPInput("");
    const safe=zenoCheckInput(txt.trim(),L||"es");
    if(safe){setHist(h=>({...h,[p.id]:[...(h[p.id]||[]),{role:"user",content:txt.trim(),ts:Date.now()},{role:"assistant",content:safe,ts:Date.now()+1}]}));return;}
    const um={role:"user",content:txt.trim(),ts:Date.now()};
    const nx=[...(hist[p.id]||[]),um];
    setHist(h=>({...h,[p.id]:nx}));setPLoad(true);
    try{
      // Enrich persona system with real-time brain state — makes responses genuinely adaptive
      const enriched=memStr+"\n\n"+brainCtx+"\n\nADAPTA SIEMPRE tus respuestas al estado neurológico actual. Si la energía/motivación es baja, reduce carga cognitiva. Si el estado emocional es bajo, prioriza validación sobre consejos. Máximo 3 frases.";
      const raw=await aiCall({system:t.personaSys(p.name,enriched),messages:nx.map(m=>({role:m.role,content:m.content})),max_tokens:600,noCache:true});
      setHist(h=>({...h,[p.id]:[...nx,{role:"assistant",content:zenoCheckOutput(raw||"...",L||"es"),ts:Date.now()}]}));
    }catch(e){
      const errMsg=e?.message||"Error desconocido";
      const friendly=errMsg.includes("API key")||errMsg.includes("401")||errMsg.includes("403")
        ?"⚡ API key inválida — ve a Perfil → API Key"
        :errMsg.includes("429")
        ?"⏳ Demasiadas peticiones, espera 1 minuto"
        :errMsg.includes("fetch")||errMsg.includes("network")||errMsg.includes("Failed")
        ?"📡 Sin conexión a internet"
        :"⚠️ "+errMsg.slice(0,80);
      setHist(h=>({...h,[p.id]:[...nx,{role:"assistant",content:friendly,ts:Date.now()}]}));
    }
    setPLoad(false);
  };

  // ── Derived state ──
  const curP=sel>0?PS[sel-1]:null;
  const curColor=curP?curP.c1:th.gBtn;
  const curMsgs=sel===0?zMsgs:(hist[PS[sel-1]?.id]||[]);
  const curLoad=sel===0?zLoad:pLoad;
  const curInput=sel===0?zInput:pInput;
  const setCurInput=sel===0?setZInput:setPInput;
  const sendCurrent=(txt)=>sel===0?sendZeno(txt):sendPersona(txt);
  const curRef=sel===0?zRef:pRef;
  const showChips=curMsgs.length<=1;

  // ── Tab config ──
  const TABS=[
    {id:"zeno",name:"ZENO",color:th.gBtn,isZeno:true},
    {id:"sol",...t.personaSol,icon:"drive",color:"#3B82F6"},
    {id:"luna",...t.personaLuna,icon:"mind",color:"#6366F1"},
    {id:"flor",...t.personaFlor,icon:"heart",color:"#0D9488"},
  ];

  const handleOpen=()=>{setOpen(true);if(!zMsgs.length)setZMsgs([{r:"ai",c:bGreeting}]);};

  // ── Closed state: animated floating button ──
  if(!open) return(
    <button onClick={handleOpen} aria-label="Abrir ZENO"
      style={{position:"absolute",bottom:144,right:16,zIndex:50,width:56,height:56,borderRadius:"50%",background:`linear-gradient(135deg,${th.gBtn},${th.g2})`,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:`0 6px 24px ${th.gBtn}50,0 2px 8px rgba(0,0,0,.15)`,animation:"fadeIn .5s ease 1s both,agentFloat 4s ease-in-out 1.5s infinite"}}>
      {/* Outer pulse ring */}
      <div style={{position:"absolute",inset:-6,borderRadius:"50%",border:`2px solid ${th.gBtn}`,animation:"agentPulse 2.8s ease-in-out infinite",pointerEvents:"none"}}/>
      {/* Inner glow ring */}
      <div style={{position:"absolute",inset:-2,borderRadius:"50%",background:`radial-gradient(circle,${th.gBtn}20 0%,transparent 70%)`,pointerEvents:"none"}}/>
      <Spirit size={34} animated variant="mini" mood="happy"/>
    </button>
  );

  // ── Open state: panel ──
  return(
    <div style={{position:"absolute",bottom:82,left:10,right:10,zIndex:60,maxHeight:570,borderRadius:26,background:th.card,boxShadow:`0 16px 56px rgba(0,0,0,.2),0 0 0 1px ${th.border}`,display:"flex",flexDirection:"column",overflow:"hidden",animation:"fadeIn .25s cubic-bezier(.25,.46,.45,.94) both"}}>

      {/* ── Header ── */}
      <div style={{padding:"12px 14px 0",flexShrink:0,background:`linear-gradient(160deg,${curColor}10 0%,transparent 100%)`}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <Spirit size={22} animated/>
            <span style={{fontFamily:F.display,fontSize:15,fontWeight:700,color:curColor,letterSpacing:.3,transition:"color .3s"}}>ZENO</span>
            <div style={{width:7,height:7,borderRadius:"50%",background:curColor,animation:"pulse 2s ease-in-out infinite",opacity:.9,transition:"background .3s"}}/>
          </div>
          {/* Brain state dots */}
          <div style={{display:"flex",gap:4,alignItems:"center"}}>
            {[{e:"🧠",v:bs.mind,tt:"Foco"},{e:"⚡",v:bs.drive,tt:"Motor"},{e:"❤️",v:bs.heart,tt:"Ánimo"},{e:"🔋",v:bs.body,tt:"Energía"}].map((z,i)=>(
              <div key={i} title={z.tt+": "+z.v+"/5"} style={{display:"flex",alignItems:"center",gap:2,padding:"3px 5px",borderRadius:6,background:zoneDot(z.v)+"18"}}>
                <span style={{fontSize:9}}>{z.e}</span>
                <span style={{fontSize:9,fontWeight:700,color:zoneDot(z.v),fontFamily:F.mono}}>{z.v}</span>
              </div>
            ))}
            <button onClick={()=>setOpen(false)} style={{marginLeft:4,width:26,height:26,borderRadius:"50%",background:th.cardAlt,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",border:"none",fontSize:12,color:th.text3,fontWeight:700}}>✕</button>
          </div>
        </div>

        {/* ── Persona selector (animated chips) ── */}
        <div style={{display:"flex",gap:5,paddingBottom:10,overflowX:"auto"}}>
          {TABS.map((tab,i)=>{
            const ac=sel===i;const col=tab.color||th.gBtn;
            return(
              <button key={tab.id} onClick={()=>setSel(i)}
                style={{display:"flex",alignItems:"center",gap:5,padding:"7px 11px",borderRadius:22,border:`1.5px solid ${ac?col+"70":th.borderLight}`,background:ac?col+"18":th.cardAlt,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,transition:"all .22s ease",boxShadow:ac?`0 2px 12px ${col}25`:"none",animation:`chipSlide .3s ease ${i*.06}s both`}}>
                {tab.isZeno
                  ?<Spirit size={13} animated variant="mini"/>
                  :<Ic name={tab.icon} size={13} color={ac?col:th.text3} sw={ac?1.8:1.2}/>}
                <span style={{fontSize:11,fontWeight:ac?700:400,color:ac?col:th.text3,fontFamily:F.display,transition:"color .2s"}}>{tab.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Gradient divider ── */}
      <div style={{height:1,background:`linear-gradient(90deg,${curColor}40,${th.borderLight} 60%,transparent)`,flexShrink:0,transition:"background .3s"}}/>

      {/* ── Messages ── */}
      <div style={{flex:1,overflowY:"auto",padding:"10px 14px",display:"flex",flexDirection:"column",gap:9,maxHeight:290}}>
        {sel===0&&zMsgs.map((m,i)=>{const isU=m.r==="user";return(
          <div key={i} style={{display:"flex",justifyContent:isU?"flex-end":"flex-start",animation:"msgIn .3s ease both"}}>
            {!isU&&<div style={{maxWidth:"85%",padding:"10px 14px",borderRadius:"18px 18px 18px 4px",background:th.cardAlt,border:`1px solid ${th.borderLight}`,position:"relative"}}>
              <div style={{position:"absolute",top:-7,left:12,fontSize:8,color:th.g,fontWeight:700,letterSpacing:2,textTransform:"uppercase",fontFamily:F.mono,background:th.card,padding:"0 4px"}}>ZENO</div>
              <p style={{fontSize:13.5,color:th.text,lineHeight:1.7,margin:0,fontFamily:F.display,fontStyle:"italic",marginTop:4}}>{m.c}</p>
            </div>}
            {isU&&<div style={{maxWidth:"80%",padding:"10px 14px",borderRadius:"18px 18px 4px 18px",background:th.gSoft,border:`1px solid ${th.gBorder}`}}>
              <p style={{fontSize:13.5,color:th.text,lineHeight:1.7,margin:0,fontFamily:F.body}}>{m.c}</p>
            </div>}
          </div>
        );})}
        {sel>0&&(()=>{const p=PS[sel-1];const msgs=hist[p.id]||[];return msgs.map((m,i)=>{const isU=m.role==="user";return(
          <div key={i} style={{display:"flex",flexDirection:isU?"row-reverse":"row",alignItems:"flex-end",gap:7,animation:"msgIn .3s ease both"}}>
            {!isU&&<div style={{width:30,height:30,borderRadius:"50%",flexShrink:0,background:p.c1+"22",display:"flex",alignItems:"center",justifyContent:"center",border:`1.5px solid ${p.c1}35`,boxShadow:`0 2px 8px ${p.c1}20`}}><Ic name={p.icon} size={14} color={p.c1} sw={1.6}/></div>}
            <div style={{maxWidth:"80%",padding:"10px 14px",borderRadius:isU?"18px 18px 4px 18px":"18px 18px 18px 4px",background:isU?p.c1+"14":th.cardAlt,border:`1px solid ${isU?p.c1+"35":th.borderLight}`,boxShadow:isU?`0 2px 10px ${p.c1}15`:"none"}}>
              <p style={{fontSize:13.5,color:th.text,lineHeight:1.7,fontFamily:F.display,fontWeight:isU?400:300,fontStyle:isU?"normal":"italic",margin:0}}>{m.content}</p>
              <div style={{fontSize:9,color:th.text3,marginTop:4,textAlign:isU?"right":"left",letterSpacing:.3}}>{new Date(m.ts||Date.now()).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>
            </div>
          </div>
        );});})()}
        {curLoad&&(
          <div style={{display:"flex",alignItems:"flex-end",gap:7}}>
            {curP&&<div style={{width:30,height:30,borderRadius:"50%",background:curColor+"22",display:"flex",alignItems:"center",justifyContent:"center",border:`1.5px solid ${curColor}35`}}><Ic name={curP.icon} size={14} color={curColor} sw={1.6}/></div>}
            <div style={{padding:"13px 16px",borderRadius:"18px 18px 18px 4px",background:th.cardAlt,border:`1px solid ${th.borderLight}`,display:"flex",gap:6,alignItems:"center"}}>
              {[0,1,2].map(j=><div key={j} style={{width:7,height:7,borderRadius:"50%",background:curColor,animation:`dotB 1.4s ease-in-out infinite`,animationDelay:`${j*.18}s`}}/>)}
            </div>
          </div>
        )}
        <div ref={curRef}/>
      </div>

      {/* ── Quick-reply chips (shown when conversation is fresh) ── */}
      {showChips&&(
        <div style={{padding:"5px 12px 6px",display:"flex",gap:6,overflowX:"auto",flexShrink:0,borderTop:`1px solid ${th.borderLight}`}}>
          {chips.map((chip,i)=>(
            <button key={i} onClick={()=>sendCurrent(chip)}
              style={{padding:"6px 13px",borderRadius:100,border:`1.5px solid ${curColor}45`,background:curColor+"12",cursor:"pointer",whiteSpace:"nowrap",fontSize:11.5,color:curColor,fontFamily:F.body,flexShrink:0,transition:"all .2s ease",animation:`chipSlide .35s ease ${i*.07}s both`}}>
              {chip}
            </button>
          ))}
        </div>
      )}

      {/* ── Input bar ── */}
      <div style={{padding:"8px 12px 10px",borderTop:`1px solid ${th.borderLight}`,display:"flex",gap:8,alignItems:"flex-end",flexShrink:0,background:th.card}}>
        <textarea value={curInput} ref={inputRef} rows={1}
          onChange={e=>{setCurInput(e.target.value);e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,84)+"px";}}
          onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendCurrent(curInput);}}}
          placeholder={sel===0?(L==="es"?"Pregunta o cuéntame algo...":"Ask or tell me something..."):(t.talkTo?t.talkTo(TABS[sel]?.name||""):`Habla con ${TABS[sel]?.name}...`)}
          style={{flex:1,padding:"10px 14px",borderRadius:18,background:th.cardAlt,border:`1.5px solid ${curInput.trim()?curColor+"55":th.borderLight}`,fontSize:13.5,color:th.text,fontFamily:F.body,outline:"none",resize:"none",maxHeight:84,lineHeight:1.55,transition:"border-color .2s,box-shadow .2s",boxShadow:curInput.trim()?`0 0 0 3px ${curColor}12`:"none"}}/>
        <button onClick={()=>startVoice(sel===0?setZInput:setPInput)} style={{padding:"8px",borderRadius:"50%",background:voiceActive?th.g:th.card,border:`1px solid ${voiceActive?th.gBorder:th.border}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",minWidth:40,minHeight:40,flexShrink:0,transition:"all .3s",animation:voiceActive?"agentPulse .8s ease-in-out infinite":"none"}}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={voiceActive?"#fff":th.text2} strokeWidth="2" strokeLinecap="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0014 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>
        </button>
        <button onClick={()=>sendCurrent(curInput)} disabled={!curInput.trim()||curLoad}
          style={{width:40,height:40,borderRadius:"50%",background:curInput.trim()&&!curLoad?`linear-gradient(135deg,${curColor},${curColor}CC)`:th.cardAlt,display:"flex",alignItems:"center",justifyContent:"center",cursor:curInput.trim()&&!curLoad?"pointer":"default",border:"none",flexShrink:0,boxShadow:curInput.trim()&&!curLoad?`0 4px 14px ${curColor}45`:"none",transition:"all .22s ease"}}>
          <Ic name="send" size={15} color={curInput.trim()&&!curLoad?"#fff":th.text3} sw={1.7}/>
        </button>
      </div>
    </div>
  );
}

function PanicButton(){
  const{t,th,lang}=useCtx();
  const[open,setOpen]=useState(false);
  const[phase,setPhase]=useState(0); // 0=breathe 1=ground 2=action
  const[aiTask,setAiTask]=useState("");const[aiLoad,setAiLoad]=useState(false);

  const breathePhases=[
    {label:lang==="es"?"Inhala":"Inhale",dur:4,color:"#7BBFB0"},
    {label:lang==="es"?"Sostén":"Hold",dur:4,color:"#8BB8D4"},
    {label:lang==="es"?"Exhala":"Exhale",dur:6,color:"#B5ABDB"},
  ];
  const[bIdx,setBIdx]=useState(0);
  useEffect(()=>{
    if(!open||phase!==0)return;
    const id=setTimeout(()=>setBIdx(i=>(i+1)%3),breathePhases[bIdx].dur*1000);
    return()=>clearTimeout(id);
  },[open,phase,bIdx]);

  const getAITask=async()=>{
    setAiLoad(true);
    const promptES=(
      "Eres ZENO. El usuario está en un momento de bloqueo fuerte, ansiedad o saturación.\n\n"
      +"TAREA: Ayudar a bajar la intensidad y regular el sistema nervioso. NADA de productividad ni tareas.\n\n"
      +"REGLAS:\n"
      +"1. Frase 1: validación emocional. Empieza con 'Tiene sentido que...' o similar. 1 frase cálida.\n"
      +"2. Frase 2: UNA acción muy simple, física o sensorial, menos de 2 minutos. Verbo físico al inicio.\n"
      +"3. Frase 3 (SOLO si el usuario mencionó autolesión, suicidio o peligro físico): indica que no puedes manejar crisis graves y recomienda contactar servicios de emergencia o una línea de ayuda.\n"
      +"4. NO hables de tareas, productividad ni el futuro.\n"
      +"5. PROHIBIDO: deberías, tienes que, es fácil, simplemente.\n\n"
      +"Responde en texto plano. Máximo 3 frases."
    );
    const promptEN=(
      "You are ZENO. The user is in a moment of strong blockage, anxiety or overwhelm.\n\n"
      +"TASK: Help lower intensity and regulate the nervous system. NOTHING about productivity or tasks.\n\n"
      +"RULES:\n"
      +"1. Sentence 1: emotional validation. Start with 'That makes complete sense...' or similar. 1 warm sentence.\n"
      +"2. Sentence 2: ONE very simple action, physical or sensory, under 2 minutes. Physical verb first.\n"
      +"3. Sentence 3 (ONLY if user mentioned self-harm, suicide or physical danger): say you cannot handle serious crises and recommend contacting emergency services or a helpline.\n"
      +"4. Do NOT talk about tasks, productivity or the future.\n"
      +"5. FORBIDDEN: you should, you need to, it's easy, simply.\n\n"
      +"Respond in plain text. Maximum 3 sentences."
    );
    try{
      const _rawPanic=await aiCall({max_tokens:160,messages:[{role:"user",content:lang==="es"?promptES:promptEN}]});
      setAiTask(zenoCheckOutput(_rawPanic.trim()||t.panicTasks[0],lang));
    }catch{setAiTask(t.panicTasks[Math.floor(Math.random()*t.panicTasks.length)]);}
    setAiLoad(false);setPhase(2);
  };

  const handleOpen=()=>{haptic('medium');setBIdx(0);setPhase(0);setAiTask("");setOpen(true);};
  const bp=breathePhases[bIdx];

  if(open) return(
    <div style={{position:"absolute",inset:0,zIndex:150,background:th.bg+"F8",backdropFilter:"blur(24px)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"0 32px",animation:"fadeIn .3s ease both"}}>
      {phase===0&&<>
        <div style={{marginBottom:20}}>
          <div style={{width:120,height:120,borderRadius:"50%",background:`radial-gradient(circle,${bp.color}40,${bp.color}15)`,display:"flex",alignItems:"center",justifyContent:"center",transition:`all ${bp.dur}s ease`,animation:"haloBreath 1s ease-in-out infinite"}}>
            <Spirit size={64} animated variant="seal" mood="calm" showAura/>
          </div>
        </div>
        <div style={{fontFamily:F.display,fontSize:28,fontWeight:300,color:bp.color,textAlign:"center",transition:"color 1s ease",marginBottom:4}}>{bp.label}</div>
        <div style={{fontFamily:F.mono,fontSize:14,color:th.text3,marginBottom:32}}>{bp.dur}s</div>
        <button onClick={()=>getAITask()} style={{padding:"14px 32px",borderRadius:100,background:"transparent",border:`1px solid ${th.border}`,cursor:"pointer",fontFamily:F.body,fontSize:13,color:th.text2,minHeight:48}}>{lang==="es"?"Ya respiré, ayúdame":"I breathed, help me"}</button>
      </>}

      {phase===2&&<>
        <Spirit size={72} animated variant="seal" mood="calm" showAura/>
        <div style={{fontFamily:F.display,fontSize:18,fontWeight:500,color:th.text,textAlign:"center",marginTop:16,marginBottom:20,lineHeight:1.4}}>{t.panicTitle}</div>
        <div style={{background:th.card,borderRadius:RR.lg,padding:"24px 22px",boxShadow:th.shadowLg,width:"100%",maxWidth:300,textAlign:"center",marginBottom:24,minHeight:80,display:"flex",alignItems:"center",justifyContent:"center"}}>
          {aiLoad?<div style={{display:"flex",gap:5}}>{[0,1,2].map(j=><div key={j} style={{width:7,height:7,borderRadius:"50%",background:th.gBtn,opacity:.4,animation:`dotB 1.4s ease-in-out infinite`,animationDelay:`${j*.18}s`}}/>)}</div>
          :<p style={{fontFamily:F.display,fontSize:16,color:th.text,lineHeight:1.7,margin:0,fontStyle:"italic"}}>{aiTask}</p>}
        </div>
      </>}

      <button onClick={()=>setOpen(false)} style={{padding:"14px 36px",borderRadius:100,background:th.gBtn,border:"none",cursor:"pointer",fontFamily:F.body,fontSize:14,fontWeight:600,color:th.btnText,boxShadow:"0 2px 8px rgba(0,0,0,.15)",minHeight:48,transition:"all .3s ease"}}>
        {t.panicClose}
      </button>
    </div>
  );
  return(
    <button onClick={handleOpen} aria-label="SOS" style={{position:"absolute",bottom:90,left:16,zIndex:50,width:48,height:48,borderRadius:"50%",background:"#E85D4A",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 16px rgba(232,93,74,.35)",transition:"all .3s ease",animation:"fadeIn .5s ease .8s both"}} onMouseEnter={e=>{e.currentTarget.style.transform="scale(1.1)";}} onMouseLeave={e=>{e.currentTarget.style.transform="";}}>
      <span style={{fontSize:11,fontWeight:700,color:"#fff",letterSpacing:1,fontFamily:F.body}}>{t.panicBtn}</span>
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ROOT
// ══════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════
// BIOMETRIC AUTH — Face ID / Touch ID
// Bridge: works in web/artifact (simulated) AND in Capacitor native (real).
// When you add Capacitor, set window.__ZENO_BIOMETRIC__ with real methods.
// npm install @capacitor-community/biometric-auth  (native only)
// ══════════════════════════════════════════════════════════════════════════
const BIOMETRIC_KEY = "zeno-biometric-enabled";

// Safe bridge — never throws, works everywhere
async function biometricAvailable(){
  // Capacitor native bridge (set by capacitor plugin at runtime)
  if(window.__ZENO_BIOMETRIC__?.checkAvailable){
    try{ return await window.__ZENO_BIOMETRIC__.checkAvailable(); }catch{ return false; }
  }
  // WebAuthn check (works in Safari on real devices)
  if(window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable){
    try{ return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
    catch{ return false; }
  }
  // Artifact / browser — simulate as available for demo
  return true;
}

async function biometricAuthenticate(reason){
  // Capacitor native bridge
  if(window.__ZENO_BIOMETRIC__?.authenticate){
    try{
      await window.__ZENO_BIOMETRIC__.authenticate({reason});
      return {success:true};
    }catch(e){ return {success:false, error:e.message}; }
  }
  // Web demo — simulate 1.2s scan then success
  return new Promise(res=>setTimeout(()=>res({success:true}),1200));
}

function BiometricLockScreen({onUnlock, lang, th, userName, profilePhoto}){
  const[state,setState]=useState("idle"); // idle|scanning|success|failed
  const[attempts,setAttempts]=useState(0);
  const[showPin,setShowPin]=useState(false);
  const[pin,setPin]=useState("");
  const[pinError,setPinError]=useState(false);
  const[settingNewPin,setSettingNewPin]=useState(!getStoredPin());
  const[newPinStep,setNewPinStep]=useState("enter"); // enter|confirm
  const[newPinFirst,setNewPinFirst]=useState("");

  useEffect(()=>{
    // Auto-trigger biometric on mount after short delay
    const t=setTimeout(()=>triggerBiometric(),600);
    return()=>clearTimeout(t);
  },[]);

  const triggerBiometric=async()=>{
    setState("scanning");
    const res=await biometricAuthenticate(
      lang==="es"?"Verifica tu identidad para entrar a ZENO":"Verify your identity to open ZENO"
    );
    if(res.success){
      setState("success");
      haptic("success");
      setTimeout(()=>onUnlock(),500);
    }else{
      setState("failed");
      haptic("error");
      setAttempts(a=>a+1);
      setTimeout(()=>setState("idle"),1500);
    }
  };

  const submitPin=()=>{
    if(verifyPin(pin)){
      setState("success");
      haptic("success");
      setTimeout(()=>onUnlock(),400);
    }else{
      setPinError(true);
      haptic("error");
      setTimeout(()=>{setPinError(false);setPin("");},800);
    }
  };
  const handleNewPin=(digit)=>{
    if(digit==="⌫"){
      if(newPinStep==="enter")setNewPinFirst(p=>p.slice(0,-1));
      else setPin(p=>p.slice(0,-1));
      return;
    }
    if(newPinStep==="enter"){
      const np=newPinFirst+digit;
      setNewPinFirst(np);
      if(np.length===4){setNewPinStep("confirm");setPin("");}
    } else {
      const np=pin+digit;
      setPin(np);
      if(np.length===4){
        if(np===newPinFirst){
          storePin(np);
          setSettingNewPin(false);
          setNewPinStep("enter");setNewPinFirst("");setPin("");
        } else {
          setPinError(true);
          haptic("error");
          setTimeout(()=>{setPinError(false);setPin("");setNewPinFirst("");setNewPinStep("enter");},900);
        }
      }
    }
  };

  const faceIdIcon=(
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke={state==="success"?"#22C55E":state==="failed"?"#EF4444":th.g} strokeWidth="2" strokeLinecap="round">
      {/* Face outline */}
      <path d="M20 8 C10 8 8 18 8 24 L8 28" opacity={state==="scanning"?"1":".6"} style={{animation:state==="scanning"?"pulse 1s ease-in-out infinite":"none"}}/>
      <path d="M44 8 C54 8 56 18 56 24 L56 28" opacity={state==="scanning"?"1":".6"} style={{animation:state==="scanning"?"pulse 1s ease-in-out infinite .2s":"none"}}/>
      <path d="M8 40 L8 44 C8 50 10 56 20 56" opacity={state==="scanning"?"1":".6"} style={{animation:state==="scanning"?"pulse 1s ease-in-out infinite .4s":"none"}}/>
      <path d="M56 40 L56 44 C56 50 54 56 44 56" opacity={state==="scanning"?"1":".6"} style={{animation:state==="scanning"?"pulse 1s ease-in-out infinite .6s":"none"}}/>
      {/* Eyes */}
      <circle cx="23" cy="28" r="3" fill={th.g} opacity={state==="scanning"?"1":".7"}/>
      <circle cx="41" cy="28" r="3" fill={th.g} opacity={state==="scanning"?"1":".7"}/>
      {/* Nose */}
      <path d="M32 30 L30 38 L34 38" opacity=".5"/>
      {/* Smile / state indicator */}
      {state==="success"
        ?<path d="M24 44 Q32 50 40 44" stroke="#22C55E" strokeWidth="2.5"/>
        :state==="failed"
        ?<path d="M24 46 Q32 42 40 46" stroke="#EF4444" strokeWidth="2.5"/>
        :<path d="M24 44 Q32 48 40 44" opacity=".5"/>
      }
      {/* Scan line animation */}
      {state==="scanning"&&<line x1="8" y1="32" x2="56" y2="32" stroke={th.g} strokeWidth="1.5" opacity=".6" style={{animation:"scanLine 1.2s ease-in-out infinite"}}/>}
    </svg>
  );

  return(
    <div style={{position:"absolute",inset:0,zIndex:500,
      background:th.bg,
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      padding:"0 32px",animation:"fadeIn .3s ease both"}}>

      {/* Ambient glow */}
      <div style={{position:"absolute",top:"20%",left:"50%",transform:"translateX(-50%)",
        width:300,height:300,borderRadius:"50%",
        background:`radial-gradient(circle,${state==="success"?"#22C55E":state==="failed"?"#EF4444":th.g}15 0%,transparent 70%)`,
        pointerEvents:"none",transition:"background .4s ease"}}/>

      {/* Avatar */}
      <div style={{position:"relative",marginBottom:28}}>
        <div style={{width:80,height:80,borderRadius:"50%",overflow:"hidden",
          border:`3px solid ${state==="success"?"#22C55E":state==="failed"?"#EF4444":th.g}`,
          transition:"border-color .3s ease",boxShadow:`0 0 24px ${th.g}40`}}>
          {profilePhoto
            ?<img src={profilePhoto} style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/>
            :<div style={{width:"100%",height:"100%",background:th.gSoft,display:"flex",alignItems:"center",justifyContent:"center",fontSize:32}}>
              {userName?userName[0].toUpperCase():"Z"}
            </div>
          }
        </div>
      </div>

      {/* Name */}
      <div style={{fontFamily:F.display,fontSize:22,fontWeight:600,color:th.text,marginBottom:6}}>
        {lang==="es"?`Hola, ${userName||"de nuevo"}`:  `Hey, ${userName||"welcome back"}`}
      </div>
      <div style={{fontSize:13,color:th.text2,marginBottom:40,fontFamily:F.body}}>
        {lang==="es"?"Verifica tu identidad":"Verify your identity"}
      </div>

      {!showPin ? <>
        {/* Face ID button */}
        <button onClick={triggerBiometric} disabled={state==="scanning"||state==="success"}
          style={{width:100,height:100,borderRadius:"50%",
            background:state==="success"?"#22C55E18":state==="failed"?"#EF444418":th.gSoft,
            border:`2px solid ${state==="success"?"#22C55E":state==="failed"?"#EF4444":th.gBorder}`,
            cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
            transition:"all .3s ease",boxShadow:`0 4px 24px ${th.g}25`,
            animation:state==="scanning"?"pulse 1.2s ease-in-out infinite":"none"}}>
          {faceIdIcon}
        </button>

        {/* Status text */}
        <div style={{marginTop:20,fontSize:13,fontFamily:F.body,textAlign:"center",
          color:state==="success"?"#22C55E":state==="failed"?"#EF4444":th.text2,
          minHeight:20,transition:"color .3s"}}>
          {state==="scanning"?(lang==="es"?"Escaneando...":"Scanning...")
           :state==="success"?(lang==="es"?"¡Verificado!":"Verified!")
           :state==="failed"?(lang==="es"?"No reconocido, intenta de nuevo":"Not recognized, try again")
           :(lang==="es"?"Toca para usar Face ID / Touch ID":"Tap to use Face ID / Touch ID")}
        </div>

        {/* Fallback to PIN after 2 failed attempts */}
        {attempts>=2&&<button onClick={()=>setShowPin(true)}
          style={{marginTop:24,background:"none",border:"none",cursor:"pointer",
            fontSize:13,color:th.g,fontFamily:F.body,textDecoration:"underline"}}>
          {lang==="es"?"Usar PIN":"Use PIN"}
        </button>}

      </> : <>
        {/* PIN entry — set new PIN if first time, otherwise verify */}
        {settingNewPin ? (<>
          <div style={{marginBottom:8,fontSize:14,fontWeight:600,color:th.text,fontFamily:F.body,textAlign:"center"}}>
            {newPinStep==="enter"
              ?(lang==="es"?"Elige tu PIN de 4 dígitos":"Choose your 4-digit PIN")
              :(lang==="es"?"Confirma tu PIN":"Confirm your PIN")}
          </div>
          <div style={{fontSize:11,color:th.text3,fontFamily:F.display,fontStyle:"italic",marginBottom:20,textAlign:"center"}}>
            {newPinStep==="enter"?(lang==="es"?"Lo usarás como respaldo de Face ID":"You'll use this as Face ID backup"):(lang==="es"?"Repite el mismo PIN":"Repeat the same PIN")}
          </div>
          <div style={{display:"flex",gap:12,marginBottom:24}}>
            {[0,1,2,3].map(i=>{const val=newPinStep==="enter"?newPinFirst:pin;return(
              <div key={i} style={{width:14,height:14,borderRadius:"50%",background:val.length>i?(pinError?"#EF4444":th.gBtn):th.border,transition:"all .2s ease"}}/>
            );})}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,width:220}}>
            {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((k,i)=>(
              <button key={i} onClick={()=>{if(k===""||((newPinStep==="enter"?newPinFirst:pin).length>=4&&k!=="⌫"))return;haptic("soft");handleNewPin(String(k));}}
                style={{height:60,borderRadius:16,background:k===""?"transparent":th.cardAlt,border:k===""?"none":`1px solid ${th.border}`,cursor:k===""?"default":"pointer",fontFamily:F.mono,fontSize:22,fontWeight:600,color:pinError?"#EF4444":th.text,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s ease"}}>
                {k}
              </button>
            ))}
          </div>
        </>) : (<>
          <div style={{marginBottom:16,fontSize:14,color:th.text2,fontFamily:F.body}}>
            {lang==="es"?"Introduce tu PIN":"Enter your PIN"}
          </div>
          <div style={{display:"flex",gap:12,marginBottom:24}}>
            {[0,1,2,3].map(i=>(
              <div key={i} style={{width:14,height:14,borderRadius:"50%",background:pin.length>i?(pinError?"#EF4444":th.gBtn):th.border,transition:"all .2s ease"}}/>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,width:220}}>
            {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((k,i)=>(
              <button key={i} onClick={()=>{
                if(k==="⌫"){setPin(p=>p.slice(0,-1));return;}
                if(k===""||pin.length>=4) return;
                haptic("soft");
                const np=pin+String(k);setPin(np);
                if(np.length===4)setTimeout(()=>{setPin("");submitPin.call({pin:np});},100);
              }}
              style={{height:60,borderRadius:16,background:k===""?"transparent":th.cardAlt,border:k===""?"none":`1px solid ${th.border}`,cursor:k===""?"default":"pointer",fontFamily:F.mono,fontSize:22,fontWeight:600,color:pinError?"#EF4444":th.text,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s ease"}}>
                {k}
              </button>
            ))}
          </div>
          <button onClick={()=>setShowPin(false)} style={{marginTop:20,background:"none",border:"none",cursor:"pointer",fontSize:13,color:th.text3,fontFamily:F.body}}>
            ← {lang==="es"?"Volver a Face ID":"Back to Face ID"}
          </button>
        </>)}
      </>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS SYSTEM
// In production with Capacitor, install:
//   npm install @capacitor/push-notifications @capacitor/local-notifications
// and replace the bridge calls below with real plugin calls.
// ══════════════════════════════════════════════════════════════════════════
const NOTIF_KEY = "zeno-notif-settings";

const DEFAULT_NOTIF_SETTINGS = {
  enabled: false,
  checkinReminder: true,
  checkinHour: 9,
  streakAlert: true,
  taskNudge: false,
  taskNudgeHour: 17,
  lowEnergyTip: true,
};

// Safe notification bridge — no dynamic imports, never throws
// In Capacitor: set window.__ZENO_NOTIF__ with real plugin methods
async function requestNotifPermission(){
  if(window.__ZENO_NOTIF__?.requestPermission){
    try{ return await window.__ZENO_NOTIF__.requestPermission(); }catch{ return false; }
  }
  if("Notification" in window){
    try{
      const r = await Notification.requestPermission();
      return r==="granted";
    }catch{ return false; }
  }
  return true; // artifact demo — simulate granted
}

async function scheduleLocalNotif({id, title, body, hour, minute=0, repeats=true}){
  if(window.__ZENO_NOTIF__?.schedule){
    try{ await window.__ZENO_NOTIF__.schedule({id,title,body,hour,minute,repeats}); return true; }
    catch{ return false; }
  }
  // Web Notifications API demo — show an immediate preview notification
  try{
    if("Notification" in window && Notification.permission==="granted"){
      new Notification("🔔 ZENO — "+title,{body,icon:"/favicon.ico"});
    }
  }catch{}
  return true;
}

async function cancelNotif(id){
  if(window.__ZENO_NOTIF__?.cancel){
    try{ await window.__ZENO_NOTIF__.cancel({id}); }catch{}
  }
}

function NotifSettingsPanel({lang, th}){
  const[settings,setSettings]=useState(()=>{
    try{ const s=localStorage.getItem(NOTIF_KEY); return s?{...DEFAULT_NOTIF_SETTINGS,...JSON.parse(s)}:DEFAULT_NOTIF_SETTINGS; }
    catch{ return DEFAULT_NOTIF_SETTINGS; }
  });
  const[permState,setPermState]=useState("unknown"); // unknown|granted|denied|requesting
  const Card=useCard();

  useEffect(()=>{
    if("Notification" in window) setPermState(Notification.permission==="granted"?"granted":Notification.permission==="denied"?"denied":"unknown");
  },[]);

  const save=async(newS)=>{
    setSettings(newS);
    try{ localStorage.setItem(NOTIF_KEY,JSON.stringify(newS)); }catch{}

    if(newS.enabled){
      if(permState!=="granted"){
        setPermState("requesting");
        const ok=await requestNotifPermission();
        setPermState(ok?"granted":"denied");
        if(!ok){ setSettings(s=>({...s,enabled:false})); return; }
      }
      // Schedule active notifications
      if(newS.checkinReminder){
        await scheduleLocalNotif({
          id:1001,
          title:lang==="es"?"⚡ Hora de tu check-in":"⚡ Time for your check-in",
          body:lang==="es"?"¿Cómo está tu energía hoy? 30 segundos es suficiente.":"How's your energy today? 30 seconds is enough.",
          hour:newS.checkinHour,
        });
      }else{ await cancelNotif(1001); }

      if(newS.taskNudge){
        await scheduleLocalNotif({
          id:1002,
          title:lang==="es"?"🎯 Un pequeño paso":"🎯 One small step",
          body:lang==="es"?"Tu cerebro ya está listo para empezar. ¿Qué es lo más pequeño que puedes hacer?":"Your brain is ready to start. What's the smallest thing you can do?",
          hour:newS.taskNudgeHour,
        });
      }else{ await cancelNotif(1002); }
    }else{
      await cancelNotif(1001);
      await cancelNotif(1002);
    }
  };

  const toggle=(key)=>save({...settings,[key]:!settings[key]});
  const fmt12=h=>`${h%12||12}${h<12?"am":"pm"}`;

  return(
    <div style={{...Card({borderRadius:RR.lg,padding:"18px 20px"}),animation:"fadeIn .5s ease .06s both"}}>
      <div style={{fontSize:10,color:th.text3,letterSpacing:3,textTransform:"uppercase",marginBottom:14,display:"flex",alignItems:"center",gap:6}}>
        <Ic name="bell" size={13} color={th.text3} sw={1.3}/>
        {lang==="es"?"Notificaciones":"Notifications"}
      </div>

      {/* Master toggle */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,paddingBottom:14,borderBottom:"1px solid "+th.border}}>
        <div>
          <div style={{fontSize:14,fontWeight:600,color:th.text,marginBottom:2}}>{lang==="es"?"Activar notificaciones":"Enable notifications"}</div>
          <div style={{fontSize:11,color:th.text3}}>
            {permState==="denied"
              ?(lang==="es"?"Bloqueadas en ajustes del sistema":"Blocked in system settings")
              :(lang==="es"?"Avisos personalizados para tu cerebro":"Personalized alerts for your brain")}
          </div>
        </div>
        <button onClick={()=>toggle("enabled")} disabled={permState==="denied"}
          style={{width:48,height:28,borderRadius:100,border:"none",cursor:permState==="denied"?"not-allowed":"pointer",
            background:settings.enabled?th.gBtn:"#D1D5DB",transition:"all .3s ease",
            position:"relative",flexShrink:0,opacity:permState==="denied"?.5:1}}>
          <div style={{width:22,height:22,borderRadius:"50%",background:"#fff",position:"absolute",
            top:3,left:settings.enabled?23:3,transition:"left .3s ease",boxShadow:"0 1px 4px rgba(0,0,0,.25)"}}/>
        </button>
      </div>

      {settings.enabled&&<>
        {/* Check-in reminder */}
        <div style={{marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
            <div>
              <div style={{fontSize:13,fontWeight:600,color:th.text}}>⚡ {lang==="es"?"Recordatorio de check-in":"Check-in reminder"}</div>
              <div style={{fontSize:11,color:th.text3}}>{lang==="es"?"Para registrar tu energía del día":"To log your daily energy"}</div>
            </div>
            <button onClick={()=>toggle("checkinReminder")}
              style={{width:42,height:24,borderRadius:100,border:"none",cursor:"pointer",
                background:settings.checkinReminder?th.gBtn:"#D1D5DB",transition:"all .3s",position:"relative",flexShrink:0}}>
              <div style={{width:18,height:18,borderRadius:"50%",background:"#fff",position:"absolute",
                top:3,left:settings.checkinReminder?21:3,transition:"left .3s",boxShadow:"0 1px 3px rgba(0,0,0,.2)"}}/>
            </button>
          </div>
          {settings.checkinReminder&&(
            <div style={{display:"flex",flexWrap:"wrap",gap:6,paddingLeft:4}}>
              {[7,8,9,10,12,15,18,20].map(h=>(
                <button key={h} onClick={()=>save({...settings,checkinHour:h})}
                  style={{padding:"4px 10px",borderRadius:100,
                    background:settings.checkinHour===h?th.gSoft:th.cardAlt,
                    border:`1px solid ${settings.checkinHour===h?th.gBorder:th.borderLight}`,
                    cursor:"pointer",fontFamily:F.mono,fontSize:11,
                    color:settings.checkinHour===h?th.gBtn:th.text2}}>
                  {fmt12(h)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Streak alert */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
          <div>
            <div style={{fontSize:13,fontWeight:600,color:th.text}}>🔥 {lang==="es"?"Alerta de racha":"Streak alert"}</div>
            <div style={{fontSize:11,color:th.text3}}>{lang==="es"?"Cuando tu racha está en riesgo":"When your streak is at risk"}</div>
          </div>
          <button onClick={()=>toggle("streakAlert")}
            style={{width:42,height:24,borderRadius:100,border:"none",cursor:"pointer",
              background:settings.streakAlert?th.gBtn:"#D1D5DB",transition:"all .3s",position:"relative",flexShrink:0}}>
            <div style={{width:18,height:18,borderRadius:"50%",background:"#fff",position:"absolute",
              top:3,left:settings.streakAlert?21:3,transition:"left .3s",boxShadow:"0 1px 3px rgba(0,0,0,.2)"}}/>
          </button>
        </div>

        {/* Task nudge */}
        <div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
            <div>
              <div style={{fontSize:13,fontWeight:600,color:th.text}}>🎯 {lang==="es"?"Empujón de tarea":"Task nudge"}</div>
              <div style={{fontSize:11,color:th.text3}}>{lang==="es"?"Un micro-paso cuando más lo necesitas":"A micro-step when you need it most"}</div>
            </div>
            <button onClick={()=>toggle("taskNudge")}
              style={{width:42,height:24,borderRadius:100,border:"none",cursor:"pointer",
                background:settings.taskNudge?th.gBtn:"#D1D5DB",transition:"all .3s",position:"relative",flexShrink:0}}>
              <div style={{width:18,height:18,borderRadius:"50%",background:"#fff",position:"absolute",
                top:3,left:settings.taskNudge?21:3,transition:"left .3s",boxShadow:"0 1px 3px rgba(0,0,0,.2)"}}/>
            </button>
          </div>
          {settings.taskNudge&&(
            <div style={{display:"flex",flexWrap:"wrap",gap:6,paddingLeft:4}}>
              {[12,14,15,16,17,18,19,20].map(h=>(
                <button key={h} onClick={()=>save({...settings,taskNudgeHour:h})}
                  style={{padding:"4px 10px",borderRadius:100,
                    background:settings.taskNudgeHour===h?th.gSoft:th.cardAlt,
                    border:`1px solid ${settings.taskNudgeHour===h?th.gBorder:th.borderLight}`,
                    cursor:"pointer",fontFamily:F.mono,fontSize:11,
                    color:settings.taskNudgeHour===h?th.gBtn:th.text2}}>
                  {fmt12(h)}
                </button>
              ))}
            </div>
          )}
        </div>
      </>}
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════
// ERROR BOUNDARY — prevents full crash on component errors
// ══════════════════════════════════════════════════════════════════════════
class ErrorBoundary extends React.Component {
  constructor(props){super(props);this.state={hasError:false,error:null};}
  static getDerivedStateFromError(error){return{hasError:true,error};}
  componentDidCatch(error,info){console.error("[ZENO] Unhandled error:",error,info);}
  render(){
    if(this.state.hasError){
      const th=TH(false,"sage");
      return(
        <div style={{minHeight:"100svh",display:"flex",alignItems:"center",justifyContent:"center",background:th.bg,padding:24}}>
          <div style={{maxWidth:320,textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center",gap:16}}>
            <div style={{fontSize:48}}>🌱</div>
            <div style={{fontFamily:F.display,fontSize:20,fontWeight:600,color:th.text}}>Algo salió mal</div>
            <p style={{fontFamily:F.display,fontSize:13,color:th.text2,lineHeight:1.6,fontStyle:"italic"}}>
              Tu cerebro TDAH no tiene la culpa — fue un error técnico. Tus datos están seguros.
            </p>
            <button onClick={()=>window.location.reload()} style={{padding:"12px 28px",borderRadius:100,background:th.gBtn,border:"none",cursor:"pointer",fontFamily:F.body,fontSize:14,fontWeight:600,color:"#fff"}}>
              Recargar app
            </button>
            {this.state.error&&<details style={{fontSize:10,color:th.text3,textAlign:"left",maxWidth:"100%",overflow:"auto"}}>
              <summary style={{cursor:"pointer",marginBottom:4}}>Error técnico</summary>
              <pre style={{whiteSpace:"pre-wrap",wordBreak:"break-all"}}>{this.state.error?.message}</pre>
            </details>}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── PIN SECURITY KEY ──
const PIN_KEY = "zeno-pin-hash";
// Simple hash for PIN storage (not cryptographic, but avoids plaintext)
function _hashPin(pin){
  let h=0;for(let i=0;i<pin.length;i++){h=((h<<5)-h)+pin.charCodeAt(i);h|=0;}
  return h.toString(36);
}
function getStoredPin(){try{return localStorage.getItem(PIN_KEY)||null;}catch{return null;}}
function storePin(pin){try{localStorage.setItem(PIN_KEY,_hashPin(pin));}catch{}}
function verifyPin(pin){
  const stored=getStoredPin();
  if(!stored)return pin==="1234"; // default if never set
  return _hashPin(pin)===stored;
}

// ── Notification permission + daily reminder ──
function NotifManager({lang, loggedIn}) {
  const [asked, setAsked] = useState(() => {
    try { return localStorage.getItem('zeno-notif-asked') === '1'; } catch { return false; }
  });
  const [granted, setGranted] = useState(() =>
    typeof Notification !== 'undefined' && Notification.permission === 'granted'
  );
  const {th, F} = useCtx();

  const scheduleReminder = () => {
    // Schedule a local notification for 9am tomorrow via setTimeout
    const now = new Date();
    const tomorrow9am = new Date(now);
    tomorrow9am.setDate(tomorrow9am.getDate() + 1);
    tomorrow9am.setHours(9, 0, 0, 0);
    const ms = tomorrow9am - now;
    if (ms > 0 && ms < 86400000 * 2) {
      setTimeout(() => {
        if (Notification.permission === 'granted') {
          new Notification('ZENO ⚡', {
            body: lang === 'es'
              ? '¿Cómo está tu energía hoy? Un momento para ti. 💚'
              : "How's your energy today? A moment for you. 💚",
            icon: '/icon-192.png',
            tag: 'daily-checkin',
          });
        }
      }, ms);
    }
  };

  const requestPermission = async () => {
    try {
      const result = await Notification.requestPermission();
      setGranted(result === 'granted');
      try { localStorage.setItem('zeno-notif-asked', '1'); } catch {}
      setAsked(true);
      if (result === 'granted') scheduleReminder();
    } catch { setAsked(true); }
  };

  // Register periodic sync if supported
  useEffect(() => {
    if (!granted || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(reg => {
      if ('periodicSync' in reg) {
        reg.periodicSync.register('zeno-daily-checkin', { minInterval: 24 * 60 * 60 * 1000 })
          .catch(() => {});
      }
    });
    scheduleReminder();
  }, [granted]);

  if (!loggedIn || asked || granted) return null;
  if (typeof Notification === 'undefined') return null;

  return (
    <div style={{
      position: 'absolute', bottom: 80, left: 16, right: 16, zIndex: 9300,
      background: th?.card || '#fff',
      borderRadius: 20, padding: '16px 18px',
      boxShadow: '0 8px 32px rgba(0,0,0,.18)',
      border: `1px solid ${th?.gBorder || '#5B9E8F40'}`,
      animation: 'homeCardIn .4s cubic-bezier(.34,1.56,.64,1) both'
    }}>
      <div style={{display:'flex', alignItems:'flex-start', gap:12}}>
        <span style={{fontSize:28, lineHeight:1}}>🔔</span>
        <div style={{flex:1}}>
          <div style={{fontSize:14, fontWeight:700, color:th?.text||'#111', marginBottom:4, fontFamily:F?.body||'sans-serif'}}>
            {lang==='es' ? 'Recordatorios diarios' : 'Daily reminders'}
          </div>
          <p style={{fontSize:12, color:th?.text2||'#555', lineHeight:1.5, margin:'0 0 12px', fontFamily:F?.body||'sans-serif'}}>
            {lang==='es'
              ? 'ZENO te recuerda hacer tu check-in de energía. Ideal para cerebros TDAH. 💚'
              : 'ZENO reminds you to do your energy check-in. Perfect for ADHD brains. 💚'}
          </p>
          <div style={{display:'flex', gap:8}}>
            <button onClick={requestPermission} style={{
              flex:1, padding:'10px', borderRadius:100,
              background: th?.gBtn || '#5B9E8F',
              border:'none', cursor:'pointer', color:'#fff',
              fontFamily:F?.body||'sans-serif', fontSize:13, fontWeight:700, minHeight:44
            }}>
              {lang==='es' ? '✨ Activar' : '✨ Enable'}
            </button>
            <button onClick={()=>{try{localStorage.setItem('zeno-notif-asked','1');}catch{}setAsked(true);}} style={{
              padding:'10px 16px', borderRadius:100,
              background:'transparent', border:`1px solid ${th?.border||'#ccc'}`,
              cursor:'pointer', color:th?.text2||'#888',
              fontFamily:F?.body||'sans-serif', fontSize:13, minHeight:44
            }}>
              {lang==='es' ? 'Ahora no' : 'Not now'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ZenoApp(){
  const[lang,setLang]=useState("es");
  const[autoDark,setAutoDark]=useState(false);
  const[dark,setDarkRaw]=useState(()=>typeof window!=="undefined"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);
  const setDark=useCallback((v)=>{setAutoDark(false);setDarkRaw(v);},[]);
  // Follow system preference when autoDark is on
  useEffect(()=>{
    if(!autoDark)return;
    const mq=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)");
    if(!mq)return;
    setDarkRaw(mq.matches);
    const handler=(e)=>setDarkRaw(e.matches);
    mq.addEventListener("change",handler);
    return()=>mq.removeEventListener("change",handler);
  },[autoDark]);
  const[accent,setAccent]=useState("sage");
  const[userName,setUserName]=useState("");const[loggedIn,setLoggedIn]=useState(false);const[profilePhoto,setProfilePhoto]=useState(null);const[brainType,setBrainType]=useState("");const[challenge,setChallenge]=useState("");
  const[tab,setTab]=useState("home");const[tabAnim,setTabAnim]=useState(true);
  const changeTab=(t)=>{haptic('soft');setTabAnim(false);setTimeout(()=>{setTab(t);setTabAnim(true);},80);};const[flow,setFlow]=useState(3.0);const[mounted,setM]=useState(false);
  const[memory,setMemory]=useState([]);
  const[badges,setBadges]=useState([]);
  const[xp,setXP]=useState(0);
  const[xpToast,setXpToast]=useState(null); // {amount, label}
  const[levelUpToast,setLevelUpToast]=useState(null); // level object
  const[badgeToast,setBadgeToast]=useState(null); // {id, icon, label}
  const[loaded,setLoaded]=useState(false);
  const[savedTasks,setSavedTasks]=useState([]);
  const[isOnline,setIsOnline]=useState(()=>typeof navigator!=="undefined"?navigator.onLine:true);
  const[apiKeyMissing,setApiKeyMissing]=useState(false);
  const[gdprDone,setGdprDone]=useState(()=>{try{return localStorage.getItem("zeno-gdpr")==="1";}catch{return true;}});
  useEffect(()=>{
    const up=()=>setIsOnline(true);
    const dn=()=>setIsOnline(false);
    window.addEventListener("online",up);window.addEventListener("offline",dn);
    return()=>{window.removeEventListener("online",up);window.removeEventListener("offline",dn);};
  },[]);
  useEffect(()=>{
    const id=setInterval(()=>{if(_noApiKey){setApiKeyMissing(true);_noApiKey=false;}},2000);
    return()=>clearInterval(id);
  },[]);
  // Biometric lock
  const[biometricEnabled,setBiometricEnabled]=useState(()=>{try{return localStorage.getItem(BIOMETRIC_KEY)==="true";}catch{return false;}});
  const[biometricAvail,setBiometricAvail]=useState(false);
  const[locked,setLocked]=useState(false);

  useEffect(()=>{biometricAvailable().then(ok=>setBiometricAvail(ok));},[]);

  // Lock app when it goes to background (tab/app switch)
  useEffect(()=>{
    const onVisChange=()=>{
      if(document.hidden && loggedIn && biometricEnabled){
        setLocked(true);
      }
    };
    document.addEventListener("visibilitychange",onVisChange);
    return()=>document.removeEventListener("visibilitychange",onVisChange);
  },[loggedIn,biometricEnabled]);

  // ── Load persisted data on mount ──
  useEffect(()=>{
    setTimeout(()=>setM(true),80);
    (async()=>{
      const d=await loadData();
      if(d){
        if(d.userName){setUserName(d.userName);setLoggedIn(true);}
        if(d.lang)setLang(d.lang);
        if(d.dark!==undefined)setDark(d.dark);
        if(d.accent)setAccent(d.accent);
        if(d.flow)setFlow(parseFloat(d.flow)||3.0);
        if(d.memory)setMemory(d.memory);if(d.profilePhoto)setProfilePhoto(d.profilePhoto);if(d.brainType)setBrainType(d.brainType);if(d.challenge)setChallenge(d.challenge);
      }
      const tk=await loadTasks();if(tk&&tk.length)setSavedTasks(tk);
      const bg=await loadBadges();if(bg&&bg.length)setBadges(bg);
      const savedXP=await loadXP();setXP(savedXP);
      setLoaded(true);
    })();
  },[]);

  // ── Evaluate badges whenever memory or flow changes ──
  useEffect(()=>{
    if(!loaded||!loggedIn)return;
    const newOnes=evalBadges(memory,flow,badges);
    if(newOnes.length>0){
      const next=[...badges,...newOnes];
      setBadges(next);
      saveBadges(next);
      // Show toast for first new badge
      const b=BADGES_DEF.find(x=>x.id===newOnes[0]);
      if(b){
        setBadgeToast({id:b.id,icon:b.icon,label:b.label[lang]||b.label.es});
        haptic("success");
        setTimeout(()=>setBadgeToast(null),3500);
      }
    }
  },[memory,flow,loaded,loggedIn]);

  // ── Save data on every change ──
  useEffect(()=>{
    if(!loaded)return;
    const payload={userName,lang,dark,accent,flow,memory,profilePhoto,brainType,challenge,lastSeen:new Date().toISOString()};
    saveData(payload);
  },[userName,lang,dark,accent,flow,memory,loaded]);

  // ── Google Sign-In handler — called from Onboard ──
  const handleGoogleLogin=async(onDoneCb)=>{
    try{
      const{name,photo}=await googleSignIn();
      if(photo)setProfilePhoto(photo);
      onDoneCb(name,null,null,{token:null,email:"",photo});
    }catch(e){
      console.warn("[ZENO] Google sign-in failed:",e.message);
    }
  };

  const addXP=useCallback((amount,label)=>{
    setXP(prev=>{
      const oldLevel=getLevel(prev);
      const newXP=prev+amount;
      const newLevel=getLevel(newXP);
      saveXP(newXP);
      setXpToast({amount,label});
      setTimeout(()=>setXpToast(null),2000);
      if(newLevel.min!==oldLevel.min){
        setLevelUpToast(newLevel);
        setTimeout(()=>setLevelUpToast(null),3500);
      }
      return newXP;
    });
    haptic("success");
  },[]);
  const addMemory=useCallback((entry)=>{
    setMemory(m=>{
      const next=[...m,entry];
      return next;
    });
    addXP(10,lang==="es"?"Check-in":"Check-in");
  },[addXP,lang]);
  const addTask=useCallback((txt)=>{
    if(!txt||!txt.trim())return;
    const raw=txt.trim();
    const energyMatch=raw.match(/energ[ií]a\s*(\d)/i);
    const energyLevel=energyMatch?Math.max(1,Math.min(5,parseInt(energyMatch[1]))):3;
    const cleanText=raw.replace(/energ[ií]a\s*\d/i,"").trim();
    const t={id:Date.now(),text:cleanText||raw,done:false,energyLevel,ts:Date.now()};
    setSavedTasks(prev=>{const n=[...prev,t];saveTasks(n);return n;});
  },[]);
  const[lastCompleted,setLastCompleted]=useState(null); // {id, text, timer}
  const[confetti,setConfetti]=useState([]);
  const burstConfetti=useCallback(()=>{
    const pieces=[...Array(18)].map((_,i)=>({
      id:i,x:30+Math.random()*40,
      color:["#5B9E8F","#7BBFB0","#F59E0B","#3B82F6","#10B981","#EC4899"][i%6],
      delay:Math.random()*0.4,
      size:6+Math.random()*6,
      angle:Math.random()*360
    }));
    setConfetti(pieces);
    setTimeout(()=>setConfetti([]),1800);
  },[]);
  const toggleTask=useCallback((id)=>{
    setSavedTasks(prev=>{
      const task=prev.find(t=>t.id===id);
      const completing=task&&!task.done;
      const n=prev.map(t=>t.id===id?{...t,done:!t.done,...(completing?{completedAt:new Date().toISOString()}:{})}:t);
      saveTasks(n);
      if(completing&&task){
        haptic("success");
        addXP(15,lang==="es"?"Tarea completada":"Task done");
        burstConfetti();
        // Show undo toast for 4s
        setLastCompleted(lc=>{if(lc?.timer)clearTimeout(lc.timer);const timer=setTimeout(()=>setLastCompleted(null),4000);return{id,text:task.text,timer};});
      }
      return n;
    });
  },[burstConfetti,addXP,lang]);
  const undoComplete=useCallback(()=>{
    if(!lastCompleted)return;
    clearTimeout(lastCompleted.timer);
    setSavedTasks(prev=>{const n=prev.map(t=>t.id===lastCompleted.id?{...t,done:false}:t);saveTasks(n);return n;});
    setLastCompleted(null);
    haptic("soft");
  },[lastCompleted]);
  const clearDone=useCallback(()=>{setSavedTasks(prev=>{const n=prev.filter(t=>!t.done);saveTasks(n);return n;});},[]);
  const t=STR[lang];const th=TH(dark,accent);

  const css=`
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,300;1,9..144,400&family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
    html,body{-webkit-text-size-adjust:100%;text-size-adjust:100%;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}
    *{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;}
    *{box-sizing:border-box;margin:0;padding:0;}
    @keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
    @keyframes fadeSlideUp{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:translateY(0)}}
    @keyframes orbEntrance{0%{opacity:0;transform:scale(.6) translateY(20px)}60%{transform:scale(1.07) translateY(-4px)}100%{opacity:1;transform:scale(1) translateY(0)}}
    @keyframes homeCardIn{0%{opacity:0;transform:translateY(18px) scale(.97)}100%{opacity:1;transform:translateY(0) scale(1)}}
    @keyframes floatGlow{0%,100%{opacity:.18;transform:scale(1) translateY(0)}50%{opacity:.32;transform:scale(1.08) translateY(-6px)}}
    @keyframes ambientDrift{0%{transform:translate(0,0) scale(1)}33%{transform:translate(12px,-8px) scale(1.04)}66%{transform:translate(-8px,10px) scale(.97)}100%{transform:translate(0,0) scale(1)}}
    @keyframes streakPop{0%{transform:scale(.8);opacity:0}70%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}
    @keyframes shimmerCard{0%{background-position:-200% 0}100%{background-position:200% 0}}
    @keyframes spFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
    @keyframes spGlow{0%,100%{opacity:.08;transform:scale(1)}50%{opacity:.22;transform:scale(1.07)}}
    @keyframes spRing{0%,100%{transform:scale(1);opacity:.08}50%{transform:scale(1.04);opacity:.03}}
    @keyframes dotB{0%,60%,100%{transform:translateY(0);opacity:.3}30%{transform:translateY(-3px);opacity:.8}}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes waveFlow{0%,100%{transform:translateX(0) scaleY(1)}50%{transform:translateX(-4px) scaleY(1.12)}}
    @keyframes synapsePulse{0%,100%{opacity:.6;strokeWidth:1.5}50%{opacity:1;strokeWidth:2.5}}
    @keyframes heartbeat{0%,100%{transform:scale(1)}14%{transform:scale(1.08)}28%{transform:scale(1)}}
    @keyframes heartbeatBig{0%,100%{transform:scale(1)}10%{transform:scale(1.12)}20%{transform:scale(1.04)}30%{transform:scale(1)}}
    @keyframes flameSway{0%,100%{transform:scaleX(1) skewX(0deg)}33%{transform:scaleX(.94) skewX(-3deg)}66%{transform:scaleX(1.06) skewX(2deg)}}
    @keyframes flameBig{0%,100%{transform:scaleX(1) scaleY(1)}25%{transform:scaleX(.92) scaleY(1.06)}50%{transform:scaleX(1.04) scaleY(.98)}75%{transform:scaleX(.96) scaleY(1.04)}}
    @keyframes loadBar{0%{transform:translateX(-100%)}50%{transform:translateX(0%)}100%{transform:translateX(100%)}}
    @keyframes ringBreathe{0%,100%{transform:scale(1);opacity:.2}50%{transform:scale(1.15);opacity:.05}}
    @keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
    @keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}
    @keyframes gentleBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
    @keyframes mascotFloat{0%,100%{transform:translate3d(0,0,0) rotate(0deg)}30%{transform:translate3d(0,-9px,0) rotate(-1.8deg)}70%{transform:translate3d(0,-5px,0) rotate(1.4deg)}}
    @keyframes mascotBounce{0%,100%{transform:translate3d(0,0,0) scaleY(1) scaleX(1)}35%{transform:translate3d(0,-14px,0) scaleY(1.06) scaleX(.97)}60%{transform:translate3d(0,-11px,0) scaleY(.96) scaleX(1.02)}80%{transform:translate3d(0,-2px,0) scaleY(1.02) scaleX(.99)}}
    @keyframes mascotWiggle{0%,100%{transform:translate3d(0,0,0) rotate(0deg)}15%{transform:translate3d(0,0,0) rotate(-7deg)}30%{transform:translate3d(0,0,0) rotate(7deg)}45%{transform:translate3d(0,0,0) rotate(-4deg)}60%{transform:translate3d(0,0,0) rotate(4deg)}75%{transform:translate3d(0,0,0) rotate(-2deg)}}
    @keyframes mascotPulseScale{0%,100%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(0,0,0) scale(1.07)}}
    @keyframes orbRotate{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
    @keyframes orbCounterRotate{0%{transform:rotate(0deg)}100%{transform:rotate(-360deg)}}
    @keyframes sparkleIn{0%{opacity:0;transform:scale(0) rotate(0deg)}50%{opacity:1;transform:scale(1.2) rotate(180deg)}100%{opacity:0;transform:scale(.8) rotate(360deg)}}
    @keyframes sparkleFloat{0%{opacity:0;transform:translateY(0) scale(0)}20%{opacity:.9;transform:translateY(-7px) scale(1)}80%{opacity:.5;transform:translateY(-22px) scale(.7)}100%{opacity:0;transform:translateY(-32px) scale(0)}}
    @keyframes energyRing{0%,100%{transform:scale(1);opacity:.16}50%{transform:scale(1.13);opacity:.04}}
    @keyframes energyRing2{0%,100%{transform:scale(1);opacity:.09}50%{transform:scale(1.22);opacity:.02}}
    @keyframes energyRing3{0%,100%{transform:scale(1) rotate(0deg);opacity:.06}50%{transform:scale(1.3) rotate(180deg);opacity:.01}}
    @keyframes nuclearGlow{0%,100%{opacity:.6;transform:scale(1)}50%{opacity:1;transform:scale(1.03)}}
    @keyframes glassShimmer{0%{background-position:-200% center}100%{background-position:200% center}}
    @keyframes dotOrbit{0%{transform:rotate(0deg) translateX(var(--orbit-r)) rotate(0deg)}100%{transform:rotate(360deg) translateX(var(--orbit-r)) rotate(-360deg)}}
    @keyframes dotPulseGlow{0%,100%{box-shadow:0 0 4px var(--dot-color),0 0 8px var(--dot-color);opacity:.5}50%{box-shadow:0 0 8px var(--dot-color),0 0 20px var(--dot-color),0 0 32px var(--dot-color);opacity:1}}
    @keyframes haloBreath{0%,100%{transform:scale(1);opacity:.12}50%{transform:scale(1.08);opacity:.28}}
    @keyframes scanLine{0%{transform:translateY(-20px);opacity:0}20%{opacity:.8}80%{opacity:.8}100%{transform:translateY(20px);opacity:0}}
    @keyframes floatStar{0%{opacity:0;transform:translate(0,0) scale(0) rotate(0deg)}25%{opacity:1;transform:translate(var(--sx),var(--sy)) scale(1) rotate(90deg)}75%{opacity:.6;transform:translate(calc(var(--sx)*1.6),calc(var(--sy)*1.6)) scale(.7) rotate(270deg)}100%{opacity:0;transform:translate(calc(var(--sx)*2.2),calc(var(--sy)*2.2)) scale(0) rotate(360deg)}}
    textarea{resize:none;}textarea:focus{outline:none;}input:focus{outline:none;}
    ::-webkit-scrollbar{width:0;}
    button{font-family:'Outfit',sans-serif;-webkit-tap-highlight-color:transparent;}
    button:focus-visible{outline:2px solid var(--focus-color,#5B9E8F);outline-offset:2px;border-radius:8px;}
    input:focus-visible{outline:2px solid var(--focus-color,#5B9E8F);outline-offset:1px;}
    a:focus-visible{outline:2px solid var(--focus-color,#5B9E8F);outline-offset:2px;}
    button:active{opacity:.85;}
    @supports(padding:env(safe-area-inset-bottom)){
      .safe-bottom{padding-bottom:env(safe-area-inset-bottom)!important;}
      .safe-top{padding-top:env(safe-area-inset-top)!important;}
    }
    @media(max-height:700px){
      .orb-hero{transform:scale(.85)!important;margin-bottom:8px!important;}
    }
    @keyframes ringPulse{0%,100%{opacity:.5;r:72}50%{opacity:.9;r:76}}
    @keyframes ringBreath{0%,100%{transform:scale(1)}50%{transform:scale(1.015)}}
    @keyframes numPop{0%{transform:scale(1.4);opacity:.6}100%{transform:scale(1);opacity:1}}
    @keyframes wavePulse{0%{r:40;opacity:.35}100%{r:75;opacity:0}}
    @keyframes dotPing{0%{transform:scale(1);opacity:1}70%{transform:scale(2.2);opacity:0}100%{transform:scale(1);opacity:0}}
    @keyframes agentPulse{0%,100%{transform:scale(1);opacity:.5}50%{transform:scale(1.35);opacity:0}}
    @keyframes agentFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
    @keyframes chipSlide{0%{opacity:0;transform:translateY(4px)}100%{opacity:1;transform:translateY(0)}}
    @keyframes msgIn{0%{opacity:0;transform:translateY(6px) scale(.97)}100%{opacity:1;transform:translateY(0) scale(1)}}
    @keyframes sunRay0{0%,100%{opacity:.9;transform:scaleY(1)}50%{opacity:.5;transform:scaleY(.7)}}
    @keyframes sunRay1{0%,100%{opacity:.7;transform:scaleY(.8)}50%{opacity:.95;transform:scaleY(1.1)}}
    @keyframes sunRay2{0%,100%{opacity:.55;transform:scaleY(1.1)}50%{opacity:.85;transform:scaleY(.75)}}
    @keyframes symbolFloat{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-3px) scale(1.04)}}
    @keyframes moonGlow{0%,100%{opacity:.85;filter:drop-shadow(0 0 6px currentColor)}50%{opacity:1;filter:drop-shadow(0 0 14px currentColor)}}
    @keyframes leafSway{0%,100%{transform:rotate(-4deg) scale(1)}50%{transform:rotate(4deg) scale(1.05)}}
    @keyframes eyeBlink{0%,85%,100%{transform:scaleY(1)}90%{transform:scaleY(.15)}}
    @keyframes boltFlash{0%,100%{opacity:.95;filter:drop-shadow(0 0 4px currentColor)}45%{opacity:.7;filter:drop-shadow(0 0 16px currentColor)}}
    @keyframes confettiFall{0%{opacity:1;transform:translateY(0) rotate(0deg) scale(1)}100%{opacity:0;transform:translateY(180px) rotate(720deg) scale(.3)}}
    @media(prefers-reduced-motion:reduce){
      *{animation-duration:.01ms!important;transition-duration:.01ms!important;}
    }
  `;
  const navI=[{icon:"home",t:"home",label:t.navHome},{icon:"focus",t:"focus",label:t.navFocus},{icon:"profile",t:"you",label:t.navProfile}];
  const[now,setNow]=useState(()=>new Date());useEffect(()=>{const id=setInterval(()=>setNow(new Date()),60000);return()=>clearInterval(id);},[]);
  const h=now.getHours();

  return(
    <ErrorBoundary>
    <Ctx.Provider value={{lang,setLang,t,th,dark,setDark,autoDark,setAutoDark,setDarkRaw,accent,setAccent,userName,memory,addMemory,badges,profilePhoto,setProfilePhoto,brainType,challenge,savedTasks,addTask,toggleTask,clearDone,undoComplete,lastCompleted,flow,xp,addXP}}>
      <div lang={lang} style={{minHeight:"100svh",minHeight:"100vh",background:th.outer,display:"flex",justifyContent:"center",alignItems:"center",fontFamily:F.body,padding:"clamp(8px,2vw,20px) clamp(8px,2vw,16px)",transition:"background .5s ease"}}>
        <style>{css}</style>
        <div style={{width:"100%",maxWidth:"min(390px,100vw)",borderRadius:"clamp(0px,5vw,44px)",overflow:"hidden",position:"relative",height:"min(860px,100svh)",height:"min(860px,100vh)",display:"flex",flexDirection:"column",background:th.bg,boxShadow:dark?"0 0 0 1px rgba(255,255,255,.05),0 20px 60px rgba(0,0,0,.4)":"0 0 0 1px rgba(0,0,0,.06),0 20px 60px rgba(0,0,0,.1),0 60px 120px rgba(0,0,0,.06)",transition:"background .5s ease,box-shadow .5s ease",opacity:mounted?1:0,transitionProperty:"opacity,background,box-shadow",transitionDuration:".8s,.5s,.5s"}}>

          {/* Loading skeleton — prevents FOUC */}
          {!loaded&&<div style={{position:"absolute",inset:0,zIndex:300,background:th.bg,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}><div style={{width:60,height:60,borderRadius:"50%",background:th.gBtn,animation:"haloBreath 1.4s ease-in-out infinite"}}/><div style={{fontFamily:F.display,fontSize:18,letterSpacing:4,color:th.text,opacity:.6}}>ZENO</div></div>}
          {/* Offline banner */}
          {loggedIn&&!isOnline&&<div style={{position:"absolute",top:0,left:0,right:0,zIndex:9500,background:"#EF4444",padding:"8px 16px",display:"flex",alignItems:"center",justifyContent:"center",gap:8,animation:"fadeIn .3s ease both"}}>
            <span style={{fontSize:16}}>📵</span>
            <span style={{fontSize:12,color:"#fff",fontWeight:600,fontFamily:F.body}}>{lang==="es"?"Sin conexión — algunas funciones no están disponibles":"Offline — some features unavailable"}</span>
          </div>}
          {apiKeyMissing&&loggedIn&&<div style={{position:"absolute",top:0,left:0,right:0,zIndex:9490,background:"linear-gradient(135deg,#F59E0B,#EF4444)",padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,animation:"fadeIn .3s ease both"}}>
            <span style={{fontSize:12,color:"#fff",fontWeight:600,fontFamily:F.body,flex:1}}>{lang==="es"?"⚡ Activa la IA gratis — Perfil → API Key (Gemini, sin tarjeta)":"⚡ Enable free AI — Profile → API Key (Gemini, no card needed)"}</span>
            <button onClick={()=>{setApiKeyMissing(false);setTab("you");}} style={{padding:"6px 12px",borderRadius:100,background:"rgba(255,255,255,.2)",border:"1px solid rgba(255,255,255,.4)",cursor:"pointer",color:"#fff",fontSize:11,fontWeight:700,fontFamily:F.body,whiteSpace:"nowrap"}}>
              {lang==="es"?"Ir →":"Go →"}
            </button>
            <button onClick={()=>setApiKeyMissing(false)} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,.7)",fontSize:18,lineHeight:1,padding:"0 4px"}}>×</button>
          </div>}
          {/* GDPR Consent — first run only */}
          {!gdprDone&&loaded&&<div style={{position:"absolute",bottom:0,left:0,right:0,zIndex:9400,background:th.card,borderTop:`1px solid ${th.border}`,padding:"16px 20px",animation:"fadeIn .4s ease both",boxShadow:"0 -8px 32px rgba(0,0,0,.15)"}}>
            <p style={{fontSize:12,color:th.text2,lineHeight:1.6,marginBottom:12,fontFamily:F.body}}>
              {lang==="es"?"ZENO guarda tus datos localmente en este dispositivo. No compartimos tu información con terceros.":"ZENO stores your data locally on this device. We don't share your information with third parties."}
            </p>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>{try{localStorage.setItem("zeno-gdpr","1");}catch{}setGdprDone(true);}} style={{flex:1,padding:"11px",borderRadius:RR.md,background:th.gBtn,border:"none",cursor:"pointer",color:"#fff",fontFamily:F.body,fontSize:13,fontWeight:600,minHeight:44}}>
                {lang==="es"?"Entendido":"Got it"}
              </button>
            </div>
          </div>}
          {/* Onboarding */}
          {!loggedIn && loaded && <Onboard
            onDone={(name,bt,ch,gData)=>{
              setUserName(name);
              setBrainType(bt||"");
              setChallenge(ch||"");
              if(gData&&gData.photo)setProfilePhoto(gData.photo);
              setLoggedIn(true);
            }}
            onGoogleLogin={(cb)=>handleGoogleLogin(cb)}
          />}

          {/* Biometric lock screen — shows when returning to app with biometric enabled */}
          {loggedIn && locked && biometricEnabled &&
            <BiometricLockScreen
              lang={lang} th={th} userName={userName} profilePhoto={profilePhoto}
              onUnlock={()=>setLocked(false)}
            />
          }

          {/* Panic SOS + AI Agent */}
          {loggedIn && !locked && <PanicButton/>}
          {loggedIn && !locked && <AIAgent/>}
          {/* Daily reminder prompt */}
          {loggedIn && !locked && <NotifManager lang={lang} loggedIn={loggedIn}/>}



          {/* Badge Toast */}
          {badgeToast&&(
            <div style={{position:"absolute",top:60,left:"50%",transform:"translateX(-50%)",zIndex:9001,background:th.gBtn,borderRadius:100,padding:"10px 20px",boxShadow:th.shadowLg,display:"flex",alignItems:"center",gap:10,animation:"homeCardIn .4s cubic-bezier(.34,1.56,.64,1) both",whiteSpace:"nowrap",pointerEvents:"none"}}>
              <span style={{fontSize:20}}>{badgeToast.icon}</span>
              <div>
                <div style={{fontSize:10,color:"rgba(255,255,255,.7)",letterSpacing:1.5,textTransform:"uppercase",fontWeight:600}}>{t.badgeNew||"¡Nuevo logro!"}</div>
                <div style={{fontSize:13,color:"#fff",fontWeight:700,fontFamily:F.body}}>{badgeToast.label}</div>
              </div>
            </div>
          )}

          {/* Confetti burst */}
          {confetti.map(p=>(
            <div key={p.id} style={{
              position:"absolute",
              left:`${p.x}%`,
              top:"40%",
              width:p.size,
              height:p.size,
              borderRadius:p.id%3===0?"50%":"2px",
              background:p.color,
              zIndex:9900,
              pointerEvents:"none",
              animation:`confettiFall 1.6s ease-in ${p.delay}s both`,
              transform:`rotate(${p.angle}deg)`
            }}/>
          ))}

          {/* XP Toast */}
          {xpToast&&<div style={{position:"absolute",top:56,right:16,zIndex:9200,background:"linear-gradient(135deg,#10B981,#059669)",borderRadius:100,padding:"8px 16px",display:"flex",alignItems:"center",gap:8,animation:"homeCardIn .35s cubic-bezier(.34,1.56,.64,1) both",pointerEvents:"none",boxShadow:"0 4px 16px rgba(16,185,129,.35)"}}>
            <span style={{fontSize:16}}>⚡</span>
            <span style={{fontSize:13,color:"#fff",fontWeight:700,fontFamily:F.body}}>+{xpToast.amount} XP</span>
            <span style={{fontSize:11,color:"rgba(255,255,255,.75)",fontFamily:F.body}}>{xpToast.label}</span>
          </div>}
          {/* Level Up Toast */}
          {levelUpToast&&<div style={{position:"absolute",top:"35%",left:"50%",transform:"translateX(-50%)",zIndex:9800,background:`linear-gradient(135deg,${levelUpToast.color},${levelUpToast.color}cc)`,borderRadius:24,padding:"20px 28px",display:"flex",flexDirection:"column",alignItems:"center",gap:8,animation:"homeCardIn .4s cubic-bezier(.34,1.56,.64,1) both",boxShadow:`0 12px 40px ${levelUpToast.color}60`,pointerEvents:"none",minWidth:200}}>
            <span style={{fontSize:40,animation:"symbolFloat 1s ease-in-out infinite"}}>{levelUpToast.emoji}</span>
            <div style={{fontSize:11,color:"rgba(255,255,255,.8)",letterSpacing:3,textTransform:"uppercase",fontWeight:600,fontFamily:F.body}}>¡Nivel alcanzado!</div>
            <div style={{fontSize:18,color:"#fff",fontWeight:700,fontFamily:F.display,textAlign:"center"}}>{levelUpToast.nameEs}</div>
          </div>}
          {/* Header */}
          {loggedIn&&<div style={{padding:"max(44px,env(safe-area-inset-top,44px)) 22px 0",position:"relative",zIndex:5,flexShrink:0}}>
            {/* Top accent line */}
            <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,transparent,${th.g}40,transparent)`}}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:4}}>
              <div style={{fontFamily:F.display,fontSize:20,fontWeight:700,letterSpacing:4,color:th.text,transition:"color .4s"}}>ZENO</div>
              {tab==="home"?(<div style={{display:"flex",alignItems:"center",gap:8,background:th.gSoft,borderRadius:100,padding:"7px 16px",border:`1px solid ${th.gBorder}`,transition:"all .4s"}}><Ic name="waves" size={13} color={th.g} sw={1.3}/><span style={{fontFamily:F.mono,fontSize:14,fontWeight:600,color:th.g}}>{flow.toFixed(1)}</span><span style={{fontSize:8,color:th.text3,letterSpacing:2,textTransform:"uppercase",fontWeight:500}}>flow</span></div>):(<div style={{display:"flex",alignItems:"center",gap:7}}><div style={{width:4,height:4,borderRadius:"50%",background:th.g}}/><div style={{fontFamily:F.body,fontSize:14,fontWeight:500,color:th.text2,transition:"color .4s"}}>{navI.find(n=>n.t===tab)?.label||""}</div></div>)}
            </div>
            {tab==="home"&&<div style={{marginTop:16,animation:"fadeIn .6s ease both"}}><div style={{fontFamily:F.display,fontSize:19,fontWeight:400,color:th.text,fontStyle:"italic",transition:"color .4s"}}>{t.greeting(userName,h).split(userName)[0]}<span style={{color:th.g,fontWeight:600,fontStyle:"normal"}}>{userName}</span></div></div>}
          </div>}

          {/* Content */}
          {loggedIn&&<div role="main" style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",position:"relative",zIndex:3,paddingTop:tab==="home"?4:14,opacity:tabAnim?1:0,transform:tabAnim?"translateX(0) translateY(0)":"translateX(-8px) translateY(4px)",transition:"opacity .25s cubic-bezier(.25,.46,.45,.94),transform .25s cubic-bezier(.25,.46,.45,.94)"}}>
            {tab==="home"&&<HomeTab flow={flow} setFlow={setFlow}/>}
            {tab==="focus"&&<FocusTab/>}
            {tab==="you"&&<YouTab onLogout={async()=>{setLoggedIn(false);setUserName("");setMemory([]);setTab("home");setFlow(3.0);setProfilePhoto(null);setBrainType("");setChallenge("");setSavedTasks([]);try{const s=_store();if(s){await s.delete(STORE_KEY);await s.delete(AGENT_KEY);await s.delete(TASKS_KEY);}else{localStorage.removeItem(STORE_KEY);localStorage.removeItem(AGENT_KEY);localStorage.removeItem(TASKS_KEY);localStorage.removeItem("zeno-remind");}}catch(e){}}}/>}
          </div>}

          {/* Nav */}
          {loggedIn&&<div style={{position:"relative",zIndex:10,background:th.navBg,backdropFilter:"blur(20px)",borderTop:`1px solid ${th.border}`,padding:"10px 10px max(28px,env(safe-area-inset-bottom,28px))",display:"flex",justifyContent:"space-around",flexShrink:0,transition:"background .5s,border-color .5s"}}>
            {navI.map(nav=>{const ac=tab===nav.t;return(<button key={nav.t} onClick={()=>changeTab(nav.t)} aria-label={nav.label} aria-current={ac?"page":undefined} role="tab" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"6px 0",position:"relative",background:"none",border:"none",cursor:"pointer",transition:"all .3s ease",flex:1,minWidth:0}}>{ac&&<div style={{position:"absolute",top:-8,width:24,height:3,borderRadius:100,background:`linear-gradient(90deg,${th.g},${th.g2})`}}/>}<Ic name={nav.icon} size={20} color={ac?th.g:th.text3} sw={ac?1.8:1.2}/><span style={{fontSize:7.5,letterSpacing:.8,textTransform:"uppercase",color:ac?th.g:th.text3,fontWeight:ac?600:400,transition:"color .3s",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%"}}>{nav.label}</span></button>);})}
          </div>}
        </div>
      </div>
    </Ctx.Provider>
    </ErrorBoundary>
  );
}

