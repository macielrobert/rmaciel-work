// Local preview of the BUILT site. `node build.js` first; opening the repo's
// own index.html shows an empty CONTENT block by design.
const http=require('http'),fs=require('fs'),path=require('path');
const root=path.join(__dirname,'dist');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.webp':'image/webp'};
http.createServer((req,res)=>{
  let f=decodeURIComponent(req.url.split('?')[0]);
  if(f.endsWith('/'))f+='index.html';
  const p=path.join(root,f);
  fs.readFile(p,(e,d)=>{ if(e){res.writeHead(404);res.end('not found');return;}
    res.writeHead(200,{'Content-Type':types[path.extname(p)]||'application/octet-stream','Cache-Control':'no-store'});res.end(d);});
}).listen(4321,()=>console.log('serving dist on http://localhost:4321'));
