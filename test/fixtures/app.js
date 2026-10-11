document.querySelector('#loaded').textContent='页面和根路径资源已加载';
document.querySelector('#form').addEventListener('submit',event=>{event.preventDefault();document.querySelector('#message').textContent=`欢迎，${document.querySelector('#username').value}；地区 ${document.querySelector('#country').value}；订阅 ${document.querySelector('#subscribe').checked}`});
document.querySelector('#hover').addEventListener('mouseenter',()=>document.querySelector('#events').textContent='悬停成功');
document.querySelector('#double').addEventListener('dblclick',()=>document.querySelector('#events').textContent='双击成功');
document.querySelector('#bottom').addEventListener('click',()=>document.querySelector('#events').textContent='底部点击成功');
class Counter extends HTMLElement{constructor(){super();const root=this.attachShadow({mode:'open'});root.innerHTML='<button id="increment">Shadow 计数</button><span id="value">计数 0</span><span style="display:none">隐藏 shadow 内容</span>';let value=0;root.querySelector('button').addEventListener('click',()=>root.querySelector('#value').textContent=`计数 ${++value}`)}}customElements.define('test-counter',Counter);
console.error('fixture-start-error');fetch('/missing-fixture.json').catch(()=>{});
