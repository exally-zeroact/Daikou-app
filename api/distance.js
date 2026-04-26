// /api/distance.js
// Google Maps Distance Matrix API 経由で2地点間の距離を取得
// クライアントからAPIキーを隠すため、サーバーサイド経由

export default async function handler(req, res) {
  // CORS対応
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { from, to } = req.query;

  if (!from || !to) {
    return res.status(400).json({
      error: 'Missing parameters: from, to (format: lat,lng)'
    });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // Distance Matrix API URL
  const url = 'https://maps.googleapis.com/maps/api/distancematrix/json' +
    `?origins=${encodeURIComponent(from)}` +
    `&destinations=${encodeURIComponent(to)}` +
    `&mode=driving` +
    `&language=ja` +
    `&key=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK') {
      return res.status(500).json({
        error: 'Distance Matrix API error',
        status: data.status,
        message: data.error_message
      });
    }

    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK') {
      return res.status(404).json({
        error: 'Route not found',
        status: element?.status
      });
    }

    return res.status(200).json({
      distance_m: element.distance.value,        // メートル単位
      distance_text: element.distance.text,      // 表示用 "12.3 km"
      duration_sec: element.duration.value,      // 秒単位
      duration_text: element.duration.text,      // "30 分"
    });

  } catch (err) {
    console.error('Distance API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
