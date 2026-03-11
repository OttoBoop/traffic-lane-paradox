(function(global){

const WBASE=13, MAX_ST=0.40, CAR_L=22, CAR_W=13;
const IDM_A=0.08, IDM_B=0.12, IDM_S0=6, IDM_T=2;
const LOOK=80, DET_W=6, PATH_SP=4, V0_DEF=2.2;
const ZONE_APPROACH=60, ZONE_CROSS_THRESH=CAR_W+8;
const WALL_STEER_DIST=CAR_W/2+6;
const WALL_BRAKE_DIST=CAR_W/2+2;
const CONE_IMMED_LEN=CAR_L+4;
const CONE_LOOK_LEN=40;
const CONE_MARGIN=2;
const REVERSE_SPD=0.4, REVERSE_STUCK_THRESH=80;
const BLINKER_MIN=20, BLINKER_TIMEOUT=120;
const SPAWN_SPACING=CAR_L+IDM_S0+8;
const MOBIL_SAFE_GAP=CAR_L*1.5;
const MOBIL_MANEUVER_GAP=CAR_L*0.5;
const PROJ_MARGIN=2;
const PROJ_BROAD_PHASE=60;
const INTERSECT_WIDEN=1.3;
const COMMIT_DIST=90;
const BATCH_APPROACH_DIST=COMMIT_DIST+80;
const EXIT_CLEARANCE=CAR_L*2;
const MAX_BATCH_SIZE=2;
const BATCH_HOLD_TICKS=24;
const NO_PROGRESS_THRESH=60;
const PROGRESS_RESUME_THRESH=20;
const PROGRESS_EPS=0.35;
const LANE_LOAD_LOOKAHEAD=150;

function mkRng(s){s|=0;return()=>{s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}

const V={len:v=>Math.hypot(v.x,v.y),dot:(a,b)=>a.x*b.x+a.y*b.y,sub:(a,b)=>({x:a.x-b.x,y:a.y-b.y}),
  add:(a,b)=>({x:a.x+b.x,y:a.y+b.y}),scale:(v,s)=>({x:v.x*s,y:v.y*s}),
  norm:v=>{const l=Math.hypot(v.x,v.y)||1;return{x:v.x/l,y:v.y/l};}};

function idm(v,v0,gap,dv){
  const ss=IDM_S0+Math.max(0,v*IDM_T+v*dv/(2*Math.sqrt(IDM_A*IDM_B)));
  return IDM_A*(1-Math.pow(v/Math.max(v0,0.01),4)-Math.pow(ss/Math.max(gap,0.1),2));
}

function toLocal(wx,wy,cx,cy,cth){
  const dx=wx-cx,dy=wy-cy;
  return{fwd:dx*Math.cos(cth)+dy*Math.sin(cth), lat:-dx*Math.sin(cth)+dy*Math.cos(cth)};
}

function coneHitsOBB(cx,cy,cth,fwdMin,fwdMax,halfW, ox,oy,oth){
  const hl=CAR_L/2,hw=CAR_W/2;
  const co=Math.cos(oth),so=Math.sin(oth);
  const oCorners=[
    {x:ox+co*hl-so*hw,y:oy+so*hl+co*hw},{x:ox+co*hl+so*hw,y:oy+so*hl-co*hw},
    {x:ox-co*hl+so*hw,y:oy-so*hl-co*hw},{x:ox-co*hl-so*hw,y:oy-so*hl+co*hw}
  ];
  for(let i=0;i<4;i++) oCorners[i]=toLocal(oCorners[i].x,oCorners[i].y,cx,cy,cth);
  let oMinF=1e9,oMaxF=-1e9,oMinL=1e9,oMaxL=-1e9;
  for(const c of oCorners){
    if(c.fwd<oMinF)oMinF=c.fwd;if(c.fwd>oMaxF)oMaxF=c.fwd;
    if(c.lat<oMinL)oMinL=c.lat;if(c.lat>oMaxL)oMaxL=c.lat;
  }
  return oMaxF>=fwdMin && oMinF<=fwdMax && oMaxL>=-halfW && oMinL<=halfW;
}

function coneCheck(c,o){
  const dist=Math.hypot(o.x-c.x,o.y-c.y);
  if(dist>LOOK+CAR_L)return null;
  const loc=toLocal(o.x,o.y,c.x,c.y,c.th);
  if(loc.fwd<-CAR_L)return null;

  const immedHW=CAR_W/2+CONE_MARGIN;
  const lookLen=Math.max(CONE_LOOK_LEN,Math.abs(c.speed)*18);
  const lookHW=CAR_W/2+CONE_MARGIN+Math.abs(c.speed)*3;

  const imminent=coneHitsOBB(c.x,c.y,c.th, CAR_L/2,CAR_L/2+CONE_IMMED_LEN,immedHW, o.x,o.y,o.th);
  const lookahead=!imminent && coneHitsOBB(c.x,c.y,c.th, CAR_L/2,CAR_L/2+lookLen,lookHW, o.x,o.y,o.th);

  if(!imminent&&!lookahead)return null;
  return{imminent,lookahead,fwd:loc.fwd,lat:loc.lat};
}

function rearConeCheck(c,o){
  const loc=toLocal(o.x,o.y,c.x,c.y,c.th);
  if(loc.fwd>CAR_L/2)return false;
  const rearDist=-loc.fwd-CAR_L/2;
  if(rearDist<0||rearDist>CAR_L*2)return false;
  return Math.abs(loc.lat)<CAR_W/2+CONE_MARGIN;
}

function satOverlap(a,b){
  const corners=(x,y,th)=>{const c=Math.cos(th),s=Math.sin(th),hl=CAR_L/2,hw=CAR_W/2;
    return[{x:x+c*hl-s*hw,y:y+s*hl+c*hw},{x:x+c*hl+s*hw,y:y+s*hl-c*hw},{x:x-c*hl+s*hw,y:y-s*hl-c*hw},{x:x-c*hl-s*hw,y:y-s*hl+c*hw}];};
  const cA=corners(a.x,a.y,a.th),cB=corners(b.x,b.y,b.th);
  const axes=[{x:Math.cos(a.th),y:Math.sin(a.th)},{x:-Math.sin(a.th),y:Math.cos(a.th)},{x:Math.cos(b.th),y:Math.sin(b.th)},{x:-Math.sin(b.th),y:Math.cos(b.th)}];
  for(const ax of axes){
    let aMin=1e9,aMax=-1e9,bMin=1e9,bMax=-1e9;
    for(const c of cA){const p=c.x*ax.x+c.y*ax.y;if(p<aMin)aMin=p;if(p>aMax)aMax=p;}
    for(const c of cB){const p=c.x*ax.x+c.y*ax.y;if(p<bMin)bMin=p;if(p>bMax)bMax=p;}
    if(aMax<=bMin||bMax<=aMin)return false;
  }
  return true;
}

function carCorners(x,y,th,margin){
  const c=Math.cos(th),s=Math.sin(th),hl=CAR_L/2+(margin||0),hw=CAR_W/2+(margin||0);
  return[{x:x+c*hl-s*hw,y:y+s*hl+c*hw},{x:x+c*hl+s*hw,y:y+s*hl-c*hw},
    {x:x-c*hl+s*hw,y:y-s*hl-c*hw},{x:x-c*hl-s*hw,y:y-s*hl+c*hw}];
}

function satOverlapMargin(ax,ay,ath, bx,by,bth, margin){
  const cA=carCorners(ax,ay,ath,margin),cB=carCorners(bx,by,bth,margin);
  const axes=[{x:Math.cos(ath),y:Math.sin(ath)},{x:-Math.sin(ath),y:Math.cos(ath)},
    {x:Math.cos(bth),y:Math.sin(bth)},{x:-Math.sin(bth),y:Math.cos(bth)}];
  for(const ax2 of axes){
    let aMin=1e9,aMax=-1e9,bMin=1e9,bMax=-1e9;
    for(const c of cA){const p=c.x*ax2.x+c.y*ax2.y;if(p<aMin)aMin=p;if(p>aMax)aMax=p;}
    for(const c of cB){const p=c.x*ax2.x+c.y*ax2.y;if(p<bMin)bMin=p;if(p>bMax)bMax=p;}
    if(aMax<=bMin||bMax<=aMin)return false;
  }
  return true;
}

function pathQuery(path,x,y,hint){
  const lo=Math.max(0,(hint||0)-8),hi=Math.min(path.length-1,(hint||0)+30);
  let bi=hint||0,bd=1e9;for(let i=lo;i<=hi;i++){const d=Math.hypot(path[i].x-x,path[i].y-y);if(d<bd){bd=d;bi=i;}}
  if(bd>30){for(let i=0;i<path.length;i++){const d=Math.hypot(path[i].x-x,path[i].y-y);if(d<bd){bd=d;bi=i;}}}
  let ti;if(bi===0)ti=1;else if(bi>=path.length-1)ti=path.length-2;
  else ti=Math.hypot(path[bi-1].x-x,path[bi-1].y-y)<Math.hypot(path[bi+1].x-x,path[bi+1].y-y)?bi-1:bi+1;
  const a=Math.min(bi,ti),b=Math.max(bi,ti),sx=path[b].x-path[a].x,sy=path[b].y-path[a].y,sl=Math.max(Math.hypot(sx,sy),0.01);
  const t=Math.max(0,Math.min(1,((x-path[a].x)*sx+(y-path[a].y)*sy)/(sl*sl)));
  return{px:path[a].x+sx*t,py:path[a].y+sy*t,ang:Math.atan2(sy,sx),idx:bi};}

class Road{
  constructor(n,w,h){
    this.n=n;this.w=w;this.h=h;this.cx=w/2;
    this.lw=n===1?22:Math.max(22,Math.min(26,(w*0.92)/Math.max(n,1)));
    this.forkY=h*0.50;this.stopY=h*0.72;this.entryY=h+90;
    this.mainLen=this.entryY-this.forkY;
    const sp=Math.min(w*0.44,200);
    this.lEnd={x:this.cx-sp,y:8};this.rEnd={x:this.cx+sp,y:8};
    const cd=(this.forkY-8)*0.55;
    this.lCP={x:this.cx-sp*0.5,y:this.forkY-cd};this.rCP={x:this.cx+sp*0.5,y:this.forkY-cd};
    this._genPaths();this._genBranchExtents();this._genConflictZones();this._genBoundary();
  }
  halfW(){return this.n*this.lw/2;}
  izoneTop(){return this.forkY-20;}
  izoneBot(){return this.forkY+40;}
  halfWAt(y){
    const top=this.izoneTop(),bot=this.izoneBot();
    if(y>bot||y<top)return this.halfW();
    const mid=(top+bot)/2;
    const t=1-Math.abs(y-mid)/((bot-top)/2);
    const smooth=t*t*(3-2*t);
    return this.halfW()*(1+(INTERSECT_WIDEN-1)*smooth);
  }
  laneX(i){return this.cx+(i-(this.n-1)/2)*this.lw;}
  bPt(br,t){const e=br==='left'?this.lEnd:this.rEnd,c=br==='left'?this.lCP:this.rCP,u=1-t;
    return{x:u*u*this.cx+2*u*t*c.x+t*t*e.x,y:u*u*this.forkY+2*u*t*c.y+t*t*e.y,
      angle:Math.atan2(2*u*(c.y-this.forkY)+2*t*(e.y-c.y),2*u*(c.x-this.cx)+2*t*(e.x-c.x))};}

  _genPaths(){
    this.fullPaths={};this.pathKeys=[];
    for(let i=0;i<this.n;i++){
      for(const br of['left','right']){
        const pts=[],lx=this.laneX(i);
        for(let y=this.entryY;y>=this.forkY;y-=PATH_SP)pts.push({x:lx,y});
        const startX=lx,startY=this.forkY;
        const brEnd=br==='left'?this.lEnd:this.rEnd,brCP=br==='left'?this.lCP:this.rCP;
        const endAng=Math.atan2(brEnd.y-brCP.y,brEnd.x-brCP.x),endPerp=endAng-Math.PI/2;
        const bOff=-((i-(this.n-1)/2)*this.lw);
        const endX=brEnd.x+Math.cos(endPerp)*bOff,endY=brEnd.y+Math.sin(endPerp)*bOff;
        const dist=Math.hypot(endX-startX,endY-startY),cpDist=dist*0.45;
        const cp1x=startX,cp1y=startY-cpDist;
        const cp2x=endX-Math.cos(endAng)*cpDist,cp2y=endY-Math.sin(endAng)*cpDist;
        for(let s=1;s<=60;s++){const t=s/60,u=1-t;
          pts.push({x:u*u*u*startX+3*u*u*t*cp1x+3*u*t*t*cp2x+t*t*t*endX,
                    y:u*u*u*startY+3*u*u*t*cp1y+3*u*t*t*cp2y+t*t*t*endY});}
        const key=i+'-'+br;this.fullPaths[key]=pts;this.pathKeys.push(key);
      }
    }
  }

  _genBranchExtents(){
    this.branchHW={left:[],right:[]};
    const samples=50;
    for(const br of['left','right']){
      for(let si=0;si<=samples;si++){
        const t=si/samples;
        const bp=this.bPt(br,t);
        const perpAngle=bp.angle-Math.PI/2;
        const pc=Math.cos(perpAngle),ps=Math.sin(perpAngle);
        let maxExt=this.halfW();
        for(const key of this.pathKeys){
          if(!key.endsWith(br))continue;
          const path=this.fullPaths[key];
          let bestI=0,bestDy=1e9;
          for(let i=0;i<path.length;i++){
            const dy=Math.abs(path[i].y-bp.y);
            if(dy<bestDy){bestDy=dy;bestI=i;}
          }
          const pp=path[bestI];
          const ext=Math.abs((pp.x-bp.x)*pc+(pp.y-bp.y)*ps)+this.lw/2;
          if(ext>maxExt)maxExt=ext;
        }
        this.branchHW[br].push(maxExt);
      }
    }
  }
  branchHalfW(br,t){
    const arr=this.branchHW[br];
    const fi=t*(arr.length-1);
    const lo=Math.floor(fi),hi=Math.min(lo+1,arr.length-1);
    const frac=fi-lo;
    return arr[lo]*(1-frac)+arr[hi]*frac;
  }

  _genConflictZones(){
    this.conflictZones=[];const rawZones=[];
    for(let a=0;a<this.pathKeys.length;a++){
      for(let b=a+1;b<this.pathKeys.length;b++){
        const kA=this.pathKeys[a],kB=this.pathKeys[b];
        const lA=parseInt(kA),bA=kA.split('-')[1],lB=parseInt(kB),bB=kB.split('-')[1];
        if(lA===lB||bA===bB)continue;
        const pA=this.fullPaths[kA],pB=this.fullPaths[kB];
        const fi=Math.floor((this.entryY-this.forkY)/PATH_SP);
        const s0=Math.max(0,fi-10),s1=Math.min(Math.min(pA.length,pB.length)-1,fi+25);
        let minD=1e9,bIA=0,bIB=0;
        for(let ia=s0;ia<=s1;ia++)for(let ib=s0;ib<=s1;ib++){
          const d=Math.hypot(pA[ia].x-pB[ib].x,pA[ia].y-pB[ib].y);if(d<minD){minD=d;bIA=ia;bIB=ib;}}
        if(minD<ZONE_CROSS_THRESH)rawZones.push({pathA:kA,pathB:kB,idxA:bIA,idxB:bIB,
          x:(pA[bIA].x+pB[bIB].x)/2,y:(pA[bIA].y+pB[bIB].y)/2,radius:Math.max(minD/2+CAR_L,CAR_L+4)});
      }
    }
    if(!rawZones.length)return;
    const used=new Set();
    for(let i=0;i<rawZones.length;i++){
      if(used.has(i))continue;const group=[rawZones[i]];used.add(i);
      for(let j=i+1;j<rawZones.length;j++){if(used.has(j))continue;
        if(Math.hypot(rawZones[i].x-rawZones[j].x,rawZones[i].y-rawZones[j].y)<30){group.push(rawZones[j]);used.add(j);}}
      let cx=0,cy=0,maxR=0;const pc=new Map();
      for(const z of group){cx+=z.x;cy+=z.y;maxR=Math.max(maxR,z.radius);
        if(!pc.has(z.pathA))pc.set(z.pathA,z.idxA);if(!pc.has(z.pathB))pc.set(z.pathB,z.idxB);}
      this.conflictZones.push({
        x:cx/group.length,y:cy/group.length,radius:maxR+5,paths:pc,holder:null,
        activeBatchId:null,activeBatchTarget:null,batchMembers:[],batchExpireTick:0,
        starveTicksLeft:0,starveTicksRight:0,downstreamClearanceByTarget:{left:1e9,right:1e9},
        schedulerEnabled:false
      });
    }
  }

  _genBoundary(){
    this.boundary=[];const hw=this.halfW();
    const yTop=this.izoneTop(),yBot=this.izoneBot();
    this.boundary.push({a:{x:this.cx-hw,y:this.entryY},b:{x:this.cx-hw,y:yBot},n:{x:1,y:0},seg:'main'});
    this.boundary.push({a:{x:this.cx+hw,y:yBot},b:{x:this.cx+hw,y:this.entryY},n:{x:-1,y:0},seg:'main'});
    const izSteps=8;
    for(let s=0;s<izSteps;s++){
      const y0=yBot-(yBot-yTop)*s/izSteps, y1=yBot-(yBot-yTop)*(s+1)/izSteps;
      const hw0=this.halfWAt(y0), hw1=this.halfWAt(y1);
      this.boundary.push({a:{x:this.cx-hw0,y:y0},b:{x:this.cx-hw1,y:y1},n:{x:1,y:0},seg:'main'});
      this.boundary.push({a:{x:this.cx+hw1,y:y1},b:{x:this.cx+hw0,y:y0},n:{x:-1,y:0},seg:'main'});
    }
    for(const br of['left','right']){
      for(let side=-1;side<=1;side+=2){
        const pts=[];for(let i=0;i<=30;i++){const t=i/30,bp=this.bPt(br,t),pr=bp.angle-Math.PI/2;
          pts.push({x:bp.x+Math.cos(pr)*(side*hw),y:bp.y+Math.sin(pr)*(side*hw)});}
        for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy)||1;
          let nx=dy/l,ny=-dx/l;const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},bp=this.bPt(br,i/30);
          if((bp.x-mid.x)*nx+(bp.y-mid.y)*ny<0){nx=-nx;ny=-ny;}
          this.boundary.push({a,b,n:{x:nx,y:ny},seg:br});}
      }
    }
  }
  nearestBoundary(x,y,segFilter){
    let bd=1e9,bs=null;
    for(const seg of this.boundary){if(segFilter&&seg.seg!==segFilter)continue;
      const dx=seg.b.x-seg.a.x,dy=seg.b.y-seg.a.y,l2=dx*dx+dy*dy;if(l2<0.01)continue;
      let t=((x-seg.a.x)*dx+(y-seg.a.y)*dy)/l2;t=Math.max(0,Math.min(1,t));
      const d=Math.hypot(x-(seg.a.x+t*dx),y-(seg.a.y+t*dy));if(d<bd){bd=d;bs=seg;}}
    return{dist:bd,seg:bs};
  }
}

