(() => {
 const key='nucleus-theme-v1',button=document.getElementById('themeToggle');
 let theme;try{theme=localStorage.getItem(key)}catch{}
 if(!['light','dark'].includes(theme))theme=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';
 function render(){document.documentElement.dataset.theme=theme;button.textContent=theme==='light'?'Tmavý režim':'Světlý režim';button.setAttribute('aria-pressed',String(theme==='light'));document.querySelector('meta[name="theme-color"]').content=theme==='light'?'#f1f5f9':'#111111'}
 button.addEventListener('click',()=>{theme=theme==='light'?'dark':'light';try{localStorage.setItem(key,theme)}catch{}render()});render();
})();
