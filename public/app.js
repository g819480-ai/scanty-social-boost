const $ = (s, root=document) => root.querySelector(s);
const state = { services: [], user: null, authMode: "login", selectedService: null, admin: null };
const icons = {Strategy:"⌕",Content:"▤",Creative:"✧",Advertising:"↗",Management:"◈"};
const money = n => new Intl.NumberFormat("en-GH",{style:"currency",currency:"GHS",maximumFractionDigits:2}).format(Number(n||0));
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(path, options={}) {
  const response = await fetch(path,{credentials:"same-origin",headers:{"Content-Type":"application/json",...(options.headers||{})},...options});
  const data = await response.json().catch(()=>({error:"Unexpected server response."}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
function toast(message){const el=$("#toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),3200)}
function showModal(id){$("#"+id).hidden=false;document.body.style.overflow="hidden"}
function closeModal(id){$("#"+id).hidden=true;document.body.style.overflow=""}
function renderServices(){
  const grid=$("#serviceGrid");
  if(!state.services.length){grid.innerHTML='<div class="loading-card">Services are being updated. Please check back shortly.</div>';return}
  grid.innerHTML=state.services.map(s=>`<article class="service-card">
    <div class="service-icon">${icons[s.category]||"✦"}</div><div class="service-category">${escapeHtml(s.category.toUpperCase())}</div>
    <h3>${escapeHtml(s.name)}</h3><p>${escapeHtml(s.description)}</p>
    <div class="service-bottom"><div class="price">${money(s.price_ghs)}<small>ONE-TIME STARTING PRICE</small></div><button data-order="${escapeHtml(s.id)}">Choose service →</button></div>
  </article>`).join("");
  $("#serviceSelect").innerHTML=state.services.map(s=>`<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} — ${money(s.price_ghs)}</option>`).join("");
  grid.querySelectorAll("[data-order]").forEach(btn=>btn.addEventListener("click",()=>openOrder(btn.dataset.order)));
}
function openAuth(mode="login"){state.authMode=mode;updateAuthMode();showModal("authModal")}
function updateAuthMode(){
  const register=state.authMode==="register";
  $("#authTitle").textContent=register?"Create your account.":"Welcome back.";
  $("#authSubtitle").textContent=register?"Create an account to place and track orders.":"Sign in to manage your orders.";
  $("#nameField").hidden=!register;$("#authForm [name=password]").autocomplete=register?"new-password":"current-password";
  $("#authForm [name=password]").minLength=register?10:1;
  $("#authSubmit").textContent=register?"Create account":"Sign in";
  $("#switchText").textContent=register?"Already have an account?":"New here?";
  $("#switchAuth").textContent=register?"Sign in":"Create an account";
  $("#authMessage").textContent="";
}
function openOrder(serviceId){
  state.selectedService=serviceId||state.services[0]?.id;
  if(!state.selectedService){toast("Services are not available yet.");return}
  $("#serviceSelect").value=state.selectedService;updateOrderPrice();$("#orderMessage").textContent="";
  if(!state.user){closeModal("orderModal");openAuth("login");toast("Sign in or create an account to continue.");return}
  showModal("orderModal");
}
function updateOrderPrice(){
  const service=state.services.find(s=>s.id===$("#serviceSelect").value);
  $("#orderPrice").textContent=service?money(service.price_ghs):money(0);
}
async function loadUser(){
  try{const data=await api("/api/auth/me");state.user=data.user;$("#accountBtn").textContent=state.user?"My account":"Sign in"}catch{state.user=null}
}
async function loadOrders(){
  const data=await api("/api/orders");
  if(!data.orders.length){$("#accountContent").innerHTML='<p class="empty-state">No orders yet. Your projects will appear here.</p>';return}
  $("#accountContent").innerHTML=`<div style="overflow:auto"><table class="order-table"><thead><tr><th>Service</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>${data.orders.map(o=>`<tr><td><b>${escapeHtml(o.service_name)}</b></td><td>${money(o.amount_ghs)}</td><td><span class="status">${escapeHtml(o.status.replaceAll("_"," "))}</span></td><td>${new Date(o.created_at+"Z").toLocaleDateString("en-GH")}</td></tr>`).join("")}</tbody></table></div>`;
}
async function openAccount(){
  if(!state.user){openAuth();return}
  $("#accountHeading").textContent=state.user.role==="admin"?"Admin overview.":"Your orders.";
  $("#accountIntro").textContent=`Signed in as ${state.user.email}`;
  $("#accountContent").innerHTML='<p class="loading-card">Loading your account…</p>';
  showModal("accountModal");
  try{
    if(state.user.role==="admin") await loadAdmin();
    else await loadOrders();
  }catch(e){$("#accountContent").textContent=e.message}
}
async function loadAdmin(){
  const d=await api("/api/admin/overview");
  $("#accountContent").innerHTML=`<div class="account-actions"><b>${d.totals.order_count} total orders · ${money(d.totals.revenue_ghs)} paid value</b><button id="logoutBtn">Sign out</button></div>
    <h3>Recent orders</h3><div style="overflow:auto"><table class="order-table"><thead><tr><th>Order</th><th>Amount</th><th>Status</th><th>Update</th></tr></thead><tbody>${d.orders.map(o=>`<tr><td><b>${escapeHtml(o.service_name)}</b><br><small>${escapeHtml(o.brief.slice(0,70))}</small></td><td>${money(o.amount_ghs)}</td><td>${escapeHtml(o.status.replaceAll("_"," "))}</td><td><select data-status="${escapeHtml(o.id)}"><option value="">Choose</option>${["paid","in_progress","completed","cancelled","refunded"].map(s=>`<option value="${s}" ${s===o.status?"selected":""}>${s.replaceAll("_"," ")}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>
    <h3 style="margin-top:28px">Add a service</h3><form id="adminServiceForm" class="admin-form"><div class="field"><label>Service name</label><input name="name" required></div><div class="field"><label>Category</label><input name="category" required placeholder="Strategy, Content, Creative…"></div><div class="field"><label>Description</label><textarea name="description" required rows="2"></textarea></div><div class="field"><label>Price (GHS)</label><input name="price_ghs" type="number" min="0" step="1" required></div><div class="field"><label>Delivery note</label><input name="delivery_note"></div><button class="btn btn-primary btn-full">Add service</button></form>
    <h3 style="margin-top:28px">Services</h3>${d.services.map(s=>`<div class="account-actions"><span>${escapeHtml(s.name)} · ${money(s.price_ghs)} · ${s.active?"Active":"Hidden"}</span><button data-toggle-service="${escapeHtml(s.id)}" data-active="${s.active?0:1}">${s.active?"Hide":"Activate"}</button></div>`).join("")}`;
  $("#logoutBtn").addEventListener("click",logout);
  document.querySelectorAll("[data-status]").forEach(sel=>sel.addEventListener("change",async()=>{if(!sel.value)return;try{await api("/api/admin/orders/status",{method:"PATCH",body:JSON.stringify({id:sel.dataset.status,status:sel.value})});toast("Order updated.");await loadAdmin()}catch(e){toast(e.message)}}));
  document.querySelectorAll("[data-toggle-service]").forEach(btn=>btn.addEventListener("click",async()=>{try{await api("/api/admin/services/toggle",{method:"PATCH",body:JSON.stringify({id:btn.dataset.toggleService,active:Number(btn.dataset.active)})});await loadAdmin();await loadServices();toast("Service updated.")}catch(e){toast(e.message)}}));
  $("#adminServiceForm").addEventListener("submit",async e=>{e.preventDefault();const form=new FormData(e.currentTarget);const payload=Object.fromEntries(form.entries());payload.price_ghs=Number(payload.price_ghs);try{await api("/api/admin/services",{method:"POST",body:JSON.stringify(payload)});await loadServices();await loadAdmin();toast("Service added.")}catch(err){toast(err.message)}});
}
async function logout(){await api("/api/auth/logout",{method:"POST"});state.user=null;$("#accountBtn").textContent="Sign in";closeModal("accountModal");toast("You have signed out.")}
async function loadServices(){const data=await api("/api/services");state.services=data.services;renderServices()}
async function verifyPayment(){
  const params=new URLSearchParams(location.search);
  if(params.get("payment")!=="verify"||!params.get("reference"))return;
  try{await api("/api/payments/verify",{method:"POST",body:JSON.stringify({reference:params.get("reference")})});toast("Payment confirmed. Your order is in your account.");}
  catch(e){toast("Payment status: "+e.message)}
  history.replaceState({},document.title,"/");
}
$("#authForm").addEventListener("submit",async e=>{
  e.preventDefault();const f=new FormData(e.currentTarget);const payload=Object.fromEntries(f.entries());
  $("#authMessage").textContent="Please wait…";
  try{
    const data=await api(state.authMode==="register"?"/api/auth/register":"/api/auth/login",{method:"POST",body:JSON.stringify(payload)});
    state.user=data.user;$("#accountBtn").textContent="My account";closeModal("authModal");toast(`Welcome${state.user.name?" back, "+state.user.name:""}!`);
    if(state.selectedService){showModal("orderModal");updateOrderPrice()}else if(state.user.role==="admin")openAccount();
  }catch(err){$("#authMessage").textContent=err.message}
});
$("#switchAuth").addEventListener("click",()=>{state.authMode=state.authMode==="login"?"register":"login";updateAuthMode()});
$("#orderForm").addEventListener("submit",async e=>{
  e.preventDefault();const f=new FormData(e.currentTarget);const payload=Object.fromEntries(f.entries());
  $("#orderMessage").textContent="Creating your order…";
  try{const data=await api("/api/orders",{method:"POST",body:JSON.stringify(payload)});location.href=data.authorization_url;}
  catch(err){$("#orderMessage").textContent=err.message}
});
$("#serviceSelect").addEventListener("change",updateOrderPrice);
$("#accountBtn").addEventListener("click",openAccount);
$("#navOrderBtn").addEventListener("click",()=>openOrder());
$("#ctaOrderBtn").addEventListener("click",()=>openOrder());
$("#menuToggle").addEventListener("click",()=>$("#mainNav").classList.toggle("open"));
document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>closeModal(b.dataset.close)));
document.querySelectorAll(".modal-backdrop").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)closeModal(m.id)}));
$("#year").textContent=new Date().getFullYear();
(async()=>{try{await loadServices();await loadUser();await verifyPayment()}catch(e){$("#serviceGrid").innerHTML='<div class="loading-card">Could not load services. Please refresh in a moment.</div>';console.error(e)}})();