class Car{
  constructor(id,x,y,th,lane,target,tb){
    this.id=id;this.x=x;this.y=y;this.th=th;this.speed=0;this.steer=0;
    this.lane=lane;this.target=target;this.done=false;this.seg='main';
    this.tiebreak=tb;this.path=null;this.pathKey='';this.pathIdx=0;this.prevCTE=0;
    this.trafficMode='free';this.noProgressTicks=0;this.lastProgress=0;
    this.blockingKind='none';this.plannerMode='nominal';
    this._lastTrafficMode='free';
    this.commitUntilFork=false;this.batchId=null;this.batchTarget='';this.primaryBlockerId=null;
    this.progressResumeTicks=0;this.commitLaneChanges=0;
    this.spillbackTicks=0;this.spillbackFlag=false;
    this.zoneYielding=false;
    this.blinker=0;this.blinkerTimer=0;this.merging=false;this.mobilTimer=0;
    this.stuckTicks=0;this.reversing=false;
    this.maneuvering=false;this.maneuverPhase=0;this.maneuverTimer=0;
    this.maneuverPerpDir={x:0,y:0};
    this.prioritySignal=false;
    this.desSpd=0;this.desSt=0;
    this.color=target==='left'?'#c48828':'#2888c4';
  }
}

class Sim{
  constructor(nL,nC,splitPct,seed){
    this.nL=nL;this.nC=nC;this.splitPct=splitPct;this.seed=seed;
    this.road=null;this.cars=[];this.ticks=0;
    this.running=this.started=this.finished=false;this.finishTick=0;this.satCount=0;
    this.nextBatchId=1;this.maxBatchSizeSeen=0;this.spillbackViolations=0;this.maxStarveTicks=0;
    this.maneuverTriggerCount=0;this.commitOscillationCount=0;this.plannerIllegalCount=0;
    this.yieldEntryCount=0;this.holdExitEntryCount=0;this.batchEntryCount=0;
  }
  init(w,h){
    this.road=new Road(this.nL,w,h);this.cars=[];this.ticks=0;
    this.running=this.started=this.finished=false;this.finishTick=0;this.satCount=0;
    this.nextBatchId=1;this.maxBatchSizeSeen=0;this.spillbackViolations=0;this.maxStarveTicks=0;
    this.maneuverTriggerCount=0;this.commitOscillationCount=0;this.plannerIllegalCount=0;
    this.yieldEntryCount=0;this.holdExitEntryCount=0;this.batchEntryCount=0;
    const R=mkRng(this.seed),n=this.nC,nL=Math.round(n*this.splitPct/100);
    const tg=[];for(let i=0;i<n;i++)tg.push(i<nL?'left':'right');
    for(let i=n-1;i>0;i--){const j=Math.floor(R()*(i+1));[tg[i],tg[j]]=[tg[j],tg[i]];}
    const perL=new Array(this.nL).fill(0),rd=this.road;
    for(let i=0;i<n;i++){
      const lane=i%this.nL,lx=rd.laneX(lane),yPos=rd.stopY+(perL[lane]+1)*SPAWN_SPACING;
      const c=new Car(i,lx,yPos,-Math.PI/2,lane,tg[i],(R()-0.5));
      c.mobilTimer=Math.floor(R()*20);
      c.pathKey=lane+'-'+c.target;c.path=rd.fullPaths[c.pathKey];
      c.pathIdx=pathQuery(c.path,c.x,c.y,0).idx;
      c.lastProgress=c.pathIdx*PATH_SP;
      this.cars.push(c);perL[lane]++;
    }
  }
  start(){this.started=this.running=true;}

