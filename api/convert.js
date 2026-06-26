import CloudConvert from 'cloudconvert';

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const { image, format = 'wmf', filename = 'chart' } = req.body;
  if (!image) return res.status(400).json({ error: 'Missing image data' });

  if (!['wmf', 'emf'].includes(format))
    return res.status(400).json({ error: 'Format must be wmf or emf' });

  const apiKey = process.env.CLOUDCONVERT_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Missing CLOUDCONVERT_API_KEY' });

  try {
    const cloudconvert = new CloudConvert(apiKey);

    // Strip data URI prefix
    const base64 = image.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');

    const job = await cloudconvert.jobs.create({
      tasks: {
        'upload': {
          operation: 'import/base64',
          file: base64,
          filename: 'chart.png'
        },
        'convert': {
          operation: 'convert',
          input: 'upload',
          input_format: 'png',
          output_format: format
        },
        'export': {
          operation: 'export/url',
          input: 'convert'
        }
      }
    });

    const completed = await cloudconvert.jobs.wait(job.id);
    const exportTask = completed.tasks.find(t => t.name === 'export');
    const file = exportTask.result.files[0];

    // Fetch the converted file and stream back
    const fetch = (await import('node-fetch')).default;
    const fileRes = await fetch(file.url);
    if (!fileRes.ok) throw new Error('Failed to fetch converted file');

    const contentType = format === 'emf' ? 'image/x-emf' : 'image/x-wmf';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.${format}"`);
    fileRes.body.pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Conversion failed' });
  }
}
