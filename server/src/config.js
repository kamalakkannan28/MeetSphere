import 'dotenv/config';

const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);
const list = (v, d) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d);

const iceServers = [{ urls: list(process.env.STUN_URLS, ['stun:stun.l.google.com:19302']) }];
if (process.env.TURN_URL) {
  iceServers.push({
    urls: list(process.env.TURN_URL, []),
    username: process.env.TURN_USERNAME || '',
    credential: process.env.TURN_CREDENTIAL || '',
  });
}

export const config = {
  port: int(process.env.PORT, 5000),
  clientUrls: list(process.env.CLIENT_URL, ['http://localhost:5173']),
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  groqSttModel: process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo',
  groqBaseUrl: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
  authRateLimit: int(process.env.AUTH_RATE_LIMIT, 30),
  maxParticipants: int(process.env.MAX_PARTICIPANTS, 6),
  requireVerifiedEmail: process.env.REQUIRE_VERIFIED_EMAIL === 'true',
  maxFileBytes: int(process.env.MAX_FILE_MB, 5) * 1024 * 1024,
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
  },
  iceServers,
};