  tick(dt,P){
    if(!this.running||this.finished)return;
    const maxStep=1.0;
    if(dt>maxStep){
      let remaining=dt;
      while(remaining>0.01){const step=Math.min(remaining,maxStep);this._tickStep(step,P);remaining-=step;}
      return;
    }
    this._tickStep(dt,P);
  }

  _tickStep(dt,P){
    if(!this.running||this.finished)return;
    this.ticks+=dt;
    const rd=this.road,active=this.cars.filter(c=>!c.done),mains=active.filter(c=>c.seg==='main');

    for(const c of active){
      const pq0=pathQuery(c.path,c.x,c.y,c.pathIdx);
      const progress=pq0.idx*PATH_SP;
      const delta=progress-(c.lastProgress||progress);
      c.pathIdx=pq0.idx;c._pq=pq0;
      c._progress=progress;c._progressDelta=delta;
      c.stuckTicks=c.noProgressTicks;
      c.batchId=null;c.batchTarget='';c.primaryBlockerId=null;c.prioritySignal=false;c.zoneYielding=false;
      c.blockingKind='none';c.plannerMode='nominal';
      if(c.seg==='main'){
        let best=0,bd=1e9;
        for(let i=0;i<this.nL;i++){const d=Math.abs(c.x-rd.laneX(i));if(d<bd){bd=d;best=i;}}
        c.lane=best;
        if(c.y-rd.forkY<=COMMIT_DIST)c.commitUntilFork=true;
      }else{
        c.commitUntilFork=false;c.noProgressTicks=0;c.progressResumeTicks=0;c.trafficMode='free';
        c.maneuvering=false;c.spillbackTicks=0;c.spillbackFlag=false;
      }
      c.lastProgress=progress;
    }

    if(this.started){
      for(const c of mains){
        if(c.merging||c.reversing||c.maneuvering)continue;
        c.mobilTimer-=dt;
        if(c.mobilTimer<=0){c.mobilTimer=14+Math.random()*8;this._mobil(c,mains,P);}
      }
      this._updateBatchScheduler(active,rd);
    }else{
      for(const zone of rd.conflictZones){
        zone.activeBatchId=null;zone.activeBatchTarget=null;zone.batchMembers=[];zone.batchExpireTick=0;
        zone.downstreamClearanceByTarget.left=1e9;zone.downstreamClearanceByTarget.right=1e9;
      }
    }

    for(const c of mains)c.trafficMode=c.commitUntilFork?'commit':'free';
    for(const zone of rd.conflictZones)this._assignBatchStates(active,zone,rd);

    for(const c of mains){
      const blockInfo=this._classifyBlocker(c,active,rd,dt);
      const blocker=blockInfo.blocker;
      c.primaryBlockerId=blocker?blocker.id:null;
      c.blockingKind=blockInfo.kind;
      c.plannerMode=(blockInfo.kind==='conflict'||blockInfo.kind==='wall'||c.maneuvering||c.merging||c.trafficMode==='yield'||c.trafficMode==='hold_exit'||c.trafficMode==='batch')?'traffic':'nominal';
      const forwardIntent=Math.max(c.speed,c.desSpd||0);
      const blockedForProgress=blockInfo.kind==='conflict'||blockInfo.kind==='wall'||c.trafficMode==='yield'||c.trafficMode==='hold_exit';
      if(this.started&&blockedForProgress&&forwardIntent>0.15&&c._progressDelta<PROGRESS_EPS)c.noProgressTicks+=dt;
      else c.noProgressTicks=Math.max(0,c.noProgressTicks-dt*2);
      if(c._progressDelta>=PROGRESS_EPS)c.progressResumeTicks+=dt;
      else c.progressResumeTicks=0;

      if(c.trafficMode!==c._lastTrafficMode){
        if(c.trafficMode==='yield')this.yieldEntryCount++;
        if(c.trafficMode==='hold_exit')this.holdExitEntryCount++;
        if(c.trafficMode==='batch')this.batchEntryCount++;
        c._lastTrafficMode=c.trafficMode;
      }

      if((c.trafficMode==='yield'||c.trafficMode==='hold_exit')&&blocker){
        const dx=blocker.x-c.x,dy=blocker.y-c.y;
        const lat=-dx*Math.sin(c.th)+dy*Math.cos(c.th);
        const perpAngle=c.th+(lat>=0?-Math.PI/2:Math.PI/2);
        c.maneuverPerpDir={x:Math.cos(perpAngle),y:Math.sin(perpAngle)};
      }else if(!c.maneuvering){
        const laneCenter=rd.laneX(c.lane),sign=c.x>laneCenter?1:-1,perpAngle=c.th+Math.PI/2;
        c.maneuverPerpDir={x:Math.cos(perpAngle)*sign,y:Math.sin(perpAngle)*sign};
      }

      if(!c.maneuvering&&blockedForProgress&&c.noProgressTicks>=NO_PROGRESS_THRESH&&c.trafficMode!=='batch'){
        c.maneuvering=true;c.trafficMode='maneuver';c.maneuverTimer=0;c.progressResumeTicks=0;
        c.plannerMode='traffic';
        this.maneuverTriggerCount++;
      }

      if(c.maneuvering){
        c.maneuverTimer+=dt;
        let pathClear=true;
        for(const o of active){
          if(o.id===c.id||o.done||!o.maneuvering)continue;
          const hit=coneCheck(c,o);
          if(hit&&hit.imminent){pathClear=false;break;}
        }
        if(c.progressResumeTicks>=PROGRESS_RESUME_THRESH&&c.trafficMode!=='yield'&&c.trafficMode!=='hold_exit'&&pathClear){
          c.maneuvering=false;c.maneuverTimer=0;c.noProgressTicks=0;c.progressResumeTicks=0;
          let bestKey='',bestDist=1e9;
          for(const key of rd.pathKeys){
            if(!key.endsWith(c.target))continue;
            const path=rd.fullPaths[key];
            const pq2=pathQuery(path,c.x,c.y,0);
            const d=Math.hypot(pq2.px-c.x,pq2.py-c.y);
            if(d<bestDist){bestDist=d;bestKey=key;}
          }
          if(bestKey){
            c.pathKey=bestKey;c.path=rd.fullPaths[bestKey];
            c.pathIdx=pathQuery(c.path,c.x,c.y,0).idx;c.lastProgress=c.pathIdx*PATH_SP;
            c.lane=parseInt(bestKey);
          }
        }else{
          c.trafficMode='maneuver';
        }
      }
    }

    for(const c of active){
      const pq=pathQuery(c.path,c.x,c.y,c.pathIdx);c.pathIdx=pq.idx;c._pq=pq;
      let hErr=pq.ang-c.th;while(hErr>Math.PI)hErr-=2*Math.PI;while(hErr<-Math.PI)hErr+=2*Math.PI;
      const cte=Math.cos(pq.ang)*(c.y-pq.py)-Math.sin(pq.ang)*(c.x-pq.px);
      const dCTE=cte-c.prevCTE;c.prevCTE=cte;
      const dz=c.seg==='main'?0.8:0.3;
      c.desSt=(Math.abs(cte)<dz&&Math.abs(hErr)<0.03)?0:hErr-Math.atan2(0.7*cte,Math.abs(c.speed)+1)-0.3*dCTE;
    }

    for(const c of active){
      let gap=9999,dv=0;const ct=Math.cos(c.th),st=Math.sin(c.th);
      for(const o of active){if(o.id===c.id||o.done)continue;
        if(c.seg!==o.seg)continue;
        if(c.seg==='main'&&c.y<rd.forkY+50&&c.target!==o.target)continue;
        if(c.seg==='main'&&c.y<rd.forkY+50&&c.target===o.target&&c.lane!==o.lane){
          const ci=Math.min(c.pathIdx+8,c.path.length-1),oi=Math.min(o.pathIdx+8,o.path.length-1);
          if(Math.hypot(c.path[ci].x-o.path[oi].x,c.path[ci].y-o.path[oi].y)>CAR_W+4)continue;}
        const dx=o.x-c.x,dy=o.y-c.y,fwd=dx*ct+dy*st,lat=-dx*st+dy*ct;
        if(fwd>0&&fwd<LOOK&&Math.abs(lat)<DET_W){const g=fwd-CAR_L;if(g<gap){gap=g;dv=c.speed-o.speed;}}}
      if(c.seg==='main'&&!this.started){const sd=c.y-rd.stopY;if(sd>0&&sd-4<gap){gap=sd-4;dv=c.speed;}}
      c._gap=gap;
      gap=Math.max(gap,0.1);
      c.desSpd=c.speed+Math.max(idm(c.speed,this.started?P.v0:0,gap,dv),-IDM_B*4)*dt;
      c.desSpd=Math.max(0,Math.min(c.desSpd,P.v0*1.3));
    }

    for(const c of active){
      let coneBrake=1.0, coneSteer=0;
      for(const o of active){if(o.id===c.id||o.done)continue;
        if(c.seg!=='main'&&o.seg!=='main'&&c.seg!==o.seg)continue;
        if(c.seg==='main'&&o.seg!=='main')continue;
        if(c.seg!=='main'&&o.seg==='main')continue;
        if(Math.abs(c.th-o.th)<0.5)continue;
        if(c.seg==='main'&&o.seg==='main'){
          const myLaneCenter=rd.laneX(c.lane);
          const oLeft=o.x-CAR_W/2,oRight=o.x+CAR_W/2;
          const myLeft=myLaneCenter-rd.lw/2,myRight=myLaneCenter+rd.lw/2;
          if(!(oRight>myLeft&&oLeft<myRight))continue;
        }
        const hit=coneCheck(c,o);if(!hit)continue;
        if(hit.imminent){
          coneBrake=Math.min(coneBrake,0.2);
          if(Math.abs(hit.lat)>0.5)coneSteer+=(hit.lat>0?-1:1)*0.08;
        }else if(hit.lookahead){
          const urgency=1-Math.min(hit.fwd/(CONE_LOOK_LEN+CAR_L),1);
          coneBrake=Math.min(coneBrake,0.5+0.5*(1-urgency));
          if(Math.abs(hit.lat)>1)coneSteer+=(hit.lat>0?-1:1)*0.03*urgency;
        }
      }
      c.desSpd*=coneBrake;
      c.desSt+=coneSteer;
    }

    for(const c of active){
      const wallSeg=c.seg==='main'?'main':c.seg;
      const nb=rd.nearestBoundary(c.x,c.y,wallSeg);
      if(nb.dist<WALL_STEER_DIST&&nb.seg){
        const wallNx=nb.seg.n.x,wallNy=nb.seg.n.y;
        const wallLat=-wallNx*Math.sin(c.th)+wallNy*Math.cos(c.th);
        const steerAway=wallLat>0?-0.15:0.15;
        const blend=1-Math.max(0,Math.min(1,(nb.dist-WALL_BRAKE_DIST)/(WALL_STEER_DIST-WALL_BRAKE_DIST)));
        c.desSt+=steerAway*blend;
        if(nb.dist<WALL_BRAKE_DIST&&c.seg==='main'){
          c.desSpd*=Math.max(0.1,nb.dist/WALL_BRAKE_DIST);}
      }
    }

    for(const c of mains){
      let conflictProgress=null,targetClearance=1e9;
      for(const zone of rd.conflictZones){
        const zi=zone.paths.get(c.pathKey);
        if(zi===undefined)continue;
        conflictProgress=zi*PATH_SP;
        targetClearance=Math.min(targetClearance,zone.downstreamClearanceByTarget[c.target]??1e9);
        const dp=(zi-c.pathIdx)*PATH_SP;
        if(c.trafficMode==='yield'&&dp>0&&dp<BATCH_APPROACH_DIST){
          const gap=Math.max(dp,0.1);
          const brakeSpd=c.speed+Math.max(idm(c.speed,0,gap,c.speed),-IDM_B*4)*dt;
          c.desSpd=Math.min(c.desSpd,Math.max(0,brakeSpd));
        }
        if(c.trafficMode==='hold_exit'&&dp>0&&dp<BATCH_APPROACH_DIST){
          const gap=Math.max(dp-CAR_L*0.5,0.1);
          const brakeSpd=c.speed+Math.max(idm(c.speed,0,gap,c.speed),-IDM_B*5)*dt;
          c.desSpd=Math.min(c.desSpd,Math.max(0,brakeSpd));
        }
      }
      if(c.trafficMode==='batch'){
        c.desSpd=Math.max(c.desSpd,Math.min(P.v0,Math.max(c.speed,0.35)));
      }
      if(c.maneuvering){
        const perpAngle=Math.atan2(c.maneuverPerpDir.y,c.maneuverPerpDir.x);
        let steerToPerp=perpAngle-c.th;
        while(steerToPerp>Math.PI)steerToPerp-=2*Math.PI;
        while(steerToPerp<-Math.PI)steerToPerp+=2*Math.PI;
        const phase=Math.floor(c.maneuverTimer/20)%4;
        const perpSteer=Math.max(-MAX_ST,Math.min(MAX_ST,steerToPerp*0.8));
        if(phase===0||phase===2){
          c.desSt=phase===0?perpSteer:-perpSteer;
          c.desSpd=-REVERSE_SPD;
        }else{
          c.desSt=phase===1?-perpSteer:perpSteer;
          c.desSpd=Math.max(0.25,Math.min(c.desSpd,0.45));
        }
      }
      c._conflictProgress=conflictProgress;
      c._targetClearance=targetClearance;
    }

    for(const c of active){
      if(c.seg!=='main'&&c._gap>IDM_S0&&c.desSpd>0)c.desSpd=Math.max(c.desSpd,P.v0);
    }

    for(const c of active){
      c.desSt=Math.max(-MAX_ST,Math.min(MAX_ST,c.desSt));
      const stRate=0.06*dt;
      c.steer+=Math.max(-stRate,Math.min(stRate,c.desSt-c.steer));
      c.speed=c.desSpd;
    }

    // Commit only legal next poses. Cars never move into an illegal pose and then revert.
    const moveOrder=[...active].sort((a,b)=>this._movementPriority(b)-this._movementPriority(a));
    for(const c of moveOrder){
      const pose=this._chooseLegalMove(c,dt,rd,active);
      c.x=pose.x;c.y=pose.y;c.th=pose.th;c.speed=pose.speed;c.steer=pose.steer;
    }

    for(const c of active){
      if(Math.abs(c.speed)<0.5&&c.speed>=0&&c._pq){
        let hDiff=c._pq.ang-c.th;while(hDiff>Math.PI)hDiff-=2*Math.PI;while(hDiff<-Math.PI)hDiff+=2*Math.PI;
        c.th+=hDiff*0.03*dt;
      }
    }

    for(const c of active){
      if(c.seg==='main'){
        let hd=c.th-(-Math.PI/2);while(hd>Math.PI)hd-=2*Math.PI;while(hd<-Math.PI)hd+=2*Math.PI;
        if(Math.abs(hd)>0.8){c.th=-Math.PI/2+Math.sign(hd)*0.8;c.steer*=0.5;}
      }
    }

    for(const c of active){
      if(c.pathIdx>=c.path.length-3&&c.seg!=='main')c.done=true;
      if(c.seg==='main'&&c.y<=rd.forkY+5){
        c.seg=c.target;c.merging=false;c.blinker=0;c.maneuvering=false;
        c.commitUntilFork=false;c.batchId=null;c.batchTarget='';c.trafficMode='free';
      }
    }

    for(const c of mains){
      let insideConflict=false;
      for(const zone of rd.conflictZones){
        const zi=zone.paths.get(c.pathKey);
        if(zi===undefined)continue;
        const dp=(zi-c.pathIdx)*PATH_SP;
        if(dp<=0&&dp>=-zone.radius){insideConflict=true;break;}
      }
      if(insideConflict&&Math.abs(c.speed)<0.1){
        c.spillbackTicks+=dt;
        if(c.spillbackTicks>10&&!c.spillbackFlag){c.spillbackFlag=true;this.spillbackViolations++;}
      }else{
        c.spillbackTicks=0;c.spillbackFlag=false;
      }
    }

    for(let i=0;i<active.length;i++){for(let j=i+1;j<active.length;j++){
      const a=active[i],b=active[j];if(a.done||b.done)continue;
      if(Math.hypot(a.x-b.x,a.y-b.y)>CAR_L*2)continue;
      if(satOverlap(a,b))this.satCount++;
    }}

    for(const c of active){delete c._pq;delete c._gap;delete c._progress;delete c._progressDelta;delete c._conflictProgress;delete c._targetClearance;}

    if(this.started&&this.cars.every(c=>c.done)){this.finished=true;this.finishTick=this.ticks;this.running=false;}
  }

