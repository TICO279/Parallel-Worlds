export type MobileRoute = {screen:'discover'} | {screen:'profile'} | {screen:'worlds';conversationId:string} | {screen:'missing'};
export function readMobileRoute(path:string):MobileRoute {
  if(path==='/'||path==='')return{screen:'discover'};
  if(path==='/profile/alex'||path==='/profile/alex/')return{screen:'profile'};
  const match=path.match(/^\/worlds\/([^/]+)\/?$/);
  if(match){try{const id=decodeURIComponent(match[1]);if(id&&id.length<=450&&!/[\\/\u0000]/.test(id))return{screen:'worlds',conversationId:id};}catch{/* malformed link */}}
  return{screen:'missing'};
}
export function routePath(route:MobileRoute):string {
  return route.screen==='discover'?'/':route.screen==='profile'?'/profile/alex':route.screen==='worlds'?`/worlds/${encodeURIComponent(route.conversationId)}`:'/not-found';
}
