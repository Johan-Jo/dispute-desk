/**
 * Render the /test Open Graph social card at native 1200×630 (design DP-OG-01).
 *
 * The card is drawn with HTML/CSS/SVG (React via CDN) and screenshotted by
 * Playwright — so it's a crisp native render, not an upscaled export. Run after
 * editing the card design:
 *
 *   node scripts/render-og-test-card.mjs
 *
 * Output: public/og/test-og-card.png (1200×630). Requires network access for
 * the React/Babel CDN + Google Fonts, and a Playwright chromium install.
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "og", "test-og-card.png");

const HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,400;0,600;0,700;1,400;1,600&family=Inter:wght@400;600;700&family=Spline+Sans+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style> html,body{margin:0;padding:0;background:#fff;} *{box-sizing:border-box;} </style></head>
<body><div id="stage"></div>
<script src="https://unpkg.com/react@18.3.1/umd/react.development.js"></script>
<script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js"></script>
<script type="text/babel">
const C={bg0:"#0f172a",bg1:"#1e293b",bg2:"#334155",cream:"#f4eee2",dim:"rgba(244,238,226,0.74)",faint:"rgba(244,238,226,0.5)",blue4:"#60a5fa",wax:"#8a2a1f",serif:"'Crimson Pro',Georgia,serif",sans:"'Inter',sans-serif",mono:"'Spline Sans Mono',monospace"};
function Shield({size=40,color="#fff",stroke=9,check=true}){return(<svg width={size} height={size} viewBox="0 0 100 104" fill="none" style={{display:"block"}}><path d="M50 5 L88 19 C88 19 88 52 88 56 C88 80 71 95 50 101 C29 95 12 80 12 56 C12 52 12 19 12 19 Z" stroke={color} strokeWidth={stroke} fill="none" strokeLinejoin="round"/>{check&&<path d="M34 53 L45 65 L68 39" stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeLinejoin="round"/>}</svg>);}
function Gauge({size=300,value=0.82,max=1.5,danger=0.9}){
  const cx=size/2,cy=size/2,r=size*0.40,start=150,sweep=240;
  const xy=(d,rad)=>{const a=d*Math.PI/180;return[cx+rad*Math.cos(a),cy+rad*Math.sin(a)];};
  const arc=(f,t,rad)=>{const[x1,y1]=xy(f,rad),[x2,y2]=xy(t,rad);const lg=(t-f)>180?1:0;return \`M \${x1} \${y1} A \${rad} \${rad} 0 \${lg} 1 \${x2} \${y2}\`;};
  const vd=start+(Math.min(value,max)/max)*sweep,dd=start+(danger/max)*sweep;const[nx,ny]=xy(vd,r-14);
  return(<svg width={size} height={size} viewBox={\`0 0 \${size} \${size}\`} fill="none">
    <path d={arc(start,dd,r)} stroke="rgba(96,165,250,0.4)" strokeWidth="13" strokeLinecap="round"/>
    <path d={arc(dd,start+sweep,r)} stroke={C.wax} strokeWidth="13" strokeLinecap="round"/>
    {(()=>{const[a1,b1]=xy(dd,r-22),[a2,b2]=xy(dd,r+22);return<line x1={a1} y1={b1} x2={a2} y2={b2} stroke={C.cream} strokeWidth="3"/>;})()}
    <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={C.cream} strokeWidth="5" strokeLinecap="round"/>
    <circle cx={cx} cy={cy} r="11" fill={C.cream}/>
  </svg>);
}
function OG(){return(
  <div style={{width:1200,height:630,position:"relative",overflow:"hidden",background:\`linear-gradient(150deg,\${C.bg0} 0%,\${C.bg1} 54%,\${C.bg2} 100%)\`,fontFamily:C.sans,color:C.cream,display:"flex",alignItems:"center"}}>
    <div style={{position:"absolute",inset:0,opacity:0.5,backgroundImage:"radial-gradient(rgba(244,238,226,0.05) 1.4px,transparent 1.4px)",backgroundSize:"28px 28px"}}/>
    <div style={{position:"absolute",inset:34,border:"1px solid rgba(244,238,226,0.16)"}}/>
    <div style={{position:"relative",flex:1,padding:"0 0 0 80px",maxWidth:680}}>
      <div style={{fontFamily:C.mono,fontSize:18,letterSpacing:"0.18em",textTransform:"uppercase",color:C.blue4,display:"flex",alignItems:"center",gap:14,marginBottom:26}}>
        <span style={{width:40,height:1,background:"currentColor",opacity:0.6}}/>Free 5-minute test</div>
      <h1 style={{fontFamily:C.serif,fontWeight:600,fontSize:62,lineHeight:1.02,letterSpacing:"-0.02em",margin:0,color:C.cream}}>
        Was that chargeback<br/><em style={{fontStyle:"italic",color:C.blue4}}>actually winnable?</em></h1>
      <p style={{fontSize:25,lineHeight:1.4,color:C.dim,marginTop:24,maxWidth:560}}>
        Answer 6 questions about one dispute. Get an instant verdict — plus where your chargeback ratio really sits.</p>
      <div style={{position:"absolute",left:80,bottom:-150,display:"flex",alignItems:"center",gap:13}}>
        <Shield size={36} color={C.cream}/><span style={{fontFamily:C.mono,fontSize:17,letterSpacing:"0.12em",color:C.faint}}>DISPUTEDESK</span></div>
    </div>
    <div style={{position:"relative",width:430,height:630,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <Gauge size={360} value={0.8}/></div>
  </div>
);}
const stage=document.getElementById("stage");stage.style.width="1200px";stage.style.height="630px";
ReactDOM.createRoot(stage).render(React.createElement(OG));
window.__rendered=true;
</script>
</body></html>`;

const tmp = join(tmpdir(), "dd-og-test-card.html");
writeFileSync(tmp, HTML, "utf8");
mkdirSync(dirname(OUT), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1, // exact 1200×630 output (the canonical OG size)
});
await page.goto(`file://${tmp}`, { waitUntil: "networkidle" });
// Wait for Babel to transform + React to mount, then for webfonts to paint.
await page.waitForFunction(() => window.__rendered === true, { timeout: 30000 });
await page.waitForFunction(() => document.fonts.ready.then(() => true), { timeout: 30000 });
await page.waitForTimeout(600);

await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
console.log(`[og] wrote ${OUT}`);