  _movementPriority(c){
    let score=0;
    if(c.trafficMode==='batch')score+=2000000;
    if(!c.zoneYielding)score+=1000000;
    if(!c.merging)score+=100000;
    if(c.commitUntilFork)score+=50000;
    if(c.trafficMode==='hold_exit')score-=250000;
    if(!c.maneuvering)score+=10000;
    score+=c.seg==='main'?-c.y:c.pathIdx;
    score+=c.tiebreak*0.01;
    return score;
  }

  _pathProgress(c,pose){
    const p=pose||c;
    return pathQuery(c.path,p.x,p.y,c.pathIdx).idx*PATH_SP;
  }

  _trackingError(c,pose){
    const p=pose||c;
    const pq=pathQuery(c.path,p.x,p.y,c.pathIdx);
    const cte=Math.cos(pq.ang)*(p.y-pq.py)-Math.sin(pq.ang)*(p.x-pq.px);
    let hErr=pq.ang-p.th;
    while(hErr>Math.PI)hErr-=2*Math.PI;
    while(hErr<-Math.PI)hErr+=2*Math.PI;
    return{cte:Math.abs(cte),hErr:Math.abs(hErr),pq};
  }

  _isParallelNeighbor(a,b){
    if(a.id===b.id||a.done||b.done)return false;
    if(a.target!==b.target||a.seg!==b.seg)return false;
    if(Math.abs(a.th-b.th)>0.35)return false;
    if(a.seg==='main'){
      if(Math.abs(a.lane-b.lane)!==1)return false;
      return Math.abs(a.y-b.y)<LOOK;
    }
    return Math.abs(a.pathIdx-b.pathIdx)<18;
  }

