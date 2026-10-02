let csrf='';
export function setCsrf(value){csrf=value;}
export async function api(path,options={}){
  const headers={...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),'x-noose-csrf':csrf,...options.headers};
  const response=await fetch('/api'+path,{...options,headers,credentials:'same-origin',body:options.body&&!(options.body instanceof FormData)?JSON.stringify(options.body):options.body});
  const data=await response.json();
  if(!response.ok){if(response.status===401&&path!=='/login'&&path!=='/me')window.dispatchEvent(new Event('session-expired'));const err=new Error(data.error||'Une erreur est survenue.');err.status=response.status;throw err;}return data;
}
export const go=path=>{window.location.hash=path;};
export const statuses={a_examiner:['À examiner','amber'],entretien:['Entretien','blue'],accepte:['Accepté','teal'],probatoire:['Période probatoire','violet'],integre:['Intégré','teal'],refuse:['Refusé','red'],archive:['Archivé','gray']};
export const evaluationStatuses={a_faire:['À faire','gray'],en_cours:['En cours','blue'],valide:['Validé','teal'],a_revoir:['À revoir','red']};
export const documentStatuses={en_attente:['En attente','amber'],valide:['Validé','teal'],a_corriger:['À corriger','red']};
export const categories={contrat:'Contrat d’engagement',portrait:'Photo de face',identite:'Pièce d’identité RP',permis:'Permis de conduire RP',autre:'Autre pièce'};
export const roles={admin:'Administrateur',recruteur:'Recruteur',formateur:'Formateur'};
export const trainingCategories={administratif:'Administration',formation:'Formation',aptitude:'Aptitude'};
export const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Paris'});
export const formatDate=(v,withTime=false)=>v?new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',...(withTime?{timeStyle:'short'}:{}),timeZone:'Europe/Paris'}).format(new Date(v.length===10?v+'T12:00:00Z':v)):'—';
export const initials=c=>`${c.first_name?.[0]||''}${c.last_name?.[0]||''}`.toUpperCase();
export const fullName=c=>`${c.first_name} ${c.last_name}`;
export const percent=c=>c.total_steps?Math.round(c.completed/c.total_steps*100):0;
export const weeklyDue=e=>!e||e.status!=='valide'||(new Date(today()+'T12:00:00Z')-new Date(e.evaluated_at+'T12:00:00Z'))/86400000>=7;
