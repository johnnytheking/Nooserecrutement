import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { z, ZodError } from 'zod';
import { randomBytes, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { openDatabase, id, now, hashPassword, checkPassword } from './db.mjs';

const db = await openDatabase();
const q = db.query;
const app = express();
const dev = process.argv.includes('--dev');
const production = process.env.NODE_ENV === 'production';
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: dev ? false : { directives: { defaultSrc:["'self'"], scriptSrc:["'self'"], styleSrc:["'self'","'unsafe-inline'"], imgSrc:["'self'",'blob:','data:'], fontSrc:["'self'"], connectSrc:["'self'"], frameAncestors:["'none'"], objectSrc:["'none'"], upgradeInsecureRequests: production ? [] : null } }, strictTransportSecurity: production ? undefined : false }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', (req,res,next) => { res.set('Cache-Control','no-store'); next(); });
app.use('/api', rateLimit({ windowMs:60000, limit:300, standardHeaders:'draft-7', legacyHeaders:false, message:{ error:'Trop de requêtes. Réessayez dans une minute.' } }));
app.use('/api', (req,res,next) => {
  if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
    const origin = req.get('origin');
    const expected = process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
    if (origin && origin !== expected) return res.status(403).json({error:'Origine de la requête non autorisée.'});
    if (!req.is('application/json') && !req.is('multipart/form-data')) return res.status(415).json({error:'Format de requête non pris en charge.'});
  }
  next();
});
const digest = token => createHash('sha256').update(token).digest('hex');
const cookieToken = req => /(?:^|;\s*)noose_session=([^;]+)/.exec(req.headers.cookie||'')?.[1] || '';
const publicUser = u => ({id:u.id,username:u.username,name:u.name,role:u.role,active:u.active,created_at:u.created_at});
const cookieOptions = { httpOnly:true, sameSite:'strict', secure:production, path:'/', maxAge:12*60*60*1000 };
const loginLimiter = rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-7',legacyHeaders:false,skipSuccessfulRequests:true,message:{error:'Trop de tentatives. Réessayez dans 15 minutes.'}});
const fakeHash = await hashPassword(randomBytes(32).toString('hex'));
app.post('/api/login', loginLimiter, async (req,res) => {
  const {username,password} = z.object({username:z.string().min(1).max(64),password:z.string().min(1).max(256)}).parse(req.body);
  const user = (await q('SELECT * FROM users WHERE username=$1',[username.trim().toLowerCase()]))[0];
  const valid = await checkPassword(password, user?.password_hash || fakeHash);
  if (!user || !user.active || !valid) return res.status(401).json({error:'Identifiant ou mot de passe incorrect.'});
  await q('DELETE FROM sessions WHERE expires_at < $1',[now()]);
  const token = randomBytes(32).toString('hex'), csrf = randomBytes(24).toString('hex');
  await q('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,$4)',[digest(token),user.id,csrf,new Date(Date.now()+12*60*60*1000).toISOString()]);
  res.cookie('noose_session',token,cookieOptions).json({user:publicUser(user),csrf});
});
app.get('/healthz',async(req,res)=>{await q('SELECT 1 AS ok');res.json({status:'ok'});});
app.use('/api',async(req,res,next)=>{
  const token=cookieToken(req);
  if(!token || !/^[a-f0-9]{64}$/.test(token)) return res.status(401).json({error:'Connectez-vous pour accéder au portail.'});
  const user=(await q('SELECT u.*,s.csrf,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at > $2 AND u.active=1',[digest(token),now()]))[0];
  if(!user) return res.status(401).json({error:'Session expirée. Veuillez vous reconnecter.'});
  req.user=user;
  if(!['GET','HEAD','OPTIONS'].includes(req.method) && req.get('x-noose-csrf')!==user.csrf) return res.status(403).json({error:'Session invalide. Actualisez la page.'});
  next();
});
const roles=(...allowed)=>(req,res,next)=>allowed.includes(req.user.role)?next():res.status(403).json({error:'Votre rôle ne permet pas cette action.'});
const recruitment=roles('admin','recruteur');
const admin=roles('admin');
const audit=async(req,candidate,action)=>q('INSERT INTO audit(id,candidate_id,author_id,action,created_at) VALUES($1,$2,$3,$4,$5)',[id(),candidate,req.user.id,action,now()]);
const fail=(status,message)=>{const err=new Error(message);err.status=status;throw err;};
const getCandidate=async candidateId=>{z.string().uuid().parse(candidateId);const row=(await q('SELECT * FROM candidates WHERE id=$1',[candidateId]))[0];if(!row)fail(404,'Dossier introuvable.');return row;};
app.get('/api/me',(req,res)=>res.json({user:publicUser(req.user),csrf:req.user.csrf}));
app.post('/api/logout',async(req,res)=>{await q('DELETE FROM sessions WHERE token_hash=$1',[digest(cookieToken(req))]);res.clearCookie('noose_session',cookieOptions).json({ok:true});});
app.get('/api/settings',async(req,res)=>{const [questions,training]=await Promise.all([q('SELECT * FROM questions ORDER BY position,id'),q('SELECT * FROM training ORDER BY position,id')]);res.json({questions:req.user.role==='formateur'?[]:questions,training});});