  _entryLaneLoad(target,lane,active,rd){
    let load=0;
    for(const o of active){
      if(o.done||o.seg!=='main'||o.target!==target)continue;
      if(o.y-rd.forkY>LANE_LOAD_LOOKAHEAD)continue;
      let best=0,bd=1e9;
      for(let i=0;i<this.nL;i++){const d=Math.abs(o.x-rd.laneX(i));if(d<bd){bd=d;best=i;}}
      if(best===lane)load++;
    }
    return load;
  }

  _downstreamClearance(target,active,rd){
    let forkProg=1e9;
    for(const zone of rd.conflictZones){
      for(const [key,idx] of zone.paths.entries()){
        if(key.endsWith(target)&&idx<forkProg)forkProg=idx;
      }
    }
    const forkDist=(forkProg===1e9?0:forkProg*PATH_SP);
    let best=1e9;
    for(const c of active){
      if(c.done||c.seg!==target)continue;
      const delta=this._pathProgress(c)-forkDist-CAR_L;
      if(delta<best)best=delta;
    }
    return best===1e9?1e9:best;
  }

  _canShareBatch(a,b,dt,rd,active){
    if(!a||!b||a.target!==b.target||a.seg!=='main'||b.seg!=='main')return false;
    if(Math.abs(a.y-b.y)<CAR_L*1.3)return false;
    const aPose=this._candidatePose(a,Math.max(a.speed,Math.max(a.desSpd||0,0.4)),a.steer,dt);
    const bPose=this._candidatePose(b,Math.max(b.speed,Math.max(b.desSpd||0,0.4)),b.steer,dt);
    return !satOverlapMargin(aPose.x,aPose.y,aPose.th,bPose.x,bPose.y,bPose.th,PROJ_MARGIN);
  }

  _updateBatchScheduler(active,rd){
    for(const zone of rd.conflictZones){
      zone.downstreamClearanceByTarget.left=this._downstreamClearance('left',active,rd);
      zone.downstreamClearanceByTarget.right=this._downstreamClearance('right',active,rd);

      const activeBatchCars=active.filter(c=>c.batchId===zone.activeBatchId&&!c.done);
      if(activeBatchCars.length>0&&zone.batchExpireTick>this.ticks){
        const stillNear=activeBatchCars.some(c=>{
          const zi=zone.paths.get(c.pathKey);
          return zi!==undefined&&c.pathIdx<=zi+10;
        });
        if(stillNear)continue;
      }

      const waiting={left:[],right:[]};
      for(const c of active){
        if(c.done||c.seg!=='main')continue;
        const zi=zone.paths.get(c.pathKey);
        if(zi===undefined)continue;
        const dp=(zi-c.pathIdx)*PATH_SP;
        if(dp<0||dp>BATCH_APPROACH_DIST)continue;
        waiting[c.target].push({car:c,eta:c.speed>0.05?dp/Math.max(c.speed,0.05):9999,dp});
      }
      waiting.left.sort((a,b)=>a.eta-b.eta||a.car.tiebreak-b.car.tiebreak);
      waiting.right.sort((a,b)=>a.eta-b.eta||a.car.tiebreak-b.car.tiebreak);

      zone.schedulerEnabled=waiting.left.length>0&&waiting.right.length>0;
      if(!zone.schedulerEnabled){
        zone.activeBatchId=null;zone.activeBatchTarget=null;zone.batchMembers=[];zone.batchExpireTick=0;
        zone.starveTicksLeft=0;zone.starveTicksRight=0;
        continue;
      }

      const readyLeft=waiting.left.length>0&&zone.downstreamClearanceByTarget.left>=EXIT_CLEARANCE;
      const readyRight=waiting.right.length>0&&zone.downstreamClearanceByTarget.right>=EXIT_CLEARANCE;

      let chosenTarget='';
      if(readyLeft&&readyRight){
        if(zone.starveTicksLeft!==zone.starveTicksRight)chosenTarget=zone.starveTicksLeft>zone.starveTicksRight?'left':'right';
        else chosenTarget=waiting.left[0].eta<=waiting.right[0].eta?'left':'right';
      }else if(readyLeft)chosenTarget='left';
      else if(readyRight)chosenTarget='right';

      if(!chosenTarget){
        zone.activeBatchId=null;zone.activeBatchTarget=null;zone.batchMembers=[];zone.batchExpireTick=0;
        if(waiting.left.length)zone.starveTicksLeft++;
        if(waiting.right.length)zone.starveTicksRight++;
        this.maxStarveTicks=Math.max(this.maxStarveTicks,zone.starveTicksLeft,zone.starveTicksRight);
        continue;
      }

      const queue=waiting[chosenTarget];
      const members=[queue[0].car];
      if(queue.length>1&&this._canShareBatch(queue[0].car,queue[1].car,1,rd,active))members.push(queue[1].car);

      zone.activeBatchId=this.nextBatchId++;
      zone.activeBatchTarget=chosenTarget;
      zone.batchMembers=members.map(c=>c.id);
      zone.batchExpireTick=this.ticks+BATCH_HOLD_TICKS;
      zone.holder=members[0].id;
      this.maxBatchSizeSeen=Math.max(this.maxBatchSizeSeen,members.length);
      if(chosenTarget==='left'){zone.starveTicksLeft=0;if(waiting.right.length)zone.starveTicksRight++;}
      else{zone.starveTicksRight=0;if(waiting.left.length)zone.starveTicksLeft++;}
      this.maxStarveTicks=Math.max(this.maxStarveTicks,zone.starveTicksLeft,zone.starveTicksRight);
    }
  }

