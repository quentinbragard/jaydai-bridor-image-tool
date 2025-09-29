module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'Missing GEMINI_API_KEY environment variable.' });
  }

  const body = await new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 10 * 1024 * 1024) {
        reject(new Error('Payload too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('Invalid JSON payload.'));
      }
    });
    req.on('error', reject);
  }).catch(error => {
    res.status(400).json({ error: error.message });
  });

  if (!body) {
    return;
  }

  const { prompt, base64Image, mimeType } = body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required.' });
  }

  const contentParts = [];

  if (base64Image) {
    contentParts.push({
      inlineData: {
        mimeType: mimeType || 'image/jpeg',
        data: base64Image
      }
    });
  }

  contentParts.push({ text: prompt });

  const payload = {
    contents: [{ parts: contentParts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE']
    }
  };

  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey
        },
        body: JSON.stringify(payload)
      }
    );

    const responseBody = await response.json().catch(() => null);

    if (!response.ok) {
      const message = responseBody?.error?.message || `Gemini API request failed with status ${response.status}.`;
      return res.status(response.status).json({ error: message });
    }

    const base64Data = responseBody?.candidates?.[0]?.content?.parts?.find(part => part.inlineData)?.inlineData?.data;

    if (!base64Data) {
      const textError = responseBody?.candidates?.[0]?.content?.parts?.find(part => part.text)?.text;
      return res.status(500).json({ error: textError || 'API did not return image data.' });
    }

    return res.status(200).json({ imageUrl: `data:image/png;base64,${base64Data}` });
  } catch (error) {
    console.error('Gemini API proxy error:', error);
    return res.status(500).json({ error: error.message || 'Unexpected server error.' });
  }
};