const date=z.string().refine(s=>s===''||(/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(new Date(s).getTime())&&new Date(s).toISOString().slice(0,10)===s),'Date invalide.');
const short=z.string().trim().max(200).default('');
const statuses=['a_examiner','entretien','accepte','probatoire','integre','refuse','archive'];
const candidateSchema=z.object({reference:z.string().trim().min(1).max(80),first_name:z.string().trim().min(1).max(100),last_name:z.string().trim().min(1).max(100),birth_date:date.default(''),phone:short,discord:short,matricule:short,grade:short,department:short,recruited_at:date.default(''),recruiter:short,status:z.enum(statuses).default('a_examiner'),notes:z.string().max(10000).default('')});
const candidateColumns=['reference','first_name','last_name','birth_date','phone','discord','matricule','grade','department','recruited_at','recruiter','status','notes'];
const trainingView=c=>({id:c.id,reference:c.reference,first_name:c.first_name,last_name:c.last_name,matricule:c.matricule,grade:c.grade,department:c.department,status:c.status,created_at:c.created_at,updated_at:c.updated_at,version:c.version});
app.get('/api/candidates',async(req,res)=>{
  const [rows,training,evaluations,documents,interviews]=await Promise.all([
    q('SELECT * FROM candidates ORDER BY updated_at DESC LIMIT 1000'),q('SELECT * FROM training WHERE active=1 ORDER BY position'),
    q('SELECT e.*,u.name AS author FROM evaluations e JOIN users u ON u.id=e.author_id ORDER BY e.evaluated_at DESC,e.created_at DESC'),
    req.user.role==='formateur'?Promise.resolve([]):q('SELECT candidate_id,status FROM documents'),
    req.user.role==='formateur'?Promise.resolve([]):q('SELECT candidate_id,answers FROM interviews')
  ]);
  const mandatory=training.filter(t=>!t.recurring);
  const data=rows.map(c=>{
    const list=evaluations.filter(e=>e.candidate_id===c.id),latest={};for(const e of list)if(!latest[e.training_id])latest[e.training_id]=e;
    const docs=documents.filter(d=>d.candidate_id===c.id);
    const answers=JSON.parse(interviews.find(i=>i.candidate_id===c.id)?.answers||'[]');
    return {...(req.user.role==='formateur'?trainingView(c):c),completed:mandatory.filter(t=>latest[t.id]?.status==='valide').length,total_steps:mandatory.length,document_count:docs.length,pending_documents:docs.filter(d=>d.status==='en_attente').length,score:answers.reduce((s,a)=>s+(a.rating||0),0),scored:answers.filter(a=>a.rating!=null).length,interview_count:answers.length,latest};
  });res.json(data);
});
app.post('/api/candidates',recruitment,async(req,res)=>{
  const input=candidateSchema.parse(req.body),candidateId=id(),time=now();
  await q(`INSERT INTO candidates(id,${candidateColumns.join(',')},created_at,updated_at) VALUES(${Array.from({length:16},(_,i)=>'$'+(i+1)).join(',')})`,[candidateId,...candidateColumns.map(k=>input[k]),time,time]);
  await audit(req,candidateId,'Ouverture du dossier de recrutement');res.status(201).json(await getCandidate(candidateId));
});
app.put('/api/candidates/:id',recruitment,async(req,res)=>{
  const before=await getCandidate(req.params.id),input=candidateSchema.parse(req.body),version=z.number().int().positive().parse(req.body.version);
  const rows=await q(`UPDATE candidates SET ${candidateColumns.map((k,i)=>`${k}=$${i+1}`).join(',')},updated_at=$14,version=version+1 WHERE id=$15 AND version=$16 RETURNING *`,[...candidateColumns.map(k=>input[k]),now(),before.id,version]);
  if(!rows.length)fail(409,'Ce dossier a été modifié par un autre utilisateur. Rechargez-le avant de réessayer.');
  await audit(req,before.id,before.status!==input.status?`Statut : ${before.status} → ${input.status}`:'Mise à jour du dossier administratif');res.json(rows[0]);
});
app.get('/api/candidates/:id',async(req,res)=>{
  const c=await getCandidate(req.params.id);
  const [documents,evaluations,history,interviews]=await Promise.all([
    req.user.role==='formateur'?Promise.resolve([]):q('SELECT d.id,d.category,d.filename,d.mime,d.size,d.status,d.comment,d.created_at,d.reviewed_at,u.name AS author,r.name AS reviewer FROM documents d JOIN users u ON u.id=d.author_id LEFT JOIN users r ON r.id=d.reviewed_by WHERE candidate_id=$1 ORDER BY d.created_at DESC',[c.id]),
    q('SELECT e.*,u.name AS author FROM evaluations e JOIN users u ON u.id=e.author_id WHERE candidate_id=$1 ORDER BY evaluated_at DESC,e.created_at DESC',[c.id]),
    q('SELECT a.id,a.action,a.created_at,u.name AS author FROM audit a JOIN users u ON u.id=a.author_id WHERE candidate_id=$1 ORDER BY a.created_at DESC LIMIT 100',[c.id]),
    req.user.role==='formateur'?Promise.resolve([]):q('SELECT i.*,u.name AS author FROM interviews i JOIN users u ON u.id=i.updated_by WHERE candidate_id=$1',[c.id])
  ]);
  res.json({candidate:req.user.role==='formateur'?trainingView(c):c,documents,evaluations,history:req.user.role==='formateur'?history.filter(a=>a.action.startsWith('Évaluation')):history,interview:interviews[0]?{...interviews[0],answers:JSON.parse(interviews[0].answers)}:null});
});
const answerSchema=z.object({question_id:z.string().uuid(),title:z.string().max(2000),expected:z.string().max(4000),answer:z.string().max(6000),accuracy:z.enum(['non_evalue','incorrecte','partielle','correcte']),rating:z.number().int().min(1).max(5).nullable(),comment:z.string().max(3000)});
app.put('/api/candidates/:id/interview',recruitment,async(req,res)=>{
  const c=await getCandidate(req.params.id);
  const input=z.object({answers:z.array(answerSchema).min(1).max(50),comment:z.string().max(10000),version:z.number().int().min(0)}).parse(req.body);
  if(new Set(input.answers.map(a=>a.question_id)).size!==input.answers.length)fail(400,'Une question apparaît plusieurs fois.');
  const old=(await q('SELECT * FROM interviews WHERE candidate_id=$1',[c.id]))[0];
  const allowed=old?JSON.parse(old.answers):await q('SELECT id AS question_id,title,expected FROM questions WHERE active=1');
  if(input.answers.length!==allowed.length||input.answers.some(a=>!allowed.some(b=>b.question_id===a.question_id)))fail(409,'La liste des questions a changé. Rechargez cet entretien.');
  const answers=input.answers.map(a=>{const original=allowed.find(b=>b.question_id===a.question_id);return {...a,title:original.title,expected:original.expected};});
  let rows;
  if(old) rows=await q('UPDATE interviews SET answers=$1,comment=$2,updated_by=$3,updated_at=$4,version=version+1 WHERE candidate_id=$5 AND version=$6 RETURNING candidate_id',[JSON.stringify(answers),input.comment,req.user.id,now(),c.id,input.version]);
  else {
    if(input.version!==0)fail(409,'Version d’entretien invalide.');
    rows=await q('INSERT INTO interviews(candidate_id,answers,comment,updated_by,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(candidate_id) DO NOTHING RETURNING candidate_id',[c.id,JSON.stringify(answers),input.comment,req.user.id,now()]);
  }
  if(!rows.length)fail(409,'Cet entretien a été modifié. Rechargez-le avant de réessayer.');
  await audit(req,c.id,'Enregistrement de l’entretien de recrutement');res.json({ok:true});
});
app.post('/api/candidates/:id/evaluations',async(req,res)=>{
  const c=await getCandidate(req.params.id);
  const input=z.object({training_id:z.string().uuid(),status:z.enum(['a_faire','en_cours','valide','a_revoir']),evaluated_at:date.refine(Boolean),comment:z.string().max(6000).default('')}).parse(req.body);
  const t=(await q('SELECT * FROM training WHERE id=$1 AND active=1',[input.training_id]))[0];if(!t)fail(404,'Étape introuvable.');
  if(req.user.role==='formateur'&&t.category==='administratif')fail(403,'Cette étape relève de l’administration.');
  if(input.evaluated_at>now().slice(0,10))fail(400,'Une évaluation ne peut pas être datée dans le futur.');
  await q('INSERT INTO evaluations(id,candidate_id,training_id,status,evaluated_at,comment,author_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id(),c.id,t.id,input.status,input.evaluated_at,input.comment,req.user.id,now()]);
  await audit(req,c.id,`Évaluation · ${t.title} · ${input.status}`);res.status(201).json({ok:true});
});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:1,fields:2}});
app.post('/api/candidates/:id/documents',recruitment,upload.single('file'),async(req,res)=>{
  const c=await getCandidate(req.params.id);
  const category=z.enum(['contrat','portrait','identite','permis','autre']).parse(req.body.category);
  if(!req.file)fail(400,'Choisissez un document.');
  const b=req.file.buffer;
  const mime=b.subarray(0,5).toString()==='%PDF-'?'application/pdf':b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':b[0]===255&&b[1]===216&&b[2]===255?'image/jpeg':null;
  if(!mime)fail(400,'Seuls les fichiers PDF, PNG et JPEG valides sont acceptés.');
  const usage=(await q('SELECT COALESCE(SUM(size),0) AS total FROM documents'))[0];
  if(Number(usage.total)+b.length>250*1024*1024)fail(413,'Le stockage documentaire a atteint sa limite de 250 Mo. Contactez l’administrateur.');
  const filename=req.file.originalname.replace(/[^\p{L}\p{N} ._()-]/gu,'_').slice(0,180)||'document';
  const docId=id();await q('INSERT INTO documents(id,candidate_id,category,filename,mime,size,content,author_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[docId,c.id,category,filename,mime,b.length,b,req.user.id,now()]);
  await audit(req,c.id,`Ajout d’une pièce · ${filename}`);res.status(201).json({id:docId});
});
app.get('/api/documents',recruitment,async(req,res)=>res.json(await q('SELECT d.id,d.candidate_id,d.category,d.filename,d.size,d.status,d.comment,d.created_at,c.reference,c.first_name,c.last_name FROM documents d JOIN candidates c ON c.id=d.candidate_id ORDER BY d.created_at DESC LIMIT 1000')));
app.get('/api/documents/:id/download',recruitment,async(req,res)=>{
  const d=(await q('SELECT * FROM documents WHERE id=$1',[req.params.id]))[0];if(!d)fail(404,'Document introuvable.');
  res.set('Content-Type',d.mime).set('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(d.filename)}`).set('X-Content-Type-Options','nosniff').send(Buffer.from(d.content));
});
app.patch('/api/documents/:id',recruitment,async(req,res)=>{
  const input=z.object({status:z.enum(['en_attente','valide','a_corriger']),comment:z.string().max(4000).default('')}).parse(req.body);
  const rows=await q('UPDATE documents SET status=$1,comment=$2,reviewed_by=$3,reviewed_at=$4 WHERE id=$5 RETURNING candidate_id,filename',[input.status,input.comment,req.user.id,now(),req.params.id]);if(!rows.length)fail(404,'Document introuvable.');
  await audit(req,rows[0].candidate_id,`Vérification · ${rows[0].filename} · ${input.status}`);res.json({ok:true});
});
app.get('/api/admin/users',admin,async(req,res)=>res.json((await q('SELECT * FROM users ORDER BY created_at')).map(publicUser)));
app.post('/api/admin/users',admin,async(req,res)=>{
  const input=z.object({username:z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/),name:z.string().trim().min(2).max(100),role:z.enum(['admin','recruteur','formateur']),password:z.string().min(8).max(128)}).parse(req.body);
  const userId=id();await q('INSERT INTO users(id,username,name,role,password_hash,created_at) VALUES($1,$2,$3,$4,$5,$6)',[userId,input.username,input.name,input.role,await hashPassword(input.password),now()]);
  await audit(req,null,`Création du compte ${input.username} · ${input.role}`);res.status(201).json({id:userId});
});
app.patch('/api/admin/users/:id',admin,async(req,res)=>{
  const input=z.object({name:z.string().trim().min(2).max(100),role:z.enum(['admin','recruteur','formateur']),active:z.number().int().min(0).max(1),password:z.string().min(8).max(128).optional()}).parse(req.body);
  if(req.params.id===req.user.id&&(input.active!==1||input.role!=='admin'))fail(400,'Vous ne pouvez pas désactiver ou rétrograder votre propre compte.');
  const user=(await q('SELECT id,username FROM users WHERE id=$1',[req.params.id]))[0];if(!user)fail(404,'Compte introuvable.');
  await q('UPDATE users SET name=$1,role=$2,active=$3 WHERE id=$4',[input.name,input.role,input.active,user.id]);
  if(input.password)await q('UPDATE users SET password_hash=$1 WHERE id=$2',[await hashPassword(input.password),user.id]);
  if(input.password||!input.active||input.role!==req.user.role)await q('DELETE FROM sessions WHERE user_id=$1',[user.id]);
  await audit(req,null,`Mise à jour du compte ${user.username}`);res.json({ok:true});
});
const questionSchema=z.object({title:z.string().trim().min(5).max(2000),expected:z.string().trim().max(4000),position:z.number().int().min(0).max(100),active:z.number().int().min(0).max(1)});
app.post('/api/admin/questions',admin,async(req,res)=>{const v=questionSchema.parse(req.body);await q('INSERT INTO questions(id,title,expected,position,active) VALUES($1,$2,$3,$4,$5)',[id(),v.title,v.expected,v.position,v.active]);await audit(req,null,'Ajout d’une question d’entretien');res.status(201).json({ok:true});});
app.put('/api/admin/questions/:id',admin,async(req,res)=>{const v=questionSchema.parse(req.body);const r=await q('UPDATE questions SET title=$1,expected=$2,position=$3,active=$4 WHERE id=$5 RETURNING id',[v.title,v.expected,v.position,v.active,req.params.id]);if(!r.length)fail(404,'Question introuvable.');await audit(req,null,'Modification d’une question d’entretien');res.json({ok:true});});
const trainingSchema=z.object({title:z.string().trim().min(3).max(200),description:z.string().max(3000),category:z.enum(['administratif','formation','aptitude']),recurring:z.number().int().min(0).max(1),position:z.number().int().min(0).max(100),active:z.number().int().min(0).max(1)});
app.post('/api/admin/training',admin,async(req,res)=>{const v=trainingSchema.parse(req.body);await q('INSERT INTO training(id,title,description,category,recurring,position,active) VALUES($1,$2,$3,$4,$5,$6,$7)',[id(),v.title,v.description,v.category,v.recurring,v.position,v.active]);await audit(req,null,'Ajout d’une étape au parcours');res.status(201).json({ok:true});});
app.put('/api/admin/training/:id',admin,async(req,res)=>{const v=trainingSchema.parse(req.body);const r=await q('UPDATE training SET title=$1,description=$2,category=$3,recurring=$4,position=$5,active=$6 WHERE id=$7 RETURNING id',[v.title,v.description,v.category,v.recurring,v.position,v.active,req.params.id]);if(!r.length)fail(404,'Étape introuvable.');await audit(req,null,'Modification du parcours de formation');res.json({ok:true});});
app.get('/api/admin/audit',admin,async(req,res)=>res.json(await q('SELECT a.*,u.name AS author,c.reference FROM audit a JOIN users u ON u.id=a.author_id LEFT JOIN candidates c ON c.id=a.candidate_id ORDER BY a.created_at DESC LIMIT 200')));
app.use('/api',(req,res)=>res.status(404).json({error:'Ressource introuvable.'}));
if(dev){const {createServer}=await import('vite');const vite=await createServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);}
else {app.use(express.static(resolve('dist'),{index:false,maxAge:'1h'}));app.get('/{*path}',(req,res)=>res.set('Cache-Control','no-cache').sendFile(resolve('dist/index.html')));}
app.use((err,req,res,next)=>{
  if(res.headersSent)return next(err);
  if(err instanceof ZodError)return res.status(400).json({error:'Vérifiez les champs du formulaire.',details:err.issues.map(i=>`${i.path.join('.')}: ${i.message}`).slice(0,10)});
  if(err instanceof multer.MulterError)return res.status(400).json({error:err.code==='LIMIT_FILE_SIZE'?'Le fichier dépasse la limite de 8 Mo.':'Un seul fichier à la fois est accepté.'});
  if(err.code==='23505'||err.code==='ERR_SQLITE_ERROR'&&/UNIQUE constraint/.test(err.message))return res.status(409).json({error:'Cet identifiant ou ce numéro de recrutement existe déjà.'});
  if(err.status)return res.status(err.status).json({error:err.message});
  console.error('Erreur applicative',err.code||err.name);res.status(500).json({error:'Une erreur est survenue. Réessayez ou contactez l’administrateur.'});
});
const portArg=process.argv.indexOf('--port');
const port=Number(process.env.PORT||(portArg>=0?process.argv[portArg+1]:4173));
const server=app.listen(port,'0.0.0.0',()=>console.log(`NOOSE prêt sur http://0.0.0.0:${server.address().port}`));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{server.close(async()=>{await db.close();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();});
