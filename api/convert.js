const CloudConvert = require('cloudconvert');
const { Readable } = require('stream');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const { image, format = 'wmf', filename = 'chart' } = req.body;
  if (!image) return res.status(400).json({ error: 'Missing image data' });
  if (!['wmf', 'emf'].includes(format))
    return res.status(400).json({ error: 'Format must be wmf or emf' });

  const apiKey = process.env.CLOUDCONVERT_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Missing CLOUDCONVERT_API_KEY' });

  try {
    const cloudconvert = new CloudConvert(apiKey);
    const base64 = image.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');

    const job = await cloudconvert.jobs.create({
      tasks: {
        upload: { operation: 'import/upload' },
        convert: { operation: 'convert', input: 'upload', input_format: 'png', output_format: format },
        export: { operation: 'export/url', input: 'convert' }
      }
    });

    const uploadTask = job.tasks.find(t => t.name === 'upload');
    const stream = Readable.from(buffer);
    await cloudconvert.tasks.upload(uploadTask, stream, 'chart.png', buffer.length);

    const completed = await cloudconvert.jobs.wait(job.id);
    const fileUrl = cloudconvert.jobs.getExportUrls(completed)[0].url;

    const fetch = require('node-fetch');
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) throw new Error('Failed to fetch converted file');

    res.setHeader('Content-Type', format === 'emf' ? 'image/x-emf' : 'image/x-wmf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.${format}"`);
    fileRes.body.pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Conversion failed' });
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: '10mb' } } };
