const fetch = require('node-fetch');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const { image, format = 'wmf', filename = 'chart' } = req.body;
  if (!image) return res.status(400).json({ error: 'Missing image data' });
  if (!['wmf', 'emf'].includes(format))
    return res.status(400).json({ error: 'Format must be wmf or emf' });

  const apiKey = process.env.CONVERTIO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Missing CONVERTIO_API_KEY' });

  try {
    const base64 = image.replace(/^data:image\/\w+;base64,/, '');

    // 1. Start conversion
    const startRes = await fetch('https://api.convertio.co/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apikey: apiKey, input: 'base64', file: base64, filename: 'chart.png', outputformat: format })
    });
    const startData = await startRes.json();
    if (startData.status !== 'ok') throw new Error(startData.error || 'Failed to start conversion');
    const id = startData.data.id;

    // 2. Poll until finished
    let outputUrl = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const statusRes = await fetch(`https://api.convertio.co/convert/${id}/status`);
      const statusData = await statusRes.json();
      if (statusData.data.step === 'finish') { outputUrl = statusData.data.output.url; break; }
      if (statusData.data.step === 'error') throw new Error('Conversion failed on Convertio');
    }
    if (!outputUrl) throw new Error('Conversion timed out');

    // 3. Stream result back
    const fileRes = await fetch(outputUrl);
    if (!fileRes.ok) throw new Error('Failed to download converted file');
    res.setHeader('Content-Type', format === 'emf' ? 'image/x-emf' : 'image/x-wmf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.${format}"`);
    fileRes.body.pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Conversion failed' });
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: '10mb' } } };
