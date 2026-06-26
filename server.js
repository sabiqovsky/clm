require('dotenv').config({ path: '.env.local' });
const http = require('http');
const path = require('path');
const fs = require('fs');
const handler = require('./api/convert');

// Minimal req body parser
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.jsx': 'application/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};

const server = http.createServer(async (req, res) => {
  if (req.url === '/api/convert' || req.url.startsWith('/api/convert?')) {
    req.body = await parseBody(req);
    // Minimal res helpers
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(obj)); };
    return handler(req, res);
  }

  // Serve static files
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end('Not found'); }
  const ext = path.extname(filePath);
  res.writeHead(200, {'Content-Type': MIME[ext] || 'text/plain'});
  fs.createReadStream(filePath).pipe(res);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Running at http://localhost:${PORT}`));