  _assignBatchStates(activeCars,zone,rd){
    for(const c of activeCars){
      if(c.seg!=='main'||c.done)continue;
      const zi=zone.paths.get(c.pathKey);
      if(zi===undefined)continue;
      const dp=(zi-c.pathIdx)*PATH_SP;
      const nearFork=dp>=0&&dp<=BATCH_APPROACH_DIST;
      const isBatchMember=zone.batchMembers.includes(c.id);
      const targetClear=zone.downstreamClearanceByTarget[c.target];
      c.batchId=isBatchMember?zone.activeBatchId:null;
      c.batchTarget=isBatchMember?zone.activeBatchTarget:'';
      if(!zone.schedulerEnabled){
        c.trafficMode=c.commitUntilFork?'commit':'free';
        c.zoneYielding=false;
        continue;
      }
      if(isBatchMember){
        c.trafficMode='batch';c.zoneYielding=false;
      }else if(nearFork&&targetClear<EXIT_CLEARANCE){
        c.trafficMode='hold_exit';c.zoneYielding=true;
      }else if(nearFork&&zone.activeBatchId!==null){
        c.trafficMode='yield';c.zoneYielding=true;
      }else if(c.commitUntilFork){
        c.trafficMode='commit';c.zoneYielding=false;
      }else{
        c.trafficMode='free';c.zoneYielding=false;
      }
    }
  }

  _findPrimaryBlocker(c,active){
    let best=null,bestScore=1e9;
    for(const o of active){
      if(o.id===c.id||o.done)continue;
      if(this._isParallelNeighbor(c,o))continue;
      if(Math.hypot(o.x-c.x,o.y-c.y)>LOOK+CAR_L)continue;
      const hit=coneCheck(c,o);
      if(hit){
        const score=(hit.imminent?0:20)+Math.max(0,hit.fwd);
        if(score<bestScore){bestScore=score;best=o;}
        continue;
      }
      const sameSeg=c.seg===o.seg&&c.target===o.target;
      if(!sameSeg)continue;
      const dx=o.x-c.x,dy=o.y-c.y;
      const fwd=dx*Math.cos(c.th)+dy*Math.sin(c.th);
      const lat=Math.abs(-dx*Math.sin(c.th)+dy*Math.cos(c.th));
      if(fwd>0&&lat<CAR_W*1.5&&fwd<bestScore){bestScore=fwd;best=o;}
    }
    return best;
  }

  _classifyBlocker(c,active,rd,dt){
    if(c.maneuvering||c.trafficMode==='yield'||c.trafficMode==='hold_exit'||c.trafficMode==='batch'){
      const blocker=this._findPrimaryBlocker(c,active);
      return{kind:c.trafficMode==='yield'||c.trafficMode==='hold_exit'||c.trafficMode==='batch'?'conflict':'wall',blocker};
    }
    const desiredPose=this._candidatePose(c,Math.max(0,c.desSpd),c.desSt,dt);
    if(this._isPoseOutsideRoad(c,desiredPose,rd))return{kind:'wall',blocker:null};
    let follow=null,parallel=null;
    for(const o of active){
      if(o.id===c.id||o.done)continue;
      if(this._isParallelNeighbor(c,o)){parallel=o;continue;}
      if(c.seg===o.seg&&c.target===o.target&&c.lane===o.lane){
        const dx=o.x-c.x,dy=o.y-c.y;
        const fwd=dx*Math.cos(c.th)+dy*Math.sin(c.th);
        if(fwd>0&&fwd<LOOK&&(!follow||fwd<follow.fwd))follow={car:o,fwd};
        continue;
      }
      const hit=coneCheck(c,o);
      if(hit&&((c.target!==o.target)||Math.abs(c.th-o.th)>=0.5))return{kind:'conflict',blocker:o};
    }
    if(follow)return{kind:'follow',blocker:follow.car};
    if(parallel)return{kind:'parallel',blocker:parallel};
    return{kind:'none',blocker:null};
  }

  _candidatePose(c,speed,steer,dt){
    const pose={x:c.x+speed*Math.cos(c.th)*dt,y:c.y+speed*Math.sin(c.th)*dt,th:c.th,speed,steer};
    if(Math.abs(speed)>0.01)pose.th+=(speed/WBASE)*Math.tan(steer)*dt;
    while(pose.th>Math.PI)pose.th-=2*Math.PI;
    while(pose.th<-Math.PI)pose.th+=2*Math.PI;
    return pose;
  }

  _poseOverlapsCars(c,pose,active){
    for(const o of active){
      if(o.id===c.id||o.done)continue;
      if(Math.hypot(pose.x-o.x,pose.y-o.y)>PROJ_BROAD_PHASE)continue;
      if(satOverlapMargin(pose.x,pose.y,pose.th,o.x,o.y,o.th,PROJ_MARGIN))return true;
    }
    return false;
  }

  _isPoseOutsideRoad(c,pose,rd){
    const M=PROJ_MARGIN;
    if(c.seg==='main'){
      const hw=rd.halfWAt(pose.y);
      return Math.abs(pose.x-rd.cx)+CAR_W/2+M > hw;
    }
    let minD=1e9;
    for(const key of rd.pathKeys){
      if(!key.endsWith(c.seg))continue;
      const path=rd.fullPaths[key];
      const pq=pathQuery(path,pose.x,pose.y,c.pathIdx);
      const d=Math.hypot(pose.x-pq.px,pose.y-pq.py);
      if(d<minD)minD=d;
    }
    return minD > rd.lw/2 + M;
  }

  _isOutsideRoad(c,rd){
    return this._isPoseOutsideRoad(c,{x:c.x,y:c.y,th:c.th},rd);
  }

  _isLegalPose(c,pose,rd,active){
    return !this._isPoseOutsideRoad(c,pose,rd) && !this._poseOverlapsCars(c,pose,active);
  }

  _candidateSet(c,trafficContext,dt){
    const desiredSpeed=trafficContext.desiredSpeed;
    const desiredSteer=trafficContext.desiredSteer;
    const speedSign=desiredSpeed===0?1:Math.sign(desiredSpeed);
    const speedMag=Math.abs(desiredSpeed);
    const seen=new Set(),attempts=[];
    const addAttempt=(speed,steer)=>{
      const clampedSteer=Math.max(-MAX_ST,Math.min(MAX_ST,steer));
      const key=`${speed.toFixed(3)}|${clampedSteer.toFixed(3)}`;
      if(seen.has(key))return;
      seen.add(key);
      attempts.push({speed,steer:clampedSteer});
    };
    addAttempt(desiredSpeed,desiredSteer);
    for(const scale of [0.85,0.7,0.55,0.4,0.25,0.1])addAttempt(desiredSpeed*scale,desiredSteer);
    for(const steer of trafficContext.targetSteers)for(const scale of [0.55,0.4,0.25,0.15]){
      addAttempt(speedSign*Math.max(speedMag*scale,0.12),steer);
    }
    if(trafficContext.blockerSteer!==null){
      for(const scale of [0.4,0.25,0.15])addAttempt(speedSign*Math.max(speedMag*scale,0.12),trafficContext.blockerSteer);
    }
    if(c.trafficMode==='maneuver'){
      for(const steer of trafficContext.targetSteers)for(const scale of [0.4,0.25,0.15]){
        addAttempt(Math.max(speedMag*scale,0.12),steer);
      }
      for(const revMag of [0.15,0.25,0.4]){
        const rev=-Math.max(speedMag*revMag,REVERSE_SPD);
        for(const steer of trafficContext.targetSteers)addAttempt(rev,steer);
      }
    }
    addAttempt(0,desiredSteer);
    return attempts.map(a=>({speed:a.speed,steer:a.steer,pose:this._candidatePose(c,a.speed,a.steer,dt)}));
  }

