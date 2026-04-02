import {
  CONSENT_COOKIE_NAME,
  CONSENT_STORAGE_KEY,
  CONSENT_VALUE_ANALYTICS,
} from "@/lib/consent/constants";

/** Inline gtag bootstrap: Consent Mode v2 defaults + conditional grant + gtag config. */
export function gtagConsentBootstrapScript(gaId: string): string {
  return `(function(){
var GA_ID=${JSON.stringify(gaId)};
window.dataLayer=window.dataLayer||[];
function gtag(){dataLayer.push(arguments);}
window.gtag=gtag;
gtag('consent','default',{
  ad_storage:'denied',
  analytics_storage:'denied',
  ad_user_data:'denied',
  ad_personalization:'denied',
  wait_for_update:500
});
var granted=false;
try{
  if(localStorage.getItem(${JSON.stringify(CONSENT_STORAGE_KEY)})===${JSON.stringify(CONSENT_VALUE_ANALYTICS)})granted=true;
}catch(e){}
if(!granted){
  try{
    var parts=document.cookie.split(';');
    for(var i=0;i<parts.length;i++){
      var seg=parts[i].trim();
      var eq=seg.indexOf('=');
      if(eq===-1)continue;
      if(seg.slice(0,eq)!==${JSON.stringify(CONSENT_COOKIE_NAME)})continue;
      var val=decodeURIComponent(seg.slice(eq+1).trim());
      if(val===${JSON.stringify(CONSENT_VALUE_ANALYTICS)}){granted=true;break;}
    }
  }catch(e){}
}
if(granted){
  gtag('consent','update',{
    analytics_storage:'granted',
    ad_storage:'denied',
    ad_user_data:'denied',
    ad_personalization:'denied'
  });
}
gtag('js',new Date());
gtag('config',GA_ID);
})();`;
}
