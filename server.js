const express = require('express');
const { GoogleGenAI } = require('@google/genai');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const app = express();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/analyze', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '이미지 파일이 필요합니다.' });
  }

  const mediaType = req.file.mimetype;
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mediaType)) {
    return res.status(400).json({ error: 'JPEG, PNG, GIF, WebP 형식만 지원합니다.' });
  }

  try {
    const imageData = req.file.buffer.toString('base64');

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{
        parts: [
          { inlineData: { mimeType: mediaType, data: imageData } },
          {
            text: `이 이미지에서 영어 단어 정보를 모두 추출하세요.
다른 텍스트 없이 아래 형식의 JSON 배열만 반환하세요:
[{"word": "example", "definition": "a representative instance", "synonyms": ["instance", "sample"], "antonyms": ["counterexample"]}, ...]

규칙:
- 이미지에 보이는 모든 단어 정보를 포함하세요
- 이미지에 나온 그대로 정보를 유지하세요
- word 필드: 단어만 (구두점 제외)
- definition 필드: 전체 설명/정의
- synonyms 필드: 이미지에 표시된 유의어 목록 (없으면 빈 배열 [])
- antonyms 필드: 이미지에 표시된 반의어 목록 (없으면 빈 배열 [])`,
          },
        ],
      }],
    });

    const text = response.text.trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('응답에서 단어 목록을 파싱할 수 없습니다.');

    const pairs = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(pairs) || pairs.length === 0) {
      throw new Error('이미지에서 단어를 찾을 수 없습니다.');
    }

    res.json({ pairs });
  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