  _scoreCandidate(c,candidate,trafficContext){
    const progress=this._pathProgress(c,candidate.pose)-trafficContext.baseProgress;
    let score=progress*(c.trafficMode==='maneuver'?2:8);
    score-=Math.abs(candidate.steer-trafficContext.desiredSteer)*0.8;
    score-=Math.abs(candidate.speed-trafficContext.desiredSpeed)*0.1;
    if(candidate.speed<0&&c.trafficMode!=='maneuver')score-=50;
    if(candidate.speed<0&&c.trafficMode==='maneuver')score+=2;
    if(c.trafficMode==='batch'&&progress>0)score+=20;
    if(c.trafficMode==='yield'&&progress>PROGRESS_EPS)score-=30;
    if(c.trafficMode==='hold_exit'&&progress>PROGRESS_EPS)score-=1000;
    if(trafficContext.conflictProgress!==null&&candidate.enterConflict&&!trafficContext.canEnterConflict)score-=1000;
    if(candidate.enterConflict&&trafficContext.targetClearance<EXIT_CLEARANCE)score-=(EXIT_CLEARANCE-trafficContext.targetClearance)*4;
    if(c.commitUntilFork&&c.trafficMode!=='maneuver'&&Math.abs(candidate.steer)>MAX_ST*0.85)score-=2;
    if(trafficContext.blocker){
      const curDist=Math.hypot(c.x-trafficContext.blocker.x,c.y-trafficContext.blocker.y);
      const newDist=Math.hypot(candidate.pose.x-trafficContext.blocker.x,candidate.pose.y-trafficContext.blocker.y);
      score+=(newDist-curDist)*(c.trafficMode==='maneuver'?1.4:0.05);
    }
    if(c.trafficMode==='maneuver'){
      const lateralMove=(candidate.pose.x-c.x)*c.maneuverPerpDir.x+(candidate.pose.y-c.y)*c.maneuverPerpDir.y;
      score+=lateralMove*6;
      if(candidate.speed>0&&progress<PROGRESS_EPS)score-=2;
    }
    const pq=pathQuery(c.path,candidate.pose.x,candidate.pose.y,c.pathIdx);
    let hErr=pq.ang-candidate.pose.th;while(hErr>Math.PI)hErr-=2*Math.PI;while(hErr<-Math.PI)hErr+=2*Math.PI;
    score-=Math.abs(hErr)*1.5;
    return score;
  }

  _chooseNominalMove(c,dt,rd,active){
    const currentErr=this._trackingError(c,{x:c.x,y:c.y,th:c.th});
    const speeds=[1,0.9,0.75,0.6,0.45,0.3,0.15,0].map(scale=>scale===0?0:Math.max(0,c.desSpd*scale));
    for(const speed of speeds){
      const pose=this._candidatePose(c,speed,c.desSt,dt);
      if(!this._isLegalPose(c,pose,rd,active))continue;
      const err=this._trackingError(c,pose);
      if(err.cte>currentErr.cte+0.5)continue;
      if(err.hErr>currentErr.hErr+0.05)continue;
      return{x:pose.x,y:pose.y,th:pose.th,speed,steer:c.desSt};
    }
    return{x:c.x,y:c.y,th:c.th,speed:0,steer:c.steer};
  }

  _chooseBestLegalCandidate(c,trafficContext,dt){
    let best={pose:{x:c.x,y:c.y,th:c.th},speed:0,steer:c.steer,score:-1e9};
    let legalCount=0;
    for(const candidate of this._candidateSet(c,trafficContext,dt)){
      if(!this._isLegalPose(c,candidate.pose,trafficContext.rd,trafficContext.active))continue;
      legalCount++;
      candidate.enterConflict=trafficContext.conflictProgress!==null&&this._pathProgress(c,candidate.pose)>=trafficContext.conflictProgress-2;
      candidate.score=this._scoreCandidate(c,candidate,trafficContext);
      if(candidate.score>best.score)best={...candidate};
    }
    if(legalCount===0)this.plannerIllegalCount++;
    return{pose:best.pose,speed:best.speed,steer:best.steer};
  }

  _chooseTrafficMove(c,dt,rd,active){
    const blocker=this._findPrimaryBlocker(c,active);
    c.primaryBlockerId=blocker?blocker.id:null;
    const steerBias=Math.sign(c.desSt)||(c.blinker!==0?c.blinker:1);
    const steerTargets=[
      c.desSt,
      c.desSt+steerBias*0.08,
      c.desSt-steerBias*0.08,
      c.desSt+steerBias*0.16,
      c.desSt-steerBias*0.16,
      c.desSt+steerBias*0.24,
      c.desSt-steerBias*0.24,
      steerBias*MAX_ST,
      -steerBias*MAX_ST,
    ];
    if(c.maneuvering){
      const perpAngle=Math.atan2(c.maneuverPerpDir.y,c.maneuverPerpDir.x);
      let steerToPerp=perpAngle-c.th;
      while(steerToPerp>Math.PI)steerToPerp-=2*Math.PI;
      while(steerToPerp<-Math.PI)steerToPerp+=2*Math.PI;
      steerTargets.push(steerToPerp,steerToPerp*0.7,-steerToPerp*0.5);
    }
    const blockerSteer=blocker?((()=>{
      const dx=blocker.x-c.x,dy=blocker.y-c.y,lat=-dx*Math.sin(c.th)+dy*Math.cos(c.th);
      return lat>=0?-MAX_ST:MAX_ST;
    })()):null;
    const trafficContext={
      active,rd,blocker,
      desiredSpeed:c.desSpd,desiredSteer:c.desSt,targetSteers:steerTargets,blockerSteer,
      baseProgress:this._pathProgress(c),conflictProgress:c._conflictProgress??null,
      targetClearance:c._targetClearance??1e9,
      canEnterConflict:c.trafficMode==='batch'
    };
    const best=this._chooseBestLegalCandidate(c,trafficContext,dt);
    return{x:best.pose.x,y:best.pose.y,th:best.pose.th,speed:best.speed,steer:best.steer};
  }

  _chooseLegalMove(c,dt,rd,active){
    if(c.plannerMode==='nominal')return this._chooseNominalMove(c,dt,rd,active);
    return this._chooseTrafficMove(c,dt,rd,active);
  }

  _mobil(c,mains,P){
    if(c.commitUntilFork&&!c.maneuvering)return;
    const rd=this.road,acCur=this._idmLane(c,c.lane,mains,P);
    const safeGap=c.maneuvering?MOBIL_MANEUVER_GAP:MOBIL_SAFE_GAP;
    const curLoad=this._entryLaneLoad(c.target,c.lane,mains,rd);
    let bestLane=c.lane,bestScore=-999;
    for(const cand of[c.lane-1,c.lane+1]){
      if(cand<0||cand>=this.nL)continue;
      const candLx=rd.laneX(cand);
      let nearestAhead=9999,nearestBehind=9999;
      for(const o of mains){if(o.id===c.id)continue;
        if(Math.abs(o.x-candLx)>rd.lw*0.8)continue;
        const dy=c.y-o.y;
        if(dy>0)nearestAhead=Math.min(nearestAhead,dy-CAR_L);
        else nearestBehind=Math.min(nearestBehind,-dy-CAR_L);
      }
      if(nearestAhead<safeGap||nearestBehind<safeGap)continue;
      const acCand=this._idmLane(c,cand,mains,P);
      let gain=acCand-acCur;
      let fPain=0;const fol=this._followerLane(c,cand,mains);
      if(fol){const fAO=this._idmLane(fol,cand,mains,P),fG=Math.hypot(fol.x-c.x,fol.y-c.y)-CAR_L;
        if(fG<safeGap)continue;const fDv=fol.speed-c.speed;
        const fAN=idm(fol.speed,P.v0,Math.max(fG,0.1),fDv);if(fAN<-0.15)continue;fPain=fAO-fAN;}
      const candLoad=this._entryLaneLoad(c.target,cand,mains,rd);
      const demandBias=(curLoad-candLoad)*0.12;
      const score=gain-0.3*fPain+demandBias;
      if(score>0.015&&score>bestScore){bestScore=score;bestLane=cand;}
    }
    if(bestLane!==c.lane){
      if(c.commitUntilFork){this.commitOscillationCount++;return;}
      c.blinker=bestLane>c.lane?1:-1;
      c.pathKey=bestLane+'-'+c.target;c.path=rd.fullPaths[c.pathKey];
      c.pathIdx=pathQuery(c.path,c.x,c.y,0).idx;
      c.lastProgress=c.pathIdx*PATH_SP;
      c.lane=bestLane;c.merging=true;
      if(c.commitUntilFork)c.commitLaneChanges++;
    }
  }
  _idmLane(c,lane,mains,P){
    const lx=this.road.laneX(lane);let gap=9999,dv=0;
    for(const o of mains){if(o.id===c.id)continue;if(Math.abs(o.x-lx)>this.road.lw*0.8)continue;
      const dy=c.y-o.y;if(dy>0){const g=dy-CAR_L;if(g<gap){gap=g;dv=c.speed-o.speed;}}}
    return idm(c.speed,this.started?P.v0:0,Math.max(gap,0.1),dv);}
  _followerLane(c,lane,mains){
    const lx=this.road.laneX(lane);let best=null,bd=1e9;
    for(const o of mains){if(o.id===c.id)continue;if(Math.abs(o.x-lx)>this.road.lw*0.8)continue;
      const dy=o.y-c.y;if(dy>0&&dy<bd){bd=dy;best=o;}}return best;}
  get timerSec(){return(this.finished?this.finishTick:this.ticks)/60;}
}

