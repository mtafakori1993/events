const ref = sessionStorage.getItem('ev_ref');
if (ref && /^EV-[A-Z2-9]{6}$/.test(ref)) { document.getElementById('ref').textContent = ref; document.getElementById('ref-box').hidden = false; }
