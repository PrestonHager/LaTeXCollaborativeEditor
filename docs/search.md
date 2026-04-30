# Search documentation

<div id="docs-search-container">
  <input id="doc-search" type="text" placeholder="Search docs…" autocomplete="off" style="width:100%; padding:8px; font-size:16px;" />
  <ul id="search-results" style="list-style:none; padding:0; margin:8px 0;"></ul>
</div>

<script src="https://cdn.jsdelivr.net/npm/fuse.js@6.6.2/dist/fuse.min.js"></script>
<script>
  (function(){
    // Page is …/docs/search/; index lives at …/docs/search_index.json
    const indexUrl = new URL('../search_index.json', window.location.href).href;
    fetch(indexUrl).then(r => r.json()).then(items => {
      const fuse = new Fuse(items, {
        keys: ['title','content'],
        includeScore: true,
        threshold: 0.4,
        distance: 100
      });
      const input = document.getElementById('doc-search');
      const results = document.getElementById('search-results');
      function render(res){
        results.innerHTML = '';
        if(!res.length){ results.innerHTML = '<li>No results</li>'; return; }
        for(const hit of res){
          const item = hit.item || hit;
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = item.url;
          a.textContent = item.title;
          li.appendChild(a);
          results.appendChild(li);
        }
      }
      input.addEventListener('input', () => {
        const q = input.value.trim();
        if(!q){ results.innerHTML = ''; return; }
        const hits = fuse.search(q);
        render(hits);
      });
    }).catch(() => {
      document.getElementById('search-results').innerHTML = '<li>Failed to load search index</li>';
    });
  })();
</script>
