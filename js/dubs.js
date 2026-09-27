var currentDubsData={hasDubs:false,original:null,dubs:[]};
async function loadDubsForPlayer(movieId){
    var c=document.getElementById('dubSelectorContainer');
    if(c)c.style.display='none';
    try{
        var r=await fetch('/api/dubs/'+movieId),d=await r.json();
        if(d.status==='success'&&d.data&&d.data.hasDubs){currentDubsData=d.data;renderPlayerDubOptions(movieId);}
        else currentDubsData={hasDubs:false,original:null,dubs:[]};
    }catch(e){currentDubsData={hasDubs:false,original:null,dubs:[]};}
}
function renderPlayerDubOptions(activeDubId){
    var c=document.getElementById('dubSelectorContainer'),l=document.getElementById('dubOptionsList');
    if(!c||!l)return;
    var all=[];
    if(currentDubsData.original)all.push(currentDubsData.original);
    (currentDubsData.dubs||[]).forEach(function(d){all.push(d);});
    if(all.length<=1){c.style.display='none';return;}
    l.innerHTML='';
    all.forEach(function(d){
        var div=document.createElement('div');
        div.className=d.subjectId===activeDubId?'dub-active':'';
        var chk=document.createElement('i');
        chk.className='fas fa-check dub-check';
        div.appendChild(chk);
        div.appendChild(document.createTextNode(d.lanName));
        div.addEventListener('click',(function(id,n,dp){return function(){selectDub(id,n,dp);};})(d.subjectId,d.lanName,d.detailPath||''));
        l.appendChild(div);
    });
    c.style.display='block';
}
function toggleDubDropdown(e){
    if(e)e.stopPropagation();
    var p=document.getElementById('dubPanel');
    if(p){p.style.display=p.style.display==='none'?'block':'none';}
}
document.addEventListener('click',function(e){
    var c=document.getElementById('dubSelectorContainer');
    var p=document.getElementById('dubPanel');
    if(p&&c&&!c.contains(e.target)&&p.style.display!=='none'){p.style.display='none';}
});
async function selectDub(subjectId,lanName,detailPath){
    var p=document.getElementById('dubPanel');if(p)p.style.display='none';
    if(!subjectId||subjectId===currentMovieId)return;
    showQuickMessage('Switching to '+lanName+'...','info');
    currentMovieId=subjectId;
    try{
        var sd=await getMovieSources(subjectId,currentSeason||0,currentEpisode||0,detailPath||'');
        if(!sd||!sd.sources||!sd.sources.length){showQuickMessage('No sources for '+lanName,'error');return;}
        currentSources=sd;
        var qs=document.getElementById('qualitySelector');
        if(qs){
            qs.innerHTML='<option value="">Quality</option>';
            sd.sources.forEach(function(s){
                var u=s.streamUrl||s.proxyUrl||s.directUrl||'';
                if(!u)return;
                var o=document.createElement('option');
                o.value=u;o.textContent=s.label||(s.quality?s.quality+'p':'Auto');
                qs.appendChild(o);
            });
        }
        var pick=sd.sources.find(function(s){return s.quality===360||s.label==='360p';})||sd.sources[0];
        var url=pick&&(pick.streamUrl||pick.proxyUrl||pick.directUrl);
        if(!url){showQuickMessage('Invalid source','error');return;}
        var vp=document.getElementById('videoPlayer');
        if(!vp)return;
        vp.src=url;vp.load();vp.play().catch(function(){});
        renderPlayerDubOptions(subjectId);
        showQuickMessage('Now playing: '+lanName,'success');
    }catch(err){showQuickMessage('Failed to load '+lanName,'error');}
}
function selectActionDub(subjectId,lanName){
    if(!currentActionMovie)return;
    currentActionMovie.activeDubId=subjectId;
    currentActionMovie.movieId=subjectId;
    var chips=document.getElementById('amDubChips');
    if(!chips)return;
    chips.querySelectorAll('.dub-chip').forEach(function(btn){
        var active=btn.dataset.dubId===subjectId;
        btn.style.borderColor=active?'#e50914':'#374151';
        btn.style.background=active?'rgba(229,9,20,.15)':'transparent';
        btn.style.color=active?'#e50914':'#9ca3af';
    });
    showQuickMessage('Audio: '+lanName,'info');
}
