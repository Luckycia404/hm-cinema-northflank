// App download
var _appInfo=null;
fetch('https://hm-cinema-updater.officialhectormanuel.workers.dev/latest.json')
  .then(function(r){return r.json();})
  .then(function(d){
    _appInfo=d;
    var v=document.getElementById('welcomeAppVersion');
    if(v&&d.version_name)v.textContent='v'+d.version_name;
    var nb=document.getElementById('navGetAppBtn');
    if(nb&&d.version_name)nb.title='Download HM Cinema App v'+d.version_name+(d.update_size?' — '+d.update_size:'');
  }).catch(function(){});
function downloadApp(){
  var url=(_appInfo&&_appInfo.apk_url)?_appInfo.apk_url:'https://github.com/Luckycia404/hm-cinema-apk/releases/latest';
  var a=document.createElement('a');
  a.href=url;
  a.download='HM-Cinema.apk';
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){document.body.removeChild(a);},200);
}
(function() {
    // Show once per browser session — resets when they close the tab/browser
    // Skip via ?nowelcome=1 for testing/screenshots
    if (!sessionStorage.getItem('hmc_welcomed') && !/[?&]nowelcome=1/.test(location.search)) {
        var overlay = document.getElementById('welcomeOverlay');
        overlay.style.display = 'flex';
    }
})();
function dismissWelcome() {
    sessionStorage.setItem('hmc_welcomed', '1');
    const overlay = document.getElementById('welcomeOverlay');
    overlay.style.animation = 'wFadeIn 0.3s ease reverse';
    setTimeout(() => overlay.style.display = 'none', 280);
}
// Also close if clicking outside the box
document.getElementById('welcomeOverlay').addEventListener('click', function(e) {
    if (e.target === this) dismissWelcome();
});
