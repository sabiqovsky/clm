const { pngToEmf } = require('../lib/png-to-emf');

module.exports = function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const { image, format = 'emf', filename = 'chart' } = req.body;
  if (!image) return res.status(400).json({ error: 'Missing image data' });
  if (!['emf', 'wmf'].includes(format))
    return res.status(400).json({ error: 'Format must be emf or wmf' });

  try {
    const base64 = image.replace(/^data:image\/\w+;base64,/, '');
    const pngBuf = Buffer.from(base64, 'base64');

    // WMF not supported natively — EMF is the modern equivalent and opens in Office
    if (format === 'wmf') {
      return res.status(400).json({ error: 'WMF is not supported. Use EMF — it opens in all Office apps.' });
    }

    const emfBuf = pngToEmf(pngBuf);
    res.setHeader('Content-Type', 'image/x-emf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.emf"`);
    res.setHeader('Content-Length', emfBuf.length);
    res.end(emfBuf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Conversion failed' });
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: '10mb' } } };
