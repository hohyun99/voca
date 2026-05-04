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
            text: `You are an OCR assistant. Extract vocabulary entries from this image.
Return ONLY a JSON array with no other text:
[{"word": "...", "definition": "...", "synonyms": [...], "antonyms": [...]}, ...]

STRICT RULES — do NOT deviate:
- "definition": extract ONLY the first line that explains the meaning of the word. The line immediately after the definition is typically an example sentence — do NOT include it. Only take the definition line, not the example.
- "synonyms": copy ONLY the exact words visually printed after the label "synonyms:" in the image. If the label is absent, use [].
- "antonyms": copy ONLY the exact words visually printed after the label "antonyms:" in the image. If the label is absent, use [].
- DO NOT infer, generate, or add ANY synonyms or antonyms that are not literally written in the image.
- DO NOT use your own knowledge. Treat this as pure text extraction from the image.`,
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