class Ren{
  constructor(cv,sim){this.cv=cv;this.ctx=cv.getContext('2d');this.sim=sim;}
  draw(){const ctx=this.ctx,dpr=devicePixelRatio||1,w=this.cv.width/dpr,h=this.cv.height/dpr;
    const rd=this.sim.road;if(!rd)return;ctx.save();ctx.clearRect(0,0,w,h);ctx.fillStyle='#06060a';ctx.fillRect(0,0,w,h);
    this._road(rd,h);this._stop(rd);this._cars(rd,h);ctx.restore();}
  _road(rd,h){const ctx=this.ctx,hw=rd.halfW();
    ctx.fillStyle='#0f0f17';
    ctx.beginPath();
    const steps=20;
    ctx.moveTo(rd.cx+hw,h+100);
    for(let i=0;i<=steps;i++){
      const y=h+100-(h+100-rd.forkY)*i/steps;
      ctx.lineTo(rd.cx+rd.halfWAt(y),y);
    }
    for(let i=steps;i>=0;i--){
      const y=h+100-(h+100-rd.forkY)*i/steps;
      ctx.lineTo(rd.cx-rd.halfWAt(y),y);
    }
    ctx.closePath();ctx.fill();
    for(const br of['left','right']){ctx.beginPath();
      for(let i=0;i<=50;i++){const t=i/50;const bhw=rd.branchHalfW(br,t);const p=rd.bPt(br,t),pr=p.angle-Math.PI/2;i?ctx.lineTo(p.x+Math.cos(pr)*(-bhw),p.y+Math.sin(pr)*(-bhw)):ctx.moveTo(p.x+Math.cos(pr)*(-bhw),p.y+Math.sin(pr)*(-bhw));}
      for(let i=50;i>=0;i--){const t=i/50;const bhw=rd.branchHalfW(br,t);const p=rd.bPt(br,t),pr=p.angle-Math.PI/2;ctx.lineTo(p.x+Math.cos(pr)*bhw,p.y+Math.sin(pr)*bhw);}
      ctx.closePath();ctx.fillStyle='#0f0f17';ctx.fill();}
    ctx.strokeStyle='#181824';ctx.lineWidth=1;ctx.setLineDash([5,5]);
    for(let i=1;i<rd.n;i++){const lx=rd.cx+(-hw+i*rd.lw);ctx.beginPath();ctx.moveTo(lx,rd.forkY);ctx.lineTo(lx,h+100);ctx.stroke();}
    ctx.setLineDash([]);ctx.strokeStyle='#1c1c2a';ctx.lineWidth=1.5;
    for(const s of[-1,1]){
      ctx.beginPath();
      for(let i=0;i<=steps;i++){
        const y=h+100-(h+100-rd.forkY)*i/steps;
        i?ctx.lineTo(rd.cx+s*rd.halfWAt(y),y):ctx.moveTo(rd.cx+s*rd.halfWAt(y),y);
      }
      ctx.stroke();
    }
    for(const br of['left','right']){
      const outerS=br==='left'?1:-1;
      ctx.beginPath();
      for(let i=0;i<=50;i++){const t=i/50;const bhw=rd.branchHalfW(br,t);const p=rd.bPt(br,t),pr=p.angle-Math.PI/2;
        i?ctx.lineTo(p.x+Math.cos(pr)*(outerS*bhw),p.y+Math.sin(pr)*(outerS*bhw)):ctx.moveTo(p.x+Math.cos(pr)*(outerS*bhw),p.y+Math.sin(pr)*(outerS*bhw));}
      ctx.stroke();
      const innerS=br==='left'?-1:1;
      let crossI=0;
      for(let i=1;i<=50;i++){
        const tL=i/50,tR=i/50;
        const bhwL=rd.branchHalfW('left',tL),bhwR=rd.branchHalfW('right',tR);
        const pL=rd.bPt('left',tL),prL=pL.angle-Math.PI/2;
        const pR=rd.bPt('right',tR),prR=pR.angle-Math.PI/2;
        const xLinner=pL.x+Math.cos(prL)*(-bhwL);
        const xRinner=pR.x+Math.cos(prR)*(bhwR);
        if(xLinner<xRinner){crossI=i;break;}
      }
      if(crossI>0){
        ctx.beginPath();
        for(let i=crossI;i<=50;i++){const t=i/50;const bhw=rd.branchHalfW(br,t);const p=rd.bPt(br,t),pr=p.angle-Math.PI/2;
          i===crossI?ctx.moveTo(p.x+Math.cos(pr)*(innerS*bhw),p.y+Math.sin(pr)*(innerS*bhw)):ctx.lineTo(p.x+Math.cos(pr)*(innerS*bhw),p.y+Math.sin(pr)*(innerS*bhw));}
        ctx.stroke();}}
    if(rd.n>1){ctx.strokeStyle='#1e1e2a';ctx.lineWidth=1;ctx.setLineDash([5,5]);
      for(const br of['left','right']){
        for(let lane=1;lane<rd.n;lane++){
          const offset=(-hw+lane*rd.lw);
          ctx.beginPath();
          for(let i=0;i<=50;i++){const p=rd.bPt(br,i/50),pr=p.angle-Math.PI/2;
            i?ctx.lineTo(p.x+Math.cos(pr)*offset,p.y+Math.sin(pr)*offset):ctx.moveTo(p.x+Math.cos(pr)*offset,p.y+Math.sin(pr)*offset);}
          ctx.stroke();}}
      ctx.setLineDash([]);}
  }
  _stop(rd){const ctx=this.ctx,hw=rd.halfW(),gr=this.sim.started;
    ctx.setLineDash([]);ctx.strokeStyle=gr?'#153015':'#4a1010';ctx.lineWidth=2.5;
    ctx.beginPath();ctx.moveTo(rd.cx-hw,rd.stopY);ctx.lineTo(rd.cx+hw,rd.stopY);ctx.stroke();
    ctx.beginPath();ctx.arc(rd.cx-hw-7,rd.stopY,4,0,Math.PI*2);ctx.fillStyle=gr?'#22bb22':'#bb1818';ctx.fill();ctx.strokeStyle='#0e0e16';ctx.lineWidth=1.5;ctx.stroke();}
  _cars(rd,ch){const ctx=this.ctx;let offS=0;const vis=this.sim.cars.filter(c=>!c.done);vis.sort((a,b)=>b.y-a.y);
    for(const car of vis){if(car.y>ch+10){offS++;continue;}this._car(car,car.y>ch-6?0.18:1.0);}
    if(offS>0){ctx.save();ctx.globalAlpha=0.2;ctx.fillStyle='#444';ctx.font='9px JetBrains Mono';ctx.textAlign='center';ctx.fillText(`▲ ${offS} queued`,rd.cx,ch-3);ctx.restore();}}
  _car(car,alpha){const ctx=this.ctx;ctx.save();ctx.globalAlpha=alpha;ctx.translate(car.x,car.y);ctx.rotate(car.th);
    if(car.speed<0.06&&car.speed>=0&&this.sim.started&&car.seg==='main')ctx.globalAlpha=alpha*(0.5+0.5*Math.sin(Date.now()/200+car.id*3));
    const hw=CAR_W/2,hl=CAR_L/2,R=2.5;ctx.beginPath();ctx.moveTo(-hl+R,-hw);ctx.lineTo(hl-R,-hw);
    ctx.quadraticCurveTo(hl,-hw,hl,-hw+R);ctx.lineTo(hl,hw-R);ctx.quadraticCurveTo(hl,hw,hl-R,hw);
    ctx.lineTo(-hl+R,hw);ctx.quadraticCurveTo(-hl,hw,-hl,hw-R);ctx.lineTo(-hl,-hw+R);
    ctx.quadraticCurveTo(-hl,-hw,-hl+R,-hw);ctx.closePath();ctx.fillStyle=car.color;ctx.fill();
    if(car.zoneYielding){ctx.strokeStyle='#ff4444';ctx.lineWidth=0.8;ctx.stroke();}
    if(car.maneuvering){ctx.strokeStyle='#ffaa00';ctx.lineWidth=1;ctx.stroke();}
    if(car.reversing){ctx.strokeStyle='#ffffff';ctx.lineWidth=0.8;ctx.stroke();}
    if(car.blinker!==0){ctx.fillStyle='#ffaa00';ctx.globalAlpha=alpha*(0.5+0.5*Math.sin(Date.now()/150));
      if(car.blinker<0)ctx.fillRect(-hl,-hw-1,3,1);else ctx.fillRect(-hl,hw,3,1);}
    ctx.globalAlpha=alpha*0.35;ctx.fillStyle='#fff';ctx.fillRect(hl-1.5,-hw+1,1.5,2);ctx.fillRect(hl-1.5,hw-3,1.5,2);
    if(car.speed<1.0&&car.speed>=0&&this.sim.started){ctx.fillStyle='#ff1818';ctx.globalAlpha=alpha*Math.min(0.7,(1-car.speed)*0.6);ctx.fillRect(-hl,-hw+1,1.5,2);ctx.fillRect(-hl,hw-3,1.5,2);}
    if(car.speed<-0.01){ctx.fillStyle='#ffffff';ctx.globalAlpha=alpha*0.5;ctx.fillRect(-hl,-hw+1,1.5,2);ctx.fillRect(-hl,hw-3,1.5,2);}
    ctx.restore();}
}

  global.TrafficCore={
    WBASE,MAX_ST,CAR_L,CAR_W,IDM_S0,IDM_T,PATH_SP,V0_DEF,PROJ_MARGIN,INTERSECT_WIDEN,COMMIT_DIST,BATCH_APPROACH_DIST,EXIT_CLEARANCE,PROGRESS_EPS,
    mkRng,V,idm,toLocal,coneCheck,rearConeCheck,satOverlap,carCorners,satOverlapMargin,pathQuery,Road,Car,Sim,Ren
  };
})(window);
